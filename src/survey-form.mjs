import {measurementMethods,validateSurvey,observationDepth} from './journal-model.mjs';
export function surveyForm(form){
 const host=document.createElement('fieldset');host.innerHTML=`<legend>Mätunderlag</legend><label>Mätpass<select name="survey"><option value="">Utan mätpass</option><option value="new">Nytt mätpass</option></select></label><div data-survey-fields hidden><label>Mätpassets namn<input name="surveyName" maxlength="180"></label><label>Båt eller källa<input name="vessel" maxlength="180"></label><label>Område<input name="area" maxlength="180"></label><label>Vattenstånd (m i angivet höjdsystem)<input name="waterLevel" type="number" step="any"></label><label>Referensnivå (m i samma höjdsystem)<input name="referenceLevel" type="number" step="any"></label><label>Höjdsystem<input name="reference" maxlength="180" placeholder="Till exempel RH00"></label><p>Underlaget sparas med varje händelse. Ändrade passuppgifter gäller denna händelse och ger en ny passversion, inte äldre observationer.</p></div><label>Mätmetod<select name="method"><option value="">Ej angiven</option></select></label><p data-corrected></p>`;
 form.querySelector('[name=depth]').closest('label').after(host);
 const field=n=>form.elements.namedItem(n),select=field('survey'),keys={name:'surveyName',vessel:'vessel',area:'area',waterLevel:'waterLevel',referenceLevel:'referenceLevel',reference:'reference'};
 for(const [value,label] of Object.entries(measurementMethods)){const option=document.createElement('option');option.value=value;option.textContent=label;field('method').append(option);}
 let surveys=new Map(),draftId=crypto.randomUUID(),last=null;
 function fill(s){for(const [key,name] of Object.entries(keys))field(name).value=s?.[key]??'';}
 function update(){
  host.querySelector('[data-survey-fields]').hidden=!select.value;
  for(const name of Object.values(keys))field(name).required=!!select.value;
  field('method').required=!!select.value&&field('depth').value!=='';
  const water=field('waterLevel').value,reference=field('referenceLevel').value,depth=field('depth').value;
  host.querySelector('[data-corrected]').textContent=depth!==''&&select.value&&water!==''&&reference!==''?`Korrigerat djup: ${observationDepth({depth:Number(depth),survey:{waterLevel:Number(water),referenceLevel:Number(reference)}}).toFixed(2)} m. Negativt rådjup anger höjd över vattenytan.`:'Djup utan mätpass redovisas utan vattenståndskorrigering.';
 }
 select.onchange=()=>{draftId=crypto.randomUUID();fill(surveys.get(select.value));update();};
 form.addEventListener('input',update);form.addEventListener('change',update);
 return {
  rows(rows){const selected=select.value;surveys=new Map();for(const row of rows)if(!row.deleted&&row.event.survey)surveys.set(row.event.survey.id,row.event.survey);select.querySelectorAll('[data-saved]').forEach(el=>el.remove());for(const s of surveys.values()){const option=document.createElement('option');option.dataset.saved='';option.value=s.id;option.textContent=`${s.name} · ${s.vessel} · ${s.area} · ${s.waterLevel} m`;select.append(option);}if([...select.options].some(o=>o.value===selected))select.value=selected;},
  select(event){draftId=crypto.randomUUID();const s=event?.survey??(!event?surveys.get(last):null);if(s&&!surveys.has(s.id)){surveys.set(s.id,s);const option=document.createElement('option');option.dataset.saved='';option.value=s.id;option.textContent=s.name;select.append(option);}select.value=s?.id??'';fill(s);field('method').value=event?.method??'';update();},
  read(){const method=field('method').value||null;if(!select.value)return {method};const original=surveys.get(select.value);const value={id:original?.id??draftId};for(const [key,name] of Object.entries(keys))value[key]=['waterLevel','referenceLevel'].includes(key)?Number(field(name).value):field(name).value;let survey=validateSurvey(value);if(original&&JSON.stringify(survey)!==JSON.stringify(validateSurvey(original)))survey.id=draftId;return {survey,method};},
  saved(event){last=event.survey?.id??null;}
 };
}
