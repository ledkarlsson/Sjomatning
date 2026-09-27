import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readJonasMetadata,jonasCalibration,jonasDepthBoxes,jonasTrackPoints} from '../src/jonas-chart.mjs';import {importObs,exportObs} from '../src/obs-format.mjs';import {parseTrcTrack} from '../src/track-parser.mjs';
const reference=JSON.parse(await fs.readFile('tmp/jonas-reference.json','utf8'));
let pages=0,boxes=0,observations=0,tracks=0;
for(const [path,expected] of Object.entries(reference.charts)){
 const task=getDocument({data:new Uint8Array(await fs.readFile(path)),verbosity:0}),pdf=await task.promise;
 try{const metadata=await readJonasMetadata(pdf);for(const e of expected){const page=await pdf.getPage(e.page+1),cal=jonasCalibration(metadata,page),center=cal.geometry(.5,.5),rectangles=await jonasDepthBoxes(page,cal.entry,OPS);
 assert.ok(Math.abs(center.lat-e.center[0])<1e-8&&Math.abs(center.lon-e.center[1])<1e-8,path+' calibration');assert.equal(rectangles.length,e.boxes,path+' boxes');boxes+=rectangles.length;pages++;}}finally{await task.destroy();}
}
for(const name of await fs.readdir('FrånJonas/input/log_data')){
 const bytes=await fs.readFile('FrånJonas/input/log_data/'+name);
 if(/\.obs$/i.test(name)){const events=await importObs(bytes.toString('utf8'),name),source=JSON.parse(bytes.toString('utf8')),output=JSON.parse(exportObs(events));assert.deepEqual(output,source,name+' OBS round trip');observations+=events.length;}
 if(/\.trc$/i.test(name)){const parsed=parseTrcTrack(bytes,name),filtered=jonasTrackPoints(parsed),e=reference.tracks[name];assert.equal(filtered.length,e.count,name+' point count');if(e.first){assert.equal(filtered[0].lat,e.first.lat);assert.equal(filtered[0].lon,e.first.lon);assert.ok(Math.abs(filtered[0].speed-e.first.speed)<1e-10);assert.ok(Math.abs(Date.parse(filtered[0].date+'T'+filtered[0].time+'Z')-Date.parse(e.first.time+'Z'))<=1);}tracks++;}
}
console.log(`PASS: ${pages} calibrated pages, ${boxes} depth squares, ${observations} OBS observations, ${tracks} TRC files match Jonas reference.`);
