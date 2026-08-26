# -*- coding: utf-8 -*-
# 동화풍 디자인 캔버스 아트보드 생성기 (Claude Design .dc.html)
import io, json
HEAD = '''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&family=Gowun+Dodum&display=swap">
  <style>
    body { margin: 0; font-family: "Gowun Dodum", "Malgun Gothic", sans-serif; color: #2f3a44; }
    a { color: #2b7a9e; } a:hover { color: #1d5a7a; }
    .jua { font-family: "Jua", "Malgun Gothic", sans-serif; }
  </style>
</helmet>
'''
TAIL = '''</x-dc>
</body>
</html>
'''

def sky(w, h, hills=True):
    s = f'''<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" style="position:absolute;left:0;top:0" preserveAspectRatio="none">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe9f5"/><stop offset="1" stop-color="#f6efe0"/></linearGradient>
    <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.2 0 0 0 0.06 0"/></filter>
  </defs>
  <rect width="{w}" height="{h}" fill="url(#sky)"/>
  <rect width="{w}" height="{h}" filter="url(#paper)"/>
  <circle cx="{w*0.82:.0f}" cy="{h*0.09:.0f}" r="{w*0.07:.0f}" fill="#fbe7a1" stroke="#f3cf6b" stroke-width="6"/>
  <g fill="#ffffff" opacity="0.9">
    <ellipse cx="{w*0.2:.0f}" cy="{h*0.11:.0f}" rx="{w*0.11:.0f}" ry="{w*0.045:.0f}"/><ellipse cx="{w*0.27:.0f}" cy="{h*0.095:.0f}" rx="{w*0.08:.0f}" ry="{w*0.05:.0f}"/>
    <ellipse cx="{w*0.6:.0f}" cy="{h*0.16:.0f}" rx="{w*0.09:.0f}" ry="{w*0.035:.0f}"/><ellipse cx="{w*0.65:.0f}" cy="{h*0.148:.0f}" rx="{w*0.06:.0f}" ry="{w*0.04:.0f}"/>
  </g>'''
    if hills:
        s += f'''
  <path d="M0 {h*0.78:.0f} C {w*0.25:.0f} {h*0.70:.0f}, {w*0.4:.0f} {h*0.84:.0f}, {w*0.62:.0f} {h*0.76:.0f} S {w*0.9:.0f} {h*0.7:.0f}, {w} {h*0.75:.0f} L {w} {h} L 0 {h} Z" fill="#b9dc9c"/>
  <path d="M0 {h*0.86:.0f} C {w*0.3:.0f} {h*0.8:.0f}, {w*0.55:.0f} {h*0.92:.0f}, {w} {h*0.84:.0f} L {w} {h} L 0 {h} Z" fill="#9bd18a"/>'''
    s += '\n</svg>'
    return s

def river_svg(w, h, width=90):
    d = f"M {w*0.12:.0f} {h*0.30:.0f} C {w*0.6:.0f} {h*0.22:.0f}, {w*0.05:.0f} {h*0.5:.0f}, {w*0.5:.0f} {h*0.52:.0f} C {w*0.95:.0f} {h*0.54:.0f}, {w*0.4:.0f} {h*0.82:.0f}, {w*0.9:.0f} {h*0.78:.0f}"
    return f'''<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" style="position:absolute;left:0;top:0">
  <path d="{d}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="{width*1.4}" stroke-linecap="round"/>
  <path d="{d}" fill="none" stroke="#7cc4e0" stroke-width="{width}" stroke-linecap="round"/>
  <path d="{d}" fill="none" stroke="#bfe6f4" stroke-width="{width*0.35}" stroke-linecap="round" stroke-dasharray="40 60"/>
</svg>'''

