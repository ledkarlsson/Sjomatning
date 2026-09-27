import test from 'node:test';import assert from 'node:assert/strict';import {DOMParser} from '@xmldom/xmldom';
import {importObs,exportObs} from '../src/obs-format.mjs';import {fillDepthBoxes,jonasCalibration,readJonasMetadata,jonasDepthBoxes} from '../src/jonas-chart.mjs';import {parseGpx} from '../src/gpx-parser.mjs';
import {PDFDocument,rgb} from 'pdf-lib';import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
const obs={format:'KodObservationFile',version:1,date:'2026-09-26',vessel:'Scilla',area:'Roxen',water_level_m:33.4,extra:'bevara',observations:[{type:'depth',latitude:'58 30.000',longitude:'15 42.000',depth:{measured_m:-.2,method:'pole',extra:3},comment:'Sten',extra:4},{type:'mooring',points:[{latitude:'58 30.000',longitude:'15 42.000'},{latitude:'58 31.000',longitude:'15 43.000'}],comment:'Brygga'}]};
test('OBS round trip preserves missing times, negative depths, mooring and extension fields',async()=>{
 const events=await importObs(JSON.stringify(obs),'Roxen.obs');assert.equal(events[0].dateOnly,true);assert.equal(events[1].positions.length,2);assert.deepEqual(JSON.parse(exportObs(events)),obs);assert.deepEqual(await importObs(JSON.stringify(obs),'Roxen.obs'),events);
 events[1].text='Ny kommentar';events[1].positions[1].lat=58.6;const changed=JSON.parse(exportObs(events));assert.equal(changed.observations[1].comment,'Ny kommentar');assert.equal(changed.observations[1].points[1].latitude,'58 36.00000000');assert.equal(changed.extra,'bevara');
 await assert.rejects(importObs(JSON.stringify({...obs,observations:[{type:'strange'}]}),'x.obs'));
});
test('depth squares follow Jonas pole and trimmed mean rules',()=>{
 const box={x:0,y:0,w:1,h:1};const depth=(values)=>fillDepthBoxes([box],values.map(p=>({x:.5,y:.5,...p})))[0].depth;
 assert.equal(depth([{depth:2,method:'pole'},{depth:1,method:'pole'},{depth:.1}]),1);assert.equal(depth([{depth:1},{depth:1.05},{depth:1.1}]),1.05);assert.equal(depth([{depth:1},{depth:1.05},{depth:1.2}]),null);assert.equal(depth([{depth:0},{depth:1},{depth:3},{depth:100}]),2);assert.equal(depth([{depth:1},{depth:1}]),null);
});
test('GPX imports Garmin depth in metres and never uses elevation as depth',()=>{
 const text='<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:g="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><trkseg><trkpt lat="58.5" lon="15.7"><ele>123</ele><time>2026-09-26T10:00:00+02:00</time><extensions><g:TrackPointExtension><g:depth>1.4</g:depth></g:TrackPointExtension></extensions></trkpt></trkseg><trkseg><trkpt lat="58.6" lon="15.8"><ele>44</ele></trkpt></trkseg></trk></gpx>';
 const result=parseGpx(text,'Garmin.gpx',DOMParser);assert.equal(result.points[0].depth,1.4);assert.equal(result.points[0].time,'08:00:00.000');assert.equal(result.points[1].depth,null);assert.notEqual(result.points[0].segment,result.points[1].segment);assert.throws(()=>parseGpx('<!DOCTYPE a>'+text,'x',DOMParser));
});
test('embedded Jonas calibration handles page rotation',async()=>{
 const doc=await PDFDocument.create(),page=doc.addPage([300,200]);page.setRotation({type:'degrees',angle:90});
 const metadata={format:'roxenkortet.chart',schema_version:1,name:'Test',page_index_base:0,coordinate_systems:{gps:{datum:'WGS84',unit:'decimal_degrees'},pdf:{space:'pymupdf_unrotated',unit:'point',points_per_inch:72,origin:'top_left',x_direction:'right',y_direction:'down'}},pages:[{page_index:0,keep_out_rectangles:[],calibration_points:[{id:'A',lat:59,lon:15,x:0,y:0},{id:'B',lat:59,lon:16,x:300,y:0},{id:'C',lat:58,lon:15,x:0,y:200},{id:'D',lat:58,lon:16,x:300,y:200}]}]};
 await doc.attach(new TextEncoder().encode(JSON.stringify(metadata)),'chart_metadata.json');const task=getDocument({data:await doc.save(),verbosity:0}),pdf=await task.promise;try{const m=await readJonasMetadata(pdf),p=await pdf.getPage(1),c=jonasCalibration(m,p),g=c.geometry(.5,.5);assert.ok(Math.abs(g.lat-58.5)<1e-10);assert.ok(Math.abs(g.lon-15.5)<1e-10);const q=c.project(58.5,15.5);assert.ok(Math.abs(q.x-.5)<1e-10);assert.ok(c.residual<1e-8);assert.deepEqual(await jonasDepthBoxes(p,c.entry,OPS),[]);}finally{await task.destroy();}
});
