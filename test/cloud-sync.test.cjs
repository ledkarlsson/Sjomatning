const test = require('node:test')
const assert = require('node:assert/strict')
const {syncLibrary} = require('../src/cloud-sync')
function server(role='all') {
  const rows=[], settings={}, requests=[]; let failPatch=false
  return {rows,settings,requests,set failPatch(value){failPatch=value},fetchImpl:async (url,options) => {
    const route=new URL(url), path=route.pathname.replace('/api/',''); requests.push({path,method:options.method})
    const body=options.body && !Buffer.isBuffer(options.body) ? JSON.parse(options.body) : options.body
    const reply=(body,status=200,headers={})=>Response.json(body,{status,headers})
    if(path==='login') return reply({},200,{'set-cookie':'session=test; HttpOnly'})
    assert.equal(options.headers.Cookie,'session=test')
    if(path==='session') return reply({id:'alice',role,name:'Alice',storageReady:true})
    if(path==='files' && options.method==='GET') return reply(rows)
    if(path==='files') { const row={id:String(rows.length+1),owner:'alice',syncId:route.searchParams.get('syncId'),name:route.searchParams.get('name')}; rows.push(row);return reply(row,201) }
    if(path.startsWith('files/')) { if(failPatch){failPatch=false;return reply({error:'Tillfälligt fel'},503)} Object.assign(rows.find(r=>r.id===path.split('/')[1]),body);return reply({}) }
    if(path==='settings') {settings[body.key]=body.value;return reply({})}
    throw new Error(path)
  }}
}
test('sync uploads once, skips unchanged, updates local changes and restores a deleted cloud copy',async()=>{
  const s=server();let previous={};const file={name:'spår.csv',bytes:Buffer.from('original'),edits:{depthAdjustment:1}}
  const run=()=>syncLibrary({files:[file],token:'test',previous,checkpoint:async cache=>{previous=structuredClone(cache)},fetchImpl:s.fetchImpl})
  assert.equal((await run()).uploaded,1)
  s.rows[0].name='renamed-online.csv'
  assert.equal((await run()).unchanged,1);assert.equal(s.rows[0].name,'renamed-online.csv')
  file.name='nytt.csv';assert.equal((await run()).updated,1);assert.equal(s.rows[0].name,'nytt.csv')
  s.rows.length=0;assert.equal((await run()).uploaded,1)
})
test('sync retries metadata after an interrupted upload and honors own-track permission',async()=>{
  const s=server('own');s.failPatch=true;let previous={}
  const run=()=>syncLibrary({files:[{name:'karta.pdf',bytes:Buffer.from('pdf')},{name:'a.csv',bytes:Buffer.from('csv')}],token:'test',previous,checkpoint:async cache=>{previous=structuredClone(cache)},fetchImpl:s.fetchImpl})
  const first=await run();assert.equal(first.skipped,1);assert.equal(first.errors.length,1);assert.equal(s.rows.length,1)
  const second=await run();assert.equal(second.updated,1);assert.equal(second.errors.length,0);assert.equal(s.rows.length,1)
})
test('sync transfers and clears PDF calibration including subsequent pages',async()=>{
  const s=server();let previous={};const key='calibration:original.pdf:3',page=key+':page2'
  const run=calibrations=>syncLibrary({files:[{name:'renamed.pdf',originalName:'original.pdf',bytes:Buffer.from('pdf')}],calibrations,token:'test',previous,checkpoint:async cache=>{previous=structuredClone(cache)},fetchImpl:s.fetchImpl})
  await run({[key]:[{nx:0,ny:0,lat:58,lon:15}],[page]:[{nx:1,ny:1,lat:59,lon:16}]})
  assert.equal(s.rows[0].name,'renamed.pdf');assert.equal(s.settings[page].length,1)
  await run({});assert.deepEqual(s.settings[key],[]);assert.deepEqual(s.settings[page],[])
})
