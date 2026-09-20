import * as db from './storage.mjs';
export class InvalidKey extends Error { constructor() { super('Nyckeln är ogiltig. Ange en ny för att synka.'); } }
export function client(key, fetcher = fetch) {
  return async (path, options = {}) => {
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),60000);
    try {
      const response = await fetcher('/api/'+path,{...options,credentials:'omit',cache:'no-store',signal:controller.signal,headers:{...options.headers,Authorization:'Bearer '+key}});
      if (response.status === 401) throw new InvalidKey();
      if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error || `Serverfel (${response.status}). Försök igen.`);
      // Consume the body before ending the timeout, including large originals.
      return new Response(await response.blob(),{status:response.status,headers:response.headers});
    } finally { clearTimeout(timeout); }
  };
}
export async function account(api) {
  const user = await (await api('session')).json();
  if (!user.id || !user.storageReady) throw new Error('Webblagringen är inte tillgänglig.');
  return user;
}
async function receipt(id, owner, hash, remoteId) {
  await db.change('points',id,point => {
    if (!point) throw new Error('Den lokala punkten saknas.');
    point.versions[owner] ||= {}; point.versions[owner][hash] = remoteId; return point;
  });
}
export async function syncPoints(api, owner, progress = ()=>{}) {
  let remote = await (await api('files')).json();
  for (const snapshot of await db.points()) {
    // Uncertain uploads survive a crash as hash -> null. Reconcile them even
    // if the point was subsequently edited or deleted locally.
    for (const hash of Object.keys(snapshot.versions[owner] || {})) {
      const found = remote.find(file=>file.owner===owner && file.syncId===hash);
      if (found) await receipt(snapshot.id,owner,hash,found.id);
    }
    let point = await db.get('points',snapshot.id), currentHash = null;
    if (!point.deleted) {
      progress('Synkar '+point.name+'…');
      const content = db.csv([point]); currentHash = await db.hash(point.id+'\n'+point.name+'\n'+content);
      let found = remote.find(file=>file.owner===owner && file.syncId===currentHash);
      if (!found) {
        await receipt(point.id,owner,currentHash,null);
        const name = (point.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70)||'Mätning')+'_'+point.id+'.csv';
        found = await (await api('files?name='+encodeURIComponent(name)+'&syncId='+currentHash,{method:'POST',body:new Blob([content],{type:'text/csv'})})).json();
        remote.push({...found,owner,syncId:currentHash});
      }
      await receipt(point.id,owner,currentHash,found.id);
    }
    const current = await db.get('points',point.id);
    // New edits are sent by the next synchronization, without losing this receipt.
    if (current.revision !== point.revision) continue;
    for (const [hash,id] of Object.entries(current.versions[owner] || {})) {
      if (!id || (!current.deleted && hash===currentHash)) continue;
      // Only delete files owned by this account with a persisted local receipt.
      if (remote.some(file=>file.id===id && file.owner===owner)) await api('files/'+id,{method:'DELETE'});
      remote = remote.filter(file=>file.id!==id);
      await db.change('points',point.id,p=>{delete p.versions[owner][hash];return p;});
    }
  }
}
export async function syncLibrary(api, owner, progress = ()=>{}) {
  const files = (await (await api('files')).json()).filter(file=>/\.(pdf|wci|kap)$/i.test(file.name));
  const settings = await (await api('settings')).json();
  for (const file of files) {
    if (!/^[a-f0-9-]{36}$/.test(file.id) || !Number.isInteger(file.size) || file.size<1 || file.size>95*1024*1024) throw new Error('Ogiltig biblioteksfil.');
    const key = owner+'/'+file.id, stored = await db.get('originals',key);
    if (stored?.size===file.size) continue;
    progress('Sparar '+file.name+' i telefonen…');
    const bytes = await (await api('files/'+file.id+'/content')).arrayBuffer();
    if (bytes.byteLength!==file.size) throw new Error('Hämtningen av '+file.name+' avbröts.');
    // ArrayBuffer avoids engine-specific Blob backing-file lifetime problems.
    await db.put('originals',key,{size:bytes.byteLength,bytes});
  }
  // Publish the new list only after all originals are durable. An interrupted
  // download leaves the previous offline library intact.
  const library = {files,settings,syncedAt:Date.now()};
  await db.put('settings','library/'+owner,library);
  const keep = new Set(files.map(file=>owner+'/'+file.id));
  for (const key of await db.keys('originals')) if (key.startsWith(owner+'/') && !keep.has(key)) await db.put('originals',key,undefined);
  return library;
}
export async function readLibrary(owner, path) {
  const library = await db.get('settings','library/'+owner);
  if (!library) throw new Error('Synka en gång för att spara fältmanus i telefonen.');
  if (path==='files') return Response.json(library.files);
  const id = path.match(/^files\/([a-f0-9-]{36})\/content$/)?.[1];
  if (!id || !library.files.some(file=>file.id===id)) throw new Error('Filen finns inte i ditt sparade bibliotek.');
  const original = await db.get('originals',owner+'/'+id);
  if (!original) throw new Error('Filen saknas lokalt. Synka igen.');
  return new Response(original.bytes);
}
