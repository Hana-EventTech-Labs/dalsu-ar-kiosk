'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grab', {
  load: () => ipcRenderer.invoke('grab:load'),
  save: (n, buf) => ipcRenderer.invoke('grab:save', n, buf),
  done: (meta) => ipcRenderer.invoke('grab:done', meta),
  fail: (msg) => ipcRenderer.invoke('grab:fail', msg),
});
