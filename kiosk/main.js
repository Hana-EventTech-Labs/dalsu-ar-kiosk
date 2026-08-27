// Electron 메인 — 창 생성, 설정 제공, 결과 저장, 인쇄 CLI(DalsuPrint.exe) 실행
'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { feedStages } = require('./src/stagelog');   // 인쇄 진행 단계 파서 (순수 · 테스트됨)

const ROOT = __dirname;                                   // 앱 리소스 kiosk/ (패키징 시 resources/app/kiosk)
// 데이터 루트 — 배포 exe 옆(설정·출력·로그를 현장에서 바로 열 수 있게). 개발 시에는 저장소 루트.
// portable(단일 exe) 빌드는 임시폴더로 풀리므로, 사용자가 둔 exe 위치(PORTABLE_EXECUTABLE_DIR)를 우선한다.
const DATA_ROOT = app.isPackaged
  ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')))
  : path.resolve(ROOT, '..');
const BUNDLED_CONFIG = path.join(ROOT, 'config.json');
// 배포본은 exe 옆 config.json을 쓴다(없으면 번들본을 1회 복사) — 현장에서 메모장으로 수정 가능
const CONFIG_PATH = app.isPackaged ? path.join(DATA_ROOT, 'config.json') : BUNDLED_CONFIG;
if (app.isPackaged && !fs.existsSync(CONFIG_PATH)) { try { fs.copyFileSync(BUNDLED_CONFIG, CONFIG_PATH); } catch (e) { /* 읽기전용 위치면 번들본 사용 */ } }
const ARGS = new Set(process.argv.slice(1));
const IS_SMOKE = ARGS.has('--smoke');
// 배포 exe는 더블클릭만으로 전체화면 키오스크. 창 모드가 필요하면 --windowed (개발 npm start는 창 모드 유지)
const IS_KIOSK = ARGS.has('--kiosk') || (app.isPackaged && !IS_SMOKE && !ARGS.has('--windowed'));
const SMOKE_SPEED = (process.argv.find((a) => a.startsWith('--smoke-speed=')) || '').split('=')[1] || '';
// 스모크 창 크기 — 가로 모니터처럼 다른 비율에서 레이아웃이 깨지는지 확인용 (예: --smoke-size=960x540)
const SMOKE_SIZE = (() => {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec((process.argv.find((a) => a.startsWith('--smoke-size=')) || '').split('=')[1] || '');
  return m ? { w: +m[1], h: +m[2] } : { w: 540, h: 960 };
})();
// 뷰포트를 실제 키오스크 해상도로 강제 (예: --smoke-emulate=1080x1920)
const SMOKE_EMULATE = (() => {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec((process.argv.find((a) => a.startsWith('--smoke-emulate=')) || '').split('=')[1] || '');
  return m ? { w: +m[1], h: +m[2] } : null;
})();

