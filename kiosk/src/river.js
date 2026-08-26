// S자 물길 경로 + 달수 이동 좌표 (순수 JS). 좌표는 0~1 정규화, renderer가 화면/카드 크기에 곱해 사용.
'use strict';

// 3차 베지어 2개를 이어 붙인 S자. 위(0,0.15) → 아래(1,0.85) 방향.
const SEGMENTS = [
  { p0: [0.10, 0.18], p1: [0.55, 0.05], p2: [0.05, 0.50], p3: [0.50, 0.50] },
  { p0: [0.50, 0.50], p1: [0.95, 0.50], p2: [0.45, 0.95], p3: [0.90, 0.82] },
];

function cubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return [
    mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
    mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
  ];
}

// 경로 위 진행도 u(0~1) → 정규화 좌표 [x,y]
function pointAt(u) {
  const c = Math.min(1, Math.max(0, u));
  const idx = c < 0.5 ? 0 : 1;
  const t = idx === 0 ? c * 2 : (c - 0.5) * 2;
  const s = SEGMENTS[idx];
  return cubic(s.p0, s.p1, s.p2, s.p3, t);
}

// 진행도 u에서의 이동 방향 각도(rad) — 달수 회전용
function angleAt(u) {
  const a = pointAt(Math.max(0, u - 0.01));
  const b = pointAt(Math.min(1, u + 0.01));
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

// 균등 간격 샘플 (캔버스 polyline / 자연 요소 배치용)
function samples(n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(pointAt(i / n));
  return out;
}

// 경로를 정규화 박스 안으로 눌러 담기 — 카드 합성에서 인물(상단 중앙)을 피해 하단 물 영역에만 물길을 그릴 때 사용
const FULL_BOX = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
function mapBox([x, y], box) {
  const b = box || FULL_BOX;
  return [b.x + x * b.w, b.y + y * b.h];
}
function pointIn(u, box) { return mapBox(pointAt(u), box); }
function samplesIn(n, box) { return samples(n).map((p) => mapBox(p, box)); }
function natureSlotsIn(count, offset, box) {
  const b = box || FULL_BOX;
  return natureSlots(count, offset).map((s) => {
    const [x, y] = mapBox([s.x, s.y], b);
    return { ...s, x, y };
  });
}

// 진행도 구간 [uFrom, uTo] 만 샘플 — 물길이 중앙에서 양쪽으로 뻗어나가는 연출에 쓴다
function samplesRange(n, uFrom, uTo, box) {
  const a = Math.max(0, Math.min(1, uFrom)), b = Math.max(0, Math.min(1, uTo));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(mapBox(pointAt(a + (b - a) * (i / n)), box));
  return out;
}

// SVG path d 문자열 (w,h 배율 적용)
function svgPath(w, h) {
  const f = (p) => `${(p[0] * w).toFixed(1)} ${(p[1] * h).toFixed(1)}`;
  const [a, b] = SEGMENTS;
  return `M ${f(a.p0)} C ${f(a.p1)}, ${f(a.p2)}, ${f(a.p3)} C ${f(b.p1)}, ${f(b.p2)}, ${f(b.p3)}`;
}

// 자연 회복 요소 배치 슬롯: 물길 양옆에 번갈아, 진행도 순 (등장 순서 = 배열 순서)
function natureSlots(count, offset) {
  const off = offset ?? 0.12;
  const out = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 1) / (count + 1);
    const [x, y] = pointAt(u);
    const ang = angleAt(u) + Math.PI / 2;
    const side = i % 2 === 0 ? 1 : -1;
    out.push({ u, x: x + Math.cos(ang) * off * side, y: y + Math.sin(ang) * off * side, side });
  }
  return out;
}

// 브라우저(renderer, contextIsolation)에서는 전역으로, node(test)에서는 module.exports로 노출
{ const __exports = { SEGMENTS, FULL_BOX, pointAt, angleAt, samples, svgPath, natureSlots, pointIn, samplesIn, samplesRange, natureSlotsIn };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
