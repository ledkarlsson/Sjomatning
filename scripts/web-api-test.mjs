import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['web/worker.mjs'],bundle:true,format:'esm',platform:'node',write:false});
const mf = new Miniflare(convertV4MiniflareOptions({ workers:[{ name:'test', modules:true, script:bundle.outputFiles[0].text, scriptPath:'web/worker.mjs', compatibilityDate:'2026-09-19', compatibilityFlags:['nodejs_compat'], bindings:{ LIBRARY_PASSWORD:'integration-test-secret' }, d1Databases:['DB'], r2Buckets:['FILES'] }] }));
try {
  const db = await mf.getD1Database('DB');
  for (const sql of (await readFile('web/migrations/0001_library.sql','utf8')).split(';').filter(s => s.trim())) await db.prepare(sql).run();
  const call = (path, method='GET', body, cookie, extra={}) => mf.dispatchFetch('https://test.local/api/' + path, { method, headers:{ Origin:'https://test.local', ...(cookie ? {Cookie:cookie} : {}), ...extra }, ...(body === undefined ? {} : {body:typeof body === 'string' ? body : JSON.stringify(body)}) });
  const login = async password => { const response = await call('login','POST',{password}); assert.equal(response.status,200); return response.headers.get('set-cookie').split(';')[0]; };
  assert.equal((await call('files')).status,401);
  assert.equal((await call('login','POST',{password:'wrong'})).status,401);
  const admin = await login('integration-test-secret');
  const makeUser = async (name,role) => { const response = await call('users','POST',{name,role},admin); assert.equal(response.status,201); return response.json(); };
  const a = await makeUser('A','own'), b = await makeUser('B','own'), all = await makeUser('Reviewer','all');
  const ac = await login(a.token), bc = await login(b.token), rc = await login(all.token);
  const csv = 'Datum,Tid,Latitud,Longitud,Fart,Djup\n,,58.52,15.7,,\n,,58.53,15.71,,4.2';
  const upload = await call('files?name=planned.csv','POST',csv,ac,{'Content-Length':String(Buffer.byteLength(csv))});
  assert.equal(upload.status,201); const file = await upload.json();
  assert.equal((await (await call('files','GET',undefined,ac)).json()).length,1);
  assert.equal((await (await call('files','GET',undefined,bc)).json()).length,0);
  assert.equal((await (await call('files','GET',undefined,rc)).json()).length,1);
  for (const [suffix,method,body] of [['/content','GET'],['','PATCH',{name:'stolen'}],['','DELETE']]) assert.equal((await call('files/'+file.id+suffix,method,body,bc)).status,404);
  assert.equal(await (await call('files/'+file.id+'/content','GET',undefined,ac)).text(),csv);
  assert.equal((await call('files?name=map.pdf','POST','pdf',ac,{'Content-Length':'3'})).status,403);
  assert.equal((await call('users','GET',undefined,rc)).status,403);
  assert.equal((await call('settings','PUT',{key:'calibration:test',value:[]},ac)).status,403);
  assert.equal((await call('files/'+file.id,'PATCH',{name:'renamed',edits:{depthAdjustment:1}},ac)).status,200);
  const changed = await (await call('files','GET',undefined,admin)).json(); assert.equal(changed[0].name,'renamed.csv'); assert.equal(changed[0].edits.depthAdjustment,1);
  const attack = await mf.dispatchFetch('https://test.local/api/files/'+file.id, {method:'DELETE',headers:{Cookie:ac,Origin:'https://evil.local'}}); assert.equal(attack.status,403);
  assert.equal((await call('users/'+a.id,'DELETE',undefined,admin)).status,200);
  assert.equal((await call('files','GET',undefined,ac)).status,401);
  assert.equal((await call('login','POST',{password:a.token})).status,401);
  assert.equal((await call('files/'+file.id,'DELETE',undefined,admin)).status,200);
  assert.equal((await (await call('files','GET',undefined,admin)).json()).length,0);
  console.log('PASS: inloggning, ägarskap, alla/egna roller, uppladdning, nedladdning, redigering, CSRF, spärrade nycklar och borttagning.');
} finally { await mf.dispose(); }



