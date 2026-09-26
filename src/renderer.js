import { mountMapContext, trackPointDialog } from './map-context.mjs'
import { manualTrackFile } from './manual-track.mjs'
import { mountJournal } from './journal-ui.mjs'
import { readRasterChart, rasterPixels } from './raster-chart.mjs'
import { buildPointIndex, countPoints, viewPoints } from './track-view.mjs'
import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import { parseTextTrack, parseTrcTrack, parseLowranceTrack } from './track-parser.mjs'
import { ROXEN_BOUNDS, SWEDEN_BOUNDS, fitBounds, viewportMap, panMap, zoomMap, visibleTiles, geoToMapPixel, mapPixelToGeo } from './web-map.mjs'
import { compareTrackPoints, adjustedDepth, exportCsv, exportWaypoints, processedPoints, trackDate, formatCoordinate } from './track-processing.mjs'
import { simulationFrame } from './nmea-simulator.mjs'
import { parseNmeaSentence } from './nmea-parser.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const colors = Array.from({length: 360}, (_, i) => `hsl(${(i * 137.508) % 360} 70% 38%)`)
let journalController=null,journalRows=[],journalPick=null,journalMarkers=[]
let focusedTrack = null
let comparison = null
let comparisonMatches = null
const decimal = value => !Number.isFinite(value) ? '–' : Number(value).toLocaleString('sv-SE', {minimumFractionDigits: 2, maximumFractionDigits: 2})
const fileLabel = file => file.name?.trim() || file.originalName || file.relativePath?.split(/[\\/]/).pop() || `Fältmanus ${file.id || ''}`
function depthExplanation(log) {
  const source = {roxen: 'Tekniska verken', manual: 'Manuellt angiven', filename: 'Filnamnet'}[log.waterLevelSource] || 'Filnamnet / okänd källa'
  return `Justerat djup = rådjup − ${decimal(log.correction || 0)} m + ${decimal(log.depthAdjustment || 0)} m. Vattennivå: ${log.waterLevel == null ? 'saknas; ingen vattenståndskorrektion' : decimal(log.waterLevel) + ' m'}, källa: ${source}, nivådatum: ${log.waterLevelDate || (log.waterLevelSource === 'filename' ? trackDate(log) : null) || 'inte sparat'}. Mätdatum: ${trackDate(log) || 'okänt'}. Referens: 33,00 m RH00. Gallring påverkar visning/export, inte jämförelsen.`
}
function trackLabel(log) {
  const name = log.name || 'Namnlöst spår'
  const parts = name.replace(/\.[^.]+$/, '').replace(/^\d{8}[_ ](?:\d+\.\d+[_ ])?/, '').split(/[_ ]+/)
  return `${trackDate(log) || 'Okänt datum'} · Båt/område från filnamn: ${parts.join(' · ')} · ${name.split('.').pop().toUpperCase()} · ${log.points.length} punkter${/^all_/i.test(name) ? ' · Samlingsfil (innehåll ej verifierat)' : ''}`
}
const state = { pdf: null, pdfKey: null, activePdfId: null, page: null, map: null, width: 0, height: 0, scale: 1, fitScale: 1, calibration: [], transform: null, logs: [], armed: false, live: null, roxenLevel: null, library: { folders: [], pdfs: [], tracks: [] } }
const $ = id => document.getElementById(id)
const pendingLibraryWrites = new Set()
if (window.sjomatning.syncCloudLibrary) {
  $('cloudSyncPanel').classList.remove('hidden')
  window.sjomatning.onCloudSyncProgress(({current,total,name}) => { $('cloudSyncStatus').textContent = `${current}/${total} · ${name}` })
  const askForCloudKey = message => new Promise(resolve => {
    const dialog = $('cloudKeyDialog'), input = $('cloudSyncToken')
    input.value = ''
    $('cloudKeyMessage').textContent = message
    let token = null
    $('cloudKeyForm').onsubmit = event => {
      event.preventDefault()
      if (!input.value.trim()) { input.focus(); return }
      token = input.value.trim()
      dialog.close()
    }
    $('cancelCloudKey').onclick = () => dialog.close()
    dialog.addEventListener('close', () => { input.value = ''; resolve(token) }, { once: true })
    dialog.showModal()
    input.focus()
  })
  $('cloudUsers').onclick=async()=>{
    const button=$('cloudUsers'),container=$('cloudUsersList');button.disabled=true;container.textContent='Hämtar nycklar…';
    try {
      let result=await window.sjomatning.listCloudUsers({});
      while(result.needsToken){const token=await askForCloudKey(result.message);if(token===null){container.textContent='';return;}result=await window.sjomatning.listCloudUsers({token});}
      container.replaceChildren();container.style.overflowX='auto';
      const table=document.createElement('table'),head=table.createTHead().insertRow();
      for(const label of ['Alias','Nyckel-ID','Rättigheter','Status']){const th=document.createElement('th');th.textContent=label;th.scope='col';head.append(th);}
      const body=table.createTBody();
      for(const user of result.users){const row=body.insertRow();for(const value of [user.name,user.id,user.id==='admin'?'Administratör':user.role==='all'?'Hela biblioteket':'Egna spår',user.active?'Aktiv':'Spärrad'])row.insertCell().textContent=value;}
      container.append(table);const note=document.createElement('p');note.textContent='Nyckelvärden kan inte visas i efterhand. Nyckel-ID identifierar varje nyckel.';container.append(note);
    }catch(error){container.textContent=error.message;}finally{button.disabled=false;}
  }
  $('syncCloudLibrary').onclick = async () => {
    const button = $('syncCloudLibrary'), input = $('cloudSyncToken')
    button.disabled = true
    $('cloudSyncStatus').textContent = 'Ansluter till webblagringen…'
    try {
      if (!await flushAnnotationChanges()) throw new Error('Anteckningarna kunde inte sparas före synkning.')
      await Promise.all(pendingLibraryWrites)
      const calibrations = {}
      for (const key of Object.keys(localStorage)) if(key.startsWith('calibration:')) calibrations[key] = JSON.parse(localStorage.getItem(key))
      let result = await window.sjomatning.syncCloudLibrary({calibrations})
      while (result.needsToken) {
        const token = await askForCloudKey(result.message)
        if (token === null) { $('cloudSyncStatus').textContent = 'Synkningen avbröts.'; return }
        $('cloudSyncStatus').textContent = 'Kontrollerar nyckeln och synkar…'
        result = await window.sjomatning.syncCloudLibrary({token,calibrations})
      }
      $('cloudSyncStatus').textContent = `${result.uploaded} uppladdade, ${result.updated} uppdaterade, ${result.unchanged} oförändrade, ${result.skipped} överhoppade enligt behörighet. ${result.errors.length ? 'Fel: '+result.errors.map(e=>e.name+': '+e.message).join(' · ') : 'Synkningen är klar. Ladda om webbplatsen för att se filerna.'}`
    } catch(error) { $('cloudSyncStatus').textContent = `Synkningen misslyckades: ${error.message}` }
    finally { button.disabled = false; input.value = '' }
  }
}
const pdfCanvas = $('pdfCanvas')
const overlay = $('overlayCanvas')
const wrap = $('canvasWrap')
const viewportElement = $('viewport')
const waterLevelRequests = new Map()
let manuscriptOffset = { x: 0, y: 0 }
let showManuscripts = false
let trackColors = false
let tracksPanelOpen = false
const manuscriptName = name => name.replace(/\.(pdf|kap|wci)$/i, '')
const shortTrackName = name => name.length > 42 ? name.slice(0, 26) + '…' + name.slice(-15) : name
const annotationEditor = { file: null, page: 1, selected: null, placing: false, loading: false, saving: false, fontScale: 1.6 }
let annotationSaveTimer
let annotationSavePromise = Promise.resolve(true)
let annotationWritePromise = Promise.resolve()
let documentLoadId = 0
let fitTimer
function refreshFits() { clearTimeout(fitTimer); fitTimer = setTimeout(() => { renderFolder(); renderLogs() }, 180) }

function toast(message) {
  $('toast').textContent = message
  $('toast').classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 4200)
}

function parseTrackFile(bytes, name) {
  if (/\.sl[23]$/i.test(name)) return parseLowranceTrack(bytes, name)
  return /\.trc$/i.test(name) ? parseTrcTrack(bytes, name) : parseTextTrack(bytesToText(bytes), name)
}

function bytesToText(bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

function parseGeoPdf(bytes) {
  const raw = new TextDecoder('latin1').decode(bytes)
  const gpts = raw.match(/\/GPTS\s*\[([^\]]+)\]/)
  const lpts = raw.match(/\/LPTS\s*\[([^\]]+)\]/)
  if (!gpts || !lpts) return null
  const values = match => match[1].trim().split(/\s+/).map(Number)
  const geo = values(gpts)
  const local = values(lpts)
  if (geo.length < 6 || geo.length % 2 || local.length !== geo.length || ![...geo, ...local].every(Number.isFinite)) return null
  return geo.reduce((points, value, index) => {
    if (index % 2 === 0) points.push({ lat: value, lon: geo[index + 1], nx: local[index], ny: local[index + 1] })
    return points
  }, [])
}

function saveCalibration() {
  if (!state.pdfKey || state.calibration.some(point => point.automatic)) return
  const points = state.calibration.map(point => ({
    nx: point.x / state.width, ny: point.y / state.height, lat: point.lat, lon: point.lon
  }))
  localStorage.setItem(`calibration:${state.pdfKey}`, JSON.stringify(points))
  if (window.sjomatning.saveCalibration) void window.sjomatning.saveCalibration(`calibration:${state.pdfKey}`, points).catch(error => toast(error.message))
}

function restoreCalibration() {
  if (!state.pdfKey) return []
  try {
    const saved = JSON.parse(localStorage.getItem(`calibration:${state.pdfKey}`) || '[]')
    return saved.map(point => ({ x: point.nx * state.width, y: point.ny * state.height, lat: point.lat, lon: point.lon }))
  } catch { return [] }
}

function solve3(matrix, values) {
  const augmented = matrix.map((row, i) => [...row, values[i]])
  for (let col = 0; col < 3; col += 1) {
    let pivot = col
    for (let row = col + 1; row < 3; row += 1) if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    ;[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]
    if (Math.abs(augmented[col][col]) < 1e-12) return null
    const divisor = augmented[col][col]
    augmented[col] = augmented[col].map(value => value / divisor)
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue
      const factor = augmented[row][col]
      augmented[row] = augmented[row].map((value, i) => value - factor * augmented[col][i])
    }
  }
  return augmented.map(row => row[3])
}

function affineFit(points) {
  if (points.length < 3) return null
  const sums = points.reduce((s, p) => ({
    xx: s.xx + p.x * p.x, xy: s.xy + p.x * p.y, x: s.x + p.x,
    yy: s.yy + p.y * p.y, y: s.y + p.y, n: s.n + 1,
    xlon: s.xlon + p.x * p.lon, ylon: s.ylon + p.y * p.lon, lon: s.lon + p.lon,
    xlat: s.xlat + p.x * p.lat, ylat: s.ylat + p.y * p.lat, lat: s.lat + p.lat
  }), { xx: 0, xy: 0, x: 0, yy: 0, y: 0, n: 0, xlon: 0, ylon: 0, lon: 0, xlat: 0, ylat: 0, lat: 0 })
  const m = [[sums.xx, sums.xy, sums.x], [sums.xy, sums.yy, sums.y], [sums.x, sums.y, sums.n]]
  const lon = solve3(m, [sums.xlon, sums.ylon, sums.lon])
  const lat = solve3(m, [sums.xlat, sums.ylat, sums.lat])
  return lon && lat ? { type: 'affine', lon, lat } : null
}

function calibrationTransform(points) {
  if (points.length >= 3) return affineFit(points)
  if (points.length === 2) {
    const [a, b] = points
    if (Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2) return null
    return {
      type: 'axis',
      lonScale: (b.lon - a.lon) / (b.x - a.x), lonOffset: a.lon - a.x * (b.lon - a.lon) / (b.x - a.x),
      latScale: (b.lat - a.lat) / (b.y - a.y), latOffset: a.lat - a.y * (b.lat - a.lat) / (b.y - a.y)
    }
  }
  return null
}

function geoToPixel(lat, lon) {
  if (state.map) return geoToMapPixel(state.map, lat, lon)
  const t = state.transform
  if (!t) return null
  if (t.type === 'chart') {
    let x=.5,y=.5
    for(let i=0;i<8;i++) {
      const p=t.geo(x,y),px=t.geo(x+.00001,y),py=t.geo(x,y+.00001)
      const a=(px.lon-p.lon)/.00001,b=(py.lon-p.lon)/.00001,c=(px.lat-p.lat)/.00001,d=(py.lat-p.lat)/.00001,det=a*d-b*c
      if(Math.abs(det)<1e-14) return null
      const dx=((lon-p.lon)*d-b*(lat-p.lat))/det,dy=(a*(lat-p.lat)-(lon-p.lon)*c)/det
      x+=dx;y+=dy;if(Math.abs(dx)+Math.abs(dy)<1e-9)break
    }
    return {x:x*state.width,y:y*state.height}
  }
  if (t.type === 'axis') return { x: (lon - t.lonOffset) / t.lonScale, y: (lat - t.latOffset) / t.latScale }
  const determinant = t.lon[0] * t.lat[1] - t.lon[1] * t.lat[0]
  if (Math.abs(determinant) < 1e-12) return null
  const lon0 = lon - t.lon[2]
  const lat0 = lat - t.lat[2]
  return { x: (lon0 * t.lat[1] - t.lon[1] * lat0) / determinant, y: (t.lon[0] * lat0 - lon0 * t.lat[0]) / determinant }
}

function pixelToGeo(x, y) {
  if (state.map) return mapPixelToGeo(state.map, x, y)
  const t = state.transform
  if (!t) return null
  if (t.type === 'chart') return t.geo(x/state.width,y/state.height)
  if (t.type === 'axis') return { lon: t.lonScale * x + t.lonOffset, lat: t.latScale * y + t.latOffset }
  return { lon: t.lon[0] * x + t.lon[1] * y + t.lon[2], lat: t.lat[0] * x + t.lat[1] * y + t.lat[2] }
}

