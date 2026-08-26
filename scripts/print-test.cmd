@echo off
rem 현장 인쇄 테스트: 프린터 목록 확인 → 뒷면 디자인으로 양면 1장 시험 인쇄
cd /d "%~dp0"
echo === 프린터 목록 ===
printer\dist\DalsuPrint.exe --list
if errorlevel 1 (
  echo [실패] 프린터가 보이지 않습니다. USB/전원/드라이버를 확인하세요.
  pause & exit /b 1
)
echo.
echo === 시험 인쇄 (앞면=card-back.png, 뒷면=card-back.png) ===
printer\dist\DalsuPrint.exe --front kiosk\assets\card-back.png --back kiosk\assets\card-back.png
if errorlevel 1 (
  echo [실패] 종료코드 %errorlevel% — logs 와 위 메시지를 개발팀에 전달하세요.
) else (
  echo [성공] 카드가 배출되면 앞/뒤 모두 인쇄됐는지 확인하세요.
)
pause
