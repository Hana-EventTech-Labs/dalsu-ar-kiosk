// AR 합성 레이아웃 계산 (순수 JS). 실제 그리기는 renderer.js가 캔버스로 수행.
'use strict';

// 소스(비디오 프레임)를 카드 캔버스에 cover 방식으로 채울 때의 크롭 사각형
function coverCrop(srcW, srcH, dstW, dstH) {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) throw new Error('invalid size');
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let sw, sh;
  if (srcRatio > dstRatio) { sh = srcH; sw = Math.round(srcH * dstRatio); }
  else { sw = srcW; sh = Math.round(srcW / dstRatio); }
  return { sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh };
}

// 촬영 사진을 카드에 앉히는 자리. zoom=1 이면 coverCrop 과 완전히 같다(전면 채움).
//
// 왜 필요한가: 웹캠은 1280x720(가로 1.78)인데 카드는 664x1040(세로 0.64)이라
// cover 로 채우면 **화면 가로의 36%(459/1280)만 잘라 쓴다** — 인물이 2.8배로 확대돼 얼굴이 카드를 덮는다.
// 해상도를 올려도 비율 문제라 그대로다. 유일한 해법은 더 넓게 잘라 **위쪽 띠로 앉히고**
// 남는 아래를 장면이 채우는 것이다.
//   zoom 0.62 → 소스 740px 폭을 쓰고 카드 높이의 62%를 차지한다(인물이 38% 작아진다).
function photoCrop(srcW, srcH, dstW, dstH, zoom) {
  const cover = coverCrop(srcW, srcH, dstW, dstH);
  const z = Math.min(1, Math.max(0.35, zoom == null ? 1 : zoom));
  // zoom 1 은 예전 동작과 **비트 단위로 같아야** 한다(반올림으로 1px 틈이 생기면 카드 아래가 비친다).
  if (z >= 0.999) return { sx: cover.sx, sy: cover.sy, sw: cover.sw, sh: cover.sh, dx: 0, dy: 0, dw: dstW, dh: dstH };
  const sw = Math.min(srcW, Math.round(cover.sw / z));
  const sh = Math.min(srcH, Math.round(cover.sh / z));
  const k = dstW / sw;
  return {
    sx: Math.round((srcW - sw) / 2), sy: Math.round((srcH - sh) / 2), sw, sh,
    dx: 0, dy: 0, dw: dstW, dh: Math.min(dstH, Math.round(sh * k)),
  };
}

// 달수 캐릭터 배치: **카드의 짧은 변** 대비 scale, 앵커 기준 위치.
// 짧은 변을 기준으로 잡아야 가로/세로 카드에서 캐릭터 크기가 같아 보인다
// (세로 카드에서 높이 기준으로 잡으면 캐릭터가 폭을 넘어 인물을 덮는다).
function dalsuPlacement(cardW, cardH, imgW, imgH, scale, anchor) {
  const shortSide = Math.min(cardW, cardH);
  const h = Math.round(shortSide * scale);
  const w = Math.round(imgW * (h / imgH));
  const pad = Math.round(shortSide * 0.05);
  let x, y = cardH - h - pad;
  switch (anchor) {
    case 'bottom-left': x = pad; break;
    case 'bottom-center': x = Math.round((cardW - w) / 2); break;
    case 'bottom-right':
    default: x = cardW - w - pad; break;
  }
  return { x, y, w, h };
}

// 카드에서 AR(자연·달수)이 들어갈 영역 — 인물의 얼굴·상반신(상단 중앙)을 피해 하단에만 배치한다.
// top: 카드 높이 대비 시작 지점(0~1). 정규화 박스 {x,y,w,h}를 돌려준다.
function artBox(top) {
  const t = Math.min(0.9, Math.max(0.2, top == null ? 0.5 : top));
  return { x: 0, y: t, w: 1, h: 1 - t };
}

// 합성 레이어 순서 (아래→위). renderer는 이 순서대로 그린다.
// 기획: 촬영 사진에는 **6번의 복구된 자연(강물 제외) + 달수**만 AR 합성한다.
// 하단 흰 띠(frame)와 강물(water/river)은 카드에 넣지 않는다.
const LAYERS = Object.freeze(['photo', 'nature', 'dalsu', 'grade']);

// 카드용 자연 배치 — 강물이 없으므로 물길 경로가 아니라 '구역'으로 나눠 앉힌다.
// 피해야 할 것 두 가지: ① 가운데 인물(얼굴·상반신) ② 우하단 달수.
// 남는 자리는 (a) 왼쪽 물가 (b) 인물 앞 전경 (c) 달수 왼쪽 틈 — 세 구역에 나눠 배치한다.
const CARD_NATURE_ZONES = Object.freeze([
  { x: [0.040, 0.270], y: [0.58, 0.90], share: 4 },   // 왼쪽 물가 — 가장 넓게 남는 자리
  { x: [0.300, 0.600], y: [0.875, 0.925], share: 2 }, // 인물 앞 전경 (겹쳐도 '앞에 있는 풀'로 읽힌다)
  { x: [0.600, 0.680], y: [0.62, 0.82], share: 2 },   // 달수 왼쪽 틈
]);

// 세로 카드는 인물이 프레임을 거의 다 채운다 → 좌우 가장자리와 맨 아래 전경만 남는다.
const CARD_NATURE_ZONES_PORTRAIT = Object.freeze([
  { x: [0.025, 0.185], y: [0.60, 0.93], share: 3 },   // 왼쪽 가장자리
  { x: [0.820, 0.975], y: [0.52, 0.72], share: 2 },   // 오른쪽 가장자리 — 달수(우하단) 위쪽까지만
  { x: [0.200, 0.800], y: [0.935, 0.975], share: 3 }, // 인물 앞 전경
]);

function natureCardSlots(count, top, zones) {
  const n = Math.max(0, Math.min(16, count | 0));
  const zs = zones || CARD_NATURE_ZONES;
  const total = zs.reduce((a, z) => a + z.share, 0);
  const out = [];
  let i = 0;
  zs.forEach((z, zi) => {
    const want = zi === zs.length - 1 ? n - out.length : Math.round((n * z.share) / total);
    for (let k = 0; k < want && out.length < n; k++, i++) {
      const t = want === 1 ? 0.5 : k / (want - 1);
      // 지그재그로 흩어 놓아 일렬로 보이지 않게 (결정적 — 매번 같은 그림)
      const jx = ((k * 0.37 + zi * 0.19) % 1) * 0.9 + 0.05;
      out.push({
        x: z.x[0] + (z.x[1] - z.x[0]) * jx,
        y: z.y[0] + (z.y[1] - z.y[0]) * t,
        zone: zi,
      });
    }
  });
  return out;
}

// 브라우저(renderer, contextIsolation)에서는 전역으로, node(test)에서는 module.exports로 노출
{ const __exports = { coverCrop, photoCrop, dalsuPlacement, artBox, natureCardSlots, CARD_NATURE_ZONES, CARD_NATURE_ZONES_PORTRAIT, LAYERS };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
