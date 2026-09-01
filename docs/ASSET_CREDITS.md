# 외부 이미지 출처 · 라이선스

이 프로젝트의 그래픽 자산은 발주처 제공 원본(달수) 과 생성형 AI 파생물로만 구성되며, 제3자 이미지는 포함하지 않습니다.
(2026-08-27 Wikimedia PD/CC0 물고기 4종을 잠시 썼으나 2026-09-01 생성 자산으로 교체 — 원본은 `assets-src/nature/prev/`, `assets-src/web/` 보관)

## 생성형 AI 파생 자산

`kiosk/assets/dalsu-swim.png` (헤엄 사이클 스프라이트 시트)는 외부 이미지가 아닙니다.
발주처 제공 원본 `assets-src/dalsu-lying-2.ai.pdf` 에서 뽑은 `kiosk/assets/dalsu-float.png` 를
시작·종료 프레임으로 고정하고 영상 생성 모델(Kling v3.0 pro, 2026-08-28)로 만든 파생물이며,
제3자 이미지는 일절 포함되어 있지 않습니다.

시작 플레이트·프롬프트·원본 클립·추출 프레임은 `assets-src/swim/` 에 보관합니다.
재생성: `npm run assets:swim:plate` → 영상 생성 → `npx electron scripts/grab-frames.js --in <clip.mp4>` → `npm run assets:swim`

`kiosk/assets/tree-1.png`, `tree-2.png`, `tree-3.png`, `plant-1.png`, `plant-2.png`, `plant-3.png`
(물가 나무·수풀)는 이미지 생성 모델(Nano Banana Pro, 2026-08-28)로 단색 크로마 배경 위에 그린 뒤
`scripts/cutout-nature.py` 로 잘라낸 것입니다. 제3자 이미지를 입력으로 쓰지 않았습니다.
원본 스트립은 `assets-src/nature/` 에 보관합니다.
재생성: 이미지 생성 → `python scripts/cutout-nature.py --in <strip.png> --map tree,tree,tree,plant,plant,plant`

`kiosk/assets/water.png` (수면 텍스처)는 이미지 생성 모델(Nano Banana Pro, 2026-09-01)로 만든 위에서 본 맑은 물 사진풍 이미지를
`scripts/make-water-tile.py` 로 좌우 타일러블하게 블렌딩하고 청록으로 재채색한 것입니다. 제3자 이미지를 입력으로 쓰지 않았습니다.
원본은 `assets-src/water/water-raw.png` 에 보관합니다. 파일을 지우면 절차 생성 수면으로 자동 폴백합니다.

`kiosk/assets/fish-1.png`, `fish-2.png`, `fish-3.png`, `fish-4.png`, `tree-1.png`, `tree-2.png`, `tree-3.png`, `tree-4.png` (2026-09-01 교체본)는 이미지 생성 모델(Nano Banana Pro)로 단색 크로마 배경 위에 그린 뒤
`scripts/cutout-nature.py --fish-rot 90` 으로 잘라낸 것입니다. 원본 스트립은 `assets-src/nature/fish-trees-strip.png`.
