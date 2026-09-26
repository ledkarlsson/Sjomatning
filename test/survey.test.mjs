import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateEvent,observationDepth,exportJournal} from '../src/journal-model.mjs';
import {chartPdf} from '../src/chart-pdf.mjs';
import * as pdf from 'pdf-lib';
const event={id:randomUUID(),text:'Stångmätning',occurredAt:'2026-09-26T10:00:00Z',lat:58.5,lon:15.7,depth:1.4,method:'pole',survey:{id:randomUUID(),name:'September',vessel:'Scilla',area:'Roxen',waterLevel:33.4,referenceLevel:33,reference:'RH00'}};
test('survey raw depth, method, reference and identity survive export without double correction',()=>{
 const e=validateEvent(event);assert.ok(Math.abs(observationDepth(e)-1)<1e-10);assert.equal(e.depth,1.4);
 const roundtrip=JSON.parse(exportJournal([{event:e}],'json')).events[0];assert.deepEqual(roundtrip,e);assert.equal(observationDepth(roundtrip),observationDepth(e));
 assert.ok(observationDepth(validateEvent({...event,depth:-.2}))<0);
 assert.throws(()=>validateEvent({...event,method:null}),/mätmetod/);
 assert.throws(()=>validateEvent({...event,survey:{...event.survey,waterLevel:NaN}}),/vattenstånd/);
 assert.equal(observationDepth(validateEvent({...event,survey:null})),1.4);
});
test('chart exports real selectable OCG layers and matching journal appendix',async()=>{
 const bytes=await chartPdf({width:800,height:500,title:'Mätkarta',layers:{points:true,depths:true,observations:true},points:[{x:100,y:100,depth:1},{x:100,y:100,depth:2}],rows:[{event:validateEvent(event)}],observations:[{id:event.id,x:120,y:140}],tracks:['Spår: vattenstånd 33,4 m']},pdf);
 const doc=await pdf.PDFDocument.load(bytes),oc=doc.catalog.lookup(pdf.PDFName.of('OCProperties'));
 assert.equal(oc.lookup(pdf.PDFName.of('OCGs')).size(),3);assert.equal(doc.getPageCount(),3);
 const names=oc.lookup(pdf.PDFName.of('OCGs')).asArray().map(ref=>doc.context.lookup(ref).lookup(pdf.PDFName.of('Name')).decodeText());assert.deepEqual(names,['Mätpunkter','Djupsiffror','Observationer']);
});
test('chart export preserves box-drawing characters in titles and file names',async()=>{
 const bytes=await chartPdf({width:800,height:500,title:'Karta ╠ Åäö',layers:{points:true},points:[],rows:[],observations:[],tracks:['Spår ╠ 2026.csv'],attribution:'Manus ╠.pdf'},pdf);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:bytes,useSystemFonts:true}),doc=await task.promise;
 try{let text='';for(let i=1;i<=doc.numPages;i++)text+=(await (await doc.getPage(i)).getTextContent()).items.map(item=>item.str).join(' ');assert.ok(text.includes('Karta ╠ Åäö'));assert.ok(text.includes('Spår ╠ 2026.csv'));assert.ok(text.includes('Manus ╠.pdf'));}finally{await task.destroy();}
});