// 어떤 빌드를 보고 있는지 화면·로그에서 바로 알 수 있게 (현장에서 구버전 실행 사고 방지)
const BUILD = (() => {
  let builtAt = '';
  try { builtAt = fs.statSync(path.join(ROOT, 'main.js')).mtime.toISOString().slice(0, 16).replace('T', ' '); } catch (e) { /* noop */ }
  let version = app.getVersion();
  // 개발 모드에서는 app.getVersion() 이 Electron 버전을 돌려주므로 package.json 을 직접 읽는다
  if (!app.isPackaged) { try { version = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8')).version; } catch (e) { /* noop */ } }
  return { version, builtAt };
})();

let config = loadConfig();
const LOG_DIR = path.join(DATA_ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFile = path.join(LOG_DIR, `kiosk-${today()}.log`);

// 인쇄 실제 소요 시간 기록. SMART-81D 는 60~90초가 걸리는데(라테일 실측) 정확한 값은 장비·리본·
// 카드에 따라 다르다. 사람에게 재 달라고 하는 대신 앱이 스스로 재서 안내 문구를 맞춘다.
const STATS_PATH = path.join(LOG_DIR, 'print-stats.json');
function readPrintStats() {
  try { const s = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); return (s && s.count > 0) ? s : { count: 0 }; }
  catch (e) { return { count: 0 }; }
}
function recordPrintMs(ms) {
  if (!(ms > 1000)) return;                      // dry-run 처럼 즉시 끝난 건 통계에 넣지 않는다
  const s = readPrintStats();
  // 최근 값에 무게를 둔 이동평균 — 리본 교체나 장비 상태 변화를 며칠씩 끌고 가지 않는다
  const avg = s.count ? Math.round(s.avgMs * 0.7 + ms * 0.3) : ms;
  const next = { lastMs: ms, avgMs: avg, count: s.count + 1, updatedAt: new Date().toISOString() };
  try { fs.writeFileSync(STATS_PATH, JSON.stringify(next, null, 2)); } catch (e) { /* 쓰기 실패는 무시 */ }
  log('INFO', '인쇄 소요', { ms, avgMs: avg, 누적: next.count });
}

function today() { return new Date().toISOString().slice(0, 10); }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  fs.appendFile(logFile, line + '\n', () => {});
  (level === 'ERROR' ? console.error : console.log)(line);
}

function loadConfig() {
  const p = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : BUNDLED_CONFIG;
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  // 필수 검증 — 잘못된 설정으로 현장에서 조용히 죽는 것 방지
  if (!Array.isArray(c.goals) || c.goals.length !== 4) throw new Error('config.goals는 4개여야 합니다');
  if (!['smart', 'dry-run'].includes(c.printer.mode)) throw new Error('config.printer.mode는 smart|dry-run');
  // CR-80 카드(Smart-31/51/81 공통). SDK 카드 좌표는 664×1040(세로) / 1040×664(가로).
  // 라테일 팝업스토어에서 이 값으로 SMART-81 양면 풀블리드 인쇄가 실측 확인됐다.
  const land = c.card.width === 1040 && c.card.height === 664;
  const port = c.card.width === 664 && c.card.height === 1040;
  if (!land && !port) throw new Error('card 크기는 1040×664(가로) 또는 664×1040(세로)');
  if ((c.card.orientation === 'portrait') !== port) throw new Error('card.orientation 과 width/height 가 어긋납니다');
  return c;
}

function outDir(sub) {
  // 배포본: exe 옆 out/ (쓰기 가능·회수 쉬움) / 개발: config.output.dir
  const base = app.isPackaged ? path.join(DATA_ROOT, 'out') : path.resolve(ROOT, config.output.dir);
  const d = path.join(base, sub || today());
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// 인쇄 CLI 경로 — 앱 리소스 → exe 옆 순으로 탐색(둘 다 없으면 null)
function resolvePrinterExe() {
  const cands = [
    path.resolve(ROOT, config.printer.exe),
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'printer', 'DalsuPrint.exe')] : []), // 배포본 동봉 CLI
    path.join(DATA_ROOT, 'printer', 'DalsuPrint.exe'),
    path.join(DATA_ROOT, 'DalsuPrint.exe'),
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

function dataUrlToFile(dataUrl, file) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('PNG data URL이 아닙니다');
  fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
  return file;
}

// 인쇄: 앞면 PNG 저장 → 모드에 따라 DalsuPrint.exe 실행
async function printCard(frontDataUrl, opts, onStage) {
  const dir = outDir(opts && opts.subdir);
  const base = `card-${stamp()}`;
  const front = dataUrlToFile(frontDataUrl, path.join(dir, `${base}-front.png`));
  const backSrc = path.resolve(ROOT, config.card.backImage);
  if (!fs.existsSync(backSrc)) throw new Error(`뒷면 이미지 없음: ${backSrc} (npm run assets)`);
  // 배포본에서는 원본이 app.asar 안이라 외부 프로세스(DalsuPrint.exe)가 못 읽는다 → out/에 복사한 실파일을 인쇄에 넘긴다
  const back = path.join(dir, `${base}-back.png`);
  fs.copyFileSync(backSrc, back);
  log('INFO', '카드 저장', { front, back });

  if (config.printer.mode === 'dry-run') {
    log('INFO', 'dry-run 모드 — 실제 인쇄 생략');
    if (onStage) onStage('done');
    return { ok: true, mode: 'dry-run', front, back };
  }

  const exe = resolvePrinterExe();
  if (!exe) throw new Error(`인쇄 CLI(DalsuPrint.exe)를 찾을 수 없습니다 — 설치 폴더를 확인하세요`);
  const args = ['--front', front, '--back', back,
    config.card.orientation === 'portrait' ? '--portrait' : '--landscape',
    '--mode', config.printer.sdk === 'dcl' ? 'dcl' : 'comm'];
  if (config.printer.deviceDesc) args.push('--printer', config.printer.deviceDesc);

  let lastErr = null;
  for (let attempt = 0; attempt <= (config.printer.retry || 0); attempt++) {
    if (onStage) onStage(attempt > 0 ? 'retry' : 'start');
    const tStart = Date.now();
    const r = await runPrinter(exe, args, onStage);
    if (r.code === 0) { if (onStage) onStage('done'); recordPrintMs(Date.now() - tStart); log('INFO', '인쇄 완료', { attempt, out: r.stdout.trim().slice(-300) }); return { ok: true, mode: 'smart', front, back }; }
    lastErr = `exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(-300)}`;
    log('ERROR', '인쇄 실패', { attempt, lastErr });
    // 타임아웃은 재시도하지 않는다. SMART-81D 는 물리 인쇄 내내 블로킹하므로(실측 60~90초),
    // 타임아웃 시점에도 카드가 프린터 안에 있을 수 있다. 그 상태로 다시 넣으면 잼이 난다.
    if (/\[timeout\]/.test(r.stderr || '')) { log('WARN', '타임아웃 — 재시도하지 않음 (카드가 프린터 안에 있을 수 있음)'); break; }
  }
  return { ok: false, mode: 'smart', error: lastErr, front, back };
}

