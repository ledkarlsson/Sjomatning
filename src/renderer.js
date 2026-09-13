import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import { parseTextTrack, parseTrcTrack, parseLowranceTrack } from './track-parser.mjs'
import { ROXEN_BOUNDS, SWEDEN_BOUNDS, fitBounds, viewportMap, panMap, zoomMap, visibleTiles, geoToMapPixel, mapPixelToGeo } from './web-map.mjs'
import { compareTrackPoints, adjustedDepth, exportCsv, exportWaypoints, processedPoints, trackDate } from './track-processing.mjs'
import { simulationFrame } from './nmea-simulator.mjs'
import { parseNmeaSentence } from './nmea-parser.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const colors = ['#e14b3b', '#087f8c', '#7855a6', '#d58416', '#2e6db4']
const state = { pdf: null, pdfKey: null, activePdfId: null, page: null, map: null, width: 0, height: 0, scale: 1, fitScale: 1, calibration: [], transform: null, logs: [], armed: false, live: null, roxenLevel: null, library: { folders: [], pdfs: [], tracks: [] } }
const $ = id => document.getElementById(id)
const pdfCanvas = $('pdfCanvas')
const overlay = $('overlayCanvas')
const wrap = $('canvasWrap')
const viewportElement = $('viewport')
const waterLevelRequests = new Map()
let manuscriptOffset = { x: 0, y: 0 }
let showManuscripts = false
let trackColors = false
let tracksPanelOpen = false
const manuscriptName = name => name.replace(/\.pdf$/i, '')
const shortTrackName = name => name.length > 42 ? name.slice(0, 26) + '…' + name.slice(-15) : name
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
  if (t.type === 'axis') return { lon: t.lonScale * x + t.lonOffset, lat: t.latScale * y + t.latOffset }
  return { lon: t.lon[0] * x + t.lon[1] * y + t.lon[2], lat: t.lat[0] * x + t.lat[1] * y + t.lat[2] }
}

async function loadPdfFile(file) {
  try {
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file.bytes)
    state.map = null
    viewportElement.classList.remove('web-map')
    $('mapAttribution').classList.add('hidden')
    state.pdfKey = `${file.originalName || file.name}:${bytes.byteLength}`
    state.activePdfId = file.id || null
    state.pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
    state.page = await state.pdf.getPage(1)
    state.calibration = []
    state.transform = null
    const automatic = parseGeoPdf(bytes)
    const baseViewport = state.page.getViewport({ scale: 1.6 })
    state.width = Math.round(baseViewport.width)
    state.height = Math.round(baseViewport.height)
    pdfCanvas.width = overlay.width = state.width
    pdfCanvas.height = overlay.height = state.height
    wrap.style.width = `${state.width}px`
    wrap.style.height = `${state.height}px`
    await state.page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: baseViewport }).promise

    if (automatic) {
      state.calibration = automatic.map(point => ({ x: point.nx * state.width, y: (1 - point.ny) * state.height, lat: point.lat, lon: point.lon, automatic: true }))
      state.transform = calibrationTransform(state.calibration)
    } else {
      state.calibration = restoreCalibration()
      state.transform = calibrationTransform(state.calibration)
    }
    $('documentName').textContent = file.name
    $('pageInfo').textContent = `${state.pdf.numPages} sida${state.pdf.numPages === 1 ? '' : 'or'}`
    $('introPanel').classList.add('hidden')
    $('documentPanel').classList.remove('hidden')
    $('calibrationPanel').classList.toggle('hidden', Boolean(state.transform))
    $('emptyState').classList.add('hidden')
    wrap.classList.remove('hidden')
    viewportElement.classList.remove('empty')
    updateGeoStatus()
    fitView()
    drawOverlay()
  } catch (error) {
    console.error(error)
    toast(`Kunde inte öppna PDF: ${error.message}`)
  }
}

