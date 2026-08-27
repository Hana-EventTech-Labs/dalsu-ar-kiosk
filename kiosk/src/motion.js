// 행사용 연출 보조 — 파티클(물방울 터짐·모임·반짝임·물결)과 WebAudio 효과음. DOM 의존 없음(캔버스 ctx만 받음).
'use strict';

const easeOutBack = (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
// 헤엄 이징 — 등속 슬라이드가 아니라 "차고(surge) → 미끄러짐(glide)"이 반복되는 진행.
// 도함수 1-0.6cos ≥ 0.4 이라 항상 전진(뒤로 가지 않음). strokes = 왕복 횟수.
function swimEase(p, strokes) {
  const k = strokes || 4;
  const c = Math.min(1, Math.max(0, p));
  const w = 2 * Math.PI * k;
  return c - Math.sin(w * c) / w * 0.6;
}
// 헤엄 자세 — 한 번의 스트로크(θ 0→2π) 안에서 몸이 어떻게 움직이는가.
// θ 는 swimEase 의 위상과 같은 값을 넣어야 몸짓과 실제 전진이 맞물린다(따로 돌면 '허우적'거려 보인다).
//   · 물을 차는 구간(θ 0~π): 몸이 앞으로 뻗고 살짝 가라앉았다가 솟구친다
//   · 미끄러지는 구간(θ π~2π): 몸이 펴지고 천천히 떠오른다
function swimPose(theta) {
  const t = theta;
  // swimEase 의 전진 속도는 1-0.6cos(θ) 이라 θ=π 에서 가장 빠르다.
  // 물을 차는 힘도 여기에 맞춰야 '차는 동작 = 빨라지는 순간'이 되어 허우적거려 보이지 않는다.
  const push = Math.max(0, -Math.cos(t));           // 차는 힘 (0~1), θ=π 에서 최대
  return {
    roll: Math.sin(t) * 0.10 + Math.sin(t * 2 + 0.6) * 0.035,   // 좌우 흔들림 — 두 파형을 겹쳐 기계적이지 않게
    bob: Math.sin(t * 2 - 0.5) * 0.55 + Math.sin(t + 1.0) * 0.30, // 상하 부침 (스트로크당 두 번 출렁)
    sx: 1 + push * 0.075 - 0.02,                    // 물을 밀 때 앞뒤로 늘어남
    sy: 1 - push * 0.06 + 0.02,                     // 그만큼 위아래로 눌림
    sink: 0.5 + Math.sin(t * 2 - 0.5) * 0.5,        // 물에 잠기는 정도 0~1 (그림자·물보라 세기에 쓴다)
    push,                                            // 물보라 세기
  };
}

function createParticles() {
  const list = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  return {
    get size() { return list.length; },
    clear() { list.length = 0; },
    // 지류를 따라 흐르는 방울만 제거 — 지류가 본류에 흡수된 뒤에도 남아 떠다니지 않게
    clearFlow() { for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === 'flow') list.splice(i, 1); },
    // 물방울 터짐: 사방으로 튀는 작은 방울 + 링
    burst(x, y, color, n, scale) {
      const s = scale || 1;
      for (let i = 0; i < (n || 26); i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(180, 520) * s;
        list.push({ kind: 'drop', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120 * s, r: rnd(5, 14) * s, g: 900 * s, life: rnd(0.5, 0.9), t: 0, color });
      }
      list.push({ kind: 'ring', x, y, r: 10 * s, vr: 900 * s, life: 0.55, t: 0, color: 'rgba(255,255,255,.9)', w: 6 * s });
    },
    // 모임: 출발점 → 목표점으로 곡선 이동(물방울들이 물길 시작점으로 모임)
    converge(from, to, color, n, dur) {
      for (let i = 0; i < (n || 12); i++) {
        list.push({ kind: 'fly', x0: from.x + rnd(-40, 40), y0: from.y + rnd(-40, 40), x1: to.x, y1: to.y, bend: rnd(-160, 160), r: rnd(6, 13), life: dur, t: -i * 0.02, color });
      }
    },
    // 물 스플래시 — 물방울을 터뜨린 순간(시안 3컷). 위로 솟는 물기둥 + 사방 물보라 + 퍼지는 링 2겹
    splash(x, y, color, scale) {
      const s = scale || 1;
      // 물기둥: 위로 길게 솟았다 떨어지는 굵은 방울
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI / 2 + rnd(-0.55, 0.55), v = rnd(520, 980) * s;
        list.push({ kind: 'drop', x: x + rnd(-8, 8) * s, y, vx: Math.cos(a) * v * 0.45, vy: Math.sin(a) * v,
          r: rnd(9, 22) * s, g: 1500 * s, life: rnd(0.6, 1.0), t: 0, color });
      }
      // 사방 물보라
      for (let i = 0; i < 26; i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(240, 720) * s;
        list.push({ kind: 'drop', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 180 * s,
          r: rnd(4, 12) * s, g: 1200 * s, life: rnd(0.45, 0.8), t: 0, color });
      }
      // 퍼지는 링 2겹 (물 표면 파문)
      list.push({ kind: 'ring', x, y, r: 8 * s, vr: 1250 * s, life: 0.5, t: 0, color: 'rgba(255,255,255,.95)', w: 8 * s });
      list.push({ kind: 'ring', x, y, r: 4 * s, vr: 760 * s, life: 0.75, t: 0.08, color: 'rgba(190,230,246,.85)', w: 5 * s });
    },
    // 지류를 따라 흐르는 물방울 — 4줄기 합류 연출용. path(u)->[x,y] 를 받아 그 위를 흘러간다
    stream(pathFn, color, n, dur, scale) {
      const s = scale || 1;
      for (let i = 0; i < (n || 6); i++) {
        list.push({ kind: 'flow', path: pathFn, off: rnd(-4, 4) * s, r: rnd(2.6, 5.6) * s,
          life: dur || 1.2, t: -rnd(0, dur || 1.2), color });
      }
    },
    // 반짝임(별) — 등장/완성 순간
    sparkle(x, y, n, color) {
      for (let i = 0; i < (n || 8); i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(60, 220);
        list.push({ kind: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rnd(4, 9), life: rnd(0.4, 0.8), t: 0, color: color || '#ffffff', spin: rnd(-4, 4) });
      }
    },
    // 물결 궤적(달수 뒤)
    wake(x, y) {
      list.push({ kind: 'wake', x: x + rnd(-6, 6), y: y + rnd(-5, 5), r: rnd(5, 11), vr: 62, life: 0.85, t: 0, color: 'rgba(255,255,255,.7)', w: 3 });
    },
    // 대기 화면 배경 방울(천천히 떠오름)
    ambient(W, H) {
      list.push({ kind: 'drop', x: rnd(0, W), y: H + 20, vx: rnd(-15, 15), vy: rnd(-40, -90), r: rnd(6, 18), g: 0, life: rnd(6, 10), t: 0, color: 'rgba(255,255,255,.35)' });
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]; p.t += dt;
        if (p.t < 0) continue;
        if (p.kind === 'flow') { if (p.t >= p.life) p.t = 0; continue; }  // 지류 방울은 사라지지 않고 계속 흐른다
        if (p.t >= p.life) { list.splice(i, 1); continue; }
        if (p.kind === 'drop' || p.kind === 'star') { p.x += p.vx * dt; p.y += p.vy * dt; if (p.g) p.vy += p.g * dt; }
        else if (p.kind === 'ring' || p.kind === 'wake') { p.r += p.vr * dt; }
      }
    },
    draw(ctx) {
      for (const p of list) {
        if (p.t < 0) continue;
        const k = p.t / p.life, alpha = 1 - k;
        ctx.save(); ctx.globalAlpha = alpha;
        if (p.kind === 'drop') { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.28, 0, Math.PI * 2); ctx.fill(); }
        else if (p.kind === 'ring' || p.kind === 'wake') { ctx.strokeStyle = p.color; ctx.lineWidth = p.w; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke(); }
        else if (p.kind === 'fly') { const e = easeInOut(k); const mx = (p.x0 + p.x1) / 2 + p.bend, my = (p.y0 + p.y1) / 2 - Math.abs(p.bend); const x = (1 - e) * (1 - e) * p.x0 + 2 * (1 - e) * e * mx + e * e * p.x1, y = (1 - e) * (1 - e) * p.y0 + 2 * (1 - e) * e * my + e * e * p.y1; ctx.globalAlpha = 0.95; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill(); }
        else if (p.kind === 'flow') {
          const [fx, fy] = p.path(p.t / p.life);
          ctx.globalAlpha = Math.min(1, Math.sin((p.t / p.life) * Math.PI) * 1.6);
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(fx + p.off, fy, p.r, 0, Math.PI * 2); ctx.fill();
        }
        else if (p.kind === 'star') { ctx.translate(p.x, p.y); ctx.rotate(p.t * p.spin); ctx.fillStyle = p.color; ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.lineTo(0, -p.r); ctx.lineTo(p.r * 0.35, -p.r * 0.35); ctx.rotate(Math.PI / 2); } ctx.closePath(); ctx.fill(); }
        ctx.restore();
      }
    },
  };
}

