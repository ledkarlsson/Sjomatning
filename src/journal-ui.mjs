import {surveyForm} from './survey-form.mjs';
import {mountObsTools} from './obs-ui.mjs';
import {localDateTime,observationDetails,eventTimeText} from './journal-model.mjs';
export function mountJournal(api,getPosition,map={}) {
  if(!api.journalList)return;
  const host=document.createElement('section');host.className='panel journal-panel';
  host.innerHTML='<h2>Observationsdagbok</h2><p>Skriv händelser under mätningen. Datum och tid visas i din lokala tidszon och kan ändras.</p><button class="button" data-open>Öppna dagboken</button>';
  document.getElementById('folderPanel').before(host);
  const dialog=document.createElement('dialog');dialog.className='journal-dialog';
  dialog.innerHTML=`<header class="journal-heading"><h2>Observationsdagbok</h2><button type="button" data-close>Stäng</button></header>
    <p data-location></p><p data-status role="status" aria-live="polite"></p>
    <div class="journal-toolbar"><button type="button" data-new>Ny händelse</button><button type="button" data-refresh>Läs in igen</button><button type="button" data-sync>Synka med webben</button><button type="button" data-export="json">Exportera JSON</button><button type="button" data-export="csv">Exportera CSV</button><button type="button" data-export="pdf">Exportera PDF</button></div>
    <div class="journal-columns"><form data-editor><h3 data-title>Ny händelse</h3><label>Datum och tid (lokal tid)<input name="occurredAt" type="datetime-local" step="1" required></label>
    <label>Händelse<textarea name="text" rows="7" maxlength="10000" required placeholder="Till exempel: Gick på grund vid inloppet. Kontrollmät här."></textarea></label>
    <label>Rådjup i meter (valfritt)<input name="depth" type="number" min="-12000" max="12000" step="any"></label>
    <div class="coordinate-grid"><label>Latitud (valfri)<input name="lat" type="number" min="-90" max="90" step="any"></label><label>Longitud (valfri)<input name="lon" type="number" min="-180" max="180" step="any"></label></div>
    <button type="button" data-map-position>Välj position i kartan</button> <button type="button" data-position>Använd aktuell GPS-position</button><div class="journal-toolbar"><button type="submit" class="button">Spara händelse</button><button type="button" data-delete hidden>Ta bort händelse</button></div></form>
    <section><h3>Sparade händelser</h3><div data-list></div></section></div>`;
  document.body.append(dialog);
  const $=selector=>dialog.querySelector(selector),form=$('[data-editor]'),status=$('[data-status]');
  const survey=surveyForm(form);
  const timeChoice=document.createElement('label');timeChoice.innerHTML='<input name="timeKnown" type="checkbox" checked>Klockslag är känt';form.querySelector('[name=occurredAt]').closest('label').after(timeChoice);
  const mooring=document.createElement('label');mooring.hidden=true;mooring.innerHTML='Tilläggningsplatsens positioner (latitud;longitud, en per rad)<textarea name="positions" rows="4"></textarea>';form.querySelector('[name=lon]').closest('.coordinate-grid').after(mooring);
  let rows=[],selected=null,dirty=false,busy=false,draftId=crypto.randomUUID(),loadVersion=0;
  const field=name=>form.elements.namedItem(name);
  function setBusy(value){busy=value;dialog.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=value);}
  function discard(){return !dirty||confirm('Lämna osparade ändringar i händelsen?');}
  function select(row){
    selected=row;draftId=row?.event.id??crypto.randomUUID();form.reset();field('occurredAt').value=localDateTime(row?.event.occurredAt??new Date().toISOString());
    field('depth').value=row?.event.depth??'';field('text').value=row?.event.text??'';field('lat').value=row?.event.lat??'';field('lon').value=row?.event.lon??'';
    survey.select(row?.event);
    field('timeKnown').checked=!row?.event.dateOnly;field('occurredAt').type=row?.event.dateOnly?'date':'datetime-local';field('occurredAt').value=row?.event.dateOnly?row.event.occurredAt.slice(0,10):localDateTime(row?.event.occurredAt??new Date().toISOString());
    $('[data-map-position]').hidden=!map.pick||row?.event.kind==='mooring';$('[data-position]').hidden=row?.event.kind==='mooring';
    field('lat').readOnly=field('lon').readOnly=row?.event.kind==='mooring';mooring.hidden=row?.event.kind!=='mooring';field('positions').value=(row?.event.positions||[]).map(p=>p.lat+';'+p.lon).join('\n');
    $('[data-title]').textContent=row?'Redigera händelse':'Ny händelse';$('[data-delete]').hidden=!row;dirty=false;
  }
  function render(){
    const list=$('[data-list]');list.replaceChildren();
    for(const row of [...rows].sort((a,b)=>b.event.occurredAt.localeCompare(a.event.occurredAt))){
      if(row.deleted&&!row.conflict)continue;
      const item=document.createElement('article');item.className='journal-entry';
      const heading=document.createElement('button');heading.type='button';heading.textContent=(row.event.dateOnly?eventTimeText(row.event):new Date(row.event.occurredAt).toLocaleString('sv-SE'))+(row.dirty?' · Ej synkad':'');
      heading.onclick=()=>{if(discard())select(row);};
      const text=document.createElement('p');text.textContent=row.event.text;item.append(heading,text);
      for(const detail of observationDetails(row.event)){const p=document.createElement('p');p.textContent=detail;item.append(p);}
      if(row.event.lat!==null){const position=document.createElement('small');position.textContent=`${row.event.lat}, ${row.event.lon}`;item.append(position);}
      if(row.conflict){
        const warning=document.createElement('p');warning.textContent='Synkkonflikt. Webbversion: '+(row.conflict.deleted?'Borttagen':eventTimeText(row.conflict.event)+' · '+row.conflict.event.text+' · Djup: '+(row.conflict.event.depth==null?'saknas':row.conflict.event.depth+' m')+' · Position: '+(row.conflict.event.lat==null?'saknas':row.conflict.event.lat+', '+row.conflict.event.lon)+' · '+observationDetails(row.conflict.event).join(' · '));item.append(warning);
        for(const [choice,label] of [['local','Behåll min ändring'],['remote','Använd webbversion']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>run(async()=>{if(!discard())return;await api.journalResolve(row.event.id,choice);await reload();select(null);status.textContent=choice==='local'?'Din version är vald. Synka för att skicka den.':'Webbversionen har hämtats.';});item.append(button);}
      }
      list.append(item);
    }
    if(!list.children.length)list.textContent='Inga händelser ännu.';
  }
  async function reload(){const version=++loadVersion;const data=await api.journalList();if(version!==loadVersion)return;rows=data.rows;survey.rows(rows);render();map.onRows?.(rows);}
  async function run(fn){if(busy)return;setBusy(true);try{await fn();}catch(error){status.textContent=error.message;}finally{setBusy(false);}}
  form.oninput=()=>{dirty=true;};
  field('timeKnown').onchange=()=>{const date=field('occurredAt').value.slice(0,10);field('occurredAt').type=field('timeKnown').checked?'datetime-local':'date';field('occurredAt').value=field('timeKnown').checked?date+'T00:00:00':date;dirty=true;};
  function open(row=null){if(busy||(!dialog.open&&!discard()))return false;if(!dialog.open)dialog.showModal();select(row);status.textContent='';$('[data-location]').textContent=api.journalSync?'Sparas på datorn. Synka för att skicka och hämta händelser med din personliga webbnyckel.':'Sparas direkt i din personliga dagbok på webben. Internet krävs.';void run(reload);return true;}
  host.querySelector('[data-open]').onclick=()=>open();
  $('[data-close]').onclick=()=>{if(!busy&&discard())dialog.close();};
  dialog.oncancel=event=>{if(busy||!discard())event.preventDefault();};
  $('[data-new]').onclick=()=>{if(discard())select(null);};
  $('[data-refresh]').onclick=()=>run(async()=>{if(!discard())return;await reload();select(null);status.textContent='Dagboken är inläst.';});
  form.onsubmit=event=>{event.preventDefault();void run(async()=>{
    const data={id:draftId,occurredAt:new Date(field('occurredAt').value).toISOString(),text:field('text').value,depth:field('depth').value===''?null:Number(field('depth').value),lat:field('lat').value===''?null:Number(field('lat').value),lon:field('lon').value===''?null:Number(field('lon').value)};
    Object.assign(data,survey.read());
    data.dateOnly=!field('timeKnown').checked;if(data.dateOnly)data.occurredAt=field('occurredAt').value+'T00:00:00.000Z';
    if(selected?.event.obs)data.obs=selected.event.obs;
    if(selected?.event.kind==='mooring'){data.kind='mooring';data.positions=field('positions').value.trim().split('\n').map(line=>{const [lat,lon]=line.split(';').map(Number);return {lat,lon};});data.lat=data.positions[0]?.lat;data.lon=data.positions[0]?.lon;}else data.kind=data.depth==null?'note':'depth';
    const saved=await api.journalSave({event:data,expectedMutation:selected?.mutation??null,baseRevision:selected?.revision??0,deleted:false});
    survey.saved(saved.event);await reload();select(rows.find(row=>row.event.id===saved.event.id));status.textContent=api.journalSync?'Händelsen är sparad på datorn.':'Händelsen är sparad på webben.';
  });};
  $('[data-delete]').onclick=()=>run(async()=>{if(!selected||!confirm('Ta bort händelsen?'))return;await api.journalSave({event:selected.event,expectedMutation:selected.mutation,baseRevision:selected.revision,deleted:true});await reload();select(null);status.textContent='Händelsen är borttagen.';});
  $('[data-map-position]').hidden=!map.pick;
  $('[data-map-position]').onclick=()=>run(async()=>{
    dialog.close();
    try {
      const point=await map.pick();
      if(point){field('lat').value=point.lat.toFixed(6);field('lon').value=point.lon.toFixed(6);dirty=true;status.textContent='Positionen är vald. Spara händelsen för att behålla ändringen.';}
    }finally{dialog.showModal();}
  });
  $('[data-position]').onclick=()=>run(async()=>{const position=await getPosition();if(!position)throw new Error('Ingen aktuell GPS-position. Ange koordinater manuellt eller lämna dem tomma.');field('lat').value=position.lat;field('lon').value=position.lon;dirty=true;});
  $('[data-sync]').hidden=!api.journalSync;
  $('[data-sync]').onclick=()=>run(async()=>{
    if(!discard())return;
    let result=await api.journalSync({});
    if(result.needsToken){
      setBusy(false);
      const token=await askKey(result.message);setBusy(true);
      if(token===null)return;
      result=await api.journalSync({token});
      if(result.needsToken)throw new Error(result.message);
    }
    await reload();select(null);status.textContent=result.conflicts?`${result.conflicts} konflikt(er). Välj vilken version som ska behållas i listan.`:`Synkad med ${result.account}.`;
  });
  dialog.querySelectorAll('[data-export]').forEach(button=>button.onclick=()=>run(async()=>{if(dirty)throw new Error('Spara dina ändringar innan du exporterar.');const result=await api.journalExport(button.dataset.export);status.textContent=result?'Dagboken är exporterad.':'Exporten avbröts.';}));
  window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
  void reload().catch(error=>{const message=document.createElement('p');message.textContent='Kunde inte läsa dagbokens kartmarkeringar: '+error.message;host.append(message);});
  mountObsTools(host,api,reload);
  return {open:id=>open(rows.find(row=>row.event.id===id)),createAt:point=>{if(!open())return;field('lat').value=point.lat.toFixed(6);field('lon').value=point.lon.toFixed(6);dirty=true;}};
}
function askKey(message){
  const dialog=document.createElement('dialog');dialog.className='journal-dialog';
  dialog.innerHTML='<form><h2>Webbnyckel för dagboken</h2><p></p><label>Personlig åtkomstnyckel<input type="password" required autocomplete="off"></label><button type="submit">Spara och synka</button><button type="button">Avbryt</button></form>';
  dialog.querySelector('p').textContent=message;document.body.append(dialog);dialog.showModal();
  return new Promise(resolve=>{let token=null;dialog.querySelector('form').onsubmit=e=>{e.preventDefault();token=dialog.querySelector('input').value.trim();dialog.close();};dialog.querySelector('[type=button]').onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();resolve(token);};});
}