// Keep PDF rasters separate from the map canvas so tile refreshes cannot erase them.
async function manuscriptRaster(file) {
  if (file.mapRaster) return file.mapRaster
  if (file.mapRasterLoading || file.mapRasterFailed) return null
  file.mapRasterLoading = true
  let loadingTask
  try {
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
    file.mapRaster = { canvas, crop }
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
  const points = parseGeoPdf(new Uint8Array(file.bytes))
  if (!points) return null
  const t = affineFit(points.map(p => ({ x: p.nx, y: 1 - p.ny, lat: p.lat, lon: p.lon })))
  if (!t || ![...t.lon, ...t.lat].every(Number.isFinite)) return null
  return (x, y) => ({ lon: t.lon[0]*x + t.lon[1]*y + t.lon[2], lat: t.lat[0]*x + t.lat[1]*y + t.lat[2] })
}

function drawManuscripts(context, map) {
  state.library.pdfs.forEach((file, index) => {
    if (!file.hasGeoData) return
    const geo = file.mapGeometry || (file.mapGeometry = manuscriptGeometry(file))
    if (!geo) return
    const project = (x, y) => { const p = geo(x, y); return geoToMapPixel(map, p.lat, p.lon) }
    const corners = [[0,0], [1,0], [1,1], [0,1]].map(p => project(...p))
    if (Math.max(...corners.map(p => p.x)) < 0 || Math.min(...corners.map(p => p.x)) > map.width || Math.max(...corners.map(p => p.y)) < 0 || Math.min(...corners.map(p => p.y)) > map.height) return
    const color = colors[index % colors.length]
    context.save()
    if (showManuscripts && !file.mapRaster) void manuscriptRaster(file)
    if (showManuscripts && file.mapRaster) {
      const { canvas, crop } = file.mapRaster
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
    context.beginPath()
    corners.forEach((p,i) => i ? context.lineTo(p.x,p.y) : context.moveTo(p.x,p.y))
    context.closePath()
    if (!showManuscripts || !file.mapRaster) { context.fillStyle = color + '22'; context.fill() }
    context.strokeStyle = color; context.lineWidth = 2; context.stroke()
    context.font = '12px sans-serif'
    const labelX = Math.max(4, Math.min(map.width - 160, corners[0].x))
    const labelY = Math.max(18, Math.min(map.height - 4, corners[0].y))
    context.fillStyle = '#ffffff'; context.fillRect(labelX-2,labelY-14,context.measureText(manuscriptName(file.name)).width+8,18)
    context.fillStyle = color; context.fillText(manuscriptName(file.name),labelX+2,labelY)
    context.restore()
  })
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
    if (/\.pdf$/i.test(file.name)) {
      state.library.pdfs.push({ ...file, hasGeoData: Boolean(parseGeoPdf(bytes)), size: bytes.byteLength })
    } else {
      try {
        const parsed = parseTrackFile(bytes, file.originalName || file.name)
        parsed.name = file.name
        state.library.tracks.push({ ...file, parsed, size: bytes.byteLength, loaded: state.logs.some(log => log.sourceId === file.id) })
      } catch (error) {
        state.library.tracks.push({ ...file, parsed: null, size: bytes.byteLength, error: error.message, loaded: false })
      }
    }
  }
  renderFolder()
  scheduleMapDraw()
  if (duplicates && !quiet) toast(`${duplicates} identisk${duplicates === 1 ? ' fil' : 'a filer'} hoppades över.`)
}

function trackFit(track) {
  if (!state.transform || !state.page || !track?.points?.length) return null
  let inside = 0
  for (const point of track.points) {
    const pixel = geoToPixel(point.lat, point.lon)
    if (!pixel) continue
    const x = state.map ? pixel.x : pixel.x * state.scale + manuscriptOffset.x
    const y = state.map ? pixel.y : pixel.y * state.scale + manuscriptOffset.y
    if (x >= 0 && x <= viewportElement.clientWidth && y >= 0 && y <= viewportElement.clientHeight) inside += 1
  }
  return { inside, total: track.points.length }
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
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)} · <i class="file-state ${file.hasGeoData ? 'geo' : ''}">${file.hasGeoData ? 'GeoPDF' : 'Utan geodata'}</i></span></div>
      <div class="file-actions"><button class="small-button" data-locate-pdf="${index}">Gå till plats</button><button class="small-button" data-rename-pdf="${index}">Byt namn</button><button class="small-button danger" data-delete-pdf="${index}" title="Ta bort PDF">×</button></div>
    </div>`
  const pdfGroups = [
    ['Med geodata', folder.pdfs.map((file, index) => ({ file, index })).filter(item => item.file.hasGeoData)],
    ['Utan geodata', folder.pdfs.map((file, index) => ({ file, index })).filter(item => !item.file.hasGeoData)]
  ].filter(([, items]) => items.length)
  $('folderPdfList').innerHTML = pdfGroups.length ? pdfGroups.map(([title, items]) => `<div class="folder-group"><p class="folder-group-title">${title}</p>${items.map(({ file, index }) => pdfCard(file, index)).join('')}</div>`).join('') : '<p class="empty-list">Inga PDF-filer hittades.</p>'
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

  document.querySelectorAll('[data-locate-pdf]').forEach(button => button.addEventListener('click', () => {
    const file = folder.pdfs[Number(button.dataset.locatePdf)]
    if (!file.hasGeoData) return loadPdfFile(file)
    const geo = manuscriptGeometry(file)
    if (!geo) return toast('Fältmanusets geodata kunde inte tolkas.')
    const corners = [[0,0],[1,0],[1,1],[0,1]].map(p => geo(...p))
    loadRoxenMap({ north: Math.max(...corners.map(p => p.lat)), south: Math.min(...corners.map(p => p.lat)), east: Math.max(...corners.map(p => p.lon)), west: Math.min(...corners.map(p => p.lon)) })
  }))
  for (const type of ['pdf', 'track']) document.querySelectorAll(`[data-rename-${type}]`).forEach(button => button.addEventListener('click', () => renameFile(type, Number(button.getAttribute(`data-rename-${type}`)))))
  document.querySelectorAll('[data-folder-track]').forEach(button => button.addEventListener('click', () => toggleFolderTrack(Number(button.dataset.folderTrack))))
  document.querySelectorAll('[data-delete-pdf]').forEach(button => button.addEventListener('click', () => deleteLibraryFile('pdf', Number(button.dataset.deletePdf))))
  document.querySelectorAll('[data-delete-track]').forEach(button => button.addEventListener('click', () => deleteLibraryFile('track', Number(button.dataset.deleteTrack))))
}

function clearActivePdf() {
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

async function toggleFolderTrack(index) {
  const file = state.library.tracks[index]
  if (!file.parsed) return
  const existing = state.logs.find(log => log.sourceId === file.id)
  if (existing) existing.visible = !existing.visible
  else {
    const parsed = { ...structuredClone(file.parsed), color: colors[state.logs.length % colors.length], visible: true, folderKey: file.path, sourceId: file.id }
    parsed.original = structuredClone(file.parsed)
    state.logs.push(parsed)
    file.loaded = true
    if (file.edits) Object.assign(parsed, structuredClone(file.edits))
    else await applyAutomaticWaterLevel(parsed)
  }
  renderFolder(); renderLogs(); drawOverlay()
}

function updateGeoStatus() {
  const badge = $('geoBadge')
  if (state.map) {
    badge.textContent = 'Automatisk GPS-karta'
    badge.className = 'badge success'
  } else if (state.transform) {
    badge.textContent = state.calibration.some(p => p.automatic) ? 'GeoPDF' : 'Kalibrerat'
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
  context.clearRect(0, 0, state.width, state.height)

  state.calibration.forEach((point, index) => {
    context.beginPath(); context.arc(point.x, point.y, 7, 0, Math.PI * 2)
    context.fillStyle = '#fff'; context.fill(); context.lineWidth = 3; context.strokeStyle = '#176b58'; context.stroke()
    context.fillStyle = '#176b58'; context.font = 'bold 11px system-ui'; context.fillText(String(index + 1), point.x + 10, point.y - 9)
  })

  if (!state.transform) return
  const allDepths = state.logs.flatMap(log => log.visible ? processedPoints(log).map(point => correctedDepth(log, point)) : [])
  const min = Math.min(...allDepths)
  const max = Math.max(...allDepths)

  state.logs.filter(log => log.visible).forEach(log => {
    context.beginPath()
    let started = false
    const points = processedPoints(log)
    points.forEach(point => {
      const pixel = geoToPixel(point.lat, point.lon)
      if (!pixel) return
      if (!started) { context.moveTo(pixel.x, pixel.y); started = true } else context.lineTo(pixel.x, pixel.y)
    })
    context.strokeStyle = log.color; context.globalAlpha = .72; context.lineWidth = 2.2; context.stroke(); context.globalAlpha = 1
    const stride = Math.max(1, Math.ceil(points.length / 1100))
    points.forEach((point, index) => {
      if (index % stride) return
      const pixel = geoToPixel(point.lat, point.lon)
      if (!pixel || pixel.x < 0 || pixel.x > state.width || pixel.y < 0 || pixel.y > state.height) return
      context.beginPath(); context.arc(pixel.x, pixel.y, 2.4, 0, Math.PI * 2)
      context.fillStyle = trackColors ? log.color : depthColor(correctedDepth(log, point), min, max); context.fill()
    })
  })
  if (state.live?.simulated && state.live.position) {
    const pixel = geoToPixel(state.live.position.lat, state.live.position.lon)
    if (pixel) {
      context.save(); context.translate(pixel.x, pixel.y); context.rotate((state.live.course || 0) * Math.PI / 180)
      const size = 12 / state.scale
      context.beginPath(); context.moveTo(0, -size); context.lineTo(size * .65, size); context.lineTo(0, size * .55); context.lineTo(-size * .65, size); context.closePath()
      context.fillStyle = '#087f8c'; context.fill(); context.strokeStyle = '#fff'; context.lineWidth = 2 / state.scale; context.stroke(); context.restore()
    }
  }

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
  log.correction = Math.round((result.data.level - 33) * 100) / 100
  return true
}

function renderLogs() {
  $('logsPanel').classList.toggle('hidden', !tracksPanelOpen)
  const fittingLogs = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0)
  $('toggleTracksPanel').textContent = `${state.logs.some(log => log.visible) ? 'Dölj' : 'Visa'} spår (${fittingLogs.filter(log => log.visible).length} i bild)`
  $('toggleTracksPanel').setAttribute('aria-pressed', String(state.logs.some(log => log.visible)))
  $('openTracksPanel').setAttribute('aria-expanded', String(tracksPanelOpen))
  renderTrackLegend()
  $('applyWaterLevel').classList.toggle('hidden', !state.roxenLevel || state.logs.length === 0)
  if (state.transform) {
    const fitting = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0).length
    $('logsMapSummary').textContent = `${fitting} av ${state.logs.length} spår har punkter som ryms i den aktiva kartan.`
  } else $('logsMapSummary').textContent = 'Aktivera geodata för att se vilka spår som ryms i kartan.'
  $('logList').innerHTML = state.logs.map((log, index) => {
    if (!fittingLogs.includes(log)) return ''
    const visiblePoints = processedPoints(log)
    const depths = visiblePoints.map(point => correctedDepth(log, point))
    const depthRange = depths.length ? `${Math.min(...depths).toFixed(2)}–${Math.max(...depths).toFixed(2)} m` : 'Inga punkter'
    const adjustment = log.depthAdjustment ? ` · extra justering ${log.depthAdjustment > 0 ? '+' : ''}${log.depthAdjustment.toFixed(2)} m` : ''
    return `<div class="log-card" style="--log-color:${log.color}">
      <label class="log-title"><input class="log-toggle" type="checkbox" data-log="${index}" ${log.visible ? 'checked' : ''}>${escapeHtml(log.name)}</label>
      <div class="log-meta">${visiblePoints.length.toLocaleString('sv-SE')} av ${log.points.length.toLocaleString('sv-SE')} punkter · ${depthRange}<br><strong class="track-fit">${fitText(log)}</strong>${adjustment}</div>
      <div class="log-controls">
        <label>Vattennivå (m)<input type="number" step="0.01" data-water-level="${index}" value="${log.waterLevel == null ? '' : log.waterLevel.toFixed(2)}" placeholder="33.00"></label>
        <label>Djupjustering (m)<input type="number" step="0.01" data-depth-adjustment="${index}" value="${(log.depthAdjustment || 0).toFixed(2)}"></label>
        <label>Glesa, avstånd (m)<input type="number" min="0" max="500" step="1" data-prune-distance="${index}" value="${log.pruneDistance || 0}"></label>
      </div>
      <button class="small-button" data-table-log="${index}">Info och punkttabell</button><button class="small-button" data-restore-log="${index}">Återställ original</button>

    </div>`
  }).join('')
  document.querySelectorAll('[data-log]').forEach(input => input.addEventListener('change', event => {
    state.logs[Number(event.target.dataset.log)].visible = event.target.checked
    renderFolder(); renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-table-log]').forEach(button => button.onclick = () => showTrackEditor(Number(button.dataset.tableLog)))
  document.querySelectorAll('[data-restore-log]').forEach(button => button.onclick = () => restoreTrack(Number(button.dataset.restoreLog)))
  document.querySelectorAll('[data-water-level]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.waterLevel)]
    const level = Number(event.target.value)
    log.waterLevel = event.target.value === '' || !Number.isFinite(level) ? null : level
    log.waterLevelSource = 'manual'
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

overlay.addEventListener('click', event => {
  if (!state.armed) {
    const clicked = canvasPoint(event)
    let nearest = null
    state.logs.forEach((log, logIndex) => {
      if (!log.visible) return
      log.points.forEach((point, pointIndex) => {
        const pixel = geoToPixel(point.lat, point.lon)
        const distance = pixel ? Math.hypot(pixel.x - clicked.x, pixel.y - clicked.y) * state.scale : Infinity
        if (distance <= 16 && (!nearest || distance < nearest.distance)) nearest = { logIndex, pointIndex, distance }
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
  if (viewportElement.classList.contains('panning')) return
  if (!state.transform) return
  const point = canvasPoint(event)
  const geo = pixelToGeo(point.x, point.y)
  $('cursorPosition').textContent = `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`
  let nearest = null
  state.logs.filter(log => log.visible).forEach(log => {
    const points = processedPoints(log)
    const stride = Math.max(1, Math.ceil(points.length / 1000))
    for (let i = 0; i < points.length; i += stride) {
      const pixel = geoToPixel(points[i].lat, points[i].lon)
      const distance = pixel ? Math.hypot(pixel.x - point.x, pixel.y - point.y) * state.scale : Infinity
      if (distance < 10 && (!nearest || distance < nearest.distance)) nearest = { log, point: points[i], distance }
    }
  })
  if (nearest) {
    $('tooltip').innerHTML = `<strong>${escapeHtml(shortTrackName(nearest.log.name))}</strong><br>${correctedDepth(nearest.log, nearest.point).toFixed(2)} m<br>${escapeHtml([nearest.point.date, nearest.point.time].filter(Boolean).join(' '))}<br>Lat: ${nearest.point.lat.toFixed(6)} · Long: ${nearest.point.lon.toFixed(6)}${Number.isFinite(nearest.point.speed) && nearest.point.speed.toFixed(1) !== '0.0' ? '<br>' + nearest.point.speed.toFixed(1) + ' knop' : ''}`
    $('tooltip').style.left = `${event.clientX + 14}px`; $('tooltip').style.top = `${event.clientY + 14}px`
    $('tooltip').classList.remove('hidden')
  } else $('tooltip').classList.add('hidden')
})

overlay.addEventListener('mouseleave', () => $('tooltip').classList.add('hidden'))
$('armCalibration').addEventListener('click', () => {
  if (!state.page) return
  state.armed = !state.armed
  $('armCalibration').classList.toggle('armed', state.armed)
  $('armCalibration').textContent = state.armed ? 'Klicka nu i kartan…' : 'Placera referenspunkt'
})
$('clearCalibration').addEventListener('click', () => {
  state.calibration = []; state.transform = null
  if (state.pdfKey) localStorage.removeItem(`calibration:${state.pdfKey}`)
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
  localStorage.setItem('library:collapsed', String(collapsed))
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

if (localStorage.getItem('library:collapsed') === 'true') {
  $('libraryContent').classList.add('hidden')
  $('toggleLibrary').textContent = 'Visa'
  $('toggleLibrary').setAttribute('aria-expanded', 'false')
}

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
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 6 ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}` : new Date().toLocaleTimeString('sv-SE')
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
    const session = await window.sjomatning.startLiveSession({ baudRate: Number($('baudRate').value), depthOffset: Number($('liveDepthOffset').value) || 0 })
    const log = { name: `Live ${new Date().toLocaleString('sv-SE')}`, date: today(), points: [], warnings: [], color: colors[state.logs.length % colors.length], visible: true, depthAdjustment: 0, pruneDistance: 0, waterLevel: null, correction: null }
    state.logs.push(log)
    state.live = { port, session, log, position: null, depth: null, cancelled: false }
    $('liveBadge').textContent = 'Loggar'; $('liveBadge').className = 'badge success'
    $('startSimulator').classList.add('hidden'); $('startCapture').classList.add('hidden'); $('stopCapture').classList.remove('hidden')
    $('livePath').textContent = `Sparas i ${session.folder}`
    renderLogs()
    readSerialStream().catch(error => { console.error(error); toast(`USB-anslutningen avbröts: ${error.message}`); stopCapture() })
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
  while (!live.cancelled) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''
    for (const raw of lines) {
      await receiveNmea(live, raw)
    }
  }
  reader.releaseLock()
  await closed
}

