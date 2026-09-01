// 시안(8컷) 기준 순서·좌표 규칙 검증 — 순수 모듈만 대상
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STATES, ORDER, createFlow } = require('../kiosk/src/flow');
const { swimEase, swimArrive, swimPose, swimCamera } = require('../kiosk/src/motion');
const { artBox, LAYERS } = require('../kiosk/src/compose');
const river = require('../kiosk/src/river');
const water = require('../kiosk/src/water');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'config.json'), 'utf8'));

test('기획 흐름 순서: 물방울 4개 → 물길 → 자연 → 헤엄 → 카운트다운 → 촬영 → 미리보기 → 수령', () => {
  const flow = createFlow(cfg.goals.map((g) => g.key));
  flow.start();
  assert.equal(flow.state, STATES.GUIDE);
  cfg.goals.forEach((g) => flow.popBubble(g.key));
  assert.equal(flow.state, STATES.RIVER, '4개 모두 터뜨려야 물길로 넘어간다');
  const seq = [];
  for (let i = 0; i < 6; i++) seq.push(flow.advance());
  assert.deepEqual(seq, ['NATURE', 'SWIM', 'COUNTDOWN', 'CAPTURE', 'PREVIEW', 'DONE']);
  assert.equal(flow.advance(), STATES.IDLE, 'DONE 다음은 대기로 복귀');
  assert.deepEqual(ORDER.slice(2, 6), ['RIVER', 'NATURE', 'SWIM', 'COUNTDOWN']);
});

test('전체 체험시간이 기획 범위(50초~1분 20초) 안에 든다', () => {
  const T = cfg.timing;
  // 연출·대기 구간 합 (사용자 터치 시간은 제외)
  const auto = T.achieveMs + T.riverFormMs + T.natureMs + T.swimMs + (T.readyMs || 0)
    + (T.countdownSec + 1) * 1000 + T.previewMs + T.doneMs;
  const touchFast = T.goalTextMs + 4 * 1200;   // 빠른 관람객: 물방울당 약 1.2초
  const touchSlow = T.goalTextMs + 4 * 4000;   // 느린 관람객: 물방울당 약 4초
  assert.ok((auto + touchFast) / 1000 >= 50, `최소 ${(auto + touchFast) / 1000}초 — 50초 이상이어야`);
  assert.ok((auto + touchSlow) / 1000 <= 80, `최대 ${(auto + touchSlow) / 1000}초 — 80초 이하여야`);
});

test('시안 문구가 config에 모두 있고 4대 목표 문구는 기획 확정본과 일치', () => {
  for (const k of ['headTitle', 'headSub', 'guideText', 'achieveText', 'natureText', 'countdownText', 'previewTitle', 'previewText', 'doneText']) {
    assert.ok(typeof cfg.screen[k] === 'string' && cfg.screen[k].length > 0, `screen.${k} 필요`);
  }
  const texts = Object.fromEntries(cfg.goals.map((g) => [g.key, g.text]));
  // 2026-09-01 클라이언트 콘텐츠 수정본 (FM)KIWW2026_AR포토부스_콘텐츠수정.pptx
  assert.equal(texts.reduce, '물 사용량을\n줄이고');
  assert.equal(texts.reuse, '물 재이용을\n늘리고');
  assert.equal(texts.recycle, '정수 기술로\n재활용하여');
  assert.equal(texts.return, '깨끗하게 정화된 물을\n자연에게 돌려줍니다');
});

test('헤엄 이징: 항상 전진하고 등속이 아니다(스트로크가 있다)', () => {
  let prev = -1;
  const speeds = [];
  for (let i = 0; i <= 100; i++) {
    const v = swimEase(i / 100, 5);
    assert.ok(v >= prev, `단조 증가여야 (i=${i})`);
    if (i) speeds.push(v - prev);
    prev = v;
  }
  assert.equal(+swimEase(0, 5).toFixed(6), 0);
  assert.equal(+swimEase(1, 5).toFixed(6), 1);
  const max = Math.max(...speeds), min = Math.min(...speeds);
  assert.ok(max / min > 2, `속도 변화가 있어야 슬라이드가 아니라 헤엄 (max/min=${(max / min).toFixed(2)})`);
});

test('헤엄 자세: 물을 찰 때 몸이 앞뒤로 늘고 위아래로 눌린다', () => {
  const a = swimPose(0.4), b = swimPose(0.4 + Math.PI);
  assert.ok(Math.abs(a.roll - b.roll) > 0.05, '위상에 따라 몸통 각도가 바뀐다');
  const push = swimPose(Math.PI);          // 가장 세게 차는 순간 (= 가장 빨리 나아가는 순간)
  const glide = swimPose(0);               // 미끄러지는 순간
  assert.ok(push.push > 0.99 && glide.push < 0.01, 'push 는 차는 구간에서만 커진다');
  assert.ok(push.sx > glide.sx && push.sy < glide.sy, '가로로 늘면 세로는 눌린다');
  for (let t = 0; t < Math.PI * 2; t += 0.13) {
    const p = swimPose(t);
    assert.ok(p.sx > 0.9 && p.sx < 1.15 && p.sy > 0.9 && p.sy < 1.15, `찌그러짐이 과하면 안 된다 (${p.sx},${p.sy})`);
    assert.ok(Math.abs(p.bob) <= 0.9, `상하 부침 범위 (${p.bob})`);
    assert.ok(p.sink >= 0 && p.sink <= 1, 'sink 는 0~1');
  }
});

test('헤엄 위상이 전진 위상과 맞물린다 — 스트로크마다 한 번씩 세게 찬다', () => {
  const STROKES = 5;
  let pushes = 0, prev = 0;
  for (let i = 0; i <= 400; i++) {
    const p = i / 400;
    const push = swimPose(p * STROKES * Math.PI * 2).push;
    if (prev < 0.9 && push >= 0.9) pushes++;
    prev = push;
  }
  assert.equal(pushes, STROKES, `헤엄 한 번에 스트로크 ${STROKES}회여야 (실제 ${pushes})`);
  // 가장 세게 차는 순간이 가장 빨리 전진하는 순간과 겹쳐야 한다
  const speedAt = (p) => (swimEase(p + 0.001, STROKES) - swimEase(p - 0.001, STROKES)) / 0.002;
  let fastest = 0, best = -1;
  for (let i = 1; i < 200; i++) { const p = i / 200, v = speedAt(p); if (v > best) { best = v; fastest = p; } }
  assert.ok(swimPose(fastest * STROKES * Math.PI * 2).push > 0.85,
    '가장 빨리 나아가는 순간에 몸도 물을 차고 있어야 한다 (따로 돌면 허우적거려 보인다)');
});

