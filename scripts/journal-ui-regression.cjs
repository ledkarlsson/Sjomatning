const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createJournalStore}=require('../src/journal-store');
app.setPath('userData',path.resolve('tmp/journal-ui-'+process.pid));
app.whenReady().then(async()=>{
 const folder=app.getPath('userData');const store=createJournalStore(path.join(folder,'journal.json'));
 ipcMain.handle('journal:list',()=>store.list());ipcMain.handle('journal:save',(_,v)=>store.save(v));
 const library=require('../src/library-store').createLibraryStore(path.join(folder,'library'));
 ipcMain.handle('library:list',()=>library.list());ipcMain.handle('library:update',(_,id,value)=>library.update(id,value));
 ipcMain.handle('tracks:create-point',async(_,value)=>{const file=(await import('../src/manual-track.mjs')).manualTrackFile(value);await library.persist([{name:file.name,bytes:Buffer.from(file.content)}]);return (await library.list())[0];});
 ipcMain.handle('files:launch-pdf',()=>null);ipcMain.handle('app:info',()=>({version:'test',buildDate:'2026-09-26'}));ipcMain.handle('roxen:water-level',()=>({ok:false}));
 let exported;
 ipcMain.handle('journal:export',async(_,format)=>{const {rows}=await store.list();if(format==='pdf'){const {journalPdf}=await import('../src/journal-pdf.mjs');exported=path.resolve('tmp/journal-preview.pdf');await fs.writeFile(exported,await journalPdf(rows,require('pdf-lib')));}else{exported=(await import('../src/journal-model.mjs')).exportJournal(rows,format);}return exported;});
 await session.defaultSession.protocol.handle('https',()=>new Response('',{status:404}));
 let win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload:path.resolve('src/preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
 const run=s=>win.webContents.executeJavaScript(s);
 const wait=async s=>{for(let i=0;i<160;i++){if(await run(s))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+s);};
 await win.loadFile(path.resolve('src/index.html'));
 await wait(`!!document.querySelector('[data-open]')`);
 await run(`document.querySelector('[data-open]').click()`);
 await wait(`document.querySelector('[data-list]').textContent.includes('Inga händelser') && !document.querySelector('[name=text]').disabled`);
 assert.ok(await run(`document.querySelector('[name=occurredAt]').value.length>10`));
 await run(`document.querySelector('[name=text]').value='Gick på grund vid inloppet. Återkom för stångmätning.';document.querySelector('[name=occurredAt]').value='2026-09-25T14:32:15';document.querySelector('[name=lat]').value='58.52';document.querySelector('[name=lon]').value='15.71';document.querySelector('[data-editor]').requestSubmit()`);
 await wait(`document.querySelector('[data-status]').textContent.includes('sparad')`);
 assert.equal((await store.list()).rows.length,1);
 await run(`document.querySelector('[name=text]').value='Stenen markerad. Kontrollmätte med stång, 1,4 meter.';document.querySelector('[name=occurredAt]').value='2026-09-24T12:01:02';document.querySelector('[data-editor]').requestSubmit()`);
 await wait(`document.querySelector('[data-list]').textContent.includes('Stenen markerad')`);

 await run(`document.querySelector('[name=depth]').value='1.4';document.querySelector('[name=depth]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-map-position]').click()`);
 await wait(`!!document.querySelector('.journal-map-pick')`);
 assert.equal(await run(`document.querySelector('.journal-dialog').open`),false);
 await run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width*.55,clientY:r.top+r.height*.5}))})()`);
 await wait(`document.querySelector('.journal-dialog').open && !document.querySelector('[data-map-position]').disabled`);
 const picked=await run(`({lat:Number(document.querySelector('[name=lat]').value),lon:Number(document.querySelector('[name=lon]').value)})`);
 assert.ok(Number.isFinite(picked.lat)&&Number.isFinite(picked.lon));
 assert.equal((await store.list()).rows[0].event.lat,58.52);
 await run(`document.querySelector('[data-map-position]').click()`);await wait(`!!document.querySelector('.journal-map-pick')`);
 await run(`document.querySelector('.journal-map-pick button').click()`);await wait(`document.querySelector('.journal-dialog').open && !document.querySelector('[data-map-position]').disabled`);
 assert.equal(await run(`Number(document.querySelector('[name=lat]').value)`),picked.lat);
 await run(`document.querySelector('[data-editor]').requestSubmit()`);
 await wait(`document.querySelector('[data-status]').textContent.includes('sparad') && !document.querySelector('[data-map-position]').disabled`);
 const placed=(await store.list()).rows[0].event;assert.equal(placed.depth,1.4);assert.equal(placed.lat,picked.lat);assert.equal(placed.lon,picked.lon);
 await run(`document.querySelector('[data-close]').click()`);
 await wait(`JSON.parse(document.querySelector('#overlayCanvas').dataset.journalMarkers).length===1`);
 await new Promise(r=>setTimeout(r,300));await fs.writeFile(path.resolve('tmp/journal-map.png'),(await win.webContents.capturePage()).toPNG());
 await run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect(),m=JSON.parse(c.dataset.journalMarkers)[0];c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+m.x*r.width/c.width,clientY:r.top+m.y*r.height/c.height}))})()`);
 await wait(`document.querySelector('.journal-dialog').open && !document.querySelector('[data-map-position]').disabled`);
 assert.equal(await run(`document.querySelector('[name=depth]').value`),'1.4');
 await run(`document.querySelector('[data-close]').click();document.querySelector('[data-open]').click()`);
 await wait(`document.querySelector('[data-list]').textContent.includes('Stenen markerad')`);
 assert.equal((await store.list()).rows.length,1);
 await run(`document.querySelector('[data-export=json]').click()`);await wait(`document.querySelector('[data-status]').textContent.includes('exporterad')`);assert.equal(JSON.parse(exported).events.length,1);assert.equal(JSON.parse(exported).events[0].depth,1.4);
 for(let i=0;i<12;i++)await store.save({event:{id:require('node:crypto').randomUUID(),occurredAt:new Date(Date.UTC(2026,8,20,10,i)).toISOString(),text:'Observation '+(i+1)+': '+('Kontrollerade farleden med stångmätning. Botten är hård, ingen vegetation syntes. ').repeat(i===4?30:3),lat:58.5+i*.001,lon:15.7}});
 await run(`document.querySelector('[data-refresh]').click()`);await wait(`document.querySelectorAll('.journal-entry').length===13 && !document.querySelector('[name=text]').disabled`);
 assert.equal(await run(`document.querySelector('.journal-dialog').open`),true);
 assert.equal(await run(`document.querySelector('.journal-dialog').matches(':modal')`),true);
 await new Promise(r=>setTimeout(r,500));
 await fs.writeFile(path.resolve('tmp/journal-ui.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('[data-export=pdf]').click()`);await wait(`document.querySelector('[data-status]').textContent.includes('exporterad')`);assert.ok(exported.endsWith('.pdf'));
 await win.loadFile(path.resolve('src/index.html'));await wait(`!!document.querySelector('[data-open]')`);await run(`document.querySelector('[data-open]').click()`);await wait(`document.querySelectorAll('.journal-entry').length===13 && !document.querySelector('[name=text]').disabled`);
 console.log('PASS: diary UI create, edit, automatic timestamp, changed timestamp, persistence, JSON and PDF export.');

 await run(`document.querySelector('[data-close]').click()`);
 const rightClick=()=>run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+r.width*.6,clientY:r.top+r.height*.6}))})()`);
 await rightClick();assert.equal(await run(`document.querySelector('.map-context-menu').hidden`),false);
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 assert.equal(await run(`document.querySelector('.map-context-menu').hidden`),true);
 await rightClick();await run(`document.querySelector('[data-context-event]').click()`);
 await wait(`document.querySelector('.journal-dialog').open && !document.querySelector('[name=text]').disabled`);
 assert.ok(await run(`Number.isFinite(Number(document.querySelector('[name=lat]').value)) && document.querySelector('[name=lat]').value!==''`));
 assert.equal((await store.list()).rows.length,13);
 await run(`window.confirm=()=>true;document.querySelector('[data-close]').click()`);
 await rightClick();await run(`document.querySelector('[data-context-track]').click()`);
 await wait(`!!document.querySelector('[name=track]')`);
 await run(`document.querySelector('[name=name]').value='Högerklicksspår';document.querySelector('[name=track]').form.elements.depth.value='2.3';document.querySelector('[name=track]').form.requestSubmit()`);
 await wait(`!document.querySelector('[name=track]')`);
 const track=(await library.list())[0];assert.ok(track);const original=Buffer.from(track.bytes).toString();assert.ok(original.includes('2.3'));
 await rightClick();await run(`document.querySelector('[data-context-track]').click()`);await wait(`!!document.querySelector('[name=track]')`);
 assert.equal(await run(`document.querySelector('[name=track]').value`),track.id);
 assert.equal(await run(`document.querySelector('[data-name]').hidden`),true);
 assert.equal(await run(`getComputedStyle(document.querySelector('[data-name]')).display`),'none');
 await run(`document.querySelector('[name=track]').value='';document.querySelector('[name=track]').dispatchEvent(new Event('change'))`);
 assert.notEqual(await run(`getComputedStyle(document.querySelector('[data-name]')).display`),'none');
 await run(`document.querySelector('[name=track]').value=${JSON.stringify(track.id)};document.querySelector('[name=track]').dispatchEvent(new Event('change'))`);
 assert.equal(await run(`getComputedStyle(document.querySelector('[data-name]')).display`),'none');
 await run(`document.querySelector('[name=track]').form.requestSubmit()`);
 await wait(`!document.querySelector('[name=track]')`);
 const saved=(await library.list())[0];assert.equal(saved.edits.points.length,2);assert.equal(saved.edits.points[1].depth,null);assert.equal(Buffer.from(saved.bytes).toString(),original);
 console.log('PASS: map context menu dismissal, positioned event draft, saved new track and appended point with original preserved.');

 // Exercise the built browser adapter and the same editor in the real web shell.
 const http=require('node:http');
 const server=http.createServer(async(req,res)=>{
  try{
   const route=new URL(req.url,'http://localhost').pathname;
   const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
   if(route==='/api/session')return json({id:'ui-user',name:'Testdagbok',role:'own',storageReady:true});
   if(route==='/api/settings')return json({});
   if(route==='/api/files'&&req.method==='POST'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks),name=new URL(req.url,'http://localhost').searchParams.get('name');
    await library.persist([{name,bytes}]);const id=require('node:crypto').createHash('sha256').update(bytes).digest('hex');return json((await library.list()).find(file=>file.id===id));
   }
   if(route==='/api/files')return json([]);
   if(route==='/api/level')return json({ok:false});
   if(route==='/api/journal')return json((await store.list()).rows.map(r=>({...r,dirty:false})));
   if(route.startsWith('/api/journal/')&&req.method==='PUT'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks));
    const old=(await store.list()).rows.find(r=>r.event.id===value.event.id);
    return json(await store.save({...value,expectedMutation:old?.mutation??null}));
   }
   const relative=route==='/'?'index.html':decodeURIComponent(route).slice(1);
   const file=path.resolve('web/dist',relative);
   if(!file.startsWith(path.resolve('web/dist')+path.sep)){res.writeHead(403);return res.end();}
   const bytes=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const desktopWin=win;
  win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
  desktopWin.destroy();
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error('WEB:',event.message)});
  await win.loadURL('http://127.0.0.1:'+server.address().port+'/');
  await wait(`!!document.querySelector('[data-open]')`);await run(`document.querySelector('[data-open]').click()`);
  await wait(`document.querySelectorAll('.journal-entry').length===13 && !document.querySelector('[name=text]').disabled`);
  assert.equal(await run(`document.querySelector('[data-sync]').hidden`),true);
  await run(`document.querySelector('[name=text]').value='Händelse från webben';document.querySelector('[data-editor]').requestSubmit()`);
  await wait(`document.querySelector('[data-status]').textContent.includes('sparad på webben')`);
  assert.equal((await store.list()).rows.length,14);
  await run(`document.querySelector('[name=depth]').value='0';document.querySelector('[name=text]').value='Redigerad webbtext';document.querySelector('[name=occurredAt]').value='2026-09-22T11:21:31';document.querySelector('[data-editor]').requestSubmit()`);
  await wait(`document.querySelector('[data-list]').textContent.includes('Redigerad webbtext')`);
  await run(`document.querySelector('[data-map-position]').click()`);await wait(`!!document.querySelector('.journal-map-pick')`);
  await run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}))})()`);
  await wait(`document.querySelector('.journal-dialog').open && !document.querySelector('[data-map-position]').disabled`);
  await run(`document.querySelector('[data-editor]').requestSubmit()`);await wait(`document.querySelector('[data-status]').textContent.includes('sparad på webben') && !document.querySelector('[data-map-position]').disabled`);
  const webEvent=(await store.list()).rows.find(r=>r.event.text==='Redigerad webbtext').event;assert.equal(webEvent.depth,0);assert.ok(Number.isFinite(webEvent.lat));
  await run(`window.exportBlob=null;URL.createObjectURL=blob=>{window.exportBlob=blob;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};document.querySelector('[data-export=pdf]').click()`);
  await wait(`!!window.exportBlob`);assert.ok(await run(`window.exportBlob.size>1000`));
  await wait(`!document.querySelector('[data-delete]').disabled`);
  await run(`window.confirm=()=>true;document.querySelector('[data-delete]').click()`);
  await wait(`document.querySelector('[data-status]').textContent.includes('borttagen')`);
  assert.equal((await store.list()).rows.filter(r=>!r.deleted).length,13);
  assert.equal(await run(`JSON.parse(document.querySelector('#overlayCanvas').dataset.journalMarkers).some(m=>m.id===${JSON.stringify(webEvent.id)})`),false);
  console.log('PASS: browser journal create, edit time/text, PDF download and deletion.');
  await run(`document.querySelector('[data-close]').click()`);await rightClick();await run(`document.querySelector('[data-context-track]').click()`);
  await wait(`!!document.querySelector('[name=track]')`);
  await run(`document.querySelector('[name=name]').value='Webbspår';document.querySelector('[name=track]').form.elements.depth.value='0';document.querySelector('[name=track]').form.requestSubmit()`);
  await wait(`!document.querySelector('[name=track]')`);
  const webTrack=(await library.list()).find(file=>file.name==='Webbspår.csv');assert.ok(webTrack);assert.ok(Buffer.from(webTrack.bytes).toString().trim().endsWith(',0'));
  console.log('PASS: browser context menu uploads manual track with zero depth.');
 }finally{server.close();}
 app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
