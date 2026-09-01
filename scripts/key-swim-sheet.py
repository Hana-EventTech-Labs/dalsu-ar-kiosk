#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""크로마 프레임 → 투명 헤엄 스프라이트 시트.

  python scripts/key-swim-sheet.py [--frames DIR] [--n 24] [--body 512]

입력  assets-src/swim/frames/frame-*.png   (grab-frames.js 가 뽑은 균등 표본)
출력  kiosk/assets/dalsu-swim.png + dalsu-swim.json

키잉이 RGB 거리가 아니라 (색상, 채도) 기준인 이유:
  달수 팔레트는 색상이 전부 0°~90°, 채도 최대 0.487 이다. 크로마 그린(145°)과 55° 이상 떨어져 있어
  색상만으로 완전히 분리된다. RGB 거리로 재면 진갈색 #3e3837 이 녹색과 138밖에 안 떨어져 위험하다.
"""
import os
import sys
import json
import glob
import importlib.util

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_largest_component():
    """scripts/keep-largest-blob.py 의 함수를 그대로 재사용한다(로직을 복붙하지 않는다)."""
    spec = importlib.util.spec_from_file_location('klb', os.path.join(ROOT, 'scripts', 'keep-largest-blob.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.largest_component


largest_component = _load_largest_component()


def arg(k, d):
    a = sys.argv
    return a[a.index('--' + k) + 1] if ('--' + k) in a and a.index('--' + k) + 1 < len(a) else d


def hsv(rgb):
    """rgb: float32 HxWx3 (0~255) → (hue 0~360, sat 0~1, val 0~1). numpy 로 직접 — colorsys 는 픽셀 루프라 못 쓴다."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    idx = nz & (mx == r)
    h[idx] = (60 * ((g[idx] - b[idx]) / d[idx]) + 360) % 360
    idx = nz & (mx == g)
    h[idx] = 60 * ((b[idx] - r[idx]) / d[idx]) + 120
    idx = nz & (mx == b)
    h[idx] = 60 * ((r[idx] - g[idx]) / d[idx]) + 240
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx / 255.0


def hue_dist(h, key):
    d = np.abs(h - key)
    return np.minimum(d, 360 - d)


def key_frame(path, key_hue, key_rgb):
    im = Image.open(path).convert('RGB')
    rgb = np.asarray(im, dtype=np.float32)
    h, s, v = hsv(rgb)
    dh = hue_dist(h, key_hue)

    # 배경다움 = '녹색 계열' × '채도 높음'. 달수는 dh ≥ 55° 라 hueTerm 이 0 이 되어 절대 깎이지 않는다.
    hue_term = np.clip((45.0 - dh) / 20.0, 0, 1)
    sat_term = np.clip((s - 0.22) / 0.18, 0, 1)
    alpha = np.clip(1.0 - hue_term * sat_term, 0, 1)

    # 언프리멀티플라이 — 반투명 가장자리는 이미 배경과 섞여 있다. 배경 기여분을 역산해 빼지 않으면
    # 캔버스에 얹었을 때 초록 테두리가 남는다.
    a3 = alpha[..., None]
    out = np.where(a3 > 0.15, (rgb - (1.0 - a3) * key_rgb) / np.maximum(a3, 1e-3), rgb)
    # 디스필 — 원본 팔레트에 G > max(R,B) 픽셀이 0개라 전체에 걸어도 캐릭터 색은 1레벨도 안 변한다.
    out[..., 1] = np.minimum(out[..., 1], np.maximum(out[..., 0], out[..., 2]))
    out = np.clip(out, 0, 255)

    a8 = (alpha * 255).astype(np.uint8)
    keep = largest_component(a8)              # 모델이 그린 잔여 조각 제거
    a8 = np.where(keep, a8, 0)
    rgba = np.dstack([out.astype(np.uint8), a8])
    im2 = Image.fromarray(rgba, 'RGBA')
    # 페더 — 계단진 외곽을 아주 살짝만 부드럽게 (cutout-web-assets.py 와 같은 방식)
    r, g, b, al = im2.split()
    im2 = Image.merge('RGBA', (r, g, b, al.filter(ImageFilter.GaussianBlur(1.0))))
    return im2


def sig(im, w=64):
    """사이클 검출용 축소 지문. 알파를 곱해 배경(투명)이 거리에 끼어들지 않게 한다."""
    s = im.resize((w, int(w * im.height / im.width)), Image.BILINEAR)
    a = np.asarray(s, dtype=np.float32)
    return a[..., :3] * (a[..., 3:4] / 255.0), a[..., 3]


