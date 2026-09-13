const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
test('USB connection stays open across separate measurement sessions', async () => {
  const elements = new Map()
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '4800', classList: {add(){},remove(){}}, addEventListener(){} })
    return elements.get(id)
  }
  let opened=0, closed=0, sessions=0, stopped=0
  const writes=[]
  const context = vm.createContext({ $, console, Date, Number, String, setTimeout, clearTimeout,
    state:{logs:[],live:null}, colors:['red'], toast(){}, renderLogs(){},drawOverlay(){},updateMapReadout(){}, geoToPixel(){return null},
    navigator:{serial:{requestPort:async()=>({open:async()=>opened++,close:async()=>closed++})}},
    parseNmeaSentence:raw=>raw==='depth'?{type:'depth',depth:2}:{type:'position',lat:58,lon:15,speed:1},
    window:{sjomatning:{startLiveSession:async()=>({id:++sessions,folder:'test'}),appendLiveData:async data=>writes.push(data),stopLiveSession:async()=>{stopped++;return null}}}
  })
  const source=fs.readFileSync('src/renderer.js','utf8')
  vm.runInContext(source.slice(source.indexOf('function nmeaTime'),source.indexOf('async function renameFile')) + '\nreadSerialStream = async () => {};',context)
  const run=code=>vm.runInContext(code,context)
  await run('startCapture()')
  await run("receiveNmea(state.live,'depth'); receiveNmea(state.live,'position')")
  assert.equal(sessions,0);assert.equal(writes.length,0);assert.equal(opened,1)
  await run('startMeasurement()')
  await run("receiveNmea(state.live,'position')")
  assert.equal(writes.length,1); assert.equal(run('state.live.log.points.length'),1)
  await run('stopMeasurement()')
  assert.equal(stopped,1);assert.equal(closed,0)
  await run("receiveNmea(state.live,'position')")
  assert.equal(writes.length,1)
  await run('startMeasurement()')
  await run("receiveNmea(state.live,'position')")
  assert.equal(sessions,2);assert.equal(writes[1].id,2)
  await run('stopCapture()')
  assert.equal(stopped,2);assert.equal(closed,1);assert.equal(run('state.live'),null)
  await run('startCapture()')
  assert.equal(opened,2)
  assert.equal(run('state.live.position'),null)
  assert.equal(run('state.live.depth'),null)
  await run('startMeasurement()')
  await run("receiveNmea(state.live,'position')")
  assert.equal(writes.at(-1).point.depth,null)
  await run('stopCapture()')
  assert.equal(closed,2)
})
