import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.argv[2];
if (origin !== 'https://sjomatning-web.led-karlsson.workers.dev') throw new Error('Ange projektets driftsatta adress.');
const root = await fetch(origin); assert.equal(root.status,200); assert.match(await root.text(),/Sjömätning/);
assert.equal((await fetch(origin+'/api/files')).status,401);
const password=(await readFile('web/admin-access.txt','utf8')).trim();
const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
const session=await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json(); assert.equal(session.id,'admin');
const files=await fetch(origin+'/api/files',{headers:{Cookie:cookie}}); assert.equal(files.status,200);
const users=await fetch(origin+'/api/users',{headers:{Cookie:cookie}}); assert.equal(users.status,200);
if (process.argv.includes('--storage')) {
  assert.equal(session.storageReady,true,'R2 måste vara anslutet');
  const content='Datum,Tid,Latitud,Longitud,Fart,Djup\n,,58.52,15.70,,\n,,58.53,15.71,,4.2';
  const name='driftkontroll-'+crypto.randomUUID()+'.csv';
  const upload=await fetch(origin+'/api/files?name='+encodeURIComponent(name),{method:'POST',headers:{Origin:origin,Cookie:cookie},body:content});
  assert.equal(upload.status,201,await upload.clone().text());
  const file=await upload.json();
  try {
    const listing=await (await fetch(origin+'/api/files',{headers:{Cookie:cookie}})).json();
    assert.ok(listing.some(item=>item.id===file.id));
    const download=await fetch(origin+'/api/files/'+file.id+'/content',{headers:{Cookie:cookie}});
    assert.equal(download.status,200); assert.equal(await download.text(),content);
    assert.equal((await fetch(origin+'/api/files/'+file.id+'/content')).status,401);
    console.log('R2: uppladdning, listning, exakt nedladdning och åtkomstskydd OK.');
  } finally {
    const removed=await fetch(origin+'/api/files/'+file.id,{method:'DELETE',headers:{Origin:origin,Cookie:cookie}});
    assert.equal(removed.status,200,'Den syntetiska testfilen kunde inte tas bort');
  }
}
console.log(JSON.stringify({site:origin,login:'OK',unauthenticatedAccess:'blocked',library:'OK',users:'OK',storageReady:session.storageReady}));
