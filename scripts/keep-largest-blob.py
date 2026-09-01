# 투명 PNG에서 가장 큰 불투명 덩어리만 남기고 나머지(이웃 컷 파편) 제거 후 재크롭
# 사용: python scripts/keep-largest-blob.py kiosk/assets/dalsu-side.png [더 많은 파일...]
import sys
import numpy as np
from PIL import Image
from scipy import ndimage  # scipy 없으면 아래 fallback 사용

def largest_component(alpha):
    mask = alpha > 8
    try:
        labels, n = ndimage.label(mask)
        if n <= 1:
            return mask
        sizes = ndimage.sum(mask, labels, range(1, n + 1))
        return labels == (int(np.argmax(sizes)) + 1)
    except Exception:
        return mask

# 다른 스크립트가 largest_component 만 가져다 쓸 수 있게 실행부를 가드 안에 둔다(동작은 그대로).
def _main(paths):
  for path in paths:
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    keep = largest_component(a[:, :, 3])
    a[~keep] = 0
    ys, xs = np.where(keep)
    pad = 8
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    out = Image.fromarray(a[y0:y1, x0:x1])
    out.save(path)
    print(f'{path}: {out.width}x{out.height}')


if __name__ == '__main__':
    _main(sys.argv[1:])
