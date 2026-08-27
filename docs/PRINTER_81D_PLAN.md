# Smart-81D 양면 인쇄 — 라테일 검증 코드 이식 계획

**작성 2026-08-27** · 근거: 라테일 팝업스토어 프로젝트(2026-06~07, 행사 완료)에서 **SMART-81 양면 인쇄 실측 성공**

## 왜 이 계획이 필요한가

우리 `DalsuPrint`의 인쇄 경로는 **실장비 미검증**이다. 그런데 같은 프린터로 이미 성공한 프로젝트가 사내에 있고,
그쪽 기록에 **우리가 쓰는 경로가 실패했다**는 문장이 있다.

> 드라이버(스풀러) 모드 연결이라 SmartComm 경로 사용
> **(직접통신 SmartDCL은 이 환경에서 IO 실패)**
> — 노션 「[포토카드] 프린터 연동」(2026-06-23, 완료)

우리는 `SmartDCL_OpenDevice2` → `DCLPrint` 경로를 쓴다. 현장 PC가 같은 조건(드라이버 설치)이면 **같은 IO 실패를 겪을 가능성이 높다.**

## 참조 소스

| 항목 | 값 |
|---|---|
| 저장소 | `Hana-EventTech-Labs/latale-popup` (private, `gh` 인증 있음) |
| 경로 | `03-character-card-kiosk/` — Electron 키오스크 + SMART-81 양면 |
| 핵심 파일 | `printer.js`(171줄), `printer_worker.js`, `native/x64/SmartComm2.dll.h` |
| 로컬 사본 | 스크래치패드에 sparse checkout 완료 (읽기 전용 참조) |

## 두 구현의 차이

| | 라테일 (**검증됨**) | 달수 (미검증) |
|---|---|---|
| SDK 경로 | `SmartComm_*` — 드라이버/스풀러 모드 | `SmartDCL_*` — 직접통신 |
| 장치 열기 | `SmartComm_OpenDevice2(BYID)` | `SmartDCL_OpenDevice2(BYDESC, orientation)` |
| **양면 제어** | **DEVMODE의 `dwPrtSide`를 직접 패치**(0=앞면, 2=양면) | `DCLPrint(BOTH)` + `DoPrint` 2회 |
| 그리기 | `SmartComm_DrawImage(page, panel, x,y,w,h, 파일경로)` | `SmartComm_DrawBitmap(HBITMAP)` |
| 인쇄 | `SmartComm_Print` | `SmartComm_DoPrint` (SBS 시퀀스 안) |
| 카드 | **664×1040** (config), 노션 본문은 "0,0~636×1012 풀블리드" | 636×1012 |
| 타임아웃 | 180초 (config), 워커 스레드 | 90초, 외부 프로세스 |

### 양면 강제의 핵심 (그대로 가져올 값)

```
SMART81_DEVMODE = { DEVMODEW devmode; OEMDEV81 oemdev; }   // 중간 reserved 없음
sizeof(OEMDEV81) = 12976 · OEMDEV81 내 dwPrtSide 오프셋 = 164
→ 버퍼 내 오프셋 = (len - 12976) + 164 · 값 0=앞면, 2=양면
```
안전 가드(라테일 구현 그대로 유지할 것):
- `GetPrinterSettings2(handle, null, &len)` 로 길이 먼저 조회
- `devmodeSize = len - 12976` 이 **150~400 밖이면 패치하지 않는다**(다른 모델)
- 현재 값이 **3보다 크면 패치하지 않는다**(오프셋 의심)
- 어느 경우든 실패는 `false` 반환일 뿐, 인쇄 자체는 계속

## 계획

우리 래퍼(`SmartComm2Wrapper.cs`)에 **`SmartComm_*` 함수가 이미 전부 바인딩되어 있다.**
빠진 것은 `GetPrinterSettings2` / `SetPrinterSettings2` 두 개뿐이다. → **아키텍처를 바꾸지 않고 이식할 수 있다.**

### 1단계 · 래퍼 보강 (0.5h)
- `SmartComm_GetPrinterSettings2(HSMART, void*, int*)` / `SmartComm_SetPrinterSettings2(HSMART, void*, int)` 델리게이트 추가
- `ApplyPrintSide(int side)` 구현 — 위 오프셋·가드를 **그대로** 옮긴다

### 2단계 · 인쇄 경로 이원화 (1h)
`DalsuPrint`에 `--mode comm|dcl` 추가. **기본 `comm`**(라테일 검증 경로), `dcl`은 폴백.

```
comm 경로:  GetDeviceList2 → OpenDevice2(BYID)
          → ApplyPrintSide(2)
          → DrawBitmap(PAGE_FRONT, front) → DrawBitmap(PAGE_BACK, back)
          → SmartComm_Print → CloseDevice
```
`--mode` 는 `config.printer.mode` 가 아니라 별도 키 `config.printer.sdk` 로 노출해 현장에서 전환 가능하게 한다.

### 3단계 · 카드 규격 확인 (현장, 0.5h)
- 우리 636×1012 vs 라테일 664×1040. **여백이 남으면** 664×1040 오버사이즈로 그려 풀블리드를 맞춘다
- `config.card.bleed`(기본 0)를 두고 캔버스를 그만큼 키워 중앙 크롭

### 4단계 · 검증
```
printer\dist\DalsuPrint.exe --list
printer\dist\DalsuPrint.exe --mode comm --portrait --dry-run --front <f> --back <b>
printer\dist\DalsuPrint.exe --mode comm --portrait --front <f> --back <b>   # 실장비
```
- 로그에 `dwPrtSide 0→2` 적용 여부가 찍히게 한다(라테일도 이 값을 실측 확인함)
- 실패 시 `--mode dcl` 로 재시도해 두 경로를 비교

## 판단이 필요한 항목

1. **세로 방향 처리** — 라테일은 `DMORIENT` 를 쓰지 않고 **세로 캔버스(664×1040)를 그대로 그린다.**
   우리는 `SmartDCL_OpenDevice2` 에 `DMORIENT_PORTRAIT` 를 넘기는데, `comm` 경로에는 그 인자가 없다.
   → **세로는 캔버스 크기로만 결정될 가능성이 높다.** 현장에서 두 방식을 비교해야 한다.
2. **RF 함수 금지** 는 두 프로젝트 공통(우리는 NFC 없음) — 이식할 코드에 RF 호출이 없는지 확인 완료.
3. 라테일은 koffi(Node FFI)로 호출한다. 우리는 C# 외부 프로세스 유지 — **빌드 게이트를 그대로 쓸 수 있어 이쪽이 안전하다.**

## 소요

1~2단계 **1.5시간**(개발 PC에서 가능, dry-run 까지 검증) · 3~4단계는 **프린터가 연결된 PC 필요**.
