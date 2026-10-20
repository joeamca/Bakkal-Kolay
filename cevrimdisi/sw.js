// Bakkal Kolay Çevrimdışı servis çalışanı: uygulama ilk açılışta (internetle) telefona indirilir; sonra tamamen internetsiz çalışır.
// Önce telefondaki kopya açılır; internet varsa arkada yenisi indirilir ve bir sonraki açılışta kullanılır.
const CACHE = "cevrimdisi-v3";
const XLSX = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";   // Excel yedeği için; kurulumda bir kez indirilir
const CORE = ["./", "manifest.webmanifest", "kamera.js", "duyuru.js", "icons/kolay-192.png", "icons/kolay-512.png", "icons/kolay-180.png", "icons/kolay-mask-512.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await Promise.all(CORE.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await c.add(new Request(XLSX, { mode: "cors" })).catch(() => {});
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("cevrimdisi-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  if (r.url === XLSX) {   // Excel kütüphanesi: önce telefondaki kopya, yoksa internetten indirip sakla
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(XLSX)) || fetch(r).then(res => { if (res.ok) c.put(XLSX, res.clone()); return res; })));
    return;
  }
  if (u.origin !== location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (u.pathname.endsWith("/sw.js")) return;
  const nav = r.mode === "navigate";
  e.respondWith((async () => {
    const c = await caches.open(CACHE), key = nav ? new Request(u.origin + u.pathname) : r;
    const hit = await c.match(key) || (nav ? await c.match(r, { ignoreSearch: true }) : null);
    const net = fetch(r).then(res => { if (res && res.ok && res.type === "basic") c.put(key, res.clone()); return res; });
    if (hit) { net.catch(() => {}); return hit; }
    return net.catch(() => new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font:20px system-ui;padding:24px'><h2>İlk açılış için internet gerekiyor</h2><p>Uygulamayı bir kez internetle açınca, sonra internetsiz çalışır.</p>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  })());
});
