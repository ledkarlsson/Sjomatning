const fs = require('node:fs/promises')

function createCloudCredentials(filePath, safeStorage) {
  function available() {
    return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
  }
  return {
    async read() {
      let bytes
      try { bytes = await fs.readFile(filePath) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
      if (!available()) throw new Error('Säker nyckellagring är inte tillgänglig. Försök igen senare.')
      try { return safeStorage.decryptString(bytes) } catch { return null }
    },
    async save(token) {
      if (!available()) throw new Error('Säker nyckellagring är inte tillgänglig. Nyckeln kunde inte sparas.')
      await fs.writeFile(filePath + '.tmp', safeStorage.encryptString(token), { mode: 0o600 })
      await fs.rename(filePath + '.tmp', filePath)
    },
    async clear() { await fs.rm(filePath, { force: true }) }
  }
}

async function syncWithSavedKey(credentials, sync, options = {}) {
  const token = options.token === undefined ? await credentials.read() : options.token?.trim()
  if (!token || token.length > 1024) return { needsToken: true, message: 'Ange din åtkomstnyckel.' }
  try {
    return await sync({ ...options, token, onAuthenticated: () => credentials.save(token) })
  } catch (error) {
    if (error.code !== 'AUTH_REQUIRED') throw error
    await credentials.clear()
    return { needsToken: true, message: 'Åtkomstnyckeln är inte giltig. Ange en ny nyckel.' }
  }
}

module.exports = { createCloudCredentials, syncWithSavedKey }
