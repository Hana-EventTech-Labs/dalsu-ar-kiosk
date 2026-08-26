// 동화풍 벡터 아트 — 물방울 아이콘(SVG 문자열) + 캔버스용 자연 요소 스프라이트(Path2D). 디자인 캔버스(gen.py)와 동일 형태·팔레트.
'use strict';

const ART_ICONS = {
  cloud: '<path d="M18 40h30a12 12 0 0 0 0-24 16 16 0 0 0-30-4 10 10 0 0 0 0 28z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round"/>',
  drop: '<path d="M32 8c10 14 18 22 18 32a18 18 0 0 1-36 0c0-10 8-18 18-32z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round"/>',
  // 재활용 — 화살표 3개를 120°씩 돌려 배치 (시안의 초록 재활용 마크)
  recycle: '<g fill="#2f3a44" transform="translate(32 32)">'
    + '<g transform="rotate(0)"><path d="M0 -23 l7.5 13 h-4.2 v10.5 h-6.6 v-10.5 h-4.2 z"/></g>'
    + '<g transform="rotate(120)"><path d="M0 -23 l7.5 13 h-4.2 v10.5 h-6.6 v-10.5 h-4.2 z"/></g>'
    + '<g transform="rotate(240)"><path d="M0 -23 l7.5 13 h-4.2 v10.5 h-6.6 v-10.5 h-4.2 z"/></g></g>',
  // 오염물질 — 굴뚝 공장 + 배출구 물결 (시안 4번째 물방울)
  factory: '<g fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">'
    + '<path d="M10 50V28l13 8V28l13 8V16h10v34z"/>'
    + '<path d="M8 56h48"/><path d="M14 44h4M28 44h4M42 44h4"/></g>',
  sprout: '<path d="M32 56V30M32 30c-14 0-18-10-18-18 10 0 18 6 18 18zM32 34c14 0 18-10 18-18-10 0-18 6-18 18z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>',
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
const ART_DROP_COLOR = '#a9dcf0';
function artDropSvg(id, color) {
  return `<svg class="drop" viewBox="0 0 100 132" preserveAspectRatio="none" aria-hidden="true">
  <defs><radialGradient id="dg${id}" cx="34%" cy="26%" r="78%">
    <stop offset="0" stop-color="#ffffff"/><stop offset="55%" stop-color="${color}"/><stop offset="100%" stop-color="${color}" stop-opacity=".55"/>
  </radialGradient></defs>
  <path d="${ART_DROP_PATH}" fill="url(#dg${id})" stroke="#ffffff" stroke-width="3"/>
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
  return `<svg viewBox="0 0 240 150" aria-hidden="true">
  <rect x="14" y="34" width="212" height="86" rx="16" fill="#ffffff" stroke="#cfe0ea" stroke-width="4"/>
  <rect x="44" y="14" width="152" height="26" rx="8" fill="#eef4f8" stroke="#cfe0ea" stroke-width="4"/>
  <rect x="52" y="96" width="136" height="46" rx="6" fill="#dff0f8" stroke="#9fd2ea" stroke-width="4"/>
  <rect x="66" y="104" width="108" height="30" rx="4" fill="#bfe6f4"/>
  <circle cx="196" cy="60" r="7" fill="#9bd18a"/>
</svg>`;
}

// 캔버스 스프라이트 — (ctx, x, y, s) 기준 크기 s≈1 일 때 약 80px
const ART_SPRITES = {
  leaf(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.lineCap = 'round'; ctx.strokeStyle = '#5a9a55'; ctx.lineWidth = 6;
    ctx.stroke(new Path2D('M0 60 C -4 30, 6 10, 0 -10'));
    ctx.fillStyle = '#9bd18a'; ctx.fill(new Path2D('M0 25 C -30 15, -34 -12, -6 -6 C 4 10, 4 20, 0 25Z'));
    ctx.fillStyle = '#b9dc9c'; ctx.fill(new Path2D('M0 10 C 30 0, 34 -26, 6 -20 C -4 -6, -4 4, 0 10Z'));
    ctx.restore();
  },
  fish(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#f4a261'; ctx.fill(new Path2D('M-40 0 C -20 -26, 20 -26, 42 0 C 20 26, -20 26, -40 0Z'));
    ctx.fillStyle = '#e88a3c'; ctx.fill(new Path2D('M-40 0 L -62 -18 L -58 0 L -62 18 Z'));
    ctx.fillStyle = '#2f3a44'; ctx.beginPath(); ctx.arc(24, -6, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffd7b0'; ctx.lineWidth = 4; ctx.stroke(new Path2D('M-10 -12 C -2 -2, -2 2, -10 12'));
    ctx.restore();
  },
  dragonfly(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#cfe9f5'; ctx.strokeStyle = '#9fd2ea'; ctx.lineWidth = 3;
    for (const a of [-20, 20]) { ctx.save(); ctx.rotate(a * Math.PI / 180); ctx.beginPath(); ctx.ellipse(a < 0 ? -22 : 22, -8, 26, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = '#5a9a55'; ctx.beginPath(); ctx.roundRect(-4, -6, 8, 52, 4); ctx.fill();
    ctx.fillStyle = '#2f3a44'; ctx.beginPath(); ctx.arc(0, -10, 9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  flower(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = '#5a9a55'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(0, 0); ctx.stroke();
    ctx.fillStyle = '#f7b7c8';
    for (const [px, py] of [[0, -14], [13, -4], [8, 11], [-8, 11], [-13, -4]]) { ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fbe7a1'; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
};
const ART_NATURE_ORDER = ['leaf', 'fish', 'flower', 'dragonfly', 'leaf', 'fish', 'flower', 'leaf'];

// 물길 3겹 색 (바깥 흰 테두리 → 물 → 반짝임)
const ART_RIVER = [
  { w: 1.35, color: 'rgba(255,255,255,.7)', dash: null },
  { w: 1.0, color: '#7cc4e0', dash: null },
  { w: 0.35, color: '#bfe6f4', dash: [40, 60] },
];

{ const __exports = { ART_ICONS, artIconSvg, ART_DROP_PATH, artDropSvg, artHandSvg, artPrinterSvg, ART_SPRITES, ART_NATURE_ORDER, ART_RIVER };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