// 효과음 — 파일 없이 WebAudio로 합성 (팝/틱/셔터/차임/휘익). enabled=false면 전부 무음.
function createSound(enabled) {
  let ctx = null;
  const ac = () => { if (!enabled) return null; if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  const tone = (f0, f1, dur, type, gain) => { const c = ac(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, c.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.currentTime + dur); g.gain.setValueAtTime(gain || 0.18, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur); o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + dur); };
  const noise = (dur, gain) => { const c = ac(); if (!c) return; const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = c.createBufferSource(); s.buffer = buf; const g = c.createGain(); g.gain.value = gain || 0.25; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200; s.connect(f).connect(g).connect(c.destination); s.start(); };
  return {
    unlock() { ac(); },
    pop() { tone(520, 180, 0.18, 'sine', 0.2); noise(0.06, 0.08); },
    tick() { tone(880, 880, 0.08, 'square', 0.08); },
    go() { tone(660, 1320, 0.25, 'triangle', 0.18); },
    shutter() { noise(0.12, 0.35); tone(200, 60, 0.12, 'square', 0.12); },
    chime() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, f, 0.5, 'sine', 0.14), i * 110)); },
    whoosh() { tone(220, 900, 0.7, 'sawtooth', 0.05); noise(0.5, 0.06); },
    bloom() { tone(700, 1100, 0.2, 'sine', 0.08); },
  };
}

{ const __exports = { easeOutBack, easeInOut, swimEase, swimPose, createParticles, createSound };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
