// 키오스크 화면 — flow(상태) / compose(합성 레이아웃) / river(물길 경로)를 사용해 DOM·캔버스·웹캠을 구동
'use strict';
(async function main() {
  const SMOKE = new URLSearchParams(location.search).get('smoke') === '1';
  const E2E = new URLSearchParams(location.search).get('e2e') === '1';   // 물줄기 실측 검증 모드
  // 렌더 실측 모드 — 캔버스 명령은 지연 래스터화되므로 그리기 직후 타이머만 재면 진짜 비용이 안 잡힌다.
  // getImageData 로 한 번 강제 동기화하면 그 프레임의 래스터까지 포함한 실제 비용이 나온다.
  const BENCH = new URLSearchParams(location.search).get('bench') === '1';

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
  try { await Promise.all([document.fonts.load('40px "Jua"'), document.fonts.load('40px "Gowun Dodum"'), document.fonts.load('40px "Jua"', '달수 물길 완성')]); } catch (e) { log('WARN', '서체 로드 실패', { error: String(e) }); }

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
  // 수면 텍스처 — assets/water.png(AI 생성본 등)가 있으면 그것을, 없으면 절차 생성본을 쓴다
  const RV = cfg.river || {};
  if (RV.path) { const ok = setPath(RV.path); log(ok ? 'INFO' : 'WARN', ok ? '물길 경로 config 적용' : '물길 경로 config 형식 오류 — 기본값 사용'); }
  A.water = await img('../assets/water.png');
  if (!A.water) { A.water = makeWaterTexture(384, 160, RV.seed || 1337); log('INFO', '수면 텍스처 절차 생성', { w: 384, h: 160 }); }
  else log('INFO', '수면 텍스처 파일 사용', { src: 'assets/water.png' });
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
    if (SMOKE) { frameSource = mock; return; }
    try {
      const constraints = { video: { width: cfg.camera.width, height: cfg.camera.height, deviceId: cfg.camera.deviceId ? { exact: cfg.camera.deviceId } : undefined }, audio: false };
      cam.srcObject = await navigator.mediaDevices.getUserMedia(constraints);
      await new Promise((r) => (cam.readyState >= 2 ? r() : cam.onloadeddata = r));
      frameSource = cam; log('INFO', '카메라 연결', { w: cam.videoWidth, h: cam.videoHeight });
    } catch (e) { log('ERROR', '카메라 실패 — 모의 프레임 사용', { error: String(e) }); frameSource = mock; }
  }
  await initCamera();

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
  const anim = { wake: [], riverProgress: 0, natureCount: 0, swimU: -1, swimP: 0, enter: 0, life: 0, arFade: 1, flow: 0, tribProgress: 0, tribFade: 0, mergeFlash: 0, t0: performance.now(), popped: [], lastWake: 0, sparkled: new Set() };
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
      g.text.split(' ').forEach((word, k) => {
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
    if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('tributary'), T.achieveMs * 0.7);
    if (E2E) {
      later(async () => {                              // 자라는 도중
        await window.kiosk.snap('e2e-growing');
        const r = verifyTributaries('자라는 중', true);
        if (!r.ok) e2eResult = r;
      }, T.achieveMs * 0.45);
      later(async () => {                              // 다 자란 직후 = 합류 직전
        await window.kiosk.snap('e2e-tributary');
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
      if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('merge'), 120);

      // ③ 합류점에서 S자가 양쪽으로 뻗는다.
      //    지류는 이 동안 계속 흐른다 — 사라지면 "4줄기가 하나가 됐다"가 아니라 "없어지고 딴 게 생겼다"로 보인다.
      if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('river'), T.riverFormMs * 0.75);
      animateValue((p) => (anim.riverProgress = p), T.riverFormMs, () => {
        { const e = pointAt(1); particles.sparkle(e[0] * W0, e[1] * H0, 12, '#bfe6f4'); } sound.chime();
        flow.advance(); setState(); // NATURE — 달수가 물길 머리에 떠오른다 (자연은 달수가 지나가며 살아난다)
        animateValueRaw((p) => (anim.tribFade = 1 - p), 900, () => { anim.tribFade = 0; particles.clearFlow(); }); // 이제 본류에 흡수
        fadeGoalTexts();
        $('story-text').textContent = cfg.screen.natureText;
        if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('nature'), T.natureMs * 0.7);
        { const e = pointAt(0); particles.splash(e[0] * W0, e[1] * H0, '#bfe6f4', Math.min(W0, H0) / 1400); }
        animateValue((p) => (anim.enter = p), T.natureMs, () => {
          anim.enter = 1; sound.chime();
          flow.advance(); setState(); // SWIM — 달수가 내려가며 지나온 자리에 자연이 살아난다
          $('story-text').textContent = cfg.screen.swimText;
          if (SMOKE && scale >= 0.3) {
            // 헤엄이 자연스러운지 눈으로 보려면 한 스트로크 안의 여러 순간을 봐야 한다
            [0.18, 0.40, 0.62, 0.84].forEach((f, i) => later(() => window.kiosk.snap(`life${i + 1}`), T.swimMs * f));
            [0.30, 0.335, 0.37, 0.405, 0.55].forEach((f, i) => later(() => window.kiosk.snap(i === 4 ? 'swim' : `swim-f${i + 1}`), T.swimMs * f));
            later(() => window.kiosk.snap('swim-arrive'), T.swimMs * 0.98);
          }
          // 등속 슬라이드가 아니라 스트로크(차고-미끄러짐)로 중앙(u=0.5)까지 헤엄쳐 도착
          animateValueRaw((p) => {
            anim.swimP = p;
            anim.swimU = swimEase(p, SWIM_STROKES) * 0.5;
            // 생명이 번지는 앞머리 — 달수보다 살짝 뒤처져 '지나간 자리'에 살아나게 한다
            anim.life = Math.min(1, Math.max(0, (p - 0.06) * 1.18));
            anim.natureCount = anim.life * 8;
          }, T.swimMs, () => {
            anim.life = 1; anim.natureCount = 8;
            // 기획 7번: 달수가 가운데 도착 → 촬영 화면. 곧장 카메라를 켜면 관람객이 놀라므로 준비 여유를 준다
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
      animateValueRaw((p) => (anim.arFade = 1 - p), Math.max(500, T.readyMs || 0), () => { anim.arFade = 0; particles.clear(); });
    }
    // 준비 여유 — 강을 보다가 곧바로 자기 얼굴이 뜨면 놀란 표정으로 찍힌다
    later(() => { $('story-text').textContent = ''; $('story-text').style.display = 'none'; startTicks(); }, T.readyMs || 0);
  }
  function startTicks() {
    if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('countdown'), 900);
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
          await window.kiosk.snap(e2eCycle === 1 ? 'done' : `done${e2eCycle}`);
          if (E2E && e2eCycle < 2) { lastResult = result; lastDataUrl = dataUrl; }   // 두 번째 관람객까지 확인 후 종료
          else smokeFinish(result, dataUrl);
        }, ms(T.doneMs) * 0.45);
        later(finish, T.doneMs);
      }, wait);
      // 플래시(0.4초)가 걷힌 뒤에 캡처해야 미리보기 화면이 하얗게 찍히지 않는다
      if (SMOKE) setTimeout(async () => {
        await window.kiosk.snap('preview');
        // 느린 검증 모드에서는 완료(수령) 화면까지 본 뒤 종료한다 (위 DONE 진입 시점에서 처리).
        if (scale < 0.3) smokeFinish(result, dataUrl);
      }, 800);
    } catch (e) { log('ERROR', '촬영/합성 예외', { error: String(e) }); onError('capture', { error: String(e) }); }
  }

  // 카드 앞면 — 기획: 촬영 사진에 **6번의 복구된 자연(강물 제외)과 달수**만 AR 합성한다.
  // 강물·수면은 넣지 않는다(화면 연출 전용). 인물 얼굴·상반신은 절대 가리지 않는다.
  function composeCard() {
    const W = card.width, H = card.height, src = frameSource;
    const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
    if (src === mock) drawMock(performance.now());
    // ① 사진 (cover, 미러 반영)
    const c = coverCrop(sw, sh, W, H);
    cardCtx.save();
    if (cfg.camera.mirror && src !== mock) { cardCtx.translate(W, 0); cardCtx.scale(-1, 1); }
    cardCtx.drawImage(src, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
    cardCtx.restore();

    const top = cfg.card.artTop == null ? 0.56 : cfg.card.artTop;

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
      cardCtx.save();
      if (!flying) {  // 접지 그림자 — 사진 위에 떠 있지 않고 바닥에 서 있게
        cardCtx.globalAlpha = 0.2; cardCtx.fillStyle = '#26333d';
        cardCtx.beginPath(); cardCtx.ellipse(x, y + size * 0.34, size * 0.30, size * 0.085, 0, 0, Math.PI * 2); cardCtx.fill();
        cardCtx.globalAlpha = 1;
      }
      // 카드에는 강물이 없으므로 물고기를 넣지 않는다 — 물가 식물만 (실사가 있으면 그것, 없으면 벡터)
      const sprite = A.plant.length ? A.plant[i % A.plant.length] : null;
      if (sprite) cardCtx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      else ART_SPRITES[kind](cardCtx, x, y, size / 80);
      cardCtx.restore();
    });

    // ②-a 나무 — 화면의 '복구된 자연'과 카드를 같은 세계로 묶어준다.
    //      인물(가운데)과 달수(우하단)를 피해 양 가장자리에만 세운다.
    (cfg.card.trees || []).forEach((t) => {
      const size = H * (t.s == null ? 0.30 : t.s);
      cardCtx.save();
      cardCtx.globalAlpha = t.a == null ? 0.95 : t.a;
      ART_TREES[t.kind || 'round'](cardCtx, t.x * W, t.y * H, size / 160);
      cardCtx.restore();
    });

    // ②-b 하단 전경 풀 — 자연이 '회복된' 느낌을 주는 가장 싼 방법. 인물 발치를 감싼다.
    if (cfg.card.foreground !== false) {
      cardCtx.save();
      const gy = H * 0.975;
      for (const [gx, gw, gh, alpha] of [
        [-0.02, 0.17, 0.095, 0.62], [0.13, 0.15, 0.070, 0.52], [0.27, 0.16, 0.088, 0.58],
        [0.42, 0.15, 0.062, 0.48], [0.56, 0.16, 0.082, 0.55], [0.71, 0.15, 0.068, 0.5], [0.85, 0.18, 0.092, 0.6]]) {
        cardCtx.globalAlpha = alpha; cardCtx.fillStyle = '#2f6e3a';
        cardCtx.beginPath();
        for (let b = 0; b < 9; b++) {   // 풀 포기 — 아래는 붙고 위로 갈수록 벌어진다
          const bx = (gx + gw * (b / 8)) * W, tipx = bx + (b - 4) * W * 0.006;
          cardCtx.moveTo(bx, gy + H * 0.05);
          cardCtx.quadraticCurveTo(bx + (b - 4) * W * 0.003, gy - H * gh * 0.5, tipx, gy - H * gh);
          cardCtx.lineTo(bx + W * 0.008, gy + H * 0.05);
        }
        cardCtx.fill();
      }
      cardCtx.restore();
    }

    // ③ 달수 — 옷 입은 포즈, 접지 그림자 포함
    const d = A.float || A.front;
    if (d) {
      const p = dalsuPlacement(W, H, d.width, d.height, cfg.card.dalsuScale, cfg.card.dalsuAnchor);
      drawDalsuSwim(cardCtx, d, p.x + p.w / 2, p.y + p.h / 2, p.h, 0, 0, false);
    }

    // ④ 색감 통일 — 사진과 그림이 같은 빛 아래 있어 보이도록 아주 옅은 wash
    cardCtx.fillStyle = 'rgba(120,170,190,.045)'; cardCtx.fillRect(0, 0, W, H);
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
    const seg = box ? 96 : (p < 0.999 ? Math.max(24, Math.round(RIVER_SEG * p)) : RIVER_SEG);
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
    const mv = riverOpts(H); mv.quality = 'high';
    const blit = (cv) => ctx.drawImage(cv, sh.x, sh.y);
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
  let shell = null;
  let tribShell = null;   // 다 자란 지류 4줄기 (이후엔 알파만 변한다)
  function riverOpts(H) {
    const RV = cfg.river || {};
    return { tilePx: (RV.tilePx || 460) * (H / 1920), minTaper: RV.minTaper };
  }
  function riverShell(W, H, pts, width) {
    const key = W + 'x' + H + '|' + width.toFixed(1);
    if (shell && shell.key === key) return shell;
    const t0 = performance.now();
    // 화면 전체(1080×1920)를 통째로 붙이면 프레임마다 800만 픽셀씩 합성한다.
    // 물길이 실제로 차지하는 사각형만 잘라 두면 붙이는 양이 1/3로 준다 — 화질은 완전히 동일하다.
    const m = width * 0.6;                              // 그림자·둑이 띠 밖으로 번지는 여유
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m));
    x1 = Math.min(W, Math.ceil(x1 + m)); y1 = Math.min(H, Math.ceil(y1 + m));
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const bake = (only) => {
      const cv = document.createElement('canvas'); cv.width = bw; cv.height = bh;
      const c = cv.getContext('2d'); c.translate(-x0, -y0);
      const o = riverOpts(H); o.quality = 'high'; o.only = only;
      drawFlowingRiver(c, pts, width, A.water, 0, o);
      return cv;
    };
    // 수심은 반사광 아래가 맞지만 붙이기 한 장을 아끼려고 포말과 묶었다.
    // 수심은 물골을 어둡게 깔 뿐이고 반사광은 'lighter' 합성이라, 순서가 바뀌어도 눈에 보이는 차이가 없다.
    // 물길 머리는 띠가 뚝 잘린 단면이라 '어디선가 시작된 강'이 아니라 '잘린 리본'으로 보인다.
    // 지류가 사라진 뒤(SWIM)에도 남을 발원 샘의 물보라를 구워 얹어 그 단면을 덮는다. 매 프레임 비용 0.
    const spring = (cv) => {
      const c = cv.getContext('2d');
      const hx = pts[0][0], hy = pts[0][1];
      const r = width * widthAt(0, riverOpts(H).minTaper) * 0.75;
      const g = c.createRadialGradient(hx - x0, hy - y0, r * 0.1, hx - x0, hy - y0, r);
      g.addColorStop(0, 'rgba(255,255,255,.85)');
      g.addColorStop(0.5, 'rgba(226,244,252,.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.save(); c.fillStyle = g;
      c.beginPath(); c.ellipse(hx - x0, hy - y0, r, r * 0.62, 0, 0, Math.PI * 2); c.fill();
      c.restore();
      return cv;
    };
    shell = { key, x: x0, y: y0, w: bw, h: bh,
      // 밑층에 '정지한 수면'을 함께 구워 둔다. 곡선 바깥에서 조각 사이에 1px 틈이 나도
      // 단색 파랑이 아니라 물결이 비쳐 이음매가 눈에 띄지 않는다. 매 프레임 비용은 0.
      under: bake(['shadow', 'water']), over: spring(bake(['depth', 'foam', 'edge'])), bank: bake(['bank']) };
    log('INFO', '물길 정적 레이어 캐시 생성',
      { w: W, h: H, box: bw + 'x' + bh, ratio: +((bw * bh) / (W * H)).toFixed(2), ms: +(performance.now() - t0).toFixed(0) });
    return shell;
  }

  // count: 실수(예 3.4) → 3개는 완전, 4번째는 등장 중(탄성 스케일). sway: 살랑임 여부
  // avoid: {x, y, r} — 이 반경 안의 물고기는 그리지 않는다 (달수를 가리면 안 된다)
  function drawNature(ctx, W, H, count, size, sway, box, avoid) {
    const slots = natureSlotsIn(8, (cfg.river && cfg.river.natureOffset) || 0.17, box, W / H, ((cfg.river && cfg.river.widthRatio) || 0.21) / 2 * 1.25 * (H / W)), now = performance.now();
    for (let i = 0; i < Math.min(8, Math.ceil(count)); i++) {
      const k = Math.min(1, Math.max(0, count - i)); if (k <= 0) continue;
      const sc = k < 1 ? easeOutBack(k) : 1;
      const kind = ART_NATURE_ORDER[i], onWater = kind === 'fish';
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
  const WAKE_LIFE = 1600;
  function pushWake(x, y, heading, now) {
    const w = anim.wake;
    const last = w[w.length - 1];
    if (last && now - last.t < 40) return;          // 40ms 간격이면 충분히 촘촘하다
    w.push({ x, y, a: heading, t: now });
    if (w.length > 60) w.shift();
  }
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
      // 나이가 들수록 벌어진다 — 이게 V자를 만든다
      const spread = H * (0.010 + age * 0.055);
      const alpha = (1 - age) * (1 - age) * 0.62;   // 처음엔 또렷하고 빠르게 사라진다
      const na = a.a + Math.PI / 2, nb = b.a + Math.PI / 2;
      const sa = H * (0.010 + ((now - a.t) / WAKE_LIFE) * 0.055);
      // 실제 항적은 '어두운 골 + 흰 마루'다. 흰 선만 그으면 수면의 흰 물결 무늬에 그대로 묻힌다.
      for (const layer of [
        { c: '13,52,76', w: H * 0.015, a: alpha * 1.15, o: H * 0.005 },
        { c: '255,255,255', w: H * 0.006, a: alpha * 1.25, o: 0 },
      ]) {
        ctx.lineWidth = layer.w * (1 - age * 0.45);
        ctx.strokeStyle = `rgba(${layer.c},${(layer.a).toFixed(3)})`;
        for (const side of [1, -1]) {
          const oa = (sa + layer.o) * side, ob = (spread + layer.o) * side;
          ctx.beginPath();
          ctx.moveTo(a.x + Math.cos(na) * oa, a.y + Math.sin(na) * oa);
          ctx.lineTo(b.x + Math.cos(nb) * ob, b.y + Math.sin(nb) * ob);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 달수 헤엄 — 몸통 흔들림·상하 부침·물 밀기 늘어남 + 진행 방향 회전. swimming=false면 정지 부유.
  function drawDalsuSwim(ctx, img, x, y, h, heading, theta, swimming, bank) {
    const w = img.width * (h / img.height);
    const pose = swimming ? swimPose(theta)
      : { roll: Math.sin(theta * 0.35) * 0.035, bob: Math.sin(theta * 0.35) * 0.5, sx: 1, sy: 1, sink: 0.5, push: 0 };
    const bobPx = pose.bob * h * 0.075;
    // 수면이 몸무게에 눌려 파인다 — 어두운 웅덩이 + 그 둘레의 흰 물마루.
    // 이게 없으면 아무리 잘 그려도 물 '위에 얹힌' 그림이 된다. 몸보다 먼저 깔아야 한다.
    if (swimming) {
      const dipR = w * 0.46, sink = 1 - pose.sink;
      const g = ctx.createRadialGradient(x, y + bobPx + h * 0.10, dipR * 0.15, x, y + bobPx + h * 0.10, dipR);
      g.addColorStop(0, `rgba(14,60,86,${(0.20 + sink * 0.14).toFixed(3)})`);
      g.addColorStop(0.62, `rgba(20,80,110,${(0.10 + sink * 0.08).toFixed(3)})`);
      g.addColorStop(1, 'rgba(20,80,110,0)');
      ctx.save();
      ctx.translate(x, y + bobPx + h * 0.10); ctx.scale(1, 0.52); ctx.translate(-x, -(y + bobPx + h * 0.10));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y + bobPx + h * 0.10, dipR, 0, Math.PI * 2); ctx.fill();
      // 파인 자리 둘레의 흰 물마루
      ctx.strokeStyle = `rgba(255,255,255,${(0.22 + pose.push * 0.20).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, h * 0.020);
      ctx.beginPath(); ctx.arc(x, y + bobPx + h * 0.10, dipR * 0.74, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y + bobPx);
    // 곡선을 돌 때 머리가 먼저 돌고 몸이 따라온다 — 회전을 진행 방향보다 살짝 덜 주고 흔들림을 얹는다
    // 굽이를 돌 때 몸을 안쪽으로 기울인다(뱅킹). 곡선인데 몸이 꼿꼿하면 레일 위를 가는 것처럼 보인다.
    ctx.rotate(heading * 0.07 + pose.roll + (bank || 0));
    ctx.scale(pose.sx, pose.sy);
    // 수면 그림자 — 몸이 가라앉을수록 진하고 넓어진다
    ctx.save();
    ctx.globalAlpha = 0.14 + (1 - pose.sink) * 0.16; ctx.fillStyle = '#12506f';
    ctx.beginPath(); ctx.ellipse(0, h * 0.30, w * (0.34 + (1 - pose.sink) * 0.12), h * 0.065, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // 몸은 통짜로 그린다. 길이 방향으로 잘라 굽이치게 하는 방법을 시도했다가 뺐다 —
    // 물고기 실루엣이라면 통하지만, 모자·가방까지 그려진 캐릭터 일러스트는 조각 경계가 그대로 찢겨 보인다.
    // 살아 있는 느낌은 몸을 일그러뜨려서가 아니라 **물이 반응하게** 해서 낸다(항적·물 파임·물보라).
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    // 뱃머리 파도 — 진행 방향 앞쪽으로 밀리는 흰 물결
    if (swimming) {
      ctx.save();
      ctx.globalAlpha = 0.30 + pose.push * 0.35;
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = Math.max(1.5, h * 0.030); ctx.lineCap = 'round';
      const fx0 = x + Math.cos(heading) * w * 0.30, fy0 = y + bobPx + Math.sin(heading) * w * 0.30;
      ctx.beginPath();
      ctx.arc(fx0, fy0 + h * 0.10, w * (0.22 + pose.push * 0.06), heading - 1.15, heading + 1.15);
      ctx.stroke();
      ctx.restore();
    }
    // 몸이 물에 잠긴 부분을 물빛으로 덮어 '물속에 들어가 있음'을 만든다
    if (swimming) {
      ctx.save();
      ctx.globalAlpha = 0.13 + (1 - pose.sink) * 0.12;
      ctx.fillStyle = 'rgba(70,150,185,1)';
      ctx.beginPath(); ctx.ellipse(x, y + bobPx + h * 0.24, w * 0.34, h * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // ---------- 숲 (시안 5·6컷: 물길 양옆의 숲과 언덕) ----------
  const SCENE = cfg.scene || {};
  let forest = null;
  function forestSlots() {
    if (!forest) {
      forest = scenerySlots(SCENE.treeCount == null ? 16 : SCENE.treeCount, {
        yTop: SCENE.yTop == null ? 0.30 : SCENE.yTop, minDist: SCENE.minDist == null ? 0.21 : SCENE.minDist,
      });
      // 달수가 내려가는 방향(위→아래)으로 살아나야 하므로 y 순으로 정렬한다
      forest.sort((a, b) => a.y - b.y);
    }
    return forest;
  }
  // 원경 언덕 — 물길이 '어딘가를' 흐르게 해준다. 이게 없으면 강이 흰 배경에 떠 있다.
  function drawHills(ctx, W, H, p) {
    if (p <= 0) return;
    const base = (SCENE.hillY == null ? 0.40 : SCENE.hillY);
    const bands = [
      { y: base, amp: 0.045, color: 'rgba(126,172,150,.62)', k: 1.0 },
      { y: base + 0.055, amp: 0.055, color: 'rgba(96,152,112,.78)', k: 1.6 },
      { y: base + 0.135, amp: 0.05, color: 'rgba(112,170,120,.72)', k: 2.4 },
    ];
    ctx.save(); ctx.globalAlpha = Math.min(1, p * 1.4);
    for (const b of bands) {
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= 1.0001; x += 0.02) {
        const y = b.y + Math.sin(x * Math.PI * 2 * b.k + b.k) * b.amp + Math.sin(x * Math.PI * 6.3 + b.k * 2) * b.amp * 0.3;
        ctx.lineTo(x * W, y * H);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
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
      if (A.tree.length) {
        const t = A.tree[i % A.tree.length], th = size * 1.15, tw = t.width * (th / t.height);
        ctx.drawImage(t, s.x * W - tw / 2, s.y * H - th, tw, th);   // 밑동이 (x,y)에 닿게
      } else ART_TREES[ART_TREE_ORDER[i % ART_TREE_ORDER.length]](ctx, s.x * W, s.y * H, size / 160);
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
  function fxLoop() {
    const now = performance.now(), rawDt = now - lastFrame;
    // 애니메이션은 큰 dt 로 튀면 안 되므로 0.05초로 자르지만, 성능 측정은 자르지 않은 실제 간격을 쓴다.
    const dt = Math.min(0.05, rawDt / 1000); lastFrame = now;
    // 흐름 거리를 dt 로 누적하면 프레임 간격이 흔들리는 만큼 물결도 흔들린다.
    // 절대 시간의 함수로 두면 프레임이 늦게 와도 물결 위치는 정확히 그 시각의 값이라 고르게 흐른다.
    anim.flow = (now - anim.t0) / 1000 * ((cfg.river && cfg.river.flowPxPerSec) || 95);

    const W = fx.clientWidth, H = fx.clientHeight;
    if (fx.width !== W || fx.height !== H) { fx.width = W; fx.height = H; }  // 항상 1:1 픽셀 — 화질 손실 없음
    fxCtx.clearRect(0, 0, W, H);
    if (anim.mergeFlash > 0) anim.mergeFlash = Math.max(0, anim.mergeFlash - dt * 2.2);
    const st = flow.state;
    // 물길 정적 캐시는 굽는 데 ~100ms 가 든다. 완성되는 순간에 구우면 하필 가장 눈에 띄는 프레임이 튄다.
    // 완성된 물길의 기하는 시작부터 정해져 있으므로, 아무것도 움직이지 않는 대기 화면에서 미리 구워 둔다.
    if (!shell && A.water && W > 0 && H > 0 && (st === 'IDLE' || st === 'GUIDE')) {
      const full = samplesRange(RIVER_SEG, 0, 1, null).map(([x, y]) => [x * W, y * H]);
      riverShell(W, H, full, H * ((cfg.river && cfg.river.widthRatio) || 0.105));
    }
    if ((st === 'IDLE' || st === 'GUIDE') && Math.random() < dt * 1.5) particles.ambient(W, H); // 배경 방울 떠오름
    if (st === 'RIVER' && anim.riverProgress > 0 && anim.riverProgress < 1 && Math.random() < 0.6) { const [hx, hy] = pointAt(anim.riverProgress); particles.sparkle(hx * W, hy * H, 1, '#ffffff'); }
    const onCam = st === 'COUNTDOWN' || st === 'CAPTURE';
    const fading = onCam && !AR_ON_CAMERA && anim.arFade > 0.01; // 촬영 화면으로 넘어가는 0.5초 동안만
    // 언덕과 숲 — 물길보다 먼저(뒤에) 그린다. 언덕은 물길이 완성되며, 나무는 자연 회복 단계에 자란다.
    if (st === 'RIVER' || st === 'NATURE' || st === 'SWIM' || fading) {
      const hp = st === 'RIVER' ? anim.riverProgress : 1;
      // 나무도 달수가 내려간 만큼만 살아난다 (지나온 자리에 생명이 번진다)
      const tp = (st === 'RIVER' || st === 'NATURE') ? 0 : anim.life;
      const t0 = performance.now();
      fxCtx.save();
      if (fading) fxCtx.globalAlpha = anim.arFade;
      drawHills(fxCtx, W, H, hp);
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
      const tR = performance.now();
      drawRiver(fxCtx, W, H, st === 'RIVER' ? anim.riverProgress : 1, (cfg.river && cfg.river.widthRatio) || 0.105, null, anim.flow);
      tick('물길', tR);
      {
        const du = st === 'NATURE' ? 0 : (st === 'SWIM' ? anim.swimU : 0.5), dp = pointAt(du);
        const avoid = { x: dp[0] * W, y: dp[1] * H, r: H * 0.16 };   // 달수 주변은 물고기가 비켜준다
        const tN = performance.now();
        drawNature(fxCtx, W, H, (st === 'RIVER' || st === 'NATURE') ? 0 : anim.natureCount, Math.min(W, H) * 0.088, true, null, avoid);
        tick('자연', tN);
      }
      const d = A.float || A.front;
      if (d && (st === 'SWIM' || (onCam && AR_ON_CAMERA))) {
        // SWIM은 물길 시작점 → 중앙(u=0.5)까지. 도착하면 그 자리에 머문다(기획: "달수 중앙 도착").
        const u = st === 'SWIM' ? anim.swimU : 0.5, [x, y] = pointAt(u);
        // 달수 크기를 그 자리의 물길 폭에 맞춘다. 고정 크기로 두면 상류(가늘어진 쪽)에서 물길보다 커져
        // 둑에 얹힌 것처럼 보인다. 겸사겸사 '멀면 작고 가까우면 크게'라는 원근도 맞아떨어진다.
        const mt = riverOpts(H).minTaper;
        const wRel = Math.min(1.15, Math.max(0.62, widthAt(u, mt) / widthAt(0.5, mt)));
        let h = H * 0.09 * wRel;
        // 달수는 가로로 누운 자세라, 물길이 비스듬히 흐르는 굽이에서는 몸이 띠를 **대각으로 가로지른다**.
        // 띠 폭만 보고 크기를 정하면 그 자리에서 잔디를 밟는다 — 진행 방향의 기울기를 함께 봐야 한다.
        let curve = 0;
        {
          let dA = angleAt(Math.min(1, u + 0.03)) - angleAt(Math.max(0, u - 0.03));
          while (dA > Math.PI) dA -= Math.PI * 2;
          while (dA < -Math.PI) dA += Math.PI * 2;
          curve = dA;
          const bandW = H * ((cfg.river && cfg.river.widthRatio) || 0.105) * widthAt(u, mt);
          const aspect = (d.width / d.height) || 1.4;
          const cross = Math.max(0.35, Math.abs(Math.sin(angleAt(u))));  // 수평 길이가 띠를 가로지르는 비율
          // 굽이가 급하면 띠의 안쪽이 오므라들어 실제로 그릴 수 있는 폭이 계산값보다 좁다.
          // 곡률만큼 더 줄여야 굽이에서 잔디를 밟지 않는다.
          const bend = 1 - Math.min(0.30, Math.abs(dA) * 0.45);
          h = Math.min(h, (bandW * 0.92 * bend / cross) / aspect);
        }
        const swimming = st === 'SWIM' && anim.swimU < 0.5;
        // 몸짓 위상 = 전진 위상. 헤엄이 끝나면 느린 부유로 넘어간다.
        const theta = swimming ? anim.swimP * SWIM_STROKES * Math.PI * 2 : now / 520;
        const pose = swimming ? swimPose(theta) : { push: 0 };
        if (st === 'NATURE') {           // 물속에서 떠오르듯 등장
          const e = easeOut(anim.enter);
          fxCtx.save(); fxCtx.globalAlpha = e;
          drawDalsuSwim(fxCtx, d, x * W, y * H + h * (1 - e) * 0.45, h * (0.7 + e * 0.3), angleAt(u), theta, false);
          fxCtx.restore();
        } else {
          const tD = performance.now();
          const head = angleAt(u);
          // 굽이 안쪽으로 기울인다 — 곡률(진행 방향이 얼마나 빠르게 돌아가는지)에 비례
          let bank = 0;
          if (swimming) {
            bank = Math.max(-0.30, Math.min(0.30, curve * 0.55));
            pushWake(x * W, y * H + h * 0.16, head, now);   // 항적은 몸 뒤쪽 수면에 남는다
          }
          drawWakeTrail(fxCtx, now, H);                      // 달수 아래에 깔린다
          drawDalsuSwim(fxCtx, d, x * W, y * H, h, head, theta, swimming, bank);
          tick('달수', tD);
        }
        // 물보라 — 물을 차는 순간에만 세게 튄다
        if (swimming && now - anim.lastWake > 55) {
          anim.lastWake = now;
          const b = pointAt(Math.max(0, u - 0.035));
          particles.wake(b[0] * W, b[1] * H + h * 0.20);
          if (pose.push > 0.75) {
            particles.wake(b[0] * W - W * 0.012, b[1] * H + h * 0.24);
            particles.sparkle(x * W, y * H + h * 0.12, 3, 'rgba(255,255,255,.9)');
          }
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
    const tP = performance.now(); particles.update(dt); particles.draw(fxCtx); tick('파티클', tP);
    if (anim.mergeFlash > 0.01) { // 합류·터짐 순간 화면 전체 미세 플래시 (시선 회수)
      fxCtx.save(); fxCtx.globalCompositeOperation = 'lighter';
      fxCtx.fillStyle = `rgba(255,255,255,${(anim.mergeFlash * 0.22).toFixed(3)})`; fxCtx.fillRect(0, 0, W, H);
      fxCtx.restore();
    }
    if (st === 'RIVER' || st === 'NATURE' || st === 'SWIM') perfTick(rawDt);
    requestAnimationFrame(fxLoop);
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
    await window.kiosk.snap(n === 1 ? 'idle' : `idle${n}`);
    $('idle').dispatchEvent(new Event('pointerdown'));
    await new Promise((r) => setTimeout(r, 400));
    await window.kiosk.snap(n === 1 ? 'guide' : `guide${n}`);
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
      setTimeout(() => window.kiosk.snap('splash'), step + 320);   // 터지는 순간 (시안 3컷)
      setTimeout(() => window.kiosk.snap('popped'), step * 2 + 700); // 문구가 남은 상태 (시안 4컷)
    }
  }
  if (SMOKE) {
    log('INFO', 'SMOKE 시작');
    setTimeout(() => runSmokeCycle(1), 600);
    setTimeout(() => smokeFinish({ ok: false, error: 'smoke timeout', mode: 'n/a' }), scale >= 0.3 ? 90000 : 20000);
  }
})().catch((e) => { console.error(e); window.kiosk && window.kiosk.log('ERROR', 'renderer 초기화 실패', { error: String(e && e.stack || e) }); if (location.search.includes('smoke=1')) window.kiosk.smokeExit(false, { error: String(e) }); });
