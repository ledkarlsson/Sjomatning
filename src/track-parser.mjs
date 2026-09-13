function metadataFromName(name) {
  const levelMatch = name.match(/^\d{8}_(\d{2}[.,]\d{1,2})[ _]/)
  const dateMatch = name.match(/^(\d{4})(\d{2})(\d{2})/)
  const waterLevel = levelMatch ? Number(levelMatch[1].replace(',', '.')) : null
  return {
    date: dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '',
    waterLevel,
    correction: waterLevel == null ? null : Math.round((waterLevel - 33) * 100) / 100
  }
}

export function parseTextTrack(text, name) {
  const points = []
  const warnings = []
  text.split(/\r\r?\n|\n|\r/).forEach((line, index) => {
    if (!line.trim()) return
    const cells = line.split(',').map(value => value.trim())
    if (cells[0] === 'Datum') return
    let date, time, lat, lon, speed, depth
    if (cells[0] === 'WP' && cells[1] === 'D') {
      ;({ date } = metadataFromName(name))
      time = ''
      lat = Number(cells[3]); lon = Number(cells[4]); speed = 0
      const depthMatch = line.match(/Ekolod:\s*(-?\d+(?:[.,]\d+)?)/i)
      depth = depthMatch ? Number(depthMatch[1].replace(',', '.')) : NaN
    } else if (cells.length === 6) {
      ;[date, time] = cells
      ;[lat, lon, speed, depth] = cells.slice(2).map(Number)
    } else { warnings.push(index + 1); return }
    if (![lat, lon, speed, depth].every(Number.isFinite)) { warnings.push(index + 1); return }
    points.push({ date, time, lat, lon, speed, depth, coordinateText: { lat: cells[cells[0] === 'WP' ? 3 : 2], lon: cells[cells[0] === 'WP' ? 4 : 3] } })
  })
  if (!points.length) throw new Error(`${name} innehåller inga giltiga mätpunkter.`)
  return { name, points, warnings, ...metadataFromName(name) }
}

export function parseTrcTrack(bytes, name) {
  const recordSize = 30
  if (bytes.byteLength < recordSize || bytes.byteLength % recordSize !== 0) throw new Error(`${name} har ett okänt TRC-format.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { date, waterLevel, correction } = metadataFromName(name)
  const points = []
  const warnings = []
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += recordSize, index += 1) {
    const lat = view.getInt32(offset, true) / 60000
    const lon = view.getInt32(offset + 4, true) / 60000
    const depth = view.getUint16(offset + 28, true) / 10
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { warnings.push(index + 1); continue }
    points.push({ date, time: '', lat, lon, coordinateDecimals: 5, speed: 0, depth })
  }
  if (!points.length) throw new Error(`${name} innehåller inga giltiga mätpunkter.`)
  return { name, points, warnings, waterLevel, correction }
}

// Lowrance SL2/SL3 frame layouts documented by opensounder:
// https://github.com/opensounder/sounder-log-formats/tree/master/lowrance
// Imports navigation/depth records, not acoustic image samples. Unknown clock
// epochs are deliberately not converted into invented absolute timestamps.
export function parseLowranceTrack(bytes, name) {
  if (bytes.byteLength < 8) throw new Error(`${name}: avkortad Lowrance-header.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const format = view.getUint16(0, true), version = view.getUint16(2, true)
  if (![2,3].includes(format) || ![0,1].includes(version)) throw new Error(`${name}: Lowrance-format/version stöds inte.`)
  const sl2 = format === 2, header = sl2 ? 144 : 128
  const points = [], warnings = []
  for (let offset = 8; offset < bytes.byteLength;) {
    if (offset + header > bytes.byteLength) { warnings.push(`Avkortad slutpost vid byte ${offset}`); break }
    const size = view.getUint16(offset + (sl2 ? 28 : 8), true)
    const channel = view.getUint16(offset + (sl2 ? 32 : 12), true)
    const minimum = sl2 ? 144 : channel <= 5 ? 168 : 128
    if (size < minimum) throw new Error(`${name}: ogiltig postlängd vid byte ${offset}.`)
    if (offset + size > bytes.byteLength) { warnings.push(`Avkortad slutpost vid byte ${offset}`); break }
    const flags = view.getUint16(offset + (sl2 ? 132 : 116), true)
    if (channel <= 1 && (flags & 0x10)) {
      const x = view.getInt32(offset + (sl2 ? 108 : 92), true)
      const y = view.getInt32(offset + (sl2 ? 112 : 96), true)
      const lon = x / 6356752.3142 * 180 / Math.PI
      const lat = (2 * Math.atan(Math.exp(y / 6356752.3142)) - Math.PI / 2) * 180 / Math.PI
      const depth = view.getFloat32(offset + (sl2 ? 64 : 48), true) * .3048
      const gpsSpeed = view.getFloat32(offset + (sl2 ? 100 : 84), true)
      if ([lat, lon, depth].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && depth >= 0) {
        points.push({ date: '', time: '', lat, lon, coordinateDecimals: 5, depth, speed: (flags & 2) && Number.isFinite(gpsSpeed) && gpsSpeed >= 0 ? gpsSpeed : 0, elapsedMs: view.getUint32(offset + (sl2 ? 140 : 124), true), channel })
      } else warnings.push(`Ogiltig mätning vid byte ${offset}`)
    }
    offset += size
  }
  if (!points.length) throw new Error(`${name}: inga giltiga GPS/djup-punkter på primär eller sekundär ekolodskanal.`)
  return { name, points, warnings, ...metadataFromName(name) }
}
