# assets-src/*.ai.pdf (Illustrator PDF 호환 저장본) → kiosk/assets/*.png (투명 배경, 고해상도)
# WinRT Windows.Data.Pdf 사용 — 별도 설치 없음 (Windows 10/11). 페이지 전체를 렌더한 뒤 불투명 픽셀 경계로 자동 크롭.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$srcDir = Join-Path $root 'assets-src'
$dstDir = Join-Path $root 'kiosk\assets'
New-Item -ItemType Directory -Force $dstDir | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskPlain = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, $type) { $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(); $t.Result }
function AwaitAction($op) { $t = $asTaskPlain.Invoke($null, @($op)); $t.Wait() }

# 원본 파일 → 출력 이름 매핑 (페이지 1 기준, 턴어라운드는 왼쪽부터 정면/¾/측면/후면 4컷을 가로 4등분)
$jobs = @(
  # 달수는 '옷 입은(탐험가 복장)' 버전으로 통일한다 (2026-08-26 확정). 파일명은 CLAUDE.md 규약대로 고정.
  @{ src = 'dalsu-explorer-turnaround.ai.pdf'; out = 'dalsu-front.png';          slice = 0; of = 4 },  # 정면 서기 — 대기/가이드 하단
  @{ src = 'dalsu-explorer-turnaround.ai.pdf'; out = 'dalsu-side.png';           slice = 2; of = 4 },  # 측면 서기 — 가이드 보조
  @{ src = 'dalsu-explorer-turnaround.ai.pdf'; out = 'dalsu-explorer-front.png'; slice = 0; of = 4 },
  @{ src = 'dalsu-lying-2.ai.pdf';             out = 'dalsu-float.png';          slice = 1; of = 2 },  # 옷 입고 엎드린 포즈 — 물길 헤엄
  @{ src = 'dalsu-lying-2.ai.pdf';             out = 'dalsu-lying.png';          slice = 1; of = 2 },
  @{ src = 'dalsu-sticker-face.ai.pdf';        out = 'dalsu-face.png';           slice = 0; of = 1; rect = @(0.22, 0.13, 0.56, 0.28) }
)

function Render-Page([string]$path, [int]$scale) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $page = $doc.GetPage(0)
  $opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opt.DestinationWidth = [uint32]($page.Size.Width * $scale)
  $opt.DestinationHeight = [uint32]($page.Size.Height * $scale)
  $opt.BackgroundColor = [Windows.UI.Color]::FromArgb(0, 0, 0, 0)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  AwaitAction ($page.RenderToStreamAsync($stream, $opt))
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
  $ms = New-Object System.IO.MemoryStream; $net.CopyTo($ms); $ms.Position = 0
  $bmp = [System.Drawing.Bitmap]::FromStream($ms)
  $page.Dispose()
  return $bmp
}

function Crop-Opaque([System.Drawing.Bitmap]$bmp) {
  $minX = $bmp.Width; $minY = $bmp.Height; $maxX = -1; $maxY = -1
  $data = $bmp.LockBits((New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)), 'ReadOnly', 'Format32bppArgb')
  $stride = $data.Stride; $bytes = New-Object byte[] ($stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length); $bmp.UnlockBits($data)
  for ($y = 0; $y -lt $bmp.Height; $y++) { for ($x = 0; $x -lt $bmp.Width; $x++) {
    $a = $bytes[$y * $stride + $x * 4 + 3]
    if ($a -gt 8) { if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }; if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y } }
  } }
  if ($maxX -lt 0) { throw "불투명 픽셀 없음 (배경 투명 렌더 실패?)" }
  $pad = 8
  $r = New-Object System.Drawing.Rectangle ([Math]::Max(0, $minX - $pad)), ([Math]::Max(0, $minY - $pad)), ([Math]::Min($bmp.Width, $maxX + $pad) - [Math]::Max(0, $minX - $pad)), ([Math]::Min($bmp.Height, $maxY + $pad) - [Math]::Max(0, $minY - $pad))
  return $bmp.Clone($r, 'Format32bppArgb')
}

$cache = @{}
foreach ($j in $jobs) {
  $src = Join-Path $srcDir $j.src
  if (-not (Test-Path $src)) { Write-Warning "원본 없음: $src"; continue }
  if (-not $cache.ContainsKey($j.src)) { $cache[$j.src] = Render-Page $src 3 }
  $full = $cache[$j.src]
  $w = [int]($full.Width / $j.of); $x = $w * $j.slice
  $top = 0; $h = $full.Height
  if ($j.rect) { $x = [int]($full.Width * $j.rect[0]); $top = [int]($full.Height * $j.rect[1]); $w = [int]($full.Width * $j.rect[2]); $h = [int]($full.Height * $j.rect[3]) }
  $slice = $full.Clone((New-Object System.Drawing.Rectangle($x, $top, $w, $h)), 'Format32bppArgb')
  $cropped = Crop-Opaque $slice
  $out = Join-Path $dstDir $j.out
  $cropped.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host ("{0,-28} {1}x{2}" -f $j.out, $cropped.Width, $cropped.Height)
  $slice.Dispose(); $cropped.Dispose()
}
$cache.Values | ForEach-Object { $_.Dispose() }
Write-Host "변환 완료 → $dstDir"