def plant(x, y, s=1, kind='leaf'):
    if kind == 'leaf':
        return f'<g transform="translate({x:.0f},{y:.0f}) scale({s})"><path d="M0 60 C -4 30, 6 10, 0 -10" stroke="#5a9a55" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M0 25 C -30 15, -34 -12, -6 -6 C 4 10, 4 20, 0 25Z" fill="#9bd18a"/><path d="M0 10 C 30 0, 34 -26, 6 -20 C -4 -6, -4 4, 0 10Z" fill="#b9dc9c"/></g>'
    if kind == 'fish':
        return f'<g transform="translate({x:.0f},{y:.0f}) scale({s})"><path d="M-40 0 C -20 -26, 20 -26, 42 0 C 20 26, -20 26, -40 0Z" fill="#f4a261"/><path d="M-40 0 L -62 -18 L -58 0 L -62 18 Z" fill="#e88a3c"/><circle cx="24" cy="-6" r="5" fill="#2f3a44"/><path d="M-10 -12 C -2 -2, -2 2, -10 12" stroke="#ffd7b0" stroke-width="4" fill="none"/></g>'
    if kind == 'dragonfly':
        return f'<g transform="translate({x:.0f},{y:.0f}) scale({s})"><ellipse cx="-22" cy="-8" rx="26" ry="9" fill="#cfe9f5" stroke="#9fd2ea" stroke-width="3" transform="rotate(-20)"/><ellipse cx="22" cy="-8" rx="26" ry="9" fill="#cfe9f5" stroke="#9fd2ea" stroke-width="3" transform="rotate(20)"/><rect x="-4" y="-6" width="8" height="52" rx="4" fill="#5a9a55"/><circle cx="0" cy="-10" r="9" fill="#2f3a44"/></g>'
    return f'<g transform="translate({x:.0f},{y:.0f}) scale({s})"><path d="M0 40 L0 0" stroke="#5a9a55" stroke-width="5" stroke-linecap="round"/><g fill="#f7b7c8"><circle cx="0" cy="-14" r="10"/><circle cx="13" cy="-4" r="10"/><circle cx="8" cy="11" r="10"/><circle cx="-8" cy="11" r="10"/><circle cx="-13" cy="-4" r="10"/></g><circle r="7" fill="#fbe7a1"/></g>'

def nature_svg(w, h, count=8):
    items = [('leaf',0.18,0.36,1.3),('fish',0.36,0.33,1.0),('flower',0.30,0.55,1.4),('dragonfly',0.62,0.44,1.1),('leaf',0.58,0.62,1.5),('fish',0.72,0.72,1.1),('flower',0.86,0.66,1.2),('leaf',0.9,0.85,1.3)]
    g = ''.join(plant(w*x, h*y, s, k) for k,x,y,s in items[:count])
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" style="position:absolute;left:0;top:0">{g}</svg>'

GOALS = [('탄소','#9fc4f2','cloud'),('수자원','#8fd3ea','drop'),('폐기물','#a8dba0','recycle'),('오염물질','#c9e3b0','sprout')]
ICONS = {
 'cloud':'<path d="M18 40h30a12 12 0 0 0 0-24 16 16 0 0 0-30-4 10 10 0 0 0 0 28z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round"/>',
 'drop':'<path d="M32 8c10 14 18 22 18 32a18 18 0 0 1-36 0c0-10 8-18 18-32z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round"/>',
 'recycle':'<path d="M32 12l10 17H22zM12 46l9-16 10 17zM52 46l-9-16-10 17z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round"/>',
 'sprout':'<path d="M32 56V30M32 30c-14 0-18-10-18-18 10 0 18 6 18 18zM32 34c14 0 18-10 18-18-10 0-18 6-18 18z" fill="none" stroke="#2f3a44" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>'}

def bubble(x, y, label, color, icon, size=300, popped=False):
    style = 'opacity:0.25;transform:scale(0.7);' if popped else ''
    return f'''<div style="position:absolute;left:{x}px;top:{y}px;width:{size}px;height:{size}px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #ffffff 0%, {color} 55%, rgba(255,255,255,0.3) 100%);border:6px solid rgba(255,255,255,0.9);box-shadow:0 18px 40px rgba(60,90,110,0.25), inset -12px -14px 30px rgba(60,90,110,0.12);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;{style}">
  <svg viewBox="0 0 64 64" width="{size*0.38:.0f}" height="{size*0.38:.0f}">{ICONS[icon]}</svg>
  <div class="jua" style="font-size:{size*0.15:.0f}px;color:#2f3a44">{label}</div>
</div>'''

def caption(text, top=110, size=64):
    return f'<div class="jua" style="position:absolute;left:50%;top:{top}px;transform:translateX(-50%);font-size:{size}px;color:#2f3a44;background:rgba(255,255,255,0.75);padding:22px 56px;border-radius:60px;border:4px solid #ffffff;box-shadow:0 10px 30px rgba(60,90,110,0.18);white-space:nowrap">{text}</div>'

W, H = 1080, 1920
def root(inner): return f'<div style="position:relative;width:{W}px;height:{H}px;overflow:hidden;background:#f6efe0">{inner}</div>\n'
files = {}

files['Main.dc.html'] = HEAD + root(sky(W,H) + f'''
<img src="dalsu-front.png" style="position:absolute;left:{W/2-210:.0f}px;top:560px;height:720px" alt="달수">
<div style="position:absolute;left:0;right:0;top:1330px;display:flex;flex-direction:column;align-items:center;gap:26px">
  <div class="jua" style="font-size:88px;color:#2f3a44;text-shadow:0 4px 0 #ffffff">달수와 함께 물길을 완성해요</div>
  <div style="font-size:44px;color:#4c5a66">화면을 터치하면 시작합니다</div>
</div>
<div style="position:absolute;left:0;right:0;top:230px;display:flex;justify-content:center"><div class="jua" style="font-size:46px;color:#2b7a9e;background:#ffffff;padding:16px 44px;border-radius:50px;border:4px solid #bfe6f4">삼성 달수 AR 포토카드</div></div>
''') + TAIL

