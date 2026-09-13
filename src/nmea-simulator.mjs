// Fictitious circular survey route on Roxen; depths are not chart data.
export function nmeaSentence(payload) {
  let checksum = 0
  for (const character of payload) checksum ^= character.charCodeAt(0)
  return `$${payload}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`
}

function coordinate(value, digits) {
  const degrees = Math.floor(Math.abs(value))
  return String(degrees).padStart(digits, '0') + ((Math.abs(value) - degrees) * 60).toFixed(5).padStart(8, '0')
}

export function simulationFrame(seconds, epoch = new Date()) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid simulation time')
  const radius = 900
  const speed = 5 // knots
  const angle = seconds * speed * 1852 / 3600 / radius
  const lat = 58.505 + radius * Math.cos(angle) / 111320
  const lon = 15.63 + radius * Math.sin(angle) / (111320 * Math.cos(58.505 * Math.PI / 180))
  const course = (angle * 180 / Math.PI + 90) % 360
  const depth = 5 + 1.8 * Math.sin(angle * 3) + .6 * Math.cos(angle * 7)
  const date = new Date(epoch.getTime() + seconds * 1000)
  const iso = date.toISOString()
  const time = iso.slice(11, 19).replaceAll(':', '') + '.00'
  const day = iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(2, 4)
  return { lat, lon, depth, course, speed, sentences: [
    nmeaSentence(`SDDPT,${depth.toFixed(2)},0.0`),
    nmeaSentence(`GPRMC,${time},A,${coordinate(lat, 2)},N,${coordinate(lon, 3)},E,${speed.toFixed(1)},${course.toFixed(1)},${day},,,A`)
  ] }
}
