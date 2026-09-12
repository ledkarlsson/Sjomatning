const path = require('node:path')
const fs = require('node:fs/promises')
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')
const { autoUpdater } = require('electron-updater')

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
  return Promise.all(result.filePaths.map(async filePath => ({
    name: path.basename(filePath),
    path: filePath,
    bytes: await fs.readFile(filePath)
  })))
}

ipcMain.handle('files:open-pdf', () => selectFiles({
  title: 'Välj fältmanus',
  properties: ['openFile'],
  filters: [{ name: 'PDF', extensions: ['pdf'] }]
}))

ipcMain.handle('files:open-logs', () => selectFiles({
  title: 'Välj mätloggar',
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Mätloggar', extensions: ['txt', 'csv'] }]
}))

ipcMain.handle('files:launch-pdf', async () => {
  const argument = process.argv.find(value => value.startsWith('--test-pdf='))
  if (!argument || app.isPackaged) return null
  const filePath = argument.slice('--test-pdf='.length)
  return { name: path.basename(filePath), path: filePath, bytes: await fs.readFile(filePath) }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  if (app.isPackaged) {
    autoUpdater.logger = console
    autoUpdater.autoDownload = true
    autoUpdater.checkForUpdatesAndNotify().catch(error => console.error('Uppdateringskontroll misslyckades', error))
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(error => console.error('Uppdateringskontroll misslyckades', error))
    }, 10 * 60 * 1000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
