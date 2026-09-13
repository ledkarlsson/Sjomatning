const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')

function createMinimalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = new TextEncoder().encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

// Run the real renderer in Chromium, using deterministic tiles and no user data.
app.setPath('userData', path.join(app.getPath('temp'), `sjomatning-map-test-${process.pid}`))
app.whenReady().then(async () => {
  let pdfOpens = 0
  ipcMain.handle('files:open-library', async () => ++pdfOpens === 1 ? [{ id: 'plain', name: 'Panorering.pdf', bytes: Array.from(createMinimalPdf()) }] : [{ id: 'geo', name: 'Granholmen.pdf', bytes: Array.from(await fs.readFile('testdata/fältmanus-geodata/Granholmen - en sida.pdf')) }])
  ipcMain.handle('files:launch-pdf', () => null)
  ipcMain.handle('library:list', () => [])
  ipcMain.handle('app:info', () => ({ version: 'test', buildDate: 'test' }))
  ipcMain.handle('roxen:water-level', () => ({ ok: false, error: 'Testläge' }))
  const requests = []
  await session.defaultSession.protocol.handle('https', request => {
    requests.push(request.url)
    const seamark = request.url.includes('openseamap')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${seamark ? 'none' : '#c5dfeb'}"/>${seamark ? '' : '<path d="M0 40L100 70L170 0H256V256H30L60 180Z" fill="#e5edd5"/><path d="M0 160L256 80" stroke="white" stroke-width="6"/>'}</svg>`
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
  })
  const win = new BrowserWindow({ show: false, width: 1440, height: 900,
    webPreferences: { preload: path.resolve('src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await win.loadFile(path.resolve('src/index.html'))
  const run = source => win.webContents.executeJavaScript(source)
  async function waitFor(source) {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (await run(source)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    console.error('Renderer diagnostics', errors, await run(`document.querySelector('#toast').textContent`))
    await fs.writeFile('tmp/map-test-failure.png', (await win.webContents.capturePage()).toPNG())
    throw new Error(`Timed out: ${source.slice(0, 180)}`)
  }
  await waitFor(`document.querySelector('#viewport').classList.contains('web-map') && document.querySelector('#mapLoadStatus').classList.contains('hidden')`)
  assert.ok(requests.some(url => url.includes('openstreetmap.org')))
  const layout = await run(`(() => {
    const v = document.querySelector('#viewport').getBoundingClientRect()
    const c = document.querySelector('#overlayCanvas').getBoundingClientRect()
    return { x: c.x-v.x, y: c.y-v.y, width: c.width-v.width, height: c.height-v.height }
  })()`)
  for (const delta of Object.values(layout)) assert.ok(Math.abs(delta) < 1, 'map fills the workspace')
  const initialRequests = new Set(requests)
  const rect = await run(`(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height} })()`)
  const x = Math.round(rect.x + rect.width * .7), y = Math.round(rect.y + rect.height * .5)
  win.webContents.sendInputEvent({type:'mouseMove',x,y})
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',x,y,clickCount:1})
  await new Promise(resolve => setTimeout(resolve, 50))
  win.webContents.sendInputEvent({type:'mouseMove',x:x-500,y:y+100,button:'left'})
  await new Promise(resolve => setTimeout(resolve, 100))
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x:x-500,y:y+100,clickCount:1})
  for (let i = 0; i < 100 && !requests.some(url => !initialRequests.has(url)); i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(requests.some(url => !initialRequests.has(url)), 'drag loads new geographic tiles')
  assert.equal(await run(`document.querySelector('#viewport').classList.contains('panning')`), false)
  const beforeZoom = await run(`document.querySelector('#zoomValue').textContent`)
  await run(`document.querySelector('#zoomOut').click()`)
  assert.notEqual(await run(`document.querySelector('#zoomValue').textContent`), beforeZoom)
  await run(`document.querySelector('#showSweden').click()`)
  await waitFor(`Number(document.querySelector('#zoomValue').textContent.slice(2)) < 7`)
  for (let i = 0; i < 100 && !requests.some(url => /openstreetmap.org\/[3456]\//.test(url)); i++) await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(requests.some(url => /openstreetmap.org\/[3456]\//.test(url)), 'Sweden overview uses overview tiles')
  await run(`document.querySelector('#fitView').click()`)
  assert.equal(await run(`document.querySelector('#zoomValue').textContent`), beforeZoom)
  win.setSize(1100, 700)
  await waitFor(`document.querySelector('#overlayCanvas').width === document.querySelector('#viewport').clientWidth`)
  assert.equal(await run(`document.querySelector('#overlayCanvas').width === document.querySelector('#viewport').clientWidth`), true)
  assert.equal(await run(`document.querySelector('#documentPanel').classList.contains('hidden')`), true, 'no redundant map panel')
  const oldWidth = await run(`document.querySelector('#viewport').clientWidth`)
  await run(`document.querySelector('#toggleSidebar').click()`)
  await waitFor(`document.querySelector('#overlayCanvas').width === document.querySelector('#viewport').clientWidth && document.querySelector('#viewport').clientWidth > ${oldWidth}`)
  assert.equal(await run(`getComputedStyle(document.querySelector('#sidebar')).display`), 'none')
  assert.equal(await run(`document.querySelector('#toggleSidebar').getAttribute('aria-expanded')`), 'false')
  await run(`document.querySelector('#toggleSidebar').click()`)
  await waitFor(`document.querySelector('#viewport').clientWidth === ${oldWidth}`)
  await run(`document.querySelector('#addLibrary').click(); document.querySelector('#addFiles').click()`)
  await waitFor(`document.querySelectorAll('[data-locate-pdf]').length === 1`)
  await run(`document.querySelector('[data-locate-pdf]').click()`)
  await waitFor(`document.querySelector('#documentName').textContent === 'Panorering.pdf'`)
  assert.equal(await run(`document.querySelector('#documentPanel').classList.contains('hidden')`), false, 'PDF metadata remains available')
  const canvasRect = () => run(`(() => { const r = document.querySelector('#overlayCanvas').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height } })()`)
  async function dragPdf(dx, dy) {
    const before = await canvasRect()
    const origin = await run(`(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); return { x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) } })()`)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...origin })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...origin })
    await new Promise(resolve => setTimeout(resolve, 50))
    win.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', x: origin.x + dx, y: origin.y + dy })
    await new Promise(resolve => setTimeout(resolve, 100))
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: origin.x + dx, y: origin.y + dy })
    await waitFor(`Math.abs(document.querySelector('#overlayCanvas').getBoundingClientRect().x - ${before.x + dx}) < 1 && Math.abs(document.querySelector('#overlayCanvas').getBoundingClientRect().y - ${before.y + dy}) < 1`)
    const after = await canvasRect()
    assert.ok(Math.abs(after.x - before.x - dx) < 1, 'PDF follows horizontal drag without scroll limits')
    assert.ok(Math.abs(after.y - before.y - dy) < 1, 'PDF follows vertical drag without scroll limits')
  }
  for (const [dx, dy] of [[200, 0], [200, 0], [-200, 0], [-200, 0], [0, 150], [0, -150]]) await dragPdf(dx, dy)
  await run(`document.querySelector('#zoomIn').click()`)
  await dragPdf(-150, 100)
  const beforeToggle = await canvasRect()
  await run(`document.querySelector('#toggleSidebar').click()`)
  await waitFor(`document.querySelector('#viewport').clientWidth > ${oldWidth}`)
  await new Promise(resolve => setTimeout(resolve, 100))
  const afterToggle = await canvasRect()
  assert.equal(afterToggle.width, beforeToggle.width, 'hiding menu preserves PDF zoom')
  assert.equal(await run(`localStorage.getItem('sidebar:hidden')`), 'true')
  await dragPdf(150, -100)
  await run(`document.querySelector('#fitView').click()`)
  const fitted = await canvasRect()
  const viewCenter = await run(`(() => { const r = document.querySelector('#viewport').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
  assert.ok(Math.abs(fitted.x + fitted.width/2 - viewCenter.x) < 1)
  assert.ok(Math.abs(fitted.y + fitted.height/2 - viewCenter.y) < 1)
  await run(`document.querySelector('#addLibrary').click(); document.querySelector('#addFiles').click()`)
  await waitFor(`document.querySelectorAll('[data-locate-pdf]').length === 2`)
  await run(`document.querySelector('[data-locate-pdf="1"]').click()`)
  await waitFor(`document.querySelector('#viewport').classList.contains('web-map')`)
  await new Promise(resolve => setTimeout(resolve, 300))
  await waitFor(`document.querySelector('#mapLoadStatus').classList.contains('hidden')`)
  await new Promise(resolve => setTimeout(resolve, 700))
  async function stableCanvas() {
    let previous, stable = 0
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await run(`document.querySelector('#pdfCanvas').toDataURL()`)
      stable = current === previous ? stable + 1 : 0
      if (stable >= 8) return current
      previous = current
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Map drawing did not settle')
  }
  const frameOnly = await stableCanvas()
  await run(`document.querySelector('#toggleManuscripts').click()`)
  assert.equal(await run(`document.querySelector('#toggleManuscripts').getAttribute('aria-pressed')`), 'true')
  await waitFor(`document.querySelector('#pdfCanvas').toDataURL() !== ${JSON.stringify(frameOnly)}`)
  await new Promise(resolve => setTimeout(resolve, 300))
  await fs.mkdir('tmp', { recursive: true })
  await new Promise(resolve => setTimeout(resolve, 1800))
  await fs.writeFile('tmp/manuscript-map.png', (await win.webContents.capturePage()).toPNG())
  await run(`document.querySelector('#toggleManuscripts').click()`)
  const restoredFrame = await stableCanvas()
  if(restoredFrame !== frameOnly) {
    await fs.writeFile('tmp/map-frame-before.png',Buffer.from(frameOnly.split(',')[1],'base64'))
    await fs.writeFile('tmp/map-frame-after.png',Buffer.from(restoredFrame.split(',')[1],'base64'))
  }
  assert.equal(restoredFrame === frameOnly, true, 'hiding manuscript restores the overview map')
  assert.deepEqual(errors, [])
  await fs.mkdir('tmp', { recursive: true })
  await fs.writeFile('tmp/map-regression.png', (await win.webContents.capturePage()).toPNG())
  console.log('PASS: real renderer startup, full workspace, pointer drag, new tiles, zoom, Sweden, Roxen reset, resize, PDF pan and fit, sidebar toggle, no console errors')
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })


