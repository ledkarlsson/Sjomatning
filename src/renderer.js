import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import { parseTextTrack, parseTrcTrack } from './track-parser.mjs'
import { ROXEN_BOUNDS, createWebMap, geoToMapPixel, mapPixelToGeo, tilesForMap } from './web-map.mjs'
import { adjustedDepth, exportCsv, exportWaypoints, processedPoints, trackDate } from './track-processing.mjs'
import { simulationFrame } from './nmea-simulator.mjs'
import { parseNmeaSentence } from './nmea-parser.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const colors = ['#e14b3b', '#087f8c', '#7855a6', '#d58416', '#2e6db4']
const state = { pdf: null, pdfKey: null, activePdfId: null, page: null, map: null, width: 0, height: 0, scale: 1, fitScale: 1, calibration: [], transform: null, logs: [], armed: false, editLogIndex: null, live: null, roxenLevel: null, library: { folders: [], pdfs: [], tracks: [] } }
const $ = id => document.getElementById(id)
const pdfCanvas = $('pdfCanvas')
const overlay = $('overlayCanvas')
const wrap = $('canvasWrap')
const viewportElement = $('viewport')
const waterLevelRequests = new Map()

function toast(message) {
  $('toast').textContent = message
  $('toast').classList.remove('hidden')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 4200)
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
  if (geo.length < 6 || local.length !== geo.length) return null
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
    $('mapAttribution').classList.add('hidden')
    state.pdfKey = `${file.name}:${bytes.byteLength}`
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

function loadTile(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Kunde inte hämta ${url}`))
    image.src = url
  })
}

async function loadRoxenMap(bounds = ROXEN_BOUNDS, zoom = 11) {
  const map = createWebMap(bounds, zoom)
  state.pdf = null
  state.pdfKey = null
  state.activePdfId = null
  state.page = { webMap: true }
  state.map = map
  state.calibration = []
  state.transform = { type: 'web-mercator' }
  state.width = map.width
  state.height = map.height
  pdfCanvas.width = overlay.width = state.width
  pdfCanvas.height = overlay.height = state.height
  wrap.style.width = `${state.width}px`
  wrap.style.height = `${state.height}px`
  const context = pdfCanvas.getContext('2d')
  context.fillStyle = '#dce8e5'
  context.fillRect(0, 0, state.width, state.height)
  $('introPanel').classList.add('hidden')
  $('documentPanel').classList.add('hidden')
  $('calibrationPanel').classList.add('hidden')
  $('emptyState').classList.add('hidden')
  $('mapAttribution').classList.remove('hidden')
  wrap.classList.remove('hidden')
  viewportElement.classList.remove('empty')
  fitView()
  renderFolder()
  renderLogs()
  drawOverlay()
  const tiles = tilesForMap(map)
  let failures = 0
  await Promise.all(tiles.map(async tile => {
    try {
      const base = await loadTile(`https://tile.openstreetmap.org/${map.zoom}/${tile.x}/${tile.y}.png`)
      if (state.map !== map) return
      context.drawImage(base, tile.dx, tile.dy)
      try {
        const nautical = await loadTile(`https://tiles.openseamap.org/seamark/${map.zoom}/${tile.x}/${tile.y}.png`)
        if (state.map !== map) return
        context.drawImage(nautical, tile.dx, tile.dy)
      } catch { /* Sjömärkeslagret kan sakna en enskild ruta. */ }
    } catch { failures += 1 }
  }))
  if (state.map !== map) return
  if (failures === tiles.length) toast('Kartan kunde inte hämtas. Kontrollera internetanslutningen.')
  else if (failures) toast(`Kartan laddades, men ${failures} kartdelar saknas.`)
}

async function openPdf() {
  const [file] = await window.sjomatning.openPdf()
  if (file) { await addLibraryFiles([file]); await loadPdfFile(file) }
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
        const parsed = /\.trc$/i.test(file.name) ? parseTrcTrack(bytes, file.name) : parseTextTrack(bytesToText(bytes), file.name)
        state.library.tracks.push({ ...file, parsed, size: bytes.byteLength, loaded: state.logs.some(log => log.sourceId === file.id) })
      } catch (error) {
        state.library.tracks.push({ ...file, parsed: null, size: bytes.byteLength, error: error.message, loaded: false })
      }
    }
  }
  renderFolder()
  if (duplicates && !quiet) toast(`${duplicates} identisk${duplicates === 1 ? ' fil' : 'a filer'} hoppades över.`)
}