// onStage: CLI 가 stdout 으로 흘리는 '##STAGE:<키>' 를 실시간으로 넘긴다.
// SMART-81 은 인쇄에 20~40초가 걸리므로, 화면이 실제 진행을 보여주려면 이 신호가 있어야 한다.
// (타이머로 채우는 진행바는 100% 에서 멈춘 채 한참을 더 기다리게 만든다)
function runPrinter(exe, args, onStage) {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { windowsHide: true });
    let stdout = '', stderr = '', pending = '';
    const timer = setTimeout(() => { p.kill(); stderr += '\n[timeout]'; }, config.printer.timeoutMs || 90000);
    p.stdout.on('data', (d) => {
      stdout += d;
      if (!onStage) return;
      const r = feedStages(pending, d);
      pending = r.pending;
      for (const key of r.stages) { try { onStage(key); } catch (e) { /* 창이 이미 닫혔을 수 있다 */ } }
    });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function createWindow() {
  // 키오스크 실물은 1080×1920 세로. 스모크는 화면에 들어가도록 같은 비율의 절반(540×960)으로 띄워
  // 캡처가 실제 키오스크 비율(vw/vh)을 그대로 반영하게 한다.
  const win = new BrowserWindow({
    width: IS_SMOKE ? SMOKE_SIZE.w : 1080, height: IS_SMOKE ? SMOKE_SIZE.h : 1920,
    useContentSize: true,
    fullscreen: IS_KIOSK, kiosk: IS_KIOSK, frame: !IS_KIOSK, autoHideMenuBar: true,
    backgroundColor: '#0b2a3a',
    show: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      // 창이 가려지거나 뒤로 밀려도 requestAnimationFrame/타이머가 멈추지 않게 — 멈추면 연출이 그 자리에서 정지한다
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(ROOT, 'src', 'index.html'), {
    query: IS_SMOKE
      ? { smoke: '1', ...(SMOKE_SPEED ? { speed: SMOKE_SPEED } : {}), ...(ARGS.has('--smoke-exit') ? { exitcheck: '1' } : {}), ...(ARGS.has('--smoke-e2e') ? { e2e: '1' } : {}), ...(ARGS.has('--smoke-bench') ? { bench: '1' } : {}) }
      : {},
  });
  // 실제 키오스크 해상도(1080×1920)의 CSS 레이아웃을 그대로 검증한다.
  // 개발 모니터가 1920px 세로를 못 띄우므로, 뷰포트만 1080×1920으로 강제하고 화면에는 축소해 그린다.
  if (IS_SMOKE && SMOKE_EMULATE) {
    win.webContents.once('dom-ready', () => {
      try {
        win.webContents.enableDeviceEmulation({
          screenPosition: 'mobile',
          screenSize: { width: SMOKE_EMULATE.w, height: SMOKE_EMULATE.h },
          viewSize: { width: SMOKE_EMULATE.w, height: SMOKE_EMULATE.h },
          viewPosition: { x: 0, y: 0 },
          deviceScaleFactor: 0,
          scale: Math.min(SMOKE_SIZE.w / SMOKE_EMULATE.w, SMOKE_SIZE.h / SMOKE_EMULATE.h),
        });
        log('INFO', '기기 에뮬레이션', SMOKE_EMULATE);
      } catch (e) { log('WARN', '기기 에뮬레이션 실패', { error: String(e) }); }
    });
  }
  if (!IS_KIOSK && !IS_SMOKE && ARGS.has('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  // F11: 전체화면 토글 — 배포 exe를 더블클릭(인자 없이)해도 현장에서 키오스크 화면을 확인할 수 있게
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });
  return win;
}

// 프리플라이트: smart 모드면 시작 시 프린터 CLI/장비를 확인해 결과를 렌더러에 전달 (현장에서 조용히 죽는 것 방지)
let preflight = { ok: true, mode: 'dry-run', detail: 'dry-run' };
async function runPreflight() {
  if (config.printer.mode !== 'smart') return preflight;
  const exe = resolvePrinterExe();
  if (!exe) return (preflight = { ok: false, mode: 'smart', detail: '인쇄 CLI(DalsuPrint.exe) 없음' });
  const r = await runPrinter(exe, ['--list']);
  const tail = (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-3).join(' | ');
  preflight = { ok: r.code === 0, mode: 'smart', detail: tail };
  log(preflight.ok ? 'INFO' : 'ERROR', '프린터 프리플라이트', preflight);
  return preflight;
}

app.whenReady().then(async () => {
  // 웹캠 권한 자동 허용 (키오스크는 프롬프트 불가)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  log('INFO', `앱 시작 v${BUILD.version} (${BUILD.builtAt}) mode=${config.printer.mode} kiosk=${IS_KIOSK} smoke=${IS_SMOKE} packaged=${app.isPackaged}`, { config: CONFIG_PATH, data: DATA_ROOT, printer: resolvePrinterExe() });
  // 하드웨어 가속 여부 — CPU 렌더링(SwiftShader)이면 물 연출이 끊긴다. 현장 진단의 첫 단서.
  try {
    const g = app.getGPUFeatureStatus() || {};
    const canvas = g.gpu_compositing || g['2d_canvas'] || '?';
    const software = /software|disabled|unavailable/i.test(String(canvas));
    log(software ? 'WARN' : 'INFO', `그래픽 가속: ${software ? '소프트웨어(CPU) — 연출 품질 자동 하향' : '하드웨어'}`,
      { '2d_canvas': g['2d_canvas'], gpu_compositing: g.gpu_compositing, rasterization: g.rasterization });
  } catch (e) { log('WARN', 'GPU 상태 조회 실패', { error: String(e) }); }
  await runPreflight();
  createWindow();
});

ipcMain.handle('config:get', () => ({ ...config, build: BUILD }));
ipcMain.handle('preflight:get', () => preflight);
ipcMain.handle('print:stats', () => readPrintStats());
ipcMain.handle('preflight:rerun', () => runPreflight());
ipcMain.handle('config:reload', () => { config = loadConfig(); log('INFO', '설정 리로드'); return config; });
ipcMain.handle('log', (_e, level, msg, extra) => log(level, msg, extra));
ipcMain.handle('print', async (_e, frontDataUrl, opts) => {
  try { return await printCard(frontDataUrl, opts, (key) => { try { _e.sender.send('print:stage', key); } catch (x) { /* 창이 닫힘 */ } }); }
  catch (e) { log('ERROR', '인쇄 예외', { error: String(e) }); return { ok: false, error: String(e) }; }
});
// 스모크 종료: 결과 코드로 프로세스 종료 (npm run smoke 게이트)
// 스모크 화면 캡처 (UI 육안 확인용) → out/smoke/screen-<name>.png
ipcMain.handle('snap', async (e, name) => {
  const win = BrowserWindow.fromWebContents(e.sender); if (!win) return null;
  const img = await win.webContents.capturePage();
  const file = path.join(outDir('smoke'), `screen-${name}.png`);
  fs.writeFileSync(file, img.toPNG()); return file;
});
// 숨김 종료 버튼(우상단 3회 클릭) — 키오스크 모드에는 창 닫기 UI가 없으므로 운영자용 탈출구
ipcMain.handle('app:quit', () => { log('INFO', '숨김 종료 버튼 — 앱 종료'); setTimeout(() => app.exit(0), 80); return true; });
ipcMain.handle('smoke:exit', (_e, ok, info) => {
  log(ok ? 'INFO' : 'ERROR', 'SMOKE ' + (ok ? 'PASS' : 'FAIL'), info);
  setTimeout(() => app.exit(ok ? 0 : 1), 100);
});

app.on('window-all-closed', () => app.quit());
process.on('uncaughtException', (e) => { log('ERROR', 'uncaught', { error: String(e && e.stack || e) }); if (IS_SMOKE) app.exit(1); });
