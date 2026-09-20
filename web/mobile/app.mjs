import * as db from './storage.mjs';
import {client,account,syncPoints,syncLibrary,readLibrary,InvalidKey} from './sync.mjs';
const $ = id => document.getElementById(id);
let credential, fix=null, watch=null, syncing=false, limit=50, deleting=null, deferredInstall=null, gpsError='', initialized=false;
let pointList=[], library=null, lastSync=0, mapReady=false, mapOwner=null, saving=false;
const channel = typeof BroadcastChannel==='function' ? new BroadcastChannel('sjomatning-mobile') : null;
const report = error => { $('pointFeedback').textContent = error.name==='QuotaExceededError' ? 'Telefonens lagring är full. Punkten kunde inte sparas. Frigör utrymme och försök igen.' : error.message; };
function map() { try { const frame=$('chart').contentWindow;return frame.document.querySelector('#map')?frame:null; } catch { return null; } }
function configureMap() {
  if (!mapReady || !map()) return;
  const owner = credential?.account.id;
  if(mapOwner!==owner){map()?.resetLibrary?.();mapOwner=owner;}
  map().readLibrary = path => { if (!owner) throw new Error('Ange webbnyckeln och synka för att hämta fältmanus.'); return readLibrary(owner,path); };
  map().librarySettings = library?.settings || {};
  map().ChartAccess = {openLibrary:()=>{
    if (!credential) { openKey(); map().libraryError('Ange webbnyckeln för att hämta fältmanus.'); }
    else if (!library) { map().libraryError('Synka först för att hämta fältmanus.'); void synchronize(); }
    else void map().libraryReady();
  }};
  updatePosition();
}
$('chart').addEventListener('load',()=>{mapReady=!!map()?.libraryReady;configureMap();});
if(map()?.libraryReady)mapReady=true;
function updatePosition() {
  const ready = !document.hidden && db.fresh(fix);
  $('savePoint').disabled = !initialized || saving || !ready;
  if (mapReady) map()?.updatePosition?.({fix:fix ? {...fix,fresh:ready} : null});
  $('gpsStatus').textContent = fix ? `${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}\n±${Math.round(fix.accuracy)} m · ${ready?'Aktuell position':'Väntar på bättre GPS'}` : (gpsError || 'Söker GPS-position…');
}
function stopGps() { if (watch!==null) navigator.geolocation?.clearWatch(watch); watch=null; }
function startGps() {
  stopGps(); gpsError='';
  if (!navigator.geolocation) { gpsError='GPS stöds inte av den här webbläsaren.'; updatePosition(); return; }
  watch = navigator.geolocation.watchPosition(position=>{
    fix={lat:position.coords.latitude,lon:position.coords.longitude,accuracy:position.coords.accuracy,time:position.timestamp};
    gpsError=''; updatePosition();
  },error=>{gpsError=error.code===1?'Tillåt platsåtkomst i webbläsarens inställningar.':'GPS kunde inte läsas. Försök igen utomhus.'; if(!db.fresh(fix))fix=null; updatePosition();},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
}
$('gps').onclick = startGps;
function networkState() { $('connection').textContent=navigator.onLine?'Online':'Offline · sparar lokalt'; $('connection').classList.toggle('offline',!navigator.onLine); }
async function refresh() {
  pointList=(await db.points()).filter(point=>!point.deleted);
  credential=await db.get('settings','credential');
  library=credential ? await db.get('settings','library/'+credential.account.id) : null;
  $('account').textContent=credential ? credential.account.name : 'Synka till webben';
  $('libraryStatus').textContent=library ? `${library.files.length} fältmanus sparade · ${new Date(library.syncedAt).toLocaleString('sv-SE')}` : 'Inga fältmanus hämtade ännu.';
  $('count').textContent=String(pointList.length);$('export').disabled=!pointList.length;
  const container=$('points');container.replaceChildren();
  if (!pointList.length) { const p=document.createElement('p');p.className='muted';p.textContent='Ingen punkt ännu. Din första mätning börjar ovanför.';container.append(p); }
  for (const point of pointList.slice(0,limit)) {
    const row=document.createElement('article');row.className='point-row';
    const info=document.createElement('div'),title=document.createElement('h3'),time=document.createElement('p'),coords=document.createElement('p');
    title.textContent=`${point.name} · ${point.depth.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})} m`;
    time.textContent=new Date(point.time).toLocaleString('sv-SE');coords.textContent=`${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;info.append(title,time,coords);
    const actions=document.createElement('div');actions.className='point-actions';
    const edit=document.createElement('button');edit.className='quiet';edit.textContent='Ändra';edit.dataset.edit=point.id;edit.setAttribute('aria-label','Ändra '+point.name);
    const remove=document.createElement('button');remove.className='quiet delete';remove.textContent='Ta bort';remove.dataset.delete=point.id;remove.setAttribute('aria-label','Ta bort '+point.name);
    actions.append(edit,remove);row.append(info,actions);container.append(row);
  }
  $('more').hidden=pointList.length<=limit;
  configureMap();
}
async function changed() { await refresh();channel?.postMessage('changed'); }
$('capture').onsubmit=async event=>{
  event.preventDefault();if(saving)return;saving=true;const button=$('savePoint');button.disabled=true;
  try { await db.addPoint($('name').value,$('depth').value,fix);$('pointFeedback').textContent='Punkten är sparad i telefonen.';await changed();void navigator.storage?.persist?.().catch(()=>{}); }
  catch(error) { report(error); } finally { saving=false;updatePosition(); }
};
$('points').onclick=event=>{
  const edit=event.target.closest('[data-edit]'),remove=event.target.closest('[data-delete]');
  if (edit) { const p=pointList.find(p=>p.id===edit.dataset.edit);if(!p)return;$('editId').value=p.id;$('editDepth').value=p.depth;$('editLat').value=p.lat;$('editLon').value=p.lon;$('editError').textContent='';$('editDialog').showModal(); }
  if (remove) { deleting=remove.dataset.delete;$('deleteDialog').showModal(); }
};
$('editForm').onsubmit=async event=>{
  event.preventDefault();try { await db.editPoint($('editId').value,{depth:$('editDepth').value,lat:$('editLat').value,lon:$('editLon').value});$('editDialog').close();await changed(); }
  catch(error) { $('editError').textContent=error.message; }
};
$('closeEdit').onclick=()=>$('editDialog').close();
$('cancelDelete').onclick=()=>$('deleteDialog').close();
$('confirmDelete').onclick=async()=>{try { if(deleting)await db.deletePoint(deleting);deleting=null;$('deleteDialog').close();await changed(); }catch(error){report(error);} };
$('more').onclick=()=>{limit+=50;void refresh().catch(report);};
$('export').onclick=()=>{
  const url=URL.createObjectURL(new Blob(['\ufeff'+db.csv(pointList)],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='Sjomatning-'+new Date().toISOString().slice(0,10)+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
};
function openKey() { $('keyError').textContent='';$('key').value='';if(!$('keyDialog').open)$('keyDialog').showModal(); }
$('access').onclick=openKey;$('closeKey').onclick=()=>$('keyDialog').close();
const locked = action => {
  if (!navigator.locks) throw new Error('Uppdatera webbläsaren för säker synkning. Dina punkter finns kvar lokalt.');
  return navigator.locks.request('sjomatning-mobile-sync',action);
};
$('keyForm').onsubmit=async event=>{
  event.preventDefault();$('saveKey').disabled=true;
  try {
    const key=$('key').value.trim();
    await locked(async()=>{ const user=await account(client(key));await db.put('settings','credential',{key,account:user}); });
    $('key').value='';$('keyDialog').close();map()?.resetLibrary?.();await changed();await synchronize();
  } catch(error) { $('keyError').textContent=error.message; } finally { $('saveKey').disabled=false; }
};
$('forgetKey').onclick=async()=>{
  try { await locked(()=>db.put('settings','credential',undefined));$('key').value='';$('keyDialog').close();map()?.resetLibrary?.();await changed();$('syncStatus').textContent='Nyckeln är borttagen. Dina lokala punkter finns kvar.'; }
  catch(error) { $('keyError').textContent=error.message; }
};
async function synchronize(manual=false) {
  if(syncing||!initialized)return;
  if(!navigator.onLine){$('syncStatus').textContent='Offline. Punkter och hämtade fältmanus finns i telefonen.';return;}
  if(!await db.get('settings','credential')){if(manual)openKey();return;}
  syncing=true;$('sync').disabled=true;$('sync').textContent='Synkar…';
  let usedKey;
  try {
    await locked(async()=>{
      const saved=await db.get('settings','credential');if(!saved)return;usedKey=saved.key;
      const api=client(saved.key),user=await account(api),progress=text=>$('syncStatus').textContent=text;
      if(user.id!==saved.account.id)throw new Error('Kontot har ändrats. Ange webbnyckeln igen.');
      await syncPoints(api,user.id,progress);
      await syncLibrary(api,user.id,progress);
      await db.put('settings','lastSync',Date.now());
      $('syncStatus').textContent='Punkter och fältmanus är synkade.';
    });
    lastSync=Date.now();await changed();map()?.refreshLibrary?.();
  } catch(error) {
    if(error instanceof InvalidKey){await db.change('settings','credential',saved=>saved?.key===usedKey?undefined:saved);map()?.resetLibrary?.();await changed();openKey();}
    $('syncStatus').textContent=error.name==='AbortError'?'Synkningen tog för lång tid. Sparade data finns kvar; försök igen.':error.message+' Sparade data finns kvar.';
  } finally {syncing=false;$('sync').disabled=false;$('sync').textContent='Synka nu';}
}
$('sync').onclick=()=>{void synchronize(true).catch(report);};
channel && (channel.onmessage=()=>{void refresh().catch(report);});
window.addEventListener('online',()=>{networkState();void synchronize().catch(report);});window.addEventListener('offline',networkState);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopGps();updatePosition();}else{fix=null;startGps();if(Date.now()-lastSync>60000)void synchronize().catch(report);}});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;});
$('install').onclick=async()=>{if(deferredInstall){await deferredInstall.prompt();deferredInstall=null;}else $('installDialog').showModal();void navigator.storage?.persist?.().catch(()=>{});};
$('closeInstall').onclick=()=>$('installDialog').close();
window.addEventListener('appinstalled',()=>{$('install').hidden=true;});
if(matchMedia('(display-mode: standalone)').matches||navigator.standalone)$('install').hidden=true;
async function offlineSetup() {
  if(!('serviceWorker' in navigator)){ $('offlineStatus').textContent='Den här webbläsaren kan inte spara appen för offlineanvändning.';return; }
  try {
    await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
    await navigator.serviceWorker.ready;
    $('offlineStatus').textContent='Appen är redo att öppnas offline. Synka en gång för att hämta fältmanus.';
  } catch { $('offlineStatus').textContent='Appen kunde inte förberedas för offline. Öppna den igen med internet.'; }
}
try {await refresh();initialized=true;networkState();startGps();setInterval(updatePosition,1000);void offlineSetup();void synchronize().catch(report);}
catch(error){report(error);$('syncStatus').textContent='Lokal lagring kunde inte öppnas. Kontrollera webbläsarens lagringsinställningar.';}