test('헤엄 진행은 매개변수가 아니라 길이 기준이다 — 굽이에서 제자리걸음이 되면 안 된다', () => {
  const A = 1080 / 1920, N = 2000;
  const cum = [0]; let prev = river.pointAt(0);
  for (let i = 1; i <= N; i++) {
    const q = river.pointAt((i / N) * 0.5);
    cum.push(cum[i - 1] + Math.hypot((q[0] - prev[0]) * A, q[1] - prev[1]));
    prev = q;
  }
  const total = cum[N];
  const distAt = (u) => cum[Math.max(0, Math.min(N, Math.round((u / 0.5) * N)))];
  for (let i = 0; i <= 10; i++) {
    const s = i / 10;
    assert.ok(Math.abs(distAt(river.uAtArc(s, 0, 0.5)) / total - s) < 0.01,
      `길이 진행도 ${s} 에서 실제로 간 거리 비율이 어긋난다`);
  }
  assert.equal(+river.uAtArc(1, 0, 0.5).toFixed(6), 0.5, '헤엄 끝은 물길 중앙(u=0.5)');

  // 속도의 빠르고 느림은 **스트로크만** 만들어야 한다. swimEase 의 속도 폭은 1±0.6 이라 최대 4배.
  // 경로 매개변수를 그대로 쓰면 여기에 굽이의 왜곡(측정 2.5배)이 곱해져 10배까지 벌어졌다.
  // 누적표를 되짚으면 정의상 항등이라 아무것도 검증하지 못한다 — 실제 좌표 사이 거리를 잰다.
  const STROKES = 5, F = 300;
  let vmin = Infinity, vmax = 0;
  let pp = river.pointAt(river.uAtArc(swimEase(0, STROKES), 0, 0.5));
  for (let i = 1; i <= F; i++) {
    const q = river.pointAt(river.uAtArc(swimEase(i / F, STROKES), 0, 0.5));
    const v = Math.hypot((q[0] - pp[0]) * A, q[1] - pp[1]); pp = q;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  assert.ok(vmax / vmin < 4.6, `속도 편차가 스트로크가 만드는 4배를 넘으면 안 된다 (실제 ${(vmax / vmin).toFixed(1)}배)`);
});

test('헤엄 카메라는 진행도만의 순수 함수다 — 시간 기반이면 스모크에서 줌이 안 걸린다', () => {
  const cam = cfg.swim && cfg.swim.camera;
  assert.ok(cam, 'config.swim.camera 가 있어야 현장에서 켜고 끌 수 있다');
  assert.ok(typeof cam.enabled === 'boolean', 'enabled 는 boolean');
  // 현재는 꺼 둔다(2026-08-29): 확대하면 주변 경관이 안 보인다는 판단. 커브 자체는 계속 검증한다.
  assert.ok(cam.zoom >= 1.0 && cam.zoom <= 3.0, `줌 배율이 상식 범위를 벗어남 (${cam.zoom})`);
  assert.ok(cam.pushInFrom >= 0 && cam.pushInFrom < cam.pushInTo && cam.pushInTo <= 1,
    '돌리 구간은 0 ≤ from < to ≤ 1 이어야 한다');

  const curve = Object.assign({}, cam, { enabled: true });   // 커브 자체는 켜진 상태로 검증한다
  // 같은 p 는 항상 같은 줌 (호출 시각과 무관)
  assert.equal(swimCamera(0.42, curve).zoom, swimCamera(0.42, curve).zoom);
  // 양 끝값
  assert.equal(swimCamera(0, curve).zoom, 1, '시작은 앞 컷과 같은 시점이어야 이음매가 안 튄다');
  assert.equal(+swimCamera(cam.pushInFrom, curve).zoom.toFixed(6), 1);
  assert.equal(+swimCamera(cam.pushInTo, curve).zoom.toFixed(6), +cam.zoom.toFixed(6));
  assert.equal(+swimCamera(1, curve).zoom.toFixed(6), +cam.zoom.toFixed(6), '도착 순간은 클로즈업이어야 한다');
  assert.equal(swimCamera(0.5, { enabled: false, zoom: 2.2 }).zoom, 1, 'enabled:false 는 예전 시점 그대로');

  // 돌리 구간은 단조증가하고, 한 프레임에 확 튀지 않는다
  let prev = -Infinity, maxStep = 0;
  for (let i = 0; i <= 600; i++) {
    const z = swimCamera(i / 600, curve).zoom;
    assert.ok(z >= prev - 1e-9, '줌이 뒤로 가면 카메라가 덜컹거린다');
    if (i) maxStep = Math.max(maxStep, z - prev);
    prev = z;
  }
  // 6초 × 60fps = 360프레임. 600분할 한 칸은 그보다 촘촘하므로 여유 있게 잡는다.
  assert.ok(maxStep < 0.03, `프레임당 줌 변화가 너무 크다 (${maxStep.toFixed(4)})`);
});

test('자연 슬롯은 달수가 실제로 가는 구간에만 놓인다 — 안 그러면 절반이 화면 밖에서 핀다', () => {
  // 자연 밀도는 카메라와 무관한 장면 설정이다 — 카메라를 꺼도 경관은 유지돼야 한다.
  const sc = cfg.scene;
  assert.ok(sc.natureCount >= 8 && sc.natureUTo > 0 && sc.natureUTo <= 1, 'scene 자연 설정이 비었다');
  const slots = river.natureSlots(sc.natureCount, cfg.river.natureOffset, 1080 / 1920, 0, sc.natureUTo);
  assert.equal(slots.length, sc.natureCount);
  for (const s of slots) assert.ok(s.u <= sc.natureUTo + 1e-9, `슬롯 u=${s.u} 가 ${sc.natureUTo} 를 넘는다`);
  // 달수는 config.swim.arriveU 까지 간다. 그 안에 대부분이 들어와야 '지나간 자리에 생명이 번진다'가 보인다.
  const arrive = (cfg.swim && cfg.swim.arriveU) || 0.5;
  assert.ok(sc.natureUTo <= arrive + 0.1, `자연이 달수가 가지 않는 하류(${sc.natureUTo} > ${arrive})까지 퍼진다`);
  const within = slots.filter((s) => s.u <= arrive).length;
  assert.ok(within >= sc.natureCount - 2, `달수 경로 안 슬롯이 ${within}/${sc.natureCount} 뿐`);

  // 기존 호출 형태(uTo 없음)는 예전과 완전히 동일해야 한다
  const before = river.natureSlots(8, cfg.river.natureOffset, 1080 / 1920, 0);
  const after = river.natureSlots(8, cfg.river.natureOffset, 1080 / 1920, 0, undefined);
  assert.deepEqual(before, after, 'uTo 를 안 주면 예전 배치 그대로여야 한다');
});

test('도착 감속 — 뒤로 가지 않고, 끝에서 속도가 0 으로 수렴한다', () => {
  let prev = 0;
  for (let i = 1; i <= 1000; i++) {
    const v = swimArrive(i / 1000, 5);
    assert.ok(v >= prev - 1e-9, `p=${i / 1000} 에서 뒤로 간다`);
    prev = v;
  }
  assert.equal(+swimArrive(1, 5).toFixed(6), 1);
  const vEnd = (swimArrive(1, 5) - swimArrive(0.995, 5)) / 0.005;
  const vMid = (swimArrive(0.505, 5) - swimArrive(0.5, 5)) / 0.005;
  assert.ok(vEnd < vMid * 0.08, `끝 속도가 너무 크다 (${vEnd.toFixed(3)} vs 중간 ${vMid.toFixed(3)}) — 가다가 뚝 멈춘다`);
  // 꼬리 구간 전에는 swimEase 와 완전히 같다 (위상 규약 유지)
  for (const p of [0.1, 0.3, 0.5, 0.8]) assert.equal(swimArrive(p, 5), swimEase(p, 5));
});

test('카드 AR 영역: 인물 얼굴이 있는 상단은 비우고 하단에만 배치', () => {
  const box = artBox(cfg.card.artTop);
  assert.ok(box.y >= 0.5, '물 영역은 카드 아래 절반부터 시작해야 얼굴을 가리지 않는다');
  assert.equal(+(box.y + box.h).toFixed(6), 1);
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const [x, y] = river.pointIn(u, box);
    assert.ok(x >= 0 && x <= 1, 'x는 카드 안');
    assert.ok(y >= box.y - 1e-9, `u=${u} 의 y(${y})가 얼굴 영역을 침범`);
  }
  assert.equal(river.samplesIn(10, box).length, 11);
  assert.ok(river.natureSlotsIn(8, 0.13, box).every((s) => s.y > 0.3));
});

