const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createJournalStore}=require('../src/journal-store');
app.setPath('userData',path.resolve('tmp/journal-ui-'+process.pid));
app.whenReady().then(async()=>{
 const folder=app.getPath('userData');const store=createJournalStore(path.join(folder,'journal.json'));
 ipcMain.handle('journal:list',()=>store.list());ipcMain.handle('journal:save',(_,v)=>store.save(v));
 ipcMain.handle('library:list',()=>[]);ipcMain.handle('files:launch-pdf',()=>null);ipcMain.handle('app:info',()=>({version:'test',buildDate:'2026-09-26'}));ipcMain.handle('roxen:water-level',()=>({ok:false}));
 let exported;
 ipcMain.handle('journal:export',async(_,format)=>{const {rows}=await store.list();if(format==='pdf'){const {journalPdf}=await import('../src/journal-pdf.mjs');exported=path.resolve('tmp/journal-preview.pdf');await fs.writeFile(exported,await journalPdf(rows,require('pdf-lib')));}else{exported=(await import('../src/journal-model.mjs')).exportJournal(rows,format);}return exported;});
 await session.defaultSession.protocol.handle('https',()=>new Response('',{status:404}));
 let win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload:path.resolve('src/preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
 const run=s=>win.webContents.executeJavaScript(s);
 const wait=async s=>{for(let i=0;i<160;i++){if(await run(s))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+s);};
 await win.loadFile(path.resolve('src/index.html'));
 await wait(`!!document.querySelector('[data-open]')`);
 await run(`document.querySelector('[data-open]').click()`);
 await wait(`document.querySelector('[data-list]').textContent.includes('Inga händelser')`);
 assert.ok(await run(`document.querySelector('[name=occurredAt]').value.length>10`));
 await run(`document.querySelector('[name=text]').value='Gick på grund vid inloppet. Återkom för stångmätning.';document.querySelector('[name=occurredAt]').value='2026-09-25T14:32:15';document.querySelector('[name=lat]').value='58.52';document.querySelector('[name=lon]').value='15.71';document.querySelector('[data-editor]').requestSubmit()`);
 await wait(`document.querySelector('[data-status]').textContent.includes('sparad')`);
 assert.equal((await store.list()).rows.length,1);
 await run(`document.querySelector('[name=text]').value='Stenen markerad. Kontrollmätte med stång, 1,4 meter.';document.querySelector('[name=occurredAt]').value='2026-09-24T12:01:02';document.querySelector('[data-editor]').requestSubmit()`);
 await wait(`document.querySelector('[data-list]').textContent.includes('Stenen markerad')`);
 await run(`document.querySelector('[data-close]').click();document.querySelector('[data-open]').click()`);
 await wait(`document.querySelector('[data-list]').textContent.includes('Stenen markerad')`);
 assert.equal((await store.list()).rows.length,1);
 await run(`document.querySelector('[data-export=json]').click()`);await wait(`document.querySelector('[data-status]').textContent.includes('exporterad')`);assert.equal(JSON.parse(exported).events.length,1);
 for(let i=0;i<12;i++)await store.save({event:{id:require('node:crypto').randomUUID(),occurredAt:new Date(Date.UTC(2026,8,20,10,i)).toISOString(),text:'Observation '+(i+1)+': '+('Kontrollerade farleden med stångmätning. Botten är hård, ingen vegetation syntes. ').repeat(i===4?30:3),lat:58.5+i*.001,lon:15.7}});
 await run(`document.querySelector('[data-refresh]').click()`);await wait(`document.querySelectorAll('.journal-entry').length===13`);
 assert.equal(await run(`document.querySelector('.journal-dialog').open`),true);
 assert.equal(await run(`document.querySelector('.journal-dialog').matches(':modal')`),true);
 await new Promise(r=>setTimeout(r,500));
 await fs.writeFile(path.resolve('tmp/journal-ui.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('[data-export=pdf]').click()`);await wait(`document.querySelector('[data-status]').textContent.includes('exporterad')`);assert.ok(exported.endsWith('.pdf'));
 await win.loadFile(path.resolve('src/index.html'));await wait(`!!document.querySelector('[data-open]')`);await run(`document.querySelector('[data-open]').click()`);await wait(`document.querySelectorAll('.journal-entry').length===13`);
 console.log('PASS: diary UI create, edit, automatic timestamp, changed timestamp, persistence, JSON and PDF export.');

 // Exercise the built browser adapter and the same editor in the real web shell.
 const http=require('node:http');
 const server=http.createServer(async(req,res)=>{
  try{
   const route=new URL(req.url,'http://localhost').pathname;
   const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
   if(route==='/api/session')return json({id:'ui-user',name:'Testdagbok',role:'own',storageReady:true});
   if(route==='/api/settings')return json({});
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
  await wait(`document.querySelectorAll('.journal-entry').length===13`);
  assert.equal(await run(`document.querySelector('[data-sync]').hidden`),true);
  await run(`document.querySelector('[name=text]').value='Händelse från webben';document.querySelector('[data-editor]').requestSubmit()`);
  await wait(`document.querySelector('[data-status]').textContent.includes('sparad på webben')`);
  assert.equal((await store.list()).rows.length,14);
  await run(`document.querySelector('[name=text]').value='Redigerad webbtext';document.querySelector('[name=occurredAt]').value='2026-09-22T11:21:31';document.querySelector('[data-editor]').requestSubmit()`);
  await wait(`document.querySelector('[data-list]').textContent.includes('Redigerad webbtext')`);
  await run(`window.exportBlob=null;URL.createObjectURL=blob=>{window.exportBlob=blob;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};document.querySelector('[data-export=pdf]').click()`);
  await wait(`!!window.exportBlob`);assert.ok(await run(`window.exportBlob.size>1000`));
  await wait(`!document.querySelector('[data-delete]').disabled`);
  await run(`window.confirm=()=>true;document.querySelector('[data-delete]').click()`);
  await wait(`document.querySelector('[data-status]').textContent.includes('borttagen')`);
  assert.equal((await store.list()).rows.filter(r=>!r.deleted).length,13);
  console.log('PASS: browser journal create, edit time/text, PDF download and deletion.');
 }finally{server.close();}
 app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
