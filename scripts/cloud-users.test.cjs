const {test}=require('node:test');
const assert=require('node:assert/strict');
const {listCloudUsers}=require('../src/cloud-sync');
test('key listing authenticates admin and returns aliases and permissions',async()=>{
 const routes=[];const users=[{id:'key-id',name:'Båt 1',role:'own',active:1}];
 const result=await listCloudUsers({token:'test-key',fetchImpl:async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer test-key');routes.push(url);return Response.json(url.endsWith('/session')?{id:'admin'}:users);}});
 assert.deepEqual(result.users,users);assert.equal(routes.length,2);
});
test('non-admin cannot request key listing',async()=>{
 let calls=0;
 await assert.rejects(listCloudUsers({token:'test-key',fetchImpl:async()=>{calls++;return Response.json({id:'ordinary',role:'all'});}}),/Endast administratörer/);
 assert.equal(calls,1);
});
test('invalid key triggers existing credential dialog flow',async()=>{
 await assert.rejects(listCloudUsers({token:'bad',fetchImpl:async()=>new Response('{}',{status:401})}),{code:'AUTH_REQUIRED'});
});
