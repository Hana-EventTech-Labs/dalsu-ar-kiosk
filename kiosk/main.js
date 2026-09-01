// Electron 메인 — 창 생성, 설정 제공, 결과 저장, 인쇄 CLI(DalsuPrint.exe) 실행
'use strict';
const { app, BrowserWindow, ipcMain, session, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { feedStages } = require('./src/stagelog');   // 인쇄 진행 단계 파서 (순수 · 테스트됨)

const ROOT = __dirname;                                   // 앱 리소스 kiosk/ (패키징 시 resources/app/kiosk)
// 데이터 루트 — 배포 exe 옆(설정·출력·로그를 현장에서 바로 열 수 있게). 개발 시에는 저장소 루트.
// portable(단일 exe) 빌드는 임시폴더로 풀리므로, 사용자가 둔 exe 위치(PORTABLE_EXECUTABLE_DIR)를 우선한다.
// 설치형(NSIS, 자동 업데이트 대상)은 업데이트 때 설치 폴더가 통째로 갈리므로 데이터를 **문서\DalsuARKiosk** 에 둔다.
// 포터블 exe·zip 풀어 쓰기는 예전처럼 exe 옆. 시작 로그의 data 경로가 곧 현장에서 config.json 을 찾을 위치다.
const IS_INSTALLED = app.isPackaged && fs.existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall DalsuARKiosk.exe'));
const DATA_ROOT = app.isPackaged
  ? (IS_INSTALLED ? path.join(app.getPath('documents'), 'DalsuARKiosk') : (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'))))
  : path.resolve(ROOT, '..');
if (app.isPackaged) { try { fs.mkdirSync(DATA_ROOT, { recursive: true }); } catch (e) { /* 아래 config 복사에서 다시 시도 */ } }
const BUNDLED_CONFIG = path.join(ROOT, 'config.json');
// 배포본은 exe 옆 config.json을 쓴다(없으면 번들본을 1회 복사) — 현장에서 메모장으로 수정 가능
const CONFIG_PATH = app.isPackaged ? path.join(DATA_ROOT, 'config.json') : BUNDLED_CONFIG;
if (app.isPackaged && !fs.existsSync(CONFIG_PATH)) { try { fs.copyFileSync(BUNDLED_CONFIG, CONFIG_PATH); } catch (e) { /* 읽기전용 위치면 번들본 사용 */ } }
const ARGS = new Set(process.argv.slice(1));
// 데모 영상 녹화 — 실제 앱을 그대로 돌리며 창을 WebM 으로 담는다(ffmpeg 없이 Chromium MediaRecorder).
// 자동 진행은 스모크 구동부를 그대로 쓰고(--record 는 smoke 를 켠다), 촬영 화면 직전(헤엄 끝)에서 멈춘다.
const REC_ARG = process.argv.find((a) => a === '--record' || a.startsWith('--record='));
const IS_RECORD = !!REC_ARG;
const REC_OUT = (REC_ARG && REC_ARG.includes('=')) ? REC_ARG.split('=').slice(1).join('=') : '';
const REC_BITRATE = +((process.argv.find((a) => a.startsWith('--record-bitrate=')) || '').split('=')[1]) || 6000000;
const SMOKE_SOAK = parseInt((process.argv.find((a) => a.startsWith('--smoke-soak=')) || '').split('=')[1] || '0', 10) || 0;
const IS_SMOKE = ARGS.has('--smoke') || IS_RECORD || SMOKE_SOAK > 0;
const NO_UPDATE = ARGS.has('--no-update');
// 배포 exe는 더블클릭만으로 전체화면 키오스크. 창 모드가 필요하면 --windowed (개발 npm start는 창 모드 유지)
const IS_KIOSK = ARGS.has('--kiosk') || (app.isPackaged && !IS_SMOKE && !ARGS.has('--windowed'));
const SMOKE_SPEED = (process.argv.find((a) => a.startsWith('--smoke-speed=')) || '').split('=')[1] || '';
// 스모크 창 크기 — 가로 모니터처럼 다른 비율에서 레이아웃이 깨지는지 확인용 (예: --smoke-size=960x540)
const SMOKE_SIZE = (() => {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec((process.argv.find((a) => a.startsWith('--smoke-size=')) || '').split('=')[1] || '');
  return m ? { w: +m[1], h: +m[2] } : { w: 540, h: 960 };   // 녹화도 같은 크기(9:16)를 쓴다
})();
// 뷰포트를 실제 키오스크 해상도로 강제 (예: --smoke-emulate=1080x1920)
const SMOKE_EMULATE = (() => {
  const m = /^(\d{3,5})x(\d{3,5})$/.exec((process.argv.find((a) => a.startsWith('--smoke-emulate=')) || '').split('=')[1] || '');
  // 녹화는 기본으로 실기 해상도 레이아웃(1080x1920)을 담는다 — 현장에서 보일 화면 그대로여야 한다.
  return m ? { w: +m[1], h: +m[2] } : (IS_RECORD ? { w: 1080, h: 1920 } : null);
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
const logFile = () => path.join(LOG_DIR, `kiosk-${today()}.log`);   // 매 기록마다 오늘 날짜 — 자정을 넘겨도 파일이 갈린다

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
  fs.appendFile(logFile(), line + '\n', () => {});
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

// 오래된 출력물·로그 정리 — config.output.keepDays. 카드 한 장에 앞·뒤 PNG ~0.5MB 라 정리가 없으면 끝없이 쌓인다.
// (config 에 keepDays: 30 이 적혀 있었지만 실제로는 아무 데서도 쓰이지 않았다 — 2026-09-01 구현)
function pruneOld() {
  const days = Number(config.output && config.output.keepDays);
  if (!(days > 0)) return;
  const cutoff = Date.now() - days * 86400000;
  const base = app.isPackaged ? path.join(DATA_ROOT, 'out') : path.resolve(ROOT, config.output.dir);
  let removed = 0;
  try {
    if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;                    // 날짜 폴더만 (smoke/demo 는 건드리지 않는다)
      if (new Date(d + 'T00:00:00Z').getTime() < cutoff) { fs.rmSync(path.join(base, d), { recursive: true, force: true }); removed++; }
    }
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = /^kiosk-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && new Date(m[1] + 'T00:00:00Z').getTime() < cutoff) { fs.rmSync(path.join(LOG_DIR, f), { force: true }); removed++; }
    }
  } catch (e) { log('WARN', '오래된 출력물 정리 실패', { error: String(e) }); }
  if (removed) log('INFO', '오래된 출력물 정리', { keepDays: days, removed });
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
  // 뒷면 회전 — 플리퍼가 카드를 뒤집는 축에 따라 실물에서 방향이 달라진다.
  // 현장에서 config.json 한 줄(card.backRotate)로 맞출 수 있어야 재빌드가 필요 없다.
  const rot = ((config.card.backRotate || 0) % 360 + 360) % 360;
  if (rot) args.push('--back-rotate', String(rot));

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
// 이 프린터(SMART-81D, 재전사)는 물리 인쇄가 끝날 때까지 60~90초 블로킹한다(라테일 실측).
// 현장 config.json 은 업데이트가 덮어쓰지 않으므로 예전 값(90초)이 그대로 남아 있을 수 있고,
// 그러면 **정상 인쇄가 타임아웃으로 잘려 카드는 나오는데 화면은 '직원 호출'** 이 된다 — 실제로 그랬다.
// 설정이 더 길면 그대로 쓰고, 짧으면 최소값으로 끌어올린다. 짧은 타임아웃은 어떤 경우에도 옳지 않다.
const PRINT_TIMEOUT_FLOOR_MS = 180000;
let timeoutWarned = false;
function printTimeoutMs() {
  const want = config.printer.timeoutMs || 0;
  if (want && want < PRINT_TIMEOUT_FLOOR_MS && !timeoutWarned) {
    timeoutWarned = true;
    log('WARN', '인쇄 타임아웃 설정이 너무 짧아 최소값으로 올림 — 정상 인쇄가 실패로 처리되는 것을 막는다',
      { config: want, applied: PRINT_TIMEOUT_FLOOR_MS, reason: '이 프린터는 인쇄에 60~90초가 걸린다' });
  }
  return Math.max(PRINT_TIMEOUT_FLOOR_MS, want);
}

let printerBusy = 0;   // 동시에 도는 DalsuPrint 프로세스 수
function runPrinter(exe, args, onStage) {
  return new Promise((resolve) => {
    printerBusy++;
    const p = spawn(exe, args, { windowsHide: true });
    let stdout = '', stderr = '', pending = '';
    const timer = setTimeout(() => { p.kill(); stderr += '\n[timeout]'; }, printTimeoutMs());
    p.stdout.on('data', (d) => {
      stdout += d;
      if (!onStage) return;
      const r = feedStages(pending, d);
      pending = r.pending;
      for (const key of r.stages) { try { onStage(key); } catch (e) { /* 창이 이미 닫혔을 수 있다 */ } }
    });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); });
    p.on('close', (code) => { clearTimeout(timer); printerBusy--; resolve({ code, stdout, stderr }); });
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
      ? { smoke: '1', ...(IS_RECORD ? { record: '1', speed: SMOKE_SPEED || '1' } : (SMOKE_SPEED ? { speed: SMOKE_SPEED } : {})),
          ...(ARGS.has('--smoke-exit') ? { exitcheck: '1' } : {}), ...(ARGS.has('--smoke-e2e') ? { e2e: '1' } : {}), ...(ARGS.has('--smoke-bench') ? { bench: '1' } : {}), ...(SMOKE_SOAK ? { soak: String(SMOKE_SOAK) } : {}) }
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
  if (printerBusy > 0) return preflight;   // 인쇄 중 — 30초 주기 --list 가 SmartComm2 를 같이 건드리지 않게 건너뛴다
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
  log('INFO', `앱 시작 v${BUILD.version} (${BUILD.builtAt}) mode=${config.printer.mode} kiosk=${IS_KIOSK} smoke=${IS_SMOKE} packaged=${app.isPackaged} installed=${IS_INSTALLED}`, { config: CONFIG_PATH, data: DATA_ROOT, printer: resolvePrinterExe() });
  // 하드웨어 가속 여부 — CPU 렌더링(SwiftShader)이면 물 연출이 끊긴다. 현장 진단의 첫 단서.
  try {
    const g = app.getGPUFeatureStatus() || {};
    const canvas = g.gpu_compositing || g['2d_canvas'] || '?';
    const software = /software|disabled|unavailable/i.test(String(canvas));
    log(software ? 'WARN' : 'INFO', `그래픽 가속: ${software ? '소프트웨어(CPU) — 연출 품질 자동 하향' : '하드웨어'}`,
      { '2d_canvas': g['2d_canvas'], gpu_compositing: g.gpu_compositing, rasterization: g.rasterization });
  } catch (e) { log('WARN', 'GPU 상태 조회 실패', { error: String(e) }); }
  await runPreflight();
  pruneOld(); setInterval(pruneOld, 6 * 3600 * 1000);
  // 프로세스 메모리 추이 — 소크 테스트 중 10초마다, 평상시엔 1시간마다. JS 힙만으로는 캔버스·이미지 메모리를 못 본다.
  const memLog = () => {
    try {
      const m = app.getAppMetrics().map((x) => ({ type: x.type, mb: Math.round((x.memory && x.memory.workingSetSize || 0) / 1024) }));
      log('INFO', '프로세스 메모리', { total: m.reduce((a, b) => a + b.mb, 0), procs: m });
    } catch (e) { /* noop */ }
  };
  setInterval(memLog, SMOKE_SOAK ? 10000 : 3600000);
  const win = createWindow();
  if (IS_RECORD) startRecorder(win);
  setupAutoUpdate();
  // 24시간 무인 운영 — 렌더러가 죽거나(메모리·드라이버) 멈추면 사람이 올 때까지 검은 화면이다. 스스로 되살린다.
  if (!IS_SMOKE) {
    win.webContents.on('render-process-gone', (_e, d) => {
      log('ERROR', '렌더러 종료 — 3초 후 재로드', d);
      setTimeout(() => { try { win.webContents.reload(); } catch (e) { app.relaunch(); app.exit(1); } }, 3000);
    });
    win.webContents.on('unresponsive', () => {
      log('ERROR', '렌더러 무응답 — 15초 뒤에도 그대로면 재로드');
      setTimeout(() => { if (!win.isDestroyed() && !win.webContents.isCrashed()) { try { win.webContents.forcefullyCrashRenderer(); } catch (e) { win.webContents.reload(); } } }, 15000);
    });
    win.webContents.on('responsive', () => log('INFO', '렌더러 응답 복귀'));
    // 화면 절전·모니터 끄기 차단 (OS 전원 설정과 별개로 앱이 요청한다)
    try { const id = powerSaveBlocker.start('prevent-display-sleep'); log('INFO', '화면 절전 차단', { active: powerSaveBlocker.isStarted(id) }); } catch (e) { log('WARN', '절전 차단 실패', { error: String(e) }); }
  }
});

// ---------- 데모 영상 녹화 ----------
// OS 창 캡처(desktopCapturer + MediaRecorder)를 먼저 썼다가 버렸다 — 윈도우에서 **정지 화면이 담겼고**
// (21초 내내 대기 화면), 창 테두리와 여백까지 들어갔다.
// 지금은 Electron 이 합성기에서 직접 주는 프레임(beginFrameSubscription)을 30fps 로 골라 ffmpeg 에 그대로 밀어 넣는다.
// 창 밖의 것이 섞일 수 없고, 크기가 창 내용과 정확히 같으며, 타이밍은 벽시계 기준이라 배속이 틀어지지 않는다.
let recProc = null, recTimer = null, recWinRef = null, recPath = '', recFrames = 0, recLast = null, recSize = null;

function startRecorder(kioskWin) {
  recWinRef = kioskWin;
  recPath = REC_OUT || path.join(outDir('demo'), `demo-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.mp4`);
  fs.mkdirSync(path.dirname(recPath), { recursive: true });
  kioskWin.webContents.on('did-finish-load', () => {
    setTimeout(() => beginCapture(kioskWin), 400);      // 첫 페인트가 끝난 뒤
  });
}

function beginCapture(win) {
  win.webContents.beginFrameSubscription(false, (image) => {
    const sz = image.getSize();
    if (!sz.width || !sz.height) return;
    if (!recSize) { recSize = sz; openFfmpeg(); }
    if (sz.width !== recSize.width || sz.height !== recSize.height) return;   // 크기가 바뀌면 그 프레임은 버린다
    recLast = image.getBitmap();                        // BGRA
  });
  // 30fps 로 '가장 최근 프레임'을 밀어 넣는다.
  // ⚠ 타이머가 부르는 횟수를 그대로 세면 안 된다 — 메인 프로세스가 밀리면 틱을 건너뛰어
  //   21초 체험이 15.6초 영상이 되고 26% 빨리 재생된다(실측). **벽시계로 필요한 만큼 채운다.**
  let t0 = 0;
  recTimer = setInterval(() => {
    if (!(recProc && recProc.stdin.writable && recLast)) return;
    if (!t0) t0 = Date.now();
    const want = Math.round((Date.now() - t0) / (1000 / 30)) + 1;
    for (let i = recFrames; i < want; i++) { recProc.stdin.write(recLast); recFrames++; }
  }, 1000 / 30);
}

function openFfmpeg() {
  let exe = null;
  try { exe = require('ffmpeg-static'); } catch (e) { /* 미설치 */ }
  if (!exe || !fs.existsSync(exe)) {
    log('ERROR', 'ffmpeg-static 이 없어 녹화할 수 없다 — npm i -D ffmpeg-static');
    setTimeout(() => app.exit(1), 200);
    return;
  }
  const args = ['-y', '-f', 'rawvideo', '-pix_fmt', 'bgra',
    '-s', `${recSize.width}x${recSize.height}`, '-r', '30', '-i', 'pipe:0',
    // 세로 영상. yuv420p + faststart 라야 카톡·기본 플레이어·브라우저에서 그대로 재생된다.
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', recPath];
  recProc = spawn(exe, args, { windowsHide: true });
  recProc.stdin.on('error', () => { /* 종료 시 EPIPE 는 정상 */ });
  let err = '';
  recProc.stderr.on('data', (d) => { err += d.toString().slice(-400); });
  recProc.on('close', (code) => {
    let size = 0; try { size = fs.statSync(recPath).size; } catch (e) { /* noop */ }
    const ok = code === 0 && size > 0;
    log(ok ? 'INFO' : 'ERROR', ok ? '녹화 완료' : '녹화 실패',
      { out: recPath, mb: +(size / 1048576).toFixed(1), frames: recFrames, sec: +(recFrames / 30).toFixed(1), code, tail: ok ? undefined : err.slice(-300) });
    if (ok) console.log('영상: ' + recPath + '  (' + (size / 1048576).toFixed(1) + ' MB, ' + (recFrames / 30).toFixed(1) + '초)');
    setTimeout(() => app.exit(ok ? 0 : 1), 200);
  });
  log('INFO', '녹화 시작', { out: recPath, size: `${recSize.width}x${recSize.height}`, fps: 30 });
}

// 렌더러(헤엄 끝)에서 신호가 오면 마무리한다
ipcMain.handle('record:stop', () => {
  if (recTimer) { clearInterval(recTimer); recTimer = null; }
  try { if (recWinRef && !recWinRef.isDestroyed()) recWinRef.webContents.endFrameSubscription(); } catch (e) { /* noop */ }
  if (recProc && recProc.stdin.writable) recProc.stdin.end();
  else setTimeout(() => app.exit(1), 200);
  return true;
});

ipcMain.handle('config:get', () => ({ ...config, build: BUILD }));
// 렌더러가 상태가 바뀔 때마다 알려준다 — 자동 업데이트 적용 시점(대기 화면) 판단용
let rendererState = 'IDLE', rendererStateAt = Date.now();
ipcMain.handle('flow:state', (_e, st) => { rendererState = String(st || ''); rendererStateAt = Date.now(); return true; });

// ---------- 자동 업데이트 (GitHub Releases) ----------
// 태그 v* 푸시 → CI 가 Release 에 인스톨러 업로드 → 키오스크가 받아 **대기 화면일 때만** 재시작해 적용한다.
// 체험 도중에는 절대 끼어들지 않는다. 실패하면 조용히 현재 버전으로 계속 간다(무인 운영).
// config.update.enabled:false 또는 --no-update 로 끈다. 포터블/zip 실행본에서는 동작하지 않는다(설치형 전용).
function setupAutoUpdate() {
  const U = Object.assign({ enabled: true, checkMinutes: 60, idleSeconds: 20 }, config.update || {});
  if (!app.isPackaged || IS_SMOKE || NO_UPDATE || U.enabled === false) { log('INFO', '자동 업데이트 꺼짐', { packaged: app.isPackaged, smoke: IS_SMOKE, noUpdate: NO_UPDATE, enabled: U.enabled }); return; }
  if (!IS_INSTALLED) { log('WARN', '자동 업데이트는 설치형(인스톨러)에서만 동작 — 포터블/zip 실행본은 수동 교체'); return; }
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { log('ERROR', 'electron-updater 로드 실패', { error: String(e) }); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;      // 운영자가 종료 버튼으로 끄면 그때도 적용된다
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = { info: (m) => log('INFO', '업데이트: ' + m), warn: (m) => log('WARN', '업데이트: ' + m), error: (m) => log('ERROR', '업데이트: ' + m), debug: () => {} };
  let downloaded = null;
  autoUpdater.on('update-available', (i) => log('INFO', '새 버전 발견 — 다운로드 시작', { version: i.version }));
  autoUpdater.on('update-not-available', (i) => log('INFO', '최신 버전', { version: i.version }));
  autoUpdater.on('error', (e) => log('ERROR', '업데이트 실패 — 현재 버전 유지', { error: String(e && e.message || e) }));
  autoUpdater.on('update-downloaded', (i) => { downloaded = i.version; log('INFO', '업데이트 다운로드 완료 — 대기 화면에서 적용', { version: i.version }); });
  const check = () => autoUpdater.checkForUpdates().catch((e) => log('WARN', '업데이트 확인 실패', { error: String(e && e.message || e) }));
  setTimeout(check, 15000);                                            // 시작 직후는 카메라·프린터 초기화에 양보
  setInterval(check, Math.max(5, U.checkMinutes) * 60 * 1000);
  // 다운로드가 끝나 있고, 렌더러가 IDLE 로 충분히 머물러 있으면(관람객 없음) 재시작해 적용
  setInterval(() => {
    if (!downloaded) return;
    const idleFor = (Date.now() - rendererStateAt) / 1000;
    if (rendererState === 'IDLE' && idleFor >= U.idleSeconds) {
      log('INFO', '업데이트 적용 — 재시작', { version: downloaded, idleSec: Math.round(idleFor) });
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 500);
      downloaded = null;
    }
  }, 5000);
}
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
// 헤엄 스프라이트 시트 메타. file:// 페이지에서는 fetch 로 로컬 JSON 을 못 읽으므로(opaque origin) 메인이 읽어 넘긴다.
// 파일이 없으면 null — 렌더러가 단일 이미지로 폴백한다(무인 키오스크 규약: 자산이 없어도 멈추지 않는다).
ipcMain.handle('asset:swimMeta', () => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'dalsu-swim.json'), 'utf8')); }
  catch (e) { return null; }
});
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