async function loadPdfFile(file, pageNumber = 1, editing = false) {
  if (!editing) { if (!await flushAnnotationChanges()) return false; closeAnnotationEditor() }
  const loadId = ++documentLoadId
  try {
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file.bytes)
    const canvas = document.createElement('canvas')
    let pdf = null, page, automatic = null, fontScale
    if (file.chart) {
      const pixels = await rasterPixels(file.chart)
      canvas.width = pixels.width; canvas.height = pixels.height
      canvas.getContext('2d').putImageData(new ImageData(pixels.rgba,pixels.width,pixels.height),0,0)
      page = { raster: true }
      fontScale = canvas.width / (file.chart.width*72/300)
    } else {
      pdf = await pdfjsLib.getDocument({data:bytes.slice()}).promise
      page = await pdf.getPage(pageNumber)
      const view = page.getViewport({scale:1.6})
      canvas.width = Math.round(view.width); canvas.height = Math.round(view.height)
      await page.render({canvasContext:canvas.getContext('2d'),viewport:view}).promise
      fontScale = canvas.width / (page.getViewport({scale:1}).width / page.userUnit)
      if (pageNumber === 1) automatic = parseGeoPdf(bytes)
    }
    if (loadId !== documentLoadId) { if (pdf) await pdf.loadingTask.destroy(); return false }
    const previousPdf = state.pdf
    state.map = null; state.pdf = pdf; state.page = page; state.activePdfId = file.id || null
    state.pageNumber = pageNumber
    annotationEditor.fontScale = fontScale
    viewportElement.classList.remove('web-map')
    $('mapAttribution').classList.add('hidden')
    state.pdfKey = `${file.originalName || file.name}:${bytes.byteLength}${pageNumber === 1 ? '' : ':page'+pageNumber}`
    state.width = canvas.width; state.height = canvas.height
    pdfCanvas.width = overlay.width = state.width; pdfCanvas.height = overlay.height = state.height
    pdfCanvas.getContext('2d').drawImage(canvas,0,0)
    state.calibration = automatic ? automatic.map(point=>({x:point.nx*state.width,y:(1-point.ny)*state.height,lat:point.lat,lon:point.lon,automatic:true})) : restoreCalibration()
    state.transform = file.chart ? {type:'chart',geo:file.chart.geometry} : calibrationTransform(state.calibration)
    $('documentName').textContent = file.name
    $('pageInfo').textContent = pdf ? 'PDF' : file.chart.type.toUpperCase()
    $('introPanel').classList.add('hidden'); $('documentPanel').classList.remove('hidden')
    $('calibrationPanel').classList.toggle('hidden',Boolean(state.transform) || editing)
    $('emptyState').classList.add('hidden'); wrap.classList.remove('hidden'); viewportElement.classList.remove('empty')
    updateGeoStatus(); fitView(); drawOverlay()
    if (previousPdf && previousPdf !== pdf) void previousPdf.loadingTask.destroy()
    return true
  } catch (error) { console.error(error); toast(`Kunde inte öppna fältmanuset: ${error.message}`); return false }
}

// Keep PDF rasters separate from the map canvas so tile refreshes cannot erase them.
async function manuscriptRaster(file) {
  if (file.mapRaster) return file.mapRaster
  if (file.mapRasterLoading || file.mapRasterFailed) return null
  file.mapRasterLoading = true
  let loadingTask
  try {
    if (file.chart) {
      const pixels = await rasterPixels(file.chart)
      const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height
      canvas.getContext('2d').putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0)
      file.mapRaster = { canvas, noteScale: canvas.width/(file.chart.width*72/300), crop: { x: 0, y: 0, width: canvas.width, height: canvas.height } }
      return file.mapRaster
    }
    loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(file.bytes).slice() })
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(1)
    const original = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(original.width, original.height)) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    // LPTS coordinates belong to the geographic viewport, which can be smaller than the page.
    const raw = new TextDecoder('latin1').decode(new Uint8Array(file.bytes))
    const match = raw.match(/\/VP\s*\[\s*<<\s*\/BBox\s*\[([^\]]+)\]/)
    const box = match ? match[1].trim().split(/\s+/).map(Number) : page.view
    const a = viewport.convertToViewportPoint(box[0], box[1])
    const b = viewport.convertToViewportPoint(box[2], box[3])
    const crop = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0]-a[0]), height: Math.abs(b[1]-a[1]) }
    if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || !crop.width || !crop.height) throw new Error('Ogiltig geografisk yta')
    file.mapRaster = { canvas, crop, noteScale: canvas.width/(original.width/page.userUnit) }
  } catch (error) {
    file.mapRasterFailed = true
    toast(`Kunde inte visa ${file.name} i kartan: ${error.message}`)
  } finally {
    file.mapRasterLoading = false
    if (loadingTask) await loadingTask.destroy()
    scheduleMapDraw()
  }
  return file.mapRaster
}

function manuscriptGeometry(file) {
  if (file.chart) return file.chart.geometry
  const points = parseGeoPdf(new Uint8Array(file.bytes))
  if (!points) return null
  const t = affineFit(points.map(p => ({ x: p.nx, y: 1 - p.ny, lat: p.lat, lon: p.lon })))
  if (!t || ![...t.lon, ...t.lat].every(Number.isFinite)) return null
  return (x, y) => ({ lon: t.lon[0]*x + t.lon[1]*y + t.lon[2], lat: t.lat[0]*x + t.lat[1]*y + t.lat[2] })
}

function drawManuscripts(context, map) {
  const renderedCharts = []
  state.library.pdfs.forEach((file, index) => {
    if (!file.hasGeoData) return
    const geo = file.mapGeometry || (file.mapGeometry = manuscriptGeometry(file))
    if (!geo) return
    const project = (x, y) => { const p = geo(x, y); return geoToMapPixel(map, p.lat, p.lon) }
    const corners = file.chart?.boundary.length >= 3 ? file.chart.boundary.map(p=>geoToMapPixel(map,p.lat,p.lon)) : [[0,0], [1,0], [1,1], [0,1]].map(p => project(...p))
    if (Math.max(...corners.map(p => p.x)) < 0 || Math.min(...corners.map(p => p.x)) > map.width || Math.max(...corners.map(p => p.y)) < 0 || Math.min(...corners.map(p => p.y)) > map.height) return
    const color = colors[index % colors.length]
    context.save()
    if (showManuscripts && !file.mapRaster) void manuscriptRaster(file)
    if (showManuscripts && file.mapRaster) {
      renderedCharts.push(file.id)
      const { crop } = file.mapRaster
      const canvas = manuscriptImage(file)
      context.save(); context.beginPath(); corners.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y)); context.closePath(); context.clip()
      // Subdivide to follow Mercator curvature as well as rotated manuscript edges.
      const steps = 12
      for (let row = 0; row < steps; row++) for (let col = 0; col < steps; col++) {
        const x = col/steps, y = row/steps, d = 1/steps
        for (const vertices of [[[x,y],[x+d,y],[x+d,y+d]], [[x,y],[x+d,y+d],[x,y+d]]]) {
          const targets = vertices.map(p => project(...p))
          const fit = affineFit(vertices.map((p,i) => ({ x: crop.x+p[0]*crop.width, y: crop.y+p[1]*crop.height, lon: targets[i].x, lat: targets[i].y })))
          if (!fit) continue
          context.save(); context.beginPath()
          targets.forEach((p,i) => i ? context.lineTo(p.x,p.y) : context.moveTo(p.x,p.y))
          context.closePath(); context.clip()
          context.transform(fit.lon[0],fit.lat[0],fit.lon[1],fit.lat[1],fit.lon[2],fit.lat[2])
          context.drawImage(canvas,0,0); context.restore()
        }
      }
    }
    if (showManuscripts && file.mapRaster) context.restore()
    context.beginPath()
    corners.forEach((p,i) => i ? context.lineTo(p.x,p.y) : context.moveTo(p.x,p.y))
    context.closePath()
    if (showManuscripts && !file.mapRaster) { context.fillStyle = color + '22'; context.fill() }
    context.strokeStyle = color; context.lineWidth = 2; context.stroke()
    context.font = '12px sans-serif'
    const labelX = Math.max(4, Math.min(map.width - 160, corners[0].x))
    const labelY = Math.max(18, Math.min(map.height - 4, corners[0].y))
    context.fillStyle = '#ffffff'; context.fillRect(labelX-2,labelY-14,context.measureText(manuscriptName(file.name)).width+8,18)
    context.fillStyle = color; context.fillText(manuscriptName(file.name),labelX+2,labelY)
    context.restore()
  })
  pdfCanvas.dataset.rasterCharts = renderedCharts.join(',')
}

const tileCache = new Map()
let mapFrame = null
function scheduleMapDraw() {
  if (mapFrame != null) return
  mapFrame = requestAnimationFrame(() => {
    mapFrame = null
    if (state.map) drawWebMap()
  })
}

function cachedTile(url) {
  let entry = tileCache.get(url)
  if (entry) return entry.image
  const image = new Image()
  entry = { image: null, failed: false }
  tileCache.set(url, entry)
  const timeout = setTimeout(() => { image.src = ''; finish(false) }, 12000)
  function finish(ok) {
    clearTimeout(timeout)
    image.onload = image.onerror = null
    entry.image = ok ? image : null
    entry.failed = !ok
    scheduleMapDraw()
  }
  image.onload = () => finish(true)
  image.onerror = () => finish(false)
  image.src = url
  // Bound memory during long surveying sessions.
  if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value)
  return null
}

function drawWebMap() {
  const map = state.map
  const context = pdfCanvas.getContext('2d')
  context.fillStyle = '#e5ece9'
  context.fillRect(0, 0, map.width, map.height)
  let loaded = 0
  for (const tile of visibleTiles(map)) {
    const base = cachedTile(`https://tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`)
    if (!base) continue
    loaded++
    context.drawImage(base, tile.dx, tile.dy, tile.size + .5, tile.size + .5)
    if (tile.zoom >= 9) {
      const marks = cachedTile(`https://tiles.openseamap.org/seamark/${tile.zoom}/${tile.x}/${tile.y}.png`)
      if (marks) context.drawImage(marks, tile.dx, tile.dy, tile.size + .5, tile.size + .5)
    }
  }
  drawManuscripts(context, map)
  $('mapLoadStatus').classList.toggle('hidden', loaded > 0)
  drawOverlay()
}

function showMap(map) {
  state.map = map
  state.width = map.width
  state.height = map.height
  state.scale = 1
  if (pdfCanvas.width !== map.width || pdfCanvas.height !== map.height) {
    pdfCanvas.width = overlay.width = map.width
    pdfCanvas.height = overlay.height = map.height
  }
  wrap.style.width = pdfCanvas.style.width = overlay.style.width = `${map.width}px`
  wrap.style.height = pdfCanvas.style.height = overlay.style.height = `${map.height}px`
  wrap.style.margin = '0'
  wrap.style.transform = ''
  viewportElement.scrollTo(0, 0)
  $('zoomValue').textContent = `Z ${map.zoom.toFixed(1)}`
  scheduleMapDraw()
  refreshFits()
}

