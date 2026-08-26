// 흐르는 강물 렌더러 — 경로(픽셀 좌표)를 따라 수면 텍스처를 흐름 방향으로 스크롤시켜
// "그려진 물길"이 아니라 "실제로 흐르는 물"로 보이게 한다.
//   · 텍스처 x축 = 흐름 방향(타일러블), y축 = 둑→둑 (깊이·거품을 미리 구워 넣음)
//   · 경로를 짧은 구간으로 쪼개 각 구간에 텍스처 조각을 회전 배치 → 곡선을 따라 흐른다
//   · 텍스처는 절차 생성이 기본. kiosk/assets/water.png 를 넣으면 그 이미지를 대신 쓴다(AI 생성본 교체용).
'use strict';

// ---------- 순수 계산 (node 테스트 대상) ----------

// 결정적 난수 — 같은 seed면 항상 같은 텍스처(현장에서 화면마다 달라지지 않게)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 격자 보간 노이즈 — nx×ny 격자를 감싸므로 가로(흐름) 방향으로 이음매 없이 반복된다
function tileNoise(nx, ny, rnd) {
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const sm = (t) => t * t * (3 - 2 * t);
  const at = (a, b) => g[(((b % ny) + ny) % ny) * nx + (((a % nx) + nx) % nx)];
  return (u, v) => { // u,v = 0~1
    const fx = u * nx, fy = v * ny;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

// 강폭 테이퍼 — 발원지(0)와 하구(1)에서 가늘고 가운데가 굵다. 실제 강처럼 폭이 일정하지 않게.
function widthAt(u, min) {
  const m = min == null ? 0.45 : min;
  const c = Math.min(1, Math.max(0, u));
  return m + (1 - m) * Math.sin(Math.PI * c) ** 0.55;
}

// 경로 → 물길 띠의 좌/우 둑 좌표. pts는 픽셀 [x,y] 배열, width는 최대 폭(px).
function bandPolygon(pts, width, minTaper) {
  const n = pts.length;
  if (n < 2) return { left: [], right: [], half: [] };
  const left = [], right = [], half = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nxv = -dy / len, nyv = dx / len;          // 진행 방향의 법선
    const h = (width * widthAt(i / (n - 1), minTaper)) / 2;
    half.push(h);
    left.push([p[0] + nxv * h, p[1] + nyv * h]);
    right.push([p[0] - nxv * h, p[1] - nyv * h]);
  }
  return { left, right, half };
}

// 경로 누적 거리 — 흐름 스크롤이 구간 경계에서 끊기지 않도록 이어 붙이는 데 쓴다
function arcLengths(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

// ---------- 텍스처 생성 (브라우저 전용) ----------

const WATER_PALETTE = Object.freeze({
  deep: [42, 132, 170],     // 물 깊은 가운데
  mid: [92, 186, 216],
  shallow: [182, 228, 242], // 둑 가까운 얕은 물
  foam: [255, 255, 255],
});

// 타일러블 수면 텍스처. W = 흐름 방향(반복), H = 띠 가로. tilePx 와 W 를 비슷하게 맞춰야 결이 뭉개지지 않는다.
function makeWaterTexture(W, H, seed, palette) {
  const pal = palette || WATER_PALETTE;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rnd = mulberry32(seed || 1337);
  // 흐름 방향으로 길게 늘어진 물결(코스틱) 3겹 + 잔결 1겹
  // nx(흐름 방향) < ny(가로) 로 두면 무늬가 흐름 방향으로 길게 늘어난다 — 강물 결의 핵심
  const n1 = tileNoise(4, 9, rnd);    // 큰 흐름 결
  const n2 = tileNoise(9, 20, rnd);   // 중간 물결
  const n3 = tileNoise(18, 40, rnd);  // 잔물결
  const nf = tileNoise(7, 16, rnd);   // 물마루 반짝임
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // 깊이(둑↔가운데) 그라데이션은 여기서 굽지 않는다 — 조각을 겹쳐 그리면 가장자리가 잘려 나가기 때문.
  // 깊이·거품은 drawFlowingRiver 가 실제 둑 모양을 따라 얹는다. 여기서는 "흐르는 수면 결"만 만든다.
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const shear = u + v * 0.10;                    // 물결이 사선으로 눕는다
      let n = n1(shear, v) * 0.5 + n2(shear, v) * 0.32 + n3(shear, v) * 0.18;
      n = clamp((n - 0.5) * 2.7 + 0.5);              // 대비 확장 — 밋밋한 회색 물이 되지 않게
      const ridge = Math.pow(1 - Math.abs(n * 2 - 1), 3.2); // 능선형: 밝은 물결선이 도드라짐
      const swell = n3(shear * 1.7, v * 1.3);        // 큰 너울 — 밝고 어두운 면이 갈린다
      let r = lerp(pal.mid[0], pal.deep[0], clamp(0.35 + (1 - swell) * 0.5));
      let g = lerp(pal.mid[1], pal.deep[1], clamp(0.35 + (1 - swell) * 0.5));
      let b = lerp(pal.mid[2], pal.deep[2], clamp(0.35 + (1 - swell) * 0.5));
      const hi = ridge * 0.85 + Math.pow(nf(shear * 2.2, v * 2), 6) * 0.5; // 반짝이는 물마루
      r = lerp(r, 255, clamp(hi)); g = lerp(g, 255, clamp(hi)); b = lerp(b, 255, clamp(hi));
      const i = (y * W + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ---------- 그리기 ----------

// pts: 픽셀 [x,y] 배열(진행 순). width: 최대 폭(px). scroll: 흐름 누적 거리(px, 시간에 비례).
// opts: { tilePx, minTaper, glare, shadow }
function drawFlowingRiver(ctx, pts, width, tex, scroll, opts) {
  if (!pts || pts.length < 2 || width <= 0 || !tex) return;
  const o = opts || {};
  const tilePx = o.tilePx || 420;            // 텍스처 1회 반복이 덮는 실제 길이
  const band = bandPolygon(pts, width, o.minTaper);
  const s = arcLengths(pts);
  const uScale = tex.width / tilePx;         // 화면 1px당 텍스처 px

  // 띠 외곽 경로 (클립 + 둑 스트로크 공용)
  const outline = new Path2D();
  outline.moveTo(band.left[0][0], band.left[0][1]);
  for (let i = 1; i < band.left.length; i++) outline.lineTo(band.left[i][0], band.left[i][1]);
  for (let i = band.right.length - 1; i >= 0; i--) outline.lineTo(band.right[i][0], band.right[i][1]);
  outline.closePath();

  // 물이 땅에 파여 있는 느낌 — 바깥쪽 그림자
  if (o.shadow !== false) {
    ctx.save();
    ctx.shadowColor = 'rgba(24,70,92,.30)'; ctx.shadowBlur = width * 0.16; ctx.shadowOffsetY = width * 0.04;
    ctx.fillStyle = 'rgba(70,150,180,1)'; ctx.fill(outline);
    ctx.restore();
  }

  ctx.save();
  ctx.clip(outline);
  // 구간마다 텍스처 조각을 흐름 방향으로 밀어 넣는다.
  // 곡선에서 조각 모서리가 띠 밖으로 어긋나 틈(갈비뼈 무늬)이 생기므로 폭·길이를 넉넉히 겹쳐 그리고 클립으로 잘라낸다.
  const OVER_W = 1.5, OVER_LEN = 3;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const w = (band.half[i] + band.half[i + 1]) * OVER_W;
    const ang = Math.atan2(dy, dx);
    const srcW = len * uScale;
    let srcX = ((s[i] + scroll) * uScale) % tex.width;
    if (srcX < 0) srcX += tex.width;
    ctx.save();
    ctx.translate(p0[0], p0[1]); ctx.rotate(ang);
    const drawLen = len + OVER_LEN;
    if (srcX + srcW <= tex.width) {
      ctx.drawImage(tex, srcX, 0, srcW, tex.height, -OVER_LEN / 2, -w / 2, drawLen, w);
    } else {                                                 // 텍스처 끝을 넘어가면 두 조각으로
      const w1 = tex.width - srcX, r = w1 / srcW;
      ctx.drawImage(tex, srcX, 0, w1, tex.height, -OVER_LEN / 2, -w / 2, drawLen * r + 0.5, w);
      ctx.drawImage(tex, 0, 0, srcW - w1, tex.height, -OVER_LEN / 2 + drawLen * r, -w / 2, drawLen * (1 - r) + 0.5, w);
    }
    ctx.restore();
  }

  // 깊이 — 강 한가운데를 따라 어두운 물골. 둑 쪽은 얕고 밝게 남는다.
  if (o.depth !== false) {
    ctx.save();
    try { ctx.filter = `blur(${Math.max(1, width * 0.09).toFixed(1)}px)`; } catch (e) { /* 미지원 시 선명하게 */ }
    ctx.globalAlpha = 0.42; ctx.strokeStyle = 'rgba(16,66,92,1)';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width * 0.42;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.restore();
  }

  // 수면 반사광 — 흐름을 따라 미끄러지는 가늘고 긴 하이라이트
  if (o.glare !== false) {
    const total = s[s.length - 1];
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const speed = 1 + k * 0.3, span = 200 + k * 90;
      const off = ((scroll * speed + k * 640) % (total + span * 2)) - span;
      ctx.strokeStyle = `rgba(255,255,255,${0.13 - k * 0.03})`;
      ctx.lineWidth = width * (0.055 + k * 0.025);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const d = s[i] - off;
        if (d < 0 || d > span) { started = false; continue; }
        const a = Math.atan2(pts[Math.min(i + 1, pts.length - 1)][1] - pts[Math.max(i - 1, 0)][1],
                             pts[Math.min(i + 1, pts.length - 1)][0] - pts[Math.max(i - 1, 0)][0]);
        const side = (k - 1) * 0.24 * band.half[i];
        const x = pts[i][0] - Math.sin(a) * side, y = pts[i][1] + Math.cos(a) * side;
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 둑 거품 — 실제 띠 경계를 따라 안쪽으로 번지는 흰 물거품 (클립 안에서 흐리게 스트로크)
  if (o.foam !== false) {
    ctx.save();
    try { ctx.filter = `blur(${Math.max(1, width * 0.05).toFixed(1)}px)`; } catch (e) { /* filter 미지원이면 선명한 선으로 */ }
    ctx.strokeStyle = 'rgba(255,255,255,.62)'; ctx.lineWidth = width * 0.115; ctx.stroke(outline);
    ctx.strokeStyle = 'rgba(255,255,255,.40)'; ctx.lineWidth = width * 0.045; ctx.stroke(outline);
    ctx.restore();
  }
  ctx.restore();

  // 물가 경계 — 아주 얇게만. 흰 테두리를 두껍게 두르면 만화 물길처럼 보인다.
  ctx.save();
  ctx.strokeStyle = 'rgba(210,238,248,.30)'; ctx.lineWidth = Math.max(1, width * 0.014); ctx.stroke(outline);
  ctx.restore();
}

{ const __exports = { mulberry32, tileNoise, widthAt, bandPolygon, arcLengths, WATER_PALETTE, makeWaterTexture, drawFlowingRiver };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
