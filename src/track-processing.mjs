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
      if (!shallowest || point.depth < shallowest.depth) shallowest = point
      continue
    }
    if (shallowest && shallowest.depth < lastKept.depth - .001 && shallowest.depth < point.depth - .001) kept.push(shallowest)
    kept.push(point)
    shallowest = null
  }
  return kept
}

export function processedPoints(track) {
  return prunePoints(track.points, track.pruneDistance || 0)
}

export function adjustedDepth(track, point) {
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
        csvCell(track.name), point.date, point.time, point.lat.toFixed(7), point.lon.toFixed(7),
        point.speed.toFixed(1), point.depth.toFixed(2), adjustedDepth(track, point).toFixed(2)
      ].join(';'))
    }
  }
  return `${rows.join('\r\n')}\r\n`
}

export function exportWaypoints(tracks) {
  const rows = ['Datum,WGS84,WGS84,0,0,0,0,0']
  tracks.forEach((track, trackIndex) => {
    const prefix = String.fromCharCode(65 + (trackIndex % 26))
    processedPoints(track).forEach((point, pointIndex) => {
      const id = `${prefix}${String(pointIndex + 1).padStart(4, '0')}`
      rows.push(`WP,D,${id} ${adjustedDepth(track, point).toFixed(2)},${point.lat.toFixed(7)},${point.lon.toFixed(7)},,,Ekolod:${point.depth.toFixed(2)}`)
    })
  })
  return `${rows.join('\r\n')}\r\n`
}