async function loadRoxenMap(bounds = ROXEN_BOUNDS) {
  if (!await flushAnnotationChanges()) return
  documentLoadId++; closeAnnotationEditor()
  for (const [url, entry] of tileCache) if (entry.failed) tileCache.delete(url)
  state.pdf = null
  state.pdfKey = null
  state.activePdfId = null
  state.page = { webMap: true }
  state.calibration = []
  state.transform = { type: 'web-mercator' }
  $('introPanel').classList.add('hidden')
  $('documentPanel').classList.add('hidden')
  $('calibrationPanel').classList.add('hidden')
  $('emptyState').classList.add('hidden')
  $('mapAttribution').classList.remove('hidden')
  wrap.classList.remove('hidden')
  viewportElement.classList.remove('empty')
  viewportElement.classList.add('web-map')
  showMap(fitBounds(bounds, viewportElement.clientWidth, viewportElement.clientHeight))
  renderFolder()
  renderLogs()
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  return `${(bytes / 1024 / 1024).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} MB`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

async function openFolder() {
  try {
    const folder = await window.sjomatning.openFolder()
    if (!folder) return
    await addLibraryFiles(folder.files, [{ name: folder.name, path: folder.path }])
  } catch (error) {
    console.error(error)
    toast(`Kunde inte läsa mappen: ${error.message}`)
  }
}

async function addLibraryFiles(files, folders = [], quiet = false) {
  const known = new Set([...state.library.pdfs, ...state.library.tracks].map(file => file.id))
  let duplicates = 0
  for (const folder of folders) if (!state.library.folders.some(item => item.path === folder.path)) state.library.folders.push(folder)
  for (const file of files) {
    if (known.has(file.id)) { duplicates += 1; continue }
    known.add(file.id)
    const bytes = new Uint8Array(file.bytes)
    if (/\.bsb$/i.test(file.name)) continue
    if (/\.(kap|wci)$/i.test(file.name)) {
      try { const chart = readRasterChart(bytes, file.name); state.library.pdfs.push({ ...file, chart, hasGeoData: true, size: bytes.byteLength }) }
      catch (error) { state.library.pdfs.push({ ...file, hasGeoData: false, size: bytes.byteLength, error: error.message }); toast(`${file.name}: ${error.message}`) }
    } else if (/\.pdf$/i.test(file.name)) {
      state.library.pdfs.push({ ...file, hasGeoData: Boolean(parseGeoPdf(bytes)), size: bytes.byteLength })
    } else {
      try {
        const parsed = parseTrackFile(bytes, file.originalName || file.name)
        parsed.name = file.name
        const track = { ...file, parsed, size: bytes.byteLength, loaded: false }
        state.library.tracks.push(track)
        await loadFolderTrack(track)
      } catch (error) {
        state.library.tracks.push({ ...file, parsed: null, size: bytes.byteLength, error: error.message, loaded: false })
      }
    }
  }
  renderFolder()
  renderLogs()
  scheduleMapDraw()
  if (duplicates && !quiet) toast(`${duplicates} identisk${duplicates === 1 ? ' fil' : 'a filer'} hoppades över.`)
}

const pointIndexes = new WeakMap()
function pointIndex(track, processed=false) {
  let cached=pointIndexes.get(track)
  if(!cached || cached.source!==track.points || cached.length!==track.points.length || cached.prune!==track.pruneDistance) {
    cached={source:track.points,length:track.points.length,prune:track.pruneDistance,raw:buildPointIndex(track.points)}
    pointIndexes.set(track,cached)
  }
  if(!processed || !track.pruneDistance) return cached.raw
  return cached.processed ||= buildPointIndex(processedPoints(track))
}
function visibleBounds() {
  const w=viewportElement.clientWidth,h=viewportElement.clientHeight
  const corners=[[0,0],[w,0],[w,h],[0,h]].map(([x,y])=>pixelToGeo(state.map?x:(x-manuscriptOffset.x)/state.scale,state.map?y:(y-manuscriptOffset.y)/state.scale))
  return {west:Math.min(...corners.map(p=>p.lon)),east:Math.max(...corners.map(p=>p.lon)),south:Math.min(...corners.map(p=>p.lat)),north:Math.max(...corners.map(p=>p.lat))}
}
function trackView(track) {
  if(!state.transform)return []
  const bounds=visibleBounds()
  return viewPoints(pointIndex(track,true),bounds,Math.max(1e-12,(bounds.east-bounds.west)*4/viewportElement.clientWidth),Math.max(1e-12,(bounds.north-bounds.south)*4/viewportElement.clientHeight))
}
function trackFit(track) {
  if (!state.transform || !state.page || !track?.points?.length) return null
  const inside = state.map ? null : point => {const p=geoToPixel(point.lat,point.lon);const x=p.x*state.scale+manuscriptOffset.x,y=p.y*state.scale+manuscriptOffset.y;return x>=0&&y>=0&&x<=viewportElement.clientWidth&&y<=viewportElement.clientHeight}
  return {inside:countPoints(pointIndex(track),visibleBounds(),inside),total:track.points.length}
}

function fitText(track) {
  const fit = trackFit(track)
  if (!fit) return 'Kartmatchning väntar på geodata'
  if (fit.inside === 0) return 'Utanför aktiv karta'
  return `${fit.inside.toLocaleString('sv-SE')} av ${fit.total.toLocaleString('sv-SE')} punkter ryms i kartan`
}

function renderFolder() {
  const folder = state.library
  $('folderPanel').classList.remove('hidden')
  $('folderName').textContent = 'Filer'
  $('folderCount').textContent = `${folder.pdfs.length + folder.tracks.length} filer`
  const pdfCard = (file, index) => `
    <div class="folder-file-card">
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(fileLabel(file))}</strong><span>${escapeHtml(file.chart?.type?.toUpperCase() || 'PDF')} · Område: ${escapeHtml(manuscriptName(fileLabel(file)))} · ${formatBytes(file.size)} · <i class="file-state ${file.hasGeoData ? 'geo' : ''}">${file.error ? escapeHtml(file.error) : file.hasGeoData ? (file.chart ? file.chart.type.toUpperCase() + ' · Geodata' : 'GeoPDF') : 'Utan geodata'}</i></span></div>
      <div class="file-actions"><button class="small-button" data-locate-pdf="${index}" ${file.error ? 'disabled' : ''}>Gå till plats</button><button class="small-button" data-annotate-pdf="${index}" ${file.error ? 'disabled' : ''}>Anteckna</button><button class="small-button" data-rename-pdf="${index}">Byt namn</button><button class="small-button danger" data-delete-pdf="${index}" title="Ta bort ${escapeHtml(fileLabel(file))}" aria-label="Ta bort ${escapeHtml(fileLabel(file))}">×</button></div>
    </div>`
  const pdfGroups = [
    ['Med geodata', folder.pdfs.map((file, index) => ({ file, index })).filter(item => item.file.hasGeoData)],
    ['Utan geodata', folder.pdfs.map((file, index) => ({ file, index })).filter(item => !item.file.hasGeoData)]
  ].filter(([, items]) => items.length)
  $('folderPdfList').innerHTML = pdfGroups.length ? pdfGroups.map(([title, items]) => `<div class="folder-group"><p class="folder-group-title">${title}</p>${items.map(({ file, index }) => pdfCard(file, index)).join('')}</div>`).join('') : '<p class="empty-list">Inga fältmanus hittades.</p>'
  const trackCard = (file, index) => `
    <div class="folder-file-card ${file.error ? 'invalid' : ''}">
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</strong><span>${file.parsed ? `${file.parsed.points.length.toLocaleString('sv-SE')} punkter${file.parsed.warnings.length ? ' · ' + file.parsed.warnings.length + ' importvarningar' : ''} · ${file.name.split('.').pop().toUpperCase()}<br><i class="file-state ${trackFit(file.edits || file.parsed)?.inside ? 'geo' : ''}">${fitText(file.edits || file.parsed)}</i>` : escapeHtml(file.error)}</span></div>
      <div class="file-actions"><button class="small-button" data-folder-track="${index}" ${file.error ? 'disabled' : ''}>${state.logs.some(log => log.sourceId === file.id && log.visible) ? 'Dölj' : 'Visa'}</button><button class="small-button" data-rename-track="${index}">Byt namn</button><button class="small-button danger" data-delete-track="${index}" title="Ta bort spårfil">×</button></div>
    </div>`
  const indexedTracks = folder.tracks.map((file, index) => ({ file, index, fits: (trackFit(file.edits || file.parsed)?.inside || 0) > 0 }))
  const trackGroups = state.transform && indexedTracks.some(item => item.fits)
    ? [['I aktuell karta', indexedTracks.filter(item => item.fits)], ['Övriga spår', indexedTracks.filter(item => !item.fits)]]
    : [['Mätspår', indexedTracks]]
  $('folderTrackList').innerHTML = indexedTracks.length ? trackGroups.filter(([, items]) => items.length).map(([title, items]) => `<div class="folder-group"><p class="folder-group-title">${title}</p>${items.map(({ file, index }) => trackCard(file, index)).join('')}</div>`).join('') : '<p class="empty-list">Inga mätspår hittades.</p>'

  document.querySelectorAll('[data-annotate-pdf]').forEach(button=>button.onclick=()=>openAnnotationEditor(folder.pdfs[Number(button.dataset.annotatePdf)]))
  document.querySelectorAll('[data-locate-pdf]').forEach(button => button.addEventListener('click', () => {
    const file = folder.pdfs[Number(button.dataset.locatePdf)]
    if (!file.hasGeoData) return loadPdfFile(file)
    if (file.chart) { showManuscripts = true; $('toggleManuscripts').setAttribute('aria-pressed', 'true'); $('toggleManuscripts').textContent = 'Dölj fältmanus' }
    const geo = manuscriptGeometry(file)
    if (!geo) return toast('Fältmanusets geodata kunde inte tolkas.')
    const corners = file.chart?.boundary.length >= 3 ? file.chart.boundary : [[0,0],[1,0],[1,1],[0,1]].map(p => geo(...p))
    loadRoxenMap({ north: Math.max(...corners.map(p => p.lat)), south: Math.min(...corners.map(p => p.lat)), east: Math.max(...corners.map(p => p.lon)), west: Math.min(...corners.map(p => p.lon)) })
  }))
  for (const type of ['pdf', 'track']) document.querySelectorAll(`[data-rename-${type}]`).forEach(button => button.addEventListener('click', () => renameFile(type, Number(button.getAttribute(`data-rename-${type}`)))))
  document.querySelectorAll('[data-folder-track]').forEach(button => button.addEventListener('click', () => toggleFolderTrack(Number(button.dataset.folderTrack))))
  document.querySelectorAll('[data-delete-pdf]').forEach(button => button.addEventListener('click', () => deleteLibraryFile('pdf', Number(button.dataset.deletePdf))))
  document.querySelectorAll('[data-delete-track]').forEach(button => button.addEventListener('click', () => deleteLibraryFile('track', Number(button.dataset.deleteTrack))))
}

function clearActivePdf() {
  documentLoadId++; closeAnnotationEditor()
  state.pdf = null; state.page = null; state.map = null; state.activePdfId = null; state.transform = null; state.calibration = []
  pdfCanvas.getContext('2d').clearRect(0, 0, pdfCanvas.width, pdfCanvas.height)
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height)
  wrap.classList.add('hidden'); $('documentPanel').classList.add('hidden'); $('calibrationPanel').classList.add('hidden')
  $('mapAttribution').classList.add('hidden')
  $('emptyState').classList.remove('hidden'); $('introPanel').classList.remove('hidden'); viewportElement.classList.add('empty')
  renderFolder(); renderLogs()
}

async function deleteLibraryFile(type, index) {
  const collection = type === 'pdf' ? state.library.pdfs : state.library.tracks
  const file = collection[index]
  if (!file || !window.confirm(`Ta bort ${file.name} från det sparade biblioteket?`)) return
  try {
    await window.sjomatning.removeLibraryFile(file.id)
    collection.splice(index, 1)
    if (type === 'track') state.logs = state.logs.filter(log => log.sourceId !== file.id)
    if (type === 'pdf' && state.activePdfId === file.id) clearActivePdf()
    renderFolder(); renderLogs(); drawOverlay(); scheduleMapDraw()
    $('folderPanel').classList.remove('hidden')
  } catch (error) { toast(`Kunde inte ta bort filen: ${error.message}`) }
}

async function loadFolderTrack(file) {
  if (!file.parsed) return
  const existing = state.logs.find(log => log.sourceId === file.id)
  if (existing) { file.loaded = true; return existing }
  const parsed = { ...structuredClone(file.parsed), color: colors[state.logs.length % colors.length], visible: false, folderKey: file.path, sourceId: file.id }
  parsed.original = structuredClone(file.parsed)
  state.logs.push(parsed)
  file.loaded = true
  if (file.edits) Object.assign(parsed, structuredClone(file.edits))
  else await applyAutomaticWaterLevel(parsed)
  return parsed
}

async function toggleFolderTrack(index) {
  const log = await loadFolderTrack(state.library.tracks[index])
  if (!log) return
  log.visible = !log.visible
  renderFolder(); renderLogs(); drawOverlay()
}

function updateGeoStatus() {
  const badge = $('geoBadge')
  if (state.map) {
    badge.textContent = 'Automatisk GPS-karta'
    badge.className = 'badge success'
  } else if (state.transform) {
    badge.textContent = state.transform.type === 'chart' ? 'Kalibrerat fältmanus' : state.calibration.some(p => p.automatic) ? 'GeoPDF' : 'Kalibrerat'
    badge.className = 'badge success'
  } else {
    badge.textContent = `${state.calibration.length}/2+ punkter`
    badge.className = 'badge warning'
  }
  $('clearCalibration').classList.toggle('hidden', state.calibration.length === 0)
  $('calibrationPoints').innerHTML = state.calibration.map((point, index) => `<div class="point-row"><span>Punkt ${index + 1}</span><span>${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}</span></div>`).join('')
  renderFolder()
  renderLogs()
}

function positionManuscript() {
  wrap.style.margin = '0'
  wrap.style.transform = `translate(${manuscriptOffset.x}px, ${manuscriptOffset.y}px)`
}

function setScale(scale, anchor = { x: viewportElement.clientWidth / 2, y: viewportElement.clientHeight / 2 }) {
  if (state.map) return showMap(zoomMap(state.map, state.map.zoom + Math.log2(scale)))
  const previousScale = state.scale
  state.scale = Math.max(.05, Math.min(6, scale))
  const ratio = state.scale / previousScale
  manuscriptOffset = {
    x: anchor.x - (anchor.x - manuscriptOffset.x) * ratio,
    y: anchor.y - (anchor.y - manuscriptOffset.y) * ratio
  }
  wrap.style.width = `${state.width * state.scale}px`
  wrap.style.height = `${state.height * state.scale}px`
  pdfCanvas.style.width = overlay.style.width = `${state.width * state.scale}px`
  pdfCanvas.style.height = overlay.style.height = `${state.height * state.scale}px`
  positionManuscript()
  $('zoomValue').textContent = `${Math.round(state.scale * 100)} %`
  refreshFits()
}

function centerView() {
  manuscriptOffset = {
    x: (viewportElement.clientWidth - state.width * state.scale) / 2,
    y: (viewportElement.clientHeight - state.height * state.scale) / 2
  }
  positionManuscript()
  refreshFits()
}

function fitView() {
  if (!state.page) return
  if (state.map) return showMap(fitBounds(ROXEN_BOUNDS, viewportElement.clientWidth, viewportElement.clientHeight))
  previousViewport = { width: viewportElement.clientWidth, height: viewportElement.clientHeight }
  const availableWidth = viewportElement.clientWidth - 52
  const availableHeight = viewportElement.clientHeight - 52
  state.fitScale = Math.min(availableWidth / state.width, availableHeight / state.height)
  setScale(state.fitScale)
  centerView()
}

function depthColor(depth, min, max) {
  if (!Number.isFinite(depth)) return '#657780'
  const ratio = max === min ? .5 : Math.max(0, Math.min(1, (depth - min) / (max - min)))
  const stops = [[232, 71, 56], [244, 200, 74], [72, 167, 199], [24, 59, 115]]
  const scaled = ratio * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const t = scaled - index
  const rgb = stops[index].map((value, i) => Math.round(value + (stops[index + 1][i] - value) * t))
  return `rgb(${rgb.join(',')})`
}

