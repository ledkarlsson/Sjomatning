import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
const {expandChartIndexes}=createRequire(import.meta.url)('../src/bsb-index.js')
test('BSB resolves sibling KAP files, deduplicates and rejects missing or unsafe references',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sjomatning-bsb-'))
 try {
 await fs.writeFile(path.join(root,'Chart.KAP'),'raster')
 const read=async filePath=>({id:'kap',name:path.basename(filePath),path:filePath,bytes:await fs.readFile(filePath)})
 const bsb={name:'Chart.bsb',path:path.join(root,'Chart.bsb'),bytes:Buffer.from('K01/FN=chart.kap\r\n')}
 const kap=await read(path.join(root,'Chart.KAP'))
 assert.deepEqual((await expandChartIndexes([bsb],read)).map(f=>f.name),['Chart.KAP'])
 assert.equal((await expandChartIndexes([kap,bsb],read)).length,1)
 await assert.rejects(()=>expandChartIndexes([{...bsb,bytes:Buffer.from('FN=missing.kap')}],read),/saknar/)
 await assert.rejects(()=>expandChartIndexes([{...bsb,bytes:Buffer.from('FN=..\\outside.kap')}],read),/ogiltig/)
 } finally {await fs.rm(root,{recursive:true,force:true})}
})
