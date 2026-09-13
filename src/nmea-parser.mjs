function coordinate(value, hemisphere) {
  const raw = Number(value)
  if (!value || !Number.isFinite(raw) || raw < 0 || !['N','S','E','W'].includes(hemisphere) || raw % 100 >= 60) return null
  const degrees = Math.floor(raw / 100)
  const result = degrees + (raw - degrees * 100) / 60
  if (result > (['N','S'].includes(hemisphere) ? 90 : 180)) return null
  return hemisphere === 'S' || hemisphere === 'W' ? -result : result
}

function checksumValid(sentence) {
  const match = sentence.match(/^\$([^*]+)\*([0-9A-F]{2})$/i)
  if (!match) return !sentence.includes('*')
  let checksum = 0
  for (const character of match[1]) checksum ^= character.charCodeAt(0)
  return checksum === Number.parseInt(match[2], 16)
}

export function parseNmeaSentence(input) {
  const sentence = String(input || '').trim()
  if (!sentence.startsWith('$') || !checksumValid(sentence)) return null
  const cells = sentence.replace(/\*[0-9A-F]{2}$/i, '').split(',')
  const type = cells[0].slice(-3)
  if (type === 'GGA') {
    const lat = coordinate(cells[2], cells[3]); const lon = coordinate(cells[4], cells[5])
    if (lat == null || lon == null || !Number.isFinite(Number(cells[6])) || Number(cells[6]) < 1) return { type: 'gps-invalid' }
    return { type: 'position', time: cells[1], lat, lon, satellites: Number(cells[7]) || 0 }
  }
  if (type === 'RMC') {
    const lat = coordinate(cells[3], cells[4]); const lon = coordinate(cells[5], cells[6])
    if (cells[2] !== 'A' || lat == null || lon == null) return { type: 'gps-invalid' }
    const rawDate = cells[9] || ''
    const date = rawDate.length === 6 ? `20${rawDate.slice(4, 6)}-${rawDate.slice(2, 4)}-${rawDate.slice(0, 2)}` : ''
    return { type: 'position', time: cells[1], date, lat, lon, speed: cells[7] && Number.isFinite(Number(cells[7])) ? Number(cells[7]) : null, course: cells[8] && Number.isFinite(Number(cells[8])) && Number(cells[8]) >= 0 && Number(cells[8]) < 360 ? Number(cells[8]) : null }
  }
  if (type === 'DPT') {
    const depth = Number(cells[1]); const offset = Number(cells[2])
    return cells[1] !== '' && Number.isFinite(depth) && depth >= 0 ? { type: 'depth', depth, instrumentOffset: Number.isFinite(offset) ? offset : 0 } : { type: 'depth-invalid' }
  }
  if (type === 'DBT') {
    const depth = Number(cells[3])
    return cells[3] !== '' && Number.isFinite(depth) && depth >= 0 ? { type: 'depth', depth, instrumentOffset: 0 } : { type: 'depth-invalid' }
  }
  return null
}
