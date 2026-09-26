export const validJournalId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
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
 if(event.depth!=null){lines.push(`Rådjup: ${event.depth.toFixed(2)} m | Metod: ${measurementMethods[event.method]||'Ej angiven'}`);if(event.survey)lines.push(`Korrigerat djup: ${observationDepth(event).toFixed(2)} m (rådjup - (vattenstånd - referensnivå))`);else lines.push('Vattenstånd saknas: djupet är inte vattenståndskorrigerat.');}
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
  if(method!==null&&!Object.hasOwn(measurementMethods,method))throw new Error('Ogiltig mätmetod.');
  if(survey&&depth!==null&&!method)throw new Error('Välj mätmetod för mätpassets djupobservation.');
  return {id:value.id,text:value.text.trim().replace(/\r\n?/g,'\n'),occurredAt:new Date(value.occurredAt).toISOString(),lat,lon,depth,...(survey?{survey}:{}),...(method?{method}:{})};
}
export function orderedEvents(rows) { return rows.filter(row=>!row.deleted).sort((a,b)=>a.event.occurredAt.localeCompare(b.event.occurredAt)||a.event.id.localeCompare(b.event.id)); }
export function exportJournal(rows,format) {
  const events=orderedEvents(rows).map(row=>validateEvent(row.event));
  if (format==='json') return JSON.stringify({format:'SjomatningObservationJournal',version:1,events},null,2)+'\n';
  if (format!=='csv') throw new Error('Okänt exportformat.');
  // Prevent spreadsheet formula execution while retaining complete text in JSON.
  const cell=value=>'"'+(typeof value==='string'?value.replace(/^[=+\-@\t\r]/,match=>"'"+match):String(value??'')).replaceAll('"','""')+'"';
  return '\uFEFF'+['Id;Datum och tid (UTC);Latitud;Longitud;Djup (m);Händelse;Mätmetod;Mätpass-id;Mätpass;Båt;Område;Vattenstånd;Referensnivå;Höjdsystem;Korrigerat djup',...events.map(e=>[e.id,e.occurredAt,e.lat,e.lon,e.depth,e.text,measurementMethods[e.method],e.survey?.id,e.survey?.name,e.survey?.vessel,e.survey?.area,e.survey?.waterLevel,e.survey?.referenceLevel,e.survey?.reference,e.survey?observationDepth(e):null].map(cell).join(';'))].join('\r\n')+'\r\n';
}
export function localDateTime(iso) {
  const d=new Date(iso), pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