files['Bubbles.dc.html'] = HEAD + root(sky(W,H) + caption('물방울을 하나씩 터치해 주세요') + ''.join([
  bubble(120, 380, GOALS[0][0], GOALS[0][1], GOALS[0][2]),
  bubble(640, 520, GOALS[1][0], GOALS[1][1], GOALS[1][2]),
  bubble(170, 960, GOALS[2][0], GOALS[2][1], GOALS[2][2], popped=True),
  bubble(660, 1080, GOALS[3][0], GOALS[3][1], GOALS[3][2]),
]) + '''
<img src="dalsu-side.png" style="position:absolute;left:400px;top:1180px;height:520px" alt="달수 가이드">
<div style="position:absolute;left:50%;bottom:150px;transform:translateX(-50%);background:#ffffff;border:5px solid #a8dba0;border-radius:40px;padding:30px 56px;box-shadow:0 14px 34px rgba(60,90,110,0.2);display:flex;flex-direction:column;align-items:center;gap:8px">
  <div class="jua" style="font-size:40px;color:#5a9a55">폐기물 목표 달성!</div>
  <div style="font-size:42px;color:#2f3a44;text-align:center">2030년 폐기물 재활용률 99.9% 달성</div>
</div>
''') + TAIL

files['River.dc.html'] = HEAD + root(sky(W,H) + river_svg(W,H) + nature_svg(W,H) + caption('깨끗한 물길을 따라 자연이 살아납니다', size=56) + f'''
<img src="dalsu-float.png" style="position:absolute;left:{W*0.5-190:.0f}px;top:{H*0.52-140:.0f}px;height:280px;transform:rotate(-8deg)" alt="달수">
''') + TAIL

files['Countdown.dc.html'] = HEAD + root(sky(W,H,hills=False) + river_svg(W,H,width=70) + nature_svg(W,H,6) + '''
<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(47,58,68,0.15), rgba(47,58,68,0.35))"></div>
<div style="position:absolute;left:0;right:0;top:300px;display:flex;justify-content:center"><div class="jua" style="font-size:64px;color:#ffffff;text-shadow:0 4px 18px rgba(0,0,0,0.35)">달수와 함께 찍어요!</div></div>
<div class="jua" style="position:absolute;left:0;right:0;top:640px;text-align:center;font-size:520px;line-height:1;color:#ffffff;text-shadow:0 12px 40px rgba(0,0,0,0.35)">3</div>
<img src="dalsu-float.png" style="position:absolute;left:640px;top:1250px;height:320px" alt="달수">
<div style="position:absolute;left:0;right:0;top:1660px;display:flex;justify-content:center"><div style="font-size:40px;color:#ffffff;background:rgba(47,58,68,0.45);padding:14px 40px;border-radius:40px">카메라를 봐 주세요</div></div>
''') + TAIL

card_w, card_h = 960, 603
files['Preview.dc.html'] = HEAD + root(sky(W,H,hills=False) + f'''
<div style="position:absolute;inset:0;background:rgba(47,58,68,0.55)"></div>
{caption('포토카드를 출력하고 있어요', size=56)}
<div style="position:absolute;left:60px;top:420px;width:{card_w}px;height:{card_h}px;border-radius:28px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,0.4);border:8px solid #ffffff;background:#cfe9f5">
  <div style="position:absolute;inset:0;background:linear-gradient(160deg,#9fd2ea,#4f93b6)"></div>
  <div style="position:absolute;left:340px;top:90px;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,0.75)"></div>
  <div style="position:absolute;left:520px;top:250px;font-size:30px;color:#ffffff;opacity:0.8">촬영된 관람객 사진</div>
  {river_svg(card_w, card_h, width=54)}
  {nature_svg(card_w, card_h, 6)}
  <img src="dalsu-float.png" style="position:absolute;right:28px;bottom:70px;height:250px" alt="달수">
  <div style="position:absolute;left:0;right:0;bottom:0;height:64px;background:rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <div class="jua" style="font-size:28px;color:#2f3a44">삼성 달수 AR 포토카드 · 대한민국 국제물주간(KIWW) 2026</div>
    <div style="font-size:22px;color:#4c5a66">2026.09.09</div>
  </div>
</div>
<div style="position:absolute;left:150px;right:150px;top:1140px;display:flex;flex-direction:column;align-items:center;gap:24px">
  <div style="width:100%;height:26px;border-radius:13px;background:rgba(255,255,255,0.35);overflow:hidden"><div style="width:62%;height:100%;background:linear-gradient(90deg,#7cc4e0,#9bd18a)"></div></div>
  <div style="font-size:38px;color:#ffffff">약 25초 뒤 카드가 나와요 · 잠시만 기다려 주세요</div>
</div>
<img src="dalsu-front.png" style="position:absolute;left:80px;top:1380px;height:460px" alt="달수">
<div style="position:absolute;left:380px;top:1480px;background:#ffffff;border-radius:40px;padding:30px 44px;font-size:40px;color:#2f3a44;box-shadow:0 14px 34px rgba(0,0,0,0.25)">사진 잘 나왔다!<br>카드 꼭 챙겨가!</div>
''') + TAIL

