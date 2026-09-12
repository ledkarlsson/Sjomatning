import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'
import { parseTextTrack, parseTrcTrack } from './track-parser.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const colors = ['#e14b3b', '#087f8c', '#7855a6', '#d58416', '#2e6db4']
const state = { pdf: null, pdfKey: null, activePdfId: null, page: null, width: 0, height: 0, scale: 1, fitScale: 1, calibration: [], transform: null, logs: [], armed: false, roxenLevel: null, library: { folders: [], pdfs: [], tracks: [] } }
const $ = id => document.getElementById(id)
const pdfCanvas = $('pdfCanvas')
const overlay = $('overlayCanvas')
const wrap = $('canvasWrap')
const viewportElement = $('viewport')

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
  const t = state.transform
  if (!t) return null
  if (t.type === 'axis') return { lon: t.lonScale * x + t.lonOffset, lat: t.latScale * y + t.latOffset }
  return { lon: t.lon[0] * x + t.lon[1] * y + t.lon[2], lat: t.lat[0] * x + t.lat[1] * y + t.lat[2] }
}

async function loadPdfFile(file) {
  try {
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file.bytes)
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
  $('folderPdfList').innerHTML = folder.pdfs.length ? folder.pdfs.map((file, index) => `
    <div class="folder-file-card">
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)} · <i class="file-state ${file.hasGeoData ? 'geo' : ''}">${file.hasGeoData ? 'GeoPDF' : 'Utan geodata'}</i></span></div>
      <div class="file-actions"><button class="small-button" data-folder-pdf="${index}">Öppna</button><button class="small-button danger" data-delete-pdf="${index}" title="Ta bort PDF">×</button></div>
    </div>`).join('') : '<p class="empty-list">Inga PDF-filer hittades.</p>'
  $('folderTrackList').innerHTML = folder.tracks.length ? folder.tracks.map((file, index) => `
    <div class="folder-file-card ${file.error ? 'invalid' : ''}">
      <div class="folder-file-main"><strong title="${escapeHtml(file.relativePath)}">${escapeHtml(file.name)}</strong><span>${file.parsed ? `${file.parsed.points.length.toLocaleString('sv-SE')} punkter · ${file.name.split('.').pop().toUpperCase()}<br><i class="file-state ${trackFit(file.parsed)?.inside ? 'geo' : ''}">${fitText(file.parsed)}</i>` : escapeHtml(file.error)}</span></div>
      <div class="file-actions"><button class="small-button" data-folder-track="${index}" ${file.error ? 'disabled' : ''}>${file.loaded ? 'Dölj' : 'Lägg till'}</button><button class="small-button danger" data-delete-track="${index}" title="Ta bort spårfil">×</button></div>
    </div>`).join('') : '<p class="empty-list">Inga mätspår hittades.</p>'

  document.querySelectorAll('[data-folder-pdf]').forEach(button => button.addEventListener('click', () => loadPdfFile(folder.pdfs[Number(button.dataset.folderPdf)])))
  document.querySelectorAll('[data-folder-track]').forEach(button => button.addEventListener('click', () => toggleFolderTrack(Number(button.dataset.folderTrack))))
  document.querySelectorAll('[data-delete-pdf]').forEach(button => button.addEventListener('click', () => deleteLibraryFile('pdf', Number(button.dataset.deletePdf))))
  document.querySelectorAll('[data-delete-track]').forEach(button => button.addEventListener('click', () => deleteLibraryFile('track', Number(button.dataset.deleteTrack))))
}

function clearActivePdf() {
  state.pdf = null; state.page = null; state.activePdfId = null; state.transform = null; state.calibration = []
  pdfCanvas.getContext('2d').clearRect(0, 0, pdfCanvas.width, pdfCanvas.height)
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height)
  wrap.classList.add('hidden'); $('documentPanel').classList.add('hidden'); $('calibrationPanel').classList.add('hidden')
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

function toggleFolderTrack(index) {
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
  }
  renderFolder(); renderLogs(); drawOverlay()
}

function updateGeoStatus() {
  const badge = $('geoBadge')
  if (state.transform) {
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

function fitView() {
  if (!state.page) return
  const availableWidth = viewportElement.clientWidth - 52
  const availableHeight = viewportElement.clientHeight - 52
  state.fitScale = Math.min(availableWidth / state.width, availableHeight / state.height)
  setScale(state.fitScale)
  viewportElement.scrollTo(0, 0)
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
  const allDepths = state.logs.flatMap(log => log.visible ? log.points.map(point => correctedDepth(log, point)) : [])
  const min = Math.min(...allDepths)
  const max = Math.max(...allDepths)

  state.logs.filter(log => log.visible).forEach(log => {
    context.beginPath()
    let started = false
    log.points.forEach(point => {
      const pixel = geoToPixel(point.lat, point.lon)
      if (!pixel) return
      if (!started) { context.moveTo(pixel.x, pixel.y); started = true } else context.lineTo(pixel.x, pixel.y)
    })
    context.strokeStyle = log.color; context.globalAlpha = .72; context.lineWidth = 2.2; context.stroke(); context.globalAlpha = 1
    const stride = Math.max(1, Math.ceil(log.points.length / 1100))
    log.points.forEach((point, index) => {
      if (index % stride) return
      const pixel = geoToPixel(point.lat, point.lon)
      if (!pixel || pixel.x < 0 || pixel.x > state.width || pixel.y < 0 || pixel.y > state.height) return
      context.beginPath(); context.arc(pixel.x, pixel.y, 2.4, 0, Math.PI * 2)
      context.fillStyle = depthColor(correctedDepth(log, point), min, max); context.fill()
    })
  })
}

function correctedDepth(log, point) {
  return log.correction == null ? point.depth : point.depth - log.correction
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
      state.logs.push(parsed)
      if (parsed.warnings.length) toast(`${file.name}: ${parsed.warnings.length} rader hoppades över.`)
    } catch (error) { toast(error.message) }
  }
  renderLogs()
  drawOverlay()
  if (duplicates) toast(`${duplicates} duplicerat spår hoppades över.`)
}

