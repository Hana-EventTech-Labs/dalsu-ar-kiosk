#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""헤엄 스프라이트 시트 자동 검증. 사람 눈에 의존하지 않고 수치로 거른다.

  python scripts/verify-swim-sheet.py

하나라도 실패하면 exit 1 + 어느 프레임인지 출력한다.
통과하면 측정한 phase0 를 dalsu-swim.json 에 써 넣고, 육안 확인용 contact-sheet 를 남긴다.

지표를 고르며 배운 것 두 가지 (되돌리지 말 것):
  · '상위 8색 점유율'로 플랫 룩을 재려 했다가 뺐다. 그 값은 **영상 압축 잡음**을 세는 것이지
    3D 셰이딩을 세는 게 아니다(원본 0.96 vs 시트 0.68 인데 눈으로 보면 시트도 완전히 플랫이다).
    지금은 '면 내부의 완만한 밝기 기울기'를 원본과 같은 절차로 재서 **원본 대비 비율**로 본다.
  · 무게중심·면적·색 분포를 실루엣 전체로 재면 **꼬리가 크게 흔들리는 것 자체가 실패로 잡힌다**.
    우리가 원한 게 그 움직임이므로, 이 셋은 꼬리를 뺀 몸통 코어에서 잰다.
"""
import os
import sys
import json

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

for _st in (sys.stdout, sys.stderr):          # 윈도우 콘솔 기본 코드페이지(cp949) 대응
    try:
        _st.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'kiosk', 'assets')
OUTDIR = os.path.join(ROOT, 'assets-src', 'swim')

fails, warns, notes = [], [], []


def check(ok, label, detail):
    (notes if ok else fails).append('%-26s %s' % (label, detail))
    return ok


def warn_if(bad, label, detail):
    (warns if bad else notes).append('%-26s %s' % (label, detail))


def shading(im, r=10):
    """면 내부의 완만한 밝기 기울기. 셰이딩은 수십 px 에 걸쳐 부드럽게 변하고 압축 잡음은 흐리면 사라진다."""
    a = np.asarray(im)
    m = ndimage.binary_erosion(a[..., 3] > 200, np.ones((2 * r + 1, 2 * r + 1)))
    if m.sum() < 100:
        return 0.0
    g = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(r)), dtype=np.float32)
    gy, gx = np.gradient(g)
    return float(np.percentile(np.hypot(gx, gy)[m], 90))


def main():
    mp = os.path.join(ASSETS, 'dalsu-swim.json')
    sp = os.path.join(ASSETS, 'dalsu-swim.png')
    if not (os.path.exists(mp) and os.path.exists(sp)):
        print('시트가 없다 — 검증할 것이 없다', file=sys.stderr)
        return 2
    m = json.load(open(mp, encoding='utf-8'))
    sheet = Image.open(sp).convert('RGBA')
    N, cw, ch = m['frames'], m['cellW'], m['cellH']
    if sheet.width != m['sheetW'] or sheet.height != m['sheetH']:
        print('시트 크기가 메타와 다르다', file=sys.stderr)
        return 2

    cells = [sheet.crop(((i % m['cols']) * cw, (i // m['cols']) * ch,
                         (i % m['cols'] + 1) * cw, (i // m['cols'] + 1) * ch)) for i in range(N)]
    arr = [np.asarray(c, dtype=np.uint8) for c in cells]
    alpha = [a[..., 3] for a in arr]

    # 몸통 코어 / 꼬리 구간 — 달수는 왼쪽을 보고 누워 있으므로 꼬리는 오른쪽 끝이다
    bx, bw = int(m['body']['x'] * cw), int(m['body']['w'] * cw)
    core1 = bx + int(bw * 0.62)
    tail0 = bx + int(bw * 0.72)

    # ---------- ① 코어 무게중심 정지성 / ② 드리프트 ----------
    yy, xx = np.mgrid[0:ch, 0:core1]
    cx, cy, ca = [], [], []
    for a in alpha:
        w = a[:, :core1].astype(np.float32)
        t = max(1.0, w.sum())
        cx.append(float((xx * w).sum() / t)); cy.append(float((yy * w).sum() / t))
        ca.append(float((a[:, :core1] > 128).sum()))
    cx, cy, ca = np.array(cx), np.array(cy), np.array(ca)
    dx, dy = float(np.abs(cx - cx.mean()).max()), float(np.abs(cy - cy.mean()).max())
    check(dx <= 0.030 * cw, '코어 가로 흔들림', '%.1fpx (한계 %.1f)' % (dx, 0.030 * cw))
    check(dy <= 0.035 * ch, '코어 세로 흔들림', '%.1fpx (한계 %.1f)' % (dy, 0.035 * ch))
    t = np.arange(N)
    sx = float(np.polyfit(t, cx, 1)[0]) * N
    sy = float(np.polyfit(t, cy, 1)[0]) * N
    check(abs(sx) <= 0.030 * cw and abs(sy) <= 0.030 * ch, '코어 드리프트',
          '가로 %.1f / 세로 %.1f px per 사이클 (한계 %.1f/%.1f)' % (sx, sy, 0.030 * cw, 0.030 * ch))
    # 면적은 **전체 실루엣**으로 재고 한계를 넉넉히 둔다.
    # 코어(머리·가슴)로 좁게 재 봤더니 앞발이 앞으로 뻗는 것만으로 1.13배가 나와 '우리가 원한 동작'이 실패로 잡혔다.
    # 여기서 잡고 싶은 건 몸이 통째로 부풀거나 사지가 사라지는 붕괴다.
    full = np.array([float((a > 128).sum()) for a in alpha])
    check(full.max() / max(1.0, full.min()) <= 1.50, '실루엣 면적 변동',
          '%.3f배 (한계 1.50) — 몸이 통째로 부풀거나 사지가 사라지면 걸린다' % (full.max() / max(1.0, full.min())))

    # ---------- ③ 루프 이음새 ----------
    small = [np.asarray(c.resize((96, max(2, int(96 * ch / cw)))), dtype=np.float32) for c in cells]
    small = [s * (s[..., 3:4] / 255.0) for s in small]
    D = lambda i, j: float(np.abs(small[i] - small[j]).mean())
    neigh = [D(i, i + 1) for i in range(N - 1)]
    seam, med = D(N - 1, 0), float(np.median(neigh))
    check(seam <= max(4.0, med * 2.0), '루프 이음새', '%.2f = 이웃 중앙값의 %.2f배 (한계 2.0배)' % (seam, seam / max(1e-6, med)))
    warn_if(seam > med * 1.25, '루프 이음새(권장)', '%.2f배 — 1.25배 이하가 이상적' % (seam / max(1e-6, med)))

    # ---------- ④ 형태 보존 IoU ----------
    ref = alpha[m['restIndex']] > 128
    ious = np.array([float((ref & (a > 128)).sum()) / max(1.0, float((ref | (a > 128)).sum())) for a in alpha])
    # 실루엣 IoU 의 한계는 '붕괴 감지선'이지 '움직이지 마라'가 아니다.
    # 앞발을 머리 앞까지 뻗는 진짜 젓기 동작이면 정지 포즈 대비 0.72 언저리가 정상이다(실측 0.716).
    # 캐릭터가 알아볼 수 없게 무너지면 0.4 대로 떨어진다 — 거기를 막는다.
    # "여전히 달수인가"는 바로 아래 원본 정합 IoU 가 직접 검사한다.
    check(ious.min() >= 0.55, '실루엣 붕괴 감지', '최소 IoU %.3f (프레임 %d, 한계 0.55)' % (ious.min(), int(ious.argmin())))
    reg = float(((m.get('source') or {}).get('restIoU')) or 0)
    check(reg >= 0.80, '★ 원본 실루엣 정합', '%.3f (한계 0.80) — 이게 "여전히 달수인가"를 직접 잰다' % reg)

    # ---------- ⑤ 색 분포 안정성 ----------
    # **전체 캐릭터**로 잰다(이동 불변). 코어로 좁히면 앞발이 드나드는 것만으로 값이 크게 흔들린다.
    # 여기서 잡고 싶은 건 3D화·실사화로 인한 색 드리프트다.
    def hist(a):
        op = a[..., 3] > 200
        v = np.concatenate([np.histogram(a[..., c][op], bins=32, range=(0, 256))[0].astype(np.float32)
                            for c in range(3)])
        return v / max(1e-6, float(np.linalg.norm(v)))
    hs = np.array([hist(a) for a in arr])
    hm = hs.mean(axis=0); hm /= max(1e-6, float(np.linalg.norm(hm)))
    cos = hs @ hm
    check(cos.min() >= 0.95, '색 분포 안정성', '최소 코사인 %.4f (프레임 %d, 한계 0.95)' % (cos.min(), int(cos.argmin())))

    # ---------- ⑥ 팔레트 이탈 / 배경 잔여 ----------
    # 채도는 밝기가 아주 낮으면 수학적으로 1.0 이 나온다([1,0,0] 같은 픽셀) — 어두운 픽셀은 제외한다.
    worst_s, worst_out = 0.0, 0.0
    for a in arr:
        rgb = a[..., :3].astype(np.float32)
        mx, mn = rgb.max(-1), rgb.min(-1)
        op = (a[..., 3] > 128) & (mx > 40)
        if not op.any():
            continue
        s = (mx - mn) / np.maximum(mx, 1e-6)
        # 최댓값으로 재면 프레임당 서너 개짜리 압축 링잉 픽셀([41,12,23] 같은 어두운 점)이 결과를 정한다.
        # 어떤 색이 '면'으로 존재하는지가 궁금한 것이므로 백분위로 본다.
        worst_s = max(worst_s, float(np.percentile(s[op], 99.9)))
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        greenish = (g > r) & (g > b) & (s > 0.25) & op          # 남은 크로마 그린
        worst_out = max(worst_out, float(greenish.sum()) / float(op.sum()))
    check(worst_s <= 0.62, '최대 채도', '99.9백분위 %.3f (원본 0.487, 한계 0.62)' % worst_s)
    check(worst_out <= 0.005, '남은 크로마 그린', '%.3f%% (한계 0.5%%)' % (worst_out * 100))

    # ---------- ⑦ 플랫 유지 (기획 10번) ----------
    ow, oh = int(m['bodyPx']['w']), int(m['bodyPx']['h'])
    orig = Image.open(os.path.join(ASSETS, 'dalsu-float.png')).convert('RGBA').resize((ow, oh), Image.LANCZOS)
    base = shading(orig)
    sv = np.array([shading(c) for c in cells])
    check(base > 0 and sv.max() <= base * 1.35, '플랫 유지(셰이딩)',
          '시트 최대 %.2f / 원본 %.2f = %.2f배 (한계 1.35배)' % (sv.max(), base, sv.max() / max(1e-6, base)))

    # ---------- ⑧ 연결성 ----------
    worst_frac, worst_n = 1.0, 0
    for a in alpha:
        lab, n = ndimage.label(a > 16)
        if n == 0:
            continue
        sizes = ndimage.sum(a.astype(np.float32), lab, range(1, n + 1))
        worst_frac = min(worst_frac, float(sizes.max() / max(1.0, sizes.sum())))
        worst_n = max(worst_n, n)
    check(worst_frac >= 0.99 and worst_n <= 3, '연결성', '최대성분 %.4f, 성분 최대 %d개' % (worst_frac, worst_n))

    # ---------- ⑨ 움직임 존재 — 이번 작업의 존재 이유 ----------
    tail_cy = []
    gy = np.mgrid[0:ch, 0:cw - tail0][0]
    for a in alpha:
        w = a[:, tail0:].astype(np.float32)
        tail_cy.append(float((gy * w).sum() / max(1.0, w.sum())))
    tail_cy = np.array(tail_cy)
    amp = float(tail_cy.max() - tail_cy.min())
    check(amp >= 0.030 * ch, '★ 꼬리 움직임 진폭', '%.1fpx (한계 %.1f) — 뻣뻣하면 여기서 걸린다' % (amp, 0.030 * ch))
    check(float(np.mean(neigh)) >= 1.5, '★ 프레임 간 변화량', '%.2f (한계 1.5)' % float(np.mean(neigh)))

    # ---------- ⑩ 한 사이클인가 ----------
    # 전체 프레임 지문의 자기상관. 내부에 강한 되풀이가 있으면 1.5주기 같은 게 섞여 들어온 것이다.
    fp = np.array([s.ravel() for s in small], dtype=np.float32)
    fp -= fp.mean(axis=0)
    nrm = np.array([float(np.dot(fp[0], np.roll(fp, -k, axis=0)[0])) for k in range(0)])  # placeholder
    ac = np.array([float((fp * np.roll(fp, -k, axis=0)).sum() / max(1e-6, (fp * fp).sum())) for k in range(N)])
    inner = ac[3:N - 3]
    check(len(inner) == 0 or inner.max() < 0.60, '한 사이클 여부',
          '내부 자기상관 최대 %.2f (한계 0.60)' % (float(inner.max()) if len(inner) else 0.0))

    # ---------- ⑪ 위상 정합 → phase0 ----------
    # swimPose 의 push 는 θ=π 에서 최대다. 시트에서 '가장 세게 젓는 순간'은 꼬리가 가장 빠르게
    # 지나가는 프레임이므로, 그 프레임이 θ=π 에 오도록 phase0 를 잡는다.
    # 눈으로 맞추면 반드시 틀린다 — 90도 어긋나면 "가장 빨리 나아가는 순간에 몸은 쉬는" 그림이 된다.
    sig = tail_cy - tail_cy.mean()
    vel = np.array([abs(sig[(i + 1) % N] - sig[(i - 1) % N]) for i in range(N)])
    imax = int(vel.argmax())
    phase0 = float((imax / float(N) - 0.5) % 1.0)

    # ---------- ⑫ 디스필 무해성 (원본 기준) ----------
    o = np.asarray(Image.open(os.path.join(ASSETS, 'dalsu-float.png')).convert('RGBA'), dtype=np.int16)
    op = o[..., 3] > 200
    viol = int((o[..., 1][op] > np.maximum(o[..., 0][op], o[..., 2][op])).sum())
    check(viol == 0, '디스필 무해성(원본)', '위반 %d픽셀' % viol)

    # ---------- 결과 ----------
    for n in notes:
        print('  OK   ' + n)
    for w in warns:
        print('  경고 ' + w)
    for f in fails:
        print('  실패 ' + f, file=sys.stderr)

    os.makedirs(OUTDIR, exist_ok=True)
    cols, th = 6, 200
    rows = int(np.ceil(N / cols))
    tw = int(th * cw / ch)
    contact = Image.new('RGB', (tw * cols, th * rows), (255, 255, 255))
    for y in range(0, th * rows, 20):
        for x in range(0, tw * cols, 20):
            if (x // 20 + y // 20) % 2:
                contact.paste((214, 214, 214), (x, y, min(x + 20, tw * cols), min(y + 20, th * rows)))
    for i, c in enumerate(cells):
        s = c.resize((tw, th), Image.LANCZOS)
        contact.paste(s, ((i % cols) * tw, (i // cols) * th), s)
    contact.save(os.path.join(OUTDIR, 'contact-sheet.png'))

    if fails:
        print('\n검증 실패 %d건 — 시트를 쓰지 말 것' % len(fails), file=sys.stderr)
        return 1

    m['phase0'] = round(phase0, 5)
    m['verified'] = {'restIoUmin': round(float(ious.min()), 3), 'tailAmpPx': round(amp, 1),
                     'shadingRatio': round(float(sv.max() / max(1e-6, base)), 3),
                     'seamRatio': round(seam / max(1e-6, med), 2), 'kickFrame': imax}
    json.dump(m, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('\n전부 통과. phase0 = %.5f (가장 세게 젓는 프레임 %d 을 θ=π 에 맞춤)' % (phase0, imax))
    print('육안 확인: assets-src/swim/contact-sheet.png')
    return 0


if __name__ == '__main__':
    sys.exit(main())
