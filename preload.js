const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('GPTThreads', {
  getState: () => ipcRenderer.invoke('getState'),
  setState: (s) => ipcRenderer.invoke('setState', s),
  ask: (payload) => ipcRenderer.invoke('ask', payload),
  jumpToAnchor: (payload) => ipcRenderer.invoke('jumpToAnchor', payload),
  jumpNext: (payload) => ipcRenderer.invoke('jumpNext', payload),
  openExternal: (url) => ipcRenderer.send('openExternal', url)
});