# assets-src/web/*.jpg (흰 배경 원본) → kiosk/assets/nature-*.png (투명 배경, 정사각)
#
# 흰 배경 제거는 '가장자리에서 연결된 밝은 영역'만 지운다(flood fill).
# 단순 밝기 임계값으로 지우면 물고기 배 같은 밝은 부분까지 뚫린다.
#
# 사용: python scripts/cutout-web-assets.py
import io
import json
import os
import sys
from collections import deque

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets-src', 'web')
DST = os.path.join(ROOT, 'kiosk', 'assets')

# 원본 파일 → 출력 이름.
# 종류를 파일명으로 나눈다: fish-*(물 위), plant-*(물가), tree-*(숲).
# 한 묶음(nature-*)으로 두면 물가에 물고기가 놓인다.
JOBS = [
    ('Carassius_wild_golden_fish_2013_G1_(white_background).jpg', 'fish-1.png', 'fish'),
    ('Morone_chrysops_white_bass_fish_(white_background).jpg',     'fish-2.png', 'fish'),
    ('Micropterus_salmoides_with_white_background.jpg',            'fish-3.png', 'fish'),
    ('Alewife_fish_(white_background).jpg',                        'fish-4.png', 'fish'),
    # 물가 식물·나무는 실사로 시도했다가 뺐다:
    #  · 나무(Seemannaralia)는 흰 종이 위 세밀화 '도판 스캔'이라 도판 번호·캡션까지 통째로 들어온다
    #  · 잎/백합 사진은 벡터 물길과 톤이 맞지 않고 물 위에 떠 보인다
    # 물고기는 물 위 요소라 사진이어도 자연스러워 실사를 유지한다.
]


def cut_white(im, thresh=232, feather=2):
    """가장자리에서 연결된 흰 영역만 투명하게. 반환: RGBA"""
    im = im.convert('RGB')
    w, h = im.size
    px = im.load()
    alpha = [255] * (w * h)
    seen = bytearray(w * h)
    q = deque()

    def bright(x, y):
        r, g, b = px[x, y]
        return r >= thresh and g >= thresh and b >= thresh

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and bright(x, y):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and bright(x, y):
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        alpha[y * w + x] = 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and bright(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))

    a = Image.new('L', (w, h))
    a.putdata(alpha)
    if feather:                      # 경계 계단 제거
        from PIL import ImageFilter
        a = a.filter(ImageFilter.GaussianBlur(feather))
    out = im.convert('RGBA')
    out.putalpha(a)
    return out


def crop_opaque(im, pad_ratio=0.02):
    bbox = im.split()[3].getbbox()
    if not bbox:
        raise SystemExit('불투명 픽셀 없음')
    x0, y0, x1, y1 = bbox
    p = int(max(x1 - x0, y1 - y0) * pad_ratio)
    return im.crop((max(0, x0 - p), max(0, y0 - p), min(im.width, x1 + p), min(im.height, y1 + p)))


def to_square(im, side=512):
    """정사각 캔버스 중앙 배치 — renderer 의 drawNature 가 정사각으로 그린다."""
    im = im.copy()
    im.thumbnail((side, side), Image.LANCZOS)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return canvas


def main():
    if not os.path.isdir(SRC):
        sys.exit(f'원본 폴더 없음: {SRC}')
    made = []
    for src_name, out_name, kind in JOBS:
        src = os.path.join(SRC, src_name)
        if not os.path.exists(src):
            print(f'  건너뜀 (원본 없음): {src_name}')
            continue
        im = Image.open(src)
        if max(im.size) > 1600:                       # 큰 원본은 먼저 줄여야 flood fill 이 빠르다
            im.thumbnail((1600, 1600), Image.LANCZOS)
        out = to_square(crop_opaque(cut_white(im)))
        out.save(os.path.join(DST, out_name))
        made.append((out_name, src_name))
        print(f'  {out_name:14s} ← {src_name[:46]}')

    # 출처·라이선스를 납품물에 동봉한다
    cred = os.path.join(SRC, '_credits.json')
    if os.path.exists(cred):
        data = json.load(io.open(cred, encoding='utf-8'))
        by_file = {d['file']: d for d in data}
        lines = ['# 외부 이미지 출처 · 라이선스', '',
                 '`kiosk/assets/fish-*.png` · `plant-*.png` · `tree-*.png` 는 아래 원본을 배경 제거·리사이즈한 것입니다.',
                 '모두 퍼블릭 도메인 또는 CC0 이며, 상업적 사용·변형이 허용됩니다.', '',
                 '| 출력 파일 | 원본 | 라이선스 | 저작자 | 출처 |', '|---|---|---|---|---|']
        for out_name, src_name in made:
            d = by_file.get(src_name, {})
            lines.append(f"| `{out_name}` | {src_name} | {d.get('license','?')} | {d.get('artist','?')} | {d.get('page','?')} |")
        lines += ['', f'수집일: 2026-08-27 · 수집처: Wikimedia Commons',
                  '', '원본 파일은 `assets-src/web/` 에 그대로 보관합니다(재가공용).']
        io.open(os.path.join(ROOT, 'docs', 'ASSET_CREDITS.md'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
        print('  docs/ASSET_CREDITS.md 갱신')


if __name__ == '__main__':
    main()
