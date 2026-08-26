# 현장 배포 패키지 생성 → dist/dalsu-ar-kiosk-<yyyyMMdd>.zip
# 포함: kiosk/ (node_modules 제외), printer/dist/, package.json, README, docs/, start-kiosk.cmd, print-test.cmd
# 현장 PC: Node 22 + .NET 8 Desktop Runtime 설치 후 압축 해제 → npm install --omit=dev 불필요(electron은 devDependency) → npm install
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (-not (Test-Path 'printer\dist\DalsuPrint.exe')) { throw 'printer/dist/DalsuPrint.exe 없음 — npm run build:printer 먼저' }
if (-not (Test-Path 'kiosk\assets\card-back.png')) { throw 'kiosk/assets/card-back.png 없음 — npm run assets 먼저' }
$stage = Join-Path $root 'dist\stage'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item -Recurse 'kiosk' (Join-Path $stage 'kiosk')
New-Item -ItemType Directory -Force (Join-Path $stage 'printer') | Out-Null
Copy-Item -Recurse 'printer\dist' (Join-Path $stage 'printer\dist')
Copy-Item 'package.json', 'package-lock.json', 'README.md', 'CLAUDE.md' $stage
Copy-Item -Recurse 'docs' (Join-Path $stage 'docs')
Copy-Item 'scripts\start-kiosk.cmd', 'scripts\print-test.cmd' $stage
New-Item -ItemType Directory -Force (Join-Path $stage 'out'), (Join-Path $stage 'logs') | Out-Null
$zip = Join-Path $root ("dist\dalsu-ar-kiosk-{0}.zip" -f (Get-Date -Format 'yyyyMMdd'))
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item -Recurse -Force $stage
Write-Host ("패키지 생성 → {0} ({1:N0} bytes)" -f $zip, (Get-Item $zip).Length)