function drawOverlay() {
  const context = overlay.getContext('2d')
  journalMarkers=[];overlay.dataset.journalMarkers='[]'
  context.clearRect(0, 0, state.width, state.height)
  delete overlay.dataset.boatX; delete overlay.dataset.boatY

  state.calibration.forEach((point, index) => {
    context.beginPath(); context.arc(point.x, point.y, 7, 0, Math.PI * 2)
    context.fillStyle = '#fff'; context.fill(); context.lineWidth = 3; context.strokeStyle = '#176b58'; context.stroke()
    context.fillStyle = '#176b58'; context.font = 'bold 11px system-ui'; context.fillText(String(index + 1), point.x + 10, point.y - 9)
  })

  if (!state.transform) { drawManuscriptNotes(context); return }
  let min=Infinity,max=-Infinity
  const visible=state.logs.filter(log=>log.visible).sort((a,b)=>Number(a===focusedTrack)-Number(b===focusedTrack))
  for(const log of visible) { const root=pointIndex(log,true).root; if(Number.isFinite(root?.min)){min=Math.min(min,correctedDepth(log,{depth:root.min}));max=Math.max(max,correctedDepth(log,{depth:root.max}))} }
  let drawn=0
  for(const log of visible) {
    const samples=trackView(log)
    // Join adjacent source samples and nearby overview representatives, but
    // never bridge distant clusters after clipping points outside the viewport.
    context.beginPath()
    let previous = null
    for (const sample of samples) {
      const pixel = geoToPixel(sample.point.lat, sample.point.lon)
      if (!pixel) continue
      if (previous && (sample.index === previous.index + 1 || Math.hypot(pixel.x-previous.x,pixel.y-previous.y)*state.scale <= 12)) context.lineTo(pixel.x,pixel.y)
      else context.moveTo(pixel.x,pixel.y)
      previous = {...pixel,index:sample.index}
    }
    context.setLineDash(trackColors && state.logs.indexOf(log) % 2 ? [7/state.scale,4/state.scale] : []);context.strokeStyle=log.color;context.globalAlpha=focusedTrack && focusedTrack !== log ? .2 : .85;context.lineWidth=(focusedTrack === log ? 5 : 2.2)/state.scale;context.stroke();context.setLineDash([]);context.globalAlpha=1
    for(const {point} of samples) {
      const pixel=geoToPixel(point.lat,point.lon)
      if(!pixel)continue
      context.beginPath();context.arc(pixel.x,pixel.y,(focusedTrack===log?4:2.4)/state.scale,0,Math.PI*2)
      context.fillStyle=trackColors?log.color:depthColor(correctedDepth(log,point),min,max);context.fill();drawn++
    }
  }
  if (comparisonMatches) {
    context.save(); context.strokeStyle='#b000d4'; context.lineWidth=2/state.scale
    for (const pair of comparisonMatches.pairs) {
      const a=comparisonMatches.track.points[pair.index], b=comparisonMatches.reference.points[pair.referenceIndex]
      const x=geoToPixel(a.lat,a.lon), y=geoToPixel(b.lat,b.lon)
      context.beginPath();context.moveTo(x.x,x.y);context.lineTo(y.x,y.y);context.stroke()
      context.beginPath();context.arc(x.x,x.y,5/state.scale,0,Math.PI*2);context.stroke()
    }
    context.restore()
  }
  overlay.dataset.renderedPoints=String(drawn)
  if (state.live?.position && Date.now() - state.live.positionAt < 5000) {
    const pixel = geoToPixel(state.live.position.lat, state.live.position.lon)
    if (pixel) {
      overlay.dataset.boatX = String(pixel.x); overlay.dataset.boatY = String(pixel.y)
      context.save(); context.translate(pixel.x, pixel.y); context.rotate((Date.now() - state.live.speedAt < 5000 ? state.live.position.course || 0 : 0) * Math.PI / 180)
      const size = 12 / state.scale
      context.beginPath();
      if (!Number.isFinite(state.live.position.course) || Date.now() - state.live.speedAt >= 5000) context.arc(0, 0, size * .6, 0, Math.PI * 2)
      else { context.moveTo(0, -size); context.lineTo(size * .65, size); context.lineTo(0, size * .55); context.lineTo(-size * .65, size); context.closePath() }
      context.fillStyle = '#087f8c'; context.fill(); context.strokeStyle = '#fff'; context.lineWidth = 2 / state.scale; context.stroke(); context.restore()
    }
  }

  drawManuscriptNotes(context)
  drawJournalMarkers(context)
}

function correctedDepth(log, point) {
  return adjustedDepth(log, point)
}

async function applyAutomaticWaterLevel(log) {
  const sourceBeforeRequest = log.waterLevelSource
  const date = trackDate(log)
  if (!date) return false
  if (!waterLevelRequests.has(date)) waterLevelRequests.set(date, window.sjomatning.getRoxenWaterLevel(date).catch(() => null))
  const result = await waterLevelRequests.get(date)
  if (!result?.ok || log.waterLevelSource !== sourceBeforeRequest) return false
  log.waterLevel = result.data.level
  log.waterLevelSource = 'roxen'
  log.waterLevelDate = result.data.date || date
  log.correction = Math.round((result.data.level - 33) * 100) / 100
  return true
}

function renderLogs() {
  $('logsPanel').classList.toggle('hidden', !tracksPanelOpen)
  const fittingLogs = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0)
  $('toggleTracksPanel').textContent = `${state.logs.some(log => log.visible) ? 'Dölj' : 'Visa'} spår (${fittingLogs.length} spår i området · ${fittingLogs.filter(log => log.visible).length} visas · ${fittingLogs.filter(log => !log.visible).length} dolt)`
  $('toggleTracksPanel').setAttribute('aria-pressed', String(state.logs.some(log => log.visible)))
  $('openTracksPanel').setAttribute('aria-expanded', String(tracksPanelOpen))
  renderTrackLegend()
  $('applyWaterLevel').classList.toggle('hidden', !state.roxenLevel || state.logs.length === 0)
  if (state.transform) {
    const fitting = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0).length
    $('logsMapSummary').textContent = `${fitting} spår i området · ${fittingLogs.filter(log => log.visible).length} visas · ${fittingLogs.filter(log => !log.visible).length} dolt. ${state.logs.length - fitting} inlästa spår utanför området.`
  } else $('logsMapSummary').textContent = 'Aktivera geodata för att se vilka spår som ryms i kartan.'
  $('logList').innerHTML = state.logs.map((log, index) => {
    if (!fittingLogs.includes(log)) return ''
    const indexed = pointIndex(log,true)
    const visiblePoints = indexed.points
    const depthRange = Number.isFinite(indexed.root?.min) ? `${correctedDepth(log,{depth:indexed.root.min}).toFixed(2)}–${correctedDepth(log,{depth:indexed.root.max}).toFixed(2)} m` : 'Djup saknas'
    const adjustment = log.depthAdjustment ? ` · extra justering ${log.depthAdjustment > 0 ? '+' : ''}${log.depthAdjustment.toFixed(2)} m` : ''
    return `<div class="log-card" style="--log-color:${log.color}">
      <label class="log-title"><input class="log-toggle" type="checkbox" data-log="${index}" ${log.visible ? 'checked' : ''}>${escapeHtml(log.name)}</label>
      <div class="log-meta">${visiblePoints.length.toLocaleString('sv-SE')} av ${log.points.length.toLocaleString('sv-SE')} punkter · ${depthRange}<br><strong class="track-fit">${fitText(log)}</strong>${adjustment}</div>
      <div class="log-controls">
        <label>Vattennivå (m)<input type="number" step="0.01" data-water-level="${index}" value="${log.waterLevel == null ? '' : log.waterLevel.toFixed(2)}" placeholder="33.00"></label>
        <label>Djupjustering (m)<input type="number" step="0.01" data-depth-adjustment="${index}" value="${(log.depthAdjustment || 0).toFixed(2)}"></label>
        <label>Glesa, avstånd (m)<input type="number" min="0" max="500" step="1" data-prune-distance="${index}" value="${log.pruneDistance || 0}"></label>
      </div>
      <button class="small-button" data-only-log="${index}">Visa endast detta spår</button><button class="small-button" data-table-log="${index}">Info och punkttabell</button><button class="small-button" data-restore-log="${index}">Återställ original</button>

    </div>`
  }).join('')
  document.querySelectorAll('[data-log]').forEach(input => input.addEventListener('change', event => {
    state.logs[Number(event.target.dataset.log)].visible = event.target.checked
    renderFolder(); renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-only-log]').forEach(button => button.onclick = () => { state.logs.forEach((log, i) => { log.visible = i === Number(button.dataset.onlyLog) }); renderFolder(); renderLogs(); drawOverlay() })
  document.querySelectorAll('[data-table-log]').forEach(button => button.onclick = () => showTrackEditor(Number(button.dataset.tableLog)))
  document.querySelectorAll('[data-restore-log]').forEach(button => button.onclick = () => restoreTrack(Number(button.dataset.restoreLog)))
  document.querySelectorAll('[data-water-level]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.waterLevel)]
    const level = Number(event.target.value)
    log.waterLevel = event.target.value === '' || !Number.isFinite(level) ? null : level
    log.waterLevelSource = 'manual'
    log.waterLevelDate = null
    log.correction = log.waterLevel == null ? null : Math.round((log.waterLevel - 33) * 100) / 100
    saveTrack(log); renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-depth-adjustment]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.depthAdjustment)]
    log.depthAdjustment = Number(event.target.value) || 0
    saveTrack(log); renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-prune-distance]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.pruneDistance)]
    log.pruneDistance = Math.max(0, Number(event.target.value) || 0)
    saveTrack(log); renderLogs(); drawOverlay()
  }))

}

async function exportVisibleTracks(format) {
  const tracks = state.logs.filter(log => log.visible)
  if (!tracks.length) return toast('Välj minst ett synligt spår att exportera.')
  const content = format === 'txt' ? exportWaypoints(tracks) : exportCsv(tracks)
  const path = await window.sjomatning.exportTracks({
    format,
    content,
    suggestedName: `matspår-bearbetade.${format}`
  })
  if (path) toast(`Exporterade ${tracks.length} spår.`)
}

let waterRequest = 0
async function loadWaterLevel(latest = false) {
  const date = latest === true ? null : $('waterLevelDate').value
  const request = ++waterRequest
  $('waterSummary').textContent = 'Hämtar…'
  $('waterLevelStatus').textContent = 'Kontaktar Tekniska verken…'
  $('applyWaterLevel').classList.add('hidden')
  try {
    const result = await window.sjomatning.getRoxenWaterLevel(date)
    if (request !== waterRequest) return
    if (!result.ok) {
      $('waterSummary').textContent = 'Värde saknas'
      state.roxenLevel = null
      $('waterLevelStatus').textContent = result.message
      return
    }
    state.roxenLevel = result.data
    $('waterLevelDate').value = result.data.date
    const formattedDate = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' }).format(new Date(`${result.data.date}T12:00:00`))
    $('waterLevelStatus').innerHTML = `<strong>${result.data.level.toFixed(2)} m ö.h.</strong><span>${formattedDate} · RH00<br>Hydrographica: ${(result.data.level - 33).toFixed(2)} m relativt referensnivån 33,00 m RH00</span>`
    $('waterSummary').textContent = `${result.data.level.toFixed(2)} m RH00`
    $('applyWaterLevel').classList.toggle('hidden', state.logs.length === 0)
  } catch (error) {
    if (request !== waterRequest) return
    $('waterSummary').textContent = 'Kunde inte hämtas'
    state.roxenLevel = null
    $('waterLevelStatus').textContent = 'Vattenståndet kunde inte hämtas. Kontrollera internetanslutningen och försök igen.'
    console.error(error)
  }
}

function applyWaterLevel() {
  if (!state.roxenLevel || state.logs.length === 0) return
  state.logs.forEach(log => {
    log.waterLevel = state.roxenLevel.level
    log.waterLevelSource = 'roxen'
    log.waterLevelDate = state.roxenLevel.date
    log.correction = Math.round((state.roxenLevel.level - 33) * 100) / 100
    saveTrack(log)
  })
  renderLogs()
  drawOverlay()
  toast(`Vattenstånd ${state.roxenLevel.level.toFixed(2)} m används för ${state.logs.length} körning${state.logs.length === 1 ? '' : 'ar'}.`)
}

function canvasPoint(event) {
  const rect = overlay.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / state.scale, y: (event.clientY - rect.top) / state.scale }
}

overlay.addEventListener('click', async event => {
  if (annotationEditor.file) {
    if (event.detail > 1 || annotationEditor.saving || annotationEditor.loading) return
    const point = canvasPoint(event)
    if (annotationEditor.placing) { void placeManuscriptNote(point); return }
    const note = noteAtPoint(point)
    if (note) { if(!await flushAnnotationChanges())return; selectNote(note); annotationEditor.placing=true; annotationEditor.preview=point; updateAnnotationControls(); drawOverlay(); return }
  }
  if (!state.armed) {
    const clicked = canvasPoint(event)
    let nearest = null
    state.logs.forEach((log, logIndex) => {
      if (!log.visible) return
      trackView(log).forEach(({point}) => {
        const pixel = geoToPixel(point.lat, point.lon)
        const distance = pixel ? Math.hypot(pixel.x - clicked.x, pixel.y - clicked.y) * state.scale : Infinity
        if (distance <= 16 && (!nearest || distance < nearest.distance)) nearest = { logIndex, pointIndex: log.points.indexOf(point), distance }
      })
    })
    if (nearest) showTrackEditor(nearest.logIndex, Math.floor(nearest.pointIndex / 100))
    return
  }
  if (!state.armed) return
  const lat = Number($('calLat').value)
  const lon = Number($('calLon').value)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return toast('Ange både latitud och longitud.')
  state.calibration.push({ ...canvasPoint(event), lat, lon })
  state.transform = calibrationTransform(state.calibration)
  saveCalibration()
  state.armed = false
  $('armCalibration').classList.remove('armed')
  $('armCalibration').textContent = 'Placera referenspunkt'
  updateGeoStatus(); drawOverlay()
  if (state.transform) toast('Kalibreringen är aktiv. Mätspåren kan nu placeras på kartan.')
})

