#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""단색 배경 위에 나란히 놓인 자연 오브젝트 스트립 → 개별 투명 PNG.

  python scripts/cutout-nature.py --in assets-src/nature/plants-strip.png --map tree,tree,tree,plant,plant,plant

왜 색상 키잉이 아니라 **테두리 flood fill** 인가:
  달수 컷아웃은 캐릭터에 녹색이 전혀 없어 (색상, 채도)만으로 배경을 갈라낼 수 있었다.
  나무·수풀은 잎이 초록이라 그 방법을 쓰면 잎의 32%(실측)가 배경으로 잡혀 사라진다.
  대신 배경이 '테두리에서 연결된 한 덩어리'라는 성질을 쓴다 — 안쪽 잎은 아무리 배경색과 비슷해도
  테두리와 이어져 있지 않으므로 절대 지워지지 않는다.

출력 규약(renderer.js 가 그리는 방식에 맞춘다):
  tree-*.png  밑동이 바닥에 닿게 그려지고 원본 비율을 그대로 쓴다 → 여백 없이 꽉 크롭
  plant-*.png 정사각 중앙 배치로 그려진다(물고기와 동일) → 512 정사각, 아래쪽에 붙여 앉힌다
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

for _st in (sys.stdout, sys.stderr):
    try:
        _st.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANT_BOX = 512


def arg(k, d=None):
    a = sys.argv
    return a[a.index('--' + k) + 1] if ('--' + k) in a and a.index('--' + k) + 1 < len(a) else d


