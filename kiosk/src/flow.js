// 체험 흐름 상태 머신 (순수 JS — DOM/타이머 없음, tests/flow.test.js로 검증)
// IDLE → GUIDE → RIVER → NATURE → SWIM → COUNTDOWN → CAPTURE → PREVIEW → DONE → IDLE
//                 (GUIDE 안에서 물방울 4개를 순서 무관하게 터치)
'use strict';

const STATES = Object.freeze({
  IDLE: 'IDLE',
  GUIDE: 'GUIDE',
  RIVER: 'RIVER',
  NATURE: 'NATURE',
  SWIM: 'SWIM',
  COUNTDOWN: 'COUNTDOWN',
  CAPTURE: 'CAPTURE',
  PREVIEW: 'PREVIEW',
  DONE: 'DONE',
  ERROR: 'ERROR',
});

const ORDER = [
  STATES.IDLE, STATES.GUIDE, STATES.RIVER, STATES.NATURE, STATES.SWIM,
  STATES.COUNTDOWN, STATES.CAPTURE, STATES.PREVIEW, STATES.DONE,
];

function createFlow(goalKeys) {
  if (!Array.isArray(goalKeys) || goalKeys.length === 0) throw new Error('goalKeys required');
  const total = goalKeys.length;
  let state = STATES.IDLE;
  let popped = new Set();
  let lastError = null;

  function reset() {
    state = STATES.IDLE;
    popped = new Set();
    lastError = null;
  }

  // 화면 터치로 시작
  function start() {
    if (state !== STATES.IDLE) return false;
    state = STATES.GUIDE;
    return true;
  }

  // 물방울 터치. 반환: { accepted, popped, remaining, allDone }
  function popBubble(key) {
    if (state !== STATES.GUIDE || !goalKeys.includes(key) || popped.has(key)) {
      return { accepted: false, popped: popped.size, remaining: total - popped.size, allDone: false };
    }
    popped.add(key);
    const allDone = popped.size === total;
    if (allDone) state = STATES.RIVER;
    return { accepted: true, popped: popped.size, remaining: total - popped.size, allDone };
  }

  // 연출 단계 완료 시 다음 상태로 (RIVER→NATURE→SWIM→COUNTDOWN→CAPTURE→PREVIEW→DONE→IDLE)
  function advance() {
    const i = ORDER.indexOf(state);
    if (i < 0 || state === STATES.GUIDE || state === STATES.IDLE) return state;
    const next = ORDER[(i + 1) % ORDER.length];
    if (next === STATES.IDLE) reset(); else state = next;
    return state;
  }

  function fail(reason) {
    lastError = reason || 'unknown';
    state = STATES.ERROR;
    return state;
  }

  return {
    get state() { return state; },
    get poppedKeys() { return [...popped]; },
    get lastError() { return lastError; },
    reset, start, popBubble, advance, fail,
  };
}

// 브라우저(renderer, contextIsolation)에서는 전역으로, node(test)에서는 module.exports로 노출
{ const __exports = { STATES, ORDER, createFlow };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
