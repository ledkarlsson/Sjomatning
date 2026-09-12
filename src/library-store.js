const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

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
        id, name: file.name, relativePath: file.relativePath || file.name,
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

  return { persist, list, remove }
}

module.exports = { createLibraryStore }