def main():
    src = arg('in', os.path.join(ROOT, 'assets-src', 'nature', 'plants-strip.png'))
    kinds = (arg('map', 'tree,tree,tree,plant,plant,plant')).split(',')
    tol = float(arg('tol', '26'))
    erode = int(arg('erode', '2'))
    if not os.path.exists(src):
        print('입력이 없다: ' + src, file=sys.stderr)
        return 2

    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    H, W, _ = a.shape
    border = np.concatenate([a[:20].reshape(-1, 3), a[-20:].reshape(-1, 3),
                             a[:, :20].reshape(-1, 3), a[:, -20:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    d = np.abs(a - bg).max(axis=2)
    print('배경색 RGB(%d,%d,%d), 허용오차 %d' % (bg[0], bg[1], bg[2], tol))

    similar = d < tol
    seed = np.zeros_like(similar)
    seed[0, :] = similar[0, :]; seed[-1, :] = similar[-1, :]
    seed[:, 0] = similar[:, 0]; seed[:, -1] = similar[:, -1]
    # 테두리에서 '배경색과 비슷한 픽셀'만 타고 번진다 — 안쪽 잎은 여기 닿지 않는다
    bgmask = ndimage.binary_propagation(seed, mask=similar)
    print('배경 %.1f%%, 오브젝트 %.1f%%' % (bgmask.mean() * 100, (1 - bgmask.mean()) * 100))

    # 잎에 둘러싸인 배경은 테두리와 이어져 있지 않아 위 번짐이 못 닿는다(고사리 잎 사이 등).
    # 그런 '구멍'은 배경색 그대로라 아주 평평하다 — 잎은 음영이 있어 색이 흔들린다. 그 차이로 가른다.
    holes = similar & (~bgmask)
    hl, hn = ndimage.label(holes)
    filled = 0
    if hn:
        for i in range(1, hn + 1):
            sel = hl == i
            if int(sel.sum()) < 150:
                continue
            if float(d[sel].mean()) < 8.0:      # 배경색과 사실상 동일 = 갇힌 배경
                bgmask |= sel
                filled += int(sel.sum())
    if filled:
        print('갇힌 배경 %d픽셀 추가 제거' % filled)

    solid = ~bgmask
    # 배경색이 섞인 안티에일리어싱 테두리를 깎아낸다. 잎이 초록이라 디스필로는 못 걷어내므로 침식이 답이다.
    if erode > 0:
        solid = ndimage.binary_erosion(solid, np.ones((2 * erode + 1, 2 * erode + 1)))
    # 오브젝트 안에 배경색과 같은 색으로 뚫린 구멍이 있으면 메운다(잎 사이 틈은 남겨야 하므로 작은 것만)
    solid = ndimage.binary_closing(solid, np.ones((3, 3)))

    lab, n = ndimage.label(solid)
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    keep = [i + 1 for i in range(n) if sizes[i] > solid.size * 0.0008]   # 먼지 제거
    # 행 우선 정렬 — 여러 줄 그리드면 y 를 먼저(이미지 높이의 1/3 단위로 묶고) x 로
    cms = {l: ndimage.center_of_mass(lab == l) for l in keep}
    order = sorted(keep, key=lambda l: (int(cms[l][0] / (H / 3)), cms[l][1]))
    print('오브젝트 %d개 검출 (전체 성분 %d)' % (len(order), n))
    if len(order) != len(kinds):
        print('경고: 검출 %d개 ≠ map %d개 — map 을 맞춰 다시 실행할 것' % (len(order), len(kinds)), file=sys.stderr)

    out_dir = os.path.join(ROOT, 'kiosk', 'assets')
    counts = {'tree': 0, 'plant': 0, 'fish': 0}
    made = []
    for idx, l in enumerate(order):
        kind = kinds[idx] if idx < len(kinds) else 'plant'
        m = (lab == l)
        ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        pad = 4
        y0, x0 = max(0, y0 - pad), max(0, x0 - pad)
        y1, x1 = min(H, y1 + pad), min(W, x1 + pad)

        al = np.zeros((H, W), np.uint8)
        al[m] = 255
        rgba = np.dstack([np.asarray(im).astype(np.uint8), al])[y0:y1, x0:x1]
        cut = Image.fromarray(rgba, 'RGBA')
        r, g, b, ch = cut.split()
        cut = Image.merge('RGBA', (r, g, b, ch.filter(ImageFilter.GaussianBlur(0.8))))

        counts[kind] += 1
        name = '%s-%d.png' % (kind, counts[kind])
        if kind == 'tree':
            # 밑동 기준·원본 비율. 높이 640 으로 맞춰 파일 크기를 억제한다.
            th = 640
            tw = max(1, int(round(cut.width * th / cut.height)))
            cut = cut.resize((tw, th), Image.LANCZOS)
        elif kind == 'fish':
            # 물고기는 정사각 **정중앙**(renderer 가 물길 위 한 점에 중심 배치하고 흐름 방향으로 좌우 반전한다).
            # 기본 방향은 **오른쪽 보기**. 생성본이 머리를 위로 그렸으므로(--fish-rot) 시계 방향으로 돌린다.
            rot = float(arg('fish-rot', '0'))
            if rot: cut = cut.rotate(-rot, expand=True, resample=Image.BICUBIC)
            s = PLANT_BOX * 0.92
            k = min(s / cut.width, s / cut.height)
            cw, chh = max(1, int(cut.width * k)), max(1, int(cut.height * k))
            small = cut.resize((cw, chh), Image.LANCZOS)
            box = Image.new('RGBA', (PLANT_BOX, PLANT_BOX), (0, 0, 0, 0))
            box.paste(small, ((PLANT_BOX - cw) // 2, (PLANT_BOX - chh) // 2), small)
            cut = box
        else:
            # 정사각 안에 아래쪽으로 붙여 앉힌다 — 중앙 배치로 그려져도 물가에 서 있는 것처럼 보인다
            s = PLANT_BOX * 0.88
            k = min(s / cut.width, s / cut.height)
            cw, chh = max(1, int(cut.width * k)), max(1, int(cut.height * k))
            small = cut.resize((cw, chh), Image.LANCZOS)
            box = Image.new('RGBA', (PLANT_BOX, PLANT_BOX), (0, 0, 0, 0))
            box.paste(small, ((PLANT_BOX - cw) // 2, int(PLANT_BOX * 0.94) - chh), small)
            cut = box
        cut.save(os.path.join(out_dir, name), optimize=True)
        made.append((name, cut.width, cut.height))
        print('  %-12s %dx%d' % (name, cut.width, cut.height))

    print('\n%d개 생성 → kiosk/assets/' % len(made))
    print('renderer 는 파일이 있으면 자동으로 벡터 스프라이트 대신 이걸 쓴다(코드 변경 불필요).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