def main():
    fdir = arg('frames', os.path.join(ROOT, 'assets-src', 'swim', 'frames'))
    N = int(arg('n', '24'))
    BODY_H = int(arg('body', '512'))
    GUTTER = 8

    files = sorted(glob.glob(os.path.join(fdir, 'frame-*.png')))
    if len(files) < 12:
        print('프레임이 너무 적다: %d' % len(files), file=sys.stderr)
        return 2

    # 키 색은 첫 프레임 테두리에서 실측한다(프롬프트가 어떤 녹색을 그렸는지 모르므로)
    a0 = np.asarray(Image.open(files[0]).convert('RGB'), dtype=np.float32)
    border = np.concatenate([a0[:24].reshape(-1, 3), a0[-24:].reshape(-1, 3),
                             a0[:, :24].reshape(-1, 3), a0[:, -24:].reshape(-1, 3)])
    key_rgb = np.median(border, axis=0)
    kh, ks, kv = hsv(key_rgb.reshape(1, 1, 3))
    key_hue = float(kh[0, 0])
    print('키 색 실측 RGB(%d,%d,%d) hue %.1f° sat %.2f' % (key_rgb[0], key_rgb[1], key_rgb[2], key_hue, ks[0, 0]))
    if ks[0, 0] < 0.5:
        print('배경 채도가 낮다(%.2f) — 단색 크로마가 아닌 것 같다' % ks[0, 0], file=sys.stderr)
        return 3

    print('키잉 %d장...' % len(files))
    keyed = [key_frame(f, key_hue, key_rgb) for f in files]

    # ---- 사이클 검출 ----
    sigs = [sig(im)[0] for im in keyed]
    K = len(sigs)

    def dist(i, j):
        return float(np.abs(sigs[i] - sigs[j]).mean())

    # ★ 이음매만 보고 (주기, 시작)을 고르면 안 된다. 두 번 실패했다.
    #   ① 평균거리 최소만 보면 **배수 주기**(3주기)가 뽑혀 3사이클을 24장으로 훑는 앨리어싱이 난다.
    #   ② start_image = end_image 로 만든 클립은 앞뒤가 '정지 포즈'라 거의 안 움직인다.
    #      그 구간은 이음매가 완벽하므로 항상 이긴다 — 실제로 24장이 전부 같은 시트가 나왔다.
    # → 이음매는 낮고 **구간 안에 움직임이 있는** (p, start) 를 고른다. 점수 = 이음매 / 구간내 움직임.
    neigh_all = [dist(i, i + 1) for i in range(K - 1)]
    neigh = float(np.mean(neigh_all))
    lo, hi = max(6, int(K * 0.08)), int(K * 0.55)
    best = None
    for p in range(lo, hi + 1):
        for st in range(0, K - p):
            motion = float(np.mean(neigh_all[st:st + p])) if p > 0 else 0.0
            if motion < neigh * 0.6:          # 정지 구간은 아예 후보에서 뺀다
                continue
            sm = dist(st, st + p)
            score = sm / max(1e-6, motion)
            if best is None or score < best[0]:
                best = (score, p, st, sm, motion)
    if best is None:                          # 클립 전체가 거의 정지 — 그래도 뭔가는 내보낸다
        best = (0, hi, 0, dist(0, hi), neigh)
        print('경고: 움직임이 있는 구간을 못 찾았다 — 클립을 다시 만들 것', file=sys.stderr)
    _, best_p, start, seam, motion = best
    print('주기 %d프레임 (%.1f사이클), 시작 %d, 이음매 %.2f, 구간내 움직임 %.2f (전체 평균 %.2f)'
          % (best_p, K / best_p, start, seam, motion, neigh))

    # 한 사이클을 N 프레임으로 최근접 재샘플 (보간·크로스페이드 금지 — 고스팅이 플랫 룩을 무너뜨린다)
    idx = [(start + int(round(best_p * i / N))) % K for i in range(N)]
    frames = [keyed[i] for i in idx]

    # ---- 셀 규격 ----
    boxes = [f.split()[-1].point(lambda x: 255 if x > 16 else 0).getbbox() for f in frames]
    ux0 = min(b[0] for b in boxes); uy0 = min(b[1] for b in boxes)
    ux1 = max(b[2] for b in boxes); uy1 = max(b[3] for b in boxes)

    # ---- 원본 실루엣에 정합 ----
    # 알파 bbox 를 그대로 몸 상자로 쓰면 안 된다. 헤엄 중에는 꼬리가 펴져 bbox 가 원본(종횡비 1.41)보다
    # 훨씬 넓어지고(실측 1.95), 그 상자를 원본 자리에 맞춰 그리면 캐릭터가 가로로 눌린다.
    # 대신 '원본 실루엣을 어느 크기·위치에 놓아야 가장 겹치는지'를 찾아 그 사각형을 몸 상자로 삼는다.
    # 그러면 종횡비가 원본과 정확히 같아지고, 꼬리는 셀 안에서 자유롭게 뻗는다.
    ref = Image.open(os.path.join(ROOT, 'kiosk', 'assets', 'dalsu-float.png')).convert('RGBA')
    rbb = ref.split()[-1].point(lambda x: 255 if x > 16 else 0).getbbox()
    ref_m = ref.crop(rbb).split()[-1]
    ref_ar = (rbb[2] - rbb[0]) / float(rbb[3] - rbb[1])
    WK = 128                                   # 정합은 축소본에서 — 충분히 정확하고 훨씬 빠르다

    def register(frame, bb0):
        fa = np.asarray(frame.split()[-1], dtype=np.uint8)
        H0, W0 = fa.shape
        k = WK / float(W0)
        sm = np.asarray(Image.fromarray(fa).resize((WK, max(1, int(WK * H0 / W0))), Image.BILINEAR)) > 16
        best = (-1.0, None)
        h0 = (bb0[3] - bb0[1]) * k
        for smul in (0.78, 0.86, 0.92, 0.97, 1.02, 1.08, 1.16, 1.26):
            hh = max(4, int(round(h0 * smul)))
            ww = max(4, int(round(hh * ref_ar)))
            om = np.asarray(ref_m.resize((ww, hh), Image.BILINEAR)) > 16
            osum = int(om.sum())
            for oy in range(int(bb0[1] * k) - hh // 5, int(bb0[3] * k) - hh + hh // 5 + 1, max(1, hh // 14)):
                for ox in range(int(bb0[0] * k) - ww // 5, int(bb0[2] * k) - ww + ww // 5 + 1, max(1, ww // 14)):
                    y0, x0 = max(0, oy), max(0, ox)
                    y1, x1 = min(sm.shape[0], oy + hh), min(sm.shape[1], ox + ww)
                    if y1 - y0 < 4 or x1 - x0 < 4:
                        continue
                    inter = int((sm[y0:y1, x0:x1] & om[y0 - oy:y1 - oy, x0 - ox:x1 - ox]).sum())
                    iou = inter / max(1, int(sm.sum()) + osum - inter)
                    if iou > best[0]:
                        best = (iou, (ox / k, oy / k, ww / k, hh / k))
        return best

    best_iou, rest, rect = -1.0, 0, None
    for i, f in enumerate(frames):
        iou, r = register(f, boxes[i])
        if iou > best_iou:
            best_iou, rest, rect = iou, i, r
    bb = (rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3])
    print('기준 프레임 %d (정합 IoU %.3f), 몸 상자 %.0fx%.0f 종횡비 %.3f (원본 %.3f)'
          % (rest, best_iou, bb[2] - bb[0], bb[3] - bb[1], (bb[2] - bb[0]) / (bb[3] - bb[1]), ref_ar))

    scale = BODY_H / float(bb[3] - bb[1])
    cw = int(round((ux1 - ux0) * scale)) + GUTTER * 2
    ch = int(round((uy1 - uy0) * scale)) + GUTTER * 2
    cols = 4
    rows = int(np.ceil(N / cols))

    sheet = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        c = f.crop((ux0, uy0, ux1, uy1))
        c = c.resize((cw - GUTTER * 2, ch - GUTTER * 2), Image.LANCZOS)
        sheet.paste(c, ((i % cols) * cw + GUTTER, (i // cols) * ch + GUTTER), c)

    body = {
        'x': round((GUTTER + (bb[0] - ux0) * scale) / cw, 6),
        'y': round((GUTTER + (bb[1] - uy0) * scale) / ch, 6),
        'w': round(((bb[2] - bb[0]) * scale) / cw, 6),
        'h': round(((bb[3] - bb[1]) * scale) / ch, 6),
    }

    out_png = os.path.join(ROOT, 'kiosk', 'assets', 'dalsu-swim.png')
    sheet.save(out_png, optimize=True)
    meta = {
        'version': 1, 'sheet': 'dalsu-swim.png',
        'sheetW': sheet.width, 'sheetH': sheet.height,
        'frames': N, 'cols': cols, 'rows': rows, 'cellW': cw, 'cellH': ch,
        'body': body, 'bodyPx': {'w': int(round((bb[2] - bb[0]) * scale)), 'h': BODY_H},
        'bodyAspect': round((bb[2] - bb[0]) / (bb[3] - bb[1]), 5),
        'restIndex': rest, 'phase0': 0.0,
        'srcAspect': round(ref.width / ref.height, 5),
        'source': {'frames': len(files), 'period': best_p, 'start': start,
                   'seam': round(seam, 3), 'neighbor': round(neigh, 3), 'restIoU': round(best_iou, 3)},
    }
    with open(os.path.join(ROOT, 'kiosk', 'assets', 'dalsu-swim.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print('시트 %dx%d (%d프레임, 셀 %dx%d) → %s (%.1f MB)'
          % (sheet.width, sheet.height, N, cw, ch, out_png, os.path.getsize(out_png) / 1048576.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
