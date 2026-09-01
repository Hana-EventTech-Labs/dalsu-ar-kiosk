'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  reloadConfig: () => ipcRenderer.invoke('config:reload'),
  log: (level, msg, extra) => ipcRenderer.invoke('log', level, msg, extra),
  print: (frontDataUrl, opts) => ipcRenderer.invoke('print', frontDataUrl, opts),
  getPreflight: () => ipcRenderer.invoke('preflight:get'),
  printStats: () => ipcRenderer.invoke('print:stats'),   // 직전·평균 인쇄 소요(ms)
  rerunPreflight: () => ipcRenderer.invoke('preflight:rerun'),
  swimMeta: () => ipcRenderer.invoke('asset:swimMeta'),
  reportState: (st) => ipcRenderer.invoke('flow:state', st),   // 자동 업데이트 적용 시점(대기 화면) 판단용
  snap: (name) => ipcRenderer.invoke('snap', name),
  recordStop: () => ipcRenderer.invoke('record:stop'),
  quit: () => ipcRenderer.invoke('app:quit'),
  smokeExit: (ok, info) => ipcRenderer.invoke('smoke:exit', ok, info),
  // 인쇄 진행 단계 수신 (SMART-81 은 20~40초가 걸려 실제 단계를 보여줘야 한다)
  onPrintStage: (cb) => {
    const h = (_e, key) => cb(key);
    ipcRenderer.on('print:stage', h);
    return () => ipcRenderer.removeListener('print:stage', h);
  },
});
