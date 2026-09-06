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

## 발주처 제공 자산

`kiosk/assets/card-back.png` (포토카드 뒷면, 2026-09-03)는 클라이언트가 전달한 최종 디자인 `assets-src/card-back-final.png`(685×1063, 달수 + SAMSUNG 로고)를
`scripts/make-card-back.ps1` 이 카드 규격 664×1040 으로 cover 리사이즈(좌우 3px 크롭)한 것입니다. 최종본이 있으면 자동 생성 플레이스홀더는 쓰지 않습니다.

`kiosk/assets/idle-bg.jpg` · `idle-loop.mp4` · `bubble-reduce.png` · `bubble-reuse.png` · `bubble-restore.png` · `burst.png` · `burst-sfx.wav` ·
`card-frame.png` · `card-frame-demo.png` · `title.png` · `river.mp4` (2026-09-06)는 클라이언트(머그음)가 전달한 [최종 1차] 자료와 [최종]전체데모에서
`scripts/import-client-assets.py` 가 만든 것입니다. 원본은 `assets-src/client-2026-09-06/`(전체 데모 영상 119MB 는 저장소에 넣지 않음 — 카카오톡 수신 폴더 `오른쪽_물튀김 copy`).
- 대기 루프: `[달수]대기화면.mp4` 를 이음매 크로스페이드(8프레임)로 잇고 재인코딩(x264 crf18, AAC).
- 터짐 시트: `물방울_터짐.mp4`(검정 배경)를 루마키(밝기 95~175 스무스스텝) + 원형 비네트로 잘라 40프레임 시트로. 효과음은 같은 영상의 오디오 1.5초.
- 카드 앞면 프레임: `인쇄스크린_인쇄디자인.png`(바탕화면 전달분, 기본) / `달수 앞면.png`(데모 영상에 쓰인 버전, `card-frame-demo`). 664×1040 cover.
- 타이틀: `달수_타이틀_1.png`(검정 배경)를 검정 키잉.
- 물길 영상: `[최종]전체데모.mp4` 의 16.07~25.77초(장면 전환 검출)를 잘라 재인코딩(x264 crf20). 자막·효과는 영상에 이미 들어 있다.
- `물튀.png`·`왼쪽/오른쪽_물튀김 copy.png` 는 데모 영상 자막 장식으로 이미 영상에 들어 있어 앱에서 따로 쓰지 않는다(원본만 보관).

## 재채색 (2026-09-03, 삼성 지정 팔레트)

`tree-1~4.png`, `plant-1~3.png` 는 위 생성물을 `scripts/recolor-nature.py` 로 초록 잎 구간(색상각 55~170°)만 삼성 숲색 `#00c3b2`(≈175°) 쪽으로 옮긴 것입니다.
줄기·꽃·물고기는 손대지 않았습니다. `water.png` 도 `make-water-tile.py` 의 재채색 기준색을 `#0077c8`(깊은 물) / `#00b3e3` 틴트(얕은 물)로 바꿔 다시 만들었습니다.
