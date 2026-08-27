@echo off
rem 현장 인쇄 테스트: 프린터 목록 확인 → 뒷면 디자인으로 양면 1장 시험 인쇄
rem 배포본(폴더형)에서는 CLI 가 resources\printer\ 에 있고, 소스 트리에서는 printer\dist\ 에 있다.
cd /d "%~dp0"
set "CLI=printer\dist\DalsuPrint.exe"
if not exist "%CLI%" set "CLI=resources\printer\DalsuPrint.exe"
set "BACK=kioskssets\card-back.png"
if not exist "%BACK%" set "BACK=resourcespp.asar.unpacked\kioskssets\card-back.png"
if not exist "%CLI%" (
  echo [실패] DalsuPrint.exe 를 찾지 못했습니다. 이 파일을 앱 폴더 안에서 실행하세요.
  pause & exit /b 1
)
echo === 프린터 목록 ===
"%CLI%" --list
if errorlevel 1 (
  echo [실패] 프린터가 보이지 않습니다. USB/전원/드라이버를 확인하세요.
  pause & exit /b 1
)
echo.
echo === 시험 인쇄 (앞면=card-back.png, 뒷면=card-back.png) ===
printer\dist\DalsuPrint.exe --front kiosk\assets\card-back.png --back kiosk\assets\card-back.png
if errorlevel 1 (
  echo [실패] 종료코드 %errorlevel% — logs 와 위 메시지를 개발팀에 전달하세요.
  echo        comm 경로가 안 되면 아래를 한 번 더 시도해 보세요:
  echo        "%CLI%" --mode dcl --portrait --front "%BACK%" --back "%BACK%"
) else (
  echo [성공] 카드가 배출되면 앞/뒤 모두 인쇄됐는지 확인하세요.
)
pause