overlay.addEventListener('mousemove', event => {
  if (annotationEditor.file && annotationEditor.placing) { annotationEditor.preview=canvasPoint(event); $('tooltip').classList.add('hidden'); drawOverlay(); return }
  if (viewportElement.classList.contains('panning')) return
  if (!state.transform) return
  const point = canvasPoint(event)
  const geo = pixelToGeo(point.x, point.y)
  $('cursorPosition').textContent = `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`
  let nearest = null
  state.logs.filter(log => log.visible).forEach(log => {
    for (const {point: sample} of trackView(log)) {
      const pixel=geoToPixel(sample.lat,sample.lon)
      const distance=pixel?Math.hypot(pixel.x-point.x,pixel.y-point.y)*state.scale:Infinity
      if(distance<10&&(!nearest||distance<nearest.distance))nearest={log,point:sample,distance}
    }
  })
  if (nearest) {
    $('tooltip').innerHTML = `<strong>${escapeHtml(shortTrackName(nearest.log.name))}</strong><br>${Number.isFinite(nearest.point.depth) ? correctedDepth(nearest.log, nearest.point).toFixed(2) + ' m' : 'Djup saknas'}<br>${escapeHtml([nearest.point.date, nearest.point.time].filter(Boolean).join(' '))}<br>Lat: ${formatCoordinate(nearest.point, 'lat')} · Long: ${formatCoordinate(nearest.point, 'lon')}${Number.isFinite(nearest.point.speed) && nearest.point.speed.toFixed(1) !== '0.0' ? '<br>' + nearest.point.speed.toFixed(1) + ' knop' : ''}`
    $('tooltip').style.left = `${event.clientX + 14}px`; $('tooltip').style.top = `${event.clientY + 14}px`
    $('tooltip').classList.remove('hidden')
  } else $('tooltip').classList.add('hidden')
})

overlay.addEventListener('mouseleave', () => { $('tooltip').classList.add('hidden'); annotationEditor.preview=null; if(annotationEditor.placing)drawOverlay() })
overlay.addEventListener('dblclick',async event=>{
  if(!annotationEditor.file)return
  const note=noteAtPoint(canvasPoint(event))
  if(note){if(!await flushAnnotationChanges())return;selectNote(note);annotationEditor.placing=false;annotationEditor.preview=null;updateAnnotationControls();drawOverlay();$('annotationText').focus();$('annotationText').select()}
})
$('armCalibration').addEventListener('click', () => {
  if (!state.page) return
  state.armed = !state.armed
  $('armCalibration').classList.toggle('armed', state.armed)
  $('armCalibration').textContent = state.armed ? 'Klicka nu i kartan…' : 'Placera referenspunkt'
})
$('clearCalibration').addEventListener('click', () => {
  state.calibration = []; state.transform = null
  if (state.pdfKey) {
    localStorage.removeItem(`calibration:${state.pdfKey}`)
    if (window.sjomatning.saveCalibration) void window.sjomatning.saveCalibration(`calibration:${state.pdfKey}`, []).catch(error => toast(error.message))
  }
  updateGeoStatus(); drawOverlay()
})

$('toggleManuscripts').addEventListener('click', async () => {
  showManuscripts = !showManuscripts
  $('toggleManuscripts').setAttribute('aria-pressed', String(showManuscripts))
  $('toggleManuscripts').textContent = showManuscripts ? 'Dölj fältmanus' : 'Visa fältmanus'
  if (!state.map) await loadRoxenMap()
  scheduleMapDraw()
})
$('showSweden').addEventListener('click', () => loadRoxenMap(SWEDEN_BOUNDS))

$('waterLevelDate').addEventListener('change', () => loadWaterLevel())
$('applyWaterLevel').addEventListener('click', applyWaterLevel)
$('exportCsv').addEventListener('click', () => exportVisibleTracks('csv'))
$('exportWaypoints').addEventListener('click', () => exportVisibleTracks('txt'))
$('toggleLibrary').addEventListener('click', () => {
  const content = $('libraryContent')
  const collapsed = !content.classList.contains('hidden')
  content.classList.toggle('hidden', collapsed)
  $('toggleLibrary').textContent = collapsed ? 'Visa' : 'Dölj'
  $('toggleLibrary').setAttribute('aria-expanded', String(!collapsed))
})
$('zoomIn').addEventListener('click', () => setScale(state.scale * 1.2))
$('zoomOut').addEventListener('click', () => setScale(state.scale / 1.2))
$('fitView').addEventListener('click', fitView)
function setSidebarHidden(hidden) {
  document.querySelector('.layout').classList.toggle('sidebar-hidden', hidden)
  $('toggleSidebar').textContent = hidden ? 'Visa meny' : 'Dölj meny'
  $('toggleSidebar').setAttribute('aria-expanded', String(!hidden))
  localStorage.setItem('sidebar:hidden', String(hidden))
}
$('toggleSidebar').addEventListener('click', () => {
  setSidebarHidden(!document.querySelector('.layout').classList.contains('sidebar-hidden'))
})
setSidebarHidden(localStorage.getItem('sidebar:hidden') === 'true')

let previousViewport = { width: viewportElement.clientWidth, height: viewportElement.clientHeight }
new ResizeObserver(() => {
  const width = viewportElement.clientWidth, height = viewportElement.clientHeight
  const previous = previousViewport
  previousViewport = { width, height }
  if (!state.page || (width === previous.width && height === previous.height)) return
  if (state.map) return showMap(viewportMap(mapPixelToGeo(state.map, state.width / 2, state.height / 2), state.map.zoom, width, height))
  manuscriptOffset.x += (width - previous.width) / 2
  manuscriptOffset.y += (height - previous.height) / 2
  positionManuscript()
  refreshFits()
}).observe(viewportElement)

viewportElement.addEventListener('wheel', event => {
  if (event.target.closest('.panel, .track-legend')) return
  if (!state.page) return
  event.preventDefault()
  const point = canvasPoint(event)
  if (state.map) {
    showMap(zoomMap(state.map, state.map.zoom - event.deltaY * .002, point.x, point.y))
    return
  }
  const rect = viewportElement.getBoundingClientRect()
  setScale(state.scale * Math.exp(-event.deltaY * .0015), { x: event.clientX - rect.left, y: event.clientY - rect.top })
}, { passive: false })

let pan = null
let suppressClick = false
viewportElement.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !state.page) return
  if (event.target.closest('a, button, input, select, .panel, .track-legend')) return
  suppressClick = false
  pan = { offset: { ...manuscriptOffset }, map: state.map, pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: viewportElement.scrollLeft, scrollTop: viewportElement.scrollTop, moved: false }
  // Capture only after dragging starts so ordinary canvas clicks keep their target.
})
viewportElement.addEventListener('pointermove', event => {
  if (!pan || event.pointerId !== pan.pointerId) return
  if (!pan.moved && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 4) return
  if (!pan.moved) {
    pan.moved = true
    state.followBoat = false
    $('followBoat').textContent = 'Följ båt'
    viewportElement.setPointerCapture(event.pointerId)
    viewportElement.classList.add('panning')
    $('tooltip').classList.add('hidden')
  }
  event.preventDefault()
  if (pan.map) return showMap(panMap(pan.map, event.clientX - pan.x, event.clientY - pan.y))
  manuscriptOffset = { x: pan.offset.x + event.clientX - pan.x, y: pan.offset.y + event.clientY - pan.y }
  positionManuscript()
  refreshFits()
})
function stopPanning(event) {
  if (!pan || event.pointerId !== pan.pointerId) return
  suppressClick = pan.moved && event.type === 'pointerup'
  pan = null
  viewportElement.classList.remove('panning')
}
viewportElement.addEventListener('pointerup', stopPanning)
viewportElement.addEventListener('pointercancel', stopPanning)
viewportElement.addEventListener('lostpointercapture', stopPanning)
viewportElement.addEventListener('click', event => {
  if (!suppressClick) return
  suppressClick = false
  event.preventDefault()
  event.stopPropagation()
}, true)

let dragDepth = 0
window.addEventListener('dragenter', event => {
  event.preventDefault()
  dragDepth += 1
  viewportElement.classList.add('dragging')
  $('dropOverlay').classList.remove('hidden')
})
window.addEventListener('dragover', event => event.preventDefault())
window.addEventListener('dragleave', event => {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) {
    viewportElement.classList.remove('dragging')
    $('dropOverlay').classList.add('hidden')
  }
})
window.addEventListener('drop', async event => {
  event.preventDefault()
  dragDepth = 0
  viewportElement.classList.remove('dragging')
  $('dropOverlay').classList.add('hidden')
  const entries = [...event.dataTransfer.files]
  try {
    const scanned = await window.sjomatning.scanDroppedEntries(entries)
    if (!scanned.files.length) return toast('Mappen innehåller inga PDF-, TXT-, CSV-, TRC-, SL2- eller SL3-filer.')
    await addLibraryFiles(scanned.files, scanned.folders.map(folder => ({ name: folder.name, path: folder.path })))
  } catch (error) {
    console.error(error)
    toast(`Kunde inte läsa det som släpptes: ${error.message}`)
  }
})

window.sjomatning.launchPdf().then(file => {
  if (file) loadPdfFile(file)
})

void loadWaterLevel(true)

window.sjomatning.listLibrary().then(files => addLibraryFiles(files, [], true)).catch(error => toast(`Kunde inte läsa biblioteket: ${error.message}`))

loadRoxenMap().catch(error => {
  console.error(error)
  toast(`Kunde inte ladda Roxenkartan: ${error.message}`)
})

window.sjomatning.getAppInfo().then(({ version, buildDate }) => {
  const title = `Sjömätning v${version} - ${buildDate}`
  document.title = title
  $('buildInfo').textContent = `v${version} - ${buildDate}`
})

let updateBarTimer
window.sjomatning.onUpdaterStatus(({ status, detail }) => {
  clearTimeout(updateBarTimer)
  const messages = {
    checking: 'Söker efter uppdateringar…', current: 'Programmet är uppdaterat.',
    available: `Version ${detail} hittades och hämtas…`, downloading: `Hämtar uppdatering: ${detail} %`,
    ready: `Version ${detail} är klar att installeras.`, error: `Uppdateringskontrollen misslyckades: ${detail}`
  }
  $('updateText').textContent = messages[status] || ''
  $('updateBar').classList.toggle('hidden', !messages[status])
  $('installUpdate').classList.toggle('hidden', status !== 'ready')
  if (status === 'current') {
    updateBarTimer = setTimeout(() => $('updateBar').classList.add('hidden'), 3500)
  }
})
$('installUpdate').addEventListener('click', () => window.sjomatning.installUpdate())

