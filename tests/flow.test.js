'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFlow, STATES } = require('../kiosk/src/flow');

const KEYS = ['carbon', 'water', 'waste', 'pollution'];

test('IDLE에서 터치하면 GUIDE, 다시 start는 무시', () => {
  const f = createFlow(KEYS);
  assert.equal(f.state, STATES.IDLE);
  assert.equal(f.start(), true);
  assert.equal(f.state, STATES.GUIDE);
  assert.equal(f.start(), false);
});

test('물방울 4개를 순서 무관하게 터치하면 RIVER로 전이, 중복·미지 키는 거부', () => {
  const f = createFlow(KEYS);
  f.start();
  assert.equal(f.popBubble('nope').accepted, false);
  assert.deepEqual(f.popBubble('waste'), { accepted: true, popped: 1, remaining: 3, allDone: false });
  assert.equal(f.popBubble('waste').accepted, false, '중복 터치 거부');
  f.popBubble('carbon'); f.popBubble('pollution');
  const last = f.popBubble('water');
  assert.equal(last.allDone, true);
  assert.equal(f.state, STATES.RIVER);
  assert.equal(f.popBubble('carbon').accepted, false, 'RIVER 이후 터치 무시');
});

test('연출 단계는 advance로 순차 진행하고 DONE 다음은 IDLE로 리셋', () => {
  const f = createFlow(KEYS);
  f.start(); KEYS.forEach(k => f.popBubble(k));
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push(f.advance());
  assert.deepEqual(seq, ['NATURE', 'SWIM', 'COUNTDOWN', 'CAPTURE', 'PREVIEW', 'DONE', 'IDLE']);
  assert.deepEqual(f.poppedKeys, [], '리셋 시 물방울 초기화');
});

test('GUIDE/IDLE에서는 advance가 상태를 바꾸지 않는다', () => {
  const f = createFlow(KEYS);
  assert.equal(f.advance(), STATES.IDLE);
  f.start();
  assert.equal(f.advance(), STATES.GUIDE);
});

test('fail은 ERROR로 가고 reset으로 복귀', () => {
  const f = createFlow(KEYS);
  f.start();
  assert.equal(f.fail('printer'), STATES.ERROR);
  assert.equal(f.lastError, 'printer');
  f.reset();
  assert.equal(f.state, STATES.IDLE);
});
