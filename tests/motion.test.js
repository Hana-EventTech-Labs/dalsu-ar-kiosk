'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createParticles, easeOutBack, easeInOut } = require('../kiosk/src/motion');

test('파티클: burst/sparkle/wake/converge 생성 후 수명이 지나면 전부 제거', () => {
  const p = createParticles();
  p.burst(100, 100, '#fff', 20, 1); p.sparkle(10, 10, 5); p.wake(1, 1); p.converge({ x: 0, y: 0 }, { x: 50, y: 50 }, '#abc', 6, 0.5);
  assert.ok(p.size >= 33);
  for (let i = 0; i < 60; i++) p.update(0.05); // 3초 경과
  assert.equal(p.size, 0);
});

test('파티클: update는 위치를 바꾸고 draw는 최소 ctx 인터페이스로 예외 없이 실행', () => {
  const p = createParticles();
  p.burst(0, 0, '#fff', 3, 1);
  p.update(0.1);
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'globalAlpha' ? 1 : (...a) => { calls.push(k); }), set: () => true });
  p.draw(ctx);
  assert.ok(calls.includes('arc') && calls.includes('fill'));
  p.clear(); assert.equal(p.size, 0);
});

test('이징 함수 경계값', () => {
  assert.equal(+easeOutBack(0).toFixed(6), 0); assert.equal(+easeOutBack(1).toFixed(6), 1);
  assert.ok(easeOutBack(0.7) > 1, '오버슈트');
  assert.equal(easeInOut(0.5), 0.5);
});

test('물 알갱이 모임(collect): n개가 stagger 간격으로 출발해 목표점에 도착하며 onArrive 를 n번 부르고 사라진다', () => {
  const p = createParticles();
  const arrived = [];
  p.collect({ x: 100, y: 500 }, { x: 300, y: 100 }, '#00b3e3', 6, { dur: 0.7, stagger: 0.04, scale: 1, onArrive: (i, x, y) => arrived.push([i, x, y]) });
  assert.equal(p.size, 6);
  p.update(0.69);                                   // 첫 알갱이는 아직
  assert.equal(arrived.length, 0);
  for (let t = 0; t < 0.04 * 5 + 0.02; t += 0.01) p.update(0.01);   // 0.7 + 마지막 지연 0.2 까지
  assert.equal(arrived.length, 6, '알갱이마다 정확히 한 번');
  assert.deepEqual(arrived.map((a) => a[0]).sort(), [0, 1, 2, 3, 4, 5]);
  for (const a of arrived) { assert.equal(a[1], 300); assert.equal(a[2], 100); }
  assert.equal(p.size, 0, '도착한 알갱이는 남지 않는다');
});

test('collect 파티클은 최소 ctx 인터페이스로 그려진다 (베지어 곡선 위 위치)', () => {
  const p = createParticles();
  p.collect({ x: 0, y: 0 }, { x: 100, y: -100 }, '#fff', 3, { dur: 1, stagger: 0 });
  p.update(0.5);
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'globalAlpha' ? 1 : (...a) => { calls.push([k, a]); }), set: () => true });
  p.draw(ctx);
  const arcs = calls.filter((c) => c[0] === 'arc');
  assert.ok(arcs.length >= 3);
  for (const [, a] of arcs) assert.ok(a[0] >= -100 && a[0] <= 200 && a[1] >= -200 && a[1] <= 100, '곡선이 화면 근처를 벗어나지 않는다');
  assert.equal(easeInOut(0.25), 0.125, 'easeInOutQuad 식(스펙)');
});
