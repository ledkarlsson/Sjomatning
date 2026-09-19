const crypto = require('node:crypto')
const CLOUD_URL = 'https://sjomatning-web.led-karlsson.workers.dev'
const hash = value => crypto.createHash('sha256').update(value).digest('hex')

// One-way, explicitly started sync. Credential persistence belongs to the main process.
async function syncLibrary({ files, token, calibrations = {}, previous = {}, checkpoint = async () => {}, onAuthenticated = async () => {}, progress = () => {}, fetchImpl = fetch, origin = CLOUD_URL }) {
  if (typeof token !== 'string' || !token.trim() || token.length > 1024) throw new Error('Ange din åtkomstnyckel.')
  let cookie = ''
  async function request(path, method = 'GET', body) {
    const response = await fetchImpl(origin + '/api/' + path, {
      method, redirect:'error', signal:AbortSignal.timeout(120000),
      headers:{ Origin:origin, ...(cookie ? { Cookie:cookie } : {}), ...(body && !Buffer.isBuffer(body) ? {'Content-Type':'application/json'} : {}) },
      ...(body === undefined ? {} : {body:Buffer.isBuffer(body) ? body : JSON.stringify(body)})
    })
    if (response.status === 401) throw Object.assign(new Error('Åtkomstnyckeln är inte giltig.'), { code: 'AUTH_REQUIRED' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `Serverfel (${response.status}).`)
    if (path === 'login') cookie = response.headers.get('set-cookie')?.split(';')[0] || ''
    return data
  }
  await request('login','POST',{password:token.trim()})
  const user = await request('session')
  await onAuthenticated()
  if (!user.storageReady) throw new Error('Webblagringen är inte tillgänglig.')
  const remote = await request('files')
  const cache = {...previous}, result = { uploaded:0, updated:0, unchanged:0, skipped:0, errors:[] }
  for (let index=0; index<files.length; index++) {
    const file = files[index]
    progress({ current:index+1, total:files.length, name:file.name })
    if (user.role !== 'all' && !/\.(csv|txt|trc|sl2|sl3)$/i.test(file.name)) { result.skipped++; continue }
    try {
      const bytes = Buffer.from(file.bytes)
      if (!bytes.length || bytes.length>95*1024*1024) throw new Error('Filen måste vara mellan 1 byte och 95 MB.')
      const syncId = hash(bytes), cacheKey = `${user.id}:${syncId}`
      const originalName = file.originalName || file.name
      const calibrationPrefix = `calibration:${originalName}:${bytes.length}`
      const calibration = Object.fromEntries(Object.entries(calibrations).filter(([key]) => key === calibrationPrefix || key.startsWith(calibrationPrefix+':page')))
      if (/\.(pdf|wci|kap)$/i.test(originalName)) {
        for (const key of [calibrationPrefix,...(cache[cacheKey]?.calibrationKeys || [])]) if (!(key in calibration)) calibration[key] = []
      }
      const changes = {name:file.name, edits:file.edits ?? null, annotations:file.annotations || []}
      const fingerprint = hash(JSON.stringify({changes,calibration}))
      let target = remote.find(item=>item.owner === user.id && item.syncId === syncId)
      const existed = Boolean(target)
      if (!target) {
        target = await request('files?name='+encodeURIComponent(originalName)+'&syncId='+syncId,'POST',bytes)
        result.uploaded++
      }
      if (existed && cache[cacheKey]?.fingerprint === fingerprint && cache[cacheKey]?.id === target.id) { result.unchanged++; continue }
      await request('files/'+target.id,'PATCH',changes)
      if (user.role === 'all') for (const [key,value] of Object.entries(calibration)) await request('settings','PUT',{key,value})
      cache[cacheKey] = {id:target.id,fingerprint,calibrationKeys:Object.keys(calibration)}
      await checkpoint(cache)
      if (existed) result.updated++
    } catch (error) {
      if (error.code === 'AUTH_REQUIRED') throw error
      result.errors.push({name:file.name,message:error.message})
    }
  }
  return {...result, user:user.name}
}
module.exports = {syncLibrary,CLOUD_URL}
