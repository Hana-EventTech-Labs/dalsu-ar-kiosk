# 데모 실행본 빌드 → dist/demo/
#   DalsuARKiosk-demo-<ver>.exe   단일 portable exe (Node 설치 불필요, 더블클릭 실행)
#   DalsuARKiosk-<ver>-win.zip    같은 앱의 폴더형 (압축 해제 후 DalsuARKiosk.exe — 시작이 빠름, 키오스크 상시가동용)
# 선행: npm run build:printer (printer/dist/DalsuPrint.exe), npm run assets (card-back.png)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path 'printer\dist\DalsuPrint.exe')) { throw 'printer/dist/DalsuPrint.exe 없음 — npm run build:printer 먼저' }
if (-not (Test-Path 'kiosk\assets\card-back.png')) { throw 'kiosk/assets/card-back.png 없음 — npm run assets 먼저' }
if (-not (Test-Path 'kiosk\assets\icon.ico')) { throw 'kiosk/assets/icon.ico 없음' }

# 게이트 1·2: 순수 모듈 테스트 + 스모크(전 흐름 + dry-run 인쇄)
Write-Host '== npm test =='
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test 실패 (exit $LASTEXITCODE)" }
Write-Host '== npm run smoke =='
npm run smoke
if ($LASTEXITCODE -ne 0) { throw "npm run smoke 실패 (exit $LASTEXITCODE)" }

Write-Host '== 숨김 종료 버튼 검증 =='
npx electron kiosk/main.js --smoke --smoke-exit
if ($LASTEXITCODE -ne 0) { throw "숨김 종료 버튼 검증 실패 (exit $LASTEXITCODE)" }

Remove-Item -Recurse -Force 'dist\demo' -ErrorAction SilentlyContinue
Write-Host '== electron-builder =='
npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder 실패 (exit $LASTEXITCODE)" }

# 폴더형 실행본으로 스모크 재검증 (패키징된 경로 해석·인쇄 CLI 탐색 확인)
$unpacked = Join-Path $root 'dist\demo\win-unpacked\DalsuARKiosk.exe'
if (-not (Test-Path $unpacked)) { throw "$unpacked 없음" }
Write-Host '== 패키징본 스모크 =='
& $unpacked --smoke | Write-Host
if ($LASTEXITCODE -ne 0) { throw "패키징본 스모크 실패 (exit $LASTEXITCODE)" }

# 게이트 3: 동봉된 인쇄 CLI가 실제로 실행되는지(경로·SmartComm2.dll 동봉) --dry-run으로 확인
$cli = Join-Path $root 'dist\demo\win-unpacked\resources\printer\DalsuPrint.exe'
$smokeOut = Join-Path $root 'dist\demo\win-unpacked\out\smoke'
$sample = Get-ChildItem $smokeOut -Filter '*-front.png' | Select-Object -Last 1
$sampleBack = Get-ChildItem $smokeOut -Filter '*-back.png' | Select-Object -Last 1
if (-not $sample -or -not $sampleBack) { throw '스모크 산출물(front/back PNG)이 없어 인쇄 CLI를 검증할 수 없음' }
Write-Host '== 동봉 인쇄 CLI --dry-run =='
& $cli --dry-run --front $sample.FullName --back $sampleBack.FullName | Write-Host
if ($LASTEXITCODE -ne 0) { throw "DalsuPrint.exe --dry-run 실패 (exit $LASTEXITCODE)" }

Write-Host ''
Write-Host '빌드 완료:'
Get-ChildItem 'dist\demo' -File | Where-Object { $_.Extension -in '.exe', '.zip' } |
  ForEach-Object { Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
