// Retain source text precision while keeping full coordinates for calculations.
export function formatCoordinate(point, field) {
  const original = point.coordinateText?.[field]
  if (original != null && Number(original) === point[field]) return original
  return point.coordinateDecimals == null ? String(point[field]) : point[field].toFixed(point.coordinateDecimals)
}

const EARTH_RADIUS_METERS = 6371008.8

export function distanceMeters(a, b) {
  const toRadians = value => value * Math.PI / 180
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const deltaLat = lat2 - lat1
  const deltaLon = toRadians(b.lon - a.lon)
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Samma arbetsprincip som Pythonunderlaget: håll önskat punktavstånd, men
// behåll den grundaste mellanpunkten om den är grundare än båda ändpunkterna.
export function prunePoints(points, minimumDistance = 25) {
  const distance = Number(minimumDistance)
  if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(distance) || distance <= 0) return [...(points || [])]
  const kept = [points[0]]
  let shallowest = null
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    const lastKept = kept[kept.length - 1]
    if (distanceMeters(lastKept, point) < distance && index < points.length - 1) {
      if (Number.isFinite(point.depth) && (!shallowest || point.depth < shallowest.depth)) shallowest = point
      continue
    }
    if (shallowest && Number.isFinite(lastKept.depth) && Number.isFinite(point.depth) && shallowest.depth < lastKept.depth - .001 && shallowest.depth < point.depth - .001) kept.push(shallowest)
    kept.push(point)
    shallowest = null
  }
  return kept
}

export function processedPoints(track) {
  return prunePoints(track.points, track.pruneDistance || 0)
}

export function adjustedDepth(track, point) {
  if (!Number.isFinite(point.depth)) return NaN
  const correction = Number.isFinite(track.correction) ? track.correction : 0
  const adjustment = Number.isFinite(track.depthAdjustment) ? track.depthAdjustment : 0
  return point.depth - correction + adjustment
}

export function trackDate(track) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(track?.date || '')) return track.date
  return track?.points?.find(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date || ''))?.date || null
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[";,\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function exportCsv(tracks) {
  const rows = ['Spår;Datum;Tid;Latitud;Longitud;Fart_knop;Rådjup_m;Justerat_djup_m']
  for (const track of tracks) {
    for (const point of processedPoints(track)) {
      rows.push([
        csvCell(track.name), point.date, point.time, formatCoordinate(point, 'lat'), formatCoordinate(point, 'lon'),
        point.speed ?? '', point.depth ?? '', Number.isFinite(point.depth) ? adjustedDepth(track, point).toFixed(2) : ''
      ].join(';'))
    }
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`
}

export function exportWaypoints(tracks) {
  const rows = ['Datum,WGS84,WGS84,0,0,0,0,0']
  tracks.forEach((track, trackIndex) => {
    const prefix = String.fromCharCode(65 + (trackIndex % 26))
    processedPoints(track).forEach((point, pointIndex) => {
      if (!Number.isFinite(point.depth)) return
      const id = `${prefix}${String(pointIndex + 1).padStart(4, '0')}`
      rows.push(`WP,D,${id} ${adjustedDepth(track, point).toFixed(2)},${formatCoordinate(point, 'lat')},${formatCoordinate(point, 'lon')},,,Ekolod:${point.depth.toFixed(2)}`)
    })
  })
  return `${rows.join('\r\n')}\r\n`
}

// Index on the Earth's 3-D surface to find nearby measurements without an
// all-pairs scan; this also handles longitude wraparound and high latitudes.
export function compareTrackPoints(reference, track, radius = 10) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Ogiltig jämförelseradie.')
  const cell = point => {
    const lat = point.lat * Math.PI / 180, lon = point.lon * Math.PI / 180
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)].map(value => Math.floor(value * EARTH_RADIUS_METERS / radius))
  }
  const grid = new Map()
  reference.points.forEach((point, index) => {
    if (!Number.isFinite(point.depth)) return
    const key = cell(point).join(',')
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push({ point, index })
  })
  const pairs = []
  track.points.forEach((point, index) => {
    if (!Number.isFinite(point.depth)) return
    const [x,y,z] = cell(point)
    let nearest = null
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const candidate of grid.get([x+dx,y+dy,z+dz].join(',')) || []) {
        const distance = distanceMeters(point, candidate.point)
        if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { ...candidate, distance }
      }
    }
    if (nearest) pairs.push({ index, referenceIndex: nearest.index, distance: nearest.distance, delta: adjustedDepth(track, point) - adjustedDepth(reference, nearest.point) })
  })
  return pairs
}
