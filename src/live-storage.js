const fs = require('node:fs/promises')
const path = require('node:path')

// A completion marker is written only after the library has accepted the CSV.
// Interrupted sessions remain available for recovery on the next application start.
async function recoverSessions(root, persist, io = fs) {
  const entries = await io.readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const folder = path.join(root, entry.name)
    try { await io.access(path.join(folder, 'completed')); continue } catch (error) { if (error.code !== 'ENOENT') throw error }
    const csv = path.join(folder, 'track.csv')
    let text
    try { text = await io.readFile(csv, 'utf8') } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    // Ignore an incomplete final write; keep the original bytes untouched.
    const complete = text.slice(0, text.lastIndexOf('\n') + 1)
    if (complete.trim().split('\n').length < 2) continue
    await persist({ name: `${entry.name}.csv`, bytes: Buffer.from(complete), path: csv })
    await io.writeFile(path.join(folder, 'completed'), '', 'utf8')
  }
}

async function appendSample(target, raw, point, io = fs) {
  if (target.failure) throw target.failure
  try {
    if (raw) await io.appendFile(target.rawPath, `${String(raw).replace(/[\r\n]+/g, '')}\r\n`, 'utf8')
    if (point) {
      if (![point.lat, point.lon].every(Number.isFinite) || ![point.speed, point.depth].every(v => v == null || Number.isFinite(v))) throw new Error('Ogiltig GPS-punkt.')
      await io.appendFile(target.csvPath, [point.date, point.time, point.lat, point.lon, point.speed, point.depth].join(',') + '\r\n', 'utf8')
    }
  } catch (error) { target.failure = error; throw error }
}
module.exports = { recoverSessions, appendSample }