async function receiveNmea(live, raw) {
  if (live.cancelled) return
  const parsed = parseNmeaSentence(raw)
  if (parsed?.type === 'position' && Number.isFinite(parsed.speed)) live.speedAt = Date.now()
  if (parsed?.type === 'position') { live.position = { ...live.position, ...parsed }; live.positionAt = Date.now() }
  if (parsed?.type === 'gps-invalid') { live.position = null; live.positionAt = 0 }
  if (parsed?.type === 'depth') { live.depth = parsed.depth + (Number($('liveDepthOffset').value) || 0); live.depthAt = Date.now() }
  let point = null
  if (parsed?.type === 'position' && live.position && Number.isFinite(live.depth) && Date.now() - live.depthAt < 5000) {
    point = { date: live.position.date || today(), time: nmeaTime(live.position.time), lat: live.position.lat, lon: live.position.lon, speed: live.position.speed || 0, depth: live.depth }
    live.log.points.push(point)
    if (live.log.points.length % 5 === 0) { renderLogs(); drawOverlay() }
  }
  await window.sjomatning.appendLiveData({ id: live.session.id, raw, point })
  updateMapReadout()
  $('liveReadout').innerHTML = `<span>GPS <strong>${live.position ? `${live.position.lat.toFixed(6)}, ${live.position.lon.toFixed(6)}` : 'väntar…'}</strong></span><span>Djup <strong>${Number.isFinite(live.depth) ? `${live.depth.toFixed(2)} m` : 'väntar…'}</strong></span>`
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
        live.course = frame.course
        for (const raw of frame.sentences) await receiveNmea(live, raw)
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
  await live.port?.close().catch(() => {})
  try {
    const file = await window.sjomatning.stopLiveSession(live.session.id)
    if (file?.id && live.log.points.length) {
      await addLibraryFiles([file], [], true)
      live.log.sourceId = file.id
      live.log.original = structuredClone(state.library.tracks.find(item => item.id === file.id).parsed)
      saveTrack(live.log)
    }
  } catch (error) { toast(`Spåret finns i mätmappen men kunde inte läggas i biblioteket: ${error.message}`) }
  $('liveBadge').textContent = 'Frånkopplad'; $('liveBadge').className = 'badge warning'
  $('simulationSpeed').disabled = false; $('startSimulator').classList.remove('hidden'); $('startCapture').classList.remove('hidden'); $('stopCapture').classList.add('hidden')
  renderLogs(); drawOverlay(); toast(`Mätningen stoppades. ${live.log.points.length} punkter sparades i realtid.`)
}

