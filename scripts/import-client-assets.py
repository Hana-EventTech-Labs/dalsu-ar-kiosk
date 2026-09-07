#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""클라이언트 [최종 1차] 자료(2026-09-06) → kiosk/assets 런타임 자산. 결정적·재실행 가능.

  python scripts/import-client-assets.py            (npm run assets:client)

입력  assets-src/client-2026-09-06/  (카카오톡 수신 폴더를 그대로 복사해 둔 원본 — 수정 금지)
출력  kiosk/assets/
  idle-bg.jpg                 배경(1080×1920) — 영상 포스터·폴백
  idle-loop.mp4 + .json       달수 대기 루프. **깨끗한 이음매가 없어**(최적 쌍도 인접 프레임 차의 4.5배) 끝→처음을
                              K프레임 크로스페이드로 잇고, 오디오도 같은 구간을 acrossfade 한다.
  bubble-{reduce,reuse,restore}.png + bubble.json
                              물방울 3장을 450×630 공통 캔버스에 몸체 중앙 정렬(3장이 같은 기준으로 부유·스쿼시·터짐 정합)
  burst.png + burst.json      터짐 영상(검정 배경)을 루마키해 스프라이트 시트로. json 의 drop 은 정지 물방울 bbox(셀 px) —
                              renderer 가 이 값으로 영상 속 물방울을 화면 물방울에 정확히 겹친다.
  burst-sfx.wav               터짐 효과음(터짐 영상 오디오, 터짐 시작 시점부터 1.5s)
  card-frame.png + .json      포토카드 앞면 프레임(2026-09-06 저녁 `인쇄스크린_인쇄디자인.png`, 가운데가 투명 구멍).
                              664×1040 cover 로 맞추고 구멍 bbox 를 json 에 적는다 — 사진은 그 구멍에 cover 로 앉힌다.
  card-frame-demo.png + .json 데모 영상에 쓰인 앞면(`달수 앞면.png`) — config card.frameImage 로 골라 쓸 수 있는 대안.
  title.png                   타이틀 그래픽(`달수_타이틀_1.png`, 검정 배경) → 검정 키잉·크롭. 없으면 텍스트 타이틀.
  river.mp4 + river.json      [최종]전체데모.mp4 에서 물길 구간(드롭 3개 → 합류 → S자 강 → 수달, 약 9.7s)만 장면 전환 검출로 잘라낸 것.
                              screen.riverVideo 로 재생되어 강·자연·헤엄 절차 연출을 대신한다. json 의 drops 는 첫 프레임 물방울 3개 위치(정합용).
그리고 assets-src/client-2026-09-06/ 에 import-report.json(실측 수치)·burst-contact.png·idle-seam.png 를 남긴다.

