const path = require('node:path')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const { app, BrowserWindow, dialog, ipcMain, Menu, session, safeStorage } = require('electron')
const { autoUpdater } = require('electron-updater')
const { fetchRoxenLevel, fetchLatestRoxenLevel } = require('./roxen-level')
const { exportAnnotatedManuscript } = require('./manuscript-annotations')
const { createLibraryStore } = require('./library-store')
const { syncLibrary, listCloudUsers } = require('./cloud-sync')
const { createCloudCredentials, syncWithSavedKey } = require('./cloud-credentials')
let cloudSyncBusy = false
const packageMetadata = require('../package.json')
const { expandChartIndexes: expandBsbIndexes } = require('./bsb-index')
const expandChartIndexes = files => expandBsbIndexes(files, readSurveyFile)
const { createJournalStore } = require('./journal-store')
let journalStore
let libraryStore
const liveSessions = new Map()
const { recoverSessions, appendSample } = require('./live-storage')

// Chromium-cachen hålls åtskild från appens beständiga data. Det undviker
// låsta Cache/GPUCache-mappar vid uppdatering och snabb omstart på Windows.
app.setPath('sessionData', path.join(app.getPath('userData'), 'chromium-session'))
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#eef3f1',
    title: `Sjömätning v${app.getVersion()} - ${packageMetadata.buildDate}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.loadFile(path.join(__dirname, 'index.html'))
  win.webContents.setUserAgent(`Sjomatning/${app.getVersion()} (+https://github.com/ledkarlsson/Sjomatning)`)

  const screenshotArg = process.argv.find(argument => argument.startsWith('--screenshot='))
  if (screenshotArg && !app.isPackaged) {
    const screenshotPath = screenshotArg.slice('--screenshot='.length)
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage()
        await fs.writeFile(screenshotPath, image.toPNG())
        app.quit()
      }, process.argv.some(argument => argument.startsWith('--test-pdf=')) ? 2500 : 800)
    })
  }
}

async function selectFiles(options) {
  const result = await dialog.showOpenDialog(options)
  if (result.canceled) return []
  const files = await expandChartIndexes(await Promise.all(result.filePaths.map(filePath => readSurveyFile(filePath))))
  await libraryStore.persist(files)
  return files
}

async function readSurveyFile(filePath, rootPath = path.dirname(filePath)) {
  const bytes = await fs.readFile(filePath)
  return {
    id: crypto.createHash('sha256').update(bytes).digest('hex'),
    name: path.basename(filePath),
    relativePath: path.relative(rootPath, filePath),
    path: filePath,
    bytes
  }
}

async function collectSurveyFiles(rootPath) {
  const files = []
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(filePath)
      else if (entry.isFile() && /\.(pdf|kap|wci|bsb|txt|csv|trc|sl2|sl3)$/i.test(entry.name)) {
        files.push(await readSurveyFile(filePath, rootPath))
      }
    }
  }
  await visit(rootPath)
  return expandChartIndexes(files)
}

ipcMain.handle('files:open-pdf', () => selectFiles({
  title: 'Välj fältmanus',
  properties: ['openFile'],
  filters: [{ name: 'PDF', extensions: ['pdf'] }]
}))

ipcMain.handle('files:open-logs', () => selectFiles({
  title: 'Välj mätloggar',
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Mätspår', extensions: ['txt', 'csv', 'trc', 'sl2', 'sl3'] }]
}))

ipcMain.handle('files:open-folder', async () => {
  const result = await dialog.showOpenDialog({ title: 'Välj sjömätningsmapp', properties: ['openDirectory'] })
  if (result.canceled) return null
  const folderPath = result.filePaths[0]
  const files = await collectSurveyFiles(folderPath)
  await libraryStore.persist(files)
  return { name: path.basename(folderPath), path: folderPath, files }
})

ipcMain.handle('files:scan-paths', async (_event, inputPaths) => {
  const folders = []
  const files = []
  for (const inputPath of [...new Set(inputPaths.filter(Boolean))]) {
    const info = await fs.stat(inputPath)
    if (info.isDirectory()) {
      const folderFiles = await collectSurveyFiles(inputPath)
      folders.push({ name: path.basename(inputPath), path: inputPath, files: folderFiles })
      files.push(...folderFiles)
    } else if (info.isFile() && /\.(pdf|kap|wci|bsb|txt|csv|trc|sl2|sl3)$/i.test(inputPath)) {
      files.push(await readSurveyFile(inputPath))
    }
  }
  const expanded = await expandChartIndexes(files)
  await libraryStore.persist(expanded)
  return { folders, files: expanded }
})

