// S자 물길 경로 + 달수 이동 좌표 (순수 JS). 좌표는 0~1 정규화, renderer가 화면/카드 크기에 곱해 사용.
'use strict';

// 시냇물 — 위에서 아래로 굽이치며 흐르는 물길. 전체 실루엣이 자연스럽게 S를 이룬다.
// 글자 S를 그대로 그리면 도형처럼 뻣뻣해지므로, 굽이를 좌우 비대칭으로 두어 실제 개울처럼 보이게 한다.
//   · u=0 = 4줄기가 하나로 뭉치는 합류점(화면 중간). 여기서부터 물길이 아래로 굽이쳐 흐른다.
//   · u=0.5 = 가로 중앙(x=0.50)이자 물길의 중간 = 달수 도착점 (기획 7번).
//   · 끝점 y > 1 로 두어 물길이 화면 아래로 빠져나간다 (끊긴 오브젝트로 보이지 않게)
const DEFAULT_SEGMENTS = [
  { p0: [0.50, 0.44], p1: [0.25, 0.49], p2: [0.23, 0.62], p3: [0.50, 0.68] }, // 상류: 합류점(화면 중간)에서 왼쪽으로 굽이쳤다 돌아옴
  { p0: [0.50, 0.68], p1: [0.80, 0.74], p2: [0.64, 1.00], p3: [0.28, 1.14] }, // 하류: 오른쪽으로 크게 돌아 왼쪽 아래로 빠져나감
];
// config.river.path 로 현장에서 코드 수정 없이 경로를 바꿀 수 있다 (setPath 로 주입)
let SEGMENTS = DEFAULT_SEGMENTS;
function setPath(segs) {
  const ok = Array.isArray(segs) && segs.length === 2
    && segs.every((s) => ['p0', 'p1', 'p2', 'p3'].every((k) => Array.isArray(s[k]) && s[k].length === 2));
  SEGMENTS = ok ? segs : DEFAULT_SEGMENTS;
  return ok;
}

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

// ---------- 호길이 재매개화 ----------
// 베지에의 매개변수 u 는 길이에 비례하지 않는다. 이 물길은 위쪽 굽이가 촘촘해서
// u 를 등속으로 흘리면 가운데에서 느려졌다가 끝에서 튕기듯 빨라진다 — 측정하면 구간 속도가 2.5배까지 벌어졌다.
// 헤엄의 빠르고 느림은 스트로크(motion.swimEase)만이 만들어야 하므로, 진행도를 **길이 기준**으로 바꾼다.
// aspect = 화면 폭/높이 (9:16 이면 0.5625). 정규화 좌표에서 가로와 세로의 실제 길이가 다르기 때문에 필요하다.
const ARC_N = 512;
const ARC_ASPECT = 1080 / 1920;
let arcCache = null;
function arcTable(aspect) {
  const a = aspect || ARC_ASPECT;
  if (arcCache && arcCache.aspect === a && arcCache.segs === SEGMENTS) return arcCache;
  const cum = [0];
  let prev = pointAt(0);
  for (let i = 1; i <= ARC_N; i++) {
    const q = pointAt(i / ARC_N);
    cum.push(cum[i - 1] + Math.hypot((q[0] - prev[0]) * a, q[1] - prev[1]));
    prev = q;
  }
  arcCache = { aspect: a, segs: SEGMENTS, cum };
  return arcCache;
}
// 구간 [uFrom,uTo] 안에서 '길이의 s 배(0~1)만큼 간 지점'의 매개변수 u
function uAtArc(s, uFrom, uTo, aspect) {
  const a0 = uFrom == null ? 0 : uFrom, a1 = uTo == null ? 1 : uTo;
  const cum = arcTable(aspect).cum;
  const at = (u) => {
    const x = Math.min(1, Math.max(0, u)) * ARC_N, i = Math.floor(x);
    return i >= ARC_N ? cum[ARC_N] : cum[i] + (cum[i + 1] - cum[i]) * (x - i);
  };
  const L0 = at(a0), L1 = at(a1);
  const target = L0 + (L1 - L0) * Math.min(1, Math.max(0, s));
  let lo = 0, hi = ARC_N;                       // cum 은 단조증가 — 이분 탐색
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
  const i = Math.max(1, lo);
  const d = cum[i] - cum[i - 1];
  return (i - 1 + (d > 1e-12 ? (target - cum[i - 1]) / d : 0)) / ARC_N;
}