test('카드에는 복구된 자연과 달수만 합성한다 — 강물·하단 띠는 넣지 않는다', () => {
  assert.equal(LAYERS[0], 'photo');
  assert.ok(!LAYERS.includes('frame'), '기획에 없던 하단 흰 띠는 그리지 않는다');
  assert.ok(!LAYERS.includes('river') && !LAYERS.includes('water'),
    '기획: 촬영 사진에는 6번의 복구된 자연(강물 제외)과 달수만 AR 합성한다');
  assert.ok(LAYERS.includes('nature') && LAYERS.includes('dalsu'));
  assert.ok(LAYERS.indexOf('dalsu') > LAYERS.indexOf('nature'), '달수가 자연 위');
});

test('카드 자연 배치: 인물(가운데)과 달수(우하단)를 피한다', () => {
  const { natureCardSlots, dalsuPlacement, CARD_NATURE_ZONES_PORTRAIT } = require('../kiosk/src/compose');
  const W = cfg.card.width, H = cfg.card.height;
  const portrait = cfg.card.orientation === 'portrait';
  const d = dalsuPlacement(W, H, 2403, 1705, cfg.card.dalsuScale, cfg.card.dalsuAnchor);
  const dalsuLeft = d.x / W, dalsuTop = d.y / H;
  const slots = natureCardSlots(cfg.card.natureCount, cfg.card.artTop, portrait ? CARD_NATURE_ZONES_PORTRAIT : undefined);
  assert.equal(slots.length, cfg.card.natureCount);
  for (const s of slots) {
    assert.ok(s.x > 0 && s.x < 1 && s.y > 0 && s.y < 1, `카드 안 (${s.x},${s.y})`);
    assert.ok(s.y >= cfg.card.artTop - 1e-9, `자연은 하단에만 — 얼굴을 가리면 안 된다 (y=${s.y})`);
    // 맨 아래 전경은 달수 앞의 풀로 읽히므로 겹쳐도 된다. 그 밖의 자리는 달수를 피해야 한다.
    const foreground = s.y > 0.92;
    const inDalsu = !foreground && s.x > dalsuLeft - 0.02 && s.y > dalsuTop - 0.02;
    assert.ok(!inDalsu, `달수에 가려지는 자리 (${s.x.toFixed(2)},${s.y.toFixed(2)}) vs 달수 좌상단 (${dalsuLeft.toFixed(2)},${dalsuTop.toFixed(2)})`);
    // 세로 카드는 인물이 프레임을 거의 다 채우므로 회피 폭이 더 넓다
    const inPerson = portrait ? (s.x > 0.20 && s.x < 0.80 && s.y < 0.93)
      : (s.x > 0.30 && s.x < 0.62 && s.y < 0.86);   // 그보다 아래는 '인물 앞 전경 풀'로 읽힌다
    assert.ok(!inPerson, `인물 상반신을 가리는 자리 (${s.x.toFixed(2)},${s.y.toFixed(2)})`);
  }
});

test('완료 화면 문구가 config 에 있다 (한 바퀴 돌고 왔을 때 표시)', () => {
  assert.ok(cfg.screen.doneText && cfg.screen.doneText.length > 0);
  assert.ok(cfg.screen.doneSub && cfg.screen.doneSub.length > 0, '수령 위치 안내가 있어야 관람객이 카드를 못 찾지 않는다');
});

test('촬영 화면은 기본으로 비어 있다', () => {
  assert.equal(cfg.screen.captureOverlay, false, '촬영 중 달수·물길이 사람을 가리면 안 된다');
});

