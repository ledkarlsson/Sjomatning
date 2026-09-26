export function mountMapContext({canvas,toGeo,available,onEvent,onTrack,error}){
 const menu=document.createElement('div');menu.className='map-context-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','Åtgärder i kartan');
 menu.innerHTML='<button type="button" role="menuitem" data-context-event>Ny händelse här</button><button type="button" role="menuitem" data-context-track>Lägg till spårpunkt här</button>';
 document.body.append(menu);let position=null;
 const close=()=>{menu.hidden=true;};
 canvas.addEventListener('contextmenu',event=>{
  if(!available())return;
  event.preventDefault();close();
  const geo=toGeo(event);
  if(!geo||!Number.isFinite(geo.lat)||!Number.isFinite(geo.lon)||Math.abs(geo.lat)>90||Math.abs(geo.lon)>180){error('Öppna en karta eller kalibrera fältmanuset först.');return;}
  position={lat:geo.lat,lon:geo.lon};menu.hidden=false;
  menu.style.left=Math.max(8,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-8))+'px';menu.querySelector('button').focus();
 });
 for(const [selector,action] of [['[data-context-event]',onEvent],['[data-context-track]',onTrack]])menu.querySelector(selector).onclick=()=>{const point=position;close();Promise.resolve().then(()=>action(point)).catch(e=>error(e.message));};
 document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();},true);
 document.addEventListener('keydown',event=>{
  if(menu.hidden)return;
  if(event.key==='Escape'){event.preventDefault();close();canvas.focus();}
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const buttons=[...menu.querySelectorAll('button')];buttons[(buttons.indexOf(document.activeElement)+1)%buttons.length].focus();}
  if(event.key==='Tab')close();
 });
 window.addEventListener('resize',close);document.addEventListener('scroll',close,true);canvas.addEventListener('wheel',close);
}
export function trackPointDialog(point,tracks,save){
 const dialog=document.createElement('dialog');dialog.className='journal-dialog';
 dialog.innerHTML='<form><h2>Lägg till spårpunkt</h2><p data-position></p><label>Spår<select name="track"><option value="">Skapa nytt spår</option></select></label><label data-name>Spårnamn<input name="name" maxlength="180" value="Manuellt spår" required></label><label>Rådjup i meter (valfritt)<input name="depth" type="number" min="0" max="12000" step="any"></label><p>Punkten placeras sist i spåret. Den är manuellt placerad, utan mättid. Befintliga spårets djupjustering gäller även denna punkt.</p><p role="status"></p><button type="submit">Spara spårpunkt</button> <button type="button" data-cancel>Avbryt</button></form>';
 const form=dialog.querySelector('form'),select=form.elements.track,status=dialog.querySelector('[role=status]');let busy=false;
 dialog.querySelector('[data-position]').textContent=`Latitud ${point.lat.toFixed(6)} · Longitud ${point.lon.toFixed(6)}`;
 for(const track of tracks){const option=document.createElement('option');option.value=track.id;option.textContent=track.name;select.append(option);}
 select.onchange=()=>{dialog.querySelector('[data-name]').hidden=!!select.value;form.elements.name.required=!select.value;};
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.oncancel=e=>{if(busy)e.preventDefault();};dialog.onclose=()=>dialog.remove();
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const depth=form.elements.depth.value===''?null:Number(form.elements.depth.value),name=form.elements.name.value,id=select.value;
  busy=true;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
  try{await save({id,name,point:{...point,depth}});dialog.close();}catch(error){status.textContent=error.message;}finally{busy=false;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}
 };
 document.body.append(dialog);dialog.showModal();
}