function trackFit(track) {
  if (!state.transform || !state.page || !track?.points?.length) return null
  let inside = 0
  for (const point of track.points) {
    const pixel = geoToPixel(point.lat, point.lon)
    if (pixel && pixel.x >= 0 && pixel.x <= state.width && pixel.y >= 0 && pixel.y <= state.height) inside += 1
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
  if (!folder.pdfs.length && !folder.tracks.length) return
  $('folderPanel').classList.remove('hidden')
  $('folderName').textContent = `${folder.pdfs.length + folder.tracks.length} sparade filer`
  $('folderCount').textContent = `${folder.pdfs.length + folder.tracks.length} filer`
  const pdfCard = (file, index) => `
    <div class="folder-file-card">
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)} · <i class="file-state ${file.hasGeoData ? 'geo' : ''}">${file.hasGeoData ? 'GeoPDF' : 'Utan geodata'}</i></span></div>
      <div class="file-actions"><button class="small-button" data-folder-pdf="${index}">Öppna</button><button class="small-button danger" data-delete-pdf="${index}" title="Ta bort PDF">×</button></div>
    </div>`
  const pdfGroups = [
    ['Med geodata', folder.pdfs.map((file, index) => ({ file, index })).filter(item => item.file.hasGeoData)],
    ['Utan geodata', folder.pdfs.map((file, index) => ({ file, index })).filter(item => !item.file.hasGeoData)]
  ].filter(([, items]) => items.length)
  $('folderPdfList').innerHTML = pdfGroups.length ? pdfGroups.map(([title, items]) => `<div class="folder-group"><p class="folder-group-title">${title}</p>${items.map(({ file, index }) => pdfCard(file, index)).join('')}</div>`).join('') : '<p class="empty-list">Inga PDF-filer hittades.</p>'
  const trackCard = (file, index) => `
    <div class="folder-file-card ${file.error ? 'invalid' : ''}">
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</strong><span>${file.parsed ? `${file.parsed.points.length.toLocaleString('sv-SE')} punkter · ${file.name.split('.').pop().toUpperCase()}<br><i class="file-state ${trackFit(file.parsed)?.inside ? 'geo' : ''}">${fitText(file.parsed)}</i>` : escapeHtml(file.error)}</span></div>
      <div class="file-actions"><button class="small-button" data-folder-track="${index}" ${file.error ? 'disabled' : ''}>${file.loaded ? 'Dölj' : 'Lägg till'}</button><button class="small-button danger" data-delete-track="${index}" title="Ta bort spårfil">×</button></div>
    </div>`
  const indexedTracks = folder.tracks.map((file, index) => ({ file, index, fits: (trackFit(file.parsed)?.inside || 0) > 0 }))
  const trackGroups = state.transform
    ? [['I aktuell karta', indexedTracks.filter(item => item.fits)], ['Övriga spår', indexedTracks.filter(item => !item.fits)]]
    : [['Mätspår', indexedTracks]]
  $('folderTrackList').innerHTML = indexedTracks.length ? trackGroups.filter(([, items]) => items.length).map(([title, items]) => `<div class="folder-group"><p class="folder-group-title">${title}</p>${items.map(({ file, index }) => trackCard(file, index)).join('')}</div>`).join('') : '<p class="empty-list">Inga mätspår hittades.</p>'

  document.querySelectorAll('[data-folder-pdf]').forEach(button => button.addEventListener('click', () => loadPdfFile(folder.pdfs[Number(button.dataset.folderPdf)])))
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
    renderFolder(); renderLogs(); drawOverlay()
    if (!state.library.pdfs.length && !state.library.tracks.length) $('folderPanel').classList.add('hidden')
  } catch (error) { toast(`Kunde inte ta bort filen: ${error.message}`) }
}

