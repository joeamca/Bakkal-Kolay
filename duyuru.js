/* Bakkal Defteri / Bakkal Kolay: duyuru kartı (yazı şablonları + kart çizimi + paylaşma).
   Uygulama bu dosyayı Duyuru ekranı ilk açılınca yükler. Telefonda çalışır, internet istemez. */
(function () {
  "use strict";
  if (window.Duyuru) return;

  const TYPES = [
    { id: "stok", ad: "Stok Geldi", alt: "Ürün geldi, haber ver", emoji: "📦" },
    { id: "cuma", ad: "Cuma Mesajı", alt: "Hayırlı Cumalar", emoji: "🌷" },
    { id: "bayram", ad: "Bayram", alt: "Açığız ya da kapalıyız", emoji: "🎉" },
    { id: "acik", ad: "Açık / Kapalı", alt: "Bugün durumumuz", emoji: "🏪" },
    { id: "gunaydin", ad: "Günaydın", alt: "Mahalleye merhaba", emoji: "🌞" },
    { id: "kampanya", ad: "Kampanya", alt: "Ürüne özel fiyat", emoji: "🏷️" }
  ];
  const THEMES = [
    { ad: "Mavi", a: "#1e40af", b: "#60a5fa", ink: "#14306e" },
    { ad: "Yeşil", a: "#166534", b: "#86efac", ink: "#0f4a26" },
    { ad: "Turuncu", a: "#c2410c", b: "#fdba74", ink: "#7c2d12" },
    { ad: "Pembe", a: "#9d174d", b: "#f9a8d4", ink: "#6b1038" }
  ];

  // [başlık, gövde, emoji]; {dukkan} {urun} {fiyat} {saat} {bayram} yerine konur
  const BANK = {
    stok: [
      ["{urun} geldi!", "Rafta yerini aldı. Koşun gelin, tükenmeden!", "🛒"],
      ["Müjde! {urun} bizde", "Mahalle rahat nefes alsın, sıra beklemeden gelin.", "🎉"],
      ["{urun} geldi, bayram erken geldi", "Kıyamet kopmadan bir uğrayın 😄", "📦"],
      ["Alarm! {urun} stokta", "Şimdi gelen alır, sonra gelen 'keşke' der.", "🚨"],
      ["Bekleyenlere duyurulur", "{urun} geldi. Sabrınızın karşılığı raflarda.", "🙌"],
      ["{urun} yeniden bizde", "Sormayanlar da gelsin, sorup durmayalım artık 😄", "😄"],
      ["Rafı doldurduk: {urun}", "Taze taze geldi. Eksik kalmasın, bir uğrayın.", "🧺"],
      ["{urun} geldi komşum", "Telefonu bırak, sepeti kap, bakkala gel!", "🏃"],
      ["Haberim var: {urun}", "Geldi ve yerini aldı. Çay da demli, gelin.", "☕"],
      ["{urun} için son durak biziz", "Kapıdan girenin sepetine hazır bekliyor.", "🚪"]
    ],
    cuma: [
      ["Hayırlı Cumalar", "Kapımız açık, çayımız demli. Bir uğrayın!", "☕"],
      ["Cuma geldi, hayırlar getirdi", "Mahallemize bereket, hepinize sağlık.", "🌷"],
      ["Hayırlı Cumalar komşum", "Bugün de buradayız, ekmeğiniz sıcak.", "🥖"],
      ["Cumanız mübarek olsun", "Gönlünüz ve sofranız bereketli olsun.", "🌹"],
      ["Hayırlı Cumalar", "Sofranız bol, kalbiniz huzurlu, kapınız eksik olmasın.", "🤲"],
      ["Mübarek Cuma", "Dualarınız kabul, işleriniz rast gitsin.", "🌙"],
      ["Cuma sabahı, mahalle bereketli", "Hayırlı Cumalar. Hafta sonu eksiğini şimdiden tamamla.", "🧺"],
      ["Hayırlı Cumalar, güzel komşularım", "Bugün de hizmetinizdeyiz. Kolay gelsin hepinize.", "😊"],
      ["Cuma güzelliği", "Hayırlı Cumalar. Cuma sonrası çay bizden olsun!", "☕"],
      ["Hayırlı Cumalar", "Allah gönderdiği her güne bereket versin.", "🌿"]
    ],
    bayram_acik: [
      ["{bayram} mübarek olsun", "Bayramda da buradayız: {saat}. Eksiğiniz olursa koşun gelin.", "🎉"],
      ["Bayramınız kutlu olsun", "Açığız: {saat}. Şekeriniz bizden, sohbetimiz bedava!", "🍬"],
      ["Bayram sevinci kapımızda", "{saat} arası açığız. Hepinize iyi bayramlar.", "🌙"],
      ["{bayram} kutlu olsun", "Misafir geldi, eksik çıktı mı? {saat} arası buradayız.", "🏪"],
      ["İyi bayramlar komşularım", "Bayram boyunca {saat} açığız. Mutlu, huzurlu günler.", "🤗"],
      ["Bayramınız mübarek", "Tatlıya, çikolataya, sütüne kadar {saat} hazırız.", "🍫"]
    ],
    bayram_kapali: [
      ["{bayram} mübarek olsun", "Bayramda kapalıyız. Sonrasında yine buradayız!", "🎉"],
      ["Bayramınız kutlu olsun", "Bu bayram biraz dinleniyoruz. Hepinize iyi bayramlar.", "🌙"],
      ["İyi bayramlar komşularım", "Ailemizle bayramlaşıyoruz, bayram sonrası görüşürüz.", "🤗"],
      ["{bayram} kutlu olsun", "Kapalıyız. Eksiğiniz varsa bir gün önceden bekleriz.", "🛒"]
    ],
    acik_acik: [
      ["Bugün açığız", "{saat} arası buradayız. Gelin, çayımız demli.", "🏪"],
      ["Kapımız açık", "{saat}. Eksiğiniz neyse bizde.", "🚪"],
      ["Bakkal açık!", "{saat}. Ekmek, süt, sohbet hep bizde.", "🥛"],
      ["Bugün de buradayız", "{saat}. Ne lazımsa uğrayın.", "😊"],
      ["Çalışıyoruz!", "{saat} arası açığız. Boşuna yürümeyin, kapı açık.", "🚶"],
      ["Gelen memnun, giden eksiksiz", "{saat} arası hizmetinizdeyiz.", "🛍️"]
    ],
    acik_kapali: [
      ["Bugün kapalıyız", "Yarın yine buradayız. Anlayışınız için sağ olun.", "🙏"],
      ["Kısa bir ara", "Bugün kapalıyız. Yarın görüşmek üzere!", "😴"],
      ["Bugün tatil", "Dükkân kapalı, yarın yeniden hizmetinizdeyiz.", "🔒"],
      ["Kapalıyız", "İhtiyacınızı bugün için başka yerden halledin, yarın sizi bekleriz.", "🙂"]
    ],
    gunaydin: [
      ["Günaydın mahalle!", "Güne ekmek kokusuyla başlayın, biz hazırız.", "🌞"],
      ["Günaydın komşum", "Çayı demle, gel; bakkal açık.", "☕"],
      ["Güne merhaba!", "Eksiğiniz varsa bizde. Kolay gelsin herkese.", "🌅"],
      ["Günaydın!", "Bugün herkes güzel, siz de öylesiniz 😄", "😄"],
      ["Günaydın, güzel insanlar", "Kahvaltılık eksik mi? Bir uğrayın.", "🍳"],
      ["Uyanın, ekmek sıcak!", "Günaydın. Kapımız açık, çayımız demli.", "🥖"],
      ["Günün hayırlı olsun", "Kolay gelsin, bol kazançlar, güzel bir gün dilerim.", "🌤️"],
      ["Sabah sabah şunu söyleyeyim", "Günaydın! Ne lazımsa buradayız.", "🌻"],
      ["Güne gülümseyerek başla", "Günaydın komşular. Süt, yumurta, peynir hep bizde.", "🥛"],
      ["Günaydın!", "Mahalle uyanıyor, bakkal çoktan hazır.", "🐓"]
    ],
    kampanya: [
      ["{urun} {fiyat} TL", "Bugüne özel fiyat! Tükenmeden gelin.", "🏷️"],
      ["Fırsat! {urun}", "Sadece {fiyat} TL. Cüzdanınız teşekkür eder.", "💸"],
      ["{urun} {fiyat} TL'ye düştü", "Kaçıran kendine küssün 😄", "🔥"],
      ["Bugün {urun} günü", "{fiyat} TL. Gelen alır, gelmeyen sorar.", "🎯"],
      ["İndirim var: {urun}", "{fiyat} TL. Mahalleye özel, kimseye söylemeyin 🤫", "🤫"],
      ["{urun} bu fiyata bulunmaz", "Sadece {fiyat} TL. Stoklar sınırlı.", "⏰"],
      ["Cebinize dost: {urun}", "{fiyat} TL. Şimdi alın, sonra sevinin.", "😊"],
      ["{urun} {fiyat} TL!", "Kampanya bugünlük. Sepeti kapan gelsin.", "🛒"]
    ]
  };

  const sub = (s, c) => String(s).replace(/\{(\w+)\}/g, (_, k) => (c[k] != null && c[k] !== "" ? c[k] : "…"));
  const key = (type, c) => type === "bayram" ? (c.durum === "kapali" ? "bayram_kapali" : "bayram_acik")
    : type === "acik" ? (c.durum === "kapali" ? "acik_kapali" : "acik_acik") : type;
  const variants = (type, c) => (BANK[key(type, c || {})] || []).length;
  function text(type, v, c) {
    const list = BANK[key(type, c)] || BANK.gunaydin, t = list[((v % list.length) + list.length) % list.length];
    const title = sub(t[0], c), body = sub(t[1], c);
    return { title: title, body: body, emoji: t[2], share: title + "\n" + body + "\n— " + (c.dukkan || "Mahalle Bakkalı") };
  }

  /* ---------- kart çizimi ---------- */
  const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  const EMOJI = "'Apple Color Emoji','Noto Color Emoji','Segoe UI Emoji',sans-serif";
  function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
  function wrap(x, s, maxW) {
    const words = String(s).split(/\s+/), lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
    if (cur) lines.push(cur); return lines;
  }
  function fit(x, s, maxW, maxLines, from, to, weight) {
    for (let sz = from; sz >= to; sz -= 4) {
      x.font = weight + " " + sz + "px " + FONT;
      const L = wrap(x, s, maxW);
      if (L.length <= maxLines && L.every(l => x.measureText(l).width <= maxW)) return { sz: sz, lines: L };
    }
    x.font = weight + " " + to + "px " + FONT; return { sz: to, lines: wrap(x, s, maxW).slice(0, maxLines) };
  }

  /* ---------- Mert Amca: özgün bakkal karakteri (kodla çizilir) ---------- */
  function mascot(x, cx, cy, sc, pose) {
    x.save(); x.translate(cx - 150 * sc, cy - 150 * sc); x.scale(sc, sc);
    x.lineJoin = x.lineCap = "round"; const OUT = "#1f2937", SKIN = "#f6c9a0";
    const line = (c, w) => { x.strokeStyle = c; x.lineWidth = w; };
    const arm = (x1, y1, x2, y2) => { x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); line(OUT, 36); x.stroke(); line("#ef4444", 26); x.stroke(); };
    const hand = (hx, hy, r) => { x.beginPath(); x.arc(hx, hy, r || 15, 0, 7); x.fillStyle = SKIN; x.fill(); line(OUT, 5); x.stroke(); };
    const fillStroke = (f, w) => { x.fillStyle = f; x.fill(); line(OUT, w || 5); x.stroke(); };
    // gövde
    x.beginPath(); x.moveTo(70, 300); x.lineTo(70, 235); x.quadraticCurveTo(70, 180, 150, 180); x.quadraticCurveTo(230, 180, 230, 235); x.lineTo(230, 300); x.closePath(); fillStroke("#ef4444");
    // önlük
    x.beginPath(); x.moveTo(104, 300); x.lineTo(104, 214); x.lineTo(196, 214); x.lineTo(196, 300); x.closePath(); fillStroke("#ffffff", 4);
    x.beginPath(); x.rect(128, 238, 44, 30); line("#93c5fd", 4); x.stroke();
    // kollar
    const down = (sx) => { arm(sx > 150 ? 220 : 80, 220, sx > 150 ? 236 : 64, 280); hand(sx > 150 ? 237 : 63, 286); };
    if (pose === 0) { down(0); arm(220, 215, 254, 150); hand(256, 138, 17); }
    else if (pose === 1) { down(0); arm(220, 222, 240, 198); hand(240, 190, 14);
      x.beginPath(); x.moveTo(226, 150); x.lineTo(256, 150); x.lineTo(251, 196); x.lineTo(231, 196); x.closePath(); x.fillStyle = "#b45309"; x.fill(); line("#dbeafe", 5); x.stroke();
      line("rgba(255,255,255,.8)", 5); for (const dx of [-8, 4]) { x.beginPath(); x.moveTo(241 + dx, 140); x.quadraticCurveTo(235 + dx, 128, 241 + dx, 116); x.stroke(); } hand(240, 192, 12); }
    else if (pose === 2) { down(1); arm(80, 220, 62, 262); hand(62, 270, 14);
      x.beginPath(); x.moveTo(34, 262); x.lineTo(94, 262); x.lineTo(88, 308); x.lineTo(40, 308); x.closePath(); fillStroke("#d6a461");
      x.beginPath(); x.moveTo(50, 262); x.quadraticCurveTo(64, 236, 78, 262); line(OUT, 5); x.stroke(); hand(64, 258, 12); }
    else if (pose === 3) { arm(80, 218, 48, 150); hand(46, 138, 16); arm(220, 218, 252, 150); hand(254, 138, 16); }
    else { down(0); arm(220, 215, 244, 178); hand(246, 170, 16); x.beginPath(); x.ellipse(246, 150, 8, 15, 0, 0, 7); fillStroke(SKIN, 4); }
    // kulak, kafa
    for (const ex of [93, 207]) { x.beginPath(); x.arc(ex, 128, 11, 0, 7); fillStroke(SKIN, 5); }
    x.beginPath(); x.ellipse(150, 122, 58, 56, 0, 0, 7); fillStroke(SKIN, 5);
    // kasket
    x.beginPath(); x.moveTo(90, 104); x.quadraticCurveTo(92, 52, 150, 50); x.quadraticCurveTo(208, 52, 210, 104); x.closePath(); fillStroke("#374151");
    x.beginPath(); x.moveTo(94, 98); x.lineTo(206, 98); line("#111827", 8); x.stroke();
    x.beginPath(); x.moveTo(104, 98); x.quadraticCurveTo(150, 124, 196, 98); x.lineTo(196, 90); x.lineTo(104, 90); x.closePath(); fillStroke("#4b5563", 4);
    // yanak, göz, kaş
    for (const cxx of [112, 188]) { x.beginPath(); x.arc(cxx, 142, 11, 0, 7); x.fillStyle = "rgba(244,114,114,.55)"; x.fill(); }
    const brow = pose === 3 ? -6 : 0; line(OUT, 6);
    for (const [bx, d] of [[128, 1], [172, -1]]) { x.beginPath(); x.moveTo(bx - 12, 106 + brow + d * 2); x.lineTo(bx + 12, 106 + brow - d * 2); x.stroke(); }
    for (const ex of [128, 172]) { x.beginPath(); x.arc(ex, 120, pose === 3 ? 8 : 6.5, 0, 7); x.fillStyle = OUT; x.fill(); x.beginPath(); x.arc(ex + 2, 117, 2.3, 0, 7); x.fillStyle = "#fff"; x.fill(); }
    // burun, bıyık, ağız
    x.beginPath(); x.ellipse(150, 135, 10, 8, 0, 0, 7); fillStroke("#e8a87c", 4);
    for (const sgn of [-1, 1]) { x.save(); x.translate(150 + sgn * 22, 152); x.rotate(sgn * -0.25); x.beginPath(); x.ellipse(0, 0, 25, 11, 0, 0, 7); x.restore(); fillStroke("#6b7280", 4); }
    if (pose === 3) { x.beginPath(); x.ellipse(150, 172, 12, 13, 0, 0, 7); fillStroke("#7f1d1d", 4); }
    else { x.beginPath(); x.moveTo(132, 166); x.quadraticCurveTo(150, 186, 168, 166); line(OUT, 5); x.stroke(); }
    x.restore();
  }
  function draw(type, v, themeIdx, c) {
    const S = 1080, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    const x = cv.getContext("2d"), th = THEMES[((themeIdx % THEMES.length) + THEMES.length) % THEMES.length], t = text(type, v, c);
    const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, th.a); g.addColorStop(1, th.b); x.fillStyle = g; x.fillRect(0, 0, S, S);
    // süs: yarı saydam daireler (her tür/yazı için aynı yerde)
    let seed = 7 + v * 13 + type.length * 5; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 9; i++) { x.fillStyle = "rgba(255,255,255," + (0.05 + rnd() * 0.1).toFixed(2) + ")"; x.beginPath(); x.arc(rnd() * S, rnd() * S, 50 + rnd() * 170, 0, 7); x.fill(); }
    // dükkân adı
    x.textBaseline = "alphabetic"; x.textAlign = "left"; x.fillStyle = "#fff";
    const name = c.dukkan || "Mahalle Bakkalı", nf = fit(x, name, S - 160, 1, 64, 36, "800");
    x.font = "800 " + nf.sz + "px " + FONT; x.shadowColor = "rgba(0,0,0,.25)"; x.shadowBlur = 8; x.fillText(nf.lines[0], 64, 110); x.shadowBlur = 0;
    // emoji
    mascot(x, 400, 330, 1.18, v % 5);
    x.textAlign = "center"; x.textBaseline = "middle"; x.font = "170px " + EMOJI; x.fillText(t.emoji, 860, 290);
    // beyaz kart
    const cx0 = 60, cy0 = 520, cw = S - 120, ch = 440;
    x.fillStyle = "rgba(0,0,0,.15)"; rr(x, cx0, cy0 + 10, cw, ch, 44); x.fill();
    x.fillStyle = "#fff"; rr(x, cx0, cy0, cw, ch, 44); x.fill();
    x.textAlign = "center"; x.textBaseline = "alphabetic";
    const tf = fit(x, t.title, cw - 90, 2, 92, 52, "800"), bf = fit(x, t.body, cw - 100, 3, 50, 32, "500");
    const th1 = tf.lines.length * tf.sz * 1.15, bh1 = bf.lines.length * bf.sz * 1.3, gap = 26, total = th1 + gap + bh1;
    let y = cy0 + (ch - total) / 2 + tf.sz * 0.95;
    x.fillStyle = th.ink; x.font = "800 " + tf.sz + "px " + FONT;
    for (const l of tf.lines) { x.fillText(l, S / 2, y); y += tf.sz * 1.15; }
    y += gap - tf.sz * 0.15 + bf.sz * 0.2; x.fillStyle = "#374151"; x.font = "500 " + bf.sz + "px " + FONT;
    for (const l of bf.lines) { x.fillText(l, S / 2, y); y += bf.sz * 1.3; }
    // alt yazı
    x.fillStyle = "rgba(255,255,255,.95)"; x.font = "600 34px " + FONT; x.fillText("Mahallenin bakkalı", S / 2, 1030);
    return cv;
  }
  const cache = {};
  function dataUrl(type, v, themeIdx, c) {
    const k = [type, v, themeIdx, c.dukkan, c.urun, c.fiyat, c.saat, c.bayram, c.durum].join("|");
    if (!cache[k]) { const keys = Object.keys(cache); if (keys.length > 12) delete cache[keys[0]]; cache[k] = draw(type, v, themeIdx, c).toDataURL("image/jpeg", 0.88); }
    return cache[k];
  }

  /* ---------- paylaşma ---------- */
  async function share(type, v, themeIdx, c) {
    const cv = draw(type, v, themeIdx, c), t = text(type, v, c);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92)), name = "duyuru-" + type;
    let file = null; try { file = new File([blob], name + ".jpg", { type: "image/jpeg" }); } catch (_) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: t.share }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".jpg"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000); return "downloaded";
  }
  async function copy(type, v, c) {
    const s = text(type, v, c).share;
    try { await navigator.clipboard.writeText(s); return true; } catch (_) { return false; }
  }

  window.Duyuru = { TYPES: TYPES, THEMES: THEMES, text: text, variants: variants, draw: draw, dataUrl: dataUrl, share: share, copy: copy };
})();
