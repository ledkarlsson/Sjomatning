export const validJournalId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export const eventTimeText=e=>e.dateOnly?e.occurredAt.slice(0,10)+' (klockslag saknas)':e.occurredAt.replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC');
export const measurementMethods={pole:'Stångmätning',echo_sounder_manual:'Ekolod manuellt',echo_sounder_nmea:'Ekolod från NMEA',visual_estimate:'Uppskattat djup/höjd'};
export function validateSurvey(value){
  if(value==null)return null;
  if(!validJournalId(value.id))throw new Error('Ogiltigt mätpass.');
  const result={id:value.id};
  for(const key of ['name','vessel','area','reference']){
    if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>180)throw new Error('Ange mätpassets namn, båt/källa, område och höjdsystem (högst 180 tecken).');
    result[key]=value[key].trim();
  }
  for(const key of ['waterLevel','referenceLevel']){
    if(!Number.isFinite(value[key])||Math.abs(value[key])>10000)throw new Error('Ange giltigt vattenstånd och referensnivå.');
    result[key]=value[key];
  }
  return result;
}
export function observationDepth(event){return event.depth==null?null:event.survey?event.depth-(event.survey.waterLevel-event.survey.referenceLevel):event.depth;}
export function observationDetails(event){
 const lines=[];
 if(event.survey){const s=event.survey;lines.push(`Mätpass: ${s.name} | Båt/källa: ${s.vessel} | Område: ${s.area}`,`Vattenstånd: ${s.waterLevel} m | Referens: ${s.referenceLevel} m ${s.reference}`);}
 if(event.depth!=null){lines.push(`Rådjup: ${event.depth.toFixed(2)} m | Metod: ${measurementMethods[event.method]||event.method||'Ej angiven'}`);if(event.survey)lines.push(`Korrigerat djup: ${observationDepth(event).toFixed(2)} m (rådjup - (vattenstånd - referensnivå))`);else lines.push('Vattenstånd saknas: djupet är inte vattenståndskorrigerat.');}
 return lines;
}
export function validateEvent(value) {
  if (!value || !validJournalId(value.id)) throw new Error('Ogiltigt händelse-id.');
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 10000) throw new Error('Skriv en händelse med 1–10 000 tecken.');
  if (typeof value.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value.occurredAt) || !Number.isFinite(Date.parse(value.occurredAt))) throw new Error('Ange giltigt datum och klockslag.');
  const lat=value.lat ?? null, lon=value.lon ?? null;
  if ((lat===null)!==(lon===null) || (lat!==null && (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180))) throw new Error('Ange både latitud (−90 till 90) och longitud (−180 till 180), eller lämna båda tomma.');
  const depth=value.depth??null;
  if(depth!==null&&(!Number.isFinite(depth)||depth< -12000||depth>12000))throw new Error('Ange ett djup mellan −12 000 och 12 000 meter eller lämna tomt.');
  const survey=validateSurvey(value.survey),method=value.method??null;
  if(method!==null&&(typeof method!=='string'||!method.trim()||method.length>80))throw new Error('Ogiltig mätmetod.');
  if(survey&&depth!==null&&!method)throw new Error('Välj mätmetod för mätpassets djupobservation.');
  const extra={};if(value.dateOnly)extra.dateOnly=true;
  if(value.kind){if(!['note','depth','mooring'].includes(value.kind))throw new Error('Ogiltig observationstyp.');extra.kind=value.kind;}
  if(value.kind==='mooring'){if(lat===null||!Array.isArray(value.positions)||value.positions.length<2||value.positions.length>1000||value.positions.some(p=>!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180))throw new Error('Ogiltiga tilläggningspositioner.');extra.positions=value.positions.map(p=>({lat:p.lat,lon:p.lon}));extra.positions[0]={lat,lon};}
  if(value.obs){if(typeof value.obs!=='object'||!value.obs.header||!value.obs.observation||JSON.stringify(value.obs).length>30000)throw new Error('Ogiltigt OBS-underlag.');extra.obs=JSON.parse(JSON.stringify(value.obs));}
  return {id:value.id,text:value.text.trim().replace(/\r\n?/g,'\n'),occurredAt:new Date(value.occurredAt).toISOString(),lat,lon,depth,...(survey?{survey}:{}),...(method?{method}:{}),...extra};
}
export function orderedEvents(rows) { return rows.filter(row=>!row.deleted).sort((a,b)=>a.event.occurredAt.localeCompare(b.event.occurredAt)||a.event.id.localeCompare(b.event.id)); }
export function exportJournal(rows,format) {
  const events=orderedEvents(rows).map(row=>validateEvent(row.event));
  if (format==='json') return JSON.stringify({format:'SjomatningObservationJournal',version:1,events},null,2)+'\n';
  if (format!=='csv') throw new Error('Okänt exportformat.');
  // Prevent spreadsheet formula execution while retaining complete text in JSON.
  const cell=value=>'"'+(typeof value==='string'?value.replace(/^[=+\-@\t\r]/,match=>"'"+match):String(value??'')).replaceAll('"','""')+'"';
  return '\uFEFF'+['Id;Datum och tid (UTC);Latitud;Longitud;Djup (m);Händelse;Mätmetod;Mätpass-id;Mätpass;Båt;Område;Vattenstånd;Referensnivå;Höjdsystem;Korrigerat djup',...events.map(e=>[e.id,e.dateOnly?e.occurredAt.slice(0,10):e.occurredAt,e.lat,e.lon,e.depth,e.text,measurementMethods[e.method],e.survey?.id,e.survey?.name,e.survey?.vessel,e.survey?.area,e.survey?.waterLevel,e.survey?.referenceLevel,e.survey?.reference,e.survey?observationDepth(e):null].map(cell).join(';'))].join('\r\n')+'\r\n';
}
export function localDateTime(iso) {
  const d=new Date(iso), pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
