import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateEvent,exportJournal,localDateTime} from '../src/journal-model.mjs';
import {journalPdf} from '../src/journal-pdf.mjs';
import * as pdf from 'pdf-lib';
const event=()=>({id:randomUUID(),occurredAt:'2026-09-26T10:30:00+02:00',text:'Återbesök ön.\nSten vid inloppet.',lat:58.5,lon:15.7});
test('events validate and preserve timestamp edits, Unicode and optional location',()=>{
  assert.equal(validateEvent(event()).occurredAt,'2026-09-26T08:30:00.000Z');
  assert.throws(()=>validateEvent({...event(),lon:null}),/både latitud/);
  assert.throws(()=>validateEvent({...event(),text:' '}),/Skriv/);
  assert.throws(()=>validateEvent({...event(),occurredAt:'not a date'}),/datum/);
  assert.equal(validateEvent({...event(),lat:null,lon:null}).lat,null);
  assert.match(localDateTime('2026-09-26T08:30:05Z'),/2026-09-26T\d\d:30:05/);
});
test('exports preserve events and omit tombstones; CSV escapes multiline text and formulas',()=>{
  const e=validateEvent({...event(),text:'=1+1; "Test"\nNästa rad'}),rows=[{event:e},{event:event(),deleted:true}];
  assert.deepEqual(JSON.parse(exportJournal(rows,'json')).events,[e]);
  const csv=exportJournal(rows,'csv');assert.ok(csv.includes('"\'=1+1; ""Test""\nNästa rad"'));
});
test('PDF paginates long content, retains Swedish text and rejects unsupported glyphs explicitly',async()=>{
  const rows=Array.from({length:30},(_,i)=>({event:validateEvent({...event(),text:`Händelse ${i+1}. `+'Stångmätning vid ön. '.repeat(25)})}));
  const bytes=await journalPdf(rows,pdf);const doc=await pdf.PDFDocument.load(bytes);assert.ok(doc.getPageCount()>3);
  await assert.rejects(journalPdf([{event:{...event(),text:'😀'}}],pdf),/stöder inte/);
});