// ---------- 지류(합류 전 4줄기) ----------
// 물방울 자리 → 합류점으로 흐르는 곡선.
// 제어점을 발원지 **바로 아래**에 두어, 물이 물방울에서 수직으로 흘러내리다가 중앙으로 꺾이게 한다.
// (두 점을 직선으로 이으면 중앙에 가까운 안쪽 지류가 너무 짧아 보이지 않는다)
// drop = 수직 낙하 비율(0~1). 클수록 아래로 길게 떨어졌다가 꺾인다.
function tributaryPath(from, to, drop) {
  const d = drop == null ? 0.88 : drop;
  return { p0: from, c: [from[0], from[1] + (to[1] - from[1]) * d], p1: to };
}

// 지류 위 진행도 u(0~1) → 좌표
function tributaryPointAt(t, u) {
  const c = Math.min(1, Math.max(0, u)), mt = 1 - c;
  return [
    mt * mt * t.p0[0] + 2 * mt * c * t.c[0] + c * c * t.p1[0],
    mt * mt * t.p0[1] + 2 * mt * c * t.c[1] + c * c * t.p1[1],
  ];
}

// 지류를 progress(0~1)만큼 자라난 상태로 샘플 — 발원지에서 합류점 쪽으로 뻗는다
function tributarySamples(t, n, progress) {
  const p = Math.min(1, Math.max(0, progress == null ? 1 : progress));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(tributaryPointAt(t, (i / n) * p));
  return out;
}

// 본류 위에서 주어진 점과 가장 가까운 진행도 u 를 찾는다 (구간 [uFrom, uTo] 안에서 조밀 탐색 후 국소 세분)
function nearestU(pt, uFrom, uTo) {
  const a = uFrom == null ? 0 : uFrom, b = uTo == null ? 1 : uTo;
  let bestU = a, bestD = Infinity;
  const scan = (lo, hi, n) => {
    for (let i = 0; i <= n; i++) {
      const u = lo + (hi - lo) * (i / n);
      const p = pointAt(u), d = (p[0] - pt[0]) ** 2 + (p[1] - pt[1]) ** 2;
      if (d < bestD) { bestD = d; bestU = u; }
    }
  };
  scan(a, b, 200);
  const step = (b - a) / 200;
  scan(Math.max(a, bestU - step), Math.min(b, bestU + step), 40);
  return bestU;
}

// 발원지(목표 문구 자리) 4개 → **물길 머리 한 점**으로 모이는 지류.
// 기획 5번: "4개의 물길이 위에서 아래로 하나로 뭉쳐지면서 S자 형태로" 간다.
// 합류점을 물길 중간에 두면 지류가 본류를 가로질러야 하므로, 합류점은 반드시 물길의 **머리(u=0)** 여야 한다.
// 반환: { path, u, to } — u 는 본류 상의 합류 진행도(항상 0)
function tributaries(sources, mergeAt) {
  const to = mergeAt || pointAt(0);
  return sources.map((from) => {
    const dist = Math.abs(from[0] - to[0]);          // 바깥쪽일수록 더 늦게 꺾인다
    return { path: tributaryPath(from, to, 0.84 + dist * 0.14), u: 0, to };
  });
}

// ---------- 숲·언덕 배치 (물길을 피해서) ----------