cw, ch = 1012, 636
files['CardFront.dc.html'] = HEAD + f'''<div style="position:relative;width:{cw}px;height:{ch}px;overflow:hidden;background:#cfe9f5">
  <div style="position:absolute;inset:0;background:linear-gradient(160deg,#9fd2ea,#4f93b6)"></div>
  <div style="position:absolute;left:360px;top:100px;width:290px;height:290px;border-radius:50%;background:rgba(255,255,255,0.75)"></div>
  <div style="position:absolute;left:380px;top:400px;font-size:26px;color:#ffffff;opacity:0.85">촬영된 관람객 사진 (웹캠)</div>
  {river_svg(cw, ch, width=56)}
  {nature_svg(cw, ch, 6)}
  <img src="dalsu-float.png" style="position:absolute;right:30px;bottom:74px;height:262px" alt="달수">
  <div style="position:absolute;left:24px;top:22px;display:flex;gap:10px;align-items:center;background:rgba(255,255,255,0.85);border-radius:30px;padding:8px 20px"><div class="jua" style="font-size:24px;color:#2b7a9e">4대 환경목표 달성!</div></div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:66px;background:rgba(255,255,255,0.92);display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <div class="jua" style="font-size:28px;color:#2f3a44">삼성 달수 AR 포토카드 · 대한민국 국제물주간(KIWW) 2026</div>
    <div style="font-size:22px;color:#4c5a66">2026.09.09</div>
  </div>
</div>
''' + TAIL

files['CardBack.dc.html'] = HEAD + f'''<div style="position:relative;width:{cw}px;height:{ch}px;overflow:hidden;background:#f6efe0">
  {sky(cw, ch)}
  {river_svg(cw, ch, width=48)}
  {nature_svg(cw, ch, 5)}
  <img src="dalsu-face.png" style="position:absolute;left:{cw/2-150:.0f}px;top:70px;height:300px" alt="달수">
  <div style="position:absolute;left:0;right:0;top:395px;display:flex;flex-direction:column;align-items:center;gap:10px">
    <div class="jua" style="font-size:36px;color:#2f3a44;background:rgba(255,255,255,0.85);padding:8px 34px;border-radius:40px">대한민국 국제물주간(KIWW) 2026 · 대구 엑스코</div>
    <div style="font-size:22px;color:#4c5a66">탄소중립 · 수자원 절감 · 폐기물 재활용 · 오염물질 저감</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:36px;text-align:center;font-family:'Arial Black',sans-serif;font-weight:900;font-size:40px;letter-spacing:2px;color:#2f3a44">SAMSUNG</div>
</div>
''' + TAIL

for k, v in files.items():
    io.open(k, 'w', encoding='utf-8').write(v)
gap = 120
canvas = {"artboards": [
    {"file": "Main.dc.html", "title": "1 대기", "x": 0, "y": 0, "w": W, "h": H},
    {"file": "Bubbles.dc.html", "title": "2 물방울 터치", "x": W + gap, "y": 0, "w": W, "h": H},
    {"file": "River.dc.html", "title": "3 물길·자연 회복", "x": 2 * (W + gap), "y": 0, "w": W, "h": H},
    {"file": "Countdown.dc.html", "title": "4 카운트다운", "x": 3 * (W + gap), "y": 0, "w": W, "h": H},
    {"file": "Preview.dc.html", "title": "5 미리보기·출력", "x": 4 * (W + gap), "y": 0, "w": W, "h": H},
    {"file": "CardFront.dc.html", "title": "포토카드 앞면 1012×636", "x": 0, "y": H + 220, "w": cw, "h": ch},
    {"file": "CardBack.dc.html", "title": "포토카드 뒷면 1012×636", "x": cw + gap, "y": H + 220, "w": cw, "h": ch}],
  "annotations": [{"id": "brief", "x": 0, "y": -220, "w": 900, "text": "동화풍 방향: 종이 질감 + 파스텔 하늘/언덕, 손그림 느낌의 물길·식물·물고기·잠자리. 달수는 삼성 원본(플랫 2D) 그대로. 서체: Jua(제목)+Gowun Dodum(본문). 물방울·아이콘·자연 요소는 SVG라 색·크기 바로 조정 가능."}],
  "launch": {"view": "canvas"}}
json.dump(canvas, io.open('canvas.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('written', list(files))