test('물길은 합류점(u=0)에서 하류로 한 방향으로 그려진다', () => {
  const mid = river.pointAt(0.5);
  assert.equal(+mid[0].toFixed(3), 0.5, '중간점은 가로 중앙 = 달수 도착점');
  const early = river.samplesRange(8, 0, 0.15);
  const start = river.pointAt(0);
  for (const [x, y] of early) {
    assert.ok(Math.hypot(x - start[0], y - start[1]) < 0.35, '초반에는 상류 주변만 그려진다');
  }
  const full = river.samplesRange(8, 0, 1);
  assert.deepEqual(full[0].map((v) => +v.toFixed(3)), river.pointAt(0).map((v) => +v.toFixed(3)));
  assert.deepEqual(full[8].map((v) => +v.toFixed(3)), river.pointAt(1).map((v) => +v.toFixed(3)));
});

test('시냇물 폭: 원근(아래가 굵음) + 여울과 소(폭이 일정하지 않음)', () => {
  const w = (u) => water.widthAt(u, 0.35);
  // ① 원근 — 전체 추세는 아래로 갈수록 굵다
  assert.ok(w(1) > w(0.5) && w(0.5) > w(0), '리본이 아니라 물길로 읽히려면 아래가 더 굵어야');
  assert.ok(w(0.8) > w(0.2) * 1.4, '원근 차이가 눈에 보일 만큼은 나야');
  // ② 여울과 소 — 폭이 매끈하게만 늘면 개울이 아니라 도형이다
  let dips = 0, prev = w(0);
  for (let i = 1; i <= 200; i++) { const v = w(i / 200); if (v < prev) dips++; prev = v; }
  assert.ok(dips > 5, `폭이 좁아지는 구간이 있어야 실제 개울처럼 보인다 (dips=${dips})`);
  // ③ 그래도 원근이 뒤집히진 않는다 — 조금 떨어진 하류는 항상 더 굵어야 한다
  for (let i = 0; i <= 100; i++) {
    const u = (i / 100) * 0.6;
    assert.ok(w(u + 0.4) > w(u), `0.4 구간 뒤는 항상 더 굵어야 (u=${u.toFixed(2)})`);
  }
});

test('시냇물 둑: 좌우가 따로 들쭉날쭉하되 폭 범위를 벗어나지 않는다', () => {
  const pts = river.samples(40).map(([x, y]) => [x * 1000, y * 1000]);
  const band = water.bandPolygon(pts, 120, 0.3);
  assert.equal(band.left.length, pts.length);
  let asym = 0;
  for (let i = 0; i < pts.length; i++) {
    const dl = Math.hypot(band.left[i][0] - pts[i][0], band.left[i][1] - pts[i][1]);
    const dr = Math.hypot(band.right[i][0] - pts[i][0], band.right[i][1] - pts[i][1]);
    if (Math.abs(dl - dr) > 0.3) asym++;
    assert.ok(dl > 0 && dr > 0, '둑이 중심선을 넘지 않는다');
    assert.ok(dl < 80 && dr < 80, `폭이 터무니없이 벌어지면 안 된다 (i=${i})`);
  }
  assert.ok(asym > pts.length * 0.5, '좌우가 똑같이 벌어지면 물길이 아니라 리본으로 보인다');
});

test('둑 불규칙함은 결정적이다 — 같은 자리는 늘 같은 모양', () => {
  for (const t of [0, 0.13, 0.5, 0.87, 1]) {
    assert.equal(water.bankWobble(t), water.bankWobble(t));
    assert.ok(Math.abs(water.bankWobble(t)) < 0.12, '들쭉날쭉함이 폭을 무너뜨릴 정도면 안 된다');
  }
  assert.notEqual(water.bankWobble(0.2), water.bankWobble(0.2 + 3.7), '좌우 둑은 서로 다른 위상을 쓴다');
});

test('강물 흐름: 누적 거리가 단조 증가하고 총 길이가 직선거리보다 길다', () => {
  const pts = river.samples(60).map(([x, y]) => [x * 1000, y * 1000]);
  const s = water.arcLengths(pts);
  assert.equal(s.length, pts.length);
  assert.equal(s[0], 0);
  for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], '흐름 스크롤이 뒤로 가면 안 된다');
  const straight = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]);
  assert.ok(s[s.length - 1] > straight, 'S자라 직선보다 길다');
});

test('수면 텍스처 난수는 seed가 같으면 항상 같다 (현장에서 화면마다 달라지지 않게)', () => {
  const a = water.mulberry32(20260909), b = water.mulberry32(20260909);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  const n = water.tileNoise(4, 9, water.mulberry32(7));
  assert.ok(Math.abs(n(0, 0.3) - n(1, 0.3)) < 1e-9, '흐름 방향으로 이음매 없이 반복되어야');
  for (const [u, v] of [[0.1, 0.2], [0.7, 0.9], [0.33, 0.61]]) {
    const val = n(u, v);
    assert.ok(val >= 0 && val <= 1);
  }
});

test('config.river 설정이 유효하다', () => {
  const r = cfg.river;
  assert.ok(['water', 'cartoon'].includes(r.style));
  assert.ok(r.widthRatio > 0.06, '기획 "굵은 S자" — 화면 높이의 6% 이상');
  assert.ok(r.flowPxPerSec > 0, '흐름 속도가 0이면 정지한 물이다');
  assert.ok(r.tilePx > 0 && r.minTaper > 0 && r.minTaper < 1);
});