async function toggleFolderTrack(index) {
  const file = state.library.tracks[index]
  if (!file.parsed) return
  if (file.loaded) {
    state.logs = state.logs.filter(log => log.folderKey !== file.path)
    file.loaded = false
  } else {
    if (state.logs.some(log => log.sourceId === file.id)) {
      file.loaded = true
      renderFolder()
      return toast('Spåret är redan tillagt.')
    }
    const parsed = { ...file.parsed, color: colors[state.logs.length % colors.length], visible: true, folderKey: file.path, sourceId: file.id }
    state.logs.push(parsed)
    file.loaded = true
    await applyAutomaticWaterLevel(parsed)
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

function setScale(scale) {
  state.scale = Math.max(.2, Math.min(3, scale))
  wrap.style.width = `${state.width * state.scale}px`
  wrap.style.height = `${state.height * state.scale}px`
  pdfCanvas.style.width = overlay.style.width = `${state.width * state.scale}px`
  pdfCanvas.style.height = overlay.style.height = `${state.height * state.scale}px`
  $('zoomValue').textContent = `${Math.round(state.scale * 100)} %`
}

function updatePanSpace() {
  wrap.style.margin = `${Math.max(24, viewportElement.clientHeight / 2)}px ${Math.max(24, viewportElement.clientWidth / 2)}px`
}

function centerView() {
  viewportElement.scrollTo(
    wrap.offsetLeft + wrap.offsetWidth / 2 - viewportElement.clientWidth / 2,
    wrap.offsetTop + wrap.offsetHeight / 2 - viewportElement.clientHeight / 2
  )
}

function fitView() {
  if (!state.page) return
  const availableWidth = viewportElement.clientWidth - 52
  const availableHeight = viewportElement.clientHeight - 52
  state.fitScale = Math.min(availableWidth / state.width, availableHeight / state.height)
  updatePanSpace()
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
      context.fillStyle = depthColor(correctedDepth(log, point), min, max); context.fill()
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

async function openLogs() {
  const files = await window.sjomatning.openLogs()
  await importTrackFiles(files)
  await addLibraryFiles(files, [], true)
}

async function fileBytes(file) {
  return file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file.bytes)
}

async function contentId(file, bytes) {
  if (file.id) return file.id
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function importTrackFiles(files) {
  let duplicates = 0
  for (const file of files) {
    try {
      const bytes = await fileBytes(file)
      const id = await contentId(file, bytes)
      if (state.logs.some(log => log.sourceId === id)) { duplicates += 1; continue }
      const parsed = file.name.toLowerCase().endsWith('.trc') ? parseTrcTrack(bytes, file.name) : parseTextTrack(bytesToText(bytes), file.name)
      parsed.color = colors[state.logs.length % colors.length]
      parsed.visible = true
      parsed.sourceId = id
      parsed.depthAdjustment = 0
      parsed.pruneDistance = 0
      state.logs.push(parsed)
      await applyAutomaticWaterLevel(parsed)
      if (parsed.warnings.length) toast(`${file.name}: ${parsed.warnings.length} rader hoppades över.`)
    } catch (error) { toast(error.message) }
  }
  renderLogs()
  drawOverlay()
  if (duplicates) toast(`${duplicates} duplicerat spår hoppades över.`)
}

async function applyAutomaticWaterLevel(log) {
  const date = trackDate(log)
  if (!date) return false
  if (!waterLevelRequests.has(date)) waterLevelRequests.set(date, window.sjomatning.getRoxenWaterLevel(date).catch(() => null))
  const result = await waterLevelRequests.get(date)
  if (!result?.ok) return false
  log.waterLevel = result.data.level
  log.waterLevelSource = 'roxen'
  log.correction = Math.round((result.data.level - 33) * 100) / 100
  return true
}

function renderLogs() {
  $('logsPanel').classList.toggle('hidden', state.logs.length === 0)
  $('applyWaterLevel').classList.toggle('hidden', !state.roxenLevel || state.logs.length === 0)
  if (state.transform) {
    const fitting = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0).length
    $('logsMapSummary').textContent = `${fitting} av ${state.logs.length} spår har punkter som ryms i den aktiva kartan.`
  } else $('logsMapSummary').textContent = 'Aktivera geodata för att se vilka spår som ryms i kartan.'
  $('logList').innerHTML = state.logs.map((log, index) => {
    const visiblePoints = processedPoints(log)
    const depths = visiblePoints.map(point => correctedDepth(log, point))
    const source = log.waterLevelSource === 'roxen' ? ' · Roxen, Tekniska verken' : ''
    const correction = log.correction == null ? 'Ingen vattenståndskorrigering' : `Vattenstånd ${log.waterLevel.toFixed(2)} m${source} · korrektion ${(-log.correction).toFixed(2)} m`
    const adjustment = log.depthAdjustment ? ` · extra justering ${log.depthAdjustment > 0 ? '+' : ''}${log.depthAdjustment.toFixed(2)} m` : ''
    return `<div class="log-card" style="--log-color:${log.color}">
      <label class="log-title"><input class="log-toggle" type="checkbox" data-log="${index}" ${log.visible ? 'checked' : ''}>${log.name}</label>
      <div class="log-meta">${visiblePoints.length.toLocaleString('sv-SE')} av ${log.points.length.toLocaleString('sv-SE')} punkter · ${Math.min(...depths).toFixed(2)}–${Math.max(...depths).toFixed(2)} m<br><strong class="track-fit">${fitText(log)}</strong><br>${correction}${adjustment}</div>
      <div class="log-controls">
        <label>Vattennivå (m)<input type="number" step="0.01" data-water-level="${index}" value="${log.waterLevel == null ? '' : log.waterLevel.toFixed(2)}" placeholder="33.00"></label>
        <label>Djupjustering (m)<input type="number" step="0.01" data-depth-adjustment="${index}" value="${(log.depthAdjustment || 0).toFixed(2)}"></label>
        <label>Glesa, avstånd (m)<input type="number" min="0" max="500" step="1" data-prune-distance="${index}" value="${log.pruneDistance || 0}"></label>
      </div>
      <button class="small-button edit-track" data-edit-log="${index}">${state.editLogIndex === index ? 'Avsluta redigering' : 'Redigera punkter i kartan'}</button>
    </div>`
  }).join('')
  document.querySelectorAll('[data-log]').forEach(input => input.addEventListener('change', event => {
    state.logs[Number(event.target.dataset.log)].visible = event.target.checked
    drawOverlay()
  }))
  document.querySelectorAll('[data-water-level]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.waterLevel)]
    const level = Number(event.target.value)
    log.waterLevel = event.target.value === '' || !Number.isFinite(level) ? null : level
    log.waterLevelSource = 'manual'
    log.correction = log.waterLevel == null ? null : Math.round((log.waterLevel - 33) * 100) / 100
    renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-depth-adjustment]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.depthAdjustment)]
    log.depthAdjustment = Number(event.target.value) || 0
    renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-prune-distance]').forEach(input => input.addEventListener('change', event => {
    const log = state.logs[Number(event.target.dataset.pruneDistance)]
    log.pruneDistance = Math.max(0, Number(event.target.value) || 0)
    renderLogs(); drawOverlay()
  }))
  document.querySelectorAll('[data-edit-log]').forEach(button => button.addEventListener('click', event => {
    const index = Number(event.target.dataset.editLog)
    state.editLogIndex = state.editLogIndex === index ? null : index
    renderLogs()
    toast(state.editLogIndex == null ? 'Punktredigeringen avslutades.' : 'Klicka på en punkt i kartan för att ändra djup eller ta bort den.')
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

async function loadWaterLevel(latest = false) {
  const date = latest === true ? null : $('waterLevelDate').value
  $('fetchWaterLevel').disabled = true
  $('fetchWaterLevel').textContent = 'Hämtar…'
  $('waterLevelStatus').textContent = 'Kontaktar Tekniska verken…'
  $('applyWaterLevel').classList.add('hidden')
  try {
    const result = await window.sjomatning.getRoxenWaterLevel(date)
    if (!result.ok) {
      state.roxenLevel = null
      $('waterLevelStatus').textContent = result.message
      return
    }
    state.roxenLevel = result.data
    $('waterLevelDate').value = result.data.date
    const formattedDate = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' }).format(new Date(`${result.data.date}T12:00:00`))
    $('waterLevelStatus').innerHTML = `<strong>${result.data.level.toFixed(2)} m ö.h.</strong><span>${formattedDate} · RH00</span>`
    $('applyWaterLevel').classList.toggle('hidden', state.logs.length === 0)
  } catch (error) {
    state.roxenLevel = null
    $('waterLevelStatus').textContent = 'Vattenståndet kunde inte hämtas. Kontrollera internetanslutningen och försök igen.'
    console.error(error)
  } finally {
    $('fetchWaterLevel').disabled = false
    $('fetchWaterLevel').textContent = 'Hämta'
  }
}

function applyWaterLevel() {
  if (!state.roxenLevel || state.logs.length === 0) return
  state.logs.forEach(log => {
    log.waterLevel = state.roxenLevel.level
    log.waterLevelSource = 'roxen'
    log.correction = Math.round((state.roxenLevel.level - 33) * 100) / 100
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
  if (!state.armed && state.editLogIndex != null) {
    const log = state.logs[state.editLogIndex]
    const clicked = canvasPoint(event)
    let nearest = null
    log.points.forEach((point, index) => {
      const pixel = geoToPixel(point.lat, point.lon)
      const distance = pixel ? Math.hypot(pixel.x - clicked.x, pixel.y - clicked.y) * state.scale : Infinity
      if (!nearest || distance < nearest.distance) nearest = { point, index, distance }
    })
    if (!nearest || nearest.distance > 16) return toast('Ingen punkt tillräckligt nära. Zooma in och försök igen.')
    const answer = window.prompt(`Rådjup är ${nearest.point.depth.toFixed(2)} m. Ange nytt rådjup, eller skriv RADERA för att ta bort punkten.`, nearest.point.depth.toFixed(2))
    if (answer == null) return
    if (answer.trim().toLowerCase() === 'radera') log.points.splice(nearest.index, 1)
    else {
      const depth = Number(answer.replace(',', '.'))
      if (!Number.isFinite(depth) || depth < 0) return toast('Djupet måste vara ett positivt tal.')
      nearest.point.depth = depth
    }
    renderLogs(); drawOverlay(); toast('Spåret ändrades. Exporten använder den redigerade versionen.')
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
    $('tooltip').innerHTML = `<strong>${correctedDepth(nearest.log, nearest.point).toFixed(2)} m</strong><br>${nearest.point.date} ${nearest.point.time}<br>${nearest.point.speed.toFixed(1)} knop`
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
$('openPdf').addEventListener('click', openPdf)
$('openRoxenMap').addEventListener('click', () => loadRoxenMap())
$('openFolder').addEventListener('click', openFolder)
$('emptyOpenPdf').addEventListener('click', openPdf)
$('openLogs').addEventListener('click', openLogs)
$('fetchWaterLevel').addEventListener('click', loadWaterLevel)
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
window.addEventListener('resize', () => {
  if (!state.page) return
  if (Math.abs(state.scale - state.fitScale) < .02) fitView()
  else updatePanSpace()
})

viewportElement.addEventListener('wheel', event => {
  if (!state.page) return
  event.preventDefault()
  const point = canvasPoint(event)
  const nextScale = state.scale * Math.exp(-event.deltaY * .0015)
  setScale(nextScale)
  const rect = overlay.getBoundingClientRect()
  viewportElement.scrollLeft += rect.left + point.x * state.scale - event.clientX
  viewportElement.scrollTop += rect.top + point.y * state.scale - event.clientY
}, { passive: false })

let pan = null
let suppressClick = false
viewportElement.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !state.page) return
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: viewportElement.scrollLeft, scrollTop: viewportElement.scrollTop, moved: false }
  viewportElement.setPointerCapture(event.pointerId)
})
viewportElement.addEventListener('pointermove', event => {
  if (!pan || event.pointerId !== pan.pointerId) return
  if (!pan.moved && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) < 4) return
  if (!pan.moved) {
    pan.moved = true
    viewportElement.classList.add('panning')
    $('tooltip').classList.add('hidden')
  }
  event.preventDefault()
  viewportElement.scrollLeft = pan.scrollLeft - (event.clientX - pan.x)
  viewportElement.scrollTop = pan.scrollTop - (event.clientY - pan.y)
})
function stopPanning(event) {
  if (!pan || event.pointerId !== pan.pointerId) return
  suppressClick = pan.moved && event.type === 'pointerup'
  pan = null
  viewportElement.classList.remove('panning')
}
viewportElement.addEventListener('pointerup', stopPanning)
viewportElement.addEventListener('pointercancel', stopPanning)
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
    if (!scanned.files.length) return toast('Mappen innehåller inga PDF-, TXT-, CSV- eller TRC-filer.')
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
  const title = `Sjömätning ${version} · programmet uppdaterades senast ${buildDate}`
  document.title = title
  $('buildInfo').textContent = `v${version} · uppdaterades senast ${buildDate}`
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
  if (parsed?.type === 'position') live.position = { ...live.position, ...parsed }
  if (parsed?.type === 'depth') live.depth = parsed.depth + (Number($('liveDepthOffset').value) || 0)
  let point = null
  if (parsed?.type === 'position' && live.position && Number.isFinite(live.depth)) {
    point = { date: live.position.date || today(), time: nmeaTime(live.position.time), lat: live.position.lat, lon: live.position.lon, speed: live.position.speed || 0, depth: live.depth }
    live.log.points.push(point)
    if (live.log.points.length % 5 === 0) { renderLogs(); drawOverlay() }
  }
  await window.sjomatning.appendLiveData({ id: live.session.id, raw, point })
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
  clearTimeout(live.timer)
  await live.pending
  await live.reader?.cancel().catch(() => {})
  await live.port?.close().catch(() => {})
  await window.sjomatning.stopLiveSession(live.session.id).catch(() => {})
  $('liveBadge').textContent = 'Frånkopplad'; $('liveBadge').className = 'badge warning'
  $('simulationSpeed').disabled = false; $('startSimulator').classList.remove('hidden'); $('startCapture').classList.remove('hidden'); $('stopCapture').classList.add('hidden')
  renderLogs(); drawOverlay(); toast(`Mätningen stoppades. ${live.log.points.length} punkter sparades i realtid.`)
}

$('startCapture').addEventListener('click', startCapture)
$('stopCapture').addEventListener('click', stopCapture)

$('startSimulator').addEventListener('click', startSimulator)
