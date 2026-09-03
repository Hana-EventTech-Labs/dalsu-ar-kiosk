'use strict';
// 현장 설정 오버레이 — 콘텐츠는 앱 업데이트로, 현장값은 현장 파일로. (2026-09-03 v0.7.4 배포 사고 재발 방지)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveConfig, extractSite, isLegacyFull, deepMerge, diffPaths, SITE_PATHS } = require('../kiosk/src/siteconfig');

const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'kiosk', 'config.json'), 'utf8'));

test('현장 파일이 없으면 번들 config 그대로 + 현장값만 담은 오버레이를 새로 만든다', () => {
  const r = resolveConfig(bundled, null);
  assert.equal(r.migrated, true); assert.equal(r.reason, 'created');
  assert.deepEqual(r.config, bundled);
  assert.ok(typeof r.overrides._readme === 'string' && r.overrides._readme.length > 20, '현장 담당자가 읽을 안내가 있어야 한다');
  assert.deepEqual(Object.keys(r.overrides).filter((k) => !k.startsWith('_')).sort(), ['camera', 'card', 'output', 'printer', 'river', 'sound', 'update']);
  assert.deepEqual(r.overrides.card, { backRotate: bundled.card.backRotate }, '카드는 backRotate 만 현장값');
  assert.deepEqual(r.overrides.river, { quality: bundled.river.quality }, '물길은 quality 만 현장값');
});

test('예전 전체 복사본(4개 메뉴·옛 색·옛 부제)이 있어도 콘텐츠는 번들을 따르고 현장값만 살아남는다', () => {
  // v0.7.3 시절 현장 파일을 흉내 낸다: 콘텐츠는 옛것, 현장값은 실장비용
  const legacy = JSON.parse(JSON.stringify(bundled));
  legacy.goals = legacy.goals.map((g) => ({ ...g, color: '#7fb3ea', stage: undefined }));
  legacy.screen.headSub = '물을 아끼고, 다시 쓰고, 재활용하고, 자연에 돌려주는\n물 순환의 4단계';
  legacy.printer.mode = 'smart'; legacy.printer.deviceDesc = 'SMART-81 Card Printer';
  legacy.camera.deviceId = 'cam-1234'; legacy.card.backRotate = 180; legacy.river.quality = 'low';
  legacy.update.checkMinutes = 15;
  assert.equal(isLegacyFull(legacy), true);

  const r = resolveConfig(bundled, legacy);
  assert.equal(r.migrated, true); assert.equal(r.reason, 'legacy');
  // 콘텐츠 = 번들
  assert.deepEqual(r.config.goals, bundled.goals, '메뉴는 앱 업데이트를 따라야 한다');
  assert.equal(r.config.screen.headSub, bundled.screen.headSub);
  // 현장값 = 현장 파일
  assert.equal(r.config.printer.mode, 'smart'); assert.equal(r.config.printer.deviceDesc, 'SMART-81 Card Printer');
  assert.equal(r.config.camera.deviceId, 'cam-1234'); assert.equal(r.config.card.backRotate, 180);
  assert.equal(r.config.river.quality, 'low'); assert.equal(r.config.update.checkMinutes, 15);
  // 카드 규격·물길 경로 같은 나머지는 번들
  assert.equal(r.config.card.width, bundled.card.width); assert.deepEqual(r.config.river.path, bundled.river.path);
  // 새 오버레이에는 콘텐츠 키가 없어야 다음 업데이트도 자동 반영된다
  for (const k of ['goals', 'screen', 'timing', 'swim', 'scene', 'event']) assert.ok(!(k in r.overrides), `${k} 는 오버레이에 남으면 안 된다`);
  assert.equal(isLegacyFull(r.overrides), false);
});

test('오버레이 방식 현장 파일은 적힌 키만 덮는다 (객체 재귀 병합, 배열·원시값 교체, _키 무시)', () => {
  const site = { _readme: 'x', printer: { mode: 'smart' }, camera: { deviceId: 'abc' } };
  const r = resolveConfig(bundled, site);
  assert.equal(r.migrated, false); assert.equal(r.reason, 'overlay');
  assert.equal(r.config.printer.mode, 'smart');
  assert.equal(r.config.printer.sdk, bundled.printer.sdk, '안 적은 형제 키는 번들 값 유지');
  assert.equal(r.config.camera.width, bundled.camera.width);
  assert.ok(!('_readme' in r.config));
  assert.deepEqual(diffPaths(bundled, r.config).sort(), ['camera.deviceId', 'printer.mode'].filter((p) => JSON.stringify(p.split('.').reduce((o, k) => o[k], bundled)) !== JSON.stringify(p.split('.').reduce((o, k) => o[k], r.config))));
});

test('현장에서 급하게 콘텐츠 키를 오버레이에 적으면 그것도 덮인다 (긴급 수정 통로)', () => {
  const site = { screen: { guideText: '여기를 눌러요' } };
  assert.equal(isLegacyFull(site), false, '콘텐츠 키 하나는 전체 복사본이 아니다');
  const r = resolveConfig(bundled, site);
  assert.equal(r.migrated, false);
  assert.equal(r.config.screen.guideText, '여기를 눌러요');
  assert.equal(r.config.screen.headTitle, bundled.screen.headTitle);
});

test('deepMerge 는 원본을 바꾸지 않고, 배열은 통째로 교체한다', () => {
  const a = { x: { y: 1, z: [1, 2] }, k: 'a' }, b = { x: { z: [9] } };
  const m = deepMerge(a, b);
  assert.deepEqual(m, { x: { y: 1, z: [9] }, k: 'a' });
  assert.deepEqual(a, { x: { y: 1, z: [1, 2] }, k: 'a' });
});

test('SITE_PATHS 는 모두 번들 config 에 실제로 존재한다 (오타 방지)', () => {
  for (const p of SITE_PATHS) {
    const v = p.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), bundled);
    assert.notEqual(v, undefined, `${p} 가 config.json 에 없다`);
  }
  assert.deepEqual(Object.keys(extractSite(bundled)).sort(), ['camera', 'card', 'output', 'printer', 'river', 'sound', 'update']);
});
