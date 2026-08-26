@echo off
rem 데모 실행본을 전체화면 키오스크 모드로 실행 (창 모드로 보려면 DalsuARKiosk.exe 를 그냥 더블클릭)
cd /d "%~dp0"
start "" "%~dp0DalsuARKiosk.exe" --kiosk
