// 키오스크 화면 — flow(상태) / compose(합성 레이아웃) / river(물길 경로)를 사용해 DOM·캔버스·웹캠을 구동
'use strict';
(async function main() {
  const SMOKE = new URLSearchParams(location.search).get('smoke') === '1';
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
  $('guide-hand').innerHTML = artHandSvg();
  $('printer').innerHTML = artPrinterSvg();
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
    nature: [], // assets/nature-*.png 있으면 사용, 없으면 art.js 벡터 스프라이트
  };
  for (let i = 1; i <= 8; i++) { const n = await img(`../assets/nature-${i}.png`); if (n) A.nature.push(n); }
  // 수면 텍스처 — assets/water.png(AI 생성본 등)가 있으면 그것을, 없으면 절차 생성본을 쓴다
  const RV = cfg.river || {};
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
  function setState() { stage.dataset.state = flow.state; }

  // FX 애니메이션 상태 + 파티클/효과음 (motion.js)
  const anim = { riverProgress: 0, natureCount: 0, swimU: -1, arFade: 1, flow: 0, t0: performance.now(), popped: [], lastWake: 0, sparkled: new Set() };
  const particles = createParticles();
  const sound = createSound(!!(cfg.sound && cfg.sound.enabled) && !SMOKE);

  // ---------- 물방울 (시안 1~4컷: 가로 1열, 눈물방울, 터치하면 그 자리에 목표 문구가 남는다) ----------
  const DROP_W = 21, DROP_GAP = 2.4;                                  // vw
  const DROP_TOP = 33;                                                // vh
  const POS = cfg.goals.map((_, i) => {
    const total = cfg.goals.length * DROP_W + (cfg.goals.length - 1) * DROP_GAP;
    return [(100 - total) / 2 + i * (DROP_W + DROP_GAP), DROP_TOP];    // [vw, vh]
  });
  function buildBubbles() {
    $('guide-text').style.opacity = '';
    const wrap = $('bubbles'); wrap.innerHTML = '';
    cfg.goals.forEach((g, i) => {
      const b = document.createElement('div'); b.className = 'bubble'; b.dataset.key = g.key;
      b.style.left = POS[i][0] + 'vw'; b.style.top = POS[i][1] + 'vh';
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
    moveHand();
  }
  function moveHand() {
    const next = cfg.goals.findIndex((g) => !flow.poppedKeys.includes(g.key));
    const hand = $('guide-hand'); if (next < 0) { hand.style.opacity = 0; return; }
    // 대상 물방울의 실제 위치를 재서 바로 아래에 붙인다 — 아이콘·라벨을 절대 덮지 않는다
    const el = document.querySelector(`.bubble[data-key="${cfg.goals[next].key}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    hand.style.left = (r.left + r.width * 0.50) + 'px';
    hand.style.top = (r.bottom - r.height * 0.10) + 'px';
    hand.style.opacity = .95;
  }
  function onBubble(goal, el) {
    const r = flow.popBubble(goal.key);
    if (!r.accepted) return;
    el.classList.add('popped');
    // 시안 3컷: 터진 자리에 물 스플래시
    const rc = el.getBoundingClientRect(), c = { x: rc.left + rc.width / 2, y: rc.top + rc.height * 0.45 };
    anim.popped.push({ ...c, color: goal.color });
    particles.burst(c.x, c.y, goal.color, 34, Math.min(fx.clientWidth, fx.clientHeight) / 900);
    particles.sparkle(c.x, c.y, 10, '#ffffff');
    sound.pop();
    moveHand();
    $('guide-text').style.opacity = 0; // 시안 3컷부터는 안내 문구 없이 목표 문구만
    log('INFO', '물방울', { key: goal.key, popped: r.popped });
    if (r.allDone) later(runStory, T.goalTextMs); // 마지막 문구를 읽을 틈을 준 뒤 물길 연출
    else resetIdleTimer();
  }

  // ---------- 연출 ----------
  function runStory() {
    clearTimers(); setState(); // RIVER
    $('story-text').textContent = cfg.screen.achieveText; $('story-text').style.display = ''; // ① 4대 환경목표 달성
    anim.riverProgress = 0; anim.natureCount = 0; anim.swimU = -1; anim.arFade = 1; anim.t0 = performance.now(); anim.sparkled.clear();
    // 1) 터진 물방울들이 물길 시작점으로 모임 (riverFormMs의 앞 35%)
    // 기획 4번: 터진 물방울들이 화면 중앙으로 모이고, 그 자리에서 S자 물길이 양쪽으로 뻗어나간다
    const W0 = fx.clientWidth, H0 = fx.clientHeight, mid = pointAt(0.5), to = { x: mid[0] * W0, y: mid[1] * H0 };
    const gatherMs = T.achieveMs; // 달성 문구를 보여주는 동안 물방울이 물길 시작점으로 모인다
    anim.popped.forEach((c) => particles.converge(c, to, c.color, 14, ms(gatherMs) / 1000));
    sound.chime();
    later(() => {
      $('story-text').textContent = cfg.screen.riverText; // ② 물방울이 모여 물길 완성
      sound.whoosh();
      // 2) 물길이 그려짐 (머리 부분 반짝임은 fxLoop)
      if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('river'), T.riverFormMs * 0.5);
      animateValue((p) => (anim.riverProgress = p), T.riverFormMs, () => {
        particles.sparkle(to.x, to.y, 12, '#bfe6f4'); sound.chime();
        flow.advance(); setState(); // NATURE
        $('story-text').textContent = cfg.screen.natureText;
        if (SMOKE && scale >= 0.3) later(() => window.kiosk.snap('nature'), T.natureMs * 0.5);
        animateValue((p) => (anim.natureCount = p * 8), T.natureMs, () => {
          flow.advance(); setState(); // SWIM
          $('story-text').textContent = cfg.screen.swimText;
          if (SMOKE && scale >= 0.3) { later(() => window.kiosk.snap('swim'), T.swimMs * 0.55); later(() => window.kiosk.snap('swim-arrive'), T.swimMs * 0.98); }
          // 등속 슬라이드가 아니라 스트로크(차고-미끄러짐) 진행으로 중앙(u=0.5)까지 헤엄친다
          animateValueRaw((p) => (anim.swimU = swimEase(p, 5) * 0.5), T.swimMs, () => {
            $('story-text').textContent = ''; $('story-text').style.display = 'none';
            flow.advance(); setState(); runCountdown();
          });
        });
      });
    }, gatherMs);
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
      animateValueRaw((p) => (anim.arFade = 1 - p), 500, () => { anim.arFade = 0; particles.clear(); });
    }
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
      const bar = $('print-bar'); bar.style.transitionDuration = ms(T.previewMs) + 'ms'; bar.style.width = '0'; void bar.offsetWidth; bar.style.width = '100%';
      const result = await window.kiosk.print(dataUrl, { subdir: SMOKE ? 'smoke' : undefined });
      if (!result.ok) { log('ERROR', '인쇄 실패', result); return onError('print', result); }
      log('INFO', '인쇄 요청 완료', { mode: result.mode, front: result.front });
      later(() => { flow.advance(); setState(); later(finish, T.doneMs); }, T.previewMs); // DONE
      // 플래시(0.4초)가 걷힌 뒤에 캡처해야 미리보기 화면이 하얗게 찍히지 않는다
      if (SMOKE) setTimeout(async () => { await window.kiosk.snap('preview'); smokeFinish(result, dataUrl); }, 800);
    } catch (e) { log('ERROR', '촬영/합성 예외', { error: String(e) }); onError('capture', { error: String(e) }); }
  }

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

    // AR은 카드 하단 물 영역에만 — 인물 얼굴·상반신(상단 중앙)을 가리지 않게
    const box = artBox(cfg.card.artTop);
    const waterTop = box.y * H;

    // ② 수면: 위쪽은 투명하게 사라지는 물빛 → 사진과 그림의 경계가 생기지 않는다
    const fade = H * 0.14;
    const g = cardCtx.createLinearGradient(0, waterTop - fade, 0, H);
    g.addColorStop(0, 'rgba(124,196,224,0)');
    g.addColorStop(0.35, 'rgba(124,196,224,.26)');
    g.addColorStop(1, 'rgba(45,120,155,.52)');
    cardCtx.fillStyle = g; cardCtx.fillRect(0, waterTop - fade, W, H - waterTop + fade);
    // 잔물결 몇 줄 — 수면처럼 보이게
    cardCtx.save(); cardCtx.strokeStyle = 'rgba(255,255,255,.28)'; cardCtx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const y = waterTop + (H - waterTop) * (0.18 + i * 0.17), len = W * (0.10 + (i % 3) * 0.05), x0 = W * (0.05 + (i * 0.21) % 0.8);
      cardCtx.lineWidth = H * 0.006; cardCtx.beginPath(); cardCtx.moveTo(x0, y); cardCtx.lineTo(x0 + len, y); cardCtx.stroke();
    }
    cardCtx.restore();

    // ③ 물길 ④ 자연 — 물 영역 안으로 눌러 담아 그린다
    cardCtx.save(); cardCtx.globalAlpha = 0.95;
    drawRiver(cardCtx, W, H, 1, (cfg.river && cfg.river.cardWidthRatio) || 0.16, box, anim.flow);
    cardCtx.restore();
    drawNature(cardCtx, W, H, 5, H * 0.085, false, box);

    // ⑤ 달수 — 물길 위 부유 포즈, 수면 그림자 포함
    const d = A.float || A.front;
    if (d) {
      const p = dalsuPlacement(W, H, d.width, d.height, cfg.card.dalsuScale, cfg.card.dalsuAnchor);
      drawDalsuSwim(cardCtx, d, p.x + p.w / 2, p.y + p.h / 2, p.h, 0, 0, false);
    }

    // ⑥ 색감 통일 — 사진과 그림이 같은 빛 아래 있어 보이도록 아주 옅은 물빛 wash
    cardCtx.fillStyle = 'rgba(124,196,224,.05)'; cardCtx.fillRect(0, 0, W, H);
  }

  // ---------- FX 캔버스 (화면 연출) ----------
  // 물길 그리기.
  //   progress 1  → 완성된 강 전체
  //   progress<1  → 화면 중앙(u=0.5)에서 양쪽으로 뻗어나가는 중 (기획: 물방울이 중앙으로 모여 S자 완성)
  //   style=water → 수면 텍스처가 흐름 방향으로 스크롤하는 실제 강물, cartoon → 기존 벡터 물길
  function drawRiver(ctx, W, H, progress, widthRatio, box, flowScroll) {
    if (progress <= 0) return;
    const p = Math.min(1, progress);
    const half = p / 2;
    const pts = samplesRange(96, 0.5 - half, 0.5 + half, box).map(([x, y]) => [x * W, y * H]);
    const RV = cfg.river || {};
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
    drawFlowingRiver(ctx, pts, H * widthRatio, A.water, flowScroll || 0, {
      tilePx: (RV.tilePx || 460) * (H / 1920),
      minTaper: RV.minTaper,
    });
  }

  // count: 실수(예 3.4) → 3개는 완전, 4번째는 등장 중(탄성 스케일). sway: 살랑임 여부
  function drawNature(ctx, W, H, count, size, sway, box) {
    const slots = natureSlotsIn(8, 0.13, box), now = performance.now();
    for (let i = 0; i < Math.min(8, Math.ceil(count)); i++) {
      const k = Math.min(1, Math.max(0, count - i)); if (k <= 0) continue;
      const sc = k < 1 ? easeOutBack(k) : 1;
      const s = slots[i], onWater = ART_NATURE_ORDER[i] === 'fish', pw = onWater ? pointIn(s.u, box) : null;
      const x = (onWater ? pw[0] : s.x) * W, y = (onWater ? pw[1] : s.y) * H, sprite = A.nature[i % Math.max(1, A.nature.length)];
      const rot = sway ? Math.sin(now / 700 + i) * 0.06 : 0;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc); ctx.globalAlpha = Math.min(1, k * 1.5);
      if (A.nature.length) ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      else ART_SPRITES[ART_NATURE_ORDER[i]](ctx, 0, 0, size / 80);
      ctx.restore();
      if (k >= 1 && !anim.sparkled.has(i) && sway) { anim.sparkled.add(i); particles.sparkle(x, y - size * 0.3, 6, '#fbe7a1'); sound.bloom(); }
    }
  }
  // 달수 헤엄 — 몸통 흔들림·상하 부침·물 밀기 늘어남 + 진행 방향 회전. swimming=false면 정지 부유.
  function drawDalsuSwim(ctx, img, x, y, h, heading, phase, swimming) {
    const w = img.width * (h / img.height);
    const pose = swimming ? swimPose(phase) : { roll: Math.sin(phase * 0.5) * 0.04, bob: Math.sin(phase * 0.5) * 0.5, sx: 1, sy: 1 };
    ctx.save();
    ctx.translate(x, y + pose.bob * h * 0.06);
    ctx.rotate(heading * 0.35 + pose.roll);
    ctx.scale(pose.sx, pose.sy);
    // 수면 그림자 — 사진 위에 떠 있지 않고 물에 잠긴 느낌
    ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#1d5a7a';
    ctx.beginPath(); ctx.ellipse(0, h * 0.30, w * 0.40, h * 0.07, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  let lastFrame = performance.now();
  function fxLoop() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    anim.flow += dt * ((cfg.river && cfg.river.flowPxPerSec) || 95); // 강물 흐름 누적 거리(px)
    const W = (fx.width = fx.clientWidth), H = (fx.height = fx.clientHeight);
    fxCtx.clearRect(0, 0, W, H);
    const st = flow.state;
    if ((st === 'IDLE' || st === 'GUIDE') && Math.random() < dt * 1.5) particles.ambient(W, H); // 배경 방울 떠오름
    if (st === 'RIVER' && anim.riverProgress > 0 && anim.riverProgress < 1 && Math.random() < 0.6) { const [hx, hy] = pointAt(anim.riverProgress); particles.sparkle(hx * W, hy * H, 1, '#ffffff'); }
    const onCam = st === 'COUNTDOWN' || st === 'CAPTURE';
    const fading = onCam && !AR_ON_CAMERA && anim.arFade > 0.01; // 촬영 화면으로 넘어가는 0.5초 동안만
    if (st === 'RIVER' || st === 'NATURE' || st === 'SWIM' || (onCam && AR_ON_CAMERA) || fading) {
      fxCtx.save();
      if (fading) fxCtx.globalAlpha = anim.arFade;
      drawRiver(fxCtx, W, H, st === 'RIVER' ? anim.riverProgress : 1, (cfg.river && cfg.river.widthRatio) || 0.105, null, anim.flow);
      drawNature(fxCtx, W, H, st === 'RIVER' ? 0 : (st === 'NATURE' ? anim.natureCount : 8), Math.min(W, H) * 0.09, true);
      const d = A.float || A.front;
      if (d && (st === 'SWIM' || (onCam && AR_ON_CAMERA))) {
        // SWIM은 물길 시작점 → 중앙(u=0.5)까지. 도착하면 그 자리에 머문다(기획: "달수 중앙 도착").
        const u = st === 'SWIM' ? anim.swimU : 0.5, [x, y] = pointAt(u);
        const h = H * 0.2, swimming = st === 'SWIM' && anim.swimU < 0.5;
        drawDalsuSwim(fxCtx, d, x * W, y * H, h, angleAt(u), now / 190, swimming);
        // 물보라: 뒤로 밀려나는 물결 + 스트로크마다 튀는 물방울
        if (swimming && now - anim.lastWake > 70) {
          anim.lastWake = now;
          const b = pointAt(Math.max(0, u - 0.035));
          particles.wake(b[0] * W, b[1] * H + h * 0.22);
          if (Math.sin(now / 190) > 0.9) particles.sparkle(x * W, y * H + h * 0.1, 2, 'rgba(255,255,255,.8)');
        }
      }
      fxCtx.restore();
    }
    particles.update(dt); particles.draw(fxCtx);
    requestAnimationFrame(fxLoop);
  }
  requestAnimationFrame(fxLoop);

  // ---------- 종료/오류/대기 ----------
  function finish() { clearTimers(); flow.reset(); setState(); buildBubbles(); anim.popped = []; particles.clear(); log('INFO', '체험 완료 → 대기'); }
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
    let el = $('preflight'); if (!el) { el = document.createElement('div'); el.id = 'preflight'; el.style.cssText = 'position:absolute;left:0;right:0;bottom:0;padding:1.6vh 2vw;font-size:1.8vw;text-align:center;background:#c0392b;color:#fff;z-index:9;display:none'; stage.appendChild(el); }
    if (pf.mode === 'smart' && !pf.ok) { el.textContent = '⚠ 프린터 미연결 — ' + pf.detail; el.style.display = 'block'; }
    else el.style.display = 'none';
  }
  await showPreflight();
  if (!SMOKE) setInterval(async () => { await window.kiosk.rerunPreflight(); showPreflight(); }, 30000);

  // ---------- 스모크 자동 실행 ----------
  function smokeFinish(result, dataUrl) {
    const ok = !!(result && result.ok) && card.width === 1012 && card.height === 636 && typeof dataUrl === 'string' && dataUrl.length > 1000;
    window.kiosk.smokeExit(ok, { mode: result && result.mode, front: result && result.front, error: result && result.error, card: `${card.width}x${card.height}` });
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
  if (SMOKE) {
    log('INFO', 'SMOKE 시작');
    setTimeout(async () => {
      await window.kiosk.snap('idle');
      $('idle').dispatchEvent(new Event('pointerdown'));
      await new Promise((r) => setTimeout(r, 400)); await window.kiosk.snap('guide');
      const step = scale >= 0.3 ? 900 : 60;
      cfg.goals.forEach((g, i) => setTimeout(() => document.querySelector(`.bubble[data-key="${g.key}"]`).dispatchEvent(new Event('pointerdown')), step * (i + 1)));
      // 시안 3~4컷 확인: 2개 터뜨린 시점의 화면(터진 자리에 목표 문구가 남아 있는지)
      if (scale >= 0.3) setTimeout(() => window.kiosk.snap('popped'), step * 2 + 700);
    }, 600);
    setTimeout(() => smokeFinish({ ok: false, error: 'smoke timeout', mode: 'n/a' }), scale >= 0.3 ? 90000 : 20000);
  }
})().catch((e) => { console.error(e); window.kiosk && window.kiosk.log('ERROR', 'renderer 초기화 실패', { error: String(e && e.stack || e) }); if (location.search.includes('smoke=1')) window.kiosk.smokeExit(false, { error: String(e) }); });
