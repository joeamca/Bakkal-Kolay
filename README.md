# Bakkal Kolay

Büyük düğmeli, sade bakkal defteri: satış, kasa, stok, kâr. Telefona yüklenen web uygulaması.

**Adres:** https://joeamca.github.io/Bakkal-Kolay/

Normal uygulamadan (Bakkal Defteri) bağımsızdır: kendi dosyaları, servis çalışanı ve adresi var. Veri aynı Supabase projesindedir; aynı hesapla giren aynı dükkânı görür.

- `index.html`: uygulama
- `sw.js`: internetsiz açılış ve bildirimler (sürüm değişince `CACHE` adını artır)
- `kamera.js`, `duyuru.js`: barkod okuma ve duyuru kartı
- `supabase/`: veritabanı SQL'leri

Yayın: GitHub Pages, branch `main`, klasör `/ (root)`. Supabase > Authentication > URL Configuration listesine yukarıdaki adres eklenmeli.
