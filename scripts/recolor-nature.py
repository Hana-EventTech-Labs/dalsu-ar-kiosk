#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""나무·식물 컷아웃의 초록 잎을 삼성 숲색(#00c3b2) 계열로 옮긴다.

  python scripts/recolor-nature.py [--hue 175] [--strength 0.85] [--lo 55] [--hi 170] [--files tree-1.png,...]

삼성 지정 팔레트(2026-09-03 클라이언트 전달): 물방울 #00b3e3 · 나무/숲 #00c3b2 · 파랑 #0077c8.
생성형 컷아웃(`tree-*.png`, `plant-*.png`)은 연두·초록(색상각 70~140°)이라 팔레트와 어긋난다.

왜 전체 hue-rotate 가 아니라 **초록 구간만 선택 이동**인가:
  캔버스 `filter: hue-rotate()` 로 통째로 돌리면 나무 줄기(갈색, ~30°)가 연두로, 벚꽃(분홍)이 주황으로 바뀐다.
  잎의 색상각 구간(`--lo`~`--hi`)에 든 픽셀만 목표 색상각(`--hue`, #00c3b2 ≈ 175°)으로 `--strength` 만큼 끌어당기고
  채도·명도는 그대로 둔다 — 셀셰이딩의 명암 단계가 살아 있어 입체감이 유지된다.
  구간 경계 ±12° 는 부드럽게 섞어(soft edge) 잎과 줄기 경계에 띠가 생기지 않게 한다.

한 번만 실행한다(cutout-nature.py 다음). 두 번 돌리면 이미 옮긴 픽셀(≈160~175°)은 구간 밖이라 거의 그대로지만,
경계 부근이 조금 더 밀리므로 원본은 git 이나 `cutout-nature.py` 로 다시 만든다. 물고기(`fish-*`)는 건드리지 않는다.
"""
import os
import sys

import numpy as np
from PIL import Image

for _st in (sys.stdout, sys.stderr):
    try:
        _st.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'kiosk', 'assets')


def arg(k, d=None):
    a = sys.argv
    return a[a.index('--' + k) + 1] if ('--' + k) in a and a.index('--' + k) + 1 < len(a) else d


def rgb_to_hsv(rgb):
    """rgb 0..1 (N,3) → h(0..360), s, v"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=-1); mn = rgb.min(axis=-1); d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r); gm = nz & (mx == g) & ~rm; bm = nz & ~rm & ~gm
    h[rm] = (60 * ((g[rm] - b[rm]) / d[rm])) % 360
    h[gm] = 60 * ((b[gm] - r[gm]) / d[gm]) + 120
    h[bm] = 60 * ((r[bm] - g[bm]) / d[bm]) + 240
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    c = v * s
    hp = (h % 360) / 60.0
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(c)
    i = np.floor(hp).astype(int) % 6
    r = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [c, x, z, z, x, c])
    g = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [x, c, c, x, z, z])
    b = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [z, z, x, c, c, x])
    m = v - c
    return np.stack([r + m, g + m, b + m], axis=-1)


def recolor(im, hue_to, strength, lo, hi, soft=12.0, min_sat=0.12):
    a = np.asarray(im.convert('RGBA')).astype(np.float32) / 255.0
    rgb, alpha = a[..., :3], a[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    # 초록 구간 가중치: 안쪽 1, 경계 ±soft 에서 0 으로 부드럽게. 회색(저채도)은 색상각이 무의미하니 제외.
    w = np.clip(np.minimum(h - (lo - soft), (hi + soft) - h) / soft, 0, 1)
    w *= np.clip((s - min_sat) / 0.1, 0, 1)
    w *= (alpha > 0.02)
    # 가까운 방향으로 목표 색상각까지 strength 만큼 이동
    delta = ((hue_to - h + 540) % 360) - 180
    h2 = h + delta * strength * w
    out = hsv_to_rgb(h2, s, v)
    res = np.concatenate([out, alpha[..., None]], axis=-1)
    moved = float((w > 0.5).sum()) / max(1.0, float((alpha > 0.02).sum()))
    return Image.fromarray(np.clip(res * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA'), moved


def main():
    hue_to = float(arg('hue', '175'))       # #00c3b2 의 색상각 ≈ 174.8°
    strength = float(arg('strength', '0.85'))
    lo, hi = float(arg('lo', '55')), float(arg('hi', '170'))
    files = arg('files')
    if files:
        names = [f.strip() for f in files.split(',') if f.strip()]
    else:
        names = sorted(f for f in os.listdir(ASSETS) if f.startswith(('tree-', 'plant-')) and f.endswith('.png'))
    if not names:
        print('대상 파일 없음'); return 1
    for n in names:
        p = os.path.join(ASSETS, n)
        im = Image.open(p)
        out, moved = recolor(im, hue_to, strength, lo, hi)
        out.save(p, optimize=True)
        print('%-12s 초록 구간 픽셀 %4.0f%% → 색상각 %.0f° (strength %.2f)' % (n, moved * 100, hue_to, strength))
    return 0


if __name__ == '__main__':
    sys.exit(main())