$('startCapture').addEventListener('click', startCapture)
$('stopCapture').addEventListener('click', stopCapture)

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
  if (!log.sourceId) return
  const edits = structuredClone({ points: log.points, waterLevel: log.waterLevel, waterLevelSource: log.waterLevelSource, correction: log.correction, depthAdjustment: log.depthAdjustment || 0, pruneDistance: log.pruneDistance || 0 })
  const file = state.library.tracks.find(file => file.id === log.sourceId)
  if (file) file.edits = edits
  void window.sjomatning.updateLibraryFile(log.sourceId, { edits }).catch(error => toast(`Ändringen kunde inte sparas: ${error.message}`))
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
    Object.assign(log, structuredClone(original), { name: file.name, waterLevelSource: 'filename', depthAdjustment: 0, pruneDistance: 0 })
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
    <p>${editable ? 'Ändra rådjup eller koordinater direkt i tabellen. Originalfilen finns kvar och kan återställas.' : 'Pågående livespår: stoppa mätningen för att spara i biblioteket och redigera punkter.'}</p>
    <table><thead><tr><th>Punkt / tid</th><th>Latitud</th><th>Longitud</th><th>Rådjup (m)</th><th>Justerat (m)</th><th></th></tr></thead><tbody>${log.points.slice(start, start + 100).map((point, n) => `<tr><td>${start + n + 1}<br>${escapeHtml(point.date)} ${escapeHtml(point.time)}</td>${['lat','lon','depth'].map(field => `<td><input aria-label="${field} punkt ${start + n + 1}" type="number" step="${field === 'depth' ? '0.01' : '0.000001'}" value="${point[field]}" data-point="${start + n}" data-field="${field}" ${editable ? '' : 'disabled'}></td>`).join('')}<td>${correctedDepth(log, point).toFixed(2)}</td><td><button class="small-button" data-remove-point="${start + n}" ${editable ? '' : 'disabled'}>Ta bort</button></td></tr>`).join('')}</tbody></table>
    <button id="previousPoints" class="small-button" ${page === 0 ? 'disabled' : ''}>Föregående</button> <span>Sida ${page + 1} av ${Math.max(1, Math.ceil(log.points.length / 100))}</span> <button id="nextPoints" class="small-button" ${start + 100 >= log.points.length ? 'disabled' : ''}>Nästa</button>`
  if (!$('editorDialog').open) $('editorDialog').showModal()
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

function showComparison() {
  const tracks = state.logs.filter(log => log.visible)
  if (tracks.length < 2) return toast('Visa minst två spår för att jämföra.')
  $('editorContent').innerHTML = `<h2>Jämför spår</h2><p>Jämför varje spår med ett referensspår. Närmaste punkt inom vald radie används. Positiv skillnad betyder djupare än referensen. Bottenlutning och olika körvägar kan också ge skillnader.</p><label>Referensspår<select id="referenceTrack">${tracks.map((log, i) => `<option value="${i}">${escapeHtml(log.name)}</option>`).join('')}</select></label><label>Maxavstånd mellan punkter (m)<input id="comparisonRadius" type="number" min="1" max="100" value="10"></label><div id="comparisonResults"></div>`
  $('editorDialog').showModal()
  const calculate = () => {
    const radius = Number($('comparisonRadius').value)
    if (!Number.isFinite(radius) || radius < 1 || radius > 100) return
    const reference = tracks[Number($('referenceTrack').value)]
    const rows = tracks.filter(log => log !== reference).map(log => ({ log, pairs: compareTrackPoints(reference, log, radius) })).filter(result => result.pairs.length > 0).sort((a, b) => b.pairs.length - a.pairs.length).map(({ log, pairs }) => {
      const deltas = pairs.map(pair => pair.delta).sort((a,b) => a-b)
      const median = deltas.length ? (deltas[Math.floor((deltas.length-1)/2)] + deltas[Math.floor(deltas.length/2)]) / 2 : null
      return `<tr><td>${escapeHtml(log.name)}</td><td>${pairs.length}</td><td>${median == null ? 'Inga närliggande punkter' : median.toFixed(2) + ' m'}</td><td><button class="small-button" data-compare-edit="${state.logs.indexOf(log)}">Redigera punkter / justering</button></td></tr>`
    })
    $('comparisonResults').innerHTML = `<table><thead><tr><th>Spår</th><th>Matchade punkter</th><th>Median djupskillnad</th><th></th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">Inga matchande punkter inom vald radie.</td></tr>'}</tbody></table><p>Skillnaderna använder aktuella vattenstånds- och djupjusteringar, före gallring. Varje punkt matchas en gång; samma referenspunkt kan användas flera gånger.</p>`
    document.querySelectorAll('[data-compare-edit]').forEach(button => button.onclick = () => showTrackEditor(Number(button.dataset.compareEdit)))
  }
  $('referenceTrack').onchange = $('comparisonRadius').onchange = calculate
  calculate()
}

function updateMapReadout() {
  const live = state.live
  const depthValid = live && Number.isFinite(live.depth) && Date.now() - live.depthAt < 5000
  const speedValid = live?.position && Number.isFinite(live.position.speed) && Date.now() - live.speedAt < 5000
  $('mapReadout').classList.toggle('hidden', !live)
  $('mapReadout').innerHTML = `<span>Djup <strong>${depthValid ? live.depth.toFixed(2) + ' m' : '–'}</strong></span><span>Fart <strong>${speedValid ? live.position.speed.toFixed(1) + ' kn' : '–'}</strong></span>${live?.simulated ? '<small>SIMULERAD</small>' : ''}`
}
setInterval(updateMapReadout, 1000)
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
$('showTracksPanel').onclick = () => setTracksPanel(true)
$('closeTracksPanel').onclick = () => setTracksPanel(false)
