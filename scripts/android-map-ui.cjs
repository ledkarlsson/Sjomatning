const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
app.whenReady().then(async()=>{
  const {PDFDocument,PDFName,rgb}=require('pdf-lib');const pdf=await PDFDocument.create(),page=pdf.addPage([400,400]);page.drawRectangle({x:0,y:0,width:400,height:400,color:rgb(.8,.9,.7)});page.drawText('TEST FIELD CHART',{x:30,y:200,size:20});page.node.set(PDFName.of('Measure'),pdf.context.obj({GPTS:[58.50,15.6,58.50,15.7,58.55,15.7,58.55,15.6],LPTS:[0,0,1,0,1,1,0,1]}));await fs.writeFile('tmp/android-fixture.pdf',await pdf.save({useObjectStreams:false}));
  const routes={'/chart.html':'android/app/src/main/assets/chart.html','/chart.mjs':'android/app/src/main/assets/chart.mjs','/web-map.mjs':'src/web-map.mjs','/manuscripts.mjs':'android/app/src/main/assets/manuscripts.mjs','/geo-reference.mjs':'android/app/build/generated/mapAssets/geo-reference.mjs','/raster-chart.mjs':'src/raster-chart.mjs','/pdf.mjs':'node_modules/pdfjs-dist/legacy/build/pdf.mjs','/pdf.worker.mjs':'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','/api/files/00000000-0000-0000-0000-000000000001/content':process.env.SJOMATNING_REAL_CHART || 'tmp/android-fixture.pdf'};
  const server=http.createServer(async(req,res)=>{if(req.url==='/api/files'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify([{id:'00000000-0000-0000-0000-000000000001',name:'Granholmen.pdf'}]));return;}if(!routes[req.url]){res.writeHead(404).end();return;}res.setHeader('Content-Type',req.url.endsWith('.html')?'text/html':'text/javascript');res.end(await fs.readFile(routes[req.url]));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const win=new BrowserWindow({show:false,width:390,height:340,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.on("console-message",event=>{if(event.level==="error")console.log(event.message);});
  try{
    await win.loadURL(`http://127.0.0.1:${server.address().port}/chart.html`);
    const result=await win.webContents.executeJavaScript(`(async()=>{
      const c=document.querySelector('canvas'),ctx=c.getContext('2d'),arcs=[];const arc=ctx.arc.bind(ctx);ctx.arc=(...args)=>{arcs.push(args);arc(...args);};
      const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      window.updatePosition({fix:{lat:58.53,lon:15.7,accuracy:7,fresh:true}});await frame();
      const first=arcs.at(-1);if(document.querySelector('#plus,#minus'))throw new Error('Zoom buttons remain');c.setPointerCapture=()=>{};c.onpointerdown({pointerId:1,offsetX:100,offsetY:100});c.onpointerdown({pointerId:2,offsetX:200,offsetY:100});c.onpointermove({pointerId:2,offsetX:260,offsetY:100});c.onpointerup({pointerId:1});c.onpointerup({pointerId:2});document.querySelector('#follow').click();await frame();const zoomed=arcs.at(-1);
      window.updatePosition({fix:{lat:58.54,lon:15.71,accuracy:10,fresh:false}});await frame();const moved=arcs.at(-1);
      return {width:c.clientWidth,height:c.clientHeight,first,zoomed,moved};
    })()`);
    for(const p of [result.first,result.zoomed,result.moved]){assert.ok(Math.abs(p[0]-result.width/2)<1);assert.ok(Math.abs(p[1]-result.height/2)<1);assert.equal(p[2],8);}
    const layers=await win.webContents.executeJavaScript(`(async()=>{
      const c=document.querySelector('canvas'),ctx=c.getContext('2d');let drawn=0,frames=0;const stroke=ctx.stroke.bind(ctx);ctx.stroke=()=>{if(ctx.strokeStyle==='#9b2868'&&ctx.lineWidth===2)frames++;stroke();};const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...rest)=>{if(image instanceof HTMLCanvasElement)drawn++;draw(image,...rest);};
      const helpers=await import('./geo-reference.mjs');const bytes=new Uint8Array(await (await fetch('/api/files/00000000-0000-0000-0000-000000000001/content')).arrayBuffer());const points=helpers.parseGeoPdf(bytes);window.updatePosition({fix:{lat:points.reduce((s,p)=>s+p.lat,0)/points.length,lon:points.reduce((s,p)=>s+p.lon,0)/points.length,accuracy:5,fresh:true}});
      window.ChartAccess={openLibrary:()=>window.libraryReady()};document.querySelector('#manuscripts').click();
      for(let i=0;i<450&&document.querySelector('#manuscripts').disabled;i++)await new Promise(r=>setTimeout(r,100));
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const visible=drawn;document.querySelector('#manuscripts').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));drawn=0;window.updatePosition({fix:null});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const hidden=drawn,hiddenFrames=frames;
      document.querySelector('#manuscripts').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {visible,hidden,hiddenFrames,status:document.querySelector('#status').textContent};
    })()`);
    assert.ok(layers.visible>0,JSON.stringify(layers));assert.equal(layers.hidden,0);assert.ok(layers.hiddenFrames>0,JSON.stringify(layers));
    await win.webContents.executeJavaScript("document.querySelector('#manuscripts').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    await new Promise(resolve=>setTimeout(resolve,1000));
    const screenshot=await win.webContents.capturePage();await fs.mkdir('tmp',{recursive:true});await fs.writeFile('tmp/android-map.png',screenshot.toPNG());
    console.log('GPS following, pinch zoom and GeoPDF show/hide with transparent bounds pass. Screenshot: tmp/android-map.png');
  }finally{win.destroy();server.close();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