// 정규화 좌표는 세로로 긴 화면에서 거리가 왜곡되므로, 화면 폭 기준으로 환산해 거리를 잰다.
// aspect = 화면 높이/폭 (1080×1920 이면 1.778).
function distToRiver(pt, n, aspect) {
  const N = n || 72, a = aspect || (1920 / 1080);
  let best = Infinity;
  for (let i = 0; i <= N; i++) {
    const [x, y] = pointAt(i / N);
    const dx = x - pt[0], dy = (y - pt[1]) * a;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// 물길에서 minDist 이상 떨어진 자리들 — 숲·나무를 놓을 곳.
// 저불일치 수열(R2)로 고르게 흩뿌리므로 결정적이다(같은 입력이면 늘 같은 배치).
function scenerySlots(count, opts) {
  const o = opts || {};
  const yTop = o.yTop == null ? 0.30 : o.yTop;
  const yBottom = o.yBottom == null ? 1.04 : o.yBottom;
  const minDist = o.minDist == null ? 0.20 : o.minDist;
  const aspect = o.aspect || (1920 / 1080);
  const out = [];
  const G1 = 0.7548776662, G2 = 0.5698402909;   // R2 수열
  for (let i = 1, guard = 0; out.length < count && guard < count * 60; i++, guard++) {
    const x = 0.025 + ((i * G1) % 1) * 0.95;
    const y = yTop + ((i * G2) % 1) * (yBottom - yTop);
    if (distToRiver([x, y], 72, aspect) < minDist) continue;
    // 아래로 갈수록 카메라에 가까워 크게, 위로 갈수록 멀어 작고 흐리게
    const depth = Math.min(1, Math.max(0, (y - yTop) / Math.max(0.001, yBottom - yTop)));
    out.push({ x, y, depth, side: x < 0.5 ? -1 : 1, i: out.length });
  }
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
function natureSlotsIn(count, offset, box, aspect, clearance, uTo) {
  const b = box || FULL_BOX;
  return natureSlots(count, offset, aspect, clearance, uTo).map((s) => {
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
// offset 은 **화면 높이 기준 비율**이다 (물길 폭 widthRatio 와 같은 기준이라 "둑에서 얼마나 떨어질지"를 바로 계산할 수 있다).
// 정규화 좌표에서 그냥 밀면 9:16 화면에서 가로는 절반만 밀려 식물이 물 한가운데 놓인다 — 실제로 그렇게 나갔다.
// 그래서 (x*aspect, y) 라는 '높이 단위' 공간에서 법선을 잡고 되돌린다.
const FULL_ASPECT = 1080 / 1920;
// uTo: 슬롯을 물길의 이 진행도까지만 배치한다(기본 1 = 물길 전체).
// 달수는 u=0.5 까지만 내려가는데 슬롯이 전 구간에 퍼져 있으면 **절반이 달수가 가지 않는 하류에서 핀다** —
// "달수의 진행이 생명을 번지게 한다"는 기획이 관객에게 절반만 보이던 원인이다.
function natureSlots(count, offset, aspect, clearance, uTo) {
  const off = offset == null ? 0.12 : offset;
  const a = aspect || FULL_ASPECT;
  const span = uTo == null ? 1 : Math.min(1, Math.max(0.05, uTo));
  const out = [];
  for (let i = 0; i < count; i++) {
    const u = ((i + 1) / (count + 1)) * span;
    const [x, y] = pointAt(u);
    const [x2, y2] = pointAt(Math.min(1, u + 0.004));
    const dx = (x2 - x) * a, dy = y2 - y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;                    // 높이 단위 공간의 법선
    let side = i % 2 === 0 ? 1 : -1;
    // S자는 되돌아오므로, 옆으로 밀어도 물길의 **다른 구간**에 걸릴 수 있다.
    // 걸리면 더 밀고, 그래도 안 되면 반대편으로 보낸다.
    const clear = clearance == null ? 0 : clearance;
    const at = (k, sd) => [x + (nx * off * k / a) * sd, y + ny * off * k * sd];
    let pt = at(1, side);
    if (clear > 0) {
      let bestPt = pt, bestD = distToRiver(pt, 120, 1 / a);
      for (const sd of [side, -side]) {
        for (const k of [1, 1.35, 1.75, 2.2]) {
          const q = at(k, sd), d = distToRiver(q, 120, 1 / a);
          if (d > bestD) { bestD = d; bestPt = q; side = sd; }
          if (d >= clear) break;
        }
        if (bestD >= clear) break;
      }
      pt = bestPt;
    }
    out.push({ u, x: pt[0], y: pt[1], side });
  }
  return out;
}

// 브라우저(renderer, contextIsolation)에서는 전역으로, node(test)에서는 module.exports로 노출
{ const __exports = { get SEGMENTS() { return SEGMENTS; }, DEFAULT_SEGMENTS, setPath, uAtArc, tributaryPath, tributaryPointAt, tributarySamples, tributaries, nearestU, distToRiver, scenerySlots, FULL_BOX, pointAt, angleAt, samples, svgPath, natureSlots, pointIn, samplesIn, samplesRange, natureSlotsIn };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
