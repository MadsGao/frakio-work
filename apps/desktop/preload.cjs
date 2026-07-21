const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frakioDesktop', {
  restartService: () => ipcRenderer.invoke('frakio:restart-service'),
  openLogs: () => ipcRenderer.invoke('frakio:open-logs'),
  getLoginStartup: () => ipcRenderer.invoke('frakio:get-login-startup'),
  setLoginStartup: (enabled) => ipcRenderer.invoke('frakio:set-login-startup', Boolean(enabled)),
  selectFolder: () => ipcRenderer.invoke('frakio:select-folder'),
  windowControl: (action) => ipcRenderer.invoke('frakio:window-control', action),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('frakio:show-item-in-folder', String(targetPath || '')),
  openRelease: (targetUrl) => ipcRenderer.invoke('frakio:open-release', String(targetUrl || '')),
  openExternal: (targetUrl) => ipcRenderer.invoke('frakio:open-external', String(targetUrl || '')),
});
