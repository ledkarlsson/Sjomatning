const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { appendSample, recoverSessions } = require('../src/live-storage')

test('NMEA handles zero coordinates, course, empty depth and malformed checksum', async () => {
  const { parseNmeaSentence: parse } = await import('../src/nmea-parser.mjs')
  const p = parse('$GPRMC,120000,A,0000.000,N,00000.000,E,2.5,123.4,130926')
  assert.equal(p.lat,0); assert.equal(p.lon,0); assert.equal(p.course,123.4)
  assert.equal(parse('$GPRMC,120000,A,5861,N,01500,E,2,0,130926').type,'gps-invalid')
  assert.equal(parse('$SDDPT,,0').type,'depth-invalid')
  assert.equal(parse('$SDDBT,,,M').type,'depth-invalid')
  assert.equal(parse('$SDDPT,4,0*XYZ'),null)
  assert.equal(parse('$SDDPT,0,0').depth,0)
})

test('serial replay handles chunk boundaries, final unterminated line, EOF and unplug', async () => {
  const { ReadableStream, TextDecoderStream } = require('node:stream/web')
  const source = await fs.readFile('src/renderer.js','utf8')
  for (const unplug of [false,true]) {
    const received=[], messages=[], callbacks=[]
    let stopped=0, controller
    const stream = new ReadableStream({start(c){controller=c}})
    const context=vm.createContext({TextDecoderStream,state:{live:{port:{readable:stream}}},
      receiveNmea:async(_live,raw)=>received.push(raw),toast:message=>messages.push(message),
      setTimeout:fn=>callbacks.push(fn),stopCapture:()=>stopped++})
    vm.runInContext(source.slice(source.indexOf('async function readSerialStream'),source.indexOf('async function receiveNmea')),context)
    const pending=vm.runInContext('readSerialStream()',context)
    controller.enqueue(Buffer.from('$GPR'))
    controller.enqueue(Buffer.from('MC,test\r\n$SDDPT,2,0'))
    if (unplug) {
      await new Promise(resolve=>setTimeout(resolve,10))
      controller.error(new Error('USB removed'))
      await assert.rejects(pending,/USB removed/)
    } else {
      controller.close()
      await pending
      assert.deepEqual(received,['$GPRMC,test','$SDDPT,2,0'])
      callbacks.forEach(fn=>fn())
      assert.equal(stopped,1)
      assert.equal(messages.length,1)
    }
    assert.equal(stream.locked,false)
  }
})

test('recorded GPS without sounder, invalid fixes, stale depth and write failure', async () => {
  const { parseNmeaSentence } = await import('../src/nmea-parser.mjs')
  const { simulationFrame } = await import('../src/nmea-simulator.mjs')
  const { parseTextTrack } = await import('../src/track-parser.mjs')
  let now = 10000, fail = false
  const writes = [], elements = new Map()
  const $ = id => { if (!elements.has(id)) elements.set(id, { value: '0', classList: {add(){},remove(){}}, addEventListener(){} }); return elements.get(id) }
  const context = vm.createContext({ $, console, Number, String, Date: class extends Date { static now(){return now} }, setTimeout, clearTimeout,
    state: {live: {session:{id:1},log:{points:[]}},logs:[]}, parseNmeaSentence,
    renderLogs(){},drawOverlay(){},updateMapReadout(){},geoToPixel(){return null},
    window:{sjomatning:{appendLiveData:async data=>{if(fail)throw new Error('disk full');writes.push(data)}}}
  })
  const source = await fs.readFile('src/renderer.js','utf8')
  vm.runInContext(source.slice(source.indexOf('function nmeaTime'),source.indexOf('async function renameFile')),context)
  const send = raw => { context.raw = raw; return vm.runInContext('receiveNmea(state.live,raw)',context) }
  const frame = simulationFrame(0, new Date('2026-09-13T10:00:00Z'))
  const rmc = frame.sentences.find(s=>s.includes('RMC'))
  await send(rmc)
  assert.equal(writes[0].point.depth,null)
  assert.equal(writes[0].point.speed,5)
  await send('$SDDPT,4.27,0')
  await send(rmc)
  assert.equal(writes.at(-1).point.depth,4.27)
  now += 5001
  await send(rmc)
  assert.equal(writes.at(-1).point.depth,null)
  await send('$GPRMC,100001,V,,,,,,,130926')
  assert.equal(context.state.live.position,null)
  await send('$SDDPT,2,0')
  assert.equal(writes.at(-1).point,null)
  const count = context.state.live.log.points.length
  fail = true
  await assert.rejects(send(rmc),/disk full/)
  assert.equal(context.state.live.log.points.length,count)
  const rows = writes.filter(w=>w.point).map(({point:p})=>[p.date,p.time,p.lat,p.lon,p.speed,p.depth].join(','))
  const restored = parseTextTrack(rows.join('\n'),'track.csv')
  assert.equal(restored.points.length,3)
  assert.equal(restored.points[0].depth,null)
  assert.equal(restored.points[1].depth,4.27)
})

test('CSV roundtrip preserves missing fields, precision and quoted multiline names', async () => {
  const { exportCsv, adjustedDepth, compareTrackPoints } = await import('../src/track-processing.mjs')
  const { parseTextTrack } = await import('../src/track-parser.mjs')
  const points = [{date:'2026-09-13',time:'10:12:13.250',lat:58.123456789,lon:15.987654321,speed:1.234567,depth:3.456789},
    {date:'2026-09-13',time:'10:12:14',lat:58,lon:15,speed:null,depth:null}]
  const track = {name:'Test; "båt"\nGPS',points,correction:0.5}
  const restored = parseTextTrack(exportCsv([track]),'export.csv')
  assert.deepEqual(restored.points.map(({coordinateText,...p})=>p),points)
  assert.ok(Number.isNaN(adjustedDepth(track,points[1])))
  assert.equal(compareTrackPoints(track,track).length,1)
})

test('interrupted on-disk session recovers complete rows and retries failed library writes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'survey-recovery-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const folder = path.join(root,'session'); await fs.mkdir(folder)
  const target = {rawPath:path.join(folder,'raw.nmea'),csvPath:path.join(folder,'track.csv')}
  await fs.writeFile(target.csvPath,'Datum,Tid,Latitud,Longitud,Fart,Djup\r\n')
  await appendSample(target,'$test',{date:'2026-09-13',time:'12:00:00',lat:58,lon:15,speed:2.345,depth:null})
  await fs.appendFile(target.csvPath,'partial')
  await assert.rejects(recoverSessions(root,async()=>{throw new Error('library unavailable')}),/library unavailable/)
  const restored=[]
  await recoverSessions(root,async file=>restored.push(file))
  await recoverSessions(root,async file=>restored.push(file))
  assert.equal(restored.length,1)
  const { parseTextTrack } = await import('../src/track-parser.mjs')
  assert.equal(parseTextTrack(restored[0].bytes.toString(),'restored.csv').points[0].depth,null)
  assert.match(await fs.readFile(target.csvPath,'utf8'),/partial$/)
  let calls=0
  const io={appendFile:async()=>{calls++;throw new Error('disk full')}}
  await assert.rejects(appendSample(target,'raw',null,io),/disk full/)
  await assert.rejects(appendSample(target,'raw',null,io),/disk full/)
  assert.equal(calls,1)
})