function nmeaTime(value) {
  const digits = String(value || '')
  return /^\d{6}(\.\d+)?$/.test(digits) ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}` : new Date().toLocaleTimeString('sv-SE')
}

function today() { return new Date().toLocaleDateString('sv-SE') }

async function startCapture() {
  if (state.live || captureStarting) return
  if (!navigator.serial) return toast('Seriell USB stöds inte i den här programversionen.')
  captureStarting = true
  $('startSimulator').disabled = $('startCapture').disabled = true
  let port
  try {
    port = await navigator.serial.requestPort()
    await port.open({ baudRate: Number($('baudRate').value) })
    state.followBoat = true
    $('followBoat').textContent = 'Följer båt'
    state.live = { port, session: null, log: null, position: null, depth: null, cancelled: false }
    $('liveBadge').textContent = 'Ansluten'; $('liveBadge').className = 'badge success'
    $('startSimulator').classList.add('hidden'); $('startCapture').classList.add('hidden')
    $('startMeasurement').classList.remove('hidden'); $('disconnectCapture').classList.remove('hidden')
    $('livePath').textContent = 'Ansluten. Starta mätning för att spara data.'
    renderLogs()
    state.live.readTask = readSerialStream()
    state.live.readTask.catch(error => { console.error(error); toast(`USB-anslutningen avbröts: ${error.message}`); stopCapture() })
  } catch (error) {
    if (port?.readable || port?.writable) await port.close().catch(() => {})
    if (error.name !== 'NotFoundError') toast(`Kunde inte starta mätningen: ${error.message}`)
  } finally { captureStarting = false; $('startSimulator').disabled = $('startCapture').disabled = false }
}

async function readSerialStream() {
  const live = state.live
  const decoder = new TextDecoderStream()
  const closed = live.port.readable.pipeTo(decoder.writable).catch(() => {})
  const reader = decoder.readable.getReader()
  live.reader = reader
  let buffer = ''
  try {
    while (!live.cancelled) {
      const { value, done } = await reader.read()
      if (done) {
        if (buffer.trim()) await receiveNmea(live, buffer)
        if (!live.cancelled) { toast('Dataströmmen avslutades. Anslut igen för att fortsätta.'); setTimeout(() => void stopCapture(), 0) }
        break
      }
      buffer += value
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''
      for (const raw of lines) {
        await receiveNmea(live, raw)
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
    await closed
  }
}

async function receiveNmea(live, raw) {
  if (live.cancelled) return
  const parsed = parseNmeaSentence(raw)
  if (parsed?.type === 'position' && 'speed' in parsed) live.speedAt = Date.now()
  if (parsed?.type === 'position') { live.position = { ...live.position, ...parsed }; live.positionAt = Date.now() }
  if (parsed?.type === 'gps-invalid') { live.position = null; live.positionAt = 0; live.speedAt = 0 }
  if (parsed?.type === 'depth-invalid') { live.depth = null; live.depthAt = 0 }
  if (parsed?.type === 'depth') { live.depth = parsed.depth + (Number($('liveDepthOffset').value) || 0); live.depthAt = Date.now() }
  let point = null
  if (live.session && parsed?.type === 'position' && live.position) {
    point = { date: live.position.date || today(), time: nmeaTime(live.position.time), lat: live.position.lat, lon: live.position.lon, speed: Date.now() - live.speedAt < 5000 ? live.position.speed : null, depth: Number.isFinite(live.depth) && Date.now() - live.depthAt < 5000 ? live.depth : null }
  }
  if (live.session) {
    live.write = window.sjomatning.appendLiveData({ id: live.session.id, raw, point })
    try { await live.write } catch (error) { live.failure = error; throw error }
  }
  if (point) { live.log.points.push(point); renderLogs() }
  followBoat(); drawOverlay()
  updateMapReadout()
}

$('followBoat').onclick = () => { state.followBoat = true; followBoat(); $('followBoat').textContent = 'Följer båt' }
function followBoat() {
  const live = state.live
  if (!state.followBoat || !live?.position || Date.now() - live.positionAt >= 5000) return
  const pixel = geoToPixel(live.position.lat, live.position.lon)
  if (!pixel) return
  if (state.map) showMap(panMap(state.map, state.map.width / 2 - pixel.x, state.map.height / 2 - pixel.y))
  else {
    manuscriptOffset.x = viewportElement.clientWidth / 2 - pixel.x * state.scale
    manuscriptOffset.y = viewportElement.clientHeight / 2 - pixel.y * state.scale
    positionManuscript()
  }
}
let captureStarting = false
async function startSimulator() {
  if (state.live || captureStarting) return
  captureStarting = true
  $('startSimulator').disabled = $('startCapture').disabled = true
  try {
    const factor = Number($('simulationSpeed').value)
    const session = await window.sjomatning.startLiveSession({ name: 'SIMULERAD-Roxen', simulated: true, timeFactor: factor })
    const log = { name: `SIMULERAD Roxen ${new Date().toLocaleTimeString('sv-SE')}`, date: today(), points: [], warnings: [], color: colors[state.logs.length % colors.length], visible: true, depthAdjustment: 0, pruneDistance: 0, waterLevel: null, correction: null }
    const live = { session, log, position: null, depth: null, cancelled: false, simulated: true }
    state.followBoat = true
    $('followBoat').textContent = 'Följer båt'
    state.live = live
    state.logs.push(log)
    $('liveBadge').textContent = 'Simulerar'; $('liveBadge').className = 'badge success'
    $('startSimulator').classList.add('hidden'); $('startCapture').classList.add('hidden'); $('stopCapture').classList.remove('hidden')
    $('simulationSpeed').disabled = true
    $('livePath').textContent = `Simulerade data sparas i ${session.folder}`
    void loadRoxenMap({ north: 58.54, south: 58.475, west: 15.54, east: 15.72 }, 13).catch(error => toast(error.message))
    const epoch = new Date()
    const started = performance.now()
    const tick = async () => {
      if (live.cancelled) return
      try {
        const seconds = (performance.now() - started) / 1000 * factor
        const frame = simulationFrame(seconds, epoch)
        for (const raw of frame.sentences) if (!$('simulationGpsOnly').checked || !raw.includes('DPT')) await receiveNmea(live, raw)
        renderLogs(); drawOverlay()
        if (!live.cancelled) live.timer = setTimeout(() => { live.pending = tick() }, 1000)
      } catch (error) {
        toast(`Simulatorn stoppades: ${error.message}`)
        setTimeout(() => { if (state.live === live) void stopCapture() }, 0)
      }
    }
    live.pending = tick()
  } catch (error) { toast(`Kunde inte starta simulatorn: ${error.message}`) }
  finally { captureStarting = false; $('startSimulator').disabled = $('startCapture').disabled = false }
}

async function stopCapture() {
  const live = state.live
  if (!live) return
  state.live = null; live.cancelled = true
  updateMapReadout()
  clearTimeout(live.timer)
  await live.pending
  await live.reader?.cancel().catch(() => {})
  await live.readTask?.catch(() => {})
  await live.starting?.catch(() => {})
  await live.port?.close().catch(() => {})
  await finishMeasurement(live)
  $('startMeasurement').classList.add('hidden'); $('disconnectCapture').classList.add('hidden')
  $('liveBadge').textContent = live.failure ? 'Skrivfel – mätningen stoppad' : 'Frånkopplad'; $('liveBadge').className = 'badge warning'
  updateMapReadout()
  $('simulationSpeed').disabled = false; $('startSimulator').classList.remove('hidden'); $('startCapture').classList.remove('hidden'); $('stopCapture').classList.add('hidden')
  renderLogs(); drawOverlay(); toast(live.failure ? `Skrivfel: ${live.failure.message}. Kontrollera mätmappen: ${$('livePath').textContent}` : `Mätningen stoppades. ${live.log?.points.length || 0} punkter sparades i realtid.`)
}

async function startMeasurement() {
  const live = state.live
  if (!live || live.session || live.changing) return
  live.changing = true
  try {
    live.starting = window.sjomatning.startLiveSession({ baudRate: Number($('baudRate').value), depthOffset: Number($('liveDepthOffset').value) || 0 })
    live.session = await live.starting
    live.log = { name: `Live ${new Date().toLocaleString('sv-SE')}`, date: today(), points: [], warnings: [], color: colors[state.logs.length % colors.length], visible: true, depthAdjustment: 0, pruneDistance: 0, waterLevel: null, correction: null }
    state.logs.push(live.log)
    if (live.cancelled) return
    $('liveBadge').textContent = 'Loggar'
    $('livePath').textContent = `Sparas i ${live.session.folder}`
    $('startMeasurement').classList.add('hidden'); $('stopCapture').classList.remove('hidden')
    renderLogs()
  } catch(error) { toast(error.message) }
  finally { live.changing = false }
}
async function finishMeasurement(live) {
  const session = live.session
  if (!session) return
  live.session = null
  try {
    await live.write?.catch(error => toast(`Kunde inte skriva mätdata: ${error.message}`))
    const file = await window.sjomatning.stopLiveSession(session.id)
    if (file?.id && live.log.points.length) {
      live.log.sourceId = file.id
      await addLibraryFiles([file], [], true)
      live.log.original = structuredClone(state.library.tracks.find(item => item.id === file.id).parsed)
      saveTrack(live.log)
    }
  } catch (error) { toast(`Spåret finns i mätmappen men kunde inte läggas i biblioteket: ${error.message}`) }
}
async function stopMeasurement() {
  const live = state.live
  if (!live || live.changing) return
  if (live.simulated) return stopCapture()
  live.changing = true
  try {
    await finishMeasurement(live)
    $('liveBadge').textContent = 'Ansluten'
    $('livePath').textContent = 'Spåret sparat. Anslutningen är kvar.'
    $('startMeasurement').classList.remove('hidden'); $('stopCapture').classList.add('hidden')
    renderLogs(); drawOverlay()
  } finally { live.changing = false }
}
$('startMeasurement').addEventListener('click', startMeasurement)
$('disconnectCapture').addEventListener('click', () => { if (!state.live?.changing) void stopCapture() })

$('startCapture').addEventListener('click', startCapture)
$('stopCapture').addEventListener('click', stopMeasurement)

$('startSimulator').addEventListener('click', startSimulator)

async function renameFile(type, index) {
  const file = (type === 'pdf' ? state.library.pdfs : state.library.tracks)[index]
  $('editorContent').innerHTML = `<h2>Byt namn</h2><form id="renameForm"><label>Filnamn<input id="newFileName" required maxlength="240" value="${escapeHtml(file.name)}"></label><button class="button">Spara namn</button><p id="renameError" role="alert"></p></form>`
  $('editorDialog').showModal()
  $('renameForm').onsubmit = async event => {
    event.preventDefault()
    try {
      const record = await window.sjomatning.updateLibraryFile(file.id, { name: $('newFileName').value })
      file.originalName = record.originalName
      file.name = record.name
      if (file.parsed) file.parsed.name = record.name
      state.logs.filter(log => log.sourceId === file.id).forEach(log => { log.name = record.name })
      if (state.activePdfId === file.id) $('documentName').textContent = record.name
      renderFolder(); renderLogs(); $('editorDialog').close()
    } catch (error) { $('renameError').textContent = error.message }
  }
}

function saveTrack(log) {
  pointIndexes.delete(log)
  if (!log.sourceId) return
  const edits = structuredClone({ points: log.points, waterLevel: log.waterLevel, waterLevelSource: log.waterLevelSource, waterLevelDate: log.waterLevelDate, correction: log.correction, depthAdjustment: log.depthAdjustment || 0, pruneDistance: log.pruneDistance || 0 })
  const file = state.library.tracks.find(file => file.id === log.sourceId)
  if (file) file.edits = edits
  const write = window.sjomatning.updateLibraryFile(log.sourceId, { edits })
  pendingLibraryWrites.add(write)
  void write.then(() => pendingLibraryWrites.delete(write), error => { pendingLibraryWrites.delete(write); toast(`Ändringen kunde inte sparas: ${error.message}`) })
  refreshFits()
}

async function restoreTrack(index) {
  const log = state.logs[index]
  const file = state.library.tracks.find(file => file.id === log.sourceId)
  const original = log.original || file?.parsed
  if (!original) return toast('Stoppa mätningen innan du återställer spåret.')
  if (!window.confirm(`Återställ alla punkter och justeringar i ${log.name} från originalfilen?`)) return
  try {
    await window.sjomatning.updateLibraryFile(log.sourceId, { edits: null })
    Object.assign(log, structuredClone(original), { name: file.name, waterLevelSource: 'filename', waterLevelDate: null, depthAdjustment: 0, pruneDistance: 0 })
    file.edits = null
    renderLogs(); renderFolder(); drawOverlay()
  } catch (error) { toast(`Kunde inte återställa: ${error.message}`) }
}

function showTrackEditor(index, page = 0) {
  const log = state.logs[index]
  const start = page * 100
  const editable = Boolean(log.sourceId)
  $('editorContent').innerHTML = `<h2>${escapeHtml(log.name)}</h2><p>${log.points.length} punkter. ${fitText(log)}. Djup korrigeras till Hydrographicas referensnivå 33,00 m RH00.</p>
    <label>Justera hela spårets djup (m)<input id="tableAdjustment" type="number" step="0.01" value="${log.depthAdjustment || 0}" ${editable ? '' : 'disabled'}></label>
    <p>${escapeHtml(depthExplanation(log))}</p><p>${editable ? 'Ändra rådjup eller koordinater direkt i tabellen. Originalfilen finns kvar och kan återställas.' : 'Pågående livespår: stoppa mätningen för att spara i biblioteket och redigera punkter.'}</p>
    <table><thead><tr><th>Punkt / tid</th><th>Latitud</th><th>Longitud</th><th>Rådjup (m)</th><th>Justerat (m)</th><th></th></tr></thead><tbody>${log.points.slice(start, start + 100).map((point, n) => `<tr><td>${start + n + 1}<br>${escapeHtml(point.date)} ${escapeHtml(point.time)}</td>${['lat','lon','depth'].map(field => `<td><input aria-label="${field} punkt ${start + n + 1}" type="number" step="${field === 'depth' ? '0.01' : '0.000001'}" value="${field === 'depth' ? point[field] ?? '' : formatCoordinate(point, field)}" data-point="${start + n}" data-field="${field}" ${editable ? '' : 'disabled'}></td>`).join('')}<td>${decimal(correctedDepth(log, point))}</td><td><button class="small-button" data-remove-point="${start + n}" ${editable ? '' : 'disabled'}>Ta bort</button></td></tr>`).join('')}</tbody></table>
    <button id="previousPoints" class="small-button" ${page === 0 ? 'disabled' : ''}>Föregående</button> <span>Sida ${page + 1} av ${Math.max(1, Math.ceil(log.points.length / 100))}</span> <button id="nextPoints" class="small-button" ${start + 100 >= log.points.length ? 'disabled' : ''}>Nästa</button>`
  if (!$('editorDialog').open) $('editorDialog').showModal()
  if (comparison) { $('editorContent').insertAdjacentHTML('afterbegin', '<button id="backComparison" class="small-button">Tillbaka till jämförelsen</button>'); $('backComparison').onclick = () => showComparison(true) }
  const refresh = () => { saveTrack(log); renderLogs(); drawOverlay(); showTrackEditor(index, Math.min(page, Math.max(0, Math.ceil(log.points.length / 100) - 1))) }
  $('tableAdjustment').onchange = event => {
    if (!event.target.value || !Number.isFinite(Number(event.target.value))) return
    log.depthAdjustment = Number(event.target.value); refresh()
  }
  $('editorContent').querySelectorAll('[data-point]').forEach(input => input.onchange = () => {
    const value = Number(input.value), field = input.dataset.field
    const valid = input.value.trim() && Number.isFinite(value) && (field === 'depth' ? value >= 0 : Math.abs(value) <= (field === 'lat' ? 90 : 180))
    if (!valid) { input.setCustomValidity('Ange ett giltigt värde.'); input.reportValidity(); return }
    input.setCustomValidity(''); log.points[Number(input.dataset.point)][field] = value; refresh()
  })
  $('editorContent').querySelectorAll('[data-remove-point]').forEach(button => button.onclick = () => { log.points.splice(Number(button.dataset.removePoint), 1); refresh() })
  $('previousPoints').onclick = () => showTrackEditor(index, page - 1)
  $('nextPoints').onclick = () => showTrackEditor(index, page + 1)
}

function showComparison(resume = false) {
  if (resume !== true || !comparison) comparison = {scope:'viewport', selected:state.logs.filter(log => log.visible && trackFit(log)?.inside > 0), radius:10, reference:null, scroll:0, resultsScroll:0, bounds: state.transform ? visibleBounds() : null}
  const c = comparison
  const inView = point => {
    if (!c.bounds) return false
    const pixel = geoToPixel(point.lat, point.lon)
    if (!pixel) return false
    if (state.map) return point.lon>=c.bounds.west && point.lon<=c.bounds.east && point.lat>=c.bounds.south && point.lat<=c.bounds.north
    const x=pixel.x*state.scale+manuscriptOffset.x,y=pixel.y*state.scale+manuscriptOffset.y
    return x>=0 && y>=0 && x<=viewportElement.clientWidth && y<=viewportElement.clientHeight
  }
  const tracks = state.logs.filter(log => c.scope === 'selected' ? c.selected.includes(log) : log.visible && (c.scope !== 'viewport' || log.points.some(inView)))
  const scoped = log => ({...log, points:c.scope === 'viewport' ? log.points.filter(inView) : log.points})
  if (!tracks.includes(c.reference)) c.reference = tracks[0]
  const groups = new Map()
  for (const log of state.logs) { const key=(log.name || '').replace(/\.[^.]+$/, '').toLowerCase(); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(log) }
  $('editorContent').innerHTML = `<div class="comparison-heading"><h2>Jämför spår</h2><label>Omfattning<select id="comparisonScope"><option value="viewport">Aktuellt kartutsnitt</option><option value="all">Alla påslagna spår</option><option value="selected">Valda spår</option></select></label><p>${tracks.length} spår · ${c.scope === 'viewport' ? 'Bara punkter i aktuellt kartutsnitt' : 'Hela spåren'}.</p><label>Referensspår<select id="referenceTrack">${[...tracks].sort((a,b)=>(a.name || '').localeCompare(b.name || '', 'sv')).map(log=>`<option value="${tracks.indexOf(log)}" title="${escapeHtml(log.name)}">${escapeHtml(trackLabel(log))}${(groups.get((log.name || '').replace(/\.[^.]+$/, '').toLowerCase())?.length || 0)>1 ? ' · Möjlig filvariant' : ''} — ${escapeHtml(log.name)}</option>`).join('')}</select></label></div>
    ${c.scope === 'selected' ? `<fieldset><legend>Välj spår (även dolda kan väljas)</legend>${[...groups.values()].map(group=>`<div>${group.length>1?'<strong>Möjliga filvarianter; inte verifierade dubbletter</strong>':''}${group.map(log=>`<label title="${escapeHtml(log.name)}"><input type="checkbox" data-comparison-select="${state.logs.indexOf(log)}" ${c.selected.includes(log)?'checked':''}>${escapeHtml(trackLabel(log))} — ${escapeHtml(log.name)}</label>`).join('')}</div>`).join('')}</fieldset>` : ''}
    <label>Maxavstånd mellan punkter (m)<input id="comparisonRadius" type="number" min="1" max="100" value="${c.radius}"></label>
    <p>10 m är en sökradie, inte ett kvalitetsmått. Välj avstånd efter positionernas noggrannhet och bottenlutningen. Närmaste referenspunkt används och kan återanvändas. Jämförelsen använder aktuella vattenstånds- och djupjusteringar före gallring. Positiv skillnad betyder djupare än referensen. Median är mittenvärdet; intervallet P10–P90 omfattar de mittersta cirka 80 procenten. Körväg, botten och utrustning kan påverka resultatet.</p>
    <p>${c.reference ? escapeHtml('Referens: '+depthExplanation(c.reference)) : 'Välj minst två spår.'}</p><div id="comparisonResults"></div>`
  $('comparisonScope').value=c.scope
  $('referenceTrack').value=String(tracks.indexOf(c.reference))
  $('comparisonScope').onchange=event=>{c.scope=event.target.value;c.scroll=0;showComparison(true)}
  document.querySelectorAll('[data-comparison-select]').forEach(input=>input.onchange=()=>{const log=state.logs[Number(input.dataset.comparisonSelect)];c.selected=input.checked?[...c.selected,log]:c.selected.filter(item=>item!==log);showComparison(true)})
  const calculate = () => {
    const radius=Number($('comparisonRadius').value)
    if (!Number.isFinite(radius)||radius<1||radius>100) { $('comparisonResults').textContent='Ange ett maxavstånd mellan 1 och 100 m.';return }
    c.radius=radius;c.reference=tracks[Number($('referenceTrack').value)]
    if (!c.reference || tracks.length<2) { $('comparisonResults').textContent='Välj minst två spår för att jämföra.';return }
    const reference=scoped(c.reference)
    const results=tracks.filter(log=>log!==c.reference).map(log=>{const track=scoped(log);return {log,track,pairs:compareTrackPoints(reference,track,radius)}}).sort((a,b)=>b.pairs.length-a.pairs.length)
    $('comparisonResults').innerHTML=`<table><thead><tr><th>Spår / justeringar</th><th>Matchade / möjliga</th><th>Median djupskillnad</th><th>Spridning P10–P90</th><th>Granska</th></tr></thead><tbody>${results.map(({log,track,pairs},i)=>{
      const d=pairs.map(p=>p.delta).sort((a,b)=>a-b), median=d.length?(d[Math.floor((d.length-1)/2)]+d[Math.floor(d.length/2)])/2:null
      return `<tr><td title="${escapeHtml(log.name)}">${escapeHtml(log.name)}<p>${escapeHtml(depthExplanation(log))}</p></td><td>${pairs.length} / ${track.points.length} (${decimal(track.points.length?100*pairs.length/track.points.length:0)} %)</td><td>${median==null?'Inga matchningar':decimal(median)+' m'}</td><td>${d.length?decimal(d[Math.floor((d.length-1)*.1)])+' – '+decimal(d[Math.ceil((d.length-1)*.9)])+' m':'–'}</td><td><button class="small-button" data-matches="${i}" ${pairs.length?'':'disabled'}>Visa matchningar på kartan</button><button class="small-button" data-compare-edit="${state.logs.indexOf(log)}">Redigera punkter / justering</button></td></tr>`
    }).join('')}</tbody></table>`
    document.querySelectorAll('[data-compare-edit]').forEach(button=>button.onclick=()=>{c.scroll=$('editorDialog').scrollTop;c.resultsScroll=$('comparisonResults').scrollTop;showTrackEditor(Number(button.dataset.compareEdit));$('editorDialog').scrollTop=0})
    document.querySelectorAll('[data-matches]').forEach(button=>button.onclick=()=>{
      c.scroll=$('editorDialog').scrollTop;c.resultsScroll=$('comparisonResults').scrollTop
      const result=results[Number(button.dataset.matches)];comparisonMatches={...result,reference}
      c.reference.visible=true;result.log.visible=true;c.reference.color='#087f8c';result.log.color='#e14b3b'
      if(!trackColors)$('colorMode').click()
      $('editorDialog').close();$('returnComparison').classList.remove('hidden');renderLogs();drawOverlay()
      toast('Lila ringar och linjer visar matchade punkter. Återgå med Tillbaka till jämförelsen.')
    })
  }
  $('referenceTrack').onchange=()=>{c.reference=tracks[Number($('referenceTrack').value)];showComparison(true)}
  $('comparisonRadius').onchange=calculate
  calculate()
  if (!$('editorDialog').open) $('editorDialog').showModal()
  $('editorDialog').scrollTop=c.scroll
  $('comparisonResults').scrollTop=c.resultsScroll || 0
}
$('returnComparison').onclick=()=>{comparisonMatches=null;$('returnComparison').classList.add('hidden');drawOverlay();showComparison(true)}
$('reviewMeasurements').onclick=()=>{setTracksPanel(true);showComparison()}

function updateMapReadout() {
  const live = state.live
  const depthValid = live && Number.isFinite(live.depth) && Date.now() - live.depthAt < 5000
  const gpsValid = live?.position && Date.now() - live.positionAt < 5000
  const speedValid = gpsValid && Number.isFinite(live.position.speed) && Date.now() - live.speedAt < 5000
  const gpsText = gpsValid ? `${live.position.lat.toFixed(6)}, ${live.position.lon.toFixed(6)}` : live?.position ? 'För gammal' : 'Ogiltig / saknas'
  const depthText = depthValid ? live.depth.toFixed(2) + ' m' : live?.depthAt ? 'För gammalt' : 'Saknas'
  $('liveReadout').innerHTML = `<span>GPS <strong>${gpsText}</strong>${live?.positionAt ? ' · ' + Math.floor((Date.now() - live.positionAt) / 1000) + ' s' : ''}</span><span>Djup <strong>${depthText}</strong>${live?.depthAt ? ' · ' + Math.floor((Date.now() - live.depthAt) / 1000) + ' s' : ''}</span>`
  $('mapReadout').classList.toggle('hidden', !live)
  $('mapReadout').innerHTML = `<span>Djup <strong>${depthValid ? live.depth.toFixed(2) + ' m' : '–'}</strong></span><span>Fart <strong>${speedValid ? live.position.speed.toFixed(1) + ' kn' : '–'}</strong></span><span>Kurs över grund <strong>${gpsValid && Date.now() - live.speedAt < 5000 && Number.isFinite(live.position.course) ? live.position.course.toFixed(1) + '°' : '–'}</strong></span>${live?.simulated ? '<small>SIMULERAD</small>' : ''}`
}
setInterval(() => { updateMapReadout(); if (state.live) drawOverlay() }, 1000)
$('addLibrary').onclick = () => $('addDialog').showModal()
$('addFiles').onclick = async () => { $('addDialog').close(); try { await addLibraryFiles(await window.sjomatning.openLibrary()) } catch(error) { toast(error.message) } }
$('addFolder').onclick = () => { $('addDialog').close(); openFolder() }
async function showAllTracks() {
  $('showAllTracks').disabled = true
  try {
    for (let i = 0; i < state.library.tracks.length; i++) {
      const file = state.library.tracks[i]
      const log = state.logs.find(log => log.sourceId === file.id)
      if (!log || !log.visible) await toggleFolderTrack(i)
    }
    state.logs.forEach(log => { log.visible = true })
    renderFolder(); renderLogs(); drawOverlay()
  } finally { $('showAllTracks').disabled = false }
}
function hideAllTracks() { state.logs.forEach(log => { log.visible = false }); renderFolder(); renderLogs(); drawOverlay() }
$('showAllTracks').onclick = showAllTracks
$('hideAllTracks').onclick = hideAllTracks
$('colorMode').onclick = () => {
  trackColors = !trackColors
  $('colorMode').textContent = trackColors ? 'Färg: spår' : 'Färg: djup'
  $('colorMode').setAttribute('aria-pressed', String(trackColors))
  document.querySelector('.depth-legend').classList.toggle('hidden', trackColors)
  renderTrackLegend()
  drawOverlay()
}
$('compareTracks').onclick = showComparison

function eyeIcon(visible) {
  return `<svg class="eye-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${visible ? '' : '<path d="M3 3l18 18"/>'}</svg>`
}
function renderTrackLegend() {
  const logs = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0)
  $('trackLegend').classList.toggle('hidden', !trackColors || !logs.length)
  $('trackLegend').innerHTML = `<div class="legend-actions"><button id="legendShowAll" class="small-button">${eyeIcon(true)}Visa alla</button><button id="legendHideAll" class="small-button">${eyeIcon(false)}Dölj alla</button></div>` + logs.map(log => `<button class="legend-track ${log.visible ? '' : 'muted-track'}" data-legend-track="${state.logs.indexOf(log)}" title="${escapeHtml(log.name)}" aria-label="${log.visible ? 'Dölj' : 'Visa'} ${escapeHtml(log.name)}" aria-pressed="${log.visible}">${eyeIcon(log.visible)}<i style="background:${log.color}"></i><span>${escapeHtml(shortTrackName(log.name))}</span></button>`).join('')
  $('legendShowAll').onclick = showAllTracks
  $('legendHideAll').onclick = hideAllTracks
  $('trackLegend').querySelectorAll('[data-legend-track]').forEach(button => {
    button.onmouseenter=button.onfocus=()=>{focusedTrack=state.logs[Number(button.dataset.legendTrack)];drawOverlay()}
    button.onmouseleave=button.onblur=()=>{focusedTrack=null;drawOverlay()}
  })
  $('trackLegend').querySelectorAll('[data-legend-track]').forEach(button => button.onclick = () => {
    const log = state.logs[Number(button.dataset.legendTrack)]
    log.visible = !log.visible
    renderFolder(); renderLogs(); drawOverlay()
  })
}
function setTracksPanel(open) {
  tracksPanelOpen = open
  renderLogs()
}
$('toggleTracksPanel').onclick = () => state.logs.some(log => log.visible) ? hideAllTracks() : showAllTracks()
$('openTracksPanel').onclick = () => setTracksPanel(!tracksPanelOpen)
$('closeTracksPanel').onclick = () => setTracksPanel(false)

