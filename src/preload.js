const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('sjomatning', {
  openPdf: () => ipcRenderer.invoke('files:open-pdf'),
  openLogs: () => ipcRenderer.invoke('files:open-logs'),
  openFolder: () => ipcRenderer.invoke('files:open-folder'),
  scanDroppedEntries: files => ipcRenderer.invoke('files:scan-paths', files.map(file => webUtils.getPathForFile(file))),
  launchPdf: () => ipcRenderer.invoke('files:launch-pdf'),
  getRoxenWaterLevel: date => ipcRenderer.invoke('roxen:water-level', date),
  onUpdaterStatus: callback => ipcRenderer.on('updater:status', (_event, status) => callback(status)),
  installUpdate: () => ipcRenderer.invoke('updater:install')
})
