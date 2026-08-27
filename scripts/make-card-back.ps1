# 포토카드 뒷면 기본 디자인 생성 — kiosk/config.json 의 card.width/height 를 따른다(가로 1012×636 / 세로 636×1012) — 달수 얼굴 + 행사명 + SAMSUNG 문구.
# 최종 디자인(그래픽 소스 제작 항목)이 나오면 kiosk/assets/card-back.png만 덮어쓰면 된다.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$assets = Join-Path $root 'kiosk\assets'
$cfg = Get-Content (Join-Path $root 'kiosk\config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$W = [int]$cfg.card.width; $H = [int]$cfg.card.height
Write-Host ("뒷면 카드 규격: {0}x{1} ({2})" -f $W, $H, $cfg.card.orientation)
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'; $g.InterpolationMode = 'HighQualityBicubic'

# 배경: 물빛 그라데이션 + S자 물길 느낌의 곡선
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush ((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $W, $H), [System.Drawing.Color]::FromArgb(255, 214, 240, 250), [System.Drawing.Color]::FromArgb(255, 120, 190, 225))
$g.FillRectangle($brush, 0, 0, $W, $H)
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 255, 255, 255)), 70
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddBezier(80, 120, 520, 20, 40, 330, 500, 330); $path.AddBezier(500, 330, 960, 330, 440, 620, 930, 540)
$g.DrawPath($pen, $path)

# 달수 얼굴 (변환본이 있으면)
$face = Join-Path $assets 'dalsu-face.png'
if (Test-Path $face) {
  $img = [System.Drawing.Image]::FromFile($face)
  $fh = 300; $fw = [int]($img.Width * ($fh / $img.Height))
  $g.DrawImage($img, [int](($W - $fw) / 2), 70, $fw, $fh)
  $img.Dispose()
}

# 문구
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'
$f1 = New-Object System.Drawing.Font 'Malgun Gothic', 26, ([System.Drawing.FontStyle]::Bold)
$f2 = New-Object System.Drawing.Font 'Malgun Gothic', 16
$f3 = New-Object System.Drawing.Font 'Arial Black', 30, ([System.Drawing.FontStyle]::Bold)
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 42, 58))
$g.DrawString($cfg.event.name, $f1, $dark, (New-Object System.Drawing.RectangleF 0, 392, $W, 50), $fmt)
$g.DrawString('4대 환경목표 달성 → 물길 완성 → 자연 회복 → 달수와 함께', $f2, $dark, (New-Object System.Drawing.RectangleF 0, 445, $W, 40), $fmt)
$g.DrawString('SAMSUNG', $f3, $dark, (New-Object System.Drawing.RectangleF 0, 520, $W, 60), $fmt)

$out = Join-Path $assets 'card-back.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "card-back.png 생성 → $out ($W x $H)"
