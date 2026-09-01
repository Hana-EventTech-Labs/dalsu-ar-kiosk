// 동화풍 벡터 아트 — 물방울 아이콘(SVG 문자열) + 캔버스용 자연 요소 스프라이트(Path2D). 디자인 캔버스(gen.py)와 동일 형태·팔레트.
'use strict';

const ART_ICONS = {
  cloud: '<path d="M18 40h30a12 12 0 0 0 0-24 16 16 0 0 0-30-4 10 10 0 0 0 0 28z" fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round"/>',
  drop: '<path d="M32 8c10 14 18 22 18 32a18 18 0 0 1-36 0c0-10 8-18 18-32z" fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round"/>',
  // 재활용 — 화살표 3개를 120°씩 돌려 배치 (시안의 초록 재활용 마크)
  recycle: '<g fill="#2f3a44" transform="translate(32 32)">'
    + '<g transform="rotate(0)"><path d="M0 -23 l7.5 13 h-4.2 v10.5 h-6.6 v-10.5 h-4.2 z"/></g>'
    + '<g transform="rotate(120)"><path d="M0 -23 l7.5 13 h-4.2 v10.5 h-6.6 v-10.5 h-4.2 z"/></g>'
    + '<g transform="rotate(240)"><path d="M0 -23 l7.5 13 h-4.2 v10.5 h-6.6 v-10.5 h-4.2 z"/></g></g>',
  // 오염물질 — 굴뚝 공장 + 배출구 물결 (시안 4번째 물방울)
  factory: '<g fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">'
    + '<path d="M10 50V28l13 8V28l13 8V16h10v34z"/>'
    + '<path d="M8 56h48"/><path d="M14 44h4M28 44h4M42 44h4"/></g>',
  sprout: '<path d="M32 56V30M32 30c-14 0-18-10-18-18 10 0 18 6 18 18zM32 34c14 0 18-10 18-18-10 0-18 6-18 18z" fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>',
  // ---- 2026-09-01 콘텐츠 수정: Reduce / Reuse / Recycle / Return (물 순환 4단계) ----
  // Reduce — 물방울 + 아래 화살표(사용량을 줄인다)
  reduce: '<g fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">'
    + '<path d="M26 8c8 11 14 18 14 26a14 14 0 0 1-28 0c0-8 6-15 14-26z"/>'
    + '<path d="M50 32v22M43 47l7 7 7-7"/></g>',
  // Reuse — 물방울 둘레를 도는 두 화살표(다시 쓴다)
  reuse: '<g fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">'
    + '<path d="M32 22c4 5 7 9 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13z"/>'
    + '<path d="M50 30a19 19 0 0 0-33-9M14 34a19 19 0 0 0 33 9"/>'
    + '<path d="M17 12v10h10M47 52V42H37"/></g>',
  // Return — 물방울이 새싹(자연)으로 돌아간다
  return_: '<g fill="none" stroke="#2f3a44" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">'
    + '<path d="M32 6c5 7 9 12 9 17a9 9 0 0 1-18 0c0-5 4-10 9-17z"/>'
    + '<path d="M32 34v22"/><path d="M32 46c-10 0-14-7-14-13 8 0 14 5 14 13zM32 50c10 0 14-7 14-13-8 0-14 5-14 13z"/></g>',
};
function artIconSvg(key, color) {
  const c = color || '#2f3a44';
  const body = (ART_ICONS[key] || ART_ICONS.sprout)
    .replace(/stroke="#2f3a44"/g, `stroke="${c}"`)
    .replace(/fill="#2f3a44"/g, `fill="${c}"`);
  return `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
}

// 눈물방울(물방울) 모양 — 시안 1~4컷의 물방울 버튼. viewBox 100×132, 위가 뾰족.
const ART_DROP_PATH = 'M50 4 C 74 42, 94 62, 94 84 A 44 48 0 1 1 6 84 C 6 62, 26 42, 50 4 Z';
const ART_DROP_COLOR = '#63bfe4';
function artDropSvg(id, color) {
  return `<svg class="drop" viewBox="0 0 100 132" preserveAspectRatio="none" aria-hidden="true">
  <defs><radialGradient id="dg${id}" cx="34%" cy="26%" r="78%">
    <stop offset="0" stop-color="#ffffff"/><stop offset="55%" stop-color="${color}"/><stop offset="100%" stop-color="${color}" stop-opacity=".55"/>
  </radialGradient></defs>
  <path d="${ART_DROP_PATH}" fill="url(#dg${id})" stroke="#ffffff" stroke-width="4"/>
  <ellipse cx="34" cy="52" rx="11" ry="16" fill="#ffffff" opacity=".55" transform="rotate(-20 34 52)"/>
</svg>`;
}

// 손가락 터치 커서 — 시안 2컷
function artHandSvg() {
  return `<svg viewBox="0 0 64 84" aria-hidden="true">
  <path d="M24 46V16a7 7 0 0 1 14 0v22h4a14 14 0 0 1 14 14v10a20 20 0 0 1-20 20H30a16 16 0 0 1-13-6.7L6 60a7 7 0 0 1 11-8l7 8z"
        fill="#ffffff" stroke="#7fb3d3" stroke-width="3" stroke-linejoin="round"/>
</svg>`;
}

// 포토카드 프린터 — 시안 8컷 (출력 중 표시)
function artPrinterSvg() {
  // 시안 7·8컷의 프린터. 카드가 배출구에서 **실제로 밀려나온다** — 진행 단계에 따라 renderer 가
  // --out(0~1)을 올린다. 20~40초 걸리는 인쇄에서 글자보다 이 그림이 훨씬 잘 읽힌다(특히 어린 관람객).
  // 그리기 순서: 카드 → 몸체 → 배출구. 몸체가 카드를 가려야 '안에서 나오는' 것으로 보인다.
  return `<svg viewBox="0 0 240 262" aria-hidden="true">
  <g id="pcard">
    <rect x="72" y="118" width="96" height="140" rx="7" fill="#ffffff" stroke="#bcd8e6" stroke-width="4"/>
    <rect x="78" y="124" width="84" height="80" rx="4" fill="#dcecf6"/>
    <path d="M78 178 q21 -14 42 0 q21 14 42 0 v26 h-84 z" fill="#a8d8a0"/>
    <circle cx="120" cy="150" r="15" fill="#c9d6de"/>
    <rect x="88" y="214" width="64" height="7" rx="3.5" fill="#d7e6ee"/>
    <rect x="96" y="230" width="48" height="6" rx="3" fill="#e4eff5"/>
  </g>
  <rect x="14" y="20" width="212" height="100" rx="16" fill="#ffffff" stroke="#cfe0ea" stroke-width="5"/>
  <rect x="44" y="2" width="152" height="24" rx="8" fill="#eef4f8" stroke="#cfe0ea" stroke-width="5"/>
  <rect x="44" y="106" width="152" height="16" rx="8" fill="#bfe6f4" stroke="#9fd2ea" stroke-width="4"/>
  <circle id="pled" cx="198" cy="50" r="7" fill="#9bd18a"/>
</svg>`;
}


// 캔버스 스프라이트 — (ctx, x, y, s) 기준 크기 s≈1 일 때 약 80px
const ART_SPRITES = {
  leaf(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.lineCap = 'round'; ctx.strokeStyle = '#39702f'; ctx.lineWidth = 7;
    ctx.stroke(new Path2D('M0 60 C -4 30, 6 10, 0 -10'));
    ctx.fillStyle = '#5aa85e'; ctx.fill(new Path2D('M0 25 C -30 15, -34 -12, -6 -6 C 4 10, 4 20, 0 25Z'));
    ctx.fillStyle = '#7cbf72'; ctx.fill(new Path2D('M0 10 C 30 0, 34 -26, 6 -20 C -4 -6, -4 4, 0 10Z'));
    ctx.restore();
  },
  fish(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#e07a2c'; ctx.fill(new Path2D('M-40 0 C -20 -26, 20 -26, 42 0 C 20 26, -20 26, -40 0Z'));
    ctx.fillStyle = '#c9631d'; ctx.fill(new Path2D('M-40 0 L -62 -18 L -58 0 L -62 18 Z'));
    ctx.fillStyle = '#2f3a44'; ctx.beginPath(); ctx.arc(24, -6, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe3c4'; ctx.lineWidth = 5; ctx.stroke(new Path2D('M-10 -12 C -2 -2, -2 2, -10 12'));
    ctx.restore();
  },
  dragonfly(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#b7dff2'; ctx.strokeStyle = '#5aa7cc'; ctx.lineWidth = 4;
    for (const a of [-20, 20]) { ctx.save(); ctx.rotate(a * Math.PI / 180); ctx.beginPath(); ctx.ellipse(a < 0 ? -22 : 22, -8, 26, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = '#3f7a3c'; ctx.beginPath(); ctx.roundRect(-4, -6, 8, 52, 4); ctx.fill();
    ctx.fillStyle = '#2f3a44'; ctx.beginPath(); ctx.arc(0, -10, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  flower(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = '#39702f'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(0, 0); ctx.stroke();
    ctx.fillStyle = '#ee8ba6';
    for (const [px, py] of [[0, -14], [13, -4], [8, 11], [-8, 11], [-13, -4]]) { ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#f5c93f'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
// 숲 — 물길 양옆에 서는 나무들. (ctx, x, y, s) 기준, s≈1 이면 높이 약 160px, 밑동이 (x,y)에 닿는다.
const ART_TREES = {
  pine(ctx, x, y, s) {          // 침엽수 — 3단 삼각형
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#6b4f36'; ctx.fillRect(-7, -34, 14, 36);
    const tiers = [[-58, 46], [-92, 38], [-124, 28]];
    ctx.fillStyle = '#2f6e3a';
    tiers.forEach(([ty, w], i) => {
      ctx.beginPath(); ctx.moveTo(0, ty - 34); ctx.lineTo(w, ty + 10); ctx.lineTo(-w, ty + 10); ctx.closePath();
      ctx.fillStyle = i === 0 ? '#2f6e3a' : (i === 1 ? '#3a8146' : '#469152'); ctx.fill();
    });
    ctx.restore();
  },
  round(ctx, x, y, s) {         // 활엽수 — 둥근 수관 3덩이
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#6b4f36'; ctx.fillRect(-8, -46, 16, 48);
    ctx.strokeStyle = '#6b4f36'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(-24, -70); ctx.moveTo(0, -52); ctx.lineTo(26, -76); ctx.stroke();
    ctx.fillStyle = '#2f6e3a'; ctx.beginPath(); ctx.arc(-30, -84, 40, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f8a45'; ctx.beginPath(); ctx.arc(30, -92, 44, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4d9c52'; ctx.beginPath(); ctx.arc(0, -118, 46, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  bush(ctx, x, y, s) {          // 덤불
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#2f6e3a'; ctx.beginPath(); ctx.ellipse(-22, -18, 30, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#41904a'; ctx.beginPath(); ctx.ellipse(20, -22, 34, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#54a45a'; ctx.beginPath(); ctx.ellipse(-2, -38, 26, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  reed(ctx, x, y, s) {          // 물가 갈대
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = '#3f8a45'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (const [dx, h, bend] of [[-16, 74, -10], [0, 96, 6], [15, 66, 12], [30, 84, -6]]) {
      ctx.beginPath(); ctx.moveTo(dx, 0); ctx.quadraticCurveTo(dx + bend, -h * 0.55, dx + bend * 2.2, -h); ctx.stroke();
    }
    ctx.restore();
  },
};
const ART_TREE_ORDER = ['pine', 'round', 'bush', 'round', 'pine', 'round', 'bush', 'pine', 'round', 'bush', 'round', 'pine', 'round', 'bush'];

// 자연 회복 등장 순서. **앞 8개는 절대 바꾸지 않는다** — 카메라를 끄면 예전 그림이 그대로 나와야 한다.
// 뒤 8개는 카메라로 당겼을 때 화면이 허전해지지 않도록 늘린 몫이다(물 위에 놓이는 건 fish 뿐).
const ART_NATURE_ORDER = ['leaf', 'fish', 'flower', 'dragonfly', 'leaf', 'fish', 'flower', 'leaf',
  'fish', 'leaf', 'flower', 'fish', 'dragonfly', 'leaf', 'flower', 'fish'];
// 카드 앞면용 — 강물을 넣지 않으므로 물고기는 뺀다 (물 없이 떠 있는 물고기가 되면 안 된다)
const ART_NATURE_CARD_ORDER = ['leaf', 'flower', 'dragonfly', 'leaf', 'flower', 'leaf', 'dragonfly', 'flower'];

// 물길 3겹 색 (바깥 흰 테두리 → 물 → 반짝임)
const ART_RIVER = [
  { w: 1.35, color: 'rgba(255,255,255,.8)', dash: null },
  { w: 1.0, color: '#2f92bd', dash: null },
  { w: 0.35, color: '#bfe6f4', dash: [40, 60] },
];

{ const __exports = { ART_ICONS, artIconSvg, ART_DROP_PATH, artDropSvg, artHandSvg, artPrinterSvg, ART_SPRITES, ART_TREES, ART_TREE_ORDER, ART_NATURE_ORDER, ART_NATURE_CARD_ORDER, ART_RIVER };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
