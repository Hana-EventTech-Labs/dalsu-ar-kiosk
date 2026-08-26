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

// 달수 캐릭터 배치: 카드 높이 대비 scale, 앵커 기준 위치 (여백 = 카드 높이의 3%)
function dalsuPlacement(cardW, cardH, imgW, imgH, scale, anchor) {
  const h = Math.round(cardH * scale);
  const w = Math.round(imgW * (h / imgH));
  const pad = Math.round(cardH * 0.05);
  let x, y = cardH - h - pad;
  switch (anchor) {
    case 'bottom-left': x = pad; break;
    case 'bottom-center': x = Math.round((cardW - w) / 2); break;
    case 'bottom-right':
    default: x = cardW - w - pad; break;
  }
  return { x, y, w, h };
}

// 합성 레이어 순서 (아래→위). renderer는 이 순서대로 그린다. 하단 흰 띠(frame)는 기획에 없어 제거.
const LAYERS = Object.freeze(['photo', 'water', 'river', 'nature', 'dalsu', 'grade']);

// 카드에서 AR(물길·자연·달수)이 들어갈 영역 — 인물의 얼굴·상반신(상단 중앙)을 피해 하단 물 영역에만 배치한다.
// top: 카드 높이 대비 물 영역 시작 지점(0~1). 정규화 박스 {x,y,w,h}를 돌려준다.
function artBox(top) {
  const t = Math.min(0.9, Math.max(0.2, top == null ? 0.5 : top));
  return { x: 0, y: t, w: 1, h: 1 - t };
}

// 브라우저(renderer, contextIsolation)에서는 전역으로, node(test)에서는 module.exports로 노출
{ const __exports = { coverCrop, dalsuPlacement, artBox, LAYERS };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
  else if (typeof window !== 'undefined') Object.assign(window, __exports); }
