# Dalsu AR Kiosk — 삼성 달수 AR 포토카드 키오스크

## 프로젝트 개요
삼성전자 주관 **대한민국 국제물주간(KIWW, 대구 엑스코, 2026-09-09~11)** 행사용 무인 AR 포토카드 키오스크.
관람객이 물방울 4개(삼성 4대 환경목표)를 터치 → S자 물길 완성 → 자연 회복 연출 → 달수 유영 → 3초 카운트다운 자동 촬영
→ 달수·물길·자연 AR 합성 → 미리보기 중 Smart-81D 양면 포토카드 출력. 체험 50초~1분 20초.

- 견적: quote-maker `QT-20260824-001` (개발 800K + 그래픽 제작 500K, VAT 별도)
- 라인: 스튜디오 머그음(유지환) → 비전컴퍼니(info@vscompany.co.kr) → 하나플랫폼(사업팀 정두용 → 개발팀)
- 납기 2026-09-04(조정 요청 중, 원래 9/2). 현장 리허설 후 9/9 오픈.
- 하드웨어: 32인치 터치 키오스크(세로) + 상단 웹캠 + **Smart-81D 양면 카드프린터**(플리퍼)

## 요구사항 (2026-08-25 머그음 기획 확정본 — 단일 출처)
1. 대기 화면 → 물방울 4개 등장 (탄소 / 수자원 / 폐기물 / 오염물질)
2. 달수 손/실루엣 가이드가 터치 유도
3. 터치 시 POP 효과 + 환경목표 문구 표시
   - 탄소: 2050년 탄소중립 달성
   - 수자원: 2030년 용수 취수량 2021년 수준으로 절감
   - 폐기물: 2030년 폐기물 재활용률 99.9% 달성
   - 오염물질: 2040년 대기·수질 오염물질 자연상태 수준으로 저감
4. 4개 완료 → 물방울이 중앙으로 모여 굵은 S자 물길 완성
5. 물길 주변 자연 회복 애니메이션 (식물·물고기·잠자리, 동화풍)
6. 달수가 물길 따라 이동(원본에 유영 포즈 없음 → **누움(부유) 포즈**로 흘러가는 연출)
7. 중앙 도착 → 3·2·1 카운트다운 → 자동 촬영
8. 촬영 사진 + 달수·물길·자연 AR 합성 → 미리보기
9. 미리보기 동안 포토카드 출력(약 25초) — 별도 대기화면 없음. **앞면 = 합성 사진, 뒷면 = 고정 디자인**
10. 시안 8컷의 **레이아웃·인터랙션 구조는 그대로 따른다**(2026-08-26 확정): 상단 고정 타이틀/부제, 가로 1열 눈물방울 4개, 손가락 커서 가이드, 터치 시 그 자리에 목표 문구 잔류, 완료 화면의 프린터 일러스트.
    단 **룩(파란 3D 수달·실사 배경)은 재현하지 않는다** — 달수는 원본 .ai 5종(플랫 2D), 배경·자연은 벡터 동화풍.
11. 시안과 의도적으로 다른 2가지: ① 촬영 화면(카운트다운·촬영)에는 달수·카메라 아이콘을 넣지 않는다(사람이 가려짐) ② 카운트다운은 작게 상단 배치.

## 아키텍처
```
dalsu-ar-kiosk/
├── kiosk/                  # Electron 앱 (터치 UI · 웹캠 · AR 합성)
│   ├── main.js             # 창 생성, IPC(print/log/config), 인쇄 CLI 스폰, 출력 파일 저장
│   ├── preload.js          # window.kiosk 브리지
│   ├── config.json         # 타이밍·문구·프린터 모드·카메라 (현장에서 수정하는 유일한 파일)
│   ├── src/
│   │   ├── index.html / styles.css
│   │   ├── flow.js         # 상태 머신 (순수 JS, 테스트 대상)
│   │   ├── compose.js      # 합성 레이아웃 계산 (순수 JS, 테스트 대상)
│   │   ├── river.js        # S자 물길 경로·달수 이동 좌표 (순수 JS)
│   │   └── renderer.js     # DOM/캔버스/웹캠/애니메이션 — flow/compose/river 사용. ?smoke=1 이면 자동 실행(모의 프레임 → front.png → exit)
│   └── assets/             # dalsu-*.png(변환본), card-back.png, bubble/nature 그래픽
├── printer/DalsuPrint/     # C# .NET 8 콘솔 CLI — SmartComm2 SDK 양면 인쇄
│   ├── Program.cs          # --front --back [--printer desc] [--list] [--dry-run]
│   ├── SmartComm2Wrapper.cs# smart51s-nfc-writer에서 검증된 래퍼 그대로
│   └── SmartComm2.dll
├── scripts/
│   ├── convert-ai.ps1      # assets-src/*.ai(.pdf) → kiosk/assets/*.png (WinRT PDF 렌더, 투명 배경)
│   ├── make-card-back.ps1  # 뒷면 카드 기본 디자인 생성 (1012×636)
│   └── build-printer.ps1   # dotnet publish → printer/dist/DalsuPrint.exe
├── tests/                  # node --test (flow/compose/river 순수 모듈)
├── assets-src/             # 달수 원본 .ai (PDF 호환) — 수정 금지
├── out/                    # 촬영 결과 (날짜별 front/back PNG) — gitignore
└── logs/                   # 앱·인쇄 로그 — gitignore
```

