import { timingSafeEqual } from 'node:crypto';
import levels from '../src/roxen-level.js';
import { validateEdits, validateNotes } from './validation.mjs';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const allowed = /\.(pdf|wci|kap|bsb|csv|txt|trc|sl2|sl3)$/i;
const encoder = new TextEncoder();
async function signature(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
function equal(a, b) { const x = encoder.encode(a), y = encoder.encode(b); return x.length === y.length && timingSafeEqual(x, y); }
async function readJson(request, limit = 65536) {
  const reader = request.body?.getReader(); if (!reader) throw new Error('Tom begäran.');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error('Ändringen är för stor.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function authenticated(request, env) {
  if (!env.LIBRARY_PASSWORD) return null;
  // Mobile PWA requests carry their own key so a different browser tab's
  // session cookie cannot change the owner halfway through a synchronization.
  const authorization = request.headers.get('Authorization');
  if (authorization !== null) {
    const key = authorization.match(/^Bearer (\S{1,1024})$/)?.[1];
    if (!key) return null;
    if (equal(await signature(env.LIBRARY_PASSWORD, key), await signature(env.LIBRARY_PASSWORD, env.LIBRARY_PASSWORD))) return {id:'admin',name:'Administratör',role:'all'};
    return env.DB.prepare('SELECT id,name,role FROM users WHERE tokenHash=? AND active=1').bind(await tokenHash(key)).first();
  }
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1] || '';
  const [id, expires, mac] = token.split('.');
  if (!(Number(expires) > Date.now() && Number(expires) < Date.now() + 604801000 && equal(mac || '', await signature(env.LIBRARY_PASSWORD, id + '.' + expires)))) return null;
  if (id === 'admin') return { id, name:'Administratör', role:'all' };
  return env.DB.prepare('SELECT id,name,role FROM users WHERE id=? AND active=1').bind(id).first();
}
async function tokenHash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2,'0')).join(''); }
function record(row) { return { ...JSON.parse(row.metadata), id: row.id, owner:row.owner, name: row.name, originalName: JSON.parse(row.metadata).originalName || row.name, extension: row.extension, size: row.size, addedAt: row.addedAt }; }
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) return json({ error: 'Ogiltigt ursprung.' }, 403);
      if (path === '/api/login' && request.method === 'POST') {
        if (!env.LIBRARY_PASSWORD) return json({ error: 'Bibliotekets lösenord är inte konfigurerat.' }, 503);
        if (Number(request.headers.get('Content-Length')) > 2048) return json({ error: 'För stor begäran.' }, 413);
        const { password } = await readJson(request, 2048);
        if (typeof password !== 'string' || password.length > 1024) return json({ error:'Ogiltig åtkomstnyckel.' }, 401);
        const admin = equal(await signature(env.LIBRARY_PASSWORD, password), await signature(env.LIBRARY_PASSWORD, env.LIBRARY_PASSWORD));
        const user = admin ? { id:'admin' } : await env.DB.prepare('SELECT id FROM users WHERE tokenHash=? AND active=1').bind(await tokenHash(password)).first();
        if (!user) return json({ error:'Fel åtkomstnyckel.' }, 401);
        const expires = String(Date.now() + 604800000);
        return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': `session=${user.id}.${expires}.${await signature(env.LIBRARY_PASSWORD, user.id + '.' + expires)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800` } });
      }
      if (path === '/api/logout') return new Response('{}', { headers: { 'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' } });
      const user = await authenticated(request, env);
      if (!user) return json({ error: 'Logga in för att öppna molnbiblioteket.' }, 401);
      if (path === '/api/session') return json({ ...user, storageReady:Boolean(env.FILES) });
      if (path.startsWith('/api/users')) {
        if (user.id !== 'admin') return json({ error:'Endast administratören kan hantera åtkomstnycklar.' }, 403);
        if (path === '/api/users' && request.method === 'GET') return json((await env.DB.prepare('SELECT id,name,role,active FROM users').all()).results);
        if (path === '/api/users' && request.method === 'POST') {
          const { name, role } = await readJson(request);
          if (typeof name !== 'string' || !name.trim() || name.length > 100 || !['all','own'].includes(role)) return json({ error:'Ogiltig användare.' }, 400);
          const id = crypto.randomUUID(), token = crypto.randomUUID() + crypto.randomUUID();
          await env.DB.prepare('INSERT INTO users(id,name,role,tokenHash) VALUES(?,?,?,?)').bind(id,name,role,await tokenHash(token)).run();
          return json({ id,name,role,token }, 201);
        }
        const id = path.match(/^\/api\/users\/([a-f0-9-]{36})$/)?.[1];
        if (id && request.method === 'DELETE') { await env.DB.prepare('UPDATE users SET active=0 WHERE id=?').bind(id).run(); return json({ revoked:true }); }
        return json({ error:'Ogiltig begäran.' }, 400);
      }
      if (path === '/api/level') {
        const timedFetch = (url, options) => fetch(url, { ...options, signal:AbortSignal.timeout(10000) });
        const data = await (url.searchParams.get('date') ? levels.fetchRoxenLevel(url.searchParams.get('date'), timedFetch) : levels.fetchLatestRoxenLevel(timedFetch));
        return json(data ? {ok:true,data} : {ok:false,error:'Vattenstånd saknas för datumet.'});
      }
      if (path === '/api/settings' && request.method === 'GET') return json(user.role === 'all' ? Object.fromEntries((await env.DB.prepare('SELECT key,value FROM settings').all()).results.map(r => [r.key, JSON.parse(r.value)])) : {});
      if (path === '/api/settings' && request.method === 'PUT') {
        if (user.role !== 'all') return json({ error:'Du saknar behörighet att ändra kartkalibrering.' }, 403);
        const { key, value } = await readJson(request);
        if (typeof key !== 'string' || !key.startsWith('calibration:') || key.length > 500 || JSON.stringify(value).length > 30000) return json({ error: 'Ogiltig kalibrering.' }, 400);
        await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, JSON.stringify(value)).run(); return json({ saved: true });
      }
      if (path === '/api/files' && request.method === 'GET') return json((await (user.role === 'all' ? env.DB.prepare('SELECT * FROM files ORDER BY addedAt DESC') : env.DB.prepare('SELECT * FROM files WHERE owner=? ORDER BY addedAt DESC').bind(user.id)).all()).results.map(record));
      if (path === '/api/files' && request.method === 'POST') {
        if (!env.FILES) return json({ error:'Filbiblioteket väntar på att R2 aktiveras och ansluts i Cloudflare.' }, 503);
        const name = url.searchParams.get('name') || '';
        if (user.role !== 'all' && !/\.(csv|txt|trc|sl2|sl3)$/i.test(name)) return json({ error:'Din behörighet tillåter endast uppladdning av spår.' }, 403);
        const size = Number(request.headers.get('Content-Length'));
        if (!allowed.test(name) || name.length > 240 || /[\\/\x00-\x1f]/.test(name)) return json({ error: 'Filformatet stöds inte.' }, 400);
        if (!Number.isInteger(size) || size < 1 || size > 95 * 1024 * 1024) return json({ error: 'Filen måste vara mellan 1 byte och 95 MB.' }, 413);
        const syncId = url.searchParams.get('syncId');
        if (syncId !== null && !/^[a-f0-9]{64}$/.test(syncId)) return json({error:'Ogiltigt synk-id.'},400);
        if (syncId) {
          const existing = await env.DB.prepare("SELECT * FROM files WHERE owner=? AND json_extract(metadata,'$.syncId')=?").bind(user.id,syncId).first();
          if (existing) return json(record(existing));
        }
        const metadata = JSON.stringify(syncId ? {syncId,originalName:name} : {});
        const id = crypto.randomUUID(), extension = name.slice(name.lastIndexOf('.')).toLowerCase(), addedAt = new Date().toISOString();
        await env.FILES.put(id, request.body, { httpMetadata: { contentType: 'application/octet-stream' } });
        try { await env.DB.prepare('INSERT INTO files(id,name,extension,size,addedAt,owner,metadata) VALUES(?,?,?,?,?,?,?)').bind(id, name, extension, size, addedAt,user.id,metadata).run(); }
        catch (error) { await env.FILES.delete(id); throw error; }
        return json({ id, name, originalName: name, extension, size, addedAt }, 201);
      }
      const match = path.match(/^\/api\/files\/([a-f0-9-]{36})(\/content)?$/);
      if (!match) return json({ error: 'Sidan finns inte.' }, 404);
      const row = await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(match[1]).first();
      if (!row) return json({ error: 'Filen finns inte.' }, 404);
      if (user.role !== 'all' && row.owner !== user.id) return json({ error:'Filen finns inte.' }, 404);
      if (match[2] && request.method === 'GET') {
        const object = await env.FILES.get(row.id);
        if (!object) return json({ error: 'Filinnehållet saknas.' }, 404);
        return new Response(object.body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (request.method === 'PATCH') {
        if (Number(request.headers.get('Content-Length')) > 16000000) return json({ error: 'För stor ändring.' }, 413);
        const changes = await readJson(request, 1500000), metadata = JSON.parse(row.metadata);
        metadata.originalName ||= row.name;
        try {
          if (Object.hasOwn(changes, 'edits')) metadata.edits = validateEdits(changes.edits);
          if (Object.hasOwn(changes, 'annotations')) metadata.annotations = validateNotes(changes.annotations);
        } catch (error) { return json({ error:error.message }, 400); }
        let name = changes.name ?? row.name;
        if (typeof name !== 'string' || !name.trim() || name.length > 240 || /[\\/:*?"<>|\x00-\x1f]/.test(name)) return json({ error: 'Ogiltigt namn.' }, 400);
        if (!name.toLowerCase().endsWith(row.extension)) name += row.extension;
        await env.DB.prepare('UPDATE files SET name=?,metadata=? WHERE id=?').bind(name, JSON.stringify(metadata), row.id).run();
        return json(record({ ...row, name, metadata: JSON.stringify(metadata) }));
      }
      if (request.method === 'DELETE') { await env.FILES.delete(row.id); await env.DB.prepare('DELETE FROM files WHERE id=?').bind(row.id).run(); return json({ deleted: true }); }
      return json({ error: 'Metoden stöds inte.' }, 405);
    } catch (error) { console.error(JSON.stringify({ event: 'api_error', path, message: error.message })); return json({ error: 'Åtgärden misslyckades. Försök igen.' }, 500); }
  }
};
