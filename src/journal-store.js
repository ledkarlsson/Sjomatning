const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {CLOUD_URL}=require('./cloud-sync');
function createJournalStore(file) {
  let queue=Promise.resolve();
  const serial=fn=>(...args)=>{const result=queue.then(()=>fn(...args));queue=result.catch(()=>{});return result;};
  async function read(){try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.rows))throw new Error('Dagboksfilen har okänt format.');return data;}catch(error){if(error.code==='ENOENT')return {version:1,account:null,rows:[]};throw error;}}
  async function write(data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(data,null,2));await fs.rename(file+'.tmp',file);}
  async function save(value){
    const {validateEvent}=await import('./journal-model.mjs');const event=validateEvent(value.event);
    const data=await read(),old=data.rows.find(row=>row.event.id===event.id);
    if(old?.conflict)throw new Error('Lös synkkonflikten innan händelsen ändras.');
    if((old?.mutation??null)!==(value.expectedMutation??null))throw new Error('Händelsen har ändrats. Läs in dagboken igen innan du sparar.');
    const row={event,revision:old?.revision??0,deleted:!!value.deleted,dirty:true,mutation:randomUUID()};
    data.rows=data.rows.filter(r=>r.event.id!==event.id);data.rows.push(row);await write(data);return row;
  }
  async function resolve(id,choice){
    const data=await read(),row=data.rows.find(r=>r.event.id===id);
    if(!row?.conflict||!['local','remote'].includes(choice))throw new Error('Konflikten finns inte.');
    const remote=row.conflict;
    if(choice==='remote')Object.assign(row,remote,{dirty:false});
    else Object.assign(row,{revision:remote.revision,mutation:randomUUID(),dirty:true});
    delete row.conflict;await write(data);
  }
  async function sync({token,onAuthenticated=async()=>{},fetchImpl=fetch,origin=CLOUD_URL}){
    async function request(route,method='GET',body){
      const response=await fetchImpl(origin+'/api/'+route,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.status===401)throw Object.assign(new Error('Åtkomstnyckeln är inte giltig.'),{code:'AUTH_REQUIRED'});
      const result=await response.json();
      if(response.status===409&&result.current)return {conflict:result.current};
      if(!response.ok)throw new Error(result.error||'Synkningen misslyckades.');return result;
    }
    const account=await request('session'),data=await read();
    if(data.account && data.account!==account.id)throw new Error('Den lokala dagboken tillhör en annan nyckel. Använd samma nyckel som vid första synkningen.');
    await onAuthenticated();
    // Verify that the journal API exists before binding local drafts to an account.
    await request('journal');data.account=account.id;await write(data);
    for(const row of data.rows.filter(r=>r.dirty&&!r.conflict)){
      const result=await request('journal/'+row.event.id,'PUT',{event:row.event,deleted:row.deleted,baseRevision:row.revision,mutation:row.mutation});
      if(result.conflict)row.conflict=result.conflict;
      else Object.assign(row,result,{dirty:false});
      await write(data);
    }
    const remote=await request('journal');
    for(const row of remote){
      const index=data.rows.findIndex(r=>r.event.id===row.event.id);
      if(index<0)data.rows.push({...row,dirty:false});
      else if(!data.rows[index].dirty)data.rows[index]={...row,dirty:false};
    }
    await write(data);return {conflicts:data.rows.filter(r=>r.conflict).length,account:account.name};
  }
  return {list:serial(read),save:serial(save),resolve:serial(resolve),sync:serial(sync)};
}
module.exports={createJournalStore};