function renderLogs() {
  $('logsPanel').classList.toggle('hidden', state.logs.length === 0)
  $('applyWaterLevel').classList.toggle('hidden', !state.roxenLevel || state.logs.length === 0)
  if (state.transform) {
    const fitting = state.logs.filter(log => (trackFit(log)?.inside || 0) > 0).length
    $('logsMapSummary').textContent = `${fitting} av ${state.logs.length} spår har punkter som ryms i den aktiva kartan.`
  } else $('logsMapSummary').textContent = 'Aktivera geodata för att se vilka spår som ryms i kartan.'
  $('logList').innerHTML = state.logs.map((log, index) => {
    const depths = log.points.map(point => correctedDepth(log, point))
    const source = log.waterLevelSource === 'roxen' ? ' · Roxen, Tekniska verken' : ''
    const correction = log.correction == null ? 'Ingen vattenståndskorrigering' : `Vattenstånd ${log.waterLevel.toFixed(2)} m${source} · korrektion −${log.correction.toFixed(2)} m`
    return `<div class="log-card" style="--log-color:${log.color}">
      <label class="log-title"><input class="log-toggle" type="checkbox" data-log="${index}" ${log.visible ? 'checked' : ''}>${log.name}</label>
      <div class="log-meta">${log.points.length.toLocaleString('sv-SE')} punkter · ${Math.min(...depths).toFixed(2)}–${Math.max(...depths).toFixed(2)} m<br><strong class="track-fit">${fitText(log)}</strong><br>${correction}</div>
    </div>`
  }).join('')
  document.querySelectorAll('[data-log]').forEach(input => input.addEventListener('change', event => {
    state.logs[Number(event.target.dataset.log)].visible = event.target.checked
    drawOverlay()
  }))
}

async function loadWaterLevel() {
  const date = $('waterLevelDate').value
  if (!date) return toast('Välj först en dag.')
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
    const formattedDate = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long' }).format(new Date(`${date}T12:00:00`))
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
  if (!state.transform) return
  const point = canvasPoint(event)
  const geo = pixelToGeo(point.x, point.y)
  $('cursorPosition').textContent = `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`
  let nearest = null
  state.logs.filter(log => log.visible).forEach(log => {
    const stride = Math.max(1, Math.ceil(log.points.length / 1000))
    for (let i = 0; i < log.points.length; i += stride) {
      const pixel = geoToPixel(log.points[i].lat, log.points[i].lon)
      const distance = pixel ? Math.hypot(pixel.x - point.x, pixel.y - point.y) * state.scale : Infinity
      if (distance < 10 && (!nearest || distance < nearest.distance)) nearest = { log, point: log.points[i], distance }
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
$('openFolder').addEventListener('click', openFolder)
$('emptyOpenPdf').addEventListener('click', openPdf)
$('openLogs').addEventListener('click', openLogs)
$('fetchWaterLevel').addEventListener('click', loadWaterLevel)
$('applyWaterLevel').addEventListener('click', applyWaterLevel)
$('zoomIn').addEventListener('click', () => setScale(state.scale * 1.2))
$('zoomOut').addEventListener('click', () => setScale(state.scale / 1.2))
$('fitView').addEventListener('click', fitView)
window.addEventListener('resize', () => { if (state.page && Math.abs(state.scale - state.fitScale) < .02) fitView() })

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

$('waterLevelDate').value = new Date().toLocaleDateString('sv-SE')

window.sjomatning.listLibrary().then(files => addLibraryFiles(files, [], true)).catch(error => toast(`Kunde inte läsa biblioteket: ${error.message}`))

window.sjomatning.getAppInfo().then(({ version, buildDate }) => {
  const title = `Sjömätning ${version} · byggd ${buildDate}`
  document.title = title
  $('buildInfo').textContent = `v${version} · ${buildDate}`
})

window.sjomatning.onUpdaterStatus(({ status, detail }) => {
  const messages = {
    checking: 'Söker efter uppdateringar…', current: 'Programmet är uppdaterat.',
    available: `Version ${detail} hittades och hämtas…`, downloading: `Hämtar uppdatering: ${detail} %`,
    ready: `Version ${detail} är klar att installeras.`, error: `Uppdateringskontrollen misslyckades: ${detail}`
  }
  $('updateText').textContent = messages[status] || ''
  $('updateBar').classList.toggle('hidden', !messages[status])
  $('installUpdate').classList.toggle('hidden', status !== 'ready')
})
$('installUpdate').addEventListener('click', () => window.sjomatning.installUpdate())