function closeAnnotationEditor() {
  clearTimeout(annotationSaveTimer)
  annotationEditor.file = null; annotationEditor.selected = null; annotationEditor.placing = false; annotationEditor.preview = null
  $('annotationsPanel').classList.add('hidden'); overlay.classList.remove('placing-annotation')
}
async function openAnnotationEditor(file, page = 1) {
  if (annotationEditor.loading) return
  if (!await flushAnnotationChanges()) return
  annotationEditor.loading = true
  annotationEditor.file = file; annotationEditor.page = page; annotationEditor.selected = null; annotationEditor.placing = false
  $('annotationsPanel').classList.remove('hidden'); $('annotationStatus').textContent = 'Öppnar manus…'
  updateAnnotationControls()
  const opened = await loadPdfFile(file,page,true)
  annotationEditor.loading = false
  if (!opened || annotationEditor.file !== file) { if (!opened) closeAnnotationEditor(); return }
  $('annotationFileName').textContent = file.name
  clearNoteSelection()
  $('annotationsPanel').scrollIntoView({block:'nearest'})
}
function updateAnnotationControls() {
  const busy = annotationEditor.loading || annotationEditor.saving
  for(const id of ['annotationText','annotationSize','annotationColor']) $(id).disabled = annotationEditor.loading
  for(const id of ['placeAnnotation','newAnnotation','exportManuscriptPdf']) $(id).disabled = busy
  $('cancelAnnotation').classList.toggle('hidden',!annotationEditor.placing)
  $('placeAnnotation').classList.toggle('armed',annotationEditor.placing)
  $('placeAnnotation').textContent = annotationEditor.selected ? 'Flytta i manuset' : 'Placera i manuset'
  overlay.classList.toggle('placing-annotation',annotationEditor.placing)
}
function clearNoteSelection() {
  annotationEditor.selected = null; annotationEditor.placing = false; annotationEditor.preview=null
  $('annotationText').value = ''; $('annotationStatus').textContent = 'Skriv text och välj Placera i manuset. Klicka på en text för att flytta, dubbelklicka för att ändra.'
  updateAnnotationControls(); renderNoteList()
}
function noteDraft() {
  const text = $('annotationText').value.trim(), size = Number($('annotationSize').value), color = $('annotationColor').value
  if(!text) throw new Error('Skriv text eller siffror först.')
  if(!Number.isFinite(size) || size<6 || size>72) throw new Error('Textstorleken måste vara 6–72.')
  return {text,size,color}
}
function renderNoteList() {
  const notes = annotationEditor.file?.annotations || []
  $('annotationList').innerHTML = notes.filter(note=>note.page===annotationEditor.page).map(note=>`<div class="annotation-row"><button class="small-button" data-edit-note="${escapeHtml(note.id)}" title="Ändra anteckning">${escapeHtml(note.text)}</button><button class="small-button" data-delete-note="${escapeHtml(note.id)}" aria-label="Ta bort ${escapeHtml(note.text)}">×</button></div>`).join('')
  $('annotationList').querySelectorAll('[data-edit-note]').forEach(button=>button.onclick=async()=>{
    if(!await flushAnnotationChanges())return
    const note=notes.find(note=>note.id===button.dataset.editNote)
    selectNote(note);$('annotationText').focus()
  })
  $('annotationList').querySelectorAll('[data-delete-note]').forEach(button=>button.onclick=async()=>{
    if(!await flushAnnotationChanges())return
    if(await persistManuscriptNotes(annotationEditor.file,notes.filter(note=>note.id!==button.dataset.deleteNote))) clearNoteSelection()
  })
}
async function persistManuscriptNotes(file, notes) {
  annotationEditor.saving=true;updateAnnotationControls();$('annotationStatus').textContent='Sparar…'
  try {
    const operation=window.sjomatning.updateLibraryFile(file.id,{annotations:notes})
    annotationWritePromise=operation.catch(()=>{})
    const record=await operation
    file.annotations=record.annotations;file.annotatedRaster=null
    drawOverlay();scheduleMapDraw();renderNoteList();$('annotationStatus').textContent='Anteckningarna är sparade.'
    return true
  } catch(error) { $('annotationStatus').textContent=`Kunde inte spara: ${error.message}`; return false }
  finally {annotationEditor.saving=false;updateAnnotationControls()}
}
function notePosition(draft, point) {
  const ctx=overlay.getContext('2d'),fontSize=draft.size*annotationEditor.fontScale,lines=draft.text.split('\n')
  ctx.save();ctx.font=`${fontSize}px Arial`;const width=Math.max(...lines.map(line=>ctx.measureText(line).width));ctx.restore()
  const below=(lines.length-1)*fontSize*1.25+fontSize*.25
  if(width>state.width || fontSize+below>state.height)throw new Error('Texten ryms inte på sidan. Minska textstorleken eller dela upp texten.')
  return {x:Math.max(0,Math.min(state.width-width,point.x))/state.width,y:Math.max(fontSize,Math.min(state.height-below,point.y))/state.height}
}
async function placeManuscriptNote(point) {
  clearTimeout(annotationSaveTimer)
  if(annotationEditor.saving || !annotationEditor.file || state.map)return
  try {
    if(point.x<0||point.y<0||point.x>state.width||point.y>state.height)return
    const draft=noteDraft(),note={...draft,...notePosition(draft,point),id:annotationEditor.selected || crypto.randomUUID(),page:annotationEditor.page}
    const notes=[...(annotationEditor.file.annotations || [])],index=notes.findIndex(item=>item.id===note.id)
    if(index<0)notes.push(note);else notes[index]=note
    annotationEditor.placing=false;annotationEditor.preview=null
    if(await persistManuscriptNotes(annotationEditor.file,notes)) { annotationEditor.selected=note.id;updateAnnotationControls() }
  } catch(error) {toast(error.message)}
}
function paintNotes(context, notes, page, width, height, scale) {
  context.save();context.textBaseline='alphabetic'
  for(const note of notes.filter(note=>note.page===page)) {
    context.fillStyle=note.color;context.font=`${note.size*scale}px Arial`
    note.text.split('\n').forEach((line,i)=>context.fillText(line,note.x*width,note.y*height+i*note.size*scale*1.25))
  }
  context.restore()
}
function drawManuscriptNotes(context) {
  if(state.map || !state.activePdfId)return
  const file=state.library.pdfs.find(file=>file.id===state.activePdfId)
  let notes=file?.annotations || []
  if(annotationEditor.file===file && annotationEditor.placing && annotationEditor.preview) {
    try {const draft=noteDraft(),preview={...draft,...notePosition(draft,annotationEditor.preview),page:1};notes=[...notes.filter(note=>note.id!==annotationEditor.selected),preview]}catch{}
  }
  paintNotes(context,notes,state.pageNumber || 1,state.width,state.height,annotationEditor.fontScale)
}
function selectNote(note) {
  annotationEditor.selected=note.id;annotationEditor.placing=false;annotationEditor.preview=null
  $('annotationText').value=note.text;$('annotationSize').value=note.size;$('annotationColor').value=note.color
  $('annotationStatus').textContent='Ändringar sparas automatiskt.';updateAnnotationControls();drawOverlay()
}
function noteAtPoint(point) {
  const ctx=overlay.getContext('2d'),notes=annotationEditor.file?.annotations || []
  return [...notes].reverse().find(note=>{
    const size=note.size*annotationEditor.fontScale,lines=note.text.split('\n')
    ctx.font=`${size}px Arial`
    const width=Math.max(...lines.map(line=>ctx.measureText(line).width)),x=note.x*state.width,y=note.y*state.height
    return note.page===1 && point.x>=x-3 && point.x<=x+width+3 && point.y>=y-size && point.y<=y+(lines.length-1)*size*1.25+size*.25
  })
}
async function flushAnnotationChanges() {
  clearTimeout(annotationSaveTimer)
  await annotationSavePromise
  await annotationWritePromise
  if(!annotationEditor.file || !annotationEditor.selected)return true
  const file=annotationEditor.file,existing=file.annotations?.find(note=>note.id===annotationEditor.selected)
  if(!existing)return true
  try {
    const draft=noteDraft()
    if(draft.text===existing.text && draft.size===existing.size && draft.color===existing.color)return true
    const position=notePosition(draft,{x:existing.x*state.width,y:existing.y*state.height})
    annotationSavePromise=persistManuscriptNotes(file,file.annotations.map(note=>note.id===existing.id?{...note,...draft,...position}:note))
    return await annotationSavePromise
  } catch(error) {$('annotationStatus').textContent=error.message;return false}
}
for(const id of ['annotationText','annotationSize','annotationColor']) $(id).addEventListener('input',()=>{
  if(annotationEditor.placing)drawOverlay()
  if(!annotationEditor.selected)return
  clearTimeout(annotationSaveTimer);$('annotationStatus').textContent='Sparar snart…'
  annotationSaveTimer=setTimeout(()=>void flushAnnotationChanges(),450)
})
$('newAnnotation').onclick=async()=>{if(await flushAnnotationChanges())clearNoteSelection()}
$('cancelAnnotation').onclick=()=>{annotationEditor.placing=false;annotationEditor.preview=null;updateAnnotationControls();drawOverlay();$('annotationStatus').textContent='Placeringen avbröts.'}
$('placeAnnotation').onclick=()=>{try{noteDraft();annotationEditor.placing=true;annotationEditor.preview=null;state.armed=false;updateAnnotationControls();$('annotationStatus').textContent='Klicka där texten ska stå i manuset.'}catch(error){toast(error.message)}}
$('exportManuscriptPdf').onclick=async()=>{
  if(!await flushAnnotationChanges())return
  const file=annotationEditor.file;if(!file || annotationEditor.saving)return
  $('exportManuscriptPdf').disabled=true;$('annotationStatus').textContent='Skapar PDF…'
  try {const path=await window.sjomatning.exportManuscriptPdf(file.id);$('annotationStatus').textContent=path?`PDF sparad: ${path}`:'Exporten avbröts.'}
  catch(error){$('annotationStatus').textContent=`Kunde inte exportera: ${error.message}`}
  finally{$('exportManuscriptPdf').disabled=false}
}

