# 포토카드 뒷면 기본 디자인 — kiosk/config.json 의 card.width/height 를 따른다.
# 세로(664x1040)와 가로(1040x664) 둘 다 지원한다.
#
# 예전에는 가로 기준 좌표를 하드코딩해 세로 캔버스에서 제목이 잘리고 아래 40%가 비었다.
# 이제 캔버스 방향을 보고 배치를 바꾸고, 긴 제목은 폭에 맞춰 줄바꿈한다.
#
# 최종 디자인(그래픽 제작 항목)이 나오면 kiosk/assets/card-back.png 만 덮어쓰면 된다.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'kiosk\assets'
$cfg = Get-Content (Join-Path $root 'kiosk\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$W = [int]$cfg.card.width; $H = [int]$cfg.card.height
$portrait = $H -gt $W
Write-Host ("뒷면 카드 규격: {0}x{1} ({2})" -f $W, $H, $(if ($portrait) { '세로' } else { '가로' }))

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'

# 배경 — 물빛 그라데이션
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, $H), [System.Drawing.Color]::FromArgb(255, 222, 243, 251), [System.Drawing.Color]::FromArgb(255, 116, 186, 222))
$g.FillRectangle($brush, 0, 0, $W, $H)

# 물길 곡선 — 캔버스 비율에 맞춰 그린다(하드코딩 좌표 금지)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(95, 255, 255, 255)), ($W * 0.11)
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddBezier(($W*0.72), ($H*0.02), ($W*0.30), ($H*0.16), ($W*0.28), ($H*0.34), ($W*0.62), ($H*0.46))
$path.AddBezier(($W*0.62), ($H*0.46), ($W*0.96), ($H*0.58), ($W*0.44), ($H*0.82), ($W*0.16), ($H*1.02))
$g.DrawPath($pen, $path)

# 달수 얼굴
$face = Join-Path $assets 'dalsu-face.png'
$faceBottom = [int]($H * 0.10)
if (Test-Path $face) {
  $img = [System.Drawing.Image]::FromFile($face)
  $fh = [int]($H * $(if ($portrait) { 0.30 } else { 0.46 }))
  $fw = [int]($img.Width * ($fh / $img.Height))
  if ($fw -gt $W * 0.62) { $fw = [int]($W * 0.62); $fh = [int]($img.Height * ($fw / $img.Width)) }
  $top = [int]($H * 0.09)
  $g.DrawImage($img, [int](($W - $fw) / 2), $top, $fw, $fh)
  $faceBottom = $top + $fh
  $img.Dispose()
}

# 문구 — 폭에 맞춰 줄바꿈한다. 예전에는 한 줄로 그려 제목이 잘렸다.
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Near'; $fmt.Trimming = 'EllipsisCharacter'
$pad = [int]($W * 0.07)
$boxW = $W - $pad * 2
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 42, 58))

$titleSize = [single]($W * 0.052)
$f1 = New-Object System.Drawing.Font 'Malgun Gothic', $titleSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$y = $faceBottom + [int]($H * 0.045)
$titleRect = New-Object System.Drawing.RectangleF $pad, $y, $boxW, ($H * 0.20)
$g.DrawString($cfg.event.name, $f1, $dark, $titleRect, $fmt)
$titleH = $g.MeasureString($cfg.event.name, $f1, [int]$boxW, $fmt).Height

$f2 = New-Object System.Drawing.Font 'Malgun Gothic', ([single]($W * 0.033)), ([System.Drawing.GraphicsUnit]::Pixel)
$y2 = $y + [int]$titleH + [int]($H * 0.022)
$subRect = New-Object System.Drawing.RectangleF $pad, $y2, $boxW, ($H * 0.16)
$g.DrawString('4대 환경목표 달성 → 물길 완성 → 자연 회복', $f2, $dark, $subRect, $fmt)
$subH = $g.MeasureString('4대 환경목표 달성 → 물길 완성 → 자연 회복', $f2, [int]$boxW, $fmt).Height

$f3 = New-Object System.Drawing.Font 'Malgun Gothic', ([single]($W * 0.030)), ([System.Drawing.GraphicsUnit]::Pixel)
$y3 = $y2 + [int]$subH + [int]($H * 0.012)
$venueRect = New-Object System.Drawing.RectangleF $pad, $y3, $boxW, ($H * 0.08)
$g.DrawString($cfg.event.venue, $f3, $dark, $venueRect, $fmt)

# SAMSUNG — 아래쪽에 고정
$f4 = New-Object System.Drawing.Font 'Arial', ([single]($W * 0.072)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$sRect = New-Object System.Drawing.RectangleF $pad, ($H - [int]($H * 0.155)), $boxW, ($H * 0.10)
$g.DrawString('SAMSUNG', $f4, $dark, $sRect, $fmt)

$out = Join-Path $assets 'card-back.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "card-back.png 생성 -> $out ($W x $H)"
