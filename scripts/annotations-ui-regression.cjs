const {app,BrowserWindow,ipcMain,session}=require('electron')
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
const {PDFDocument,degrees,rgb}=require('pdf-lib')
const {createLibraryStore}=require('../src/library-store')
const {exportAnnotatedManuscript}=require('../src/manuscript-annotations')
app.setPath('userData',path.join(app.getPath('temp'),'sjomatning-annotations-'+process.pid))
app.whenReady().then(async()=>{
 await fs.mkdir('tmp/pdfs',{recursive:true})
 const source=await PDFDocument.create()
 for(const rotation of [90,0,180,270]){
  const page=source.addPage([600,400]);page.setCropBox(20,30,540,340);page.setRotation(degrees(rotation))
  page.drawRectangle({x:20,y:30,width:540,height:340,color:rgb(.94,.97,.96),borderColor:rgb(.1,.3,.2),borderWidth:1})
  page.drawText('Original '+rotation,{x:45,y:320,size:18})
 }
 const original=await source.save(),store=createLibraryStore(path.join(app.getPath('userData'),'library'))
 await store.persist([{name:'Roterat manus.pdf',bytes:original}])
 const chartRoot='testdata/fältmanus-seaclear'
 const chartName=(await fs.readdir(chartRoot)).find(name=>/^Gran.*\.wci$/i.test(name))
 await store.persist([{name:chartName,bytes:await fs.readFile(path.join(chartRoot,chartName))}])
 ipcMain.handle('library:list',()=>store.list())
 ipcMain.handle('library:update',(_event,id,changes)=>{
  if(changes.annotations?.some(note=>note.text==='FAIL'))throw new Error('Simulerat skrivfel')
  return store.update(id,changes)
 })
 ipcMain.handle('files:launch-pdf',()=>null)
 ipcMain.handle('app:info',()=>({version:'test',buildDate:'test'}))
 ipcMain.handle('roxen:water-level',()=>({ok:false}))
 const exports=[]
 ipcMain.handle('manuscript:export-pdf',async(_event,id)=>{
  const file=(await store.list()).find(file=>file.id===id),bytes=await exportAnnotatedManuscript(file)
  const name=/\.pdf$/i.test(file.name)?'annotations-rotated':'annotations-wci'
  await fs.writeFile('tmp/pdfs/'+name+'.pdf',bytes);exports.push({file,bytes,name});return 'tmp/pdfs/'+name+'.pdf'
 })
 await session.defaultSession.protocol.handle('https',()=>new Response('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#d8e8e2"/></svg>',{headers:{'content-type':'image/svg+xml'}}))
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:path.resolve('src/preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}})
 const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
 const run=async source=>{try{return await win.webContents.executeJavaScript(source)}catch(error){console.error(source.slice(0,600),errors);throw error}}
 const wait=async source=>{for(let i=0;i<600;i++){if(await run(source))return;await new Promise(r=>setTimeout(r,50))}console.error('Diagnostics',errors,await run(`({page:document.querySelector('#pageInfo').textContent,status:document.querySelector('#annotationStatus').textContent,toast:document.querySelector('#toast').textContent})`));throw new Error('Timed out: '+source)}
 const clickAt=async(x,y)=>run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width*${x},clientY:r.y+r.height*${y}}))})()`)
 await win.loadFile(path.resolve('src/index.html'))
 await wait(`document.querySelectorAll('[data-annotate-pdf]').length===2`)
 await run(`document.querySelector('[data-annotate-pdf="0"]').click()`)
 await wait(`!document.querySelector('#placeAnnotation').disabled && document.querySelector('#annotationStatus').textContent.startsWith('Skriv text')`)
 assert.equal(await run(`document.querySelector('#annotationPage')`),null)
 assert.equal(await run(`document.querySelector('#saveAnnotation')`),null)
 await run(`document.querySelector('#annotationText').value='4,2 m\\nÅäö kontroll';document.querySelector('#annotationSize').value='16';document.querySelector('#placeAnnotation').click()`)
 await clickAt(.25,.4)
 await wait(`document.querySelector('#annotationStatus').textContent==='Anteckningarna är sparade.'`)
 await run(`document.querySelector('#newAnnotation').click()`)
 await wait(`document.querySelector('#annotationText').value===''`)
 // A click on existing text picks it up; pointer movement previews without saving.
 await clickAt(.27,.39)
 await wait(`document.querySelector('#overlayCanvas').classList.contains('placing-annotation')`)
 await run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width*.45,clientY:r.y+r.height*.55}))})()`)
 assert.ok(Math.abs((await store.list())[0].annotations[0].x-.25)<.001)
 assert.equal(await run(`getComputedStyle(document.querySelector('#overlayCanvas')).cursor`),'none')
 await clickAt(.45,.55)
 await wait(`document.querySelector('#annotationStatus').textContent==='Anteckningarna är sparade.'`)
 assert.ok(Math.abs((await store.list())[0].annotations[0].x-.45)<.004, JSON.stringify((await store.list())[0].annotations))
 await run(`(()=>{const c=document.querySelector('#overlayCanvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.x+r.width*.47,clientY:r.y+r.height*.54}))})()`)
 await wait(`document.activeElement.id==='annotationText'`)
 await run(`document.querySelector('#annotationText').value='5,1 m\\nÅäö kontroll';document.querySelector('#annotationText').dispatchEvent(new Event('input'))`)
 await wait(`document.querySelector('#annotationStatus').textContent==='Anteckningarna är sparade.'`)
 assert.equal((await store.list())[0].annotations[0].text,'5,1 m\nÅäö kontroll')
 await run(`document.querySelector('#annotationText').value='FAIL';document.querySelector('#annotationText').dispatchEvent(new Event('input'))`)
 await wait(`document.querySelector('#annotationStatus').textContent.includes('Kunde inte spara')`)
 assert.equal((await store.list())[0].annotations[0].text,'5,1 m\nÅäö kontroll')
 await run(`document.querySelector('#annotationText').value='5,1 m\\nÅäö kontroll';document.querySelector('#annotationText').dispatchEvent(new Event('input'));document.querySelector('#newAnnotation').click()`)
 await wait(`document.querySelector('#annotationText').value===''`)
 await run(`document.querySelector('#annotationText').value='Ta bort';document.querySelector('#placeAnnotation').click()`);await clickAt(.5,.8)
 await wait(`document.querySelectorAll('[data-edit-note]').length===2`)
 await run(`document.querySelectorAll('[data-delete-note]')[1].click()`)
 await wait(`document.querySelectorAll('[data-edit-note]').length===1`)
 await win.reload()
 await wait(`document.querySelectorAll('[data-annotate-pdf]').length===2`)
 await run(`document.querySelector('[data-annotate-pdf="0"]').click()`)
 await wait(`document.querySelectorAll('[data-edit-note]').length===1 && !document.querySelector('#placeAnnotation').disabled`)
 await run(`document.querySelector('#exportManuscriptPdf').click()`)
 await wait(`document.querySelector('#annotationStatus').textContent.startsWith('PDF sparad:')`)
 assert.deepEqual((await store.list())[0].bytes,Buffer.from(original))
 await run(`document.querySelector('[data-annotate-pdf="1"]').click()`)
 await wait(`document.querySelector('#documentName').textContent.endsWith('.WCI') && !document.querySelector('#placeAnnotation').disabled`)
 await run(`document.querySelector('#annotationText').value='4,2 m - kontroll';document.querySelector('#annotationSize').value='18';document.querySelector('#placeAnnotation').click()`);await clickAt(.3,.65)
 await wait(`document.querySelector('#annotationStatus').textContent==='Anteckningarna är sparade.'`)
 await run(`document.querySelector('#exportManuscriptPdf').click()`)
 await wait(`document.querySelector('#annotationStatus').textContent.startsWith('PDF sparad:')`)
 // Reopen the actual exported bytes in PDF.js. Compare text anchors in the
 // displayed coordinate system, independently of the PDF export transform.
 for(const output of exports){
  const encoded=Buffer.from(output.bytes).toString('base64')
  const results=await run(`(async()=>{
   const pdfjs=await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs')
   const bytes=Uint8Array.from(atob('${encoded}'),c=>c.charCodeAt(0)),pdf=await pdfjs.getDocument({data:bytes}).promise,results=[]
   for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
    const page=await pdf.getPage(pageNumber),view=page.getViewport({scale:1}),text=await page.getTextContent()
    const note=text.items.find(item=>item.str.includes(' m'))
    const anchor=note ? view.convertToViewportPoint(note.transform[4],note.transform[5]) : [0,0]
    const canvas=document.createElement('canvas'),renderView=page.getViewport({scale:Math.min(1.5,1000/view.width)})
    canvas.width=Math.ceil(renderView.width);canvas.height=Math.ceil(renderView.height)
    await page.render({canvasContext:canvas.getContext('2d'),viewport:renderView}).promise
    results.push({x:anchor[0]/view.width,y:anchor[1]/view.height,text:text.items.map(item=>item.str).join(' '),png:canvas.toDataURL('image/png')})
   }
   await pdf.loadingTask.destroy();return results
  })()`)
  assert.equal(results.length,/rotated/.test(output.name)?4:1)
  for(let i=0;i<results.length;i++){
   const note=output.file.annotations.find(note=>note.page===i+1)
   if(note) {
   assert.ok(Math.abs(results[i].x-note.x)<.00001,'exported text x matches editor')
   assert.ok(Math.abs(results[i].y-note.y)<.00001,'exported text y matches editor')
   assert.ok(results[i].text.includes(note.text.split('\n')[0]))
   }
   await fs.writeFile(`tmp/pdfs/${output.name}-${i+1}.png`,Buffer.from(results[i].png.split(',')[1],'base64'))
  }
 }
 assert.deepEqual(errors,[])
 console.log('PASS: single-page annotations, click-to-move preview, double-click editing, autosave, deletion, restart, write failure, preserved PDF pages, WCI export, PDF.js text positions')
 app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
