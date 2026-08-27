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

# 구문 오류는 스모크에서 '실패'가 아니라 '무한 대기'로 나타난다(렌더러 스크립트가 통째로 안 돌아 로그조차 없다).
# 3분 기다렸다 죽이는 대신 여기서 즉시 잡는다.
Write-Host '== JS 구문 검사 =='
Get-ChildItem -Recurse -File -Include *.js -Path kiosk, tests, scripts |
  Where-Object { $_.FullName -notlike '*node_modules*' } |
  ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw ("구문 오류: " + $_.FullName) }
  }
Write-Host '  통과'

Write-Host '== 실기 해상도 스모크 (1080x1920 뷰포트) =='
npx electron kiosk/main.js --smoke --smoke-emulate=1080x1920
if ($LASTEXITCODE -ne 0) { throw "1080x1920 스모크 실패 (exit $LASTEXITCODE)" }

Write-Host '== 가로 비율 스모크 (9:16 무대가 유지되는지) =='
npx electron kiosk/main.js --smoke --smoke-size=960x540
if ($LASTEXITCODE -ne 0) { throw "가로 비율 스모크 실패 (exit $LASTEXITCODE)" }

Write-Host '== e2e 물줄기 검증 (세로 1080x1920) =='
npx electron kiosk/main.js --smoke --smoke-e2e --smoke-speed=0.5 --smoke-emulate=1080x1920
if ($LASTEXITCODE -ne 0) { throw "e2e 물줄기 검증(세로) 실패 (exit $LASTEXITCODE)" }

Write-Host '== e2e 물줄기 검증 (가로 960x540) =='
npx electron kiosk/main.js --smoke --smoke-e2e --smoke-speed=0.5 --smoke-size=960x540
if ($LASTEXITCODE -ne 0) { throw "e2e 물줄기 검증(가로) 실패 (exit $LASTEXITCODE)" }

Write-Host '== 숨김 종료 버튼 검증 =='
npx electron kiosk/main.js --smoke --smoke-exit
if ($LASTEXITCODE -ne 0) { throw "숨김 종료 버튼 검증 실패 (exit $LASTEXITCODE)" }

# 이전 산출물 정리.
# 패키징본 스모크를 한 번 돌리고 나면 백신 실시간 검사가 app.asar 를 배타적으로 붙잡아
# 곧바로 다시 빌드하면 electron-builder 가 EBUSY 로 죽는다. 잠깐 기다렸다 다시 시도하고,
# 그래도 안 풀리면 **새 폴더로 비켜간다** — 빌드가 이것 때문에 막히면 안 된다.
$outRel = 'dist/pkg'
$outDir = Join-Path $root 'dist' | Join-Path -ChildPath 'pkg'
$lockFile = Join-Path $outDir 'win-unpacked' | Join-Path -ChildPath 'resources' | Join-Path -ChildPath 'app.asar'
for ($try = 1; $try -le 5; $try++) {
  Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue
  if (-not (Test-Path $lockFile)) { break }
  if ($try -eq 1) { Write-Host '  이전 app.asar 가 잠겨 있음(백신 검사 추정) - 해제 대기' }
  Start-Sleep -Seconds 3
}
if (Test-Path $lockFile) {
  $stamp = Get-Date -Format 'MMdd-HHmmss'
  $outRel = "dist/pkg-$stamp"
  $outDir = Join-Path $root 'dist' | Join-Path -ChildPath "pkg-$stamp"
  Write-Warning "이전 dist/pkg 가 잠겨 있어 정리하지 못했습니다 - 이번 빌드는 $outRel 에 만듭니다."
}
Write-Host '== electron-builder =='
# 인자를 한 줄로 쓰면 PowerShell 이 '-c.directories.output=...' 를 두 토큰으로 쪼갠다.
# 배열로 만들어 넘겨야 그대로 전달된다.
$ebArgs = @('electron-builder', '--win', '--publish', 'never')
if ($outRel -ne 'dist/pkg') { $ebArgs += "-c.directories.output=$outRel" }
npx @ebArgs
if ($LASTEXITCODE -ne 0) { throw "electron-builder 실패 (exit $LASTEXITCODE)" }

# 폴더형 실행본으로 스모크 재검증 (패키징된 경로 해석·인쇄 CLI 탐색 확인)
$unpacked = Join-Path $outDir 'win-unpacked' | Join-Path -ChildPath 'DalsuARKiosk.exe'
if (-not (Test-Path $unpacked)) { throw "$unpacked 없음" }
Write-Host '== 패키징본 스모크 =='
& $unpacked --smoke | Write-Host
if ($LASTEXITCODE -ne 0) { throw "패키징본 스모크 실패 (exit $LASTEXITCODE)" }

# 게이트 3: 동봉된 인쇄 CLI가 실제로 실행되는지(경로·SmartComm2.dll 동봉) --dry-run으로 확인
$cli = Join-Path $outDir 'win-unpacked' | Join-Path -ChildPath 'resources' | Join-Path -ChildPath 'printer' | Join-Path -ChildPath 'DalsuPrint.exe'
$smokeOut = Join-Path $outDir 'win-unpacked' | Join-Path -ChildPath 'out' | Join-Path -ChildPath 'smoke'
$sample = Get-ChildItem $smokeOut -Filter '*-front.png' | Select-Object -Last 1
$sampleBack = Get-ChildItem $smokeOut -Filter '*-back.png' | Select-Object -Last 1
if (-not $sample -or -not $sampleBack) { throw '스모크 산출물(front/back PNG)이 없어 인쇄 CLI를 검증할 수 없음' }
# 설정과 같은 방향·SDK 경로로 검증해야 의미가 있다.
# (예전에는 방향 인자 없이 돌려서 카드가 세로인데 게이트는 가로로 통과했다)
$cfg = Get-Content (Join-Path $root 'kiosk\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$orient = if ($cfg.card.orientation -eq 'portrait') { '--portrait' } else { '--landscape' }
$sdk = if ($cfg.printer.sdk) { $cfg.printer.sdk } else { 'comm' }
Write-Host ("== 동봉 인쇄 CLI --dry-run ({0} {1} {2}x{3}) ==" -f $sdk, $orient, $cfg.card.width, $cfg.card.height)
& $cli --dry-run --mode $sdk $orient --front $sample.FullName --back $sampleBack.FullName | Write-Host
if ($LASTEXITCODE -ne 0) { throw "DalsuPrint.exe --dry-run 실패 (exit $LASTEXITCODE)" }
# 카드 규격이 설정과 다르면(세로인데 가로로 그려졌다면) 여기서 잡는다
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($sample.FullName)
$w = $img.Width; $h = $img.Height; $img.Dispose()
if ($w -ne [int]$cfg.card.width -or $h -ne [int]$cfg.card.height) {
  throw ("카드 규격 불일치: 생성 {0}x{1} vs 설정 {2}x{3}" -f $w, $h, $cfg.card.width, $cfg.card.height)
}
Write-Host ("  카드 규격 확인 {0}x{1}" -f $w, $h)

# portable exe 옆에 남은 이전 실행 흔적을 지운다.
# config.json 은 '없을 때만' 복사되므로, 남아 있으면 옛 설정으로 새 exe 가 돌아 혼란을 준다.
Remove-Item (Join-Path $outDir 'config.json') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $outDir 'out'), (Join-Path $outDir 'logs') -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '빌드 완료:'
Get-ChildItem $outDir -File | Where-Object { $_.Extension -in '.exe', '.zip' } |
  ForEach-Object { Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
