const path = require('node:path')
const fs = require('node:fs/promises')
const crypto = require('node:crypto')
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')
const { autoUpdater } = require('electron-updater')
const { fetchRoxenLevel } = require('./roxen-level')

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#eef3f1',
    title: 'Sjömätning',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.loadFile(path.join(__dirname, 'index.html'))

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
  return Promise.all(result.filePaths.map(readSurveyFile))
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
      else if (entry.isFile() && /\.(pdf|txt|csv|trc)$/i.test(entry.name)) {
        files.push(await readSurveyFile(filePath, rootPath))
      }
    }
  }
  await visit(rootPath)
  return files
}

ipcMain.handle('files:open-pdf', () => selectFiles({
  title: 'Välj fältmanus',
  properties: ['openFile'],
  filters: [{ name: 'PDF', extensions: ['pdf'] }]
}))

ipcMain.handle('files:open-logs', () => selectFiles({
  title: 'Välj mätloggar',
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Mätspår', extensions: ['txt', 'csv', 'trc'] }]
}))

ipcMain.handle('files:open-folder', async () => {
  const result = await dialog.showOpenDialog({ title: 'Välj sjömätningsmapp', properties: ['openDirectory'] })
  if (result.canceled) return null
  const folderPath = result.filePaths[0]
  return { name: path.basename(folderPath), path: folderPath, files: await collectSurveyFiles(folderPath) }
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
    } else if (info.isFile() && /\.(pdf|txt|csv|trc)$/i.test(inputPath)) {
      files.push(await readSurveyFile(inputPath))
    }
  }
  return { folders, files }
})

ipcMain.handle('files:launch-pdf', async () => {
  const argument = process.argv.find(value => value.startsWith('--test-pdf='))
  if (!argument || app.isPackaged) return null
  const filePath = argument.slice('--test-pdf='.length)
  return { name: path.basename(filePath), path: filePath, bytes: await fs.readFile(filePath) }
})

ipcMain.handle('roxen:water-level', async (_event, date) => {
  try {
    const result = await fetchRoxenLevel(date)
    return result ? { ok: true, data: result } : { ok: false, message: 'Det finns inget publicerat vattenstånd för den valda dagen.' }
  } catch (error) {
    console.error('Vattenståndet kunde inte hämtas', error)
    return { ok: false, message: `Vattenståndet kunde inte hämtas: ${error.message}` }
  }
})

app.whenReady().then(() => {
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
  if (app.isPackaged) autoUpdater.quitAndInstall(false, true)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
