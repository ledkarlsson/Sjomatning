const NAME = 'sjomatning-mobile';
let opened;
export function database() {
  if (!opened) opened = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['points', 'settings', 'originals']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = null; }; resolve(request.result); };
    request.onerror = () => { opened = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Stäng andra fönster med mobilappen och öppna igen.'));
  });
  return opened;
}
export async function get(store, key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function entries(store) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const values = [], request = db.transaction(store).objectStore(store).openCursor();
    request.onsuccess = () => { const cursor = request.result; if (!cursor) return resolve(values); values.push([cursor.key, cursor.value]); cursor.continue(); };
    request.onerror = () => reject(request.error);
  });
}
export async function keys(store) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const request = db.transaction(store).objectStore(store).getAllKeys();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
// The updater is synchronous and runs inside one transaction. UI changes made
// while a network request is in flight therefore cannot be overwritten.
export async function change(store, key, update) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite'), object = tx.objectStore(store), request = object.get(key);
    let result;
    request.onsuccess = () => {
      try { result = update(request.result); if (result === undefined) object.delete(key); else object.put(result, key); }
      catch (error) { reject(error); tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Kunde inte spara i telefonen. Kontrollera ledigt utrymme.'));
  });
}
export const put = (store, key, value) => change(store, key, () => value);
export const points = async () => (await entries('points')).map(([,value]) => value).sort((a,b) => b.time - a.time);
export function decimal(value, label, min, max) {
  const text = String(value).trim().replace(',', '.');
  const number = text === '' ? NaN : Number(text);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label} måste vara mellan ${min} och ${max}.`);
  return number;
}
export function fresh(fix, now = Date.now()) {
  return !!fix && [fix.lat,fix.lon,fix.accuracy,fix.time].every(Number.isFinite) && Math.abs(fix.lat)<=90 && Math.abs(fix.lon)<=180 && fix.accuracy>=0 && fix.accuracy<=30 && now-fix.time>=0 && now-fix.time<=15000;
}
export async function addPoint(name, depth, fix) {
  if (!fresh(fix)) throw new Error('Vänta på en färsk GPS-position med högst 30 meters osäkerhet.');
  const point = {id:crypto.randomUUID(),name:String(name).trim().slice(0,100)||'Mätning',depth:decimal(depth,'Djupet',0,12000),lat:fix.lat,lon:fix.lon,time:Date.now(),revision:1,versions:{},deleted:false};
  await put('points',point.id,point); return point;
}
export const editPoint = (id, values) => change('points',id,point => {
  if (!point || point.deleted) throw new Error('Punkten finns inte kvar.');
  return {...point,depth:decimal(values.depth,'Djupet',0,12000),lat:decimal(values.lat,'Latituden',-90,90),lon:decimal(values.lon,'Longituden',-180,180),revision:point.revision+1};
});
export const deletePoint = id => change('points',id,point => point ? {...point,deleted:true,revision:point.revision+1} : undefined);
export function csv(pointList) {
  return 'Datum,Tid,Latitud,Longitud,Fart,Djup\n' + pointList.map(point => {
    const [date,time] = new Date(point.time).toISOString().split('T');
    return [date,time,point.lat.toFixed(7),point.lon.toFixed(7),'',point.depth.toFixed(3)].join(',');
  }).join('\n') + '\n';
}
export async function hash(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
