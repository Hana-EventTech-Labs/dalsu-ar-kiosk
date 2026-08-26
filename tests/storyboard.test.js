// 시안(8컷) 기준 순서·좌표 규칙 검증 — 순수 모듈만 대상
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STATES, ORDER, createFlow } = require('../kiosk/src/flow');
const { swimEase, swimPose } = require('../kiosk/src/motion');
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
  const auto = T.achieveMs + T.riverFormMs + T.natureMs + T.swimMs
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
  assert.equal(texts.carbon, '2050년 탄소중립 달성');
  assert.equal(texts.water, '2030년 용수 취수량 2021년 수준으로 절감');
  assert.equal(texts.waste, '2030년 폐기물 재활용률 99.9% 달성');
  assert.equal(texts.pollution, '2040년 대기·수질 오염물질 자연상태 수준으로 저감');
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

test('헤엄 자세: 몸통이 흔들리고 좌우/상하 늘어남이 반대로 움직인다', () => {
  const a = swimPose(0.4), b = swimPose(0.4 + Math.PI);
  assert.ok(Math.abs(a.roll - b.roll) > 0.1, '위상에 따라 몸통 각도가 바뀐다');
  for (const ph of [0, 0.7, 1.9, 3.3]) {
    const p = swimPose(ph);
    assert.ok(Math.abs(p.sx + p.sy - 2) < 1e-9, '가로로 늘면 세로는 그만큼 줄어든다');
    assert.ok(Math.abs(p.bob) <= 0.5);
  }
});

test('카드 AR 영역: 인물 얼굴이 있는 상단은 비우고 하단에만 배치', () => {
  const box = artBox(cfg.card.artTop);
  assert.ok(box.y >= 0.5, '물 영역은 카드 아래 절반부터 시작해야 얼굴을 가리지 않는다');
  assert.equal(+(box.y + box.h).toFixed(6), 1);
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    const [x, y] = river.pointIn(u, box);
    assert.ok(x >= 0 && x <= 1, 'x는 카드 안');
    assert.ok(y >= box.y - 1e-9 && y <= 1 + 1e-9, `u=${u} 의 y(${y})가 물 영역 밖`);
  }
  assert.equal(river.samplesIn(10, box).length, 11);
  assert.ok(river.natureSlotsIn(8, 0.13, box).every((s) => s.y > 0.3));
});

test('합성 레이어에 하단 흰 띠(frame)가 없다', () => {
  assert.ok(!LAYERS.includes('frame'), '기획에 없던 하단 띠는 그리지 않는다');
  assert.equal(LAYERS[0], 'photo');
  assert.ok(LAYERS.indexOf('dalsu') > LAYERS.indexOf('river'));
});

test('촬영 화면은 기본으로 비어 있다', () => {
  assert.equal(cfg.screen.captureOverlay, false, '촬영 중 달수·물길이 사람을 가리면 안 된다');
});

test('물길은 화면 중앙에서 양쪽으로 뻗어 완성된다 (기획 4번)', () => {
  const mid = river.pointAt(0.5);
  assert.deepEqual(mid.map((v) => +v.toFixed(3)), [0.5, 0.5], '경로 중앙이 화면 중앙이어야 물방울이 중앙으로 모인다');
  const tiny = river.samplesRange(8, 0.5 - 0.02, 0.5 + 0.02);
  for (const [x, y] of tiny) {
    assert.ok(Math.abs(x - 0.5) < 0.12 && Math.abs(y - 0.5) < 0.12, '초반에는 중앙 주변만 그려진다');
  }
  const full = river.samplesRange(8, 0, 1);
  assert.deepEqual(full[0].map((v) => +v.toFixed(3)), river.pointAt(0).map((v) => +v.toFixed(3)));
  assert.deepEqual(full[8].map((v) => +v.toFixed(3)), river.pointAt(1).map((v) => +v.toFixed(3)));
});

test('강물 띠: 폭이 발원지·하구에서 좁고 가운데가 넓다', () => {
  assert.ok(water.widthAt(0.5, 0.2) > water.widthAt(0.02, 0.2));
  assert.ok(water.widthAt(0.5, 0.2) > water.widthAt(0.98, 0.2));
  assert.ok(Math.abs(water.widthAt(0, 0.2) - 0.2) < 1e-9, '끝은 minTaper 폭');
  assert.ok(Math.abs(water.widthAt(0.5, 0.2) - 1) < 1e-9, '가운데가 최대 폭');
});

test('강물 띠: 좌우 둑이 중심선에서 같은 거리만큼 벌어진다', () => {
  const pts = river.samples(40).map(([x, y]) => [x * 1000, y * 1000]);
  const band = water.bandPolygon(pts, 120, 0.3);
  assert.equal(band.left.length, pts.length);
  for (let i = 0; i < pts.length; i++) {
    const dl = Math.hypot(band.left[i][0] - pts[i][0], band.left[i][1] - pts[i][1]);
    const dr = Math.hypot(band.right[i][0] - pts[i][0], band.right[i][1] - pts[i][1]);
    assert.ok(Math.abs(dl - dr) < 1e-6, '중심선 기준 대칭');
    assert.ok(dl <= 60 + 1e-6 && dl > 0, `폭이 범위 안이어야 (i=${i}, ${dl})`);
  }
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
