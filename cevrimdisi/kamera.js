/* Bakkal Defteri / Bakkal Kolay: kamerayla barkod okuma (sadece telefon).
   Telefonun kendi okuyucusu (BarcodeDetector) varsa onu kullanır; yoksa (iPhone) aşağıdaki EAN/UPC çözücü çalışır.
   Uygulama bu dosyayı ilk "kamera" düğmesine basılınca yükler. */
(function () {
  "use strict";
  if (window.Kamera) return;

  /* ---------- EAN-13 / EAN-8 / UPC-A çözücü ---------- */
  // rakam başına 4 çizgi/boşluk genişliği (7 birim toplam)
  const L = [[3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],[1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]];
  const G = L.map(p => p.slice().reverse());
  const PAR = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

  function digit(r, i, both) {
    const tot = r[i] + r[i+1] + r[i+2] + r[i+3];
    if (!(tot > 0)) return null;
    const q = [r[i] * 7 / tot, r[i+1] * 7 / tot, r[i+2] * 7 / tot, r[i+3] * 7 / tot];
    let best = null, bd = 99, sd = 99;
    for (let d = 0; d < 10; d++) {
      for (let k = 0; k < (both ? 2 : 1); k++) {
        const p = k ? G[d] : L[d];
        let s = 0;
        for (let j = 0; j < 4; j++) s += Math.abs(q[j] - p[j]);
        if (s < bd) { sd = bd; bd = s; best = { d: d, k: k ? "G" : "L" }; }
        else if (s < sd) sd = s;
      }
    }
    // yeterince benzemeli ve ikinci en yakın şıktan belirgin biçimde ayrılmalı (düzgün çizgili desenleri elemek için)
    return (bd <= 1.3 && sd - bd >= 0.35) ? best : null;
  }
  function sumOk(s) {
    const n = s.length; let t = 0;
    for (let k = n - 2; k >= 0; k--) t += Number(s[k]) * (((n - 2 - k) % 2 === 0) ? 3 : 1);
    return Number(s[n-1]) === (10 - t % 10) % 10;
  }
  function guardOk(r, i, m) { for (let j = 0; j < 3; j++) if (Math.abs(r[i+j] - m) > m * 0.7) return false; return true; }
  function centerOk(r, i, m) { for (let j = 0; j < 5; j++) if (r[i+j] < m * 0.35 || r[i+j] > m * 1.9) return false; return true; }

  function ean(r, i, m, half) {          // half=6 → EAN-13, half=4 → EAN-8
    if (i + 3 + half * 8 + 5 + 3 > r.length) return null;
    let pos = i + 3, left = "", par = "";
    for (let k = 0; k < half; k++) {
      const x = digit(r, pos, half === 6); if (!x) return null;
      left += x.d; par += x.k; pos += 4;
    }
    if (!centerOk(r, pos, m)) return null; pos += 5;
    let right = "";
    for (let k = 0; k < half; k++) { const x = digit(r, pos, false); if (!x) return null; right += x.d; pos += 4; }
    if (!guardOk(r, pos, m)) return null;
    let code;
    if (half === 6) { const f = PAR.indexOf(par); if (f < 0) return null; code = f + left + right; }
    else { if (par !== "LLLL") return null; code = left + right; }
    return sumOk(code) ? code : null;
  }
  function decodeRuns(r, startBar) {
    const n = r.length;
    for (let i = 0; i + 3 < n; i++) {
      if (startBar ? (i % 2) : !(i % 2)) continue;      // koruma çizgisi bir "çizgi" olmalı
      const m = (r[i] + r[i+1] + r[i+2]) / 3;
      if (m < 1 || !guardOk(r, i, m)) continue;
      if (i > 0 && r[i-1] < m * 2.5) continue;           // önünde boşluk olmalı
      const c = ean(r, i, m, 6) || ean(r, i, m, 4);
      if (c) return c;
    }
    return null;
  }
  function toRuns(g, N, off) {
    const w = Math.max(12, (N / 7) | 0), ps = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) ps[i+1] = ps[i] + g[i];
    const thr = new Float32Array(N), bits = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - w), b = Math.min(N, i + w + 1), mean = (ps[b] - ps[a]) / (b - a);
      thr[i] = mean - Math.max(off, mean * 0.06);
      bits[i] = g[i] < thr[i] ? 1 : 0;
    }
    // çizgi kenarları: eşiğin geçildiği yer, piksel altı hassasiyetle
    const edges = [0];
    for (let i = 0; i + 1 < N; i++) {
      if (bits[i] !== bits[i+1]) {
        const d = g[i+1] - g[i], t = d ? (thr[i] - g[i]) / d : 0.5;
        edges.push(i + 0.5 + Math.max(-0.5, Math.min(0.5, t - 0.5)));
      }
    }
    edges.push(N);
    const r = [];
    for (let i = 0; i + 1 < edges.length; i++) r.push(edges[i+1] - edges[i]);
    return { r: r, startBar: bits[0] === 1 };
  }
  function decodeLine(g, N) {
    // hafif yumuşatma
    const s = new Float32Array(N);
    for (let i = 0; i < N; i++) s[i] = ((g[Math.max(0, i-1)] + 2 * g[i] + g[Math.min(N-1, i+1)]) / 4);
    for (const off of [10, 4]) {
      const t = toRuns(s, N, off), n = t.r.length;
      if (n < 43) continue;
      let c = decodeRuns(t.r, t.startBar);
      if (c) return c;
      const lastBar = t.startBar ? (n - 1) % 2 === 0 : (n - 1) % 2 === 1;   // ters (baş aşağı) okuma
      c = decodeRuns(t.r.slice().reverse(), lastBar);
      if (c) return c;
    }
    return null;
  }
  // d: RGBA piksel dizisi
  function scanFrame(d, w, h, many) {
    const NQ = many ? 47 : 23, order = [];
    for (let q = 0; q < NQ; q++) order.push(q);
    order.sort((a, b) => Math.abs(a - (NQ - 1) / 2) - Math.abs(b - (NQ - 1) / 2));
    const row = new Float32Array(w), col = new Float32Array(h);
    for (let k = 0; k < 2; k++) {                       // k=0: yatay, k=1: dikey tutulmuş barkod
      const N = k ? h : w, lines = k ? w : h, out = k ? col : row;
      for (const q of order) {
        const pos = Math.min(lines - 1, Math.floor(lines * (0.08 + 0.84 * q / (NQ - 1))));
        for (let i = 0; i < N; i++) {
          const x = k ? pos : i, y = k ? i : pos, o = (y * w + x) * 4;
          out[i] = (d[o] * 77 + d[o+1] * 150 + d[o+2] * 29) >> 8;
        }
        const c = decodeLine(out, N); if (c) return c;
      }
    }
    return null;
  }

  async function readPhoto(file) {
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (_) {
      bmp = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = URL.createObjectURL(file); });
    }
    if (!bmp) return null;
    const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
    for (const target of [1400, 2000, 900]) {
      const sc = Math.min(1, target / Math.max(W, H)), w = Math.round(W * sc), h = Math.round(H * sc);
      cv.width = w; cv.height = h; cx.drawImage(bmp, 0, 0, w, h);
      const c = scanFrame(cx.getImageData(0, 0, w, h).data, w, h, true);
      if (c) return c;
      await new Promise(r => setTimeout(r, 0));
    }
    return null;
  }

  /* ---------- kamera ekranı ---------- */
  let ov = null, stream = null, timer = 0, alive = false;
  function css() {
    if (document.getElementById("kam-css")) return;
    const s = document.createElement("style"); s.id = "kam-css";
    s.textContent = "#kam-ov{position:fixed;inset:0;z-index:99999;background:#000;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#fff}" +
      "#kam-ov .kam-view{flex:1;min-height:0;position:relative;overflow:hidden;touch-action:none;background:#000}" +
      "#kam-ov video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%}" +
      "#kam-ov .kam-zoom{position:absolute;right:12px;bottom:12px;display:flex;align-items:center;gap:8px;z-index:3}" +
      "#kam-ov .kam-zoom button{min-height:0;width:52px;height:52px;padding:0;border-radius:50%;font-size:30px;line-height:1;background:rgba(255,255,255,.9)}" +
      "#kam-ov .kam-zv{min-width:44px;text-align:center;font-weight:700;font-size:16px;text-shadow:0 1px 3px #000}" +
      "#kam-ov .kam-ring{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border:3px solid #ffd60a;border-radius:50%;pointer-events:none;opacity:0;transition:opacity .25s;z-index:3}" +
      "#kam-ov .kam-frame{position:absolute;left:8%;right:8%;top:30%;height:26%;border:3px solid #fff;border-radius:14px;box-shadow:0 0 0 100vmax rgba(0,0,0,.45);pointer-events:none}" +
      "#kam-ov .kam-frame::after{content:'';position:absolute;left:6%;right:6%;top:50%;height:2px;background:#ff3b30}" +
      "#kam-ov .kam-bar{position:relative;z-index:2;padding:14px 16px calc(14px + env(safe-area-inset-bottom));background:#111;display:flex;flex-direction:column;gap:10px;text-align:center}" +
      "#kam-ov .kam-msg{font-size:18px;font-weight:600}" +
      "#kam-ov .kam-alt{background:#ffd60a}#kam-ov button{font:inherit;font-size:20px;font-weight:700;padding:14px;border-radius:14px;border:0;background:#fff;color:#000;min-height:52px}";
    document.head.appendChild(s);
  }
  function close() {
    alive = false; clearTimeout(timer);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (ov) { ov.remove(); ov = null; }
    window.removeEventListener("popstate", close);
    document.removeEventListener("visibilitychange", onVis);
  }
  function onVis() { if (document.hidden) close(); }

  async function open(cb) {
    close(); css(); alive = true;
    ov = document.createElement("div"); ov.id = "kam-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "Kamerayla barkod oku");
    ov.innerHTML = '<div class="kam-view"><video playsinline muted autoplay></video><div class="kam-frame"></div><div class="kam-ring"></div><div class="kam-zoom"><button type="button" id="kam-zm" aria-label="Uzaklaştır">−</button><span class="kam-zv" id="kam-zl">1×</span><button type="button" id="kam-zp" aria-label="Yakınlaştır">+</button></div></div><div class="kam-bar"><div class="kam-msg">Barkodu çerçeveye tut</div><button type="button" id="kam-p" class="kam-alt">Fotoğraf Çek</button><button type="button" id="kam-x">Kapat</button><input type="file" id="kam-f" accept="image/*" capture="environment" hidden></div>';
    document.body.appendChild(ov);
    ov.querySelector("#kam-x").onclick = close;
    const msg0 = ov.querySelector(".kam-msg"), fin = ov.querySelector("#kam-f");
    ov.querySelector("#kam-p").onclick = () => { fin.value = ""; fin.click(); };
    fin.onchange = async () => {
      const file = fin.files && fin.files[0]; if (!file) return;
      msg0.textContent = "Okunuyor…";
      const code = await readPhoto(file);
      if (!ov) return;
      if (code) { try { navigator.vibrate && navigator.vibrate(60); } catch (_) {} close(); cb(code); }
      else msg0.textContent = "Okuyamadım. Barkod net ve ışıklı olsun, tekrar çek.";
    };
    window.addEventListener("popstate", close); document.addEventListener("visibilitychange", onVis);
    const msg = ov.querySelector(".kam-msg"), video = ov.querySelector("video");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      if (!alive) return;
      msg.textContent = (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) ? "Kamera izni verilmedi. Telefon ayarlarından bu uygulamaya kamera izni ver." : "Kamera açılamadı.";
      return;
    }
    if (!alive) { stream.getTracks().forEach(t => t.stop()); stream = null; return; }
    video.srcObject = stream;
    try { await video.play(); } catch (_) {}
    const track = stream.getVideoTracks()[0];
    let caps = {}; try { caps = (track.getCapabilities && track.getCapabilities()) || {}; } catch (_) {}
    try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (_) {}
    // yakınlaştırma: telefon destekliyorsa gerçek (optik/sensör) zoom, yoksa görüntüyü büyüt ve ortasını oku
    const hw = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
    const zmin = hw ? caps.zoom.min : 1, zmax = hw ? Math.min(caps.zoom.max, zmin * 6) : 4;
    let zoom = zmin;
    const zl = ov.querySelector("#kam-zl"), view = ov.querySelector(".kam-view"), ring = ov.querySelector(".kam-ring");
    const setZoom = z => {
      zoom = Math.max(zmin, Math.min(zmax, z));
      if (hw) track.applyConstraints({ advanced: [{ zoom: zoom }] }).catch(() => {});
      else video.style.transform = "scale(" + zoom + ")";
      zl.textContent = (Math.round(zoom / zmin * 10) / 10) + "×";
    };
    const zstep = hw ? (zmax - zmin) / 5 : 0.5;
    ov.querySelector("#kam-zp").onclick = () => setZoom(zoom + zstep);
    ov.querySelector("#kam-zm").onclick = () => setZoom(zoom - zstep);
    // iki parmakla büyütme + dokunduğu yere odaklama
    const ptr = new Map(); let pd = 0, z0 = zoom, moved = false, t0 = 0;
    const dist = () => { const p = [...ptr.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
    view.addEventListener("pointerdown", e => { if (e.target.closest(".kam-zoom")) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false; t0 = Date.now(); if (ptr.size === 2) { pd = dist(); z0 = zoom; } });
    view.addEventListener("pointermove", e => { if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2 && pd > 0) { moved = true; setZoom(z0 * dist() / pd); } else if (Math.hypot(e.movementX || 0, e.movementY || 0) > 3) moved = true; });
    const focusAt = e => {
      const r = view.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const canFocus = (caps.focusMode && caps.focusMode.some(m => m === "single-shot" || m === "manual")) || ("pointsOfInterest" in (track.getSettings ? track.getSettings() : {}));
      if (!canFocus) { msg.textContent = "Bu telefonda dokunarak odaklanmıyor. Netleşmezse Fotoğraf Çek'i dene."; setTimeout(() => { if (ov) msg.textContent = "Barkodu çerçeveye tut"; }, 2600); return; }
      ring.style.left = (x * 100) + "%"; ring.style.top = (y * 100) + "%"; ring.style.opacity = 1; setTimeout(() => { ring.style.opacity = 0; }, 900);
      const adv = { focusMode: "single-shot", pointsOfInterest: [{ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) }] };
      track.applyConstraints({ advanced: [adv] }).then(() => setTimeout(() => { if (alive) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}); }, 2500)).catch(() => {});
    };
    const up = e => { const had = ptr.has(e.pointerId); ptr.delete(e.pointerId); if (had && ptr.size === 0 && !moved && Date.now() - t0 < 600 && !e.target.closest(".kam-zoom")) focusAt(e); if (ptr.size < 2) pd = 0; };
    view.addEventListener("pointerup", up); view.addEventListener("pointercancel", e => { ptr.delete(e.pointerId); pd = 0; });

    let det = null;
    if ("BarcodeDetector" in window) { try { det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"] }); } catch (_) { det = null; } }
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
    let last = "", hits = 0;
    const done = code => { try { navigator.vibrate && navigator.vibrate(60); } catch (_) {} close(); cb(code); };
    const tick = async () => {
      if (!alive) return;
      let code = null;
      if (video.videoWidth) {
        try {
          const dz = hw ? 1 : zoom, vw = video.videoWidth, vh = video.videoHeight;
          if (det && dz <= 1.01) { const r = await det.detect(video); if (r && r[0] && r[0].rawValue) { done(r[0].rawValue); return; } }
          else {
            const sw = vw / dz, sh = vh / dz, sc = Math.min(1, 960 / sw), w = Math.round(sw * sc), h = Math.round(sh * sc);
            cv.width = w; cv.height = h; cx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
            if (det) { const r = await det.detect(cv); if (r && r[0] && r[0].rawValue) { done(r[0].rawValue); return; } }
            else code = scanFrame(cx.getImageData(0, 0, w, h).data, w, h);
          }
        } catch (_) {}
      }
      if (code) { if (code === last) hits++; else { last = code; hits = 1; } if (hits >= 2) { done(code); return; } }
      timer = setTimeout(tick, 90);
    };
    tick();
  }

  window.Kamera = { _photo: readPhoto, open: open, close: close, _scan: scanFrame, _line: decodeLine, _runs: toRuns, _dr: decodeRuns };
})();
