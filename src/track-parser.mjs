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
    points.push({ date, time, lat, lon, speed, depth })
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
    points.push({ date, time: '', lat, lon, speed: 0, depth })
  }
  if (!points.length) throw new Error(`${name} innehåller inga giltiga mätpunkter.`)
  return { name, points, warnings, waterLevel, correction }
}
