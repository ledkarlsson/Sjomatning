import {validateEvent,validJournalId} from '../src/journal-model.mjs';
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const record=row=>({event:JSON.parse(row.data),revision:row.revision,deleted:Boolean(row.deleted),mutation:row.mutation});
export async function journalApi(request,env,user,readJson) {
  const path=new URL(request.url).pathname;
  if(path==='/api/journal' && request.method==='GET') {
    const rows=await env.DB.prepare('SELECT * FROM journal_events WHERE owner=? ORDER BY id').bind(user.id).all();
    return response(rows.results.map(record));
  }
  const id=path.match(/^\/api\/journal\/([a-f0-9-]{36})$/)?.[1];
  if(!id||request.method!=='PUT')return response({error:'Ogiltig dagboksbegäran.'},400);
  let body,event;
  try {
    body=await readJson(request);
    event=validateEvent(body.event);
    if(event.id!==id||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<0||!validJournalId(body.mutation)||typeof body.deleted!=='boolean')throw new Error('Ogiltig händelseversion.');
  }catch(error){return response({error:error.message},400);}
  const data=JSON.stringify(event),deleted=Number(body.deleted);
  // A repeated mutation is acknowledged without applying it twice. The conditional
  // upsert also rejects simultaneous edits atomically within D1.
  const existing=await env.DB.prepare('SELECT * FROM journal_events WHERE owner=? AND id=?').bind(user.id,id).first();
  if(existing?.mutation===body.mutation) {
    if(JSON.stringify(validateEvent(JSON.parse(existing.data)))!==data||existing.deleted!==deleted)return response({error:'Ändrings-id används redan.'},409);
    return response(record(existing));
  }
  if((existing?.revision??0)!==body.baseRevision)return response({error:'Händelsen har ändrats på en annan enhet.',current:existing?record(existing):null},409);
  const saved=await env.DB.prepare(`INSERT INTO journal_events(owner,id,data,revision,mutation,deleted) VALUES(?,?,?,1,?,?)
    ON CONFLICT(owner,id) DO UPDATE SET data=excluded.data,revision=journal_events.revision+1,mutation=excluded.mutation,deleted=excluded.deleted
    WHERE journal_events.revision=? RETURNING *`).bind(user.id,id,data,body.mutation,deleted,body.baseRevision).first();
  if(!saved) {
    const current=await env.DB.prepare('SELECT * FROM journal_events WHERE owner=? AND id=?').bind(user.id,id).first();
    return response({error:'Händelsen har ändrats på en annan enhet.',current:record(current)},409);
  }
  return response(record(saved));
}
