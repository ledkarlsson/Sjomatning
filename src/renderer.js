import * as pdfjsLib from '../node_modules/pdfjs-dist/legacy/build/pdf.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href

const colors = ['#e14b3b', '#087f8c', '#7855a6', '#d58416', '#2e6db4']
const state = { pdf: null, pdfKey: null, page: null, width: 0, height: 0, scale: 1, fitScale: 1, calibration: [], transform: null, logs: [], armed: false }
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
  if (file) await loadPdfFile(file)
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
  for (const file of files) {
    try {
      const parsed = parseLog(bytesToText(new Uint8Array(file.bytes)), file.name)
      parsed.color = colors[state.logs.length % colors.length]
      parsed.visible = true
      state.logs.push(parsed)
      if (parsed.warnings.length) toast(`${file.name}: ${parsed.warnings.length} rader hoppades över.`)
    } catch (error) { toast(error.message) }
  }
  renderLogs()
  drawOverlay()
}

function parseLog(text, name) {
  const points = []
  const warnings = []
  text.split(/\r\r?\n|\n|\r/).forEach((line, index) => {
    if (!line.trim()) return
    const cells = line.split(',').map(value => value.trim())
    if (cells.length !== 6) { warnings.push(index + 1); return }
    const [date, time] = cells
    const [lat, lon, speed, depth] = cells.slice(2).map(Number)
    if (![lat, lon, speed, depth].every(Number.isFinite)) { warnings.push(index + 1); return }
    points.push({ date, time, lat, lon, speed, depth })
  })
  if (!points.length) throw new Error(`${name} innehåller inga giltiga mätpunkter.`)
  const match = name.match(/^\d{8}_(\d{2}[.,]\d{2})_/)
  const waterLevel = match ? Number(match[1].replace(',', '.')) : null
  return { name, points, warnings, waterLevel, correction: waterLevel == null ? null : Math.round((waterLevel - 33) * 100) / 100 }
}

function renderLogs() {
  $('logsPanel').classList.toggle('hidden', state.logs.length === 0)
  $('logList').innerHTML = state.logs.map((log, index) => {
    const depths = log.points.map(point => correctedDepth(log, point))
    const correction = log.correction == null ? 'Ingen vattenståndskorrigering' : `Vattenstånd ${log.waterLevel.toFixed(2)} m · korrektion −${log.correction.toFixed(2)} m`
    return `<div class="log-card" style="--log-color:${log.color}">
      <label class="log-title"><input class="log-toggle" type="checkbox" data-log="${index}" ${log.visible ? 'checked' : ''}>${log.name}</label>
      <div class="log-meta">${log.points.length.toLocaleString('sv-SE')} punkter · ${Math.min(...depths).toFixed(2)}–${Math.max(...depths).toFixed(2)} m<br>${correction}</div>
    </div>`
  }).join('')
  document.querySelectorAll('[data-log]').forEach(input => input.addEventListener('change', event => {
    state.logs[Number(event.target.dataset.log)].visible = event.target.checked
    drawOverlay()
  }))
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
$('emptyOpenPdf').addEventListener('click', openPdf)
$('openLogs').addEventListener('click', openLogs)
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
  const files = [...event.dataTransfer.files]
  const pdf = files.find(file => file.name.toLowerCase().endsWith('.pdf'))
  if (!pdf) return toast('Släpp en PDF-fil för att öppna ett fältmanus.')
  if (files.length > 1) toast('Den första PDF-filen öppnas som fältmanus.')
  await loadPdfFile(pdf)
})

window.sjomatning.launchPdf().then(file => {
  if (file) loadPdfFile(file)
})