왜 VP9 알파 <video> 가 아니라 시트인가: 알파 VP9 는 GPU 유무와 무관하게 소프트웨어 디코드(1440² 24fps 프레임당 15~25ms)라
GPU 없는 현장 PC 에서 물 연출과 겹치면 프레임이 밀린다. 시트는 drawImage 한 번이고 경과 시간에서 프레임을 뽑아
스모크의 시간 압축과도 맞는다.
"""
import io
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

for _st in (sys.stdout, sys.stderr):
    try:
        _st.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'client-2026-09-06')
OUT = os.path.join(ROOT, 'kiosk', 'assets')
DOCS = os.path.join(ROOT, 'docs')

F_BG = '[달수] 대기화면_확정.jpg'
F_LOOP = '[달수]대기화면.mp4'
F_BURST = '물방울_터짐.mp4'
F_SPEC = '참고사항.txt'
F_FRAME = 'card-front-frame.png'
F_FRAME_DEMO = 'card-front-frame-demo.png'
F_TITLE = os.path.join('demo', '달수_타이틀_1.png')
F_DEMO = os.path.join('demo', '[최종]전체데모.mp4')
# 데모 영상 첫 물길 프레임(검정에서 페이드인)의 유리 물방울 3개 중심 — 프레임을 눈으로 실측(±10px). 상단 작은 물방울이 여기로 모인다.
RIVER_DROPS = [[0.162, 0.19], [0.5, 0.15], [0.852, 0.19]]
CARD_W, CARD_H = 664, 1040
BUBBLES = {'reduce': 'reduce.png', 'reuse': 'reuse.png', 'restore': 'restore.png'}
# 2026-09-07 클라이언트 변경 아이콘(라벨 Reduce/Reuse/Restore 가 그림에 들어 있고 아이콘이 위로) — 있으면 이 폴더의 물방울을 쓴다
SRC_0907 = os.path.join(ROOT, 'assets-src', 'client-2026-09-07')
SRC_BUBBLES = next((d for d in [SRC_0907, SRC]
                    if all(os.path.exists(os.path.join(d, fn)) for fn in BUBBLES.values())), SRC)
# 9/7 저녁 추가 전달: 새 앞면 프레임(스크린.png → card-front-frame.png)·자막 바뀐 물길 영상(영상.mp4 → river.mp4). 있으면 이쪽이 이긴다.
F_FRAME_0907 = os.path.join(SRC_0907, 'card-front-frame.png')
F_RIVER_0907 = os.path.join(SRC_0907, 'river.mp4')

STAGE_W, STAGE_H = 1080, 1920
BUBBLE_W, BUBBLE_H = 450, 630
BURST_CELL = 512
BURST_COLS = 8
BURST_MAX_FRAMES = 40
BURST_TAIL_FADE = 8
BURST_LUMA_LO, BURST_LUMA_HI = 95.0, 175.0   # 이 아래 밝기는 검정 배경 위 잿빛 연기 — 하늘 위에서 검은 얼룩이 된다(실측), 잘라낸다
LOOP_K = 8          # 크로스페이드 프레임 수 (30fps → 0.27s)


def ffmpeg_path():
    try:
        p = subprocess.run(['node', '-p', "require('ffmpeg-static')"], capture_output=True, text=True, cwd=ROOT, shell=(os.name == 'nt')).stdout.strip()
        if p and os.path.exists(p):
            return p
    except Exception:
        pass
    p = os.path.join(ROOT, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe' if os.name == 'nt' else 'ffmpeg')
    if os.path.exists(p):
        return p
    raise SystemExit('ffmpeg 를 찾을 수 없습니다 — npm install (ffmpeg-static)')


FFMPEG = ffmpeg_path()


def run(args, **kw):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y'] + args, capture_output=True, **kw)
    if r.returncode != 0:
        raise RuntimeError('ffmpeg 실패: ' + ' '.join(args) + '\n' + r.stderr.decode('utf-8', 'replace'))
    return r


def decode_frames(path, w, h, pix='gray', vf_extra=''):
    """영상 전체를 (n, h, w[, 3]) numpy 로 — ffmpeg rawvideo 파이프."""
    vf = f'scale={w}:{h}:flags=lanczos' + (',' + vf_extra if vf_extra else '')
    r = run(['-i', path, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', pix, '-'])
    ch = 1 if pix == 'gray' else 3
    a = np.frombuffer(r.stdout, dtype=np.uint8)
    n = a.size // (w * h * ch)
    a = a[: n * w * h * ch].reshape((n, h, w) if ch == 1 else (n, h, w, ch))
    return a


def probe_fps(path):
    r = subprocess.run([FFMPEG, '-hide_banner', '-i', path], capture_output=True, text=True, encoding='utf-8', errors='replace')
    import re
    m = re.search(r'(\d+(?:\.\d+)?) fps', r.stderr)
    return float(m.group(1)) if m else 30.0


def mad(a, b):
    return float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16))))


# ---------------------------------------------------------------- 1. 배경
def import_bg(report):
    im = Image.open(os.path.join(SRC, F_BG)).convert('RGB')
    report['bg'] = {'src': list(im.size)}
    im = im.resize((STAGE_W, STAGE_H), Image.LANCZOS)
    im.save(os.path.join(OUT, 'idle-bg.jpg'), quality=92, optimize=True)
    # 물방울 띠(y 550~1000) 가운데 하늘색 — 콘택트 시트 배경·대비 판단용
    arr = np.asarray(im)
    sky = arr[550:1000, 380:700].reshape(-1, 3).mean(axis=0)
    report['bg']['skyAtBubbles'] = [int(round(v)) for v in sky]
    print(f'idle-bg.jpg  {STAGE_W}x{STAGE_H}  물방울 띠 하늘색 {report["bg"]["skyAtBubbles"]}')
    return tuple(int(round(v)) for v in sky)


# ---------------------------------------------------------------- 2. 대기 루프
def import_loop(report):
    src = os.path.join(SRC, F_LOOP)
    fps = probe_fps(src)
    g = decode_frames(src, 108, 192, 'gray')
    n = len(g)
    neighbor = float(np.mean([mad(g[k], g[k + 1]) for k in range(n - 1)]))
    best = None
    for i in range(0, min(46, n - 2)):
        for j in range(max(i + 120, n - 80), n - 1):
            s = (mad(g[i], g[j]) + mad(g[i + 1], g[j + 1])) / 2
            if best is None or s < best[0]:
                best = (s, i, j)
    seam_raw, i, j = best
    K = LOOP_K
    # 크로스페이드: 본편 = [i+K, j-K), 이음매 = blend(tail [j-K, j) → head [i, i+K))
    S, E = (i + K) / fps, (j - K) / fps
    tail0, tail1 = (j - K) / fps, j / fps
    head0, head1 = i / fps, (i + K) / fps
    # 이음매 프레임은 두 구간만 프레임 번호로 정확히 뽑아(select) **YUV 원시 데이터로** 블렌딩한다.
    # RGB(PNG)로 돌려 넣으면 601/709 변환이 끼어 밝기가 5단계 어긋나 이음매가 오히려 튄다(실측).
    fsz = STAGE_W * STAGE_H * 3 // 2
    def grab(a, b):
        r = run(['-i', src, '-vf', f"select='between(n,{a},{b - 1})'", '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'])
        buf = np.frombuffer(r.stdout, dtype=np.uint8)
        m = buf.size // fsz
        return buf[: m * fsz].reshape(m, fsz)
    tail, head = grab(j - K, j), grab(i, i + K)
    m = min(len(tail), len(head), K)
    seam = np.empty((m, fsz), dtype=np.uint8)
    for k in range(m):
        w = (k + 1) / (m + 1)
        seam[k] = (tail[k].astype(np.float32) * (1 - w) + head[k].astype(np.float32) * w).round().astype(np.uint8)
    tmp_dir = os.path.join(ROOT, 'out', 'client-import'); os.makedirs(tmp_dir, exist_ok=True)
    seam_yuv = os.path.join(tmp_dir, '_seam.yuv')   # 임시(24MB) — assets-src 는 원본 보관용
    seam.tofile(seam_yuv)
    out = os.path.join(OUT, 'idle-loop.mp4')
    xf = max(0.05, (m - 1) / fps)
    fc = (
        f'[0:v]trim=start={S:.6f}:end={E:.6f},setpts=PTS-STARTPTS[vm];'
        f'[1:v]setpts=PTS-STARTPTS[vs];[vm][vs]concat=n=2:v=1:a=0[v];'
        f'[0:a]atrim=start={S:.6f}:end={E:.6f},asetpts=PTS-STARTPTS[am];'
        f'[0:a]atrim=start={tail0:.6f}:end={tail1:.6f},asetpts=PTS-STARTPTS[at];'
        f'[0:a]atrim=start={head0:.6f}:end={head1:.6f},asetpts=PTS-STARTPTS[ah];'
        f'[at][ah]acrossfade=d={xf:.4f}:c1=tri:c2=tri[as];[am][as]concat=n=2:v=0:a=1[a]'
    )
    run(['-i', src, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-video_size', f'{STAGE_W}x{STAGE_H}', '-framerate', f'{fps}', '-i', seam_yuv,
         '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
         '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-g', str(int(round(fps))),
         '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
    # 검증: 출력의 끝→처음 차이가 인접 프레임 차의 2배 이하
    o = decode_frames(out, 108, 192, 'gray')
    seam_out = mad(o[-1], o[0])
    neighbor_out = float(np.mean([mad(o[k], o[k + 1]) for k in range(len(o) - 1)]))
    ok = seam_out <= neighbor_out * 2
    # 이음매 그림: 출력의 마지막 4 + 처음 4 프레임
    strip = Image.new('RGB', (8 * 135, 240), 'black')
    of = decode_frames(out, 135, 240, 'rgb24')
    for k, idx in enumerate(list(range(len(of) - 4, len(of))) + list(range(0, 4))):
        strip.paste(Image.fromarray(of[idx]), (k * 135, 0))
    strip.save(os.path.join(SRC, 'idle-seam.png'))
    meta = {'version': 1, 'src': F_LOOP, 'fps': fps, 'srcFrames': int(n), 'start': int(i), 'end': int(j), 'crossfadeFrames': int(m),
            'frames': int(len(o)), 'durationSec': round(len(o) / fps, 3), 'seamMADraw': round(seam_raw, 3),
            'seamMAD': round(seam_out, 3), 'neighborMAD': round(neighbor_out, 3), 'seamOk': bool(ok),
            'sizeBytes': os.path.getsize(out)}
    with open(os.path.join(OUT, 'idle-loop.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    report['loop'] = meta
    try:
        os.remove(seam_yuv)
    except OSError:
        pass
    print(f'idle-loop.mp4  {len(o)}f {meta["durationSec"]}s  컷 {i}..{j} +xfade {m}f  이음매 {seam_out:.2f} (인접 {neighbor_out:.2f}, 원본 최적 {seam_raw:.2f}) {"OK" if ok else "FAIL"}  {meta["sizeBytes"]//1024}KB')
    if not ok:
        raise SystemExit('루프 이음매가 기준(인접 2배)을 넘습니다')


# ---------------------------------------------------------------- 3. 물방울 3장
def import_bubbles(report):
    bodies = {}
    ims = {}
    for key, fn in BUBBLES.items():
        im = Image.open(os.path.join(SRC_BUBBLES, fn)).convert('RGBA')
        a = np.asarray(im)[:, :, 3]
        ys, xs = np.where(a > 128)
        bodies[key] = (int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1))
        ims[key] = im
    # 공통 몸체 크기 = 3장 평균. 각 장을 그 크기로 맞춰(차이 ≤1%) 450×630 중앙에 놓는다
    bw = int(round(np.mean([b[2] for b in bodies.values()])))
    bh = int(round(np.mean([b[3] for b in bodies.values()])))
    bx, by = (BUBBLE_W - bw) // 2, (BUBBLE_H - bh) // 2
    for key, im in ims.items():
        x, y, w, h = bodies[key]
        crop = im.crop((x, y, x + w, y + h)).resize((bw, bh), Image.LANCZOS)
        canvas = Image.new('RGBA', (BUBBLE_W, BUBBLE_H), (0, 0, 0, 0))
        canvas.paste(crop, (bx, by), crop)
        canvas.save(os.path.join(OUT, f'bubble-{key}.png'), optimize=True)
    meta = {'version': 1, 'w': BUBBLE_W, 'h': BUBBLE_H, 'body': {'x': bx, 'y': by, 'w': bw, 'h': bh},
            'keys': list(BUBBLES.keys()), 'srcBodies': bodies, 'srcDir': os.path.basename(SRC_BUBBLES)}
    with open(os.path.join(OUT, 'bubble.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    report['bubbles'] = meta
    print(f'bubble-*.png  {BUBBLE_W}x{BUBBLE_H}  몸체 {bw}x{bh} @({bx},{by})  원본 {bodies}  ← {os.path.basename(SRC_BUBBLES)}')
    return meta


# ---------------------------------------------------------------- 4. 터짐 시트
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def import_burst(report, sky, bubble_meta):
    src = os.path.join(SRC, F_BURST)
    fps = probe_fps(src)
    fr = decode_frames(src, BURST_CELL, BURST_CELL, 'rgb24')   # (n, 512, 512, 3)
    n = len(fr)
    lum = fr.max(axis=3)                                        # max(R,G,B)
    # 정지 구간 끝 = 프레임 0 대비 차이가 갑자기 커지는 첫 프레임
    diffs = np.array([mad(lum[0], lum[k]) for k in range(n)])
    base = diffs[1:10].mean() + 1e-6
    cand = [k for k in range(1, n) if diffs[k] > max(2.0, base * 6)]
    if not cand:
        raise SystemExit('터짐 영상에서 정지 구간이 끝나는 프레임을 못 찾음 — 다른 영상인가?')
    start = int(cand[0])
    bright = np.array([(lum[k] > 24).mean() for k in range(n)])
    lit = [k for k in range(n) if bright[k] > 0.0005]
    if not lit:
        raise SystemExit('터짐 영상에 밝은 픽셀이 없음')
    last = int(max(lit))
    end = min(last + 1, start + BURST_MAX_FRAMES)
    frames = list(range(start, end))
    # 정지 물방울 bbox (터짐 직전 프레임) — 셀 px
    ys, xs = np.where(lum[start - 1] > BURST_LUMA_LO)   # 키잉과 같은 문턱으로 재야 시트의 보이는 물방울 폭 = bbox 폭 (리뷰)
    drop = {'x': int(xs.min()), 'y': int(ys.min()), 'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1)}
    rows = (len(frames) + BURST_COLS - 1) // BURST_COLS
    sheet = np.zeros((rows * BURST_CELL, BURST_COLS * BURST_CELL, 4), dtype=np.uint8)
    yy, xx = np.mgrid[0:BURST_CELL, 0:BURST_CELL]
    dist = np.hypot((xx - BURST_CELL / 2) / (BURST_CELL / 2), (yy - BURST_CELL / 2) / (BURST_CELL / 2))   # 0=중심, 1=변 중앙, 1.41=모서리
    VIGNETTE = 1.0 - smoothstep(0.72, 1.0, dist)
    peak = None
    for idx, k in enumerate(frames):
        rgb = fr[k].astype(np.float32)
        a = smoothstep(BURST_LUMA_LO, BURST_LUMA_HI, lum[k].astype(np.float32))
        tail = len(frames) - idx
        if tail <= BURST_TAIL_FADE:
            a = a * (tail / (BURST_TAIL_FADE + 1))
        # 물튀김이 원본 프레임을 가득 채워 셀 경계가 사각형으로 드러난다(실측) → 가장자리로 갈수록 알파를 죽인다.
        # 단 처음 3프레임(정지 물방울이 아직 남아 화면 물방울과 겹쳐야 하는 구간)은 비네트가 물방울 윗부분을 깎으므로(리뷰) 건드리지 않는다.
        if idx >= 3:
            a = a * VIGNETTE
        safe = np.maximum(a, 1e-3)[:, :, None]
        col = np.clip(rgb / safe, 0, 255)                       # 언프리멀티플라이 → 스트레이트 알파
        col[a < 1e-3] = 0
        cell = np.dstack([col, a * 255]).round().astype(np.uint8)
        r, c = divmod(idx, BURST_COLS)
        sheet[r * BURST_CELL:(r + 1) * BURST_CELL, c * BURST_CELL:(c + 1) * BURST_CELL] = cell
        if a.max() > 0.5:
            m = a > 0.5
            p = rgb[m].mean(axis=0)
            if peak is None or a.mean() > peak[0]:
                peak = (float(a.mean()), [int(round(v)) for v in p], k)
    Image.fromarray(sheet, 'RGBA').save(os.path.join(OUT, 'burst.png'), optimize=True)
    meta = {'version': 1, 'sheet': 'burst.png', 'sheetW': int(sheet.shape[1]), 'sheetH': int(sheet.shape[0]),
            'cols': BURST_COLS, 'rows': rows, 'cellW': BURST_CELL, 'cellH': BURST_CELL, 'frames': len(frames), 'fps': fps,
            'srcStartFrame': start, 'srcEndFrame': end, 'srcFrames': n, 'drop': drop,
            'dropAspect': round(drop['w'] / drop['h'], 4), 'bubbleBodyAspect': round(bubble_meta['body']['w'] / bubble_meta['body']['h'], 4),
            'peakColor': peak[1] if peak else None, 'skyColor': list(sky), 'src': F_BURST}
    with open(os.path.join(OUT, 'burst.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    report['burst'] = meta
    # 콘택트 시트 — 하늘색 위에 (대비 확인용), 4프레임마다, 물방울 bbox 표시
    picks = frames[::4]
    tile = 256
    contact = Image.new('RGB', (len(picks) * tile, tile), sky)
    for q, k in enumerate(picks):
        idx = frames.index(k)
        r, c = divmod(idx, BURST_COLS)
        cell = Image.fromarray(sheet[r * BURST_CELL:(r + 1) * BURST_CELL, c * BURST_CELL:(c + 1) * BURST_CELL], 'RGBA').resize((tile, tile), Image.LANCZOS)
        contact.paste(cell, (q * tile, 0), cell)
        d = ImageDraw.Draw(contact)
        s = tile / BURST_CELL
        d.rectangle([q * tile + drop['x'] * s, drop['y'] * s, q * tile + (drop['x'] + drop['w']) * s, (drop['y'] + drop['h']) * s], outline=(255, 80, 80))
        d.text((q * tile + 4, 4), f'f{k}', fill=(20, 40, 60))
    contact.save(os.path.join(SRC, 'burst-contact.png'))
    print(f'burst.png  {meta["sheetW"]}x{meta["sheetH"]}  {len(frames)}f @{fps}fps (원본 {start}..{end-1}/{n})  물방울 bbox {drop}  피크색 {meta["peakColor"]} vs 하늘 {list(sky)}')
    return start / fps


# ---------------------------------------------------------------- 5. 효과음
def import_sfx(report, burst_t):
    src = os.path.join(SRC, F_BURST)
    t0 = max(0.0, burst_t - 0.02)
    out = os.path.join(OUT, 'burst-sfx.wav')
    run(['-ss', f'{t0:.3f}', '-t', '1.5', '-i', src, '-vn', '-ac', '1', '-ar', '44100',
         '-af', 'afade=t=out:st=1.3:d=0.2', '-c:a', 'pcm_s16le', out])
    report['sfx'] = {'src': F_BURST, 'startSec': round(t0, 3), 'durSec': 1.5, 'sizeBytes': os.path.getsize(out)}
    print(f'burst-sfx.wav  {t0:.2f}s+1.5s  {report["sfx"]["sizeBytes"]//1024}KB')


# ---------------------------------------------------------------- 6. 카드 앞면 프레임
def import_card_frame(report):
    _card_frame(report, F_FRAME, 'card-frame', 'cardFrame')
    _card_frame(report, F_FRAME_DEMO, 'card-frame-demo', 'cardFrameDemo')


def _card_frame(report, fname, outname, key):
    src = os.path.join(SRC, fname)
    if outname == 'card-frame' and os.path.exists(F_FRAME_0907):
        src, fname = F_FRAME_0907, 'client-2026-09-07/card-front-frame.png'
    if not os.path.exists(src):
        print(f'{fname} 없음 — {outname} 생략')
        return
    im = Image.open(src).convert('RGBA')
    sw, sh = im.size
    # cover: 카드 비율(664:1040)에 맞춰 긴 쪽을 잘라낸다(가운데 기준)
    k = max(CARD_W / sw, CARD_H / sh)
    rw, rh = int(round(sw * k)), int(round(sh * k))
    im = im.resize((rw, rh), Image.LANCZOS)
    ox, oy = (rw - CARD_W) // 2, (rh - CARD_H) // 2
    im = im.crop((ox, oy, ox + CARD_W, oy + CARD_H))
    a = np.asarray(im)[:, :, 3]
    hole = a < 128
    if hole.sum() < CARD_W * CARD_H * 0.05:
        raise SystemExit('프레임에 투명 구멍이 없다 — 사진 자리를 알 수 없다')
    # 사진 자리 = 투명 픽셀 **전체**의 bbox. 사진(cover)이 이 사각형을 꽉 채워야 투명 픽셀이 하나도 남지 않는다 —
    # '절반 넘게 채워진 행·열'로 좁히면 달수·물 그림이 겹친 구멍 하단 41px 이 사진 없이 투명하게 남아 인쇄물에 빈 띠가 생긴다(실측).
    ys, xs = np.where(hole)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    if (x1 - x0) > CARD_W * 0.95 or (y1 - y0) > CARD_H * 0.95:
        print(f'  경고: {fname} 사진 구멍이 카드의 95% 를 넘는다 — 프레임 알파를 확인할 것')
    im.save(os.path.join(OUT, outname + '.png'), optimize=True)
    meta = {'version': 1, 'src': fname, 'srcSize': [sw, sh], 'w': CARD_W, 'h': CARD_H,
            'hole': {'x': round(x0 / CARD_W, 4), 'y': round(y0 / CARD_H, 4), 'w': round((x1 - x0) / CARD_W, 4), 'h': round((y1 - y0) / CARD_H, 4)},
            'holePx': {'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0}, 'holeAspect': round((x1 - x0) / (y1 - y0), 4)}
    with open(os.path.join(OUT, outname + '.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    report[key] = meta
    print(f'{outname}.png  {CARD_W}x{CARD_H}  구멍 {meta["holePx"]} (종횡 {meta["holeAspect"]})')


# ---------------- 6-1. 타이틀 그래픽 (검정 배경 → 투명)
def import_title(report):
    src = os.path.join(SRC, F_TITLE)
    if not os.path.exists(src):
        print('타이틀 그래픽 없음 — 텍스트 타이틀 유지')
        return
    im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    lum = im.max(axis=2)
    # 글자 면은 밝고(200+) 외곽·그림자는 짙은 파랑(30~90)이다. 검정(≤6)만 배경으로 보고 나머지는 언프리멀티플라이해 살린다.
    a = smoothstep(6.0, 70.0, lum)
    safe = np.maximum(a, 1e-3)[:, :, None]
    col = np.clip(im / safe, 0, 255); col[a < 1e-3] = 0
    rgba = np.dstack([col, a * 255]).round().astype(np.uint8)
    ys, xs = np.where(a > 0.05)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    mx, my = int((x1 - x0) * 0.02), int((y1 - y0) * 0.04)
    crop = Image.fromarray(rgba, 'RGBA').crop((max(0, x0 - mx), max(0, y0 - my), min(rgba.shape[1], x1 + mx), min(rgba.shape[0], y1 + my)))
    if crop.width > 1400:
        crop = crop.resize((1400, int(crop.height * 1400 / crop.width)), Image.LANCZOS)
    crop.save(os.path.join(OUT, 'title.png'), optimize=True)
    report['title'] = {'src': F_TITLE, 'size': list(crop.size), 'aspect': round(crop.width / crop.height, 4)}
    print(f'title.png  {crop.size}  (검정 키잉)')


# ---------------- 6-2. 물길 영상 (데모에서 잘라내기)
def import_river(report):
    if os.path.exists(F_RIVER_0907):
        return import_river_file(report, F_RIVER_0907)
    src = os.path.join(SRC, F_DEMO)
    if not os.path.exists(src):
        print(f'{F_DEMO} 없음 — river.mp4 는 기존 파일 유지(카카오톡 수신 폴더에서 복사해 두면 다시 만든다)')
        return
    fps = probe_fps(src)
    def cut_at(t0, t1):
        r = run(['-ss', f'{t0}', '-to', f'{t1}', '-i', src, '-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
        g = np.frombuffer(r.stdout, dtype=np.uint8); n = g.size // (108 * 192); g = g[: n * 108 * 192].reshape(n, 192, 108).astype(np.int16)
        d = [float(np.abs(g[i + 1] - g[i]).mean()) for i in range(n - 1)]
        i = int(np.argmax(d))
        return t0 + (i + 1) / fps, d[i], float(np.median(d))
    # 물방울 화면 → (검정) 물길 영상 : 13~18s 사이 가장 큰 장면 전환 / 물길 영상 → 촬영 화면 : 24~28s
    start, ds, med1 = cut_at(13.0, 18.0)
    end, de, med2 = cut_at(24.0, 28.0)
    if ds < 60 or de < 60:
        raise SystemExit(f'데모 영상에서 장면 전환을 못 찾음 (start diff {ds:.1f}, end diff {de:.1f})')
    out = os.path.join(OUT, 'river.mp4')
    run(['-ss', f'{start:.4f}', '-to', f'{end:.4f}', '-i', src, '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '128k', '-af', 'afade=t=out:st=%.3f:d=0.3' % max(0.0, end - start - 0.3), '-movflags', '+faststart', out])
    o = decode_frames(out, 108, 192, 'gray')
    Image.fromarray(decode_frames(out, 270, 480, 'rgb24')[int(0.6 * fps)]).save(os.path.join(SRC, 'river-first.png'))
    meta = {'version': 1, 'src': F_DEMO, 'fps': fps, 'start': round(start, 3), 'end': round(end, 3), 'frames': int(len(o)),
            'durationSec': round(len(o) / fps, 3), 'cutDiff': [round(ds, 1), round(de, 1)], 'drops': RIVER_DROPS, 'sizeBytes': os.path.getsize(out)}
    with open(os.path.join(OUT, 'river.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    report['river'] = meta
    print(f'river.mp4  {meta["durationSec"]}s ({start:.3f}→{end:.3f}, 전환 diff {ds:.0f}/{de:.0f} vs 평시 {med1:.1f})  {meta["sizeBytes"]//1024}KB')


def import_river_file(report, src):
    """클라이언트가 물길 영상을 파일로 직접 준 경우(9/7 영상.mp4). 자르지 않고 그대로 — 재인코딩(yuv420p·faststart·끝 0.3초 페이드아웃)만 한다.
    해상도는 원본 그대로 둔다(406×720 으로 왔다 — 화면에서 2.65배 확대된다. 원본을 다시 요청할 것; 받으면 이 파일만 바꾸고 재실행)."""
    fps = probe_fps(src)
    r = run(['-i', src, '-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
    n = r.stdout and (len(r.stdout) // (108 * 192)) or 0
    dur = n / fps
    out = os.path.join(OUT, 'river.mp4')
    run(['-i', src, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '128k', '-af', 'afade=t=out:st=%.3f:d=0.3' % max(0.0, dur - 0.3), '-movflags', '+faststart', out])
    o = decode_frames(out, 108, 192, 'gray')
    rgb = decode_frames(out, 270, 480, 'rgb24')
    Image.fromarray(rgb[min(len(rgb) - 1, int(0.6 * fps))]).save(os.path.join(SRC, 'river-first.png'))
    meta = {'version': 1, 'src': os.path.relpath(src, os.path.join(ROOT, 'assets-src')).replace(os.sep, '/'), 'fps': fps, 'start': 0, 'end': round(dur, 3),
            'frames': int(len(o)), 'durationSec': round(len(o) / fps, 3), 'drops': RIVER_DROPS, 'sizeBytes': os.path.getsize(out),
            'note': '클라이언트 직접 전달 파일 — 원본 해상도 유지(저해상도면 원본 재요청)'}
    with open(os.path.join(OUT, 'river.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    report['river'] = meta
    print(f'river.mp4  {meta["durationSec"]}s  ← {meta["src"]} (파일 그대로, {meta["sizeBytes"]//1024}KB)')


# ---------------------------------------------------------------- 7. 스펙 사본
def import_spec():
    with open(os.path.join(SRC, F_SPEC), 'r', encoding='utf-16') as f:
        txt = f.read()
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, 'CLIENT_SPEC_20260906.md'), 'w', encoding='utf-8') as f:
        f.write('# 클라이언트 인터랙션 구간 스펙 (2026-09-06, [최종 1차] 자료 `참고사항.txt` 원문)\n\n')
        f.write('원본은 `assets-src/client-2026-09-06/참고사항.txt`(UTF-16). 아래는 그대로 옮긴 사본이다.\n\n```text\n')
        f.write(txt.replace('\r\n', '\n').strip('\n'))
        f.write('\n```\n')
    print('docs/CLIENT_SPEC_20260906.md')


def main():
    for fn in [F_BG, F_LOOP, F_BURST, F_SPEC] + list(BUBBLES.values()):
        if not os.path.exists(os.path.join(SRC, fn)):
            raise SystemExit(f'원본 없음: {os.path.join(SRC, fn)}')
    os.makedirs(OUT, exist_ok=True)
    report = {'ffmpeg': FFMPEG}
    sky = import_bg(report)
    bubble_meta = import_bubbles(report)
    burst_t = import_burst(report, sky, bubble_meta)
    import_sfx(report, burst_t)
    import_loop(report)
    import_card_frame(report)
    import_title(report)
    import_river(report)
    import_spec()
    with open(os.path.join(SRC, 'import-report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print('import-report.json 기록')


if __name__ == '__main__':
    main()
