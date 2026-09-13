import { deflateSync } from 'node:zlib'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readRasterChart,rasterPixels,chartGeometry} from '../src/raster-chart.mjs'
test('KAP decodes zero- and one-based rows and checks truncation',async()=>{
 const header='BSB/RA=4,2\r\nVER/1.1\r\nKNP/GD=WGS84,PR=MERCATOR\r\nREF/1,0,0,59,15\r\nREF/2,4,0,59,16\r\nREF/3,0,2,58,15\r\nREF/4,4,2,58,16\r\nRGB/1,10,20,30\r\n'
 for(const base of [0,1]) {
 const bytes=new Uint8Array([...new TextEncoder().encode(header),26,0,1,base,67,0,base+1,67,0])
 const chart=readRasterChart(bytes,'a.kap'),pixels=await rasterPixels(chart)
 assert.deepEqual(Array.from(pixels.rgba.slice(0,4)),[10,20,30,255]);assert.equal(pixels.rgba.length,32)
 assert.deepEqual(chart.geometry(.5,.5),{lat:58.5,lon:15.5})
 await assert.rejects(()=>rasterPixels({...chart,bytes:bytes.slice(0,-2)}))
 }
})
test('WCI supports solid and RLE rows with a six-bit palette',async()=>{
 const meta='GD=WGS84\r\nPR=2\r\nDS=0,0\r\nC1=0,0,59,15\r\nC2=4,0,59,16\r\nC3=0,2,58,15\r\nC4=4,2,58,16\r\n'
 const bytes=new Uint8Array(33+meta.length),v=new DataView(bytes.buffer)
 bytes.set([87,67,73,1,6,1]);v.setUint16(12,4,true);v.setUint16(14,2,true);v.setUint32(16,33,true)
 v.setUint32(20,0xc0000000,true);v.setUint32(24,0x4000001c,true);bytes.set([128,3,10,20,30],28);bytes.set(new TextEncoder().encode(meta),33)
 const pixels=await rasterPixels(readRasterChart(bytes,'a.wci'));assert.equal(pixels.rgba.length,32);assert.deepEqual(Array.from(pixels.rgba.slice(-4)),[10,20,30,255])
 bytes[29]=4;await assert.rejects(()=>rasterPixels(readRasterChart(bytes,'a.wci')))
})
test('quadratic calibration follows a curved reference grid',()=>{
 const expected=(x,y)=>({lat:58-y*.1+x*x*.01,lon:15+x*.2+x*y*.001})
 const refs=[];for(const x of [0,.5,1])for(const y of [0,.5,1])refs.push({x,y,...expected(x,y)})
 const geo=chartGeometry(refs)(.3,.7),target=expected(.3,.7)
 assert.ok(Math.abs(geo.lat-target.lat)<1e-10);assert.ok(Math.abs(geo.lon-target.lon)<1e-10)
})

test('WCI deflate rows decode and reject oversized output',async()=>{
 const metadata='GD=WGS84\r\nPR=2\r\nDS=0,0\r\nC1=0,0,59,15\r\nC2=4,0,59,16\r\nC3=0,2,58,15\r\nC4=4,2,58,16\r\n'
 const make=length=>{
  const compressed=deflateSync(new Uint8Array(length)),offset=28+compressed.length+3
  const bytes=new Uint8Array(offset+metadata.length),v=new DataView(bytes.buffer)
  bytes.set([87,67,73,1,6,1]);v.setUint16(12,4,true);v.setUint16(14,2,true);v.setUint32(16,offset,true)
  v.setUint32(20,28,true);v.setUint32(24,0xc0000000,true);bytes.set(compressed,28);bytes.set([10,20,30],offset-3);bytes.set(new TextEncoder().encode(metadata),offset)
  return readRasterChart(bytes,'a.wci')
 }
 assert.equal((await rasterPixels(make(4))).rgba.length,32)
 await assert.rejects(()=>rasterPixels(make(5)),/lång/)
})


test('WCI retains original pixels above the former 3000-pixel limit', async () => {
 const bytes = new Uint8Array(27), view = new DataView(bytes.buffer)
 view.setUint32(20, 0xc0000000, true); bytes.set([10,20,30],24)
 const chart = {type:'wci',width:6001,height:1,bytes,paletteStart:24,paletteSize:1}
 const full = await rasterPixels(chart)
 assert.equal(full.width,6001); assert.equal(full.rgba.length,6001*4)
 assert.equal((await rasterPixels(chart,3000)).width,3000)
})