function manuscriptImage(file) {
  if(!file.annotations?.some(note=>note.page===1))return file.mapRaster.canvas
  if(file.annotatedRaster?.source===file.mapRaster && file.annotatedRaster?.notes===file.annotations)return file.annotatedRaster.canvas
  const source=file.mapRaster.canvas,canvas=document.createElement('canvas')
  canvas.width=source.width;canvas.height=source.height
  const context=canvas.getContext('2d');context.drawImage(source,0,0)
  paintNotes(context,file.annotations,1,canvas.width,canvas.height,file.mapRaster.noteScale)
  file.annotatedRaster={source:file.mapRaster,notes:file.annotations,canvas}
  return canvas
}

journalController=mountJournal(window.sjomatning,async()=>{
  if(state.live?.position && Date.now()-state.live.positionAt<5000)return state.live.position
  if(!navigator.geolocation)return null
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),()=>reject(new Error('GPS-position kunde inte hämtas.')),{enableHighAccuracy:true,maximumAge:0,timeout:10000}))
},{onRows:rows=>{journalRows=rows;drawOverlay()},pick:async()=>{
  if(!state.transform)await loadRoxenMap()
  if(!state.transform)throw new Error('Öppna kartan eller kalibrera fältmanuset först.')
  state.armed=false;annotationEditor.placing=false
  const banner=document.createElement('div');banner.className='journal-map-pick';banner.setAttribute('role','status');
  banner.append('Klicka i kartan för händelsens position. Du kan zooma och panorera. ')
  const cancel=document.createElement('button');cancel.textContent='Avbryt';banner.append(cancel);document.body.append(banner)
  overlay.style.cursor='crosshair'
  return new Promise(resolve=>{
    const key=event=>{if(event.key==='Escape'){event.preventDefault();finish(null)}}
    const finish=point=>{journalPick=null;banner.remove();overlay.style.cursor='';document.removeEventListener('keydown',key);resolve(point)}
    journalPick=finish;cancel.onclick=()=>finish(null);document.addEventListener('keydown',key)
  })
}})

function drawJournalMarkers(context){
  context.save()
  for(const row of journalRows){
    const event=row.event
    if(row.deleted||!Number.isFinite(event.lat)||!Number.isFinite(event.lon))continue
    const p=geoToPixel(event.lat,event.lon)
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>state.width||p.y>state.height)continue
    const size=9/state.scale
    context.beginPath();context.arc(p.x,p.y,size,0,Math.PI*2)
    context.fillStyle='#7b3294';context.fill();context.strokeStyle='#fff';context.lineWidth=2/state.scale;context.stroke()
    context.fillStyle='#fff';context.font=`bold ${11/state.scale}px system-ui`;context.textAlign='center';context.fillText('H',p.x,p.y+4/state.scale)
    if(event.depth!=null){context.font=`bold ${12/state.scale}px system-ui`;context.textAlign='left';const label=event.depth.toLocaleString('sv-SE')+' m';context.strokeStyle='#fff';context.lineWidth=3/state.scale;context.strokeText(label,p.x+13/state.scale,p.y+4/state.scale);context.fillStyle='#58206d';context.fillText(label,p.x+13/state.scale,p.y+4/state.scale)}
    journalMarkers.push({id:event.id,x:p.x,y:p.y})
  }
  context.restore();overlay.dataset.journalMarkers=JSON.stringify(journalMarkers)
}
overlay.addEventListener('click',event=>{
  if(suppressClick)return
  const p=canvasPoint(event)
  if(journalPick){
    event.preventDefault();event.stopImmediatePropagation()
    const geo=pixelToGeo(p.x,p.y)
    if(geo&&Number.isFinite(geo.lat)&&Number.isFinite(geo.lon)&&Math.abs(geo.lat)<=90&&Math.abs(geo.lon)<=180)journalPick(geo)
    else toast('Välj en punkt inom en kalibrerad karta.')
    return
  }
  if(state.armed||annotationEditor.file)return
  const nearest=journalMarkers.map(marker=>({...marker,distance:Math.hypot(marker.x-p.x,marker.y-p.y)*state.scale})).filter(marker=>marker.distance<=14).sort((a,b)=>a.distance-b.distance)[0]
  if(nearest){event.preventDefault();event.stopImmediatePropagation();journalController?.open(nearest.id)}
},true)

mountMapContext({canvas:overlay,toGeo:event=>{const p=canvasPoint(event);return pixelToGeo(p.x,p.y)},available:()=>!journalPick&&!state.armed&&!annotationEditor.file,onEvent:point=>journalController?.createAt(point),error:toast,onTrack:point=>{
  const tracks=state.logs.filter(log=>log.sourceId).map(log=>({id:log.sourceId,name:log.name}))
  trackPointDialog(point,tracks,async({id,name,point})=>{
    manualTrackFile({name:id?'Spårpunkt':name,point})
    await Promise.all(pendingLibraryWrites)
    if(!id){
      const file=await window.sjomatning.createTrackPoint({name,point})
      await addLibraryFiles([file])
      const log=state.logs.find(log=>log.sourceId===file.id);if(log)log.visible=true
    }else{
      const log=state.logs.find(log=>log.sourceId===id),file=state.library.tracks.find(file=>file.id===id)
      if(!log||!file)throw new Error('Spåret finns inte längre.')
      const points=[...log.points,{...point,speed:null,date:'',time:''}]
      const edits=structuredClone({points,waterLevel:log.waterLevel,waterLevelSource:log.waterLevelSource,waterLevelDate:log.waterLevelDate,correction:log.correction,depthAdjustment:log.depthAdjustment||0,pruneDistance:log.pruneDistance||0})
      await window.sjomatning.updateLibraryFile(id,{edits})
      log.points=points;log.visible=true;file.edits=edits;pointIndexes.delete(log)
    }
    renderLogs();renderFolder();drawOverlay();toast('Spårpunkten är sparad.')
  })
}})