test('4줄기 합류: 4개 물길이 위에서 아래로 하나로 뭉친 뒤 그 자리에서 물길이 시작된다 (기획 5번)', () => {
  const goals = [[0.149, 0.21], [0.383, 0.21], [0.617, 0.21], [0.851, 0.21]];
  const head = river.pointAt(0);
  const tribs = river.tributaries(goals, head);
  assert.equal(tribs.length, 4);
  tribs.forEach((t, i) => {
    const start = river.tributaryPointAt(t.path, 0), end = river.tributaryPointAt(t.path, 1);
    assert.deepEqual(start.map((v) => +v.toFixed(4)), goals[i].map((v) => +v.toFixed(4)), '발원지는 목표 문구 자리');
    assert.deepEqual(end.map((v) => +v.toFixed(4)), head.map((v) => +v.toFixed(4)), '4줄기가 모두 물길 머리 한 점에서 뭉친다');
    assert.ok(end[1] > start[1], '위에서 아래로 흐른다');
    assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.12, `물길이 보일 만큼 길어야 (${i})`);
    const early = river.tributaryPointAt(t.path, 0.2);
    assert.ok(Math.abs(early[0] - start[0]) < Math.abs(end[0] - start[0]) * 0.4 + 1e-6,
      '목표 아래로 먼저 떨어지고 가로 이동은 나중에');
  });
  // 합류점이 물길 머리여야 지류가 본류를 가로지르지 않는다
  assert.ok(head[1] < river.pointAt(0.5)[1], '머리가 중간보다 위에 있어야 물이 아래로 흐른다');
  assert.ok(Math.abs(head[0] - 0.5) < 0.02, '합류점은 화면 가로 가운데');
});

test('4줄기 합류: 자라는 중에는 합류점에 못 미친다', () => {
  const t = river.tributaryPath([0.15, 0.245], [0.5, 0.58]);
  assert.equal(river.tributarySamples(t, 10, 0).length, 11);
  const half = river.tributarySamples(t, 20, 0.5);
  const full = river.tributarySamples(t, 20, 1);
  assert.ok(Math.hypot(half[20][0] - 0.5, half[20][1] - 0.58) > Math.hypot(full[20][0] - 0.5, full[20][1] - 0.58),
    'progress 0.5 에서는 아직 합류점에 도달하지 않는다');
});

test('물길 경로는 config 로 덮어쓸 수 있고, 잘못된 값은 기본값으로 되돌아간다', () => {
  const base = river.pointAt(0.5);
  assert.equal(river.setPath([{ p0: [0, 0], p1: [0, 0], p2: [1, 1], p3: [1, 1] }, { p0: [1, 1], p1: [1, 1], p2: [0, 2], p3: [0, 2] }]), true);
  assert.notDeepEqual(river.pointAt(0), [0.79, 0.36]);
  assert.equal(river.setPath('엉터리'), false, '형식이 틀리면 false 를 돌려주고');
  assert.deepEqual(river.pointAt(0.5).map(v => +v.toFixed(3)), base.map(v => +v.toFixed(3)), '기본 경로로 복구되어야 한다');
});

test('스플래시·지류 파티클이 캔버스 인터페이스로 예외 없이 그려진다', () => {
  const { createParticles } = require('../kiosk/src/motion');
  const P = createParticles();
  P.splash(100, 100, '#8fd3ea', 1);
  assert.ok(P.size > 30, '물기둥 + 물보라 + 링');
  P.stream((u) => [u * 100, u * 100], '#fff', 6, 1.2);
  const ctx = { save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, translate() {}, rotate() {}, lineTo() {}, closePath() {},
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set globalAlpha(v) {} };
  P.update(0.1); P.draw(ctx);
  P.update(2.0); P.draw(ctx);
  assert.ok(P.size > 0, '지류 방울은 순환하므로 남아 있어야 한다');
});

test('config.river 지류·원근 설정이 유효하다', () => {
  assert.ok(cfg.river.tributaryWidthRatio > 0 && cfg.river.tributaryWidthRatio < cfg.river.widthRatio,
    '지류는 본류보다 가늘어야 한다');
  assert.ok(cfg.river.minTaper > 0 && cfg.river.minTaper < 1, '상단 폭 비율');
  assert.ok(typeof cfg.timing.readyMs === 'number' && cfg.timing.readyMs > 0, '촬영 전 준비 여유가 있어야 한다');
  assert.ok(cfg.timing.idleReturnMs <= 30000, '한 개가 안 눌렸을 때 대기열이 오래 멈추면 안 된다');
  assert.ok(typeof cfg.screen.readyText === 'string' && cfg.screen.readyText.length > 0);
});

test('시안 5컷: 달성한 4개 목표 문구가 물길 위쪽에 남을 자리가 있다', () => {
  const row = cfg.screen.goalRowTop;
  assert.ok(typeof row === 'number' && row > 10 && row < 30, `문구 줄 위치(${row}vh)`);
  const riverTopY = river.pointAt(0) [1];
  assert.ok(riverTopY * 100 > row, `물길 시작(${(riverTopY * 100).toFixed(1)}vh)이 문구 줄(${row}vh)보다 아래여야 문구를 관통하지 않는다`);
});

test('숲 배치: 나무가 물길을 침범하지 않고 양옆에 선다 (시안 5·6컷)', () => {
  const sc = cfg.scene;
  assert.ok(sc && sc.treeCount >= 8, '양옆에 숲이 보이려면 최소한의 그루 수가 필요하다');
  const slots = river.scenerySlots(sc.treeCount, { yTop: sc.yTop, minDist: sc.minDist });
  assert.equal(slots.length, sc.treeCount, '물길을 피한 자리를 요청한 만큼 찾아야 한다');
  for (const s of slots) {
    assert.ok(river.distToRiver([s.x, s.y]) >= sc.minDist - 1e-9, '나무가 물길 위에 서면 안 된다');
    assert.ok(s.x > 0 && s.x < 1 && s.y >= sc.yTop - 1e-9, '화면 안, 목표 문구 줄 아래');
  }
  assert.ok(slots.some((s) => s.side < 0) && slots.some((s) => s.side > 0), '숲은 양옆에 다 있어야 한다');
  // 결정적이어야 현장에서 매번 같은 그림이 나온다
  assert.deepEqual(river.scenerySlots(6), river.scenerySlots(6));
});

test('카드 나무가 인물과 달수를 가리지 않는다', () => {
  const { dalsuPlacement } = require('../kiosk/src/compose');
  const W = cfg.card.width, H = cfg.card.height;
  const portrait = cfg.card.orientation === 'portrait';
  const d = dalsuPlacement(W, H, 2403, 1705, cfg.card.dalsuScale, cfg.card.dalsuAnchor);
  for (const t of cfg.card.trees || []) {
    assert.ok(t.x > 0.02 && t.x < 0.98, `카드 안 (${t.x})`);
    assert.ok(t.x < (portrait ? 0.28 : 0.30) || t.x > (portrait ? 0.78 : 0.64), `인물 상반신을 피해야 한다 (${t.x})`);
    const overDalsu = t.x > d.x / W && t.y > d.y / H;
    assert.ok(!overDalsu, `달수를 가리면 안 된다 (${t.x},${t.y})`);
  }
});

