const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { validateAnnotations } = require('./manuscript-annotations')

function createLibraryStore(rootPath) {
  const filesPath = path.join(rootPath, 'files')
  const indexPath = path.join(rootPath, 'index.json')

  async function readIndex() {
    try {
      const records = JSON.parse(await fs.readFile(indexPath, 'utf8'))
      return Array.isArray(records) ? records : []
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  async function writeIndex(records) {
    await fs.mkdir(rootPath, { recursive: true })
    const temporaryPath = `${indexPath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(records, null, 2))
    await fs.rename(temporaryPath, indexPath)
  }

  async function persist(files) {
    await fs.mkdir(filesPath, { recursive: true })
    const records = await readIndex()
    const known = new Set(records.map(record => record.id))
    for (const file of files) {
      const bytes = Buffer.from(file.bytes)
      const id = file.id || crypto.createHash('sha256').update(bytes).digest('hex')
      if (known.has(id)) continue
      const extension = path.extname(file.name).toLowerCase()
      await fs.writeFile(path.join(filesPath, `${id}${extension}`), bytes)
      records.push({
        id, name: file.name, originalName: file.name, relativePath: file.relativePath || file.name,
        extension, size: bytes.byteLength, addedAt: new Date().toISOString()
      })
      known.add(id)
    }
    await writeIndex(records)
    return records
  }

  async function list() {
    const records = await readIndex()
    const available = []
    for (const record of records) {
      try {
        available.push({ ...record, path: path.join(filesPath, `${record.id}${record.extension}`), bytes: await fs.readFile(path.join(filesPath, `${record.id}${record.extension}`)) })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    if (available.length !== records.length) await writeIndex(available.map(({ bytes, path: storedPath, ...record }) => record))
    return available
  }

  async function remove(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Ogiltigt fil-id.')
    const records = await readIndex()
    const record = records.find(item => item.id === id)
    if (!record) return false
    await fs.unlink(path.join(filesPath, `${id}${record.extension}`)).catch(error => { if (error.code !== 'ENOENT') throw error })
    await writeIndex(records.filter(item => item.id !== id))
    return true
  }

  // Serialize index mutations so simultaneous edits never overwrite each other.
  let pending = Promise.resolve()
  const serial = operation => (...args) => {
    const result = pending.then(() => operation(...args))
    pending = result.catch(() => {})
    return result
  }
  async function update(id, changes) {
    const records = await readIndex()
    const record = records.find(item => item.id === id)
    if (!record) throw new Error('Filen finns inte i biblioteket.')
    if (changes.name !== undefined) {
      const name = String(changes.name).trim()
      if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name) || name.length > 240) throw new Error('Ogiltigt filnamn.')
      record.originalName ||= record.name
      record.name = name.toLowerCase().endsWith(record.extension) ? name : name + record.extension
    }
    if (changes.annotations !== undefined) {
      if (!/\.(pdf|kap|wci)$/i.test(record.extension)) throw new Error('Anteckningar kräver ett fältmanus.')
      record.annotations = validateAnnotations(changes.annotations)
    }
    if (changes.edits !== undefined) record.edits = changes.edits
    await writeIndex(records)
    return record
  }
  return { persist: serial(persist), list: serial(list), remove: serial(remove), update: serial(update) }
}

module.exports = { createLibraryStore }
