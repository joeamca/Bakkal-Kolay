# Bakkal Kolay Çevrimdışı

İnterneti olmayan ya da hesap açmak istemeyen bakkallar için **Bakkal Kolay'ın ayrı, sade sürümü**.

- Hesap, giriş ve sunucu **yok**. Bütün kayıtlar yalnız bu telefonda (tarayıcı belleğinde) durur.
- **Yapay zekâ (Gemini) yok**: Asistan, sesli komut ve "Kendin Anlat" duyuruları bu sürümde bulunmaz.
- Uygulama ilk açılışta (internetle) telefona indirilir; sonra tamamen **internetsiz** çalışır (satış, kasa, stok, kâr, barkod, duyuru kartları).
- Yedek: Ayarlar > Yedek (Excel). Kayıtlar yalnız bu telefonda olduğu için haftada bir Excel'e aktarmak önerilir; telefon değişirse "Excel'den yükle" ile geri gelir.

## Kurulum
Adres: https://joeamca.github.io/Bakkal-Kolay/cevrimdisi/ — telefonda aç, "Ana ekrana ekle" de. İlk açılışta internet gerekir (uygulama ve Excel kütüphanesi indirilir), sonrasında gerekmez.

## Geliştirme
Bu klasör (`cevrimdisi/`) Bakkal Kolay'ın bir alt uygulamasıdır; `index.html`, `duyuru.js` ve `kamera.js` üst klasördeki Kolay dosyalarından `build.py` ile üretilir (bulut/hesap kapatılır, yapay zekâ özellikleri çıkarılır). Bakkal Kolay'da yapılan bir değişikliği buraya almak için depo kökünde `python3 cevrimdisi/build.py` çalıştırılır; sonra `sw.js` içindeki `CACHE` sürümü artırılır.
