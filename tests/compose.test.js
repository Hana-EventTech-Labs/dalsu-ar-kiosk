'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { coverCrop, dalsuPlacement, LAYERS } = require('../kiosk/src/compose');
const river = require('../kiosk/src/river');

test('coverCrop: 16:9 프레임을 1012×636 카드에 cover — 좌우 크롭, 중앙 정렬', () => {
  const c = coverCrop(1280, 720, 1012, 636);
  assert.equal(c.sh, 720);
  assert.equal(c.sw, Math.round(720 * 1012 / 636));
  assert.equal(c.sy, 0);
  assert.equal(c.sx, Math.round((1280 - c.sw) / 2));
});

test('coverCrop: 세로 프레임은 상하 크롭', () => {
  const c = coverCrop(720, 1280, 1012, 636);
  assert.equal(c.sw, 720);
  assert.equal(c.sx, 0);
  assert.ok(c.sh < 1280 && c.sy > 0);
});

test('coverCrop: 0 크기는 예외', () => {
  assert.throws(() => coverCrop(0, 10, 10, 10));
});

test('dalsuPlacement: 카드 안에 들어오고 앵커별 x가 다르다', () => {
  const r = dalsuPlacement(1012, 636, 400, 600, 0.42, 'bottom-right');
  const l = dalsuPlacement(1012, 636, 400, 600, 0.42, 'bottom-left');
  const c = dalsuPlacement(1012, 636, 400, 600, 0.42, 'bottom-center');
  for (const p of [r, l, c]) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 1012 && p.y + p.h <= 636, JSON.stringify(p));
    assert.equal(p.h, Math.round(636 * 0.42));
  }
  assert.ok(l.x < c.x && c.x < r.x);
});

test('LAYERS 순서: 사진이 맨 아래, 달수가 자연 위', () => {
  assert.equal(LAYERS[0], 'photo');
  assert.ok(LAYERS.indexOf('dalsu') > LAYERS.indexOf('nature'));
});

test('river: 시냇물 — 위 가운데 합류점에서 굽이쳐 내려와 왼쪽 아래로 빠져나간다', () => {
  const pts = river.samples(50);
  for (const [x, y] of pts) assert.ok(x >= 0 && x <= 1, `x가 화면 안이어야 (${x})`);
  const s = river.pointAt(0), m = river.pointAt(0.5), e = river.pointAt(1);
  assert.ok(Math.abs(s[0] - 0.5) < 0.03 && s[1] < 0.45, `합류점은 위 가운데 (${s})`);
  assert.equal(+m[0].toFixed(3), 0.5, '중간점은 가로 중앙 — 달수 도착점');
  assert.ok(m[1] > 0.5 && m[1] < 0.7, `달수 도착점 y(${m[1]})는 화면 중앙보다 살짝 아래(원근상 가깝게)`);
  assert.ok(e[0] < 0.4, `하류는 왼쪽 아래 (${e})`);
  assert.ok(e[1] > 1, '물길은 화면 아래로 빠져나가야 한다 (끊긴 오브젝트로 보이지 않게)');
  assert.ok(river.pointAt(1.5)[0] === river.pointAt(1)[0], '범위 밖은 클램프');
});

test('river: svgPath는 M/C 명령 2개, natureSlots는 좌우 교대', () => {
  const d = river.svgPath(1000, 1000);
  assert.ok(d.startsWith('M ') && (d.match(/ C /g) || []).length === 2);
  const slots = river.natureSlots(6);
  assert.equal(slots.length, 6);
  assert.deepEqual(slots.map(s => s.side), [1, -1, 1, -1, 1, -1]);
  assert.ok(slots.every(s => s.u > 0 && s.u < 1));
});

test('프레임 구멍 사진 크롭(holePhotoCrop): zoom1·shift0 은 coverCrop 과 같고, 확대·이동은 소스 안에 머문다', () => {
  const { holePhotoCrop, coverCrop } = require('../kiosk/src/compose');
  const base = coverCrop(1280, 720, 596, 634);
  const c0 = holePhotoCrop(1280, 720, 596, 634, 1, 0, 0, false);
  assert.deepEqual(c0, base, '기본값은 cover 와 동일');
  const z = holePhotoCrop(1280, 720, 596, 634, 1.25, 0, 0, false);
  assert.ok(z.sw < base.sw && z.sh < base.sh, '확대하면 창이 작아진다');
  assert.ok(Math.abs((z.sx + z.sw / 2) - 640) <= 1 && Math.abs((z.sy + z.sh / 2) - 360) <= 1, '이동 없으면 가운데');
  const r = holePhotoCrop(1280, 720, 596, 634, 1, 0.3, 0, false);
  assert.ok(r.sx < base.sx, '+x(피사체 오른쪽) 는 창이 왼쪽으로 (비반전)');
  const rm = holePhotoCrop(1280, 720, 596, 634, 1, 0.3, 0, true);
  assert.ok(rm.sx > base.sx, '반전(미러)이면 창이 오른쪽으로 — 인쇄에서 피사체가 오른쪽으로 가는 방향이 같다');
  const far = holePhotoCrop(1280, 720, 596, 634, 1.5, 0.5, -0.5, false);
  assert.ok(far.sx >= 0 && far.sy >= 0 && far.sx + far.sw <= 1280 && far.sy + far.sh <= 720, '창은 소스 밖으로 나가지 않는다(빈 띠 방지)');
});
