// 키오스크 화면 — flow(상태) / compose(합성 레이아웃) / river(물길 경로)를 사용해 DOM·캔버스·웹캠을 구동
'use strict';
(async function main() {
  const SMOKE = new URLSearchParams(location.search).get('smoke') === '1';
  const E2E = new URLSearchParams(location.search).get('e2e') === '1';   // 물줄기 실측 검증 모드
  // 렌더 실측 모드 — 캔버스 명령은 지연 래스터화되므로 그리기 직후 타이머만 재면 진짜 비용이 안 잡힌다.
  // getImageData 로 한 번 강제 동기화하면 그 프레임의 래스터까지 포함한 실제 비용이 나온다.
  const BENCH = new URLSearchParams(location.search).get('bench') === '1';
  // 데모 영상 녹화 모드 — 실제 앱을 그대로 돌리되 촬영 화면 직전(헤엄 끝)에서 멈춘다.
  // 이 모드에서는 화면 캡처(capturePage)를 하지 않는다. 프레임마다 수십 ms 를 먹어 녹화가 끊긴다.
  const RECORD = new URLSearchParams(location.search).get('record') === '1';
  // 소크 테스트: N 사이클을 연속으로 돌리며 JS 힙을 기록한다 (24시간 운영 전 누수 확인용). --smoke-soak=N
  const SOAK = parseInt(new URLSearchParams(location.search).get('soak') || '0', 10) || 0;
  const soakHeap = [];

  // 렌더 루프에서 예외가 나면 화면이 조용히 멈춘다(무인 키오스크에서 최악).
  // 로그에 남겨야 원인을 알 수 있다 — 개발 중에 이것 때문에 한참 헤맸다.
  window.addEventListener('error', (e) => {
    try { window.kiosk.log('ERROR', '렌더러 오류', { message: String(e.message), at: (e.filename || '') + ':' + e.lineno }); } catch (x) { /* noop */ }
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { window.kiosk.log('ERROR', '렌더러 처리 안 된 거부', { reason: String(e.reason) }); } catch (x) { /* noop */ }
  });
  const cfg = await window.kiosk.getConfig();
  const T = cfg.timing;
  const scale = SMOKE ? (parseFloat(new URLSearchParams(location.search).get('speed')) || 0.04) : 1; // 스모크는 타이밍 단축(speed로 조절: 연출 캡처용 0.5 등)
  const ms = (v) => Math.max(10, Math.round(v * scale));
  const log = (lvl, m, x) => window.kiosk.log(lvl, m, x);
  // 녹화 중에는 캡처를 건너뛴다(프레임이 끊긴다). 그 밖에는 예전과 동일.
  const snap = (name) => (RECORD ? Promise.resolve(null) : window.kiosk.snap(name));

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), cam = $('cam'), fx = $('fx'), fxCtx = fx.getContext('2d');
  const card = $('card'), cardCtx = card.getContext('2d');
  $('head-title').textContent = cfg.screen.headTitle;
  $('head-sub').textContent = cfg.screen.headSub;
  $('idle-sub').textContent = cfg.screen.idleSubtitle;
  $('guide-text').textContent = cfg.screen.guideText;
  $('countdown-text').textContent = cfg.screen.countdownText;
  $('preview-title').textContent = cfg.screen.previewTitle;
  $('preview-text').textContent = cfg.screen.previewText;
  $('done-text').textContent = cfg.screen.doneText;
  $('error-text').textContent = cfg.screen.errorText;
  if (cfg.build) $('build-tag').textContent = `v${cfg.build.version}  ${cfg.build.builtAt}`;
  $('guide-hand').innerHTML = artHandSvg();
  $('printer').innerHTML = artPrinterSvg();
  card.width = cfg.card.width; card.height = cfg.card.height;   // 가로/세로 카드 모두 지원
  if (cfg.camera.mirror) cam.classList.add('mirror');
  // 촬영 화면(카운트다운·촬영)에서 AR 오버레이를 그릴지. false면 카메라만 보여 사람이 가려지지 않는다.
  const AR_ON_CAMERA = cfg.screen.captureOverlay === true;
  stage.dataset.captureOverlay = AR_ON_CAMERA ? 'on' : 'off';

  // ---------- 서체 선로딩 (캔버스 합성·첫 화면에서 폴백 서체가 찍히지 않도록) ----------
  try { await Promise.all([document.fonts.load('bold 40px "Samsung SS Head KR"', '달수 물길 Reduce'), document.fonts.load('40px "Samsung SS Body KR"', '물 사용량을'), document.fonts.load('bold 40px "Samsung SS Body KR"')]); } catch (e) { log('WARN', '서체 로드 실패', { error: String(e) }); }

  // ---------- SWIM 카메라 설정 ----------
  // 시안 6컷은 달수에게 바짝 붙은 클로즈업이다. 지도 시점 그대로면 달수가 화면 높이의 9%뿐이라
  // 아무리 잘 움직여도 "고급"으로 읽히지 않는다. SWIM 에서만 다가가고 촬영 화면으로 넘어가며 빠진다.
  // ⚠ 기본값은 반드시 코드에 둔다 — 현장 config.json 은 업데이트가 덮어쓰지 않아 구버전이 남아 있을 수 있다.
  const CAM = Object.assign({
    enabled: true, zoom: 2.2, pushInFrom: 0.05, pushInTo: 0.30, releaseAt: null,
    lead: 0.04, biasY: -0.055, followMs: 280, hillParallax: 0.40,
    natureCount: 14, natureUTo: 0.58, natureSizeScale: 0.85, treeCount: 30,
  }, (cfg.swim && cfg.swim.camera) || {});

  // 물길 정적 레이어를 구울 **고정 배율**. 카메라 줌은 1~CAM.zoom 사이를 오가지만 셸은 이 배율로 한 번만 굽고
  // 줌이 낮을 땐 축소해서 붙인다(축소는 확대와 달리 뭉개지지 않는다). 라이브 줌을 넘기면 매 프레임 재굽기가 된다.
  const SHELL_Z = CAM.enabled ? Math.max(1, Math.min(3, CAM.zoom)) : 1;
  // 자연 요소 개수·배치 범위·나무 수는 **카메라와 무관한 장면 설정**이다.
  // 카메라를 끈다고 경관까지 빈약해지면 안 되므로 config.scene 에서 따로 읽는다.
  // ⚠ 기존 8개 배치는 u=(i+1)/9 라 **절반이 달수가 가지 않는 하류(u>0.5)에서 피고 있었다** —
  //   "달수의 진행이 생명을 번지게 한다"가 관객에게 절반만 보이던 원인이다.
  const SCN = cfg.scene || {};
  const NCOUNT = Math.max(4, Math.round(SCN.natureCount == null ? 14 : SCN.natureCount));
  const NUTO = SCN.natureUTo == null ? 0.58 : SCN.natureUTo;
  const NSIZE = SCN.natureSize == null ? 0.85 : SCN.natureSize;

  // ---------- 자산 ----------
  const img = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => { log('WARN', '자산 없음', { src }); res(null); }; i.src = src; });
  const A = {
    front: await img('../assets/dalsu-front.png'),
    side: await img('../assets/dalsu-side.png'),
    float: await img('../assets/dalsu-float.png'),
    face: await img('../assets/dalsu-face.png'),
    // 종류별 실사 컷아웃 — 없으면 art.js 벡터 스프라이트로 자동 폴백.
    // 한 묶음(nature-*)으로 두면 물가에 물고기가 놓이므로 반드시 종류를 나눈다.
    fish: [], plant: [], tree: [],
  };
  for (const kind of ['fish', 'plant', 'tree']) {
    for (let i = 1; i <= 8; i++) { const n = await img(`../assets/${kind}-${i}.png`); if (n) A[kind].push(n); }
  }
  log('INFO', '실사 자연 자산', { fish: A.fish.length, plant: A.plant.length, tree: A.tree.length });
  // ---------- 헤엄 스프라이트 시트 ----------
  // 달수를 정지 PNG 한 장으로 돌리면 아무리 물이 반응해도 '뻣뻣한 스티커'로 읽힌다(현장 지적).
  // 시트가 있으면 프레임 애니메이션으로 그리고, **없으면 지금까지와 100% 동일하게** 단일 이미지로 간다.
  A.swim = null; A.swimMeta = null; A.swimScale = 1;
  try {
    const m = await window.kiosk.swimMeta();
    const sheet = m ? await img('../assets/dalsu-swim.png') : null;
    const ok = !!(m && sheet
      && sheet.naturalWidth === m.sheetW && sheet.naturalHeight === m.sheetH
      && m.cols * m.cellW === m.sheetW && m.rows * m.cellH === m.sheetH
      && m.frames > 0 && m.frames <= m.cols * m.rows
      && m.body && m.body.w > 0 && m.body.h > 0
      && A.float && Math.abs((A.float.width / A.float.height) - m.srcAspect) < 0.02);
    if (ok) { A.swimMeta = m; A.swim = makeSwimSheet(sheet, m); }
    else if (m || sheet) log('WARN', '헤엄 시트가 메타와 맞지 않음 — 단일 이미지로 폴백',
      { meta: !!m, sheet: !!sheet, sheetW: sheet && sheet.naturalWidth, metaW: m && m.sheetW });
  } catch (e) { log('WARN', '헤엄 시트 로드 실패 — 단일 이미지로 폴백', { error: String(e) }); }
  log('INFO', A.swim ? '헤엄 스프라이트 시트 사용' : '헤엄 스프라이트 없음 — dalsu-float.png 정지 이미지',
    A.swimMeta ? { frames: A.swimMeta.frames, scale: +A.swimScale.toFixed(2), model: A.swimMeta.model || '' } : {});

  // 시트는 셀 하나가 크다(수백 px). 매 프레임 화면 크기로 축소하면 소프트웨어 래스터에서 비싸므로
  // 화면에 실제로 필요한 최대 크기로 **로드 시 한 번만** 줄여 굽는다.
  function makeSwimSheet(sheet, m) {
    const stageH = (document.getElementById('stage') || {}).clientHeight || window.innerHeight || 1920;
    const want = stageH * 0.09 * 1.15 * (CAM.enabled ? CAM.zoom : 1) * (window.devicePixelRatio || 1);
    const sc = Math.min(1, Math.max(0.25, want / Math.max(1, (m.bodyPx && m.bodyPx.h) || m.cellH)));
    A.swimScale = sc;
    // 배율이 1 이라도 **반드시 캔버스로 한 번 구운다**. PNG 를 그대로 쓰면 첫 프레임에서 디코드가 일어나
    // 그 순간 달수 그리기가 8.9ms 까지 튀고, perfTick 이 이를 성능 부족으로 오인해 물 연출을 강등시킨다(실측).
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(m.sheetW * sc)); cv.height = Math.max(1, Math.round(m.sheetH * sc));
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(sheet, 0, 0, cv.width, cv.height);
    // 셀 하나를 미리 한 번 그려 래스터 경로까지 예열한다
    c.drawImage(cv, 0, 0, 1, 1, 0, 0, 1, 1);
    return cv;
  }
  // 수면 텍스처 — assets/water.png(AI 생성본 등)가 있으면 그것을, 없으면 절차 생성본을 쓴다
  const RV = cfg.river || {};
  if (RV.path) { const ok = setPath(RV.path); log(ok ? 'INFO' : 'WARN', ok ? '물길 경로 config 적용' : '물길 경로 config 형식 오류 — 기본값 사용'); }
  A.water = await img('../assets/water.png');
  // 텍셀 밀도가 이미 1:1 미만(384/460 = 0.83)이라 당겨서 보면 물결이 뭉갠다.
  // tilePx(물결의 실제 크기)는 그대로 두고 해상도만 올린다 — tilePx 를 늘리면 강이 아니라 바다가 된다.
  // tileNoise 는 정규화 uv 를 쓰므로 큰 캔버스에서도 같은 무늬가 더 촘촘히 샘플링될 뿐이다.
  const TEX_S = Math.max(1, Math.min(3, RV.textureScale || 1));
  if (!A.water) {
    const tw = Math.round(384 * TEX_S), th = Math.round(160 * TEX_S);
    A.water = makeWaterTexture(tw, th, RV.seed || 1337);
    log('INFO', '수면 텍스처 절차 생성', { w: tw, h: th, scale: TEX_S });
  } else {
    log('INFO', '수면 텍스처 파일 사용', { src: 'assets/water.png', w: A.water.width });
    if (A.water.width < 384 * TEX_S) log('WARN', '수면 텍스처가 줌 배율에 비해 저해상도 — 물결이 뭉갤 수 있다',
      { texW: A.water.width, 권장: Math.round(384 * TEX_S) });
  }
  if (A.front) $('stage-dalsu').src = A.front.src; else $('stage-dalsu').style.display = 'none';

  // ---------- 카메라 (실패/스모크 시 모의 프레임) ----------
  let frameSource = null; // HTMLVideoElement | HTMLCanvasElement
  const mock = document.createElement('canvas'); mock.width = cfg.camera.width; mock.height = cfg.camera.height;
  // 모의 프레임 — 카메라가 없을 때 대체. 스모크에서 "AR이 사람 얼굴을 가리지 않는지" 눈으로 볼 수 있게 인물 실루엣을 그린다.
  function drawMock(t) {
    const c = mock.getContext('2d'), W = mock.width, H = mock.height;
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#e9eef2'); bg.addColorStop(1, '#c8d3da');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const cx = W / 2, headR = H * 0.13, headY = H * 0.30;
    c.fillStyle = '#8d99a6'; // 어깨·몸통
    c.beginPath(); c.moveTo(cx - H * 0.30, H); c.quadraticCurveTo(cx - H * 0.26, headY + headR * 1.5, cx, headY + headR * 1.35);
    c.quadraticCurveTo(cx + H * 0.26, headY + headR * 1.5, cx + H * 0.30, H); c.closePath(); c.fill();
    c.fillStyle = '#9aa6b2'; c.beginPath(); c.arc(cx, headY, headR, 0, Math.PI * 2); c.fill(); // 머리
    c.fillStyle = 'rgba(47,58,68,.55)'; c.font = 'bold 34px sans-serif'; c.textAlign = 'center';
    c.fillText(SMOKE ? 'SMOKE TEST FRAME' : 'NO CAMERA', cx, H - 28 + Math.sin(t / 300) * 3);
  }

  async function initCamera() {
    if (SMOKE) {
      frameSource = mock; fitCamPreview();
      // 스모크에도 미리보기 영역에 모의 프레임을 흘려 촬영 화면 구도를 스냅샷으로 확인할 수 있게 한다
      try { cam.srcObject = mock.captureStream(15); } catch (e) { /* 없어도 카드 합성에는 영향 없다 */ }
      return;
    }
    try {
      const constraints = { video: { width: cfg.camera.width, height: cfg.camera.height, deviceId: cfg.camera.deviceId ? { exact: cfg.camera.deviceId } : undefined }, audio: false };
      cam.srcObject = await navigator.mediaDevices.getUserMedia(constraints);
      await new Promise((r) => (cam.readyState >= 2 ? r() : cam.onloadeddata = r));
      frameSource = cam; fitCamPreview(); log('INFO', '카메라 연결', { w: cam.videoWidth, h: cam.videoHeight });
      // USB 웹캠이 빠지거나 드라이버가 죽으면 트랙이 'ended' 된다. 그대로 두면 다음 촬영에서 폭이 0 인 프레임으로
      // 합성이 실패해 '직원 호출' 화면이 뜬다. 5초 간격으로 다시 잡아 본다(24시간 무인 운영).
      const track = cam.srcObject.getVideoTracks()[0];
      if (track) track.onended = () => { log('ERROR', '카메라 트랙 종료 — 재연결 시도'); frameSource = null; camRetry(); };
      return true;
    } catch (e) { log('ERROR', '카메라 실패', { error: String(e) }); return false; }
  }
  let camRetryTimer = null;
  function camRetry() {
    clearTimeout(camRetryTimer);
    camRetryTimer = setTimeout(async () => { if (!(await initCamera())) camRetry(); else log('INFO', '카메라 재연결 성공'); }, 5000);
  }
  if (!(await initCamera()) && !SMOKE) { frameSource = mock; fitCamPreview(); camRetry(); }

  // ---------- 상태 ----------
  const flow = createFlow(cfg.goals.map((g) => g.key));
  let timers = [];
  const later = (fn, d) => { const t = setTimeout(fn, ms(d)); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  let lastStateAt = performance.now(), lastStateName = '';
  function setState() {
    stage.dataset.state = flow.state;
    lastStateAt = performance.now(); lastStateName = flow.state;
  }
  // 데드맨 스위치 — 어떤 상태에서든 연출이 멈추면 무인 키오스크가 영원히 정지한다.
  // idleReturnMs 는 GUIDE에서만 동작하므로 그 밖의 상태를 이걸로 덮는다.
  const STATE_BUDGET_MS = () => ({
    RIVER: T.achieveMs + T.riverFormMs, NATURE: T.natureMs, SWIM: T.swimMs,
    COUNTDOWN: (T.readyMs || 0) + (T.countdownSec + 2) * 1000, CAPTURE: 8000,
    // 미리보기는 인쇄가 끝날 때까지다 → 프린터 타임아웃 × (재시도+1) 을 예산으로 잡는다.
    // 예전처럼 previewMs 로 잡아 두면 인쇄가 느릴 때 정상 동작 중에 대기 화면으로 튕긴다.
    PREVIEW: (T.previewMinMs || 6000) + ((cfg.printer && cfg.printer.timeoutMs) || 90000) * (((cfg.printer && cfg.printer.retry) || 0) + 1) + 15000,
    DONE: T.doneMs,
  }[flow.state]);
  function watchStuck() {
    const budget = STATE_BUDGET_MS();
    if (budget && flow.state === lastStateName) {
      const limit = Math.max(ms(budget) * 2, 20000);
      if (performance.now() - lastStateAt > limit) {
        log('ERROR', '상태 정지 감지 — 대기 화면으로 강제 복귀', { state: flow.state, ms: Math.round(performance.now() - lastStateAt) });
        finish();
      }
    }
  }

  // FX 애니메이션 상태 + 파티클/효과음 (motion.js)
  const SWIM_STROKES = 5;   // 헤엄 스트로크 횟수 — swimEase 와 swimPose 가 같은 값을 써야 몸짓과 전진이 맞물린다
  // 도착 진행도. 기획 7번은 '중앙(0.5) 도착'이었지만 "끝까지 내려오게" 요청(2026-09-01)으로 화면 아래(u=0.82, y≈0.92)까지 간다.
  // 카드·물고기 회피·카메라 추종이 전부 이 값을 본다 — 0.5 를 하드코딩하지 말 것.
  const ARRIVE_U = Math.min(0.95, Math.max(0.3, (cfg.swim && cfg.swim.arriveU) || 0.5));
  const anim = { wake: [], riverProgress: 0, natureCount: 0, swimU: -1, swimP: 0, face: 1, tilt: 0, enter: 0, life: 0, arFade: 1, camOut: 0, cam: { zoom: 1, k: 0, hold: 1, x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 }, flow: 0, tribProgress: 0, tribFade: 0, mergeFlash: 0, t0: performance.now(), popped: [], lastWake: 0, sparkled: new Set() };
  const particles = createParticles();
  const sound = createSound(!!(cfg.sound && cfg.sound.enabled) && !SMOKE);

  // ---------- 물방울 (시안 1~4컷: 가로 1열, 눈물방울, 터치하면 그 자리에 목표 문구가 남는다) ----------
  const DROP_W = 21, DROP_GAP = 2.4;                                  // cqw (무대 폭 기준)
  const DROP_TOP = 28;   // cqh. 지류가 목표 문구 아래에서 흘러나올 공간 확보                                                // vh
  const POS = cfg.goals.map((_, i) => {
    const total = cfg.goals.length * DROP_W + (cfg.goals.length - 1) * DROP_GAP;
    return [(100 - total) / 2 + i * (DROP_W + DROP_GAP), DROP_TOP];    // [vw, vh]
  });
  function buildBubbles() {
    $('guide-text').style.opacity = '';
    document.querySelectorAll('.bubble .done').forEach((el) => { el.style.animation = ''; el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; });
    const wrap = $('bubbles'); wrap.innerHTML = '';
    cfg.goals.forEach((g, i) => {
      const b = document.createElement('div'); b.className = 'bubble'; b.dataset.key = g.key;
      b.style.left = POS[i][0] + 'cqw'; b.style.top = POS[i][1] + 'cqh';
      b.innerHTML = `${artDropSvg(i, ART_DROP_COLOR)}<div class="inner">${artIconSvg(g.icon, g.iconColor)}<div class="label"></div></div><div class="done"></div>`;
      b.querySelector('.inner svg').classList.add('icon');
      b.querySelector('.label').textContent = g.label;
      // 목표 문구는 어절 단위로 줄바꿈해 물방울 자리에 세로로 쌓는다 (시안 3~4컷)
      const done = b.querySelector('.done');
      // config 에 줄바꿈 문자가 있으면 그 줄 그대로, 없으면 어절 단위로 나눈다
      (g.text.includes('\n') ? g.text.split('\n') : g.text.split(' ')).forEach((word, k) => {
        const line = document.createElement('div'); line.textContent = word;
        if (k) line.style.marginTop = '.2vh';
        done.appendChild(line);
      });
      b.addEventListener('pointerdown', () => onBubble(g, b));
      wrap.appendChild(b);
    });
    $('guide-hand').style.opacity = .95;
    requestAnimationFrame(moveHand);   // 방금 만든 물방울의 레이아웃이 확정된 뒤에 배치
  }
  // getBoundingClientRect()는 뷰포트 절대 좌표다. 캔버스(#fx)와 #stage 안의 요소는 '무대 좌표계'를 쓰므로
  // 무대의 좌상단 오프셋을 빼야 한다. 세로 키오스크에서는 오프셋이 0이라 티가 안 나지만,
  // 가로 모니터에서는 무대가 가운데 레터박스로 놓여 그만큼 전부 어긋난다.
  const stageBox = () => fx.getBoundingClientRect();
  function elCenter(el, yFrac) {
    const b = stageBox(), r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - b.left, y: r.top + r.height * (yFrac == null ? 0.5 : yFrac) - b.top };
  }

  // 지류 발원지 = 상단 줄로 올라간 목표 문구의 '아래 끝'. 각 목표에서 물이 흘러나오는 그림이라
  // 문구 위치와 어긋나면 "4개의 요소가 물줄기가 된다"는 연결이 끊긴다.
  function goalSources() {
    const W = fx.clientWidth, H = fx.clientHeight;
    const rowY = H * ((cfg.screen.goalRowTop || 19) / 100);
    return cfg.goals.map((g, i) => {
      const bub = document.querySelector(`.bubble[data-key="${g.key}"]`);
      const done = bub && bub.querySelector('.done');
      const cx = bub ? elCenter(bub).x : ((POS[i][0] + DROP_W / 2) / 100) * W;
      const h = (done && done.scrollHeight ? done.scrollHeight : H * 0.10) * 0.72;
      return [cx / W, (rowY + h / 2 + H * 0.015) / H];
    });
  }
  // 시안 5컷: 달성한 4개 목표 문구는 **사라지지 않고** 상단에 한 줄로 올라가 남는다.
  // ("4개의 목표가 모여 하나의 깨끗한 물길이 됩니다" — 4개가 보여야 그 문장이 성립한다)
  // 원래 자리에 두면 완성된 S자 물길이 문구를 관통하므로, 물길이 시작되는 y 위쪽으로 올린다.
  function raiseGoalTexts() {
    const H = fx.clientHeight;
    const targetY = H * ((cfg.screen.goalRowTop || 17) / 100);
    document.querySelectorAll('.bubble .done').forEach((el) => {
      const dy = targetY - elCenter(el).y;
      el.style.animation = 'none';   // doneIn 등장 애니메이션(fill:both)이 transform을 덮어쓰므로 먼저 해제
      void el.offsetWidth;
      el.style.transition = `transform ${ms(T.riverFormMs * 0.45)}ms cubic-bezier(.2,.8,.3,1)`;
      el.style.transform = `translateY(${dy.toFixed(1)}px) scale(.72)`;
    });
  }
  // 자연 회복 단계로 넘어가면 역할을 다했으므로 부드럽게 사라진다 (시안 6컷에는 문구가 없다)
  function fadeGoalTexts() {
    document.querySelectorAll('.bubble .done').forEach((el) => {
      el.style.transition += `, opacity ${ms(600)}ms ease-out`;
      el.style.opacity = '0';
    });
  }
  function moveHand() {
    const next = cfg.goals.findIndex((g) => !flow.poppedKeys.includes(g.key));
    const hand = $('guide-hand');
    // 다 눌렀어도 숨기지 않는다. 가이드 단계가 끝나면 #guide 섹션째 사라지므로 그때 자연스럽게 없어진다.
    if (next < 0) return;
    // 대상 물방울의 실제 위치를 재서 바로 아래에 붙인다 — 아이콘·라벨을 절대 덮지 않는다
    const el = document.querySelector(`.bubble[data-key="${cfg.goals[next].key}"]`);
    if (!el) return;
    const c = elCenter(el, 0.90);
    hand.style.left = c.x + 'px';
    hand.style.top = c.y + 'px';
    hand.style.opacity = .95;
  }
  function onBubble(goal, el) {
    const r = flow.popBubble(goal.key);
    if (!r.accepted) return;
    el.classList.add('popped');
    // 시안 3컷: 터진 자리에 물 스플래시
    const c = elCenter(el, 0.45);
    anim.popped.push({ ...c, color: goal.color });
    const sc = Math.min(fx.clientWidth, fx.clientHeight) / 900;
    particles.splash(c.x, c.y, goal.color, sc);          // 시안 3컷: 물기둥 + 물보라 + 파문
    particles.sparkle(c.x, c.y, 12, '#ffffff', sc);
    anim.mergeFlash = 0.35;                               // 화면 전체 미세 플래시
    sound.pop();
    moveHand();
    $('guide-text').style.opacity = 0; // 시안 3컷부터는 안내 문구 없이 목표 문구만
    log('INFO', '물방울', { key: goal.key, popped: r.popped });
    if (r.allDone) later(runStory, T.goalTextMs); // 마지막 문구를 읽을 틈을 준 뒤 물길 연출
    else resetIdleTimer();
  }

  // ---------- 연출 ----------
  // 기획 4·5번: 4개의 줄기가 하나의 줄기가 되며 삼성의 S자 물길이 만들어진다.
  //   ① 지류 4개가 물방울 자리에서 중앙으로 자란다        (achieveMs)
  //   ② 중앙에서 합류 — 포말·파문·플래시                  (riverFormMs 앞 18%)
  //   ③ 합류점에서 S자가 위·아래 양쪽으로 뻗어 완성        (나머지)
  let tribs = [];
  let e2eResult = null;
  let e2eHand = null;
  let lastResult = null, lastDataUrl = null;
  function runStory() {
    clearTimers(); setState(); // RIVER
    $('story-text').textContent = cfg.screen.achieveText; $('story-text').style.display = '';
    tribShell = null;              // 관람객이 바뀌면 다시 자라야 한다
    anim.wake.length = 0;
    anim.riverProgress = 0; anim.natureCount = 0; anim.swimU = -1; anim.arFade = 1; anim.enter = 0; anim.life = 0;
    anim.face = 1; anim.tilt = 0; anim.arriveAt = 0; anim.flipAt = 0; vfPainted = false;
    anim.camOut = 0; Object.assign(anim.cam, { zoom: 1, k: 0, hold: 1, x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 });
    payoffIdx = -2; setPayoff(null);
    anim.tribProgress = 0; anim.tribFade = 1; anim.mergeFlash = 0;
    anim.t0 = performance.now(); anim.sparkled.clear();

    // 달성한 4개 문구를 상단 줄로 올린다 — 여기서 물줄기가 흘러나온다 (시안 5컷)
    raiseGoalTexts();
    const W0 = fx.clientWidth, H0 = fx.clientHeight;
    tribs = tributaries(goalSources(), pointAt(0));   // 물길 머리에서 하나로 뭉친다

    // ① 각 목표에서 물줄기가 흘러나와 본류가 지날 자리로 내려간다
    sound.whoosh();
    tribs.forEach((t, i) => {
      const g = cfg.goals[i];
      particles.stream((u) => { const [x, y] = tributaryPointAt(t.path, u * Math.min(1, anim.tribProgress * 1.15)); return [x * fx.clientWidth, y * fx.clientHeight]; },
        g ? g.color : '#8fd3ea', 6, ms(T.achieveMs) / 1000, Math.min(W0, H0) / 540);
    });
    if (SMOKE && scale >= 0.3) later(() => snap('tributary'), T.achieveMs * 0.7);
    if (E2E) {
      later(async () => {                              // 자라는 도중
        await snap('e2e-growing');
        const r = verifyTributaries('자라는 중', true);
        if (!r.ok) e2eResult = r;
      }, T.achieveMs * 0.45);
      later(async () => {                              // 다 자란 직후 = 합류 직전
        await snap('e2e-tributary');
        const r = verifyTributaries('합류 직전');
        if (!e2eResult || e2eResult.ok) e2eResult = r;
      }, T.achieveMs * 0.97);
    }
    animateValueRaw((p) => (anim.tribProgress = easeOut(p)), T.achieveMs, () => {
      // ② 합류 — 4줄기가 각자의 자리에서 본류로 쏟아진다
      $('story-text').textContent = cfg.screen.riverText;
      const sc = Math.min(W0, H0) / 900;
      tribs.forEach((t, i) => {
        const g = cfg.goals[i], px = t.to[0] * W0, py = t.to[1] * H0;
        particles.splash(px, py, '#bfe6f4', sc * 0.85);
        particles.burst(px, py, g ? g.color : '#8fd3ea', 14, sc);
      });
      anim.mergeFlash = 0.6;
      sound.chime();
      if (SMOKE && scale >= 0.3) later(() => snap('merge'), 120);

      // ③ 합류점에서 S자가 양쪽으로 뻗는다.
      //    지류는 이 동안 계속 흐른다 — 사라지면 "4줄기가 하나가 됐다"가 아니라 "없어지고 딴 게 생겼다"로 보인다.
      if (SMOKE && scale >= 0.3) later(() => snap('river'), T.riverFormMs * 0.75);
      animateValue((p) => (anim.riverProgress = p), T.riverFormMs, () => {
        { const e = pointAt(1); particles.sparkle(e[0] * W0, e[1] * H0, 12, '#bfe6f4'); } sound.chime();
        flow.advance(); setState(); // NATURE — 달수가 물길 머리에 떠오른다 (자연은 달수가 지나가며 살아난다)
        animateValueRaw((p) => (anim.tribFade = 1 - p), 900, () => { anim.tribFade = 0; particles.clearFlow(); }); // 이제 본류에 흡수
        fadeGoalTexts();
        $('story-text').textContent = cfg.screen.natureText;
        if (SMOKE && scale >= 0.3) later(() => snap('nature'), T.natureMs * 0.7);
        { const e = pointAt(0); particles.splash(e[0] * W0, e[1] * H0, '#bfe6f4', Math.min(W0, H0) / 1400); }
        animateValue((p) => (anim.enter = p), T.natureMs, () => {
          anim.enter = 1; sound.chime();
          flow.advance(); setState(); // SWIM — 달수가 내려가며 지나온 자리에 자연이 살아난다
          $('story-text').textContent = cfg.screen.swimText;
          if (SMOKE && scale >= 0.3) {
            // 헤엄이 자연스러운지 눈으로 보려면 한 스트로크 안의 여러 순간을 봐야 한다.
            // f3·f4 는 물길이 아래로 꺾이며 달수가 **몸을 트는** 순간(p≈0.51) 앞뒤다 — 여기가 가장 티나는 자리라 반드시 본다.
            [0.18, 0.40, 0.62, 0.84].forEach((f, i) => later(() => snap(`life${i + 1}`), T.swimMs * f));
            [0.30, 0.335, 0.505, 0.53, 0.56].forEach((f, i) => later(() => snap(i === 4 ? 'swim' : `swim-f${i + 1}`), T.swimMs * f));
            // 카메라 타임라인 증빙 — 당기기 전(폴백 그림) / 당기는 중(램프)
            later(() => snap('swim-wide'), T.swimMs * 0.02);
            later(() => snap('swim-push'), T.swimMs * 0.16);
            later(() => snap('swim-arrive'), T.swimMs * 0.98);
          }
          // 등속 슬라이드가 아니라 스트로크(차고-미끄러짐)로 중앙(u=0.5)까지 헤엄쳐 도착
          animateValueRaw((p) => {
            anim.swimP = p;
            // 스트로크(차고-미끄러짐)를 **길이** 진행도로 쓴다. u 를 그대로 쓰면 굽이가 촘촘한 상류에서
            // 제자리걸음처럼 보이다가 하류에서 튕겨 나간다(측정: 구간 속도 2.5배 차).
            anim.swimU = uAtArc(swimArrive(p, SWIM_STROKES), 0, ARRIVE_U);   // 마지막엔 미끄러지며 멈춘다
            // 생명이 번지는 앞머리 — 달수보다 살짝 뒤처져 '지나간 자리'에 살아나게 한다
            anim.life = Math.min(1, Math.max(0, (p - 0.06) * 1.18));
            anim.natureCount = anim.life * NCOUNT;
            setPayoff(p);          // 지나온 만큼 되살아난 것을 4대 목표와 짝지어 알려준다
          }, T.swimMs, () => {
            anim.life = 1; anim.natureCount = NCOUNT;
            // 기획 7번: 달수가 가운데 도착 → 촬영 화면. 곧장 카메라를 켜면 관람객이 놀라므로 준비 여유를 준다
            if (RECORD) {                    // 데모 영상은 여기까지 — 촬영 화면(웹캠)은 담지 않는다
              later(() => { log('INFO', '녹화 구간 종료 — 헤엄 도착'); window.kiosk.recordStop(); }, 2600);
              return;
            }
            $('story-text').textContent = cfg.screen.readyText;
            flow.advance(); setState(); runCountdown();
          });
        });
      });
    });
  }
  function animateValue(set, dur, done) {
    const d = ms(dur), s = performance.now();
    (function step(now) { const p = Math.min(1, (now - s) / d); set(easeOut(p)); if (p < 1) requestAnimationFrame(step); else done(); })(s);
  }
  // 이징을 호출부가 직접 정하는 버전 (헤엄 진행처럼 easeOut이 맞지 않는 경우)
  function animateValueRaw(set, dur, done) {
    const d = ms(dur), s = performance.now();
    (function step(now) { const p = Math.min(1, (now - s) / d); set(p); if (p < 1) requestAnimationFrame(step); else done(); })(s);
  }
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  function runCountdown() {
    if (!AR_ON_CAMERA) { // 카메라가 페이드인하는 동안 물길·자연·달수도 부드럽게 사라진다
      anim.arFade = 1;
      // 뷰파인더 모드면 장면을 완전히 지우지 않고 옅게 남긴다 — 틀 주변이 '빈 여백'이 아니라 '강가 배경'이 된다.
      const floor = (cfg.screen && cfg.screen.viewfinder && cfg.screen.viewfinder.enabled) ? (cfg.screen.viewfinder.sceneAlpha == null ? 0.32 : cfg.screen.viewfinder.sceneAlpha) : 0;
      animateValueRaw((p) => (anim.arFade = 1 - p * (1 - floor)), Math.max(500, T.readyMs || 0), () => { anim.arFade = floor; if (!floor) particles.clear(); });
    }
    // 줌 복귀는 **AR_ON_CAMERA 와 무관하게 항상** 돌린다.
    // captureOverlay 를 켜 둔 현장에서 클로즈업인 채로 촬영 화면이 뜨면 사람이 물길에 파묻힌다.
    // 새 타이머를 만들지 않고 위 페이드와 같은 구간을 쓰므로 데드맨 예산에 영향이 없다.
    animateValueRaw((p) => (anim.camOut = easeOut(p)), Math.max(500, T.readyMs || 0), () => { anim.camOut = 1; });
    if (SMOKE && scale >= 0.3) later(() => snap('ready-pullout'), Math.max(500, T.readyMs || 0) * 0.45);
    setPayoff(null);                 // 촬영 화면으로 넘어가며 내린다
    // 준비 여유 — 강을 보다가 곧바로 자기 얼굴이 뜨면 놀란 표정으로 찍힌다
    later(() => { $('story-text').textContent = ''; $('story-text').style.display = 'none'; startTicks(); }, T.readyMs || 0);
  }
  function startTicks() {
    if (SMOKE && scale >= 0.3) later(() => snap('countdown'), 900);
    let n = T.countdownSec; const el = $('count-num');
    (function tick() {
      el.textContent = n; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
      if (n <= 0) { sound.go(); return capture(); }
      sound.tick();
      n -= 1; later(tick, 1000);
    })();
  }

  // ---------- 촬영 + 합성 ----------
  async function capture() {
    if (!frameSource || (frameSource === cam && !(cam.videoWidth > 0))) {   // 카메라가 죽어 있으면 회색 실루엣을 인쇄하지 않는다
      return onError('camera', { error: '카메라 프레임 없음' });
    }
    flow.advance(); setState(); // CAPTURE
    $('flash').classList.add('on'); later(() => $('flash').classList.remove('on'), 400); sound.shutter();
    try {
      composeCard();
      const dataUrl = card.toDataURL('image/png');
      flow.advance(); setState(); // PREVIEW
      // ── 인쇄 진행 표시 ────────────────────────────────────────────────
      // SMART-81 은 카드 한 장에 20~40초가 걸린다. 예전에는 previewMs(26초) 짜리 CSS 전환으로
      // 진행바를 채웠는데, 실제 인쇄와 아무 관계가 없어서 100% 에 도달한 뒤로도 한참을 더 기다렸다.
      // (게다가 아래 DONE 타이머가 await 뒤에 걸려서, 인쇄가 끝난 다음 26초를 **또** 기다렸다.)
      // 이제 프린터 CLI 가 흘려보내는 실제 단계를 그대로 보여준다.
      const bar = $('print-bar');
      // 현장 config.json 은 업데이트가 덮어쓰지 않는다(현장에서 맞춘 설정을 지키려고).
      // 그래서 새 키(printStages)가 없는 구버전 config 를 만나면 문구가 통째로 비어 버린다.
      // 기본 문구를 코드에 두고 config 가 있으면 덮어쓰게 한다 — 업데이트만으로 동작해야 한다.
      const STAGE_TEXT = Object.assign({
        start: '출력 준비 중이에요', connect: '프린터를 연결하고 있어요',
        settings: '양면 인쇄를 설정하고 있어요', cardin: '카드를 넣고 있어요',
        load: '사진을 프린터로 보내고 있어요', ribbon: '리본을 확인하고 있어요',
        print: '카드를 인쇄하고 있어요', eject: '카드가 나오고 있어요',
        retry: '다시 시도하고 있어요', done: '거의 다 됐어요',
      }, (cfg.screen && cfg.screen.printStages) || {});
      const STAGE_ORDER = ['start', 'connect', 'settings', 'cardin', 'load', 'ribbon', 'print', 'eject', 'done'];
      const setStage = (key) => {
        const txt = STAGE_TEXT[key];
        if (txt) $('preview-text').textContent = txt;
        const idx = STAGE_ORDER.indexOf(key);
        // 마지막 단계 전까지는 100% 를 찍지 않는다 — 다 찼는데 안 나오는 게 가장 답답하다
        const pct = idx < 0 ? 8 : Math.round(6 + (idx / (STAGE_ORDER.length - 1)) * 94);
        bar.style.width = pct + '%';
        bar.dataset.waiting = key === 'done' ? '0' : '1';   // 대기 중에는 줄무늬가 흐른다
        // 주연은 프린터에서 카드가 밀려나오는 그림이다(시안 7·8컷). 글자를 못 읽는 관람객에게도 통한다.
        const OUT = { start: 0, connect: 0, settings: 0, cardin: 0.06, load: 0.06,
          ribbon: 0.06, print: 0.30, eject: 0.86, retry: 0, done: 1 };
        const pr = $('printer');
        pr.style.setProperty('--out', OUT[key] == null ? 0 : OUT[key]);
        pr.dataset.busy = key === 'done' ? '0' : '1';
        log('INFO', '인쇄 단계', { stage: key, pct });
      };
      // '약 N초' 는 추정으로 적으면 틀린 안내가 된다. 이 장비가 실제로 걸린 시간을 앱이 기억해 두었다가
      // 그 값으로 말한다(첫 인쇄 때는 숫자 없이 안내만). 사람이 재서 알려줄 필요가 없다.
      try {
        const st = window.kiosk.printStats ? await window.kiosk.printStats() : null;
        if (st && st.count > 0 && st.avgMs > 3000) {
          const sec = Math.round(st.avgMs / 5000) * 5;    // 5초 단위로 뭉뚱그린다 — 정밀한 척하지 않는다
          STAGE_TEXT.print = `${STAGE_TEXT.print} (약 ${sec}초)`;
        }
      } catch (e) { /* 통계가 없어도 진행에는 지장 없다 */ }
      bar.style.transitionDuration = '';        // 타이머 전환 제거 (CSS 기본값 사용)
      $('printer').style.setProperty('--out', 0);   // 다음 관람객을 위해 카드를 도로 넣어둔다
      setStage('start');
      const offStage = window.kiosk.onPrintStage ? window.kiosk.onPrintStage(setStage) : null;

      const tPrint = performance.now();
      const result = await window.kiosk.print(dataUrl, { subdir: SMOKE ? 'smoke' : undefined });
      if (offStage) offStage();
      if (!result.ok) { log('ERROR', '인쇄 실패', result); return onError('print', result); }
      log('INFO', '인쇄 요청 완료', { mode: result.mode, front: result.front, ms: Math.round(performance.now() - tPrint) });
      setStage('done');
      // 미리보기는 '인쇄가 끝날 때까지'다. 다만 너무 빨리 끝나면(dry-run 등) 사진을 볼 틈이 없으므로 최소 시간을 둔다.
      // later() 가 안에서 ms(=속도 배율)를 적용하므로 여기서는 배율 없는 값으로 계산한다
      const minMs = T.previewMinMs == null ? 6000 : T.previewMinMs;
      const wait = Math.max(0, minMs - (performance.now() - tPrint) / (scale || 1));
      later(() => {
        flow.advance(); setState(); // DONE — 한 바퀴 돌고 온 '카드 수령' 표시
        $('preview-title').textContent = cfg.screen.doneText;
        $('preview-text').textContent = cfg.screen.doneSub || '';
        sound.chime();
        // clearTimers() 에 지워지지 않도록 later 가 아닌 setTimeout 으로 잡는다
        if (SMOKE && scale >= 0.3) setTimeout(async () => {
          await snap(e2eCycle === 1 ? 'done' : `done${e2eCycle}`);
          if (E2E && e2eCycle < 2) { lastResult = result; lastDataUrl = dataUrl; }   // 두 번째 관람객까지 확인 후 종료
          else if (SOAK && e2eCycle < SOAK) { lastResult = result; lastDataUrl = dataUrl; }
          else smokeFinish(result, dataUrl);
        }, ms(T.doneMs) * 0.45);
        later(finish, T.doneMs);
      }, wait);
      // 플래시(0.4초)가 걷힌 뒤에 캡처해야 미리보기 화면이 하얗게 찍히지 않는다
      if (SMOKE) setTimeout(async () => {
        await snap('preview');
        // 느린 검증 모드에서는 완료(수령) 화면까지 본 뒤 종료한다 (위 DONE 진입 시점에서 처리).
        if (scale < 0.3) { if (SOAK) { lastResult = result; lastDataUrl = dataUrl; } else smokeFinish(result, dataUrl); }   // 소크는 finish() 에서 다음 사이클로 이어간다
      }, 800);
    } catch (e) { log('ERROR', '촬영/합성 예외', { error: String(e) }); onError('capture', { error: String(e) }); }
  }

  // 미리보기 띠 높이 = 카드에 실제로 담기는 사진 슬라이스의 종횡비. 이걸 맞춰야 관람객이
  // 화면에서 본 구도 그대로 인쇄된다(예전엔 화면은 꽉 차고 카드만 더 잘려 나갔다).
  // 뷰파인더 틀(무대 px). initCamera → fitCamPreview 가 이 줄보다 **먼저** 실행되므로 var 호이스팅에 기대고,
  // 초기값을 여기서 대입하면 안 된다(대입하면 먼저 세팅된 값을 null 로 덮어써 틀 도려내기·오버레이가 조용히 꺼진다 — 실제로 그랬다).
  var vfBox, vfPainted;
  function fitCamPreview() {
    const src = frameSource; if (!src) return;
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    const st = document.getElementById('stage');
    if (!(sw > 0 && sh > 0) || !st || !st.clientHeight) return;
    const c = photoCrop(sw, sh, card.width, card.height, cfg.card.photoZoom);
    const VF = (cfg.screen && cfg.screen.viewfinder) || {};
    if (VF.enabled) {
      // 카드 틀: 폭 = 무대 폭 × width, 높이는 카드 비율. 사진 띠는 틀 안에서 카드와 같은 비율(c.dh/H)만큼 차지한다.
      const wRatio = Math.min(1.0, Math.max(0.4, VF.width || 0.7));   // 1.0 = 화면 폭 꽉 채움(카드가 곧 화면)
      const boxW = st.clientWidth * wRatio, boxH = boxW * card.height / card.width;
      const camH = boxW / (c.sw / c.sh);
      const top = Math.max(0, Math.min(0.3, VF.top == null ? 0.13 : VF.top)) * st.clientHeight;
      st.classList.add('vf');
      st.style.setProperty('--vf-w', (wRatio * 100).toFixed(2) + '%');
      st.style.setProperty('--vf-h', (boxH / st.clientHeight * 100).toFixed(2) + '%');
      st.style.setProperty('--vf-top', (top / st.clientHeight * 100).toFixed(2) + '%');
      st.style.setProperty('--vf-cam', (camH / st.clientHeight * 100).toFixed(2) + '%');
      st.style.setProperty('--cam-h', (camH / boxH * 100).toFixed(2) + '%');   // 틀 안 사진 띠 비율(아래 여백 시작점)
      vfBox = { x: (st.clientWidth - boxW) / 2, y: top, w: boxW, h: boxH, r: st.clientWidth * 0.024 };
      vfPainted = false;                      // 오버레이는 촬영 화면 첫 프레임에 그린다(자산·카드가 다 준비된 뒤)
      return;
    }
    vfBox = null;
    st.classList.remove('vf');
    const pct = (st.clientWidth / (c.sw / c.sh)) / st.clientHeight * 100;
    st.style.setProperty('--cam-h', Math.min(100, Math.max(30, pct)).toFixed(2) + '%');
  }

  // 카드 앞면 — 기획: 촬영 사진에 **6번의 복구된 자연(강물 제외)과 달수**만 AR 합성한다.
  // 강물·수면은 넣지 않는다(화면 연출 전용). 인물 얼굴·상반신은 절대 가리지 않는다.
  // 카드 앞면 = 사진 + 아래 자연·달수 합성. 인쇄(composeCard)와 촬영 화면의 뷰파인더 오버레이가 **같은 함수**를 쓴다 —
  // 그래야 관람객이 화면에서 본 것이 그대로 인쇄된다. opts.photo=false 면 사진 자리를 비워(투명) 라이브 영상 위에 겹친다.
  function drawCardLayers(ctx, W, H, opts) {
    const o = opts || {}, src = frameSource;
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    if (o.photo !== false && src === mock) drawMock(performance.now());
    // ① 사진. cover 로 꽉 채우면 가로 웹캠을 세로 카드에 맞추느라 인물이 2.8배로 확대된다 —
    //    photoZoom 으로 더 넓게 잘라 위쪽 띠로 앉히고, 남는 아래는 장면이 채운다.
    const c = photoCrop(sw, sh, W, H, cfg.card.photoZoom);
    if (c.dh < H) {                      // 사진 아래 여백 — 하늘빛에서 풀빛으로
      const bg = ctx.createLinearGradient(0, c.dh * 0.92, 0, H);
      bg.addColorStop(0, '#dbeaf3'); bg.addColorStop(0.45, '#cfe3d6'); bg.addColorStop(1, '#b9d9b6');
      ctx.fillStyle = bg;
      // 오버레이일 때는 사진 자리를 비워 둔다(라이브 영상이 그 밑에 있다)
      if (o.photo === false) ctx.fillRect(0, c.dh - H * 0.055, W, H - c.dh + H * 0.055); else ctx.fillRect(0, 0, W, H);
    }
    if (o.photo !== false) {
      ctx.save();
      if (cfg.camera.mirror && src !== mock) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(src, c.sx, c.sy, c.sw, c.sh, c.dx, c.dy, c.dw, c.dh);
      ctx.restore();
    }
    if (c.dh < H) {                      // 사진 아래 경계를 부드럽게 — 딱 잘린 선이면 합성이 티난다
      const fade = ctx.createLinearGradient(0, c.dh - H * 0.055, 0, c.dh);
      fade.addColorStop(0, 'rgba(219,234,243,0)'); fade.addColorStop(1, 'rgba(219,234,243,1)');
      ctx.fillStyle = fade; ctx.fillRect(0, c.dh - H * 0.055, W, H * 0.055 + 1);
    }

    // 자연은 사진이 끝나는 자리부터 올린다. 사진이 짧아지면 그만큼 위로 올라와 여백을 채운다.
    const top = Math.min(cfg.card.artTop == null ? 0.56 : cfg.card.artTop, Math.max(0.42, c.dh / H - 0.06));

    // ② 복구된 자연 — 인물을 피해 하단 양옆에. 아래로 갈수록(카메라에 가까울수록) 크게 그려 원근을 맞춘다.
    const n = Math.max(0, Math.min(8, cfg.card.natureCount == null ? 6 : cfg.card.natureCount));
    const slots = natureCardSlots(n, top, cfg.card.orientation === 'portrait' ? CARD_NATURE_ZONES_PORTRAIT : undefined);
    const base = H * (cfg.card.natureSize == null ? 0.16 : cfg.card.natureSize);
    slots.forEach((s, i) => {
      const kind = ART_NATURE_CARD_ORDER[i % ART_NATURE_CARD_ORDER.length];
      const flying = kind === 'dragonfly';                    // 나는 것은 바닥에 붙이지 않는다
      const depth = (s.y - top) / Math.max(0.001, 1 - top);   // 0=먼 곳, 1=가까운 곳
      const size = base * (0.72 + depth * 0.5);
      const x = s.x * W, y = s.y * H - (flying ? size * 0.55 : 0);
      ctx.save();
      if (!flying) {  // 접지 그림자 — 사진 위에 떠 있지 않고 바닥에 서 있게
        ctx.globalAlpha = 0.2; ctx.fillStyle = '#26333d';
        ctx.beginPath(); ctx.ellipse(x, y + size * 0.34, size * 0.30, size * 0.085, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      // 카드에는 강물이 없으므로 물고기를 넣지 않는다 — 물가 식물만 (실사가 있으면 그것, 없으면 벡터)
      const sprite = A.plant.length ? A.plant[i % A.plant.length] : null;
      if (sprite) ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      else ART_SPRITES[kind](ctx, x, y, size / 80);
      ctx.restore();
    });

    // ②-a 나무 — 화면의 '복구된 자연'과 카드를 같은 세계로 묶어준다.
    //      인물(가운데)과 달수(우하단)를 피해 양 가장자리에만 세운다.
    (cfg.card.trees || []).forEach((t) => {
      const size = H * (t.s == null ? 0.30 : t.s);
      ctx.save();
      ctx.globalAlpha = t.a == null ? 0.95 : t.a;
      // 화면과 같은 나무 자산을 쓴다. 여기만 벡터로 두면 **한 장에 두 화풍이 섞여 인쇄된다**
      // (물가 식물은 실사 컷아웃인데 나무만 납작한 벡터였다 — 실제로 그렇게 뽑혔다).
      if (A.tree.length) {
        const im = A.tree[(t.i == null ? (cfg.card.trees || []).indexOf(t) : t.i) % A.tree.length];
        drawTreeAsset(ctx, im, t.x * W, t.y * H, size);
      } else ART_TREES[t.kind || 'round'](ctx, t.x * W, t.y * H, size / 160);
      ctx.restore();
    });

    // ②-b 하단 전경 풀 — 자연이 '회복된' 느낌을 주는 가장 싼 방법. 인물 발치를 감싼다.
    if (cfg.card.foreground !== false) {
      ctx.save();
      const gy = H * 0.975;
      for (const [gx, gw, gh, alpha] of [
        [-0.02, 0.17, 0.095, 0.62], [0.13, 0.15, 0.070, 0.52], [0.27, 0.16, 0.088, 0.58],
        [0.42, 0.15, 0.062, 0.48], [0.56, 0.16, 0.082, 0.55], [0.71, 0.15, 0.068, 0.5], [0.85, 0.18, 0.092, 0.6]]) {
        ctx.globalAlpha = alpha; ctx.fillStyle = '#2f6e3a';
        ctx.beginPath();
        for (let b = 0; b < 9; b++) {   // 풀 포기 — 아래는 붙고 위로 갈수록 벌어진다
          const bx = (gx + gw * (b / 8)) * W, tipx = bx + (b - 4) * W * 0.006;
          ctx.moveTo(bx, gy + H * 0.05);
          ctx.quadraticCurveTo(bx + (b - 4) * W * 0.003, gy - H * gh * 0.5, tipx, gy - H * gh);
          ctx.lineTo(bx + W * 0.008, gy + H * 0.05);
        }
        ctx.fill();
      }
      ctx.restore();
    }

    // ③ 달수 — 옷 입은 포즈, 접지 그림자 포함
    const d = A.float || A.front;
    if (d) {
      const p = dalsuPlacement(W, H, d.width, d.height, cfg.card.dalsuScale, cfg.card.dalsuAnchor);
      // 카드는 **항상 원본 벡터 PNG**로 그린다 — 인쇄 화질(키잉한 프레임은 외곽이 부드럽고 미세 색 드리프트가 있다)과
      // "카드는 절대 깨지지 않는다" 불변식 때문. 정지 부유 포즈가 시안과 그대로 일치한다.
      drawDalsuSwim(ctx, d, p.x + p.w / 2, p.y + p.h / 2, p.h, 0, 0, false, { sprite: false });
    }

    // ④ 색감 통일 — 사진과 그림이 같은 빛 아래 있어 보이도록 아주 옅은 wash (오버레이엔 안 건다 — 영상이 뿌예진다)
    if (o.photo !== false) { ctx.fillStyle = 'rgba(120,170,190,.045)'; ctx.fillRect(0, 0, W, H); }
  }
  function composeCard() { drawCardLayers(cardCtx, card.width, card.height, { photo: true }); }

  // 뷰파인더 오버레이 — 카드와 같은 해상도로 자연·달수만 그려 라이브 영상 위에 겹친다.
  function paintViewfinderOverlay() {
    const cv = document.getElementById('vf-overlay'); if (!cv || !frameSource) return;
    cv.width = card.width; cv.height = card.height;
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    drawCardLayers(ctx, cv.width, cv.height, { photo: false });
  }

  // ---------- FX 캔버스 (화면 연출) ----------
  // 물길 그리기.
  //   progress 1  → 완성된 강 전체
  //   progress<1  → 상류(u=0)에서 하류로 뻗어나가는 중. 지류 합류점을 차례로 받으며 흐른다.
  //                 (중앙에서 양쪽으로 뻗으면 지류가 S자 상단 곡선을 가로질러야 해서 합쳐지는 느낌이 안 난다)
  //   style=water → 수면 텍스처가 흐름 방향으로 스크롤하는 실제 강물, cartoon → 기존 벡터 물길
  function drawRiver(ctx, W, H, progress, widthRatio, box, flowScroll) {
    if (progress <= 0) return;
    const p = Math.min(1, progress);
    const RV = cfg.river || {};
    const width = H * widthRatio;
    // 구간 수는 '그려지는 길이'에 비례해야 한다. 진행도 10% 짜리 짧은 물길에 200구간을 쓰면
    // 이음매 품질은 그대로인데 비용만 10배다 — 물길이 자라는 구간에서 프레임이 튀던 원인.
    // 화면 픽셀로 보는 곡선 바깥 이음매는 줌 배율만큼 커진다 → 당겨서 보는 구성이면 구간을 촘촘히 한다.
    // bandPolygon 의 t 는 정규화 진행도라, 구간 수를 바꿔도 같은 곡선의 더 촘촘한 근사일 뿐이다(폭이 안 변한다).
    const segFull = SHELL_Z > 1.02 ? RIVER_SEG_Z : RIVER_SEG;
    const seg = box ? 96 : (p < 0.999 ? Math.max(24, Math.round(segFull * p)) : segFull);
    const pts = samplesRange(seg, 0, p, box).map(([x, y]) => [x * W, y * H]);
    if (RV.style === 'cartoon') {
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const layer of ART_RIVER) {
        ctx.lineWidth = H * widthRatio * layer.w; ctx.strokeStyle = layer.color;
        ctx.setLineDash(layer.dash ? layer.dash.map((d) => d * H / 1000) : []); ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.restore();
      return;
    }
    // 성장 중에는 모양이 매 프레임 바뀌어 캐시를 못 쓴다. 이 구간은 4초로 짧고 화면이 바쁘므로
    // blur·그림자 없이 그려 프레임을 지키고, 물길이 완성되는 순간 고품질 캐시로 넘어간다.
    if (box || p < 0.999) {
      drawFlowingRiver(ctx, pts, width, A.water, flowScroll || 0,
        Object.assign(riverOpts(H), { quality: box ? 'high' : 'low', noClip: !box, uSpan: box ? 1 : p }));
      return;
    }
    // 완성된 물길: 정적 레이어는 구워 둔 것을 붙이고, 실제로 움직이는 수면 결·반사광만 매 프레임 그린다.
    const sh = riverShell(W, H, pts, width);
    if (!sh) {   // 캐시를 못 구웠으면(메모리 등) 저품질로라도 계속 그린다 — 무인 키오스크는 멈추면 안 된다
      drawFlowingRiver(ctx, pts, width, A.water, flowScroll || 0,
        Object.assign(riverOpts(H), { quality: 'low', noClip: true }));
      return;
    }
    const mv = riverOpts(H); mv.quality = 'high';
    // 무대 단위 크기를 명시해 붙인다 — 캐시가 SHELL_Z 배로 구워져 있어도 화면에서는 항상 같은 크기다.
    const blit = (cv) => ctx.drawImage(cv, sh.x, sh.y, sh.w, sh.h);
    // (여벌 캔버스 + destination-in 마스크도 시도했으나 프레임당 1.8초로 훨씬 느렸다 — 클립을 그대로 쓴다)
    blit(sh.under);                                    // 바깥 그림자
    drawFlowingRiver(ctx, pts, width, A.water, flowScroll || 0, Object.assign({ only: ['water'], noClip: true }, mv));
    drawFlowingRiver(ctx, pts, width, A.water, flowScroll || 0, Object.assign({ only: ['glare'], noClip: true }, mv));
    blit(sh.over);                                     // 수심·포말·물가선
    ctx.save(); ctx.globalCompositeOperation = 'destination-over'; blit(sh.bank); ctx.restore();
  }

  // ---------- 물길 정적 레이어 캐시 ----------
  // 그림자·수심·포말·둑은 '흐름'이 아니라 '모양'만 따른다. 물길이 완성되면 모양은 더 이상 바뀌지 않는다.
  // 그런데 이 레이어들은 전부 blur/shadowBlur 라서, 매 프레임 1080×1920 전체에 걸면 GPU 없는 PC에서 끊긴다.
  // → 완성 시점에 한 번만 구워 캔버스 4장에 담아 두고 이후에는 붙이기만 한다. 화질은 그대로, 비용만 사라진다.
  // 완성 물길의 고정 구간 수. 캐시와 매 프레임 그리기가 같은 기하를 써야 한다.
  // 클립을 쓰지 않으므로 이 값이 곧 곡선 바깥의 이음매 크기를 정한다 — 촘촘할수록 이음매가 사라진다.
  const RIVER_SEG = 260;
  const RIVER_SEG_Z = 520;      // 당겨서 볼 때. 이음매는 (반폭 × 구간당 꺾임각)이라 구간 수에 반비례한다.
  let shell = null, shellFail = false;
  let tribShell = null;   // 다 자란 지류 4줄기 (이후엔 알파만 변한다)
  function riverOpts(H) {
    const RV = cfg.river || {};
    return { tilePx: (RV.tilePx || 460) * (H / 1920), minTaper: RV.minTaper, pool: RV.pool || null };
  }
  function riverShell(W, H, pts, width) {
    const z = SHELL_Z;
    const key = W + 'x' + H + '|' + width.toFixed(1) + '|z' + z.toFixed(2);
    if (shell && shell.key === key) return shell;
    if (shellFail) return null;
    const t0 = performance.now();
    // 화면 전체(1080×1920)를 통째로 붙이면 프레임마다 800만 픽셀씩 합성한다.
    // 물길이 실제로 차지하는 사각형만 잘라 두면 붙이는 양이 1/3로 준다 — 화질은 완전히 동일하다.
    const m = width * 0.6;                              // 그림자·둑이 띠 밖으로 번지는 여유
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m));
    x1 = Math.min(W, Math.ceil(x1 + m)); y1 = Math.min(H, Math.ceil(y1 + m));
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    // 캔버스는 z 배 픽셀로, 그리기는 무대 단위 그대로. 붙일 때 무대 크기를 명시하므로 z 가 무엇이든 화면 결과는 같고
    // 화질만 z 배가 된다. 당겨서 볼 때 둑선·포말이 뿌예지는 걸 막는 유일한 방법이다.
    const setup = (c) => c.setTransform(z, 0, 0, z, -x0 * z, -y0 * z);
    const bake = (only) => {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(bw * z); cv.height = Math.ceil(bh * z);
      const c = cv.getContext('2d'); setup(c);
      const o = riverOpts(H); o.quality = 'high'; o.only = only;
      drawFlowingRiver(c, pts, width, A.water, 0, o);
      return cv;
    };
    // 수심은 반사광 아래가 맞지만 붙이기 한 장을 아끼려고 포말과 묶었다.
    // 수심은 물골을 어둡게 깔 뿐이고 반사광은 'lighter' 합성이라, 순서가 바뀌어도 눈에 보이는 차이가 없다.
    // 물길 머리는 띠가 뚝 잘린 단면이라 '어디선가 시작된 강'이 아니라 '잘린 리본'으로 보인다.
    // 지류가 사라진 뒤(SWIM)에도 남을 발원 샘의 물보라를 구워 얹어 그 단면을 덮는다. 매 프레임 비용 0.
    const spring = (cv) => {
      const c = cv.getContext('2d'); setup(c);
      const hx = pts[0][0], hy = pts[0][1];
      const r = width * widthAt(0, riverOpts(H).minTaper) * 0.75;
      // '잘린 리본'로 보이지 않게 물길 머리를 가려 주는 광채. 다만 수면을 잔잔하게 바꾼 뒤로는
      // 이 흰 덩어리가 혼자 튄다 — 전체적으로 낮추고, 당겨서 볼 때는 더 낮춘다.
      const sa = z > 1.02 ? 0.42 : 0.62;
      const g = c.createRadialGradient(hx, hy, r * 0.1, hx, hy, r);
      g.addColorStop(0, `rgba(255,255,255,${(0.85 * sa).toFixed(2)})`);
      g.addColorStop(0.5, `rgba(226,244,252,${(0.45 * sa).toFixed(2)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.save(); c.fillStyle = g;
      c.beginPath(); c.ellipse(hx, hy, r, r * 0.62, 0, 0, Math.PI * 2); c.fill();
      c.restore();
      return cv;
    };
    try {
      shell = { key, x: x0, y: y0, w: bw, h: bh, z,
        // 밑층에 '정지한 수면'을 함께 구워 둔다. 곡선 바깥에서 조각 사이에 1px 틈이 나도
        // 단색 파랑이 아니라 물결이 비쳐 이음매가 눈에 띄지 않는다. 매 프레임 비용은 0.
        under: bake(['shadow', 'water']), over: spring(bake(['depth', 'foam', 'edge'])), bank: bake(['bank']) };
    } catch (e) {   // 캔버스 할당 실패(메모리) — 저품질로 계속 간다
      shell = null; shellFail = true;
      log('ERROR', '물길 캐시 생성 실패 — 저품질로 계속', { error: String(e), z, w: W, h: H });
      return null;
    }
    log('INFO', '물길 정적 레이어 캐시 생성',
      { w: W, h: H, box: bw + 'x' + bh, z, px: Math.ceil(bw * z) + 'x' + Math.ceil(bh * z),
        mb: +((bw * z * bh * z * 4 * 3) / 1048576).toFixed(0), ms: +(performance.now() - t0).toFixed(0) });
    return shell;
  }

  // ---------- 물길 띠 클립 경로 ----------
  // 헤엄 연출(항적·물 파임·물마루·물보라)이 둑 밖으로 새면 잔디 위에 흰 도형이 찍힌다.
  // 물길과 **같은 기하**(bandPolygon)로 만든 경로 하나를 캐시해 두고 전부 여기에 잘라 넣는다.
  let bandClip = null;
  function riverBandPath(W, H) {
    const width = H * ((cfg.river && cfg.river.widthRatio) || 0.21);
    const key = W + 'x' + H + '|' + width.toFixed(1);
    if (bandClip && bandClip.key === key) return bandClip.path;
    const pts = samplesRange(RIVER_SEG, 0, 1, null).map(([x, y]) => [x * W, y * H]);
    const band = bandPolygon(pts, width, riverOpts(H).minTaper, null, 1, riverOpts(H).pool);
    if (!band.left.length) return null;
    const path = new Path2D();
    path.moveTo(band.left[0][0], band.left[0][1]);
    for (let i = 1; i < band.left.length; i++) path.lineTo(band.left[i][0], band.left[i][1]);
    for (let i = band.right.length - 1; i >= 0; i--) path.lineTo(band.right[i][0], band.right[i][1]);
    path.closePath();
    bandClip = { key, path };
    return path;
  }

  // count: 실수(예 3.4) → 3개는 완전, 4번째는 등장 중(탄성 스케일). sway: 살랑임 여부
  // avoid: {x, y, r} — 이 반경 안의 물고기는 그리지 않는다 (달수를 가리면 안 된다)
  function drawNature(ctx, W, H, count, size, sway, box, avoid) {
    const slots = natureSlotsIn(NCOUNT, (cfg.river && cfg.river.natureOffset) || 0.17, box, W / H, ((cfg.river && cfg.river.widthRatio) || 0.21) / 2 * 1.25 * (H / W), NUTO), now = performance.now();
    for (let i = 0; i < Math.min(NCOUNT, Math.ceil(count)); i++) {
      const k = Math.min(1, Math.max(0, count - i)); if (k <= 0) continue;
      const sc = k < 1 ? easeOutBack(k) : 1;
      const kind = ART_NATURE_ORDER[i % ART_NATURE_ORDER.length], onWater = kind === 'fish';
      const s = slots[i], pw = onWater ? pointIn(s.u, box) : null;
      const x = (onWater ? pw[0] : s.x) * W, y = (onWater ? pw[1] : s.y) * H;
      let alpha = Math.min(1, k * 1.5);
      if (onWater && avoid) {                    // 달수 근처의 물고기는 비켜준다
        const d = Math.hypot(x - avoid.x, y - avoid.y);
        if (d < avoid.r) alpha *= Math.max(0, (d - avoid.r * 0.45) / (avoid.r * 0.55));
        if (alpha <= 0.02) continue;
      }
      const pool = onWater ? A.fish : A.plant;
      const sprite = pool.length ? pool[i % pool.length] : null;
      const rot = sway ? Math.sin(now / 700 + i) * 0.06 : 0;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.globalAlpha = alpha;
      if (sprite) {
        // 물고기는 흐르는 방향을 보게 좌우를 맞춘다
        if (onWater) { const a = angleAt(s.u); if (Math.cos(a) < 0) ctx.scale(-1, 1); }
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      } else ART_SPRITES[kind](ctx, 0, 0, size / 80);
      ctx.restore();
      if (k >= 1 && !anim.sparkled.has(i) && sway) { anim.sparkled.add(i); particles.sparkle(x, y - size * 0.3, 6, '#fbe7a1'); sound.bloom(); }
    }
  }
  // ---------- V자 항적 ----------
  // 헤엄치는 무언가가 지나갔다는 가장 확실한 신호는 뒤에 남는 V자다.
  // 파티클 물보라만으로는 '물이 튄다'까지고, '지나갔다'가 안 된다.
  // 지나온 좌표를 짧게 기억했다가, 나이가 들수록 벌어지고 흐려지는 두 줄로 그린다.
  // 항적이 오래 남으면 물길 절반을 가로지르는 긴 선이 되어 '밧줄'로 보인다. 짧게 남기고 빨리 흩어지게 한다.
  const WAKE_LIFE = 1000;
  let wakeSeq = 0;
  function pushWake(x, y, heading, now) {
    const w = anim.wake;
    const last = w[w.length - 1];
    if (last && now - last.t < 40) return;          // 40ms 간격이면 충분히 촘촘하다
    w.push({ x, y, a: heading, t: now, n: wakeSeq++ });
    if (w.length > 60) w.shift();
  }
  // 조각마다 다른 값을 주되 프레임이 바뀌어도 같은 조각은 같은 값 — 흔들리지 않는 불규칙함
  function wakeHash(n, k) { const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); }
  function drawWakeTrail(ctx, now, H) {
    const w = anim.wake;
    while (w.length && now - w[0].t > WAKE_LIFE) w.shift();
    if (w.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1], b = w[i];
      const age = (now - b.t) / WAKE_LIFE;
      if (age >= 1) continue;
      // 나이가 들수록 벌어진다 — 이게 V자를 만든다.
      // 시작 간격이 좁으면 좌우 두 선이 겹쳐 굵은 **밧줄 한 가닥**으로 보인다(0.010 으로 뒀다가 되돌림).
      // 항적은 몸 옆구리에서 갈라져 나와야 하므로 처음부터 몸통 폭만큼 벌려 놓는다.
      const SPREAD0 = 0.016, SPREAD1 = 0.080;
      const spread = H * (SPREAD0 + age * SPREAD1);
      const alpha = (1 - age) * (1 - age) * 0.80;   // 처음엔 또렷하고 빠르게 사라진다
      const na = a.a + Math.PI / 2, nb = b.a + Math.PI / 2;
      const sa = H * (SPREAD0 + ((now - a.t) / WAKE_LIFE) * SPREAD1);
      // 실제 항적은 '어두운 골 + 흰 마루'다. 흰 선만 그으면 수면의 흰 물결 무늬에 그대로 묻힌다.
      // 다만 **끊김 없는 두 줄로 그으면 안 된다** — 물결 무늬가 촘촘한 수면 위에 균일한 굵기의 곡선이 얹히면
      // 물이 갈라진 자국이 아니라 호스 두 가닥으로 읽힌다(굵게·또렷하게 뒀다가 되돌렸다).
      // 조각을 군데군데 빼먹고 굵기·투명도·좌우 위치를 흔들어 '거품'으로 만든다.
      const hSkip = wakeHash(b.n, 1), hW = wakeHash(b.n, 2), hJit = wakeHash(b.n, 3);
      if (hSkip < 0.22) continue;                    // 다섯 조각 중 하나쯤은 비워 둔다
      const jit = (hJit - 0.5) * spread * 0.5;
      for (const layer of [
        { c: '13,52,76', w: H * 0.020, a: alpha * 0.22, o: H * 0.004 },
        { c: '255,255,255', w: H * 0.006, a: alpha * 0.62, o: 0 },
      ]) {
        ctx.lineWidth = layer.w * (1 - age * 0.45) * (0.65 + hW * 0.7);
        ctx.strokeStyle = `rgba(${layer.c},${(layer.a * (0.6 + hW * 0.5)).toFixed(3)})`;
        for (const side of [1, -1]) {
          const oa = (sa + layer.o) * side + jit, ob = (spread + layer.o) * side + jit;
          ctx.beginPath();
          ctx.moveTo(a.x + Math.cos(na) * oa, a.y + Math.sin(na) * oa);
          ctx.lineTo(b.x + Math.cos(nb) * ob, b.y + Math.sin(nb) * ob);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 진행 방향(rad) → 몸을 눕힐 각도(rad).
  // 스프라이트가 왼쪽을 보고 누워 있으므로 왼쪽으로 갈 때는 head-π, 오른쪽으로 갈 때(반전)는 head 가 기준이다.
  // 감쇠 0.62 는 급한 굽이에서 몸이 수직으로 서 버리는 걸 막는다. 크기 제한과 실제 회전이 **같은 값**을 써야
  // 굽이에서 꼬리가 둑을 넘지 않는다 — 그래서 함수로 뺐다.
  function swimTilt(head) {
    let a = Math.cos(head) < 0 ? head - Math.PI : head;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    // ★ 회전은 ±22° 안에서만. 시트는 **앞에서 본** 누운 그림이라 90° 까지 돌리면 공중제비처럼 읽힌다
    // (물길 방향을 그대로 따라가게 했다가 "수영이 막 뒤집어진다"는 지적을 받았다).
    // 그러면 세로 굽이에서 가로로 누운 몸이 강폭을 넘는데, 그건 `config.river.pool`(굽이 소)로 강 쪽을 넓혀 푼다.
    return Math.max(-0.38, Math.min(0.38, a * 0.5));
  }

  // 헤엄 위상 θ → 시트 프레임 하나를 (-w/2,-h/2,w,h) 자리에 그린다.
  // ★ 위상 규약: θ = swimP × SWIM_STROKES × 2π 를 그대로 쓴다. 시간 기반으로 따로 돌리면
  //   몸짓과 전진·물 밀기가 어긋나 허우적거려 보인다(CLAUDE.md 불변식, 테스트가 검사).
  // phase0 는 '가장 세게 차는 프레임'을 θ=π 에 맞추려고 자산 검증 단계가 측정해 넣은 값이다.
  function drawSwimFrame(ctx, theta, w, h) {
    const m = A.swimMeta, s = A.swimScale;
    const k = (((theta / (Math.PI * 2)) + (m.phase0 || 0)) % 1 + 1) % 1;
    const i = Math.min(m.frames - 1, Math.floor(k * m.frames));
    const cw = m.cellW * s, ch = m.cellH * s;
    const sx = (i % m.cols) * cw, sy = Math.floor(i / m.cols) * ch;
    // 셀 안의 '몸 상자'가 기존 단일 이미지와 정확히 같은 자리에 오도록 셀 전체를 확대해 그린다.
    const dw = w / m.body.w, dh = h / m.body.h;
    ctx.drawImage(A.swim, sx, sy, cw, ch, -w / 2 - m.body.x * dw, -h / 2 - m.body.y * dh, dw, dh);
  }

  // 달수 헤엄 — 몸통 흔들림·상하 부침·물 밀기 늘어남 + 진행 방향 회전. swimming=false면 정지 부유.
  // opt: { bank, tilt, face, clip }
  //  · tilt — 몸을 기울일 각도(rad). 호출부가 이미 감쇠·지연을 넣어 보낸다. 없으면 예전처럼 heading 을 살짝만 반영.
  //  · face — +1 원본 방향(왼쪽을 봄) / -1 좌우 반전(오른쪽을 봄). 0 을 지나는 동안 몸이 납작해지며 '방향을 트는' 그림이 된다.
  //  · clip — 물길 띠 Path2D. **물이 반응하는 그림은 전부 이 안에서만 그린다.**
  //           안 걸면 물마루·항적이 둑 밖 잔디·언덕 위에 그대로 찍혀 물이 아니라 화면 위 도형으로 보인다(실제로 그렇게 나갔다).
  function drawDalsuSwim(ctx, img, x, y, h, heading, theta, swimming, opt) {
    const o = opt || {};
    const bank = o.bank || 0;
    const w = img.width * (h / img.height);
    const pose = swimming ? swimPose(theta)
      : { roll: Math.sin(theta * 0.35) * 0.035, bob: Math.sin(theta * 0.35) * 0.5, sx: 1, sy: 1, sink: 0.5, push: 0 };
    // 시트가 이미 몸 굽이침을 담고 있으므로 절차 자세를 그대로 얹으면 **두 번 흔들린다**.
    // 단 push·sink 는 손대지 않는다 — 물 파임·뱃머리 파도·거품의 위상 규약이 거기 걸려 있다.
    const sprite = !!(A.swim && o.sprite !== false);
    const K = sprite ? 0.35 : 1;
    const roll = pose.roll * K, psx = 1 + (pose.sx - 1) * K, psy = 1 + (pose.sy - 1) * K;
    const bobPx = pose.bob * h * 0.075 * (sprite ? 0.6 : 1);
    const inWater = (fn) => { if (o.noFx) return; ctx.save(); if (o.clip) ctx.clip(o.clip); fn(); ctx.restore(); };   // noFx: 디졸브의 사라지는 쪽은 몸만
    // 수면이 몸무게에 눌려 파인다 — 어두운 웅덩이 + 그 둘레의 물마루.
    // 이게 없으면 아무리 잘 그려도 물 '위에 얹힌' 그림이 된다. 몸보다 먼저 깔아야 한다.
    if (swimming) inWater(() => {
      const dipR = w * 0.46, sink = 1 - pose.sink;
      const cy = y + bobPx + h * 0.10;
      const g = ctx.createRadialGradient(x, cy, dipR * 0.15, x, cy, dipR);
      g.addColorStop(0, `rgba(14,60,86,${(0.20 + sink * 0.14).toFixed(3)})`);
      g.addColorStop(0.62, `rgba(20,80,110,${(0.10 + sink * 0.08).toFixed(3)})`);
      g.addColorStop(1, 'rgba(20,80,110,0)');
      ctx.save();
      ctx.translate(x, cy); ctx.scale(1, 0.52); ctx.translate(-x, -cy);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, cy, dipR, 0, Math.PI * 2); ctx.fill();
      // 물마루는 **닫힌 동그라미로 그리지 않는다** — 완전한 원이 뜨는 순간 물결이 아니라 CG 링으로 읽힌다.
      // 앞쪽은 뱃머리 파도가 맡으므로 여기서는 뒤쪽 호만, 옅게.
      ctx.strokeStyle = `rgba(255,255,255,${(0.11 + pose.push * 0.10).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, h * 0.015);
      ctx.beginPath(); ctx.arc(x, cy, dipR * 0.74, heading + 0.7, heading + Math.PI * 2 - 0.7); ctx.stroke();
      // 물을 찬 자리의 거품 — 원이 아니라 뒤로 흩어지는 짧은 조각들. 위상에서 뽑아 매 프레임 흔들리지 않게 한다.
      if (pose.push > 0.25) {
        ctx.fillStyle = `rgba(255,255,255,${(0.10 + pose.push * 0.16).toFixed(3)})`;
        for (let i = 0; i < 3; i++) {
          const sp = 0.55 + i * 0.42, off = Math.sin(theta * 1.7 + i * 2.1) * dipR * 0.28;
          const bx = x - Math.cos(heading) * dipR * sp - Math.sin(heading) * off;
          const by = cy - Math.sin(heading) * dipR * sp + Math.cos(heading) * off;
          ctx.beginPath(); ctx.ellipse(bx, by, dipR * (0.20 - i * 0.04), dipR * (0.09 - i * 0.02), heading, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    });

    ctx.save();
    ctx.translate(x, y + bobPx);
    // 곡선을 돌 때 머리가 먼저 돌고 몸이 따라온다 — 호출부가 지연을 넣은 tilt 를 그대로 쓴다.
    // 굽이를 돌 때 몸을 안쪽으로 기울인다(뱅킹). 곡선인데 몸이 꼿꼿하면 레일 위를 가는 것처럼 보인다.
    ctx.rotate((o.tilt == null ? heading * 0.07 : o.tilt) + roll + bank);
    // 스프라이트는 왼쪽을 보고 누워 있다. 오른쪽으로 흐를 때 180도 돌리면 배가 하늘로 가므로 **좌우 반전**을 쓴다.
    // face 가 0 을 지나는 몇 프레임 동안 몸이 납작해지며 방향을 트는 동작이 된다 — 수달이 실제로 그렇게 돈다.
    // face 는 +1(왼쪽을 봄) 또는 -1(좌우 반전) 둘 중 하나다. 0 을 지나가며 눌리는 일이 없어야 한다.
    const fx = (o.face == null ? 1 : o.face) < 0 ? -1 : 1;
    ctx.scale(psx * fx, psy);
    // 수면 그림자 — 몸이 가라앉을수록 진하고 넓어진다
    ctx.save();
    ctx.globalAlpha = 0.08 + (1 - pose.sink) * 0.10; ctx.fillStyle = '#12506f';
    ctx.beginPath(); ctx.ellipse(0, h * 0.30, w * (0.34 + (1 - pose.sink) * 0.12), h * 0.065, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 몸은 통짜로 그린다. 길이 방향으로 잘라 굽이치게 하는 방법을 시도했다가 뺐다 —
    // 물고기 실루엣이라면 통하지만, 모자·가방까지 그려진 캐릭터 일러스트는 조각 경계가 그대로 찢겨 보인다.
    // 살아 있는 느낌은 몸을 일그러뜨려서가 아니라 **물이 반응하게** 해서 낸다(항적·물 파임·물보라).
    if (sprite) drawSwimFrame(ctx, theta, w, h);
    else ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    // 뱃머리 파도 — 진행 방향 앞쪽으로 밀리는 흰 물결
    if (swimming) inWater(() => {
      ctx.globalAlpha = 0.26 + pose.push * 0.30;
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = Math.max(1.5, h * 0.028); ctx.lineCap = 'round';
      const fx0 = x + Math.cos(heading) * w * 0.30, fy0 = y + bobPx + Math.sin(heading) * w * 0.30;
      ctx.beginPath();
      ctx.arc(fx0, fy0 + h * 0.10, w * (0.22 + pose.push * 0.06), heading - 1.15, heading + 1.15);
      ctx.stroke();
    });
    // 몸이 물에 잠긴 부분을 물빛으로 덮어 '물속에 들어가 있음'을 만든다
    if (swimming) inWater(() => {
      ctx.globalAlpha = 0.13 + (1 - pose.sink) * 0.12;
      ctx.fillStyle = 'rgba(70,150,185,1)';
      ctx.beginPath(); ctx.ellipse(x, y + bobPx + h * 0.24, w * 0.34, h * 0.11, 0, 0, Math.PI * 2); ctx.fill();
    });
  }

  // ---------- 숲 (시안 5·6컷: 물길 양옆의 숲과 언덕) ----------
  const SCENE = cfg.scene || {};
  let forest = null;
  function forestSlots() {
    if (!forest) {
      // R2 저불일치 수열이라 개수를 늘려도 **앞쪽 배치는 그대로**다(결정적 배치 불변식 유지).
      forest = scenerySlots(SCENE.treeCount == null ? 16 : SCENE.treeCount, {
        yTop: SCENE.yTop == null ? 0.30 : SCENE.yTop, minDist: SCENE.minDist == null ? 0.21 : SCENE.minDist,
      });
      // 달수가 내려가는 방향(위→아래)으로 살아나야 하므로 y 순으로 정렬한다
      forest.sort((a, b) => a.y - b.y);
    }
    return forest;
  }
  // 원경 언덕 — 물길이 '어딘가를' 흐르게 해준다. 이게 없으면 강이 흰 배경에 떠 있다.
  // 잔디 결 — 물길이 굽는 안쪽에 생기는 넓은 단색 바닥이 '색종이'로 보인다.
  // 밝기만 살짝 다른 납작한 타원을 결정적으로(R2 저불일치 수열) 흩뿌려 결을 만든다.
  // 그라데이션·blur 를 쓰지 않으므로 프레임 비용이 거의 없다.
  const MEADOW = (() => {
    const out = [], G1 = 0.7548776662, G2 = 0.5698402909;
    for (let i = 1; i <= 44; i++) {
      const h = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      out.push({ x: -0.6 + ((i * G1) % 1) * 2.2, y: ((i * G2) % 1), r: 0.055 + h * 0.085, up: i % 2 === 0 });
    }
    return out;
  })();

  // 언덕은 시차 때문에 물길보다 덜 움직인다 → 화면 좌우로 모자라지 않게 무대 밖까지 그린다(3밴드 × 55회, 비용 무시 가능)
  const HILL_WIDE = CAM.enabled && CAM.zoom > 1.02;
  const HILL_X0 = HILL_WIDE ? -0.6 : 0, HILL_X1 = HILL_WIDE ? 1.6 : 1;
  function drawHills(ctx, W, H, p) {
    if (p <= 0) return;
    const base = (SCENE.hillY == null ? 0.40 : SCENE.hillY);
    // 평평한 단색 띠 세 장이면 아무리 나무를 잘 얹어도 '2D 색종이'로 읽힌다(현장 지적).
    // 띠마다 능선은 밝게, 아래로 갈수록 어둡게 — 볕을 받은 둥근 언덕이 되도록 세로 그라데이션을 깐다.
    // 그라데이션은 도형 하나당 한 번뿐이라 비용이 사실상 0이다(blur 와 다르다).
    const bands = [
      { y: base, amp: 0.045, k: 1.0, top: [176, 208, 186], bot: [126, 172, 150], a: 0.62, depth: 0.06 },
      { y: base + 0.055, amp: 0.055, k: 1.6, top: [150, 196, 156], bot: [96, 152, 112], a: 0.78, depth: 0.10 },
      { y: base + 0.135, amp: 0.05, k: 2.4, top: [168, 208, 156], bot: [104, 158, 112], a: 0.74, depth: 0.55 },
    ];
    const rgba = (c, al) => `rgba(${c[0]},${c[1]},${c[2]},${al})`;
    ctx.save(); ctx.globalAlpha = Math.min(1, p * 1.4);
    for (const b of bands) {
      const pts = [];
      for (let x = HILL_X0; x <= HILL_X1 + 1e-4; x += 0.02) {
        pts.push([x, b.y + Math.sin(x * Math.PI * 2 * b.k + b.k) * b.amp + Math.sin(x * Math.PI * 6.3 + b.k * 2) * b.amp * 0.3]);
      }
      const yTop = Math.min(...pts.map((q) => q[1]));
      ctx.beginPath(); ctx.moveTo(HILL_X0 * W, H);
      for (const [x, y] of pts) ctx.lineTo(x * W, y * H);
      ctx.lineTo(HILL_X1 * W, H); ctx.closePath();
      const g = ctx.createLinearGradient(0, yTop * H, 0, (yTop + b.depth) * H);
      g.addColorStop(0, rgba(b.top, b.a));
      g.addColorStop(1, rgba(b.bot, b.a));
      ctx.fillStyle = g; ctx.fill();
      // 능선 하이라이트 — 볕이 닿는 위쪽 모서리. 이 한 줄이 '접힌 종이'를 '둥근 언덕'으로 바꾼다.
      ctx.save();
      ctx.strokeStyle = rgba([226, 240, 214], b.a * 0.42);
      ctx.lineWidth = Math.max(1, H * 0.004);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.stroke();
      ctx.restore();
    }
    // 바닥 결 — 가장 가까운 밴드(=넓은 잔디)에만. 가로로 납작하게 눌러 풀밭처럼 보이게 한다.
    const gTop = base + 0.14, gBot = 1.06;
    ctx.save();
    for (const q of MEADOW) {
      const y = gTop + q.y * (gBot - gTop);
      ctx.fillStyle = q.up ? 'rgba(202,228,180,.16)' : 'rgba(110,158,112,.13)';
      ctx.beginPath();
      ctx.ellipse(q.x * W, y * H, q.r * W, q.r * W * 0.30, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }
  // 나무 자산을 '상자 안에 맞춰' 넣는다. 높이만 맞추면 가로로 넓은 덤불이 폭 1.8배로 그려져
  // 화면·카드를 혼자 덮는다(실제로 그랬다). 밑동이 (x, y)에 닿게 그린다.
  function drawTreeAsset(ctx, im, x, y, size, wide) {
    const bw = size * (wide == null ? 1.25 : wide), bh = size * 1.15;
    const k = Math.min(bw / im.width, bh / im.height);
    const tw = im.width * k, th = im.height * k;
    ctx.drawImage(im, x - tw / 2, y - th, tw, th);
  }

  // 나무 — 자연 회복(6컷)에 맞춰 하나씩 자라난다. progress 는 0~1.
  function drawForest(ctx, W, H, progress) {
    if (progress <= 0) return;
    const slots = forestSlots(), n = slots.length;
    const base = H * (SCENE.treeSize == null ? 0.115 : SCENE.treeSize);
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const k = Math.min(1, Math.max(0, progress * n - i * 0.75));   // 순차 등장
      if (k <= 0) continue;
      const grow = easeOutBack(Math.min(1, k));
      const size = base * (0.55 + s.depth * 0.85) * grow;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.4) * (0.55 + s.depth * 0.45);   // 멀수록 흐리게(공기원근)
      if (A.tree.length) drawTreeAsset(ctx, A.tree[i % A.tree.length], s.x * W, s.y * H, size);
      else ART_TREES[ART_TREE_ORDER[i % ART_TREE_ORDER.length]](ctx, s.x * W, s.y * H, size / 160);
      ctx.restore();
    }
  }

  // ---------- 성능: 프레임 시간을 재서 느리면 스스로 단계적으로 낮춘다 ----------
  // 현장 PC가 GPU 없이 소프트웨어 렌더링(SwiftShader)으로 돌면 물 연출이 끊긴다.
  // 개발 PC에서는 재현되지 않을 수 있으므로, 앱이 스스로 재고 스스로 내려가야 한다.
  // **해상도는 절대 낮추지 않는다** — 렌더 배율을 줄였더니 픽셀이 뭉개져 화질이 무너졌다.
  // 완성된 물길은 이미 캐시라 공짜이므로, 남은 조절 대상은 '성장 구간'과 '지류'의 구간 수뿐이다.
  // 구간 수는 곡선을 몇 조각으로 쪼개 그리느냐일 뿐이라 줄여도 해상도·선명도는 그대로다.
  const PERF_STEPS = [
    { level: 'high', seg: 200, trib: 56, label: '기본' },
    { level: 'high', seg: 130, trib: 40, label: '곡선 구간 축소' },
    { level: 'low',  seg: 90,  trib: 28, label: '성장 구간 단순화' },
  ];
  const PERF = {
    mode: (cfg.river && cfg.river.quality) || 'auto',   // auto | high | low
    step: 0, frames: 0, sum: 0, sq: 0, late: 0, worst: 0, since: performance.now(), reported: 0,
  };
  if (PERF.mode === 'low') PERF.step = 2;
  const perfNow = () => PERF_STEPS[PERF.step];
  const segMain = () => perfNow().seg;
  const segTrib = () => perfNow().trib;

  function perfTick(frameMs) {
    PERF.frames++; PERF.sum += frameMs; if (frameMs > PERF.worst) PERF.worst = frameMs;
    PERF.sq += frameMs * frameMs;                    // 흔들림(표준편차)용
    if (frameMs > 20) PERF.late++;                   // 60fps 를 놓친 프레임 수 — '부드럽지 않다'의 실체
    // 프레임 수 하한을 25로 두면 **가장 느릴 때 로그가 침묵한다**(6초 동안 25프레임도 못 그리면 보고가 없다).
    // 진단이 제일 필요한 순간이므로 하한은 낮게 잡는다.
    if (performance.now() - PERF.since < 1500 || PERF.frames < 6) return;
    const avg = PERF.sum / PERF.frames;
    // 28ms(=36fps) 아래로 떨어지면 눈에 띄게 끊긴다. 아직 내려갈 단계가 남아 있으면 한 칸 내린다.
    if (PERF.mode === 'auto' && avg > 28 && PERF.step < PERF_STEPS.length - 1) {
      PERF.step++;
      const st = perfNow();
      log('WARN', `성능 부족 — 물 연출 ${PERF.step}단계로 낮춤 (${st.label})`,
        Object.assign({ frameAvgMs: +avg.toFixed(1), fps: +(1000 / avg).toFixed(0) }, perfBreakdown(PERF.frames)));
    } else if (BENCH || PERF.reported < 2) {
      PERF.reported++;
      log('INFO', '렌더 성능', Object.assign({ frameAvgMs: +avg.toFixed(1), fps: +(1000 / avg).toFixed(0),
        worstMs: +PERF.worst.toFixed(0),   // 끊김은 평균이 아니라 최악 프레임으로 느껴진다
        // 부드러움은 '평균'이 아니라 '고르기'다. 흔들림이 크면 60fps 라도 덜컹거린다.
        흔들림: +Math.sqrt(Math.max(0, PERF.sq / PERF.frames - avg * avg)).toFixed(1),
        놓친프레임: +(PERF.late / PERF.frames * 100).toFixed(0) + '%',
        step: PERF.step, level: perfNow().level, state: flow.state }, perfBreakdown(PERF.frames)));
    }
    PERF.frames = 0; PERF.sum = 0; PERF.sq = 0; PERF.late = 0; PERF.worst = 0; PERF.since = performance.now();
  }

  // 구간별 소요 — 어디가 느린지 추측하지 않고 로그로 확인한다(현장 PC 진단용)
  const SECT = {};
  const tick = (k, t0) => { SECT[k] = (SECT[k] || 0) + (performance.now() - t0); };
  function perfBreakdown(frames) {
    const out = {};
    for (const k of Object.keys(SECT)) { const v = SECT[k] / frames; if (v >= 0.15) out[k] = +v.toFixed(1); SECT[k] = 0; }
    return out;
  }

  let lastFrame = performance.now();
  // ---------- 카메라 ----------
  // 무대 픽셀 p → 화면: screen = (p - 중심)*z + 화면중앙.
  // par(시차 계수) 1 = 물길과 같은 지면, 0.4 = 원경 언덕(덜 움직여야 깊이가 난다).
  // ⚠ 변수명은 z 다. sc/scale 로 쓰면 storyboard.test.js 의 '축소 배율 금지' 회귀 가드에 걸린다.
  function camApply(ctx, W, H, par) {
    const c = anim.cam, k = par == null ? 1 : par;
    const z = 1 + (c.zoom - 1) * k;
    // 중심도 줌과 같은 비율로 화면 중앙에서 벗어난다 → z=1 이면 정확히 항등변환이 된다.
    // (중심만 따로 두면 줌이 1 로 돌아왔을 때 화면 전체가 옆으로 밀린다)
    const cx = 0.5 + (c.x - 0.5) * c.k * k, cy = 0.5 + (c.y - 0.5) * c.k * k;
    const h = 0.5 / z;                                   // 무대 밖이 보이지 않게
    const qx = Math.min(1 - h, Math.max(h, cx)), qy = Math.min(1 - h, Math.max(h, cy));
    // 평행이동은 정수로 스냅한다. 안 하면 구워 둔 레이어를 붙일 때 부분픽셀 리샘플링이 걸려
    // 1:1 무손실 전제가 깨지고 프레임마다 미세하게 흔들린다(배율은 스냅하지 않는다 — 계단현상).
    ctx.setTransform(z, 0, 0, z, Math.round(W / 2 - qx * W * z), Math.round(H / 2 - qy * H * z));
  }
  const camReset = (ctx) => ctx.setTransform(1, 0, 0, 1, 0, 0);

  // ---------- 4대 목표 성과 한 줄 ----------
  // 기획 목적: 어린이가 "왜 이 4가지를 해야 하는지"를 보게 하는 것.
  // 달수가 지나가며 **화면에 실제로 나타나는 것**(물길 → 물고기 → 풀·꽃 → 숲)과 목표를 짝지어
  // 그 순간에 한 줄씩 띄운다. 문구·시점은 전부 config.screen.goalPayoff 에서 온다.
  const PAYOFF = (cfg.screen && cfg.screen.goalPayoff) || [];
  let payoffIdx = -2;
  function setPayoff(p) {
    const el = $('story-goal');
    if (!el) return;
    let idx = -1;
    if (p != null) for (let i = 0; i < PAYOFF.length; i++) if (p >= PAYOFF[i].at) idx = i;
    if (idx === payoffIdx) return;
    payoffIdx = idx;
    if (idx < 0) { el.classList.remove('on'); return; }
    const g = (cfg.goals || []).find((x) => x.key === PAYOFF[idx].key) || {};
    $('story-goal-text').textContent = PAYOFF[idx].text;
    $('story-goal-dot').style.background = g.color || '#63c3e2';
    el.classList.remove('on');
    void el.offsetWidth;                 // 애니메이션을 다시 태우려면 리플로우가 필요하다
    el.classList.add('on');
    sound.bloom();
  }

  function camTick(rawDt) {
    const c = anim.cam, st = flow.state;
    const live = CAM.enabled && (st === 'SWIM' || st === 'COUNTDOWN' || st === 'CAPTURE');
    if (!live) { c.zoom = 1; c.k = 0; c.x = c.tx = 0.5; c.y = c.ty = 0.5; if (st !== 'COUNTDOWN' && st !== 'CAPTURE') c.hold = 1; return; }
    if (st === 'SWIM') c.hold = swimCamera(anim.swimP, CAM).zoom;
    c.zoom = 1 + (c.hold - 1) * (1 - anim.camOut);
    c.k = (c.zoom - 1) / Math.max(1e-6, CAM.zoom - 1);
    // 카메라맨은 피사체를 리드한다 — 달수보다 조금 앞(하류)을 보고, 달수를 화면 중앙보다 위에 둔다.
    const u = st === 'SWIM' ? Math.max(0, anim.swimU) : ARRIVE_U;
    const [lx, ly] = pointAt(Math.min(1, u + CAM.lead));
    c.tx = lx; c.ty = ly + CAM.biasY;
    // ★ ms() 필수 — 벽시계로 두면 스모크(기본 0.04배)에서 카메라가 목표를 못 따라가 엉뚱한 스냅샷이 찍힌다.
    // 스무딩이 없으면 달수가 화면에 못 박히고 세계가 스트로크마다(6초에 5번) 덜컹거린다.
    const a = Math.min(1, (rawDt || 16) / Math.max(1, ms(CAM.followMs)));
    c.x += (c.tx - c.x) * a; c.y += (c.ty - c.y) * a;
  }

  // ⚠ 렌더 루프에서 예외가 한 번이라도 새면 끝의 requestAnimationFrame 이 실행되지 않아 **화면이 영원히 멈춘다**
  //   (무인 키오스크 최악). 본체를 감싸고, 무슨 일이 있어도 다음 프레임을 예약한다. 같은 오류는 1회만 로그.
  let fxErrLast = '';
  function fxLoop() {
    try { fxFrame(); }
    catch (e) {
      const m = String(e && e.message || e);
      if (m !== fxErrLast) { fxErrLast = m; log('ERROR', '렌더 루프 예외 — 다음 프레임 계속', { error: String(e && e.stack || e) }); }
      try { camReset(fxCtx); } catch (x) { /* noop */ }
    }
    requestAnimationFrame(fxLoop);
  }
  function fxFrame() {
    const now = performance.now(), rawDt = now - lastFrame;
    // 애니메이션은 큰 dt 로 튀면 안 되므로 0.05초로 자르지만, 성능 측정은 자르지 않은 실제 간격을 쓴다.
    const dt = Math.min(0.05, rawDt / 1000); lastFrame = now;
    // 흐름 거리를 dt 로 누적하면 프레임 간격이 흔들리는 만큼 물결도 흔들린다.
    // 절대 시간의 함수로 두면 프레임이 늦게 와도 물결 위치는 정확히 그 시각의 값이라 고르게 흐른다.
    anim.flow = (now - anim.t0) / 1000 * ((cfg.river && cfg.river.flowPxPerSec) || 95);

    const W = fx.clientWidth, H = fx.clientHeight;
    if (fx.width !== W || fx.height !== H) { fx.width = W; fx.height = H; }  // 항상 1:1 픽셀 — 화질 손실 없음
    camReset(fxCtx);                       // 지우기는 반드시 항등변환에서 (카메라가 남아 있으면 가장자리가 안 지워진다)
    fxCtx.clearRect(0, 0, W, H);
    camTick(rawDt);
    if (anim.mergeFlash > 0) anim.mergeFlash = Math.max(0, anim.mergeFlash - dt * 2.2);
    const st = flow.state;
    // 물길 정적 캐시는 굽는 데 ~100ms 가 든다. 완성되는 순간에 구우면 하필 가장 눈에 띄는 프레임이 튄다.
    // 완성된 물길의 기하는 시작부터 정해져 있으므로, 아무것도 움직이지 않는 대기 화면에서 미리 구워 둔다.
    if (!shell && !shellFail && A.water && W > 0 && H > 0 && (st === 'IDLE' || st === 'GUIDE')) {
      const full = samplesRange(SHELL_Z > 1.02 ? RIVER_SEG_Z : RIVER_SEG, 0, 1, null).map(([x, y]) => [x * W, y * H]);
      riverShell(W, H, full, H * ((cfg.river && cfg.river.widthRatio) || 0.105));
    }
    if ((st === 'IDLE' || st === 'GUIDE') && Math.random() < dt * 1.5) particles.ambient(W, H); // 배경 방울 떠오름
    if (st === 'RIVER' && anim.riverProgress > 0 && anim.riverProgress < 1 && Math.random() < 0.6) { const [hx, hy] = pointAt(anim.riverProgress); particles.sparkle(hx * W, hy * H, 1, '#ffffff'); }
    const onCam = st === 'COUNTDOWN' || st === 'CAPTURE';
    if (SMOKE && frameSource === mock && onCam) drawMock(now);   // 미리보기 스트림용
    const fading = onCam && !AR_ON_CAMERA && anim.arFade > 0.01; // 촬영 화면으로 넘어가는 동안(뷰파인더면 옅게 계속)
    // 언덕과 숲 — 물길보다 먼저(뒤에) 그린다. 언덕은 물길이 완성되며, 나무는 자연 회복 단계에 자란다.
    if (st === 'RIVER' || st === 'NATURE' || st === 'SWIM' || fading) {
      const hp = st === 'RIVER' ? anim.riverProgress : 1;
      // 나무도 달수가 내려간 만큼만 살아난다 (지나온 자리에 생명이 번진다)
      const tp = (st === 'RIVER' || st === 'NATURE') ? 0 : anim.life;
      const t0 = performance.now();
      fxCtx.save();
      if (fading) fxCtx.globalAlpha = anim.arFade;
      camApply(fxCtx, W, H, CAM.hillParallax);   // 원경은 덜 움직인다 — 이게 깊이를 만든다
      drawHills(fxCtx, W, H, hp);
      camApply(fxCtx, W, H, 1);                  // 숲은 물길과 같은 지면
      drawForest(fxCtx, W, H, tp);
      fxCtx.restore();
      tick('숲언덕', t0);
    }

    // 지류 4줄기 — 합류 전에는 이것만, 합류 후에는 본류에 흡수되며 사라진다
    if ((st === 'RIVER' || st === 'NATURE') && anim.tribFade > 0.01 && tribs.length) {
      const t0 = performance.now();
      const tw = H * ((cfg.river && cfg.river.tributaryWidthRatio) || 0.032);
      const topt = (q) => ({ tilePx: 340 * (H / 1920),
        minTaper: (cfg.river && cfg.river.tributaryMinTaper) || 0.62,
        endTaper: (cfg.river && cfg.river.tributaryEndTaper) || 1.12,
        bank: false, glare: false, depth: false, noClip: true, quality: q });
      const grown = anim.tribProgress > 0.999;
      // 다 자란 뒤엔 모양이 더는 바뀌지 않는다 — 남은 변화는 페이드(알파)뿐이라 한 번 구워 붙이면 된다.
      // 4줄기를 매 프레임 다시 그리는 건 합류 직전, 즉 가장 중요한 순간에 프레임을 잡아먹는다.
      if (grown && (!tribShell || tribShell.key !== W + 'x' + H)) {
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        const c = cv.getContext('2d');
        for (const t of tribs) {
          const pts = tributarySamples(t.path, segTrib(), 1).map(([x, y]) => [x * W, y * H]);
          drawFlowingRiver(c, pts, tw, A.water, 0, topt('high'));   // 한 번뿐이라 고품질로
        }
        tribShell = { key: W + 'x' + H, cv };
        log('INFO', '지류 캐시 생성', { w: W, h: H });
      }
      fxCtx.save(); fxCtx.globalAlpha = anim.tribFade;
      if (grown && tribShell) fxCtx.drawImage(tribShell.cv, 0, 0);
      else for (const t of tribs) {
        const n = Math.max(10, Math.round(segTrib() * anim.tribProgress));
        const pts = tributarySamples(t.path, n, anim.tribProgress).map(([x, y]) => [x * W, y * H]);
        const o = topt('low'); o.uSpan = anim.tribProgress;
        drawFlowingRiver(fxCtx, pts, tw, A.water, anim.flow, o);
      }
      fxCtx.restore();
      tick('지류', t0);
    }
    if (st === 'RIVER' || st === 'NATURE' || st === 'SWIM' || (onCam && AR_ON_CAMERA) || fading) {
      fxCtx.save();
      if (fading) fxCtx.globalAlpha = anim.arFade;
      camApply(fxCtx, W, H, 1);
      const tR = performance.now();
      drawRiver(fxCtx, W, H, st === 'RIVER' ? anim.riverProgress : 1, (cfg.river && cfg.river.widthRatio) || 0.105, null, anim.flow);
      tick('물길', tR);
      {
        const du = st === 'NATURE' ? 0 : (st === 'SWIM' ? anim.swimU : ARRIVE_U), dp = pointAt(du);
        const avoid = { x: dp[0] * W, y: dp[1] * H, r: H * 0.16 };   // 달수 주변은 물고기가 비켜준다
        const tN = performance.now();
        drawNature(fxCtx, W, H, (st === 'RIVER' || st === 'NATURE') ? 0 : anim.natureCount,
          Math.min(W, H) * 0.088 * NSIZE, true, null, avoid);
        tick('자연', tN);
      }
      const d = A.float || A.front;
      if (d && (st === 'SWIM' || (onCam && AR_ON_CAMERA))) {
        // SWIM은 물길 시작점 → ARRIVE_U 까지. 도착하면 그 자리에 머문다.
        const u = st === 'SWIM' ? anim.swimU : ARRIVE_U, [x, y] = pointAt(u);
        // 달수 크기를 그 자리의 물길 폭에 맞춘다. 고정 크기로 두면 상류(가늘어진 쪽)에서 물길보다 커져
        // 둑에 얹힌 것처럼 보인다. 겸사겸사 '멀면 작고 가까우면 크게'라는 원근도 맞아떨어진다.
        const mt = riverOpts(H).minTaper;
        // 크기는 **고정**한다(config.swim.dalsuHeight). 물길 폭에 비례시켰을 때는 상류에서 62% 까지 작아져
        // '멀리서 다가오는' 원근이 걸렸는데, 시안 6컷은 그냥 헤엄치는 그림이지 접근 샷이 아니다(2026-08-31 확정).
        // 아래 폭 제한은 남아 있어 물길 머리(처음 10%)에서만 살짝 작다 — 떠오르는 도입부라 자연스럽다.
        let h = H * ((cfg.swim && cfg.swim.dalsuHeight) || 0.075);
        // 달수는 가로로 누운 자세라, 물길이 비스듬히 흐르는 굽이에서는 몸이 띠를 **대각으로 가로지른다**.
        // 띠 폭만 보고 크기를 정하면 그 자리에서 잔디를 밟는다 — 진행 방향의 기울기를 함께 봐야 한다.
        let curve = 0, bandW = 0;
        {
          let dA = angleAt(Math.min(1, u + 0.03)) - angleAt(Math.max(0, u - 0.03));
          while (dA > Math.PI) dA -= Math.PI * 2;
          while (dA < -Math.PI) dA += Math.PI * 2;
          curve = dA;
          bandW = H * ((cfg.river && cfg.river.widthRatio) || 0.105) * widthAt(u, mt, riverOpts(H).pool);
          const aspect = (d.width / d.height) || 1.4;
          // 몸이 물길을 **대각으로** 가로지르므로, 가로 길이만 보면 안 되고 세로도 함께 봐야 한다.
          // 기울인 사각형(w×h)이 흐름에 수직인 방향으로 차지하는 폭 = h × (aspect|sinΔ| + |cosΔ|), Δ = 몸각 - 진행각.
          // 예전 식(가로 길이 ÷ |sin(head)|)은 세로를 빼먹어 20% 넘게 크게 잡혔고, 그래서 꼬리가 둑을 넘어 잔디에 얹혔다.
          const dlt = swimTilt(angleAt(u)) - angleAt(u);
          const crossSpan = Math.max(0.6, aspect * Math.abs(Math.sin(dlt)) + Math.abs(Math.cos(dlt)));
          // 굽이가 급하면 띠의 안쪽이 오므라들어 실제로 그릴 수 있는 폭이 계산값보다 좁다.
          const bend = 1 - Math.min(0.30, Math.abs(dA) * 0.45);
          h = Math.min(h, bandW * 0.92 * bend / crossSpan);
        }
        const swimming = st === 'SWIM' && anim.swimU < ARRIVE_U;
        // 몸짓 위상 = 전진 위상. 도착하면 **위상을 이어받아** 천천히 늦춘다.
        // 예전엔 도착 즉시 now/520 로 갈아탔다 — 한 사이클 3.3초로 헤엄 중(1.2초)보다 2.7배 느려져
        // "마지막에 손이 느려진다"로 보였고, 위상이 이어지지 않아 프레임이 툭 튀었다.
        let theta;
        if (swimming) { theta = anim.swimP * SWIM_STROKES * Math.PI * 2; anim.arriveAt = 0; }
        else {
          if (!anim.arriveAt) { anim.arriveAt = now; anim.thetaFloat = SWIM_STROKES * Math.PI * 2; }
          // 스트로크 각속도(2π/1.2s)에서 2초에 걸쳐 70% 로 — 멈추는 게 아니라 숨 고르듯 젓는다. 프레임마다 적분한다.
          const t = (now - anim.arriveAt) / 1000, k = Math.min(1, t / 2), ease = 1 - (1 - k) * (1 - k);
          anim.thetaFloat += (Math.PI * 2 / 1.2) * (1 - 0.3 * ease) * dt;
          theta = anim.thetaFloat;
        }
        const pose = swimming ? swimPose(theta) : { push: 0 };
        const clip = riverBandPath(W, H);
        if (st === 'NATURE') {           // 물속에서 떠오르듯 등장
          const e = easeOut(anim.enter);
          fxCtx.save(); fxCtx.globalAlpha = e;
          drawDalsuSwim(fxCtx, d, x * W, y * H + h * (1 - e) * 0.45, h * (0.7 + e * 0.3), angleAt(u), theta, false, { clip });
          fxCtx.restore();
        } else {
          const tD = performance.now();
          const head = angleAt(u);
          // ── 진행 방향 정렬 ──────────────────────────────────────────────
          // 물길은 머리(u=0)에서 왼쪽으로 갔다가 도착점(u=0.5)에서는 오른쪽으로 향한다.
          // 스프라이트는 왼쪽을 보고 누워 있으므로, 그대로 두면 후반부에 **뒤로 헤엄친다**.
          // 180도 회전은 배가 하늘로 가므로 답이 아니다 → 좌우 반전으로 방향을 바꾸되,
          // 한 프레임에 튀지 않게 폭이 0 을 지나가는 '몸을 트는' 동작으로 보간한다.
          // ★ 폭을 0 으로 지나가며 보간하지 말 것.
          // '몸을 트는' 그림을 의도했는데 실제로는 **몸이 세로로 납작하게 눌렸다가 반대로 펴져** 뒤집는 것처럼 보였다
          // (현장 지적: "보통 뒤집어서 수영하진 않으니까"). 수달은 물에서 몸을 뒤집지 않는다.
          // 방향이 바뀌는 순간은 물길이 거의 수직인 지점이라, 그때의 실루엣은 좌우 대칭에 가깝다 —
          // **한 프레임에 좌우를 바꾸면** 눈에는 '굽이를 돌았다'로 읽히고 눌림이 아예 없다.
          const wantFace = Math.cos(head) < 0 ? 1 : -1;
          const flipped = wantFace !== anim.face;
          if (flipped) { anim.flipAt = now; anim.faceOld = anim.face; }
          anim.face = wantFace;
          // 기울기는 지금 보고 있는 방향 기준으로 잰다. 감쇠(0.62)를 두는 건 급한 굽이에서
          // 몸이 수직으로 서 버리면 누운 자세 그림이 무너지기 때문.
          const want = swimTilt(head);
          // 머리가 먼저 돌고 몸이 따라온다 — 목표 각도로 지연 추종.
          // 단 방향이 바뀌는 프레임에서는 곧바로 맞춘다. 지연을 두면 그 사이 '오른쪽을 보는데 몸은 왼쪽으로 누운' 그림이 된다.
          if (flipped) anim.tilt = want;
          else anim.tilt += (want - anim.tilt) * Math.min(1, (rawDt || 16) / 120);
          // 굽이 안쪽으로 기울인다 — 곡률(진행 방향이 얼마나 빠르게 돌아가는지)에 비례
          let bank = 0;
          // 수학적 중심선에 정확히 얹혀 가면 '레일 위'로 읽힌다. 물살에 밀리듯 좌우로 미세하게 벗어난다.
          // 주기가 서로 안 맞는 두 파형이라 스트로크 주기와 겹치지 않는다(= 규칙적으로 안 보인다).
          let dx = 0, dy = 0;
          if (swimming) {
            bank = Math.max(-0.14, Math.min(0.14, curve * 0.22));   // 몸이 흐름을 따라가므로 뱅킹은 살짝만
            if (flipped) {   // 굽이를 도는 순간엔 물을 차게 된다. 전환 프레임도 자연스럽게 덮인다.
              particles.spray(x * W, y * H + h * 0.16, 'rgba(232,246,252,.92)', 16, Math.min(W, H) / 2200);
            }
            const drift = (Math.sin(anim.swimP * 7.3 + 1.1) * 0.62 + Math.sin(anim.swimP * 3.1) * 0.38) * bandW * 0.20 * Math.abs(anim.face);
            dx = -Math.sin(head) * drift; dy = Math.cos(head) * drift;
            pushWake(x * W + dx, y * H + dy + h * 0.16, head, now);   // 항적은 몸 뒤쪽 수면에 남는다
          }
          // 항적도 물길 안에서만 — 안 자르면 V자 끝이 둑을 넘어 잔디에 흰 선을 긋는다
          fxCtx.save(); if (clip) fxCtx.clip(clip);
          drawWakeTrail(fxCtx, now, H);                      // 달수 아래에 깔린다
          fxCtx.restore();
          // 방향 전환은 한 프레임에 바꾸되 0.4초 디졸브로 잇는다 — 폭을 0 으로 눌러 보간하면 뒤집는 것처럼 보인다.
          const FLIP_MS = 400, fk = anim.flipAt ? Math.min(1, (now - anim.flipAt) / FLIP_MS) : 1;
          if (fk < 1) {
            fxCtx.save(); fxCtx.globalAlpha = 1 - fk;
            drawDalsuSwim(fxCtx, d, x * W + dx, y * H + dy, h, head, theta, swimming,
              { bank, tilt: -anim.tilt, face: anim.faceOld, clip, noFx: true });
            fxCtx.restore();
            fxCtx.save(); fxCtx.globalAlpha = fk;
          }
          drawDalsuSwim(fxCtx, d, x * W + dx, y * H + dy, h, head, theta, swimming,
            { bank, tilt: anim.tilt, face: anim.face, clip });
          if (fk < 1) fxCtx.restore();
          tick('달수', tD);
        }
      }
      fxCtx.restore();
    }
    // 합류부 포말 — 4줄기가 한 점에서 겹치며 생기는 각진 이음매를 물거품으로 덮는다 (본류 위에 얹어야 가려진다)
    if ((st === 'RIVER' || st === 'NATURE') && anim.tribFade > 0.01 && anim.riverProgress > 0.02) {
      // 크기는 '본류 머리 폭'에 맞춘다 — 폭과 무관하게 키우면 화면을 덮는 흰 덩어리가 된다.
      const [hx, hy] = pointAt(0);
      const headW = H * ((cfg.river && cfg.river.widthRatio) || 0.14) * widthAt(0, (cfg.river || {}).minTaper);
      const r = headW * 0.62;
      const cx = hx * W, cy = hy * H;
      // blur() 대신 방사 그라데이션 — 같은 부드러움을 필터 비용 없이 낸다
      const g = fxCtx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.35);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(0.55, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      fxCtx.save(); fxCtx.globalAlpha = 0.85 * anim.tribFade;
      // 타원으로 잘라내면 그라데이션이 0 이 되기 전에 끊겨 딱딱한 흰 링이 남는다.
      // 원으로 그려 가장자리에서 완전히 사라지게 하고, 세로만 눌러 납작하게 만든다.
      fxCtx.translate(cx, cy); fxCtx.scale(1, 0.72); fxCtx.translate(-cx, -cy);
      fxCtx.fillStyle = g;
      fxCtx.beginPath(); fxCtx.arc(cx, cy, r * 1.35, 0, Math.PI * 2); fxCtx.fill();
      fxCtx.restore();
      if (Math.random() < dt * 14) particles.sparkle(hx * W, hy * H, 2, 'rgba(255,255,255,.95)');
    }
    // 물보라·항적 방울은 월드 오브젝트라 카메라를 따라간다(대기 화면 방울은 줌이 1이라 그대로).
    const tP = performance.now(); particles.update(dt);
    fxCtx.save(); camApply(fxCtx, W, H, 1); particles.draw(fxCtx); fxCtx.restore();
    tick('파티클', tP);
    if (anim.mergeFlash > 0.01) { // 합류·터짐 순간 화면 전체 미세 플래시 (시선 회수)
      fxCtx.save(); fxCtx.globalCompositeOperation = 'lighter';
      fxCtx.fillStyle = `rgba(255,255,255,${(anim.mergeFlash * 0.22).toFixed(3)})`; fxCtx.fillRect(0, 0, W, H);
      fxCtx.restore();
    }
    // 뷰파인더 틀 안은 fx 를 도려낸다 — fx 캔버스가 <video> 위에 있어 그대로 두면 옅은 장면이 얼굴을 덮는다
    if (onCam && vfBox) {
      if (!vfPainted) { try { paintViewfinderOverlay(); } catch (e) { log('WARN', '뷰파인더 오버레이 실패', { error: String(e) }); } vfPainted = true; }
      const b = vfBox;
      fxCtx.save(); camReset(fxCtx); fxCtx.globalCompositeOperation = 'destination-out';
      fxCtx.beginPath(); fxCtx.roundRect(b.x, b.y, b.w, b.h, b.r); fxCtx.fill(); fxCtx.restore();
    }
    if (st === 'RIVER' || st === 'NATURE' || st === 'SWIM') perfTick(rawDt);
  }
  requestAnimationFrame(fxLoop);

  // ---------- e2e 검증: 각 메뉴에서 물줄기가 하나씩 아래로 흐르는가 ----------
  // 코드가 '의도한' 좌표가 아니라 **실제로 그려진 픽셀**을 읽어 확인한다.
  function verifyTributaries(phase, growing) {
    const W = fx.clientWidth, H = fx.clientHeight;
    const problems = [], cols = [];
    const src = goalSources();

    if (!tribs || tribs.length !== cfg.goals.length) problems.push(`물줄기 수 ${tribs ? tribs.length : 0} (기대 ${cfg.goals.length})`);

    // ⓪ 발원지 자체가 화면 안에 있고, 메뉴 순서대로 왼→오 로 배치돼 있는가.
    //    상대 비교만 하면 좌표계가 통째로 어긋난 버그를 놓친다(가로 모니터 레터박스 오프셋).
    src.forEach((p, i) => {
      if (!(p[0] > 0.03 && p[0] < 0.97)) problems.push(`'${cfg.goals[i].label}' 발원지가 화면 밖 (x=${p[0].toFixed(3)})`);
      if (!(p[1] > 0.05 && p[1] < 0.60)) problems.push(`'${cfg.goals[i].label}' 발원지 y 이상 (${p[1].toFixed(3)})`);
      if (i > 0 && p[0] <= src[i - 1][0]) problems.push(`발원지 순서가 메뉴 순서와 다름 (${i})`);
    });
    // 4개가 화면 폭에 고르게 퍼져 있어야 한다 (한쪽으로 쏠리면 '오른쪽에서 합쳐지는' 그림이 된다)
    if (src.length === cfg.goals.length) {
      const spread = src[src.length - 1][0] - src[0][0];
      if (spread < 0.45) problems.push(`발원지가 한쪽에 몰림 (폭 ${spread.toFixed(3)})`);
    }

    // ① 기하 검증 — 각 물줄기가 자기 메뉴에서 시작해 아래로 흐르고, 모두 같은 합류점에서 만난다
    const ends = [];
    (tribs || []).forEach((t, i) => {
      const a = tributaryPointAt(t.path, 0), b = tributaryPointAt(t.path, 1);
      ends.push(b);
      if (Math.abs(a[0] - src[i][0]) > 0.005) problems.push(`물줄기${i + 1} 시작 x ${a[0].toFixed(3)} ≠ 메뉴 x ${src[i][0].toFixed(3)}`);
      if (b[1] <= a[1]) problems.push(`물줄기${i + 1} 이 아래로 흐르지 않음 (${a[1].toFixed(2)} → ${b[1].toFixed(2)})`);
      const mid = tributaryPointAt(t.path, 0.35);
      if (Math.abs(mid[0] - a[0]) > Math.abs(b[0] - a[0]) * 0.5 + 1e-6) problems.push(`물줄기${i + 1} 이 옆으로 먼저 흐름`);
    });
    if (ends.length > 1) {
      const far = Math.max(...ends.map((e) => Math.hypot(e[0] - ends[0][0], e[1] - ends[0][1])));
      if (far > 0.005) problems.push(`합류점이 하나가 아님 (최대 편차 ${far.toFixed(3)})`);
      if (Math.abs(ends[0][0] - 0.5) > 0.03) problems.push(`합류점이 가운데가 아님 (x=${ends[0][0].toFixed(3)})`);
    }

    // ② 픽셀 검증 — 각 메뉴 바로 아래 세로 띠에 실제로 물이 그려져 있는가
    let img = null;
    try { img = fxCtx.getImageData(0, 0, W, H); } catch (e) { problems.push('픽셀 검사 불가: ' + e); }
    if (img) {
      const d = img.data;
      const grown = growing ? Math.max(0.2, anim.tribProgress) : 1;
      const mergeY = (ends[0] ? ends[0][1] : 0.44) * H;
      src.forEach((p, i) => {
        const startY = p[1] * H;
        const cx = Math.round(p[0] * W), y0 = Math.round(startY + H * 0.01);
        const y1 = Math.round(startY + (mergeY - H * 0.06 - startY) * grown);   // 자라는 중이면 자란 만큼만 본다
        let hit = 0, scanned = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let dx = -Math.round(W * 0.035); dx <= Math.round(W * 0.035); dx += 2) {
            const x = cx + dx; if (x < 0 || x >= W) continue;
            const k = (y * W + x) * 4; scanned++;
            if (d[k + 3] > 60 && d[k + 2] > d[k] + 12) hit++;   // 불투명 + 파란기
          }
        }
        cols.push({ menu: cfg.goals[i].label, x: +p[0].toFixed(3), hit, scanned });
        if (scanned > 0 && hit < scanned * 0.02) problems.push(`'${cfg.goals[i].label}' 메뉴 아래에 물줄기가 없음 (hit=${hit}/${scanned})`);
      });
    }
    log(problems.length ? 'ERROR' : 'INFO', `e2e 물줄기 검증 [${phase || '완료'}]`, { problems, cols });
    return { ok: problems.length === 0, phase, problems, cols };
  }

  // 손가락 커서가 실제로 보이는지 — 두 번째 관람객부터 안 보이는 사고를 잡는다
  function verifyGuideHand(phase) {
    const hand = $('guide-hand'), problems = [];
    const cs = getComputedStyle(hand);
    const op = parseFloat(cs.opacity || '0');
    const r = hand.getBoundingClientRect(), b = fx.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden') problems.push('손가락이 display/visibility 로 숨겨짐');
    if (!(op > 0.5)) problems.push(`손가락 opacity=${op}`);
    if (!(r.width > 4 && r.height > 4)) problems.push(`손가락 크기 ${Math.round(r.width)}x${Math.round(r.height)}`);
    const cx = r.left + r.width / 2 - b.left, cy = r.top + r.height / 2 - b.top;
    if (!(cx > 0 && cx < b.width && cy > 0 && cy < b.height)) problems.push(`손가락이 화면 밖 (${Math.round(cx)},${Math.round(cy)})`);
    // 아직 안 누른 첫 물방울 근처를 가리켜야 한다
    const next = cfg.goals.findIndex((g) => !flow.poppedKeys.includes(g.key));
    if (next >= 0) {
      const el = document.querySelector(`.bubble[data-key="${cfg.goals[next].key}"]`);
      if (el) {
        const c = elCenter(el);
        if (Math.abs(cx - c.x) > b.width * 0.15) problems.push(`손가락이 '${cfg.goals[next].label}' 물방울을 가리키지 않음`);
      }
    }
    log(problems.length ? 'ERROR' : 'INFO', `e2e 손가락 커서 [${phase}]`, { problems, op: +op.toFixed(2), x: Math.round(cx), y: Math.round(cy) });
    return { ok: problems.length === 0, phase, problems };
  }

  // ---------- 종료/오류/대기 ----------
  function finish() {
    clearTimers(); flow.reset(); setState(); buildBubbles();
    $('preview-title').textContent = cfg.screen.previewTitle;   // 다음 관람객을 위해 되돌린다
    $('preview-text').textContent = cfg.screen.previewText; anim.popped = []; particles.clear(); log('INFO', '체험 완료 → 대기');
    if (E2E && e2eCycle === 1) setTimeout(() => runSmokeCycle(2), 500);   // 두 번째 관람객
    if (SOAK && e2eCycle >= 1) {
      const m = performance.memory, mb = m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null;
      soakHeap.push(mb);
      log('INFO', '소크', { cycle: e2eCycle, heapMB: mb, particles: particles.size, timers: timers.length, wake: anim.wake.length });
      if (e2eCycle < SOAK) setTimeout(() => runSmokeCycle(e2eCycle + 1), 300);
      else {
        // 앞 1/4 평균 대비 뒤 1/4 평균 — 누수라면 계속 오른다. GC 흔들림을 넘는 20% 이상 증가면 실패.
        const q = Math.max(1, Math.floor(soakHeap.length / 4));
        const head = soakHeap.slice(0, q).reduce((a, b) => a + b, 0) / q, tail = soakHeap.slice(-q).reduce((a, b) => a + b, 0) / q;
        const growth = tail / Math.max(1, head);
        log(growth > 1.2 ? 'ERROR' : 'INFO', '소크 결과', { cycles: SOAK, heapFirstQ: +head.toFixed(1), heapLastQ: +tail.toFixed(1), growth: +growth.toFixed(2) });
        smokeFinish(Object.assign({}, lastResult, { ok: !!(lastResult && lastResult.ok) && growth <= 1.2, soak: { cycles: SOAK, growth: +growth.toFixed(2) } }), lastDataUrl);
      }
    }
  }
  function onError(where, info) { clearTimers(); flow.fail(where); setState(); log('ERROR', '오류 화면', info); if (SMOKE) smokeFinish({ ok: false, error: where, ...info }); }
  $('error-reset').addEventListener('pointerdown', finish);
  // 운영자 숨김 종료 — 우상단 투명 영역을 2초 안에 3회 터치. 화면 표시 없음(관람객이 모르게)
  { let hits = 0, hitTimer = null;
    $('exit-hit').addEventListener('pointerdown', () => {
      hits += 1; clearTimeout(hitTimer);
      hitTimer = setTimeout(() => { hits = 0; }, 2000); // 연속이 아니면 리셋
      log('INFO', '숨김 종료 터치', { hits });
      if (hits >= 3) { hits = 0; window.kiosk.quit(); }
    });
  }
  let idleTimer = null;
  function resetIdleTimer() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (flow.state === 'GUIDE') finish(); }, ms(T.idleReturnMs)); }
  $('idle').addEventListener('pointerdown', () => { sound.unlock(); if (flow.start()) { setState(); buildBubbles(); resetIdleTimer(); log('INFO', '체험 시작'); } });
  buildBubbles(); setState();

  // 프린터 프리플라이트 배너 (smart 모드에서 장비 미감지 시 대기화면에 표시, 30초마다 재확인)
  async function showPreflight() {
    const pf = await window.kiosk.getPreflight();
    let el = $('preflight'); if (!el) { el = document.createElement('div'); el.id = 'preflight'; el.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:1.6cqh 2cqw;font-size:1.8cqw;text-align:center;background:#c0392b;color:#fff;z-index:9;display:none'; stage.appendChild(el); }
    if (pf.mode === 'smart' && !pf.ok) { el.textContent = '⚠ 프린터 미연결 — ' + pf.detail; el.style.display = 'block'; }
    else el.style.display = 'none';
  }
  await showPreflight();
  if (!SMOKE) setInterval(async () => { await window.kiosk.rerunPreflight(); showPreflight(); }, 30000);
  setInterval(watchStuck, 2000);

  // ---------- 스모크 자동 실행 ----------
  function smokeFinish(result, dataUrl) {
    let ok = !!(result && result.ok) && card.width === cfg.card.width && card.height === cfg.card.height
      && typeof dataUrl === 'string' && dataUrl.length > 1000;
    const extra = {};
    if (E2E) {                                          // 물줄기 검증을 통과해야 성공으로 친다
      if (!e2eResult) { ok = false; extra.e2e = '검증이 실행되지 않음'; }
      else { ok = ok && e2eResult.ok; extra.e2e = e2eResult.ok ? 'PASS' : e2eResult.problems; extra.cols = e2eResult.cols; }
      if (e2eHand && !e2eHand.ok) { ok = false; extra.hand = [e2eHand.phase, ...e2eHand.problems]; } else extra.hand = 'PASS';
    }
    window.kiosk.smokeExit(ok, { mode: result && result.mode, front: result && result.front, error: result && result.error, card: `${card.width}x${card.height}`, ...extra });
  }
  // 숨김 종료 버튼 검증(--smoke-exit): 3회 터치로 실제 종료되면 exit 0, 안 되면 아래 타임아웃으로 exit 1
  if (SMOKE && new URLSearchParams(location.search).get('exitcheck') === '1') {
    log('INFO', 'SMOKE 숨김 종료 검증 시작');
    setTimeout(() => {
      for (let i = 0; i < 3; i++) $('exit-hit').dispatchEvent(new Event('pointerdown'));
      setTimeout(() => window.kiosk.smokeExit(false, { error: '숨김 종료 버튼 3회 터치 후에도 종료되지 않음' }), 3000);
    }, 600);
    return;
  }
  // 한 사이클을 자동으로 돌린다. E2E 모드에서는 '두 번째 관람객'까지 돌려 잔상·초기화 문제를 잡는다.
  let e2eCycle = 0;
  async function runSmokeCycle(n) {
    e2eCycle = n;
    await snap(n === 1 ? 'idle' : `idle${n}`);
    $('idle').dispatchEvent(new Event('pointerdown'));
    await new Promise((r) => setTimeout(r, 400));
    await snap(n === 1 ? 'guide' : `guide${n}`);
    if (E2E) {                                  // 손가락 커서가 매 사이클 보이는가
      const r = verifyGuideHand(`${n}번째 관람객`);
      if (!r.ok && (!e2eHand || e2eHand.ok)) e2eHand = r;
    }
    const step = scale >= 0.3 ? 900 : 60;
    cfg.goals.forEach((g, i) => setTimeout(() => {
      const el = document.querySelector(`.bubble[data-key="${g.key}"]`);
      if (el) el.dispatchEvent(new Event('pointerdown'));
      if (E2E && i === 1) {                     // 두 개 누른 뒤에도 커서가 다음 물방울을 가리키는가
        setTimeout(() => {                      // left/top 트랜지션(0.5s)이 끝난 뒤가 참값
          const r = verifyGuideHand(`${n}번째 관람객 · 2개 터치 후`);
          if (!r.ok && (!e2eHand || e2eHand.ok)) e2eHand = r;
        }, 620);
      }
    }, step * (i + 1)));
    // 시안 3~4컷 확인
    if (scale >= 0.3 && n === 1) {
      setTimeout(() => snap('splash'), step + 320);   // 터지는 순간 (시안 3컷)
      setTimeout(() => snap('popped'), step * 2 + 700); // 문구가 남은 상태 (시안 4컷)
    }
  }
  if (RECORD) {
    const bt = document.getElementById('build-tag'); if (bt) bt.style.display = 'none';
  }
  if (SMOKE) {
    log('INFO', RECORD ? '녹화 시작' : 'SMOKE 시작');
    setTimeout(() => runSmokeCycle(1), 600);
    setTimeout(() => (RECORD ? window.kiosk.recordStop() : smokeFinish({ ok: false, error: 'smoke timeout', mode: 'n/a' })), (scale >= 0.3 ? 90000 : 20000) * Math.max(1, SOAK));
  }
})().catch((e) => { console.error(e); window.kiosk && window.kiosk.log('ERROR', 'renderer 초기화 실패', { error: String(e && e.stack || e) }); if (location.search.includes('smoke=1')) window.kiosk.smokeExit(false, { error: String(e) }); });
