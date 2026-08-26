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
// 헤엄 자세 — 위상(phase)에 따른 몸통 흔들림·상하 부침·좌우 늘어남
function swimPose(phase) {
  return {
    roll: Math.sin(phase) * 0.13,          // 몸통 좌우 흔들림(rad)
    bob: Math.sin(phase * 2 + 0.6) * 0.5,  // 상하 부침 (-0.5~0.5, 호출부가 픽셀로 환산)
    sx: 1 + Math.sin(phase * 2) * 0.06,    // 물을 밀 때 가로로 늘어남
    sy: 1 - Math.sin(phase * 2) * 0.06,
  };
}

function createParticles() {
  const list = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  return {
    get size() { return list.length; },
    clear() { list.length = 0; },
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
    // 반짝임(별) — 등장/완성 순간
    sparkle(x, y, n, color) {
      for (let i = 0; i < (n || 8); i++) {
        const a = rnd(0, Math.PI * 2), v = rnd(60, 220);
        list.push({ kind: 'star', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rnd(4, 9), life: rnd(0.4, 0.8), t: 0, color: color || '#ffffff', spin: rnd(-4, 4) });
      }
    },
    // 물결 궤적(달수 뒤)
    wake(x, y) {
      list.push({ kind: 'wake', x: x + rnd(-6, 6), y: y + rnd(-6, 6), r: rnd(6, 12), vr: 70, life: 0.9, t: 0, color: 'rgba(255,255,255,.6)', w: 3 });
    },
    // 대기 화면 배경 방울(천천히 떠오름)
    ambient(W, H) {
      list.push({ kind: 'drop', x: rnd(0, W), y: H + 20, vx: rnd(-15, 15), vy: rnd(-40, -90), r: rnd(6, 18), g: 0, life: rnd(6, 10), t: 0, color: 'rgba(255,255,255,.35)' });
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]; p.t += dt;
        if (p.t < 0) continue;
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
