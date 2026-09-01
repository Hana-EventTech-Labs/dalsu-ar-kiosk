#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""헤엄 사이클 생성용 시작 이미지(플레이트)를 만든다. 크레딧 0.

kiosk/assets/dalsu-float.png 를 단색 크로마 판 위에 얹어 assets-src/swim/ 에 저장한다.
영상 모델에 start_image 와 end_image 로 **같은 파일**을 넣으면 첫·마지막 프레임이 맞아
루프 이음매가 구조적으로 맞춰진다.

키 색이 크로마 그린인 이유(실측):
  달수 불투명 픽셀 320만 개의 채도 최대 0.487, 색상이 전부 0°~90°(주황~노랑) 안에 있다.
  녹색(145°)과 55° 이상 떨어져 있어 색상만으로 완전히 분리된다.
  덤으로 디스필 G = min(G, max(R,B)) 가 이 캐릭터에 대해 위반 픽셀 0개라 무손실이다.
"""
import os
import sys
import json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'kiosk', 'assets', 'dalsu-float.png')
OUT_DIR = os.path.join(ROOT, 'assets-src', 'swim')

KEY = (0x00, 0xB1, 0x40)          # 크로마 그린
W, H = 1920, 1080                 # 1080p 로 만든다 — 최종 시트로 내릴 때 1.4배 이상 다운샘플되어
BODY_RATIO = 0.68                 #  압축 잔여물과 소프트 엣지가 평균화된다. 720p 면 그 여유가 없다.
MIN_MARGIN = 150                  # 꼬리 스윙·팔 벌림이 프레임 밖으로 나가지 않게

# 캐릭터에 녹색이 전혀 없다는 전제를 매번 확인한다. 아트가 바뀌면 여기서 걸린다.
def assert_key_safe(im):
    import numpy as np
    a = np.asarray(im.convert('RGBA'), dtype=np.int16)
    op = a[..., 3] > 200
    r, g, b = a[..., 0][op], a[..., 1][op], a[..., 2][op]
    bad = int((g > np.maximum(r, b)).sum())
    mx = a[..., :3][op].max(axis=1).astype(np.float32)
    mn = a[..., :3][op].min(axis=1).astype(np.float32)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    return bad, float(sat.max()), int(op.sum())


def main():
    if not os.path.exists(SRC):
        print('원본이 없다: ' + SRC, file=sys.stderr)
        return 2
    im = Image.open(SRC).convert('RGBA')
    bad, satmax, npx = assert_key_safe(im)
    if bad != 0:
        print('디스필 위반 픽셀 %d 개 — 녹색 키를 쓰면 캐릭터 색이 바뀐다. 마젠타로 바꿀 것.' % bad, file=sys.stderr)
        return 3
    if satmax > 0.55:
        print('채도 %.3f 로 배경 임계(0.55)에 근접 — 키잉이 캐릭터를 먹을 수 있다.' % satmax, file=sys.stderr)
        return 3

    bh = int(round(H * BODY_RATIO))
    bw = int(round(im.width * (bh / im.height)))
    if (H - bh) // 2 < MIN_MARGIN or (W - bw) // 2 < MIN_MARGIN:
        print('여백 부족 — BODY_RATIO 를 낮출 것', file=sys.stderr)
        return 3
    body = im.resize((bw, bh), Image.LANCZOS)

    plate = Image.new('RGB', (W, H), KEY)
    plate.paste(body, ((W - bw) // 2, (H - bh) // 2), body)

    os.makedirs(OUT_DIR, exist_ok=True)
    start = os.path.join(OUT_DIR, 'start-green.png')
    plate.save(start)
    plate.save(os.path.join(OUT_DIR, 'end-green.png'))   # start == end 로 루프를 강제한다

    meta = {
        'key': '#%02X%02X%02X' % KEY, 'plate': [W, H], 'body': [bw, bh],
        'margin': [(W - bw) // 2, (H - bh) // 2],
        'srcAspect': round(im.width / im.height, 5),
        'checks': {'despillViolations': bad, 'maxSaturation': round(satmax, 4), 'opaquePixels': npx},
    }
    with open(os.path.join(OUT_DIR, 'plate.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print('플레이트 %dx%d, 달수 %dx%d, 여백 %d/%d, 채도최대 %.3f, 디스필위반 %d'
          % (W, H, bw, bh, (W - bw) // 2, (H - bh) // 2, satmax, bad))
    print(start)
    return 0


if __name__ == '__main__':
    sys.exit(main())
