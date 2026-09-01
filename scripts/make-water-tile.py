#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""실사 물 텍스처 → 좌우 타일러블 kiosk/assets/water.png

  python scripts/make-water-tile.py [--in assets-src/water/water-raw.png] [--w 1024] [--h 428]

renderer 는 water.png 가 있으면 절차 생성 대신 이 이미지를 쓴다(x = 흐름 방향, 반복).
좌우 가장자리를 교차 블렌딩해 이음매를 없앤다. 세로는 반복하지 않으므로 손대지 않는다.
"""
import os, sys
import numpy as np
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def arg(k, d):
    a = sys.argv
    return a[a.index('--' + k) + 1] if ('--' + k) in a and a.index('--' + k) + 1 < len(a) else d

def main():
    src = arg('in', os.path.join(ROOT, 'assets-src', 'water', 'water-raw.png'))
    W, H = int(arg('w', '1024')), int(arg('h', '428'))
    im = Image.open(src).convert('RGB')
    # 가운데 띠를 쓴다 — 생성 이미지는 가장자리 밝기가 고르지 않다
    cw, ch = im.width, int(im.width * H / W)
    y0 = (im.height - ch) // 2
    im = im.crop((0, y0, cw, y0 + ch)).resize((W + W // 4, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    ov = W // 4                                        # 겹침 폭 — 넓을수록 이음매가 부드럽다
    base, tail = a[:, :W], a[:, W:W + ov]
    ramp = np.linspace(0, 1, ov)[None, :, None]
    base[:, :ov] = base[:, :ov] * ramp + tail * (1 - ramp)   # 왼쪽 끝을 오른쪽 너머 조각과 섞는다 → 오른끝-왼끝이 이어진다
    out = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    # 생성본은 모래 바닥 위 얕은 물이라 거의 흰색(평균 밝기 ~200)이다. 그대로 쓰면 강이 회색 리본으로 읽혔다.
    # 물결 패턴은 남기고 색만 '깊이가 있는 맑은 강'으로: 밝기를 낮추고 청록으로 기울인 뒤 대비를 되살린다.
    arr = np.asarray(out).astype(np.float32)
    lum = arr.mean(axis=2, keepdims=True)
    detail = arr - lum                                   # 물결 디테일(색 편차)
    t = (lum - lum.min()) / max(1.0, float(lum.max() - lum.min()))   # 0~1 밝기 순위
    # 삼성 블루 계열(2026-09-01 요청). 공식 #1428A0 그대로면 물이 잉크처럼 어두워 밝은 쪽으로 기울였다.
    deep = np.array([22, 96, 196], np.float32); light = np.array([132, 196, 244], np.float32)
    base_col = deep * (1 - t) + light * t               # 어두운 곳 = 깊은 물, 밝은 곳 = 얕은 반사
    arr = base_col + detail * 1.35                       # 디테일 대비를 살린다
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    dst = os.path.join(ROOT, 'kiosk', 'assets', 'water.png')
    out.save(dst, optimize=True)
    # 이음매 검사: 오른쪽 끝 열과 왼쪽 끝 열의 평균 차이
    b = np.asarray(out).astype(np.float32)
    seam = float(np.abs(b[:, 0] - b[:, -1]).mean())
    print('water.png %dx%d, 이음매 평균차 %.1f (255 기준, 6 이하면 눈에 안 띈다) → %s' % (W, H, seam, dst))
    return 0 if seam < 8 else 1

if __name__ == '__main__':
    sys.exit(main())
