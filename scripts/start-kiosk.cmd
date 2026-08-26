@echo off
rem 현장 실행: 전체화면 키오스크 모드. 시작프로그램에 이 파일 바로가기 등록.
cd /d "%~dp0"
if not exist node_modules (
  echo [setup] npm install ...
  call npm install --no-audit --no-fund
)
call npm run kiosk