ipcMain.handle('library:update', (_event, id, changes) => libraryStore.update(id, changes))
ipcMain.handle('files:open-library', () => selectFiles({ title: 'Lägg till filer', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fältmanus och mätspår', extensions: ['pdf', 'kap', 'wci', 'bsb', 'txt', 'csv', 'trc', 'sl2', 'sl3'] }] }))
ipcMain.handle('library:list', () => libraryStore.list())
ipcMain.handle('library:cloud-users', async (_event, {token} = {}) => {
  const credentials=createCloudCredentials(path.join(app.getPath('userData'),'cloud-key.bin'),safeStorage)
  return syncWithSavedKey(credentials,listCloudUsers,{token})
})
ipcMain.handle('library:sync-cloud', async (event, {token, calibrations = {}} = {}) => {
  if (cloudSyncBusy) throw new Error('En synkning pågår redan.')
  cloudSyncBusy = true
  try {
    const cachePath = path.join(app.getPath('userData'),'cloud-sync.json')
    let previous = {}
    try { previous = JSON.parse(await fs.readFile(cachePath,'utf8')) } catch(error) { if(error.code !== 'ENOENT') throw error }
    const credentials = createCloudCredentials(path.join(app.getPath('userData'), 'cloud-key.bin'), safeStorage)
    return await syncWithSavedKey(credentials, syncLibrary, { files:await libraryStore.list(), token, calibrations, previous,
      checkpoint: async cache => { await fs.writeFile(cachePath+'.tmp',JSON.stringify(cache)); await fs.rename(cachePath+'.tmp',cachePath) },
      progress: data => { if(!event.sender.isDestroyed()) event.sender.send('library:sync-progress',data) }
    })
  } finally { cloudSyncBusy = false }
})
ipcMain.handle('journal:list', () => journalStore.list())
ipcMain.handle('journal:save', (_event, value) => journalStore.save(value))
ipcMain.handle('journal:resolve', (_event, id, choice) => journalStore.resolve(id,choice))
ipcMain.handle('journal:sync', async (_event, {token} = {}) => {
  const credentials=createCloudCredentials(path.join(app.getPath('userData'),'cloud-key.bin'),safeStorage)
  return syncWithSavedKey(credentials,journalStore.sync,{token})
})
ipcMain.handle('journal:export', async (_event, format) => {
  if(!['json','csv','pdf'].includes(format))throw new Error('Okänt exportformat.')
  const {rows}=await journalStore.list()
  const {exportJournal}=await import('./journal-model.mjs')
  const bytes=format==='pdf'?await (await import('./journal-pdf.mjs')).journalPdf(rows,require('pdf-lib')):exportJournal(rows,format)
  const result=await dialog.showSaveDialog({title:'Exportera observationsdagbok',defaultPath:'observationsdagbok.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]})
  if(result.canceled||!result.filePath)return null
  const relative=path.relative(app.getPath('userData'),path.resolve(result.filePath))
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Exportera utanför appens datamapp.')
  await fs.writeFile(result.filePath,bytes)
  return result.filePath
})
ipcMain.handle('library:remove', (_event, id) => libraryStore.remove(id))

ipcMain.handle('files:launch-pdf', async () => {
  const argument = process.argv.find(value => value.startsWith('--test-pdf='))
  if (!argument || app.isPackaged) return null
  const filePath = argument.slice('--test-pdf='.length)
  return { name: path.basename(filePath), path: filePath, bytes: await fs.readFile(filePath) }
})

ipcMain.handle('roxen:water-level', async (_event, date) => {
  try {
    const result = date ? await fetchRoxenLevel(date) : await fetchLatestRoxenLevel()
    return result ? { ok: true, data: result } : { ok: false, message: date ? 'Det finns inget publicerat vattenstånd för den valda dagen.' : 'Inget publicerat vattenstånd hittades under de senaste åtta veckorna.' }
  } catch (error) {
    console.error('Vattenståndet kunde inte hämtas', error)
    return { ok: false, message: `Vattenståndet kunde inte hämtas: ${error.message}` }
  }
})

ipcMain.handle('app:info', () => ({ version: app.getVersion(), buildDate: packageMetadata.buildDate }))

ipcMain.handle('manuscript:export-pdf', async (_event, id) => {
  const file = (await libraryStore.list()).find(item=>item.id===id)
  if (!file) throw new Error('Fältmanuset finns inte i biblioteket.')
  const result = await dialog.showSaveDialog({ title:'Exportera fältmanus med anteckningar', defaultPath:file.name.replace(/\.[^.]+$/, '') + '-anteckningar.pdf', filters:[{name:'PDF',extensions:['pdf']}] })
  if (result.canceled || !result.filePath) return null
  const destination = path.resolve(result.filePath)
  const libraryRoot = path.resolve(app.getPath('userData'), 'survey-library')
  const relative = path.relative(libraryRoot,destination)
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Exportera till en ny fil utanför det sparade biblioteket.')
  try {
    const existing = await fs.readFile(destination)
    if (crypto.createHash('sha256').update(existing).digest('hex') === file.id) throw new Error('Välj ett nytt filnamn så att originalmanuset bevaras.')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const bytes = await exportAnnotatedManuscript(file)
  await fs.writeFile(destination,bytes)
  return destination
})

ipcMain.handle('tracks:export', async (_event, { suggestedName, content, format }) => {
  if (typeof content !== 'string' || content.length > 100 * 1024 * 1024) throw new Error('Ogiltigt exportinnehåll.')
  const extension = format === 'txt' ? 'txt' : 'csv'
  const result = await dialog.showSaveDialog({
    title: 'Exportera bearbetade mätspår',
    defaultPath: suggestedName,
    filters: [{ name: extension === 'txt' ? 'SeaClear waypoint' : 'CSV', extensions: [extension] }]
  })
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, extension === 'csv' && !content.startsWith('\uFEFF') ? '\uFEFF' + content : content, 'utf8')
  return result.filePath
})

ipcMain.handle('live:start', async (_event, metadata = {}) => {
  const started = new Date()
  const id = crypto.randomUUID()
  const safeName = String(metadata.name || 'matning').replace(/[^a-zA-Z0-9åäöÅÄÖ_-]+/g, '-').slice(0, 50)
  const folder = path.join(app.getPath('userData'), 'measurements', `${started.toISOString().replace(/[:.]/g, '-')}_${safeName}`)
  await fs.mkdir(folder, { recursive: true })
  const rawPath = path.join(folder, 'raw.nmea')
  const csvPath = path.join(folder, 'track.csv')
  await fs.writeFile(rawPath, `# ${JSON.stringify({ ...metadata, started: started.toISOString() })}\r\n`, 'utf8')
  await fs.writeFile(csvPath, 'Datum,Tid,Latitud,Longitud,Fart,Djup\r\n', 'utf8')
  liveSessions.set(id, { rawPath, csvPath })
  return { id, folder }
})

ipcMain.handle('live:append', async (_event, { id, raw, point }) => {
  const target = liveSessions.get(id)
  if (!target) throw new Error('Mätsessionen är inte aktiv.')
  await appendSample(target, raw, point)
  return true
})

ipcMain.handle('live:stop', async (_event, id) => {
  const target = liveSessions.get(id)
  if (!target) return null
  const file = await readSurveyFile(target.csvPath)
  file.name = `${path.basename(path.dirname(target.csvPath))}.csv`
  const hasPoints = file.bytes.toString('utf8').trim().split('\n').length > 1
  if (hasPoints) await libraryStore.persist([file])
  if (!target.failure) await fs.writeFile(path.join(path.dirname(target.csvPath), 'completed'), '')
  liveSessions.delete(id)
  return hasPoints ? file : null
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  journalStore = createJournalStore(path.join(app.getPath('userData'),'observations','journal.json'))
  libraryStore = createLibraryStore(path.join(app.getPath('userData'), 'survey-library'))
  await recoverSessions(path.join(app.getPath('userData'), 'measurements'), file => libraryStore.persist([file])).catch(error => dialog.showErrorBox('Kunde inte återställa mätning', error.message))
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'serial')
  session.defaultSession.setDevicePermissionHandler(details => details.deviceType === 'serial')
  session.defaultSession.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault()
    const labels = portList.map((port, index) => `${index + 1}. ${port.displayName || port.portName || 'USB-enhet'} (${port.vendorId || '?'}:${port.productId || '?'})`)
    dialog.showMessageBox({ type: 'question', title: 'Välj GPS/ekolod', message: 'Välj seriell USB-enhet', buttons: [...labels, 'Avbryt'], cancelId: labels.length }).then(({ response }) => callback(portList[response]?.portId || ''))
  })
  Menu.setApplicationMenu(null)
  createWindow()

  if (app.isPackaged) {
    autoUpdater.logger = console
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    const broadcast = (status, detail = '') => BrowserWindow.getAllWindows().forEach(window => window.webContents.send('updater:status', { status, detail }))
    autoUpdater.on('checking-for-update', () => broadcast('checking'))
    autoUpdater.on('update-available', info => broadcast('available', info.version))
    autoUpdater.on('update-not-available', () => broadcast('current'))
    autoUpdater.on('download-progress', progress => broadcast('downloading', String(Math.round(progress.percent))))
    autoUpdater.on('update-downloaded', info => broadcast('ready', info.version))
    autoUpdater.on('error', error => broadcast('error', error.message))
    autoUpdater.checkForUpdates().catch(error => console.error('Uppdateringskontroll misslyckades', error))
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(error => console.error('Uppdateringskontroll misslyckades', error))
    }, 10 * 60 * 1000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('updater:install', () => {
  // Install silently and restart the app when the update has finished.
  if (app.isPackaged) autoUpdater.quitAndInstall(true, true)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
