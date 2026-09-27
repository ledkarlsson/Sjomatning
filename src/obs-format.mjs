import {validateEvent} from './journal-model.mjs';
export function obsCoordinate(value,limit){
 if(typeof value!=='string'||!/^[-+]?\d+\s+\d+(?:\.\d+)?$/.test(value.trim()))throw new Error('OBS-koordinater ska anges i grader och minuter.');
 const [d,m]=value.trim().split(/\s+/).map(Number),result=(value.trim().startsWith('-')?-1:1)*(Math.abs(d)+m/60);
 if(!Number.isFinite(result)||m>=60||Math.abs(result)>limit)throw new Error('Ogiltig OBS-koordinat.');return result;
}
const point=p=>({lat:obsCoordinate(p.latitude,90),lon:obsCoordinate(p.longitude,180)});
async function id(text){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));const hex=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export async function importObs(text,name){
 if(text.length>10000000)throw new Error('OBS-filen är för stor.');const doc=JSON.parse(text.replace(/^\uFEFF/,''));
 if(doc.format!=='KodObservationFile'||doc.version!==1||!/^\d{4}-\d\d-\d\d$/.test(doc.date)||new Date(doc.date).toISOString().slice(0,10)!==doc.date||!Array.isArray(doc.observations))throw new Error('Ogiltig OBS-fil eller formatversion.');
 const {observations,...header}=doc,survey={id:await id(JSON.stringify(header)),name:name.replace(/\.obs$/i,''),vessel:doc.vessel,area:doc.area,waterLevel:doc.water_level_m,referenceLevel:33,reference:'RH00'},fingerprint=await id(JSON.stringify(doc));
 const events=[];for(const [index,obs] of observations.entries()){
  if(!['note','depth','mooring'].includes(obs.type))throw new Error(`Okänd OBS-typ i observation ${index+1}.`);
  if(obs.type==='depth'&&(!Number.isFinite(obs.depth?.measured_m)||typeof obs.depth?.method!=='string'||!obs.depth.method.trim()))throw new Error(`Djup eller mätmetod saknas i observation ${index+1}.`);
  const positions=obs.type==='mooring'?obs.points?.map(point):[point(obs)];if(!positions||positions.length<(obs.type==='mooring'?2:1))throw new Error('Tilläggningsplatsen behöver minst två positioner.');
  const occurredAt=obs.sjomatning?.occurredAt??doc.date+'T00:00:00.000Z',dateOnly=!obs.sjomatning?.occurredAt;
  const event={id:await id(fingerprint+':'+index),text:obs.comment?.trim()||({depth:'Djupobservation',note:'Notering',mooring:'Tilläggningsplats'})[obs.type],occurredAt,dateOnly,...positions[0],depth:obs.type==='depth'?obs.depth?.measured_m:null,method:obs.type==='depth'?obs.depth?.method:null,survey,kind:obs.type,positions:obs.type==='mooring'?positions:undefined,obs:{header,observation:obs}};
  events.push(validateEvent(event));
 }
 return events;
}
const dm=(v,old,limit)=>{if(old!==undefined&&Math.abs(obsCoordinate(old,limit)-v)<1e-10)return old;const sign=v<0?'-':'',n=Math.abs(v);return sign+Math.floor(n)+' '+((n-Math.floor(n))*60).toFixed(8);};
export function obsGroups(rows){const groups=new Map();for(const row of rows){if(row.deleted)continue;const e=row.event;if(!e.survey)continue;const date=e.occurredAt.slice(0,10),key=e.survey.id+':'+date;if(!groups.has(key))groups.set(key,{key,name:e.survey.name+' · '+date,events:[]});groups.get(key).events.push(e);}return [...groups.values()];}
export function exportObs(events){
 if(!events.length)throw new Error('Inga observationer att exportera.');const first=events[0],s=first.survey,date=first.occurredAt.slice(0,10);
 if(!s||s.referenceLevel!==33||s.reference!=='RH00')throw new Error('Jonas OBS använder referens 33,00 m RH00. Välj ett mätpass med den referensen.');
 const observations=events.map(e=>{if(e.survey?.id!==s.id||e.occurredAt.slice(0,10)!==date)throw new Error('En OBS-fil ska avse ett mätpass och datum.');if(e.lat==null)throw new Error('Alla OBS-observationer måste ha position.');
  const original=e.obs?.observation||{},type=e.kind==='mooring'?'mooring':e.depth!=null?'depth':'note',result={...original,type};delete result.latitude;delete result.longitude;delete result.points;delete result.depth;
  const position=(p,old={})=>({...old,latitude:dm(p.lat,old.latitude,90),longitude:dm(p.lon,old.longitude,180)});
  if(type==='mooring')result.points=e.positions.map((p,i)=>position(i===0?e:p,original.points?.[i]));else Object.assign(result,{latitude:dm(e.lat,original.latitude,90),longitude:dm(e.lon,original.longitude,180)});
  if(type==='depth'){if(!e.method)throw new Error('Ange mätmetod innan OBS-export.');result.depth={...original.depth,measured_m:e.depth,method:e.method};}
  const fallback={depth:'Djupobservation',note:'Notering',mooring:'Tilläggningsplats'}[type];if(e.text!==fallback||original.comment)result.comment=e.text;
  if(!e.dateOnly)result.sjomatning={...original.sjomatning,occurredAt:e.occurredAt};else if(result.sjomatning){result.sjomatning={...result.sjomatning};delete result.sjomatning.occurredAt;}
  return result;
 });
 return JSON.stringify({...first.obs?.header,format:'KodObservationFile',version:1,date,vessel:s.vessel,area:s.area,water_level_m:s.waterLevel,observations},null,2)+'\n';
}
