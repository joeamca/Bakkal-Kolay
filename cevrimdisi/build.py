#!/usr/bin/env python3
"""Bakkal Kolay (çevrimdışı) = Bakkal Kolay'ın internetsiz, hesapsız, Gemini'siz sürümü.
Kaynak: üst klasör (../index.html, ../duyuru.js, ../kamera.js, ../icons). Çalıştır: python3 cevrimdisi/build.py"""
import re, shutil, os
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.dirname(os.path.abspath(__file__))
s = open(f"{SRC}/index.html", encoding="utf-8").read()

def rep(a, b, cnt=1):
    global s
    assert s.count(a) == cnt, (a[:70], s.count(a)); s = s.replace(a, b)

# 1) Bulut/hesap tamamen kapalı: adres ve anahtar boş → CLOUD_ON=false, uygulama "yerel" modda açılır
s = re.sub(r'const CLOUD = \{url:"[^"]*", key:"[^"]*"', 'const CLOUD = {url:"", key:""', s, count=1)
assert 'const CLOUD = {url:"", key:""' in s
s = re.sub(r'(?m)^<link rel="preconnect" href="https://fonts.googleapis.com">\n', '', s)
s = re.sub(r'(?m)^<link rel="stylesheet" href="https://fonts.googleapis.com[^\n]*\n', '', s)
rep('const APP_URL = "https://joeamca.github.io/Bakkal-Kolay/";', 'const APP_URL = "https://joeamca.github.io/Bakkal-Kolay/cevrimdisi/";')
# 2) Yapay zekâ yok: Asistan sekmesi, sesli komut, Kendin Anlat
rep(',["sor","Asistan","spark"]]', ']')
rep('const voiceBox = (m, ph) => isStaff() ? "" : `', 'const voiceBox = (m, ph) => "" && `')
rep('${isStaff() ? "" : `<button type="button" class="camBtn" data-act="vOpen" aria-label="Sesle söyle" title="Sesle söyle">🎤</button>`}', '')
rep(', sor:kSor,', ',')
# 4) Hesap gerektiren kartlar çıkar: ortak defter, bildirimler
i = s.index('  ${S.mode==="cloud" ? "" : `<section class="card stack"><h2>Dükkânda Birden Fazla Kişi</h2>')
j = s.index('  </section>`}\n', i) + len('  </section>`}\n')
s = s[:i] + s[j:]
rep('  if (S.mode!=="cloud") return `<section class="card stack"><h2>${ic("bell",20)} Bildirimler</h2><p class="small muted">Bildirimler için hesabınla giriş yapman gerekiyor.</p></section>`;', '  return "";')
# Aynı adreste (joeamca.github.io) çalışan Kolay/Defteri ile tarayıcı belleği karışmasın: bütün anahtarlar bdo- ile başlar
s = s.replace('"bd-', '"bdo-')
# 3) Başlık/adlandırma
s = s.replace("<title>Bakkal Kolay</title>", "<title>Bakkal Kolay Çevrimdışı</title>")
s = s.replace('document.title = shopTitle() ? shopTitle() + " · Bakkal Kolay" : "Bakkal Kolay";', 'document.title = shopTitle() ? shopTitle() + " · Bakkal Kolay Çevrimdışı" : "Bakkal Kolay Çevrimdışı";')
open(f"{OUT}/index.html", "w", encoding="utf-8").write(s)

# duyuru.js: yapay zekâlı "Kendin Anlat" türü çıkar
d = open(f"{SRC}/duyuru.js", encoding="utf-8").read()
d2 = re.sub(r',?\s*\{ id: "ozel", ad: "Kendin Anlat"[^\n]*\},?', '', d, count=1)
assert d2 != d
open(f"{OUT}/duyuru.js", "w", encoding="utf-8").write(d2)
shutil.copy(f"{SRC}/kamera.js", f"{OUT}/kamera.js")
os.makedirs(f"{OUT}/icons", exist_ok=True)
for f in ["kolay-180.png", "kolay-192.png", "kolay-512.png", "kolay-mask-512.png"]:
    shutil.copy(f"{SRC}/icons/{f}", f"{OUT}/icons/{f}")
print("tamam", len(s))