test('합류부에서 지류와 본류의 굵기가 자연스럽게 이어진다', () => {
  const H = 1920, R = cfg.river;
  const path = river.tributaryPath([0.15, 0.21], river.pointAt(0));
  const pts = river.tributarySamples(path, 24, 1).map(([x, y]) => [x * 1080, y * H]);
  const band = water.bandPolygon(pts, H * R.tributaryWidthRatio, 0.95, R.tributaryEndTaper);
  const tribEnd = band.half[pts.length - 1] * 2;                 // 지류 한 줄의 합류부 폭
  const mainHead = H * R.widthRatio * water.widthAt(0, R.minTaper); // 본류 머리 폭
  assert.ok(tribEnd >= band.half[0] * 2 * 0.9, '지류는 합류부에서 가늘어지면 안 된다 (본류와 끊겨 보인다)');

  // 4줄기의 '합'이 아니라 합류 직전에 **실제로 덮는 가로 폭**과 비교한다.
  // 한 점으로 모이는 줄기들은 서로 겹치므로 단순 합(4배)은 화면에 나타나지 않는다.
  const W = 1080, src = [0.149, 0.383, 0.617, 0.851].map((x) => [x, 0.335]);
  let lo = Infinity, hi = -Infinity;
  for (const t of river.tributaries(src)) {
    for (let u = 0.90; u <= 1.0001; u += 0.01) {
      const q = river.tributaryPointAt(t.path, u);
      const et = 1 - (1 - R.tributaryEndTaper) * Math.pow(Math.max(0, u - 0.55) / 0.45, 1.6);
      const half = H * R.tributaryWidthRatio * water.widthAt(u, 0.95) * et / 2;
      lo = Math.min(lo, q[0] * W - half); hi = Math.max(hi, q[0] * W + half);
    }
  }
  const footprint = hi - lo;
  // 모여서 좁아지되(머리 < 덮는 폭) 한 줄기보다는 굵어야(머리 > 한 줄기) '흡수'로 읽힌다
  assert.ok(mainHead < footprint,
    `본류 머리(${mainHead.toFixed(0)}px)가 합류부가 덮는 폭(${footprint.toFixed(0)}px)보다 굵다 — 물이 모이는 게 아니라 퍼져 보인다`);
  assert.ok(mainHead > tribEnd,
    `본류 머리(${mainHead.toFixed(0)}px)가 지류 한 줄기(${tribEnd.toFixed(0)}px)보다 굵어야 합쳐진 것으로 읽힌다`);
});

// 4줄기 '합'이 아니라 '한 줄기'와 비교해야 한다.
// 지류는 합류점에 각각 따로 도착하므로, 눈은 86px 짜리 가는 줄기 하나 → 242px 짜리 굵은 본류를 잇는다.
// 합만 보면 2.8배 점프도 통과해 버려서(실제로 그렇게 나갔다) 현장에서 "합쳐지는 부분이 이상하다"가 됐다.
test('합류부: 지류 한 줄기와 본류 머리의 굵기 차가 눈에 띌 만큼 크지 않다', () => {
  const H = 1920, R = cfg.river;
  const path = river.tributaryPath([0.15, 0.21], river.pointAt(0));
  const pts = river.tributarySamples(path, 24, 1).map(([x, y]) => [x * 1080, y * H]);
  const band = water.bandPolygon(pts, H * R.tributaryWidthRatio, 0.95, R.tributaryEndTaper);
  const tribEnd = band.half[pts.length - 1] * 2;
  const mainHead = H * R.widthRatio * water.widthAt(0, R.minTaper);
  const jump = mainHead / tribEnd;
  assert.ok(jump >= 1.0, `본류 머리(${mainHead.toFixed(0)}px)가 지류 한 줄기(${tribEnd.toFixed(0)}px)보다 가늘면 안 된다`);
  assert.ok(jump <= 1.8, `합류부 굵기 점프 ${jump.toFixed(2)}배 — 1.8배를 넘으면 물길이 끊겨 보인다`);
});

// 화질 회귀 방지: 성능이 모자랄 때 '해상도'를 낮추면 픽셀이 뭉개진다(실제로 그렇게 내보내 지적받았다).
// 낮춰도 되는 건 곡선 구간 수뿐이다 — 선명도와 무관하다.
// 정규화 좌표에서 옆으로 밀면 9:16 화면에서는 가로가 절반만 밀린다.
// 그래서 '물길 옆'에 놓으려던 식물이 물 한가운데 자라 있었다.
test('자연 회복 요소가 물 위가 아니라 둑 바깥에 놓인다', () => {
  const A = 1080 / 1920, R = cfg.river;
  const halfWidth = R.widthRatio / 2 / A;          // 물길 반폭(폭 단위)
  const clear = halfWidth * 1.25;
  const slots = river.natureSlots(8, R.natureOffset, A, clear);
  assert.equal(slots.length, 8);
  for (const s of slots) {
    const d = river.distToRiver([s.x, s.y], 200, 1 / A);
    assert.ok(d > halfWidth, `u=${s.u.toFixed(2)} 요소가 물 안에 있다 (거리 ${d.toFixed(3)} ≤ 반폭 ${halfWidth.toFixed(3)})`);
    assert.ok(s.x > -0.05 && s.x < 1.05, `u=${s.u.toFixed(2)} 요소가 화면 밖 (x=${s.x.toFixed(3)})`);
  }
});

