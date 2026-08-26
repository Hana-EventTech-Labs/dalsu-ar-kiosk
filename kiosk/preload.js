'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  reloadConfig: () => ipcRenderer.invoke('config:reload'),
  log: (level, msg, extra) => ipcRenderer.invoke('log', level, msg, extra),
  print: (frontDataUrl, opts) => ipcRenderer.invoke('print', frontDataUrl, opts),
  getPreflight: () => ipcRenderer.invoke('preflight:get'),
  rerunPreflight: () => ipcRenderer.invoke('preflight:rerun'),
  snap: (name) => ipcRenderer.invoke('snap', name),
  quit: () => ipcRenderer.invoke('app:quit'),
  smokeExit: (ok, info) => ipcRenderer.invoke('smoke:exit', ok, info),
});
