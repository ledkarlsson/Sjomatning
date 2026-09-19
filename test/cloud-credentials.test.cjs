const test = require('node:test')
const assert = require('node:assert/strict')
const { syncWithSavedKey } = require('../src/cloud-credentials')
const { syncLibrary } = require('../src/cloud-sync')

function credentials(token = null) {
  return { token, async read() { return this.token }, async save(value) { this.token = value }, async clear() { this.token = null } }
}

test('missing key prompts; validated key is saved and reused without returning it to the renderer', async () => {
  const store = credentials()
  let calls = 0
  const sync = async ({ token, onAuthenticated }) => { calls++; assert.equal(token, 'valid'); await onAuthenticated(); return { uploaded: 1 } }
  assert.equal((await syncWithSavedKey(store, sync)).needsToken, true)
  assert.equal(calls, 0)
  assert.deepEqual(await syncWithSavedKey(store, sync, { token: ' valid ' }), { uploaded: 1 })
  assert.equal(store.token, 'valid')
  assert.deepEqual(await syncWithSavedKey(store, sync), { uploaded: 1 })
})

test('rejected key prompts for replacement while network and permission failures retain the saved key', async () => {
  const store = credentials('valid')
  for (const status of [401, 403, 503]) {
    store.token = 'valid'
    const sync = options => syncLibrary({ ...options, files: [], fetchImpl: async () => Response.json({ error: 'test failure' }, { status }) })
    if (status === 401) {
      assert.equal((await syncWithSavedKey(store, sync)).needsToken, true)
      assert.equal(store.token, null)
    } else {
      await assert.rejects(syncWithSavedKey(store, sync), /test failure/)
      assert.equal(store.token, 'valid')
    }
  }
})

test('revocation during file transfer propagates to key dialog instead of a per-file error', async () => {
  const store = credentials('valid')
  const fetchImpl = async url => {
    const path = new URL(url).pathname
    if (path === '/api/login') return Response.json({}, { headers: { 'set-cookie': 'session=test' } })
    if (path === '/api/session') return Response.json({ id: 'alice', role: 'all', storageReady: true })
    if (url.endsWith('/api/files')) return Response.json([])
    return Response.json({ error: 'revoked' }, { status: 401 })
  }
  const result = await syncWithSavedKey(store, options => syncLibrary({ ...options, files: [{ name: 'a.csv', bytes: Buffer.from('csv') }], fetchImpl }))
  assert.equal(result.needsToken, true)
  assert.equal(store.token, null)
})
