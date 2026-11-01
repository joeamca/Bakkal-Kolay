/* Bakkal Kolay: Rehber (etkileşimli yardım).
   - Telefonda çalışır, internet istemez: bütün anlatımlar bu dosyanın içinde.
   - "Bana Göster" ekranda ilgili düğmeyi parlatıp adım adım anlatır.
   - Sesli anlatım telefonun kendi sesiyle (tr-TR) yapılır.
   - İnternet ve hesap varsa: dükkânın rakamlarıyla ilgili sorular Asistan'a aktarılır.
   Uygulama bu dosyayı açılışta arka planda yükler; window.KolayApp köprüsüyle konuşur. */
(function () {
  "use strict";
  if (window.Rehber) return;
  const A = window.KolayApp;
  if (!A) return;

  /* ---------- küçük yardımcılar ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const K = n => A.pfx + "rehber-" + n;
  const get = (n, d) => { try { const v = localStorage.getItem(K(n)); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const put = (n, v) => { try { localStorage.setItem(K(n), JSON.stringify(v)); } catch (_) {} };
  const norm = s => String(s || "").toLocaleLowerCase("tr").replace(/<[^>]+>/g, " ")
    .replace(/[çğıöşüâîû]/g, c => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" }[c]))
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const plain = h => String(h || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const NAV = t => `nav.tabs[aria-label="Bölümler"] button[data-tab="${t}"]`;
  const online = () => navigator.onLine !== false;
  const cloud = () => { try { return !!A.cloud(); } catch (_) { return false; } };
  const ai = () => { try { return !!A.ai(); } catch (_) { return false; } };
  const staff = () => { try { return !!A.staff(); } catch (_) { return false; } };

  /* ---------- KONULAR: "Ne yapmak istiyorsun?" ----------
     e: simge, t: başlık, k: arama kelimeleri, s: adımlar, ip: ipucu, tur: "Bana Göster" turu,
     own: çırağa gösterme, bulut: sadece hesaplı sürüm, yz: yapay zekâ gerekir */
  const T = [
    { id: "satis", e: "🛒", t: "Satış yapmak", k: "sat satis barkod okut sepet nakit kart odeme musteri fis para ustu",
      s: ["Alttan <b>Satış</b>'a bas (ya da Ana Sayfa'daki büyük <b>Satış Yap</b> düğmesine).",
        "Barkodu okut ya da ürünün adını yaz. Ürün sepete girer. Aynı üründen 3 tane için <b>3*barkod</b> yazabilirsin.",
        "Müşteri para verdiyse <b>Alınan Para</b>'ya yaz; para üstünü ben söylerim.",
        "Ödeme şekline bas: <b>Nakit</b>, <b>Kart</b> ya da <b>Veresiye</b>. Satış kaydedilir, stok düşer, nakitse kasa artar."],
      ip: "Tanımadığım bir barkod okutursan ürün ekleme formu açılır; kaydedince ürün doğrudan sepete girer.", tur: "satis" },
    { id: "urun", e: "🏷️", t: "Yeni ürün eklemek", k: "urun ekle yeni urun tanit barkod fiyat kaydet stoga ekle",
      s: ["Ana Sayfa'da ya da Stok'ta <b>Ürün Ekle</b>'ye bas.",
        "Barkodu okut (yoksa boş bırak), sonra ürünün <b>adını</b> yaz.",
        "<b>Satış fiyatı</b> şart. <b>Alış fiyatını</b> da yazarsan kârını hesaplarım.",
        "Rafta kaç tane olduğunu − / + ile ayarla, <b>Kaydet</b>'e bas."],
      ip: "Çok ürün gireceksen <b>Kaydet + Yeni</b> kullan: kaydeder, hemen sıradakini sorar. Aynı isimde ürün varsa ikinciyi açmam, “Üstüne Ekle” derim.", tur: "urun" },
    { id: "stok", e: "📦", t: "Stoğu düzeltmek", k: "stok sayim rafta kac tane eksi arti duzelt azalan biten",
      s: ["Alttan <b>Stok</b>'a bas.",
        "Ürünü bul: yukarıdan ara ya da <b>Azalan</b> / <b>Biten</b>'e bas.",
        "Raftaki sayı yanlışsa ürünün yanındaki <b>−</b> / <b>+</b> ile düzelt. 1 saniye sonra kendiliğinden kaydedilir.",
        "Fiyatı ya da barkodu değiştirmek için ürünün <b>adına</b> dokun."],
      ip: "− / + sadece sayımdır, kimseye borç yazmaz. Toptancıdan mal geldiyse <b>Mal Geldi</b>'yi kullan.", tur: "stok" },
    { id: "malgeldi", e: "🚚", t: "Mal geldi, toptancı borcu", k: "mal geldi toptanci tedarikci plasiyer borc odeme vade fatura ekmekci",
      s: ["Ana Sayfa'da ya da Stok'ta <b>Mal Geldi</b>'ye bas.",
        "Kimden aldığını, hangi üründen kaç tane ve kaça aldığını yaz.",
        "Borç mu yazılsın, peşin mi ödendi, seç. Stok kendiliğinden artar.",
        "Borcunu görmek için: <b>Diğer İşler → Tedarikçiler</b>. Ödeme yapınca oradan <b>Ödeme Yap</b>."],
      ip: "Kasadan <b>Para Al</b> yaparken sebep olarak toptancıyı seçersen borcundan da düşer. Vadesi gelince Ana Sayfa'da “Ödeme Zamanı” çıkar.", tur: "malgeldi" },
    { id: "kasa", e: "💵", t: "Kasaya para koymak / almak", k: "kasa para koy para al cikis giris gider fatura kira elektrik", own: true,
      s: ["Alttan <b>Kasa</b>'ya bas. En üstte kasada <b>olması gereken</b> para yazar.",
        "Kasaya para koyduysan <b>Para Koy</b>, kasadan para aldıysan <b>Para Al</b>.",
        "Tutarı yaz, sebebine tek dokunuşla bas (toptancı, ekmekçi, fatura, kira…), <b>Kaydet</b>."],
      ip: "Sebebi doğru seçersen Kâr ekranı gideri doğru hesaplar: toptancıya ödeme gider sayılmaz, kira sayılır.", tur: "kasa" },
    { id: "gunkapat", e: "🔒", t: "Günü kapatmak", k: "gun kapat kapanis aksam kasa say eksik fazla rapor acilis", own: true,
      s: ["Akşam <b>Kasa → Günü Kapat</b>'a bas.",
        "Kasadaki parayı say ve yaz. Eksik ya da fazla varsa söylerim.",
        "Yarına kasada para bırakıyorsan onu da yaz; sabah açılış parası olur."],
      ip: "Sabah kasada para varsa <b>Sabah açılış parasını yaz</b>'a bas; hesap tam tutar.", tur: "kasa" },
    { id: "veresiye", e: "📒", t: "Veresiye yazmak, ödeme almak", k: "veresiye borc defter musteri odeme al tahsilat hatirlat whatsapp",
      s: ["Satışta ödeme şekli olarak <b>Veresiye</b>'ye bas, müşteriyi seç; tutar borcuna yazılır.",
        "Müşterileri görmek için <b>Diğer İşler → Veresiye</b>. Yeni müşteri için <b>Yeni müşteri</b>.",
        "Müşteriye dokun: <b>Veresiye yaz</b> borcu artırır, <b>Ödeme al</b> düşürür.",
        "<b>Hatırlatma mesajı</b>nı kopyalayıp WhatsApp'tan gönderebilirsin."],
      ip: "Müşteri parayı eksik verdiyse satışta kalanı tek dokunuşla veresiyesine yazabilirsin.", tur: "veresiye" },
    { id: "kar", e: "📈", t: "Ne kazandığımı görmek", k: "kar zarar kazanc net brut gider ne kadar kazandim", own: true,
      s: ["Alttan <b>Kâr</b>'a bas.",
        "Üstten dönem seç: <b>Bugün</b>, <b>Bu Hafta</b>, <b>Bu Ay</b>, <b>Bu Yıl</b>.",
        "Satış − malın alış fiyatı = brüt kâr. Kasadan çıkan giderler düşülünce en altta <b>Net Kâr</b> yazar."],
      ip: "Alış fiyatı girilmemiş ürünler kâra katılmaz. Stok'ta ürüne dokunup alış fiyatını yazarsan hesap tamamlanır.", tur: "kar" },
    { id: "rapor", e: "📊", t: "Satış raporu, Excel", k: "rapor satis raporu excel indir muhasebeci gunluk aylik en cok satan", own: true,
      s: ["<b>Diğer İşler → Satış Raporları</b>'na bas.",
        "Dönemi seç; rapor hemen açılır: toplam satış, nakit/kart/veresiye, en çok satanlar.",
        "<b>Excel'e İndir</b> ile dosya olarak al, muhasebeciye gönder."], tur: "daha" },
    { id: "yedek", e: "💾", t: "Yedek almak (Excel)", k: "yedek yedekle excel aktar yukle telefon degisti geri yukle kaybolmasin", own: true,
      s: ["<b>Diğer İşler → Ayarlar</b>'a gir.",
        "<b>Yedek (Excel)</b> bölümünde <b>Excel'e aktar</b>'a bas; her şey tek dosyaya iner.",
        "Telefon değişirse aynı yerden <b>Excel'den yükle</b> ile geri getir. İki kez yüklesen de kayıtlar ikiye katlanmaz."],
      ip: "INTERNETSIZ_YEDEK", tur: "ayar" },
    { id: "kamera", e: "📷", t: "Kamerayla barkod okutmak", k: "kamera barkod okuyucu yok telefon kamerasi",
      s: ["Satış ekranında barkod kutusunun yanındaki <b>Kamera</b> düğmesine bas.",
        "İzin isterse <b>İzin ver</b> de.",
        "Telefonu barkoda tut; okununca ürün sepete girer."],
      ip: "Ürün eklerken de barkod kutusunun yanında aynı kamera düğmesi var.", tur: "satis" },
    { id: "kilo", e: "⚖️", t: "Kiloyla (tartıyla) satmak", k: "kilo tarti terazi gram peynir zeytin kiloyla",
      s: ["Ürünü eklerken en altta <b>Tartıyla satılıyor (kilo)</b>'yu işaretle; fiyat 1 kilonun fiyatı olur.",
        "Satışta ürünü seçince kaç kilo olduğunu sorarım (örn. 0,250).",
        "Terazi barkod basıyorsa o barkodu okutman da yeter."] },
    { id: "gerial", e: "↩️", t: "Yanlış yaptım, geri almak", k: "yanlis geri al sil hata iptal yanlislikla",
      s: ["Bir şeyi sildiğinde ya da kaydettiğinde altta birkaç saniye <b>Geri Al</b> çıkar; bas, eski haline döner.",
        "Yanlış satış: <b>Satış → Bugünkü Satışlar</b>'dan bul, düzelt.",
        "Kasa hareketi: <b>Kasa</b>'da <b>Bugünkü Hareketler</b>'den <b>Sil</b>."] },
    { id: "duyuru", e: "📣", t: "Mahalleye duyuru göndermek", k: "duyuru whatsapp ilan kampanya bayram cuma stok geldi mesaj paylas",
      s: ["<b>Diğer İşler → Duyuru</b>'ya bas.",
        "Hazır kartlardan birini seç: Stok Geldi, Cuma, Bayram, Kampanya…",
        "Yazıyı ve rengi istersen değiştir, <b>Paylaş</b> ile WhatsApp'a gönder."],
      ip: "DUYURU_IP" },
    { id: "bildirim", e: "🔔", t: "Bildirimleri açmak", k: "bildirim haber gelsin uyari telefona bildirim",
      s: ["<b>Diğer İşler → Bildirimler</b>'e bas.",
        "Telefon izin isterse <b>İzin ver</b> de.",
        "Ürün bitince, ödeme zamanı gelince, gün kapanınca telefona haber gelir."] },
    { id: "gorunum", e: "🌙", t: "Gece modu, büyük yazı", k: "gece modu karanlik yazi buyut gorunum tema renk okunmuyor",
      s: ["Sağ üstteki ay / güneş düğmesi tek dokunuşla gece moduna geçirir.",
        "Yazılar küçük geliyorsa <b>Diğer İşler → Ayarlar → Görünüm</b>'den büyüt."] },
    { id: "asistan", e: "✨", t: "Asistana sormak, sesli komut", k: "asistan yapay zeka sor sesli komut mikrofon konus gemini", bulut: true, yz: true, own: true,
      s: ["Alttan <b>Asistan</b>'a bas, sorunu yaz ya da 🎤 ile söyle: “Bugün ne kadar sattım?”, “Kimin borcu var?”.",
        "Satışta 🎤'ye basıp “2 ekmek, 1 süt, Ahmet'e veresiye” dersen sepete koyarım; ödemeye sen basarsın.",
        "Asistan bir şeyi değiştirmeyi önerirse sen <b>Onayla</b>'ya basmadan hiçbir şey değişmez."],
      ip: "Asistan için internet gerekir. Günlük kullanım hakkı vardır." },
    { id: "cirak", e: "🧑‍🔧", t: "Çırak (çalışan) hesabı", k: "cirak calisan yetki parola kasiyer ikinci kisi", bulut: true, own: true,
      s: ["<b>Diğer İşler → Ayarlar</b>'dan çırağına ayrı hesap aç.",
        "Çırak satış, stok sayımı, mal geldi ve veresiye yapabilir; kasa, kâr ve rapor ona kapalıdır.",
        "<b>Çırak Yetkileri</b>'nden (yetki parolanla) fiyat yazma, iade gibi işleri tek tek açabilirsin."],
      ip: "Çırak kapalı bir şey denerse sana bildirim gelir." },
    { id: "internet", e: "📶", t: "İnternet olmadan çalışır mı?", k: "internet yok cevrimdisi offline baglanti cekmiyor wifi",
      s: ["INTERNET_ADIM"] }
  ];
  const TXT = {
    INTERNETSIZ_YEDEK: () => cloud() ? "Kayıtların hesabında da durur; yine de ayda bir Excel yedeği almak iyi olur."
      : "Bu sürümde kayıtlar <b>yalnız bu telefonda</b>. Haftada bir Excel'e aktar, dosyayı WhatsApp'tan kendine gönder.",
    DUYURU_IP: () => ai() ? "<b>Kendin Anlat</b> ile ne duyurmak istediğini yaz, yapay zekâ kartı hazırlasın (internet gerekir)." : "Kartlar internetsiz hazırlanır; göndermek için WhatsApp'ın çalışması yeter.",
    INTERNET_ADIM: () => cloud()
      ? ["Evet. İnternet kesilse de satış, kasa, stok ve rehber çalışır.",
         "Yaptıkların telefonda bekler; internet gelince kendiliğinden hesabına gönderilir.",
         "Sadece <b>Asistan</b>, sesli komut ve <b>Kendin Anlat</b> internet ister."]
      : ["Evet. Bu sürüm tamamen internetsiz çalışır; hesap da gerekmez.",
         "Bütün kayıtlar bu telefonda durur. Haftada bir <b>Excel yedeği</b> al.",
         "Uygulamayı ilk kez açarken bir kere internet gerekir, sonra gerekmez."]
  };
  const steps = t => [].concat(...t.s.map(x => TXT[x] ? TXT[x]() : x));
  const tip = t => t.ip ? (TXT[t.ip] ? TXT[t.ip]() : t.ip) : "";
  const shown = t => !(t.own && staff()) && !(t.bulut && !cloud()) && !(t.yz && !ai());
  const topics = () => T.filter(shown);
  const byId = id => T.find(t => t.id === id);

  /* ---------- EKRANLAR: "Şu an buradasın" ---------- */
  const SCR = {
    "k-ana": { d: "Günün özeti. Büyük <b>Satış Yap</b> düğmesi, bugünkü satış ve kâr, Para Koy / Para Al / Mal Geldi / Ürün Ekle kutuları. Biten ürünler ve ödemesi gelen borçlar da burada çıkar.", tur: "ana", r: ["satis", "urun", "malgeldi", "kasa"] },
    satis: { d: "Barkodu okut ya da adını yaz, ürün sepete girer. Ödeme şekline basınca satış biter.", tur: "satis", r: ["satis", "kamera", "veresiye", "kilo"] },
    "k-kasa": { d: "Kasada olması gereken para, gün içindeki giriş-çıkışlar ve akşam <b>Günü Kapat</b>.", tur: "kasa", r: ["kasa", "gunkapat", "gerial"] },
    "k-stok": { d: "Bütün ürünlerin ve raftaki sayıları. − / + ile düzelt, adına dokunup düzenle.", tur: "stok", r: ["stok", "urun", "malgeldi"] },
    "k-kar": { d: "Seçtiğin dönemde satış, malın maliyeti, giderler ve sonunda net kâr.", tur: "kar", r: ["kar", "rapor"] },
    "k-daha": { d: "Veresiye, tedarikçiler, raporlar, duyuru, bildirimler ve ayarlar buradan açılır.", tur: "daha", r: ["veresiye", "malgeldi", "duyuru", "yedek"] },
    "k-urun": { d: "Ürün formu: 1) barkod 2) ad 3) fiyat 4) raftaki sayı. Sonra Kaydet.", tur: "urunForm", r: ["urun", "kamera", "kilo"] },
    veresiye: { d: "Kimin ne kadar borcu var. Müşteriye dokunup veresiye yaz ya da ödeme al.", tur: "veresiye", r: ["veresiye"] },
    tedarik: { d: "Toptancıya, fırına, süt bayisine ne kadar borçlusun; mal geldi ve ödeme kayıtları.", r: ["malgeldi"] },
    rapor: { d: "Dönem seç; satış, ödeme şekilleri ve en çok satanlar görünür. Excel'e indirebilirsin.", r: ["rapor", "yedek"] },
    hareket: { d: "Stokta kim, ne zaman, neyi değiştirdi: satış, mal geldi, sayım.", r: ["stok"] },
    duyuru: { d: "Hazır duyuru kartları: seç, istersen düzenle, WhatsApp'a gönder.", r: ["duyuru"] },
    sor: { d: "Dükkânınla ilgili soruyu yaz ya da söyle; yapay zekâ defterine bakıp cevaplar.", r: ["asistan"] },
    ayarlar: { d: "Dükkân adı, görünüm (gece modu, büyük yazı) ve <b>Excel yedeği</b>.", tur: "ayar", r: ["yedek", "gorunum", "cirak"] }
  };

  /* ---------- TURLAR: "Bana Göster" ----------
     go: önce gidilecek ekran ("yeni" = boş ürün formu), q: parlatılacak yer, t: anlatım,
     opt: bulunamazsa atla, tap: "şimdi sen bas" adımı (basınca kendiliğinden ilerler) */
  const TOURS = {
    tanitim: [
      { go: "k-ana", q: NAV("k-ana"), t: "<b>Ana Sayfa</b>: günün özeti. Bugün ne sattın, ne kazandın, neler bitiyor, hepsi burada." },
      { q: ".kwelcome .kcta", opt: 1, t: "İlk iş: ürünlerini ekle. En çok sattığın 10-20 ürünle başlaman yeter." },
      { q: ".ksell", opt: 1, t: "En önemli düğme: <b>Satış Yap</b>. Müşteri gelince buna basarsın." },
      { q: NAV("satis"), t: "<b>Satış</b>: barkodu okut, ürün sepete girer, <b>Nakit</b> / <b>Kart</b> / <b>Veresiye</b>'ye bas. Bu kadar." },
      { q: NAV("k-kasa"), opt: 1, t: "<b>Kasa</b>: kasada ne kadar para olmalı? Para koy, para al, akşam günü kapat." },
      { q: NAV("k-stok"), opt: 1, t: "<b>Stok</b>: rafta ne kaldı? Yanlışsa − / + ile düzelt. Yeni ürün de buradan eklenir." },
      { q: NAV("k-kar"), opt: 1, t: "<b>Kâr</b>: bugün, bu hafta, bu ay gerçekte ne kazandın." },
      { q: NAV("sor"), opt: 1, t: "<b>Asistan</b> (internet ister): “Bugün ne kadar sattım?” diye sor, cevaplasın." },
      { q: ".kother", opt: 1, t: "<b>Diğer İşler</b>: veresiye, tedarikçiler, raporlar, duyuru ve ayarlar." },
      { q: "#guideBtn", t: "Takılırsan sağ üstteki <b>Rehber</b>'e bas. Her ekranı anlatırım, istersen parmağınla göstereyim. İnternet olmasa da çalışırım. 👋" }
    ],
    ana: [
      { go: "k-ana", q: ".ksell", opt: 1, t: "Müşteri gelince <b>Satış Yap</b>." },
      { q: ".kwelcome .kcta", opt: 1, t: "Önce ürünlerini ekle; sonra burası günün özetini gösterir." },
      { q: ".ktoday", opt: 1, t: "Bugün ne kadar sattın, ne kadar kâr kaldı. Dokunursan Kâr ekranı açılır." },
      { q: ".kgrid.k4", opt: 1, t: "Sık işler tek dokunuşta: <b>Para Koy</b>, <b>Para Al</b>, <b>Mal Geldi</b>, <b>Ürün Ekle</b>." },
      { q: ".kdue", opt: 1, t: "Vadesi gelen toptancı borçları burada çıkar." },
      { q: ".kother", opt: 1, t: "Geri kalan her şey <b>Diğer İşler</b>'de." }
    ],
    satis: [
      { go: "satis", q: "#pos-scan", t: "Barkodu okut ya da ürünün adını yaz. Ürün hemen sepete girer. Aynı üründen 3 tane: <b>3*barkod</b>." },
      { q: '.camBtn[data-for="pos"]', opt: 1, t: "Barkod okuyucun yoksa <b>Kamera</b>'ya bas, telefonu barkoda tut." },
      { q: "#pos-given", opt: 1, t: "Müşteri ne verdiyse yaz ya da hazır tutara bas; para üstünü söylerim." },
      { q: ".pay.p-nakit", opt: 1, t: "Sepet hazır olunca ödeme şekline bas: <b>Nakit</b>, <b>Kart</b> ya da <b>Veresiye</b>. Satış kaydedilir, stok düşer." },
      { q: '[data-act="posView"][data-v="liste"]', opt: 1, t: "<b>Bugünkü Satışlar</b>: yaptığın satışları gör; yanlış satışı buradan düzelt." }
    ],
    urun: [
      { go: "k-stok", q: '.ktwo [data-act="kEdit"], .kcta[data-act="kEdit"]', opt: 1, tap: 1, t: "Yeni ürün için <b>Ürün Ekle</b>'ye bas. Hadi, şimdi sen dokun 👆" },
      { go: "yeni", q: "#ku-bc", t: "<b>1.</b> Barkodu okut. Barkodu yoksa boş bırak." },
      { q: "#ku-name", t: "<b>2.</b> Ürünün adını yaz. Aynı isimde ürün varsa söylerim, iki tane olmaz." },
      { q: ".kuprices", t: "<b>3.</b> Satış fiyatı şart. Alış fiyatını da yazarsan kârını hesaplarım. Kuruş için virgül: 12,50." },
      { q: ".kustepper", t: "<b>4.</b> Rafta kaç tane var? − / + ile ayarla. Tartılı ürünse altındaki <b>kilo</b> düğmesini aç." },
      { q: ".kusave", t: "Bitti, <b>Kaydet</b>. Çok ürün gireceksen <b>Kaydet + Yeni</b>." }
    ],
    urunForm: [
      { go: "yeni", q: "#ku-bc", t: "<b>1.</b> Barkodu okut. Barkodu yoksa boş bırak." },
      { q: "#ku-name", t: "<b>2.</b> Ürünün adını yaz." },
      { q: ".kuprices", t: "<b>3.</b> Satış fiyatı şart, alış fiyatı kâr için." },
      { q: ".kustepper", t: "<b>4.</b> Rafta kaç tane var?" },
      { q: ".kusave", t: "<b>Kaydet</b>." }
    ],
    stok: [
      { go: "k-stok", q: ".ktwo", opt: 1, t: "Yeni ürün için <b>Ürün Ekle</b>, toptancıdan mal gelince <b>Mal Geldi</b>." },
      { q: "#k-q", opt: 1, t: "Ürünü adıyla ara." },
      { q: ".fchips", opt: 1, t: "<b>Azalan</b> ve <b>Biten</b> ürünleri tek dokunuşla süz." },
      { q: "#k-list .kitem .pstep", opt: 1, t: "Raftaki sayı yanlışsa <b>−</b> / <b>+</b>. 1 saniye sonra kendiliğinden kaydedilir." },
      { q: "#k-list .kitem .kn", opt: 1, t: "Ürünün adına dokun: fiyat, barkod, alış fiyatı ya da silme." },
      { q: ".kwelcome .kcta", opt: 1, t: "Henüz ürün yok. Buradan ilk ürününü ekle." }
    ],
    kasa: [
      { go: "k-kasa", q: ".kcash", t: "Kasada şu an <b>olması gereken</b> para: açılış + nakit satış + giren − çıkan." },
      { q: '.ktile[data-f="giris"]', opt: 1, t: "<b>Para Koy</b>: kasaya para eklediğinde." },
      { q: '.ktile[data-f="cikis"]', opt: 1, t: "<b>Para Al</b>: kasadan para çıkınca. Sebebini seç (toptancı, fatura, kira…). Toptancıyı seçersen borcundan düşer." },
      { q: '.ktile[data-f="kapanis"]', opt: 1, t: "Akşam <b>Günü Kapat</b>: kasadaki parayı say, yaz. Eksik ya da fazlayı söylerim." },
      { q: 'button.link[data-act="kKasa"][data-f="acilis"]', opt: 1, t: "Sabah kasada para varsa <b>açılış parasını</b> yaz; hesap tam tutar." }
    ],
    kar: [
      { go: "k-kar", q: ".kper", t: "Dönemi seç: <b>Bugün</b>, <b>Bu Hafta</b>, <b>Bu Ay</b>, <b>Bu Yıl</b>." },
      { q: ".kpl", opt: 1, wait: 2500, t: "Satış − malın alış fiyatı = brüt kâr. Sonra kasadan çıkan giderler düşülür." },
      { q: ".knet", opt: 1, t: "En alttaki rakam <b>gerçekten kazandığın</b> para." },
      { q: '[data-act="rpXlsx"]', opt: 1, t: "<b>Excel'e İndir</b>: muhasebeciye göndermek için." }
    ],
    veresiye: [
      { go: "veresiye", q: ".balbox", opt: 1, t: "Toplam alacağın: herkesin borcu bir arada." },
      { q: '[data-act="vNew"]', opt: 1, t: "<b>Yeni müşteri</b>: adını yaz; istersen telefonu ve borç sınırı." },
      { q: "#clist .ccard", opt: 1, t: "Müşteriye dokun: <b>Veresiye yaz</b> borcu artırır, <b>Ödeme al</b> düşürür." }
    ],
    malgeldi: [
      { go: "k-ana", q: '.ktile[data-act="supMal"]', opt: 1, t: "Toptancıdan mal gelince <b>Mal Geldi</b>: kimden, kaç tane, kaça. Stok artar, borç yazılır." },
      { go: "tedarik", q: "#view", t: "<b>Tedarikçiler</b>: kime ne kadar borcun var, ne aldın, ne ödedin. Ödeme yapınca buradan kaydet." }
    ],
    daha: [
      { go: "k-daha", q: '#view [data-act="goRapor"]', opt: 1, t: "<b>Satış Raporları</b>: dönem seç, Excel'e indir." },
      { q: '#view [data-tab="veresiye"]', opt: 1, t: "<b>Veresiye</b>: kim ne kadar borçlu." },
      { q: '#view [data-tab="tedarik"]', opt: 1, t: "<b>Tedarikçiler</b>: senin toptancılara borcun." },
      { q: '#view [data-tab="duyuru"]', opt: 1, t: "<b>Duyuru</b>: mahalleye WhatsApp kartı." },
      { q: '#view [data-act="nGo"]', opt: 1, t: "<b>Bildirimler</b>: ürün bitince, ödeme zamanı gelince telefona haber." },
      { q: '#view [data-tab="ayarlar"]', opt: 1, t: "<b>Ayarlar</b>: görünüm ve <b>Excel yedeği</b>." }
    ],
    ayar: [
      { go: "ayarlar", q: '[data-act="themeSet"]', opt: 1, t: "<b>Görünüm</b>: gece modu ya da gündüz." },
      { q: '[data-act="export"]', opt: 1, t: "<b>Excel'e aktar</b>: bütün kayıtların yedeği tek dosyada. Düzenli yedek al." }
    ]
  };
  const tourFor = id => (id === "urun" && A.tab() === "k-urun") ? "urunForm" : id;

  /* ---------- görünüm (stil) ---------- */
  const css = `
#rh-back{position:fixed;inset:0;background:rgba(10,14,12,.45);z-index:950;opacity:0;transition:opacity .2s}
#rh-back.on{opacity:1}
#rh-panel{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:620px;max-height:90vh;overflow:auto;overscroll-behavior:contain;
  background:var(--bg);color:var(--ink);border-radius:22px 22px 0 0;z-index:951;box-shadow:0 -10px 40px rgba(0,0,0,.25);
  transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1);padding:6px 16px calc(18px + env(safe-area-inset-bottom,0px));font-size:17px}
#rh-panel.on{transform:none}
#rh-panel .rh-grab{width:46px;height:5px;border-radius:9px;background:var(--line);margin:4px auto 8px}
#rh-panel h2{margin:0;font-size:22px}
#rh-panel .rh-top{display:flex;align-items:center;gap:8px;position:sticky;top:-6px;background:var(--bg);padding:6px 0 8px;z-index:2}
#rh-panel .rh-top h2{flex:1;display:flex;align-items:center;gap:8px}
#rh-panel .rh-ib{min-width:46px;min-height:46px;padding:0;font-size:20px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center}
#rh-panel .rh-ib[aria-pressed="true"]{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.rh-net{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:4px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-weight:600}
.rh-net.off{background:var(--warn-soft,#fdf1dc);color:var(--warn,#9a5b00)}
.rh-net i{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block}
.rh-search{display:flex;flex-direction:row;gap:8px;color:var(--ink);font-size:18px;align-items:center;background:var(--card);border:2px solid var(--line);border-radius:14px;padding:4px 6px 4px 12px;margin:10px 0 4px}
.rh-search:focus-within{border-color:var(--accent)}
.rh-search input{flex:1;border:0;background:none;font-size:18px;padding:10px 0;outline:none;width:auto}
.rh-search input:focus-visible{outline:none}
.rh-search button{min-height:44px;min-width:44px;padding:0;border:0;background:var(--accent-soft);color:var(--accent);font-size:20px;border-radius:10px}
.rh-sec{margin:16px 0 8px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.rh-here{background:var(--card);border:2px solid var(--accent);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px}
.rh-here .rh-lbl{font-size:13px;color:var(--accent);font-weight:700}
.rh-here h3{all:unset;font-size:20px;font-weight:700}
.rh-here p{margin:0;line-height:1.5}
.rh-show{display:flex;align-items:center;justify-content:center;gap:10px;font-size:18px;font-weight:700;min-height:56px;border-radius:14px;
  background:var(--accent);color:var(--accent-ink);border:0;width:100%}
.rh-show .rh-pl{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.25);display:inline-flex;align-items:center;justify-content:center;font-size:14px}
.rh-chips{display:flex;flex-wrap:wrap;gap:8px}
.rh-chip{min-height:40px;padding:6px 12px;border-radius:999px;font-size:15px;background:var(--bg)}
.rh-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rh-t{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;padding:12px;border-radius:14px;min-height:96px;background:var(--card);font-size:16px;font-weight:600;line-height:1.25}
.rh-t .rh-e{font-size:26px;line-height:1}
.rh-t.done::after{content:"✓";position:absolute;top:8px;right:10px;width:24px;height:24px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-size:14px;display:flex;align-items:center;justify-content:center}
.rh-prog{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--muted);margin:14px 0 4px}
.rh-prog span.b{flex:1;height:10px;border-radius:9px;background:var(--line);overflow:hidden}
.rh-prog span.b i{display:block;height:100%;background:var(--accent);border-radius:9px;transition:width .4s}
.rh-ai{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;margin-top:12px}
.rh-ai .rh-e{font-size:28px}
.rh-ai p{margin:2px 0 0;font-size:14px;color:var(--muted)}
.rh-res{display:flex;flex-direction:column;gap:8px}
.rh-r{display:flex;align-items:center;gap:12px;text-align:left;padding:10px 12px;border-radius:14px;background:var(--card);font-size:17px;min-height:58px}
.rh-r .rh-e{font-size:24px}
.rh-r small{display:block;color:var(--muted);font-size:13px;font-weight:400}
.rh-r.ask{border:2px solid var(--accent)}
.rh-steps{list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:10px;counter-reset:s}
.rh-steps li{counter-increment:s;display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;line-height:1.45}
.rh-steps li::before{content:counter(s);flex:none;width:32px;height:32px;border-radius:50%;background:var(--accent);color:var(--accent-ink);font-weight:700;display:flex;align-items:center;justify-content:center}
.rh-steps li.rd{outline:3px solid var(--accent);outline-offset:1px}
.rh-tip{display:flex;gap:10px;background:var(--accent-soft);color:var(--ink);border-radius:14px;padding:12px;line-height:1.45;font-size:16px}
.rh-acts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.rh-acts button{min-height:52px;font-weight:600}
.rh-acts .full{grid-column:1/-1}
.rh-ok{background:var(--accent-soft)!important;color:var(--accent)!important;border-color:var(--accent)!important}
.rh-foot{display:flex;flex-direction:column;gap:8px;margin-top:16px}
.rh-foot button{min-height:52px}
.rh-empty{padding:12px;border-radius:14px;background:var(--card);border:1px dashed var(--line);color:var(--muted)}
/* tur */
#rh-tour{position:fixed;inset:0;z-index:960;pointer-events:none}
#rh-tour .m{position:fixed;background:rgba(8,12,10,.62);pointer-events:auto;transition:all .25s ease}
#rh-tour .ring{position:fixed;border:3px solid #ffd54a;border-radius:14px;box-shadow:0 0 0 4px rgba(255,213,74,.35);pointer-events:none;transition:all .25s ease;animation:rhp 1.4s ease-in-out infinite}
#rh-tour .hit{position:fixed;pointer-events:auto;cursor:pointer;border-radius:14px}
#rh-tour .hit.pass{pointer-events:none}
@keyframes rhp{0%,100%{box-shadow:0 0 0 4px rgba(255,213,74,.35)}50%{box-shadow:0 0 0 12px rgba(255,213,74,.12)}}
#rh-tour .bub{position:fixed;left:12px;width:min(360px,calc(100vw - 24px));background:var(--card);color:var(--ink);border-radius:18px;padding:14px;
  box-shadow:0 12px 40px rgba(0,0,0,.35);pointer-events:auto;font-size:18px;line-height:1.45;transition:top .25s ease,left .25s ease}
#rh-tour .bub .hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
#rh-tour .bub .ct{font-size:13px;font-weight:700;color:var(--accent);letter-spacing:.04em}
#rh-tour .bub .dots{display:flex;gap:4px}
#rh-tour .bub .dots i{width:8px;height:8px;border-radius:50%;background:var(--line)}
#rh-tour .bub .dots i.on{background:var(--accent)}
#rh-tour .bub .x{min-height:40px;min-width:40px;padding:0;border:0;background:none;font-size:20px;color:var(--muted)}
#rh-tour .bub .tp{margin:8px 0 0;font-size:15px;font-weight:700;color:#b07800}
#rh-tour .bub .bt{display:flex;gap:8px;margin-top:12px}
#rh-tour .bub .bt button{flex:1;min-height:50px;font-weight:700}
#rh-tour .bub .snd{flex:0 0 50px!important;font-size:20px;padding:0}
#guideBtn.rh-new{position:relative}
#guideBtn.rh-new::after{content:"";position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;background:#e8590c;box-shadow:0 0 0 0 rgba(232,89,12,.6);animation:rhd 1.6s infinite}
@keyframes rhd{0%{box-shadow:0 0 0 0 rgba(232,89,12,.6)}70%{box-shadow:0 0 0 10px rgba(232,89,12,0)}100%{box-shadow:0 0 0 0 rgba(232,89,12,0)}}
@media (prefers-reduced-motion:reduce){#rh-panel,#rh-back,#rh-tour .m,#rh-tour .ring,#rh-tour .bub{transition:none!important;animation:none!important}}
`;
  const st = document.createElement("style"); st.id = "rh-css"; st.textContent = css; document.head.appendChild(st);

  /* ---------- sesli anlatım (telefonun kendi sesi; internet gerekmez) ---------- */
  const TTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let voice = null;
  const pickVoice = () => { try { const v = speechSynthesis.getVoices(); voice = v.find(x => /^tr/i.test(x.lang) && x.localService) || v.find(x => /^tr/i.test(x.lang)) || null; } catch (_) {} };
  if (TTS) { pickVoice(); try { speechSynthesis.addEventListener("voiceschanged", pickVoice); } catch (_) {} }
  const sesOn = () => TTS && !!get("ses", false);
  function say(html, onEnd) {
    if (!TTS) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(plain(html).replace(/−/g, " eksi ").replace(/\//g, " ya da ").replace(/\+/g, " artı "));
      u.lang = "tr-TR"; u.rate = 0.95; if (voice) u.voice = voice;
      if (onEnd) u.onend = onEnd;
      speechSynthesis.speak(u);
    } catch (_) {}
  }
  const hush = () => { try { TTS && speechSynthesis.cancel(); } catch (_) {} };

  /* ---------- sesle arama (tarayıcı destekliyorsa; çoğu telefonda internet ister) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* ---------- arama: internetsiz, telefonda ---------- */
  const DATA_Q = /\b(ne kadar|kac|kim|kimin|hangi|bugun|dun|bu hafta|bu ay|sattim|satmisim|kazandim|borclu|en cok|en karli|toplam)\b/;
  const HOW_Q = /\b(nasil|nereden|nerede|ne ise|neden|niye|yapilir|eklerim|yaparim|acarim|alirim|silerim|ogren)\b/;
  function search(q) {
    const n = norm(q); if (n.length < 2) return [];
    const words = n.split(" ").filter(w => w.length > 1);
    const L = topics().map(t => {
      const ti = norm(t.t), kw = norm(t.k), body = norm(steps(t).join(" ") + " " + tip(t));
      let sc = 0;
      for (const w of words) {
        const stem = w.length > 4 ? w.slice(0, w.length - 2) : w;   // Türkçe ekleri kabaca at: "veresiyeye" → "veresiy"
        if (ti.includes(stem)) sc += 4;
        if (kw.split(" ").some(k => k.startsWith(stem) || (k.length > 3 && stem.startsWith(k)))) sc += 3;
        else if (body.includes(stem)) sc += 1;
      }
      return { t, sc };
    }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
    return L.slice(0, 5).map(x => x.t);
  }

  /* ---------- panel ---------- */
  let P = null, view = { k: "home" }, lastQ = "";
  const learned = () => get("ogrendim", []);
  function learn(id) { const L = learned(); if (!L.includes(id)) { L.push(id); put("ogrendim", L); } }

  function netPill() {
    if (!cloud()) return `<span class="rh-net"><i></i>İnternetsiz sürüm · her şey telefonda</span>`;
    return online() ? `<span class="rh-net"><i></i>İnternet var</span>`
      : `<span class="rh-net off"><i></i>İnternet yok · Rehber yine çalışır</span>`;
  }
  function tile(t) {
    return `<button class="rh-t ${learned().includes(t.id) ? "done" : ""}" data-rh="topic" data-id="${t.id}"><span class="rh-e">${t.e}</span>${esc(t.t)}</button>`;
  }
  function aiCard(q) {
    if (!ai()) return "";
    if (!online()) return `<div class="rh-ai"><span class="rh-e">✨</span><div><b>Asistan</b><p>İnternet gelince “Bugün ne kadar sattım?” gibi soruları da cevaplarım.</p></div></div>`;
    return `<button class="rh-ai" data-rh="ask" data-q="${esc(q || "")}" style="width:100%;text-align:left"><span class="rh-e">✨</span><span><b>${q ? "Asistana sor: “" + esc(q) + "”" : "Dükkânınla ilgili bir soru mu?"}</b><p>${q ? "Rakamlara bakıp cevaplar." : "“Bugün ne kadar sattım?”, “Kimin borcu var?” → Asistan cevaplar."}</p></span></button>`;
  }

  function homeHtml() {
    const tab = A.tab(), sc = SCR[tab], L = topics(), done = L.filter(t => learned().includes(t.id)).length;
    const pct = L.length ? Math.round(100 * done / L.length) : 0;
    let h = `<label class="rh-search"><span aria-hidden="true">🔎</span><input id="rh-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Ne yapmak istiyorsun?" value="${esc(lastQ)}" aria-label="Rehberde ara">${SR && online() ? `<button type="button" data-rh="mic" aria-label="Sesle sor">🎤</button>` : ""}</label>
      <div id="rh-results"></div><div id="rh-main">`;
    if (sc) {
      h += `<p class="rh-sec">Şu an buradasın</p><section class="rh-here"><span class="rh-lbl">📍 ${esc(A.title(tab) || "Bu ekran")}</span><p>${sc.d}</p>
        ${sc.tur ? `<button class="rh-show" data-rh="tour" data-tour="${sc.tur}"><span class="rh-pl">▶</span>Bu ekranı bana göster</button>` : ""}
        <div class="rh-chips">${sc.r.map(byId).filter(t => t && shown(t)).map(t => `<button class="rh-chip" data-rh="topic" data-id="${t.id}">${t.e} ${esc(t.t)}</button>`).join("")}</div></section>`;
    }
    h += `<p class="rh-sec">Ne yapmak istiyorsun?</p><div class="rh-grid">${L.map(tile).join("")}</div>
      <div class="rh-prog"><span>Öğrendiklerin ${done} / ${L.length}</span><span class="b"><i style="width:${pct}%"></i></span>${done === L.length && L.length ? "<span>🎉</span>" : ""}</div>
      ${aiCard("")}
      <div class="rh-foot"><button class="primary" data-rh="tour" data-tour="tanitim">▶ Uygulamayı baştan tanıt (1 dakika)</button></div></div>`;
    return h;
  }
  function topicHtml(id) {
    const t = byId(id); if (!t) return homeHtml();
    const ss = steps(t), ip = tip(t), rel = T.filter(x => x.id !== id && shown(x) && (SCR[A.tab()]?.r || []).includes(x.id)).slice(0, 3);
    return `<button class="link" data-rh="home" style="margin:4px 0 8px">← Bütün konular</button>
      <h2 style="display:flex;gap:10px;align-items:center"><span style="font-size:32px">${t.e}</span>${esc(t.t)}</h2>
      <ol class="rh-steps" id="rh-steps">${ss.map(s => `<li><span>${s}</span></li>`).join("")}</ol>
      ${ip ? `<div class="rh-tip"><span aria-hidden="true">💡</span><span>${ip}</span></div>` : ""}
      <div class="rh-acts">
        ${t.tur ? `<button class="primary full rh-show" data-rh="tour" data-tour="${tourFor(t.tur)}" data-learn="${t.id}"><span class="rh-pl">▶</span>Bana göster</button>` : ""}
        ${TTS ? `<button data-rh="read" data-id="${t.id}">🔊 Sesli oku</button>` : ""}
        <button class="${learned().includes(t.id) ? "rh-ok" : ""}" data-rh="learn" data-id="${t.id}" ${TTS ? "" : 'style="grid-column:1/-1"'}>${learned().includes(t.id) ? "✓ Öğrendim" : "Anladım ✓"}</button>
      </div>
      ${t.yz || t.id === "asistan" ? "" : aiCard("")}
      ${rel.length ? `<p class="rh-sec">Bunlar da işine yarar</p><div class="rh-chips">${rel.map(x => `<button class="rh-chip" data-rh="topic" data-id="${x.id}">${x.e} ${esc(x.t)}</button>`).join("")}</div>` : ""}`;
  }
  function resultsHtml(q) {
    const n = norm(q); if (n.length < 2) return "";
    const L = search(q), dataQ = DATA_Q.test(n) && !HOW_Q.test(n);
    let h = `<div class="rh-res">`;
    if (dataQ && ai() && online()) h += `<button class="rh-r ask" data-rh="ask" data-q="${esc(q)}"><span class="rh-e">✨</span><span>Asistana sor<small>“${esc(q)}”: dükkânının rakamlarına bakıp cevaplar</small></span></button>`;
    h += L.map(t => `<button class="rh-r" data-rh="topic" data-id="${t.id}"><span class="rh-e">${t.e}</span><span>${esc(t.t)}<small>${plain(steps(t)[0]).slice(0, 70)}…</small></span></button>`).join("");
    if (!L.length) h += `<div class="rh-empty">“${esc(q)}” için bir şey bulamadım. Başka kelimeyle dene (örn. <b>satış</b>, <b>veresiye</b>, <b>yedek</b>) ya da aşağıdan seç.</div>`
      + (dataQ || !ai() ? "" : aiCard(q));
    return h + `</div>`;
  }

  function paint() {
    if (!P) return;
    const body = P.querySelector(".rh-body");
    body.innerHTML = view.k === "topic" ? topicHtml(view.id) : homeHtml();
    P.querySelector(".rh-net-w").innerHTML = netPill();
    const snd = P.querySelector('[data-rh="snd"]'); if (snd) { snd.setAttribute("aria-pressed", sesOn() ? "true" : "false"); snd.textContent = sesOn() ? "🔊" : "🔈"; }
    if (view.k === "home" && lastQ) doSearch(lastQ);
  }
  function doSearch(q) {
    lastQ = q;
    const r = P && P.querySelector("#rh-results"), m = P && P.querySelector("#rh-main");
    if (!r) return;
    r.innerHTML = resultsHtml(q);
    if (m) m.hidden = norm(q).length >= 2;
  }
  function open(id) {
    hush(); endTour(true);
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch (_) {}
    view = id ? { k: "topic", id } : { k: "home" };
    put("acildi", 1); document.getElementById("guideBtn")?.classList.remove("rh-new");
    if (!P) {
      const b = document.createElement("div"); b.id = "rh-back"; b.dataset.rh = "close";
      P = document.createElement("section"); P.id = "rh-panel"; P.setAttribute("role", "dialog"); P.setAttribute("aria-modal", "true"); P.setAttribute("aria-label", "Rehber");
      P.innerHTML = `<div class="rh-grab"></div><div class="rh-top"><h2>🧭 Rehber</h2>${TTS ? `<button class="rh-ib" data-rh="snd" aria-pressed="false" aria-label="Sesli anlatım" title="Sesli anlatım">🔈</button>` : ""}<button class="rh-ib" data-rh="close" aria-label="Kapat">✕</button></div>
        <div class="rh-net-w"></div><div class="rh-body"></div>`;
      document.body.append(b, P);
      requestAnimationFrame(() => { b.classList.add("on"); P.classList.add("on"); });
      document.documentElement.style.overflow = "hidden";
    }
    paint(); P.scrollTop = 0;
    if (view.k === "topic" && sesOn()) readTopic(view.id);
  }
  function close() {
    hush(); if (!P) return;
    const p = P, b = document.getElementById("rh-back"); P = null;
    p.classList.remove("on"); b && b.classList.remove("on");
    document.documentElement.style.overflow = "";
    setTimeout(() => { p.remove(); b && b.remove(); }, 280);
  }
  function readTopic(id) {
    const t = byId(id); if (!t) return;
    const ss = steps(t), lis = P ? P.querySelectorAll("#rh-steps li") : [];
    let i = 0;
    const next = () => {
      lis.forEach((l, j) => l.classList.toggle("rd", j === i));
      if (i < ss.length) { const tx = (i === 0 ? t.t + ". " : "") + ss[i]; i++; say(tx, next); }
      else { lis.forEach(l => l.classList.remove("rd")); if (tip(t)) say("İpucu: " + tip(t)); }
    };
    next();
  }

  /* ---------- tur (parmakla gösterme) ---------- */
  let TR = null;   // {steps, i, el, raf, learnId}
  function tourStart(name, learnId) {
    let S = (TOURS[name] || []).slice();
    if (!S.length) return;
    close(); hush(); endTour(true);
    TR = { steps: S, i: -1, el: null, learnId, name, seq: 0, seen: new Set() };
    const w = document.createElement("div"); w.id = "rh-tour";
    w.innerHTML = `<div class="m"></div><div class="m"></div><div class="m"></div><div class="m"></div><div class="ring"></div><div class="hit"></div><div class="bub" role="dialog" aria-live="polite"></div>`;
    document.body.appendChild(w); TR.w = w;
    w.querySelectorAll(".m").forEach(m => m.addEventListener("click", e => { e.stopPropagation(); }));
    w.querySelector(".hit").addEventListener("click", e => { e.stopPropagation(); tourGo(1); });
    tourGo(1);
    loop();
  }
  const visible = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden"; };
  const find = q => { for (const el of document.querySelectorAll(q)) if (visible(el)) return el; return null; };
  function navTo(go) {
    if (!go || A.tab() === go && go !== "yeni") return false;
    if (go === "yeni") { if (A.tab() !== "k-urun") A.newProduct(); else return false; }
    else A.go(go);
    // ekran açılınca klavye çıkmasın (tur sırasında yazı kutusu odaklanmasın)
    const bl = () => { try { const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) a.blur(); } catch (_) {} };
    [0, 60, 200, 400].forEach(t => setTimeout(bl, t));
    return true;
  }
  async function tourGo(d) {
    if (!TR) return;
    const my = ++TR.seq;
    let i = TR.i + d;
    while (i >= 0 && i < TR.steps.length) {
      const s = TR.steps[i];
      const moved = navTo(s.go);
      const lim = Date.now() + (s.wait || (moved ? 1400 : 120));
      let el = find(s.q);
      while (!el && Date.now() < lim) { await new Promise(r => setTimeout(r, 80)); if (!TR || TR.seq !== my) return; el = find(s.q); }
      if (el || !s.opt) { TR.i = i; TR.el = el; break; }
      i += d < 0 ? -1 : 1;
    }
    if (!TR || TR.seq !== my) return;
    if (i >= TR.steps.length) return endTour(false, true);
    if (i < 0) { if (TR.i < 0) return endTour(); return; }
    const s = TR.steps[TR.i], el = TR.el;
    if (el) { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) { el.scrollIntoView(); } }
    const may = x => !x.opt || x.go || x.wait || find(x.q);
    const real = TR.steps.map((x, j) => j).filter(j => j <= TR.i ? (j === TR.i || !TR.steps[j].opt || TR.seen.has(j)) : may(TR.steps[j]));
    TR.seen.add(TR.i);
    const pos = real.indexOf(TR.i) + 1, tot = real.length, last = !TR.steps.slice(TR.i + 1).some(may);
    const b = TR.w.querySelector(".bub");
    b.innerHTML = `<div class="hd"><span class="ct">ADIM ${pos} / ${tot}</span><span class="dots">${real.map(j => `<i class="${j === TR.i ? "on" : ""}"></i>`).join("")}</span><button class="x" data-tr="x" aria-label="Turu kapat">✕</button></div>
      <div>${s.t}</div>${s.tap && el ? `<p class="tp">👆 Parlayan yere dokun</p>` : ""}
      <div class="bt">${TTS ? `<button class="snd" data-tr="snd" aria-label="Sesli oku">${sesOn() ? "🔊" : "🔈"}</button>` : ""}${pos > 1 ? `<button data-tr="prev">← Geri</button>` : ""}<button class="primary" data-tr="next">${last ? "Bitir ✓" : "İleri →"}</button></div>`;
    TR.w.querySelector(".hit").classList.toggle("pass", !!(s.tap && el));
    if (sesOn()) say(s.t);
    place();
    setTimeout(() => b.querySelector('[data-tr="next"]')?.focus({ preventScroll: true }), 50);
  }
  function place() {
    if (!TR) return;
    const s = TR.steps[TR.i]; if (!s) return;
    if (TR.el && !TR.el.isConnected) TR.el = find(s.q);   // uygulama ekranı yeniden çizdiyse aynı yeri tekrar bul
    const W = innerWidth, H = innerHeight, [mt, mb, ml, mr] = TR.w.querySelectorAll(".m"), ring = TR.w.querySelector(".ring"), hit = TR.w.querySelector(".hit"), b = TR.w.querySelector(".bub");
    const set = (e, x, y, w, h) => { e.style.left = x + "px"; e.style.top = y + "px"; e.style.width = Math.max(0, w) + "px"; e.style.height = Math.max(0, h) + "px"; };
    const bh = b.offsetHeight || 160, bw = b.offsetWidth || 340;
    if (!TR.el) {
      set(mt, 0, 0, W, H); set(mb, 0, 0, 0, 0); set(ml, 0, 0, 0, 0); set(mr, 0, 0, 0, 0);
      ring.style.display = hit.style.display = "none";
      b.style.top = Math.max(12, (H - bh) / 2) + "px"; b.style.left = Math.max(12, (W - bw) / 2) + "px"; return;
    }
    ring.style.display = hit.style.display = "";
    const r = TR.el.getBoundingClientRect(), p = 6;
    let x = Math.max(4, r.left - p), y = Math.max(4, r.top - p), x2 = Math.min(W - 4, r.right + p), y2 = Math.min(H - 4, r.bottom + p);
    set(mt, 0, 0, W, y); set(mb, 0, y2, W, H - y2); set(ml, 0, y, x, y2 - y); set(mr, x2, y, W - x2, y2 - y);
    set(ring, x, y, x2 - x, y2 - y); set(hit, x, y, x2 - x, y2 - y);
    const below = H - y2, above = y;
    let top = below >= bh + 16 ? y2 + 12 : above >= bh + 16 ? y - bh - 12 : Math.max(12, H - bh - 12);
    // hedef çok büyükse (ekranın çoğu) balonu alta sabitle
    if (y2 - y > H * 0.6) top = H - bh - 16;
    b.style.top = Math.round(Math.min(Math.max(12, top), H - bh - 8)) + "px";
    b.style.left = Math.round(Math.min(Math.max(12, (x + x2) / 2 - bw / 2), W - bw - 12)) + "px";
  }
  function loop() { if (!TR) return; place(); TR.raf = requestAnimationFrame(loop); }
  function endTour(silent, finished) {
    if (!TR) return;
    const t = TR; TR = null; cancelAnimationFrame(t.raf); t.w.remove(); hush();
    if (finished) {
      if (t.learnId) learn(t.learnId);
      if (t.name === "tanitim") put("tanitim", 1);
      if (!silent) toast(t.name === "tanitim" ? "Tanıtım bitti. Takılırsan sağ üstteki Rehber'e bas. 👋" : "Tamam! Takılırsan Rehber hep burada.");
    }
  }
  function toast(msg) {
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--navh,58px) + 16px);z-index:970;background:var(--ink);color:var(--bg);padding:12px 16px;border-radius:14px;font-size:16px;max-width:calc(100vw - 32px);box-shadow:0 8px 24px rgba(0,0,0,.3)";
    el.textContent = msg; document.body.appendChild(el);
    if (sesOn()) say(msg);
    setTimeout(() => el.remove(), 4200);
  }

  /* ---------- ilk açılış: kısa karşılama ---------- */
  function firstRun() {
    try { if (!A.ready()) return false; } catch (_) { return false; }
    if (get("tanitim", 0) || get("sorma", 0)) { if (!get("acildi", 0)) document.getElementById("guideBtn")?.classList.add("rh-new"); return true; }
    if (TR || P || document.getElementById("rh-tour")) return true;
    document.getElementById("guideBtn")?.classList.add("rh-new");
    const w = document.createElement("div"); w.id = "rh-tour";
    w.innerHTML = `<div class="m" style="left:0;top:0;width:100vw;height:100vh"></div><div class="bub" role="dialog" aria-label="Rehber" style="top:auto;bottom:calc(var(--navh,58px) + 20px);left:50%;transform:translateX(-50%)">
      <div style="font-size:40px;line-height:1">🧭</div><p style="margin:8px 0 4px;font-size:20px;font-weight:700">Merhaba! Ben Rehber.</p>
      <p style="margin:0">Uygulamayı 1 dakikada, parmağınla göstererek anlatayım mı? İnternet olmasa da çalışırım.</p>
      <div class="bt" style="flex-direction:column"><button class="primary" data-fr="go" style="min-height:56px;font-size:18px">▶ Evet, göster</button><button data-fr="later">Sonra</button></div></div>`;
    document.body.appendChild(w);
    w.addEventListener("click", e => {
      const b = e.target.closest("[data-fr]"); if (!b) return;
      w.remove(); put("sorma", 1);
      if (b.dataset.fr === "go") tourStart("tanitim");
      else toast("Ne zaman istersen sağ üstteki Rehber'e bas.");
    });
    return true;
  }

  /* ---------- olaylar ---------- */
  document.addEventListener("click", e => {
    // tur balonu
    const tb = e.target.closest && e.target.closest("#rh-tour [data-tr]");
    if (tb) {
      e.stopPropagation();
      const a = tb.dataset.tr;
      if (a === "x") endTour(); else if (a === "next") tourGo(1); else if (a === "prev") tourGo(-1);
      else if (a === "snd") { put("ses", !sesOn()); tb.textContent = sesOn() ? "🔊" : "🔈"; if (sesOn() && TR) say(TR.steps[TR.i].t); else hush(); }
      return;
    }
    // "şimdi sen bas" adımı: kullanıcı parlayan düğmeye bastı → uygulama işini yapsın, tur ilerlesin
    if (TR && TR.el && TR.steps[TR.i]?.tap && TR.el.contains(e.target)) { setTimeout(() => tourGo(1), 250); return; }
    const t = e.target.closest && e.target.closest("[data-rh]");
    if (!t || !(P && P.contains(t) || t.id === "rh-back")) return;
    const a = t.dataset.rh;
    if (a === "close") close();
    else if (a === "home") { view = { k: "home" }; hush(); paint(); P.scrollTop = 0; }
    else if (a === "topic") { view = { k: "topic", id: t.dataset.id }; hush(); paint(); P.scrollTop = 0; if (sesOn()) readTopic(t.dataset.id); }
    else if (a === "tour") tourStart(t.dataset.tour, t.dataset.learn);
    else if (a === "read") readTopic(t.dataset.id);
    else if (a === "learn") { const id = t.dataset.id; if (learned().includes(id)) { put("ogrendim", learned().filter(x => x !== id)); } else { learn(id); if (sesOn()) say("Aferin!"); } paint(); }
    else if (a === "snd") { put("ses", !sesOn()); if (!sesOn()) hush(); else say("Sesli anlatım açık."); paint(); }
    else if (a === "ask") { const q = t.dataset.q || ""; close(); A.ask(q); }
    else if (a === "mic") {
      try {
        const r = new SR(); r.lang = "tr-TR"; r.interimResults = false; r.maxAlternatives = 1;
        t.textContent = "⏺"; r.onresult = ev => { const q = ev.results[0][0].transcript; const i = P && P.querySelector("#rh-q"); if (i) i.value = q; doSearch(q); };
        r.onend = () => { t.textContent = "🎤"; }; r.onerror = () => { t.textContent = "🎤"; };
        r.start();
      } catch (_) { t.textContent = "🎤"; }
    }
  }, true);
  document.addEventListener("input", e => { if (e.target && e.target.id === "rh-q") doSearch(e.target.value); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (TR) endTour(); else if (P) close(); }
    if (TR && e.key === "ArrowRight") { e.preventDefault(); tourGo(1); }
    if (TR && e.key === "ArrowLeft") tourGo(-1);
  }, true);
  // telefonun geri tuşu: açık rehber paneli kapansın (tur, uygulamanın kendi geri adımlarıyla karışmasın diye açık kalır)
  window.addEventListener("popstate", () => { if (P) close(); });
  const repaintNet = () => { if (P) paint(); };
  window.addEventListener("online", repaintNet); window.addEventListener("offline", repaintNet);

  window.Rehber = { open, close, tour: tourStart, firstRun, topics: () => topics().map(t => t.id) };
})();
