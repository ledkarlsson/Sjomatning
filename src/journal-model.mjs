export const validJournalId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function validateEvent(value) {
  if (!value || !validJournalId(value.id)) throw new Error('Ogiltigt händelse-id.');
  if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 10000) throw new Error('Skriv en händelse med 1–10 000 tecken.');
  if (typeof value.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value.occurredAt) || !Number.isFinite(Date.parse(value.occurredAt))) throw new Error('Ange giltigt datum och klockslag.');
  const lat=value.lat ?? null, lon=value.lon ?? null;
  if ((lat===null)!==(lon===null) || (lat!==null && (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180))) throw new Error('Ange både latitud (−90 till 90) och longitud (−180 till 180), eller lämna båda tomma.');
  const depth=value.depth??null;
  if(depth!==null&&(!Number.isFinite(depth)||depth<0||depth>12000))throw new Error('Ange ett djup mellan 0 och 12 000 meter eller lämna tomt.');
  return {id:value.id,text:value.text.trim().replace(/\r\n?/g,'\n'),occurredAt:new Date(value.occurredAt).toISOString(),lat,lon,depth};
}
export function orderedEvents(rows) { return rows.filter(row=>!row.deleted).sort((a,b)=>a.event.occurredAt.localeCompare(b.event.occurredAt)||a.event.id.localeCompare(b.event.id)); }
export function exportJournal(rows,format) {
  const events=orderedEvents(rows).map(row=>validateEvent(row.event));
  if (format==='json') return JSON.stringify({format:'SjomatningObservationJournal',version:1,events},null,2)+'\n';
  if (format!=='csv') throw new Error('Okänt exportformat.');
  // Prevent spreadsheet formula execution while retaining complete text in JSON.
  const cell=value=>'"'+(typeof value==='string'?value.replace(/^[=+\-@\t\r]/,match=>"'"+match):String(value??'')).replaceAll('"','""')+'"';
  return '\uFEFF'+['Id;Datum och tid (UTC);Latitud;Longitud;Djup (m);Händelse',...events.map(e=>[e.id,e.occurredAt,e.lat,e.lon,e.depth,e.text].map(cell).join(';'))].join('\r\n')+'\r\n';
}
export function localDateTime(iso) {
  const d=new Date(iso), pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
