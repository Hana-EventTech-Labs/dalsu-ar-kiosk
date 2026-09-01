'use strict';
// 영상 → PNG 프레임 (ffmpeg 없이). 이미 devDependency 로 있는 Electron 을 그대로 쓴다.
//   npx electron scripts/grab-frames.js --in <clip.mp4> --out <dir> [--rate 0.25]
// 드롭이 있으면 exit 1 — 조용한 실패를 남기지 않는다.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const IN = arg('in');
const OUT = arg('out', path.join(__dirname, '..', 'assets-src', 'swim', 'frames'));
// 균등 간격으로 몇 장을 뽑을지. 24프레임 사이클로 리샘플할 것이므로 원본 프레임 수보다 적어도 된다.
const COUNT = parseInt(arg('count', '96'), 10);

if (!IN || !fs.existsSync(IN)) { console.error('입력 영상이 없다: ' + IN); process.exit(2); }
fs.mkdirSync(OUT, true ? { recursive: true } : undefined);
for (const f of fs.readdirSync(OUT)) if (/^frame-\d+\.png$/.test(f)) fs.unlinkSync(path.join(OUT, f));

app.disableHardwareAcceleration();          // 소프트웨어 디코딩이 프레임 순서에 더 정직하다
let code = 1;

ipcMain.handle('grab:load', () => ({ bytes: fs.readFileSync(IN), count: COUNT }));
ipcMain.handle('grab:save', (_e, n, buf) => {
  fs.writeFileSync(path.join(OUT, 'frame-' + String(n).padStart(4, '0') + '.png'), Buffer.from(buf));
  return true;
});
ipcMain.handle('grab:done', (_e, meta) => {
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(meta, null, 2));
  // 요청한 시각과 실제로 잡힌 시각이 크게 어긋나면 표본이 고르지 않다는 뜻이다.
  const errs = meta.frames.map((f) => Math.abs(f.got - f.want));
  const avgErr = errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length);
  const step = meta.duration / Math.max(1, meta.count);
  console.log(`프레임 ${meta.frames.length}장  ${meta.w}x${meta.h}  길이 ${meta.duration.toFixed(2)}s  간격 ${(step * 1000).toFixed(0)}ms`);
  console.log(`시킹 오차 평균 ${(avgErr * 1000).toFixed(1)}ms  최대 ${(meta.maxSeekErr * 1000).toFixed(1)}ms  (간격의 ${(meta.maxSeekErr / step * 100).toFixed(0)}%)`);
  const ok = meta.frames.length === meta.count && meta.maxSeekErr <= step;
  if (!ok) console.error('표본이 고르지 않다 — --count 를 줄이거나 ffmpeg-static 폴백을 검토할 것');
  code = ok ? 0 : 1;
  setTimeout(() => app.exit(code), 100);
  return true;
});
ipcMain.handle('grab:fail', (_e, msg) => { console.error('실패: ' + msg); setTimeout(() => app.exit(1), 100); return true; });

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false, width: 480, height: 270,
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, 'grab-preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'grab-frames.html'));
});
app.on('window-all-closed', () => app.exit(code));
