const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const crypto=require('node:crypto')
const {syncLibrary,CLOUD_URL}=require('../src/cloud-sync')
async function main(){
 const token=(await fs.readFile('web/admin-access.txt','utf8')).trim()
 const bytes=Buffer.from('Datum,Tid,Latitud,Longitud,Fart,Djup\n,,58.52,15.7,,4\n,,58.53,15.71,,5\n# '+crypto.randomUUID())
 const syncId=crypto.createHash('sha256').update(bytes).digest('hex')
 const file={name:'synk-driftprov.csv',bytes,edits:{depthAdjustment:0.5}}
 const login=await fetch(CLOUD_URL+'/api/login',{method:'POST',headers:{Origin:CLOUD_URL,'Content-Type':'application/json'},body:JSON.stringify({password:token})})
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0]
 const getFiles=async()=> (await fetch(CLOUD_URL+'/api/files',{headers:{Cookie:cookie}})).json()
 let previous={}
 const run=()=>syncLibrary({files:[file],token,previous,checkpoint:async cache=>{previous=structuredClone(cache)}})
 try {
  const first=await run();assert.deepEqual(first.errors,[]);assert.equal(first.uploaded,1)
  const second=await run();assert.deepEqual(second.errors,[]);assert.equal(second.unchanged,1)
  file.name='synk-driftprov-uppdaterad.csv';file.edits.depthAdjustment=1
  const third=await run();assert.deepEqual(third.errors,[]);assert.equal(third.updated,1)
  const rows=(await getFiles()).filter(f=>f.syncId===syncId&&f.owner==='admin');assert.equal(rows.length,1)
  assert.equal(rows[0].name,file.name);assert.equal(rows[0].edits.depthAdjustment,1)
  const content=await fetch(CLOUD_URL+'/api/files/'+rows[0].id+'/content',{headers:{Cookie:cookie}});assert.equal(content.status,200);assert.deepEqual(Buffer.from(await content.arrayBuffer()),bytes)
  console.log('PASS: appens synkmotor mot produktion – uppladdning, omkörning utan dubblett, namn/spårändring och exakt original.')
 } finally {
  for(const row of (await getFiles()).filter(f=>f.syncId===syncId&&f.owner==='admin')) {
   const response=await fetch(CLOUD_URL+'/api/files/'+row.id,{method:'DELETE',headers:{Origin:CLOUD_URL,Cookie:cookie}});assert.equal(response.status,200)
  }
 }
}
main().catch(error=>{console.error(error);process.exitCode=1})
