const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('sjomatning', {
  openPdf: () => ipcRenderer.invoke('files:open-pdf'),
  openLogs: () => ipcRenderer.invoke('files:open-logs'),
  openFolder: () => ipcRenderer.invoke('files:open-folder'),
  scanDroppedEntries: files => ipcRenderer.invoke('files:scan-paths', files.map(file => webUtils.getPathForFile(file))),
  listLibrary: () => ipcRenderer.invoke('library:list'),
  removeLibraryFile: id => ipcRenderer.invoke('library:remove', id),
  launchPdf: () => ipcRenderer.invoke('files:launch-pdf'),
  getRoxenWaterLevel: date => ipcRenderer.invoke('roxen:water-level', date),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  exportTracks: options => ipcRenderer.invoke('tracks:export', options),
  startLiveSession: metadata => ipcRenderer.invoke('live:start', metadata),
  appendLiveData: data => ipcRenderer.invoke('live:append', data),
  stopLiveSession: id => ipcRenderer.invoke('live:stop', id),
  onUpdaterStatus: callback => ipcRenderer.on('updater:status', (_event, status) => callback(status)),
  installUpdate: () => ipcRenderer.invoke('updater:install')
})
