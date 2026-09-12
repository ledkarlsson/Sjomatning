function parseNumber(value) {
  const number = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function waterLevelFromName(name) {
  const match = name.match(/^\d{8}_(\d{2}[.,]\d{2})_/)
  return match ? parseNumber(match[1]) : null
}

function parseMeasurementLog(text, name = 'Mätlogg') {
  const points = []
  const warnings = []
  const lines = text.split(/\r\r?\n|\n|\r/)

  lines.forEach((line, index) => {
    if (!line.trim()) return
    const fields = line.split(',').map(value => value.trim())
    if (fields.length !== 6) {
      warnings.push(`Rad ${index + 1}: förväntade 6 fält`)
      return
    }

    const [date, time] = fields
    const lat = parseNumber(fields[2])
    const lon = parseNumber(fields[3])
    const speed = parseNumber(fields[4])
    const depth = parseNumber(fields[5])
    const timestamp = new Date(`${date}T${time}`)

    if (![lat, lon, speed, depth].every(Number.isFinite) || Number.isNaN(timestamp.valueOf())) {
      warnings.push(`Rad ${index + 1}: ogiltiga mätvärden`)
      return
    }
    points.push({ date, time, timestamp, lat, lon, speed, depth })
  })

  if (!points.length) throw new Error(`${name} innehåller inga giltiga mätpunkter.`)
  const level = waterLevelFromName(name)
  return {
    name,
    points,
    warnings,
    waterLevel: level,
    correction: level == null ? null : Math.round((level - 33) * 100) / 100,
    bounds: {
      minLat: Math.min(...points.map(point => point.lat)),
      maxLat: Math.max(...points.map(point => point.lat)),
      minLon: Math.min(...points.map(point => point.lon)),
      maxLon: Math.max(...points.map(point => point.lon))
    }
  }
}

module.exports = { parseMeasurementLog, waterLevelFromName }
