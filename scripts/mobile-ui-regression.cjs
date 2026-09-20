const {app,BrowserWindow,session}=(process.env.MOBILE_BROWSER==='webkit'?require('./mobile-webkit-adapter.cjs'):require('electron'));
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
app.setPath('userData',path.resolve('tmp/mobile-browser-'+process.pid));
const files=new Map(),downloads=new Map(),calibrations={};let offline=false,failUpload=false,failContent=false,loseUpload=false,waitUpload=null,notifyUpload=null;
const chartId=randomUUID(),kap=Buffer.concat([Buffer.from('BSB/RA=4,2\r\nVER/1.1\r\nKNP/GD=WGS84,PR=MERCATOR\r\nREF/1,0,0,59,15\r\nREF/2,4,0,59,16\r\nREF/3,0,2,58,15\r\nREF/4,4,2,58,16\r\nRGB/1,10,20,30\r\n'),Buffer.from([26,0,1,0,67,0,1,67,0])]);
files.set(chartId,{id:chartId,name:'Testmanus.kap',originalName:'Testmanus.kap',size:kap.length,owner:'a',content:kap});
const server=http.createServer(async(req,res)=>{
 try{
  if(offline){res.destroy();return;}
  const url=new URL(req.url,'http://localhost');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname.startsWith('/api/')){
   const key=req.headers.authorization,owner=key==='Bearer key-a'?'a':key==='Bearer key-b'?'b':null;
   if(!owner)return json({error:'Fel nyckel'},401);
   const route=url.pathname.slice(5);
   if(route==='session')return json({id:owner,name:'Testkonto '+owner,role:'all',storageReady:true});
   if(route==='settings')return json(owner==='a'?calibrations:{});
   if(route==='files'&&req.method==='GET')return json([...files.values()].filter(f=>f.owner===owner).map(({content,...rest})=>rest));
   if(route==='files'&&req.method==='POST'){
    if(failUpload)return json({error:'Test: upload interrupted'},503);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const content=Buffer.concat(chunks),syncId=url.searchParams.get('syncId');
    let file=[...files.values()].find(f=>f.owner===owner&&f.syncId===syncId);
    if(!file){file={id:randomUUID(),name:url.searchParams.get('name'),size:content.length,owner,syncId,content};files.set(file.id,file);}
    if(waitUpload){const gate=waitUpload;waitUpload=null;notifyUpload?.();await gate;}
    if(loseUpload){loseUpload=false;res.destroy();return;}
    const {content:_,...value}=file;return json(value,201);
   }
   const match=route.match(/^files\/([^/]+)(\/content)?$/),file=match&&files.get(match[1]);
   if(!file||file.owner!==owner)return json({error:'Saknas'},404);
   if(match[2]){if(failContent)return json({error:'Test: download interrupted'},503);downloads.set(file.id,(downloads.get(file.id)||0)+1);res.writeHead(200,{'Content-Type':'application/octet-stream'});return res.end(file.content);}
   if(req.method==='DELETE'){files.delete(file.id);return json({deleted:true});}
   return json({},405);
  }
  if(url.pathname==='/mobile/chart.html'){res.writeHead(308,{Location:'/mobile/chart'});return res.end();}
  let file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');if(file.endsWith('/'))file+='index.html';if(file==='mobile/chart')file+='.html';
  const resolved=path.resolve('web/dist',file);if(!resolved.startsWith(path.resolve('web/dist')+path.sep)){res.writeHead(403);return res.end();}
  const data=await fs.readFile(resolved),ext=path.extname(resolved);
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png'})[ext]||'application/octet-stream'});res.end(data);
 }catch(error){res.writeHead(404);res.end('Not found');}
});
app.whenReady().then(async()=>{
 const {PDFDocument,rgb}=require('pdf-lib');const pdf=await PDFDocument.create(),pdfPage=pdf.addPage([200,200]);pdfPage.drawRectangle({x:0,y:0,width:200,height:200,color:rgb(.7,.9,.9)});const pdfBytes=Buffer.from(await pdf.save({useObjectStreams:false})),pdfId=randomUUID();
 files.set(pdfId,{id:pdfId,name:'Kalibrerat.pdf',originalName:'Kalibrerat.pdf',size:pdfBytes.length,owner:'a',content:pdfBytes});
 calibrations['calibration:Kalibrerat.pdf:'+pdfBytes.length]=[{nx:0,ny:0,lat:59,lon:15},{nx:1,ny:1,lat:58,lon:16}];
 const meta='GD=WGS84\r\nPR=2\r\nDS=0,0\r\nC1=0,0,59,15\r\nC2=4,0,59,16\r\nC3=0,2,58,15\r\nC4=4,2,58,16\r\n';
 const wci=Buffer.alloc(33+meta.length);wci.set([87,67,73,1,6,1]);wci.writeUInt16LE(4,12);wci.writeUInt16LE(2,14);wci.writeUInt32LE(33,16);wci.writeUInt32LE(0xc0000000,20);wci.writeUInt32LE(0x4000001c,24);wci.set([128,3,10,20,30],28);wci.write(meta,33);const wciId=randomUUID();files.set(wciId,{id:wciId,name:'Test.wci',size:wci.length,owner:'a',content:wci});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>callback(permission==='geolocation'));
 session.defaultSession.webRequest.onBeforeRequest({urls:['https://tile.openstreetmap.org/*','https://tiles.openseamap.org/*']},(_details,callback)=>callback({cancel:true}));
 const win=new BrowserWindow({show:false,width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error'&&!/ERR_|Geolocation|network|Failed to load resource/.test(event.message))errors.push(event.message);});
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let n=0;n<240;n++){if(await run(code))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+code+' | '+JSON.stringify(await run(`Object.fromEntries(['syncStatus','keyError','pointFeedback','account','connection'].map(id=>[id,document.getElementById(id)?.textContent]))`))+' | '+JSON.stringify(errors));};
 const modules=`const db=await import('./storage.mjs'),s=await import('./sync.mjs');`;
 const action=code=>run(`(async()=>{${modules}${code}})()`);
 const pointFiles=owner=>[...files.values()].filter(f=>f.owner===owner&&f.name.endsWith('.csv'));
 await win.loadURL(base+'/mobile/');
 await wait(`document.querySelector('#connection').textContent==='Online'`);
 await wait(`navigator.serviceWorker.controller!==null`);
 await run(`navigator.geolocation.watchPosition=(ok)=>{ok({coords:{latitude:58.53,longitude:15.7,accuracy:5},timestamp:Date.now()});return 42};navigator.geolocation.clearWatch=()=>{};document.querySelector('#gps').click()`);
 await wait(`!document.querySelector('#savePoint').disabled`);
 await run(`document.querySelector('#depth').value='4,2';document.querySelector('#capture').requestSubmit()`);
 await wait(`document.querySelector('#count').textContent==='1'`);
 const point=await action(`return (await db.points())[0]`);assert.equal(point.depth,4.2);
 await run(`document.querySelector('#access').click();document.querySelector('#key').value='key-a';document.querySelector('#keyForm').requestSubmit()`);
 await wait(`document.querySelector('#syncStatus').textContent==='Punkter och fältmanus är synkade.'`);
 assert.equal(pointFiles('a').length,1);assert.equal(downloads.get(chartId),1);
 await run(`document.querySelector('#sync').click()`);await wait(`!document.querySelector('#sync').disabled`);assert.equal(pointFiles('a').length,1);assert.equal(downloads.get(chartId),1);
 await run(`document.querySelector('#chart').contentWindow.document.querySelector('#manuscripts').click()`);
 await wait(`document.querySelector('#chart').contentWindow.document.querySelector('#manuscripts').textContent==='Dölj fältmanus'`);
 assert.equal(await run(`document.querySelector('#chart').contentWindow.document.querySelector('#status').textContent.includes('kunde inte läsas')`),false);
 assert.equal(await run(`document.documentElement.scrollWidth>innerWidth`),false);
 await new Promise(r=>setTimeout(r,250));
 await fs.mkdir('tmp/mobile-qa',{recursive:true});if(process.env.MOBILE_BROWSER!=='webkit')await fs.writeFile('tmp/mobile-qa/'+(process.env.MOBILE_BROWSER||'chromium')+'-phone.png',(await win.webContents.capturePage()).toPNG());
 win.setSize(1024,900);await new Promise(r=>setTimeout(r,200));assert.equal(await run(`document.documentElement.scrollWidth>innerWidth`),false);
 if(process.env.MOBILE_BROWSER!=='webkit')await fs.writeFile('tmp/mobile-qa/'+(process.env.MOBILE_BROWSER||'chromium')+'-tablet.png',(await win.webContents.capturePage()).toPNG());
 // Editing keeps time, persists locally and uploads a replacement before deletion.
 await run(`document.querySelector('[data-edit]').click();document.querySelector('#editDepth').value='5,6';document.querySelector('#editForm').requestSubmit()`);
 await wait(`!document.querySelector('#editDialog').open`);
 assert.equal(await action(`return (await db.get('points',${JSON.stringify(point.id)})).time`),point.time);
 failUpload=true;await action(`try{await s.syncPoints(s.client('key-a'),'a')}catch(e){return e.message}`);assert.equal(pointFiles('a').length,1);
 failUpload=false;await action(`await s.syncPoints(s.client('key-a'),'a')`);assert.equal(pointFiles('a').length,1);assert.match(pointFiles('a')[0].content.toString(),/5.600/);
 // An edit during an in-flight upload must survive receipt persistence.
 await action(`await db.editPoint(${JSON.stringify(point.id)},{depth:'6.1',lat:58.53,lon:15.7})`);
 let releaseUpload;const reached=new Promise(resolve=>notifyUpload=resolve);waitUpload=new Promise(resolve=>releaseUpload=resolve);
 const inFlight=action(`await s.syncPoints(s.client('key-a'),'a')`);await reached;
 await action(`await db.editPoint(${JSON.stringify(point.id)},{depth:'6.2',lat:58.53,lon:15.7})`);releaseUpload();await inFlight;
 assert.equal(await action(`return (await db.get('points',${JSON.stringify(point.id)})).depth`),6.2);
 await action(`await s.syncPoints(s.client('key-a'),'a')`);assert.equal(pointFiles('a').length,1);assert.match(pointFiles('a')[0].content.toString(),/6.200/);
 // An upload committed by the server but with a lost response is reconciled
 // after local deletion, without recreating the deleted point or leaving an orphan.
 const second=await action(`return db.addPoint('Avbrott','3',{lat:58.53,lon:15.7,accuracy:4,time:Date.now()})`);
 loseUpload=true;await action(`try{await s.syncPoints(s.client('key-a'),'a')}catch(e){return e.message}`);
 await action(`await db.deletePoint(${JSON.stringify(second.id)});await s.syncPoints(s.client('key-a'),'a')`);assert.equal(pointFiles('a').length,1);
 // Different account has its own receipts and original library.
 await action(`await s.syncPoints(s.client('key-b'),'b');await s.syncLibrary(s.client('key-b'),'b')`);assert.equal(pointFiles('b').length,1);
 await action(`await db.deletePoint(${JSON.stringify(point.id)});await s.syncPoints(s.client('key-a'),'a')`);assert.equal(pointFiles('a').length,0);assert.equal(pointFiles('b').length,1);
 await action(`await s.syncPoints(s.client('key-b'),'b')`);assert.equal(pointFiles('b').length,0);
 // Failed library refresh leaves the old manifest and original readable.
 const newId=randomUUID();files.set(newId,{id:newId,name:'Ny.kap',size:kap.length,owner:'a',content:kap});failContent=true;
 await action(`try{await s.syncLibrary(s.client('key-a'),'a')}catch(e){return e.message}`);
 assert.equal(await action(`return (await db.get('settings','library/a')).files.length`),3);failContent=false;
 await action(`await s.syncLibrary(s.client('key-a'),'a')`);assert.equal(downloads.get(chartId),1);assert.equal(downloads.get(newId),1);
 files.delete(newId);await action(`await s.syncLibrary(s.client('key-a'),'a');return true`);assert.equal(await action(`return !!(await db.get('originals','a/${newId}'))`),false);
 // Real service worker offline reload, with API and static server unavailable.
 const offlinePoint=await action(`return db.addPoint('Offline','7',{lat:58.53,lon:15.7,accuracy:5,time:Date.now()})`);
 offline=true;await win.loadURL(base+'/mobile/');await wait(`document.querySelector('#count').textContent==='1'`);
 assert.equal(await action(`return (await db.get('points',${JSON.stringify(offlinePoint.id)})).depth`),7);
 await run(`document.querySelector('#chart').contentWindow.document.querySelector('#manuscripts').click()`);
 await wait(`document.querySelector('#chart').contentWindow.document.querySelector('#manuscripts').textContent==='Dölj fältmanus'`);
 assert.equal(await action(`return (await (await s.readLibrary('a','files/${chartId}/content')).blob()).size`),kap.length);
 // Reopening online must automatically send the point saved offline.
 offline=false;await win.loadURL(base+'/mobile/');await wait(`document.querySelector('#syncStatus').textContent==='Punkter och fältmanus är synkade.'`);assert.equal(pointFiles('a').length,1);assert.equal(downloads.get(chartId),1);assert.equal(downloads.get(pdfId),1);assert.equal(downloads.get(wciId),1);
 // Stale and inaccurate fixes must never create a point.
 assert.equal(await action(`try{await db.addPoint('Stale','2',{lat:58,lon:15,accuracy:5,time:Date.now()-16000});return false}catch{return true}`),true);
 assert.equal(await action(`try{await db.addPoint('Bad','2',{lat:58,lon:15,accuracy:31,time:Date.now()});return false}catch{return true}`),true);
 // No credentials or API responses appear in the public shell cache.
 assert.equal(await run(`(async()=>{for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys())if(request.url.includes('/api/'))return false;return true})()`),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile UI, GPS validation, IndexedDB persistence, startup/manual sync, idempotency, lost upload response, edits/deletes, account isolation, unchanged originals, interrupted download, offline shell/restart/PDF-WCI-KAP, concurrent editing, responsive layouts.');
 win.destroy();server.close();app.quit();
}).catch(error=>{console.error(error);server.close();app.exit(1);});
