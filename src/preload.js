const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sjomatning', {
  openPdf: () => ipcRenderer.invoke('files:open-pdf'),
  openLogs: () => ipcRenderer.invoke('files:open-logs'),
  launchPdf: () => ipcRenderer.invoke('files:launch-pdf')
})
