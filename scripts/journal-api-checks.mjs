import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import storeModule from '../src/journal-store.js';
export async function checkJournal(mf,key,otherKey) {
  const origin='https://test.local';
  const fetchImpl=(url,options)=>mf.dispatchFetch(url,options);
  const request=(route,token=key,body)=>mf.dispatchFetch(origin+'/api/'+route,{method:body?'PUT':'GET',headers:{Origin:origin,Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
  const root=await mkdtemp(path.join(os.tmpdir(),'journal-test-'));
  try{
    const one=storeModule.createJournalStore(path.join(root,'one.json')),two=storeModule.createJournalStore(path.join(root,'two.json'));
    const original={id:randomUUID(),text:'Gick på grund. Återkom för mätning.',occurredAt:'2026-09-26T08:32:11.000Z',lat:58.5,lon:15.7};
    await one.save({event:original});
    await assert.rejects(one.save({event:{...original,text:'Stale draft'},expectedMutation:null}),/ändrats/);
    assert.equal((await storeModule.createJournalStore(path.join(root,'one.json')).list()).rows[0].event.text,original.text);
    let drop=true;
    const lostResponse=async(url,options)=>{const result=await fetchImpl(url,options);if(options.method==='PUT'&&drop){drop=false;throw new Error('Connection lost after commit');}return result;};
    await assert.rejects(one.sync({token:key,fetchImpl:lostResponse,origin}),/Connection lost/);
    await one.sync({token:key,fetchImpl,origin});
    let remote=await (await request('journal')).json();assert.equal(remote.length,1);assert.equal(remote[0].revision,1);
    assert.deepEqual(await (await request('journal',otherKey)).json(),[]);
    await two.sync({token:key,fetchImpl,origin});
    const first=(await one.list()).rows[0],second=(await two.list()).rows[0];
    await one.save({event:{...first.event,text:'Ny lokal text',occurredAt:'2026-09-25T12:00:00Z'},expectedMutation:first.mutation});
    await two.save({event:{...second.event,text:'Ändrad på andra datorn'},expectedMutation:second.mutation});
    await two.sync({token:key,fetchImpl,origin});
    assert.equal((await one.sync({token:key,fetchImpl,origin})).conflicts,1);
    assert.equal((await one.list()).rows[0].event.text,'Ny lokal text');
    await one.resolve(original.id,'local');await one.sync({token:key,fetchImpl,origin});
    await two.sync({token:key,fetchImpl,origin});
    const final=(await two.list()).rows[0];assert.equal(final.event.text,'Ny lokal text');assert.equal(final.event.occurredAt,'2026-09-25T12:00:00.000Z');
    await assert.rejects(one.sync({token:otherKey,fetchImpl,origin}),/annan nyckel/);
    const oneCurrent=(await one.list()).rows[0];await one.save({event:oneCurrent.event,expectedMutation:oneCurrent.mutation,deleted:true});
    await one.sync({token:key,fetchImpl,origin});await two.sync({token:key,fetchImpl,origin});assert.equal((await two.list()).rows[0].deleted,true);
    const malformed={event:{...original,lat:120},baseRevision:0,deleted:false,mutation:randomUUID()};
    assert.equal((await request('journal/'+original.id,key,malformed)).status,400);
    const foreign={event:original,baseRevision:3,deleted:false,mutation:randomUUID()};
    assert.equal((await request('journal/'+original.id,otherKey,foreign)).status,409);
    assert.deepEqual(await (await request('journal',otherKey)).json(),[]);
    assert.equal((await mf.dispatchFetch(origin+'/api/journal')).status,401);
    assert.equal((await mf.dispatchFetch(origin+'/api/journal/'+original.id,{method:'PUT',headers:{Origin:'https://evil.local',Authorization:'Bearer '+key},body:JSON.stringify(foreign)})).status,403);
    const row=(await (await request('journal')).json())[0];
    const createRace=async text=>request('journal/'+original.id,key,{event:{...row.event,text},baseRevision:row.revision,deleted:false,mutation:randomUUID()});
    const race=await Promise.all([createRace('A'),createRace('B')]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    // Keep a local draft when a newer server edit exists, then choose server version.
    await two.save({event:{...final.event,text:'Offline draft'},expectedMutation:(await two.list()).rows[0].mutation});
    assert.equal((await two.sync({token:key,fetchImpl,origin})).conflicts,1);
    await two.resolve(original.id,'remote');
    const resolved=(await two.list()).rows[0];assert.equal(resolved.dirty,false);assert.ok(['A','B'].includes(resolved.event.text));
    console.log('PASS: journal persistence, two-way sync, retry, conflicts, editable time, deletion and account isolation.');
  }finally{await rm(root,{recursive:true,force:true});}
}
