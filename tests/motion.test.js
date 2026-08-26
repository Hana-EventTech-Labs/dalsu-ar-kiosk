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