test('카메라는 카드 합성과 화면 지우기를 건드리지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'src', 'renderer.js'), 'utf8');

  // 카드는 별도 cardCtx 라 구조적으로 영향을 받을 수 없지만, 실수로 끌어들이면 인쇄물이 잘린다.
  const cs = src.indexOf('function composeCard');
  const ce = src.indexOf('\n  function ', cs + 10);
  assert.ok(cs > 0 && ce > cs, 'composeCard 블록을 찾지 못함');
  const card = src.slice(cs, ce);
  assert.ok(!/camApply|anim\.cam/.test(card), '카드 합성에 카메라가 끼어들었다 — 인쇄물이 확대되어 잘린다');

  // 앞 프레임의 카메라 변환이 남은 채로 지우면 화면 가장자리가 안 지워진다.
  const ci = src.indexOf('fxCtx.clearRect');
  assert.ok(ci > 0, 'clearRect 를 찾지 못함');
  assert.ok(src.slice(Math.max(0, ci - 260), ci).includes('camReset(fxCtx)'),
    'clearRect 직전에 camReset 이 없다 — 확대된 상태로 지우면 가장자리에 잔상이 남는다');

  // 정적 캐시는 **고정 배율**로 한 번만 굽는다. 라이브 줌을 넘기면 매 프레임 재굽기(프레임당 100ms)가 된다.
  assert.ok(/const SHELL_Z\s*=/.test(src), 'SHELL_Z 고정 배율 상수가 없다');
  const rs = src.indexOf('function riverShell');
  const re = src.indexOf('\n  }', rs);
  assert.ok(/const z = SHELL_Z;/.test(src.slice(rs, re)),
    'riverShell 이 고정 배율(SHELL_Z)이 아닌 값을 쓰고 있다 — 캐시가 매 프레임 다시 구워진다');
});

test('헤엄 스프라이트 시트가 있으면 메타와 서로 맞는다 (없으면 검사 대상 아님)', () => {
  const dir = path.join(__dirname, '..', 'kiosk', 'assets');
  const hasPng = fs.existsSync(path.join(dir, 'dalsu-swim.png'));
  const hasJson = fs.existsSync(path.join(dir, 'dalsu-swim.json'));
  if (!hasPng && !hasJson) return;               // 시트를 안 쓰는 환경 — 정지 이미지로 도는 게 정상이다
  assert.ok(hasPng && hasJson, '시트와 메타는 항상 짝이어야 한다 (한쪽만 있으면 런타임이 폴백한다)');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'dalsu-swim.json'), 'utf8'));
  assert.equal(m.cols * m.cellW, m.sheetW, '열 × 셀너비가 시트 너비와 달라 프레임이 어긋난다');
  assert.equal(m.rows * m.cellH, m.sheetH, '행 × 셀높이가 시트 높이와 달라 프레임이 어긋난다');
  assert.ok(m.frames > 0 && m.frames <= m.cols * m.rows, `프레임 수 ${m.frames} 가 격자를 벗어난다`);
  assert.ok(m.restIndex >= 0 && m.restIndex < m.frames);
  assert.ok(m.phase0 >= 0 && m.phase0 < 1, 'phase0 는 0~1 (검증 스크립트가 측정해 넣는다)');
  assert.ok(m.body.x + m.body.w <= 1 && m.body.y + m.body.h <= 1, '몸 상자는 셀 안에 있어야 한다');
  // 카드 배치는 dalsu-float.png(2403x1705)를 기준으로 계산된다. 시트의 몸 종횡비가 그와 어긋나면
  // 화면의 달수만 눌리거나 늘어난다.
  assert.ok(Math.abs(m.srcAspect - 2403 / 1705) < 0.02, '원본 종횡비 기록이 실제 자산과 다르다');
  assert.ok(Math.abs(m.bodyAspect - m.srcAspect) < 0.05,
    `시트 몸 종횡비 ${m.bodyAspect} 가 원본 ${m.srcAspect} 와 어긋난다 — 캐릭터가 눌려 보인다`);
});

test('성능 저하 단계는 해상도를 낮추지 않는다 (곡선 구간 수만 줄인다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'src', 'renderer.js'), 'utf8');
  const block = src.slice(src.indexOf('const PERF_STEPS'), src.indexOf('const PERF ='));
  assert.ok(block.length > 50, 'PERF_STEPS 블록을 찾지 못함');
  assert.ok(!/scale\s*:/.test(block), '성능 단계에 렌더 배율(scale) 축소가 있다 — 화질이 뭉개진다');
  assert.ok(!/setTransform\(\s*sc/.test(src), 'FX 캔버스를 축소 배율로 그리고 있다');
  const segs = [...block.matchAll(/seg:\s*(\d+)/g)].map((m) => +m[1]);
  assert.ok(segs.length >= 2 && Math.min(...segs) >= 32, '구간 수가 지나치게 낮다: ' + segs.join(','));
});

// SMART-81 은 카드 한 장에 20~40초가 걸린다. 화면이 실제 진행을 보여주려면
// CLI 가 흘리는 단계 표시를 놓치지 않아야 하는데, stdout 은 임의 크기로 잘려 들어온다.
test('인쇄 단계 파서: 표시가 청크 경계에 걸쳐도 놓치지 않는다', () => {
  const { feedStages } = require('../kiosk/src/stagelog');
  const full = [
    '[10:00:01] 프린터 연결(드라이버 모드): SMART-81',
    '##STAGE:connect',
    '[10:00:02] 인쇄 면 설정: 적용',
    '##STAGE:settings',
    '##STAGE:print',
    '[10:00:30] 인쇄 완료',
  ].join('\r\n') + '\r\n';
  // 1바이트씩 흘려 넣어도(최악의 분할) 순서대로 전부 나와야 한다
  let pending = '', got = [];
  for (const ch of full) { const r = feedStages(pending, ch); pending = r.pending; got.push(...r.stages); }
  assert.deepEqual(got, ['connect', 'settings', 'print']);
  assert.equal(pending, '');

  // 로그 문구가 우연히 표시처럼 보여도 줄 시작이 아니면 무시한다
  const r2 = feedStages('', 'x ##STAGE:print\n##STAGE:eject\n');
  assert.deepEqual(r2.stages, ['eject']);
});

// 시안 7·8컷의 프린터 일러스트가 진행 표시의 주연이다.
// renderer 가 #pcard(배출되는 카드)와 #pled(동작 LED)를 조작하므로 이 훅이 사라지면 안 된다.
test('프린터 일러스트에 카드 배출·동작 표시 훅이 있다', () => {
  const art = require('../kiosk/src/art');
  const svg = art.artPrinterSvg();
  assert.match(svg, /id="pcard"/, '배출되는 카드 그룹이 없다');
  assert.match(svg, /id="pled"/, '동작 LED 가 없다');
  const rsrc = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'src', 'renderer.js'), 'utf8');
  assert.match(rsrc, /setProperty\('--out'/, 'renderer 가 카드 배출량을 설정하지 않는다');
  const css = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'src', 'styles.css'), 'utf8');
  assert.match(css, /#pcard/, 'CSS 에 카드 배출 규칙이 없다');
});