## 핵심 불변식
- **카드 캔버스 1012×636 px** (Smart SDK DrawBitmap 규격, smart51s-nfc-writer에서 실측). 앞면 합성 결과는 반드시 이 크기.
- 인쇄 시퀀스(검증됨): `SBSStart → CardIn → Move(PRINT) → DrawBitmap(front) → DrawBitmap(back) → DCLPrint(BOTH) → DoPrint → DoPrint → CardOut → SBSEnd`
- 뒷면은 플리퍼 장착 시에만 그린다. 미장착이면 앞면만 인쇄하고 경고.
- SmartComm2 **RF 함수 호출 금지**(네이티브 크래시). 이 프로젝트는 NFC 없음.
- 인쇄 실패는 사용자 화면에 "직원 호출" 안내 + 로그. 자동 재시도 1회.
- 프린터 모드 `config.printer.mode`: `smart`(실장비) | `dry-run`(PNG만 저장, 개발 PC). 기본 dry-run. 현장 배포 전 반드시 `smart`로 전환.
- 모든 문구·타이밍은 `kiosk/config.json`에서만 바꾼다. 코드에 하드코딩 금지.
- **물길은 화면 중앙(u=0.5)에서 양쪽으로 뻗으며 완성**된다. 터진 물방울도 중앙으로 모인다(기획 4번).
- 강물은 `water.js`의 **흐르는 수면**(텍스처를 흐름 방향으로 스크롤). 흰 테두리 + 점선 대시 스트로크는 유아틱해서 폐기 — `config.river.style: "cartoon"`으로만 되돌릴 수 있다.
  수면 텍스처는 절차 생성이 기본이고, `kiosk/assets/water.png`(흐름 방향 = 가로, 좌우 타일러블)를 넣으면 그 이미지로 교체된다.
- 물방울은 **가로 1열 4개, 눈물방울 모양**. 터치하면 물방울이 사라지고 **그 자리에 목표 문구가 남는다**(누적, 시안 3~4컷).
- 달수 이동은 **헤엄**(motion.js `swimEase`/`swimPose` — 차고-미끄러짐 + 몸통 흔들림). 등속 슬라이드 금지. 도착점은 **물길 중앙 u=0.5**.
- 카드 앞면 AR은 `compose.artBox(card.artTop)` 하단 영역에만 그린다 — 인물 얼굴·상반신을 가리지 않는다.
- `BrowserWindow`는 `backgroundThrottling: false` 필수. 켜져 있으면 창이 가려질 때 rAF가 멈춰 연출이 정지한다.
- **촬영 화면(COUNTDOWN·CAPTURE)은 비운다**: 카메라 위에 달수·물길·자연을 겹치지 않는다(사람이 가려짐). AR 합성은 출력 카드에서만. `screen.captureOverlay: true`로만 예외 허용.

## 명령
```bash
npm install                 # kiosk 의존성 (electron)
npm test                    # 순수 모듈 테스트 (node --test)
npm run smoke               # 웹캠 없이 전 흐름 자동 실행 → out/smoke/front.png + dry-run 인쇄 → exit 0
npm start                   # 키오스크 실행 (창 모드)
npm run kiosk               # 전체화면 키오스크 모드
npm run build:printer       # DalsuPrint.exe 빌드 (dotnet publish)
npm run assets              # .ai → PNG 변환(+파편 제거) + 뒷면 카드 생성
printer/dist/DalsuPrint.exe --list                       # 프린터 목록
printer/dist/DalsuPrint.exe --front a.png --back b.png   # 실제 인쇄
```

## 완료 게이트 (보고 전 필수)
1. `npm test` 전부 통과
2. `npm run smoke` exit 0 + `out/smoke/front.png` 1012×636 생성 확인
3. `npm run build:printer` 성공 + `DalsuPrint.exe --dry-run --front ... --back ...` exit 0
4. 실장비 인쇄는 Smart-81D 연결된 PC에서만 검증 가능 — 미검증 시 "미검증"으로 명시 보고

## 컨벤션
- JS: CommonJS, 순수 로직은 DOM 의존 없이 분리(테스트 가능). 한글 주석 OK.
- C#: 기존 NFC Writer 코드 스타일 유지. 로그는 stdout, 오류는 stderr + exit code(0 성공/1 인자/2 SDK/3 프린터/4 인쇄).
- 커밋: conventional commits. 자동 커밋 금지.
- 자산 파일명 고정: `dalsu-front.png`, `dalsu-side.png`, `dalsu-float.png`, `dalsu-face.png`, `card-back.png`. 그래픽 교체는 파일만 덮어쓴다.
