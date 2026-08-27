# 업데이트 패키지 생성 → dist/demo/update-<버전>.zip (약 4MB)
#
# 전체 배포본은 170MB지만 그중 우리 코드·자산은 app.asar 하나(4MB)뿐이다.
# Electron 런타임·.NET 런타임·인쇄 CLI 는 바뀌지 않으므로 매번 보낼 필요가 없다.
# → 첫 전송만 전체 zip, 이후에는 이 업데이트 패키지만 보낸다.
#
# 주의: 인쇄 CLI(printer/dist)나 Electron 버전이 바뀌면 전체 zip 을 다시 보내야 한다.
#       이 스크립트가 그런 경우를 감지해 경고한다.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$unpacked = Join-Path $root 'dist\pkg\win-unpacked'
$asar = Join-Path $unpacked 'resources\app.asar'
if (-not (Test-Path $asar)) { throw "app.asar 없음 — npm run build:demo 를 먼저 실행하세요" }

$ver = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stage = Join-Path $root 'dist\pkg\_update'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

Copy-Item $asar (Join-Path $stage 'app.asar')

# 인쇄 CLI 가 마지막 전체 빌드 이후 바뀌었는지 확인 (바뀌었으면 전체 zip 이 필요하다)
$cliSrc = Join-Path $root 'printer\dist\DalsuPrint.exe'
$cliPkg = Join-Path $unpacked 'resources\printer\DalsuPrint.exe'
$cliChanged = $false
if ((Test-Path $cliSrc) -and (Test-Path $cliPkg)) {
  $cliChanged = (Get-FileHash $cliSrc).Hash -ne (Get-FileHash $cliPkg).Hash
}

$guide = @"
달수 AR 키오스크 — 업데이트 $ver

적용 방법 (1분)
  1. 키오스크에서 실행 중인 앱을 종료한다
     (화면 오른쪽 위 모서리를 2초 안에 3번 터치, 또는 Alt+F4)
  2. 이 폴더의 app.asar 를
       <앱 폴더>\resources\app.asar
     에 덮어쓴다
  3. DalsuARKiosk.exe 를 다시 실행한다

확인
  대기 화면 왼쪽 아래 버전이 v$ver 로 바뀌면 적용된 것이다.

주의
  · config.json 은 건드리지 않는다 — 현장에서 맞춘 설정(프린터 모드·카메라 등)이 그대로 유지된다
  · 이 패키지는 앱 코드·그래픽만 바꾼다. Electron·.NET 런타임·인쇄 CLI 는 그대로다
"@
if ($cliChanged) {
  $guide += @"

⚠ 이번에는 인쇄 CLI(DalsuPrint.exe)도 바뀌었다.
   app.asar 만으로는 부족하니 전체 zip(DalsuARKiosk-$ver-win.zip)을 보내야 한다.
"@
}
Set-Content -Path (Join-Path $stage '적용방법.txt') -Value $guide -Encoding UTF8

$zip = Join-Path $root ("dist\pkg\update-{0}.zip" -f $ver)
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item -Recurse -Force $stage

$mb = (Get-Item $zip).Length / 1MB
Write-Host ("업데이트 패키지 → {0} ({1:N1} MB)" -f $zip, $mb)
if ($cliChanged) {
  Write-Warning "인쇄 CLI 가 바뀌었습니다 — 이번에는 전체 zip 을 보내야 합니다."
} else {
  Write-Host "인쇄 CLI 변경 없음 — 이 패키지만 보내면 됩니다."
}