// 미리보기는 '인쇄가 끝날 때까지'이므로, 데드맨 스위치 예산이 프린터 타임아웃보다 넉넉해야
// 정상 인쇄 도중에 대기 화면으로 튕기지 않는다.
test('데드맨 예산이 프린터 최대 소요 시간을 덮는다', () => {
  const T = cfg.timing, P = cfg.printer;
  const worstPrint = (P.timeoutMs || 90000) * ((P.retry || 0) + 1);
  const budget = (T.previewMinMs || 6000) + worstPrint + 15000;
  assert.ok(Math.max(budget * 2, 20000) > worstPrint, '데드맨 한계가 인쇄 최대 소요보다 짧다');
  assert.ok(T.previewMinMs > 0 && T.previewMinMs <= 15000, '최소 미리보기 시간이 비상식적');
});

// SMART-81D 는 재전사 방식이라 물리 인쇄가 끝날 때까지 블로킹한다 — 라테일 프로젝트가 같은 장비에서
// 60~90초를 실측했다(latale main.js). 타임아웃을 그 범위에 걸치게 두면 정상 인쇄가 실패로 처리된다.
test('인쇄 타임아웃이 실측 인쇄 시간(60~90초)보다 충분히 길다', () => {
  const t = cfg.printer.timeoutMs;
  assert.ok(t >= 150000, `timeoutMs ${t}ms — 실측 최대 90초와 너무 가깝다 (150000 이상 권장)`);
  assert.ok(t <= 300000, `timeoutMs ${t}ms — 너무 길면 프린터가 죽었을 때 화면이 오래 멈춘다`);
});

// 현장 config.json 은 업데이트가 덮어쓰지 않는다. 그래서 예전 값(90초)이 남아 있으면
// 정상 인쇄(60~90초)가 타임아웃으로 잘려 '카드는 나오는데 화면은 직원 호출'이 된다 — 실제로 그랬다.
// 설정이 짧아도 코드가 최소값으로 끌어올려야 한다.
test('인쇄 타임아웃은 설정이 짧아도 코드가 최소값으로 올린다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'main.js'), 'utf8');
  const m = /PRINT_TIMEOUT_FLOOR_MS\s*=\s*(\d+)/.exec(src);
  assert.ok(m, 'main.js 에 타임아웃 하한이 없다');
  assert.ok(+m[1] >= 150000, `하한 ${m[1]}ms — 실측 인쇄 90초와 너무 가깝다`);
  assert.match(src, /Math\.max\(PRINT_TIMEOUT_FLOOR_MS/, '하한이 실제로 적용되지 않는다');
  assert.doesNotMatch(src, /timeoutMs\s*\|\|\s*90000/, '설정값을 그대로 쓰는 경로가 남아 있다');
});

// 타임아웃 시점에는 카드가 프린터 안에 있을 수 있다. 그대로 재시도하면 잼이 난다.
test('타임아웃 뒤에는 인쇄를 재시도하지 않는다', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'main.js'), 'utf8');
  assert.match(src, /timeout.*test\(r\.stderr/s, 'main.js 에 타임아웃 재시도 차단이 없다');
});

// 화면 문구는 코드가 아니라 config 에서만 바뀐다 — 단계 키가 빠지면 화면이 빈 채로 대기한다
test('인쇄 단계 문구가 CLI 가 내보내는 키를 모두 덮는다', () => {
  const csSrc = fs.readFileSync(path.join(__dirname, '..', 'printer', 'DalsuPrint', 'Program.cs'), 'utf8');
  const emitted = [...csSrc.matchAll(/Stage\("(\w+)"\)/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 5, 'CLI 가 단계를 내보내지 않는다');
  const texts = cfg.screen.printStages || {};
  for (const key of new Set(emitted)) {
    assert.ok(texts[key], 'config.screen.printStages 에 문구 없음: ' + key);
  }
  for (const key of ['start', 'retry', 'done']) {
    assert.ok(texts[key], '앱이 직접 쓰는 단계 문구 없음: ' + key);
  }
  // 현장 config.json 은 업데이트가 덮어쓰지 않으므로, 구버전 config 로도 문구가 나와야 한다.
  const rsrc = fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'src', 'renderer.js'), 'utf8');
  for (const key of [...new Set(emitted), 'start', 'retry', 'done']) {
    assert.ok(new RegExp(key + ':').test(rsrc), 'renderer 에 "' + key + '" 기본 문구가 없다 (구버전 config 에서 화면이 빈다)');
  }
});

test('카드는 Smart-31/51/81 과 같은 CR-80 규격이며 방향이 설정과 일치한다', () => {
  const { width: w, height: h, orientation } = cfg.card;
  const land = w === 1040 && h === 664, port = w === 664 && h === 1040;
  assert.ok(land || port, `카드는 1040x664(가로) 또는 664x1040(세로) — 현재 ${w}x${h}`);
  assert.equal(orientation === 'portrait', port, 'orientation 과 width/height 가 어긋나면 인쇄가 잘린다');
});

test('외부 이미지 자산은 라이선스가 문서로 남아 있다', () => {
  const assets = path.join(__dirname, '..', 'kiosk', 'assets');
  const external = fs.readdirSync(assets).filter((f) => /^(fish|plant|tree)-\d+\.png$/.test(f));
  if (external.length === 0) return;                    // 실사 자산을 안 쓰면 검사할 것도 없다
  const credits = path.join(__dirname, '..', 'docs', 'ASSET_CREDITS.md');
  assert.ok(fs.existsSync(credits), '외부 이미지를 쓰면 출처·라이선스를 문서로 남겨야 한다');
  const md = fs.readFileSync(credits, 'utf8');
  for (const f of external) {
    assert.ok(md.includes(f), `${f} 의 출처가 ASSET_CREDITS.md 에 없다`);
  }
  // 상업적 사용이 가능한 라이선스만 (삼성 행사 납품물)
  const rows = md.split(/\r?\n/).filter((l) => l.startsWith('| `'));
  for (const r of rows) {
    assert.ok(/Public domain|CC0/i.test(r), `상업적 사용이 보장되지 않는 라이선스: ${r.slice(0, 80)}`);
  }
});
