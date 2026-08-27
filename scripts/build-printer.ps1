# DalsuPrint.exe 빌드 → printer/dist (SmartComm2.dll 동봉). 키오스크 config.printer.exe 가 이 경로를 가리킨다.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$proj = Join-Path $root 'printer\DalsuPrint\DalsuPrint.csproj'
$dist = Join-Path $root 'printer\dist'
# self-contained: .NET 런타임을 함께 담는다. 현장 PC에 .NET 8 설치가 필요 없어진다(용량 +약 70MB).
# 트리밍은 하지 않는다 — P/Invoke·리플렉션이 섞여 있어 잘려나갈 위험이 있다.
dotnet publish $proj -c Release -r win-x64 --self-contained true -o $dist -p:PublishSingleFile=false -p:PublishTrimmed=false -nologo -v q
if ($LASTEXITCODE -ne 0) { throw "dotnet publish 실패 ($LASTEXITCODE)" }
if (-not (Test-Path (Join-Path $dist 'DalsuPrint.exe'))) { throw 'DalsuPrint.exe 없음' }
if (-not (Test-Path (Join-Path $dist 'SmartComm2.dll'))) { throw 'SmartComm2.dll 누락' }
Write-Host "빌드 완료 → $dist"
