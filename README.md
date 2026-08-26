# Dalsu AR Kiosk — 삼성 달수 AR 포토카드 키오스크

KIWW 2026(대구 엑스코, 9/9~11) 삼성전자 달수 캐릭터 AR 포토카드 키오스크.
물방울 4개 터치(4대 환경목표) → S자 물길 → 자연 회복 → 달수 이동 → 3초 카운트다운 촬영 → AR 합성 → Smart-81D 양면 카드 출력.

## 현장 설치 (운영 PC)
1. Node 22 + .NET 8 Runtime(Desktop) 설치, Smart-81D 드라이버·USB 연결
2. `npm install` → `npm run build:printer` → `npm run assets`
3. `printer\dist\DalsuPrint.exe --list` 로 프린터가 보이는지 확인
4. `kiosk\config.json` 수정
   - `printer.mode`: `"smart"` (실제 인쇄) — 기본값은 `dry-run`
   - `printer.deviceDesc`: 프린터가 여러 대면 `--list`에 나온 desc 일부
   - `camera.deviceId`: 웹캠이 여러 대면 지정 (비우면 기본 카메라)
5. 테스트 인쇄: `printer\dist\DalsuPrint.exe --front out\smoke\<front>.png --back kiosk\assets\card-back.png`
6. `npm run kiosk` (전체화면). 종료는 Alt+F4.

## 개발
```
npm test            # 상태 머신 / 합성 레이아웃 / 물길 경로 단위 테스트
npm run smoke       # 웹캠·프린터 없이 전 흐름 자동 실행, out/smoke/*-front.png 생성, exit 0
npm start           # 창 모드 (--devtools 추가 시 개발자 도구)
```

## 그래픽 교체
`kiosk/assets/` 파일을 같은 이름으로 덮어쓰면 코드 수정 없이 반영됩니다.
- `dalsu-front.png` 대기 화면 / `dalsu-side.png` 터치 가이드 / `dalsu-float.png` 물길 위 달수(부유 포즈)
- `dalsu-face.png` 뒷면 카드 / `card-back.png` 뒷면 카드 완성본(1012×636)
- `nature-1.png … nature-8.png` 자연 회복 요소 (없으면 이모지로 대체)
- 물방울·물길은 코드에서 그린다. 강물은 `kiosk/src/water.js`가 수면 텍스처를 흐름 방향으로 스크롤해 실제로 흐르게 렌더
- `kiosk/assets/water.png` 를 넣으면 수면 텍스처가 그 이미지로 바뀐다 — **가로 = 흐름 방향이고 좌우가 이어지는(타일러블) 이미지**여야 함(권장 384×160 이상). 없으면 절차 생성본 사용
- 강 굵기·속도·색은 `config.json > river` (`style: "cartoon"` 으로 기존 벡터 물길 복귀 가능)

## 출력물
- 앞면: 웹캠 프레임(cover 크롭) + 물길 + 자연 요소 + 달수 + 하단 행사명/날짜 → 1012×636 PNG
- 뒷면: `card-back.png` 고정
- 저장: `out/YYYY-MM-DD/card-<timestamp>-front|back.png`, 로그: `logs/kiosk-YYYY-MM-DD.log`

## 인쇄 경로
Electron → `DalsuPrint.exe --front --back` (SmartComm2 SDK, DCL/SBS 모드, 플리퍼 있으면 양면). 실패 시 1회 재시도 후 화면에 "직원 호출" 안내.
종료 코드: 0 성공 / 1 인자 / 2 SDK / 3 프린터 연결·상태 / 4 인쇄.

## 검증 상태 (2026-08-26)
- 단위 테스트 15건 통과, 스모크(전 흐름 + dry-run 인쇄) 통과, DalsuPrint dry-run 통과
- 데모 실행본(portable exe / 폴더형) 스모크 통과 — 패키징 경로·동봉 인쇄 CLI 확인
- **실장비(Smart-81D) 인쇄는 미검증**(개발 PC에 프린터 없음) — `docs/ONSITE_CHECKLIST.md` B·D 절차로 현장 검증. 배포 zip: `npm run package` → `dist/`

## 데모 실행본 (Node 설치 불필요)
`npm run build:demo` → `dist/demo/`
- `DalsuARKiosk-demo-<ver>.exe` — **단일 portable exe**. 키오스크 PC에 복사 후 더블클릭. 첫 실행이 몇 초 느립니다(임시폴더 해제).
  실행하면 exe 옆에 `config.json` / `out/` / `logs/` 가 생기고, 이후 그 `config.json`을 읽습니다.
- `DalsuARKiosk-<ver>-win.zip` — 같은 앱의 폴더형. 압축 해제 후 `DalsuARKiosk.exe`. 시작이 빠르므로 **현장 상시가동은 이쪽 권장**.
- **배포 exe는 실행하면 바로 전체화면 키오스크**입니다. 창 모드로 보려면 `DalsuARKiosk.exe --windowed`, 실행 중 **F11**로도 토글됩니다.
- **종료: 화면 오른쪽 위 모서리를 2초 안에 3번 터치**(투명 영역, 화면에 보이지 않음 — 관람객이 모르게). Alt+F4도 동작합니다.
- 기본 `printer.mode`는 `dry-run` — 카드 PNG만 `out/`에 저장하고 인쇄는 하지 않습니다. 실제 인쇄를 보려면 exe 옆 `config.json`에서 `"smart"`로 바꾸세요(그때만 .NET 8 Runtime + Smart-81D 드라이버 필요).
- 빌드는 `npm test` → `npm run smoke` → 패키징본 스모크 → 동봉 `DalsuPrint.exe --dry-run`까지 통과해야 산출물이 나옵니다.

## 현장 배포 패키지 (소스 + Node 방식)
`npm run package` → `dist/dalsu-ar-kiosk-<날짜>.zip` (kiosk + DalsuPrint.exe + start-kiosk.cmd + print-test.cmd + 체크리스트). 현장 절차는 `docs/ONSITE_CHECKLIST.md`.

## 동화풍 스타일 (2026-08-25)
디자인 캔버스(https://claude.ai/code/artifact/f65dd062-e979-4cff-b53c-930bab17419c) 기준으로 서체(Jua/Gowun Dodum, 로컬 번들)·배경·아이콘·자연 요소·카드 프레임을 반영. 아트 정의는 `kiosk/src/art.js`, 배경은 `index.html`의 `#bg` SVG.
