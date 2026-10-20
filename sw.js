// Bakkal Kolay servis çalışanı: bildirimler + internetsiz açılış
// Sayfalar önce internetten istenir (her zaman güncel sürüm); internet yoksa ya da çok yavaşsa telefondaki kopya açılır.
const CACHE = "kolay-v27";
const CORE = ["./", "manifest.webmanifest", "kamera.js", "duyuru.js", "icons/kolay-192.png", "icons/kolay-512.png", "icons/kolay-180.png"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("kolay-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (u.pathname.endsWith("/sw.js")) return;
  const nav = r.mode === "navigate";
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(r).then(res => { if (res && res.ok && res.type === "basic") c.put(nav ? new Request(u.origin + u.pathname) : r, res.clone()); return res; });
    // sayfa: en çok 4 sn internet beklenir, sonra telefondaki kopya; simge vb.: önce kopya
    if (!nav){ const hit = await c.match(r); if (hit){ net.catch(() => {}); return hit; } return net; }
    const old = () => c.match(u.origin + u.pathname).then(x => x || c.match(r, { ignoreSearch: true }));
    try {
      return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error("yavaş")), 4000))]);
    } catch (_) {
      const hit = await old(); if (hit){ net.catch(() => {}); return hit; }
      return net.catch(() => new Response("<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font:20px system-ui;padding:24px'><h2>İnternet yok</h2><p>Uygulamayı bir kez internetle açınca, sonra internetsiz de açılır.</p>", { headers: { "content-type": "text/html; charset=utf-8" } }));
    }
  })());
});
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Bakkal Defteri", body: e.data ? e.data.text() : "" }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || "Bakkal Defteri", {
    body: d.body || "", icon: d.icon || base + "icons/n-genel.png", badge: d.badge || base + "icons/badge.png",
    tag: d.tag || undefined, renotify: !!d.tag, lang: "tr", vibrate: [80, 40, 80], timestamp: Date.now(), data: { url: d.url || base }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    const base = url.split("?")[0];
    for (const w of ws) if (w.url.split("?")[0] === base && "focus" in w) return (url.includes("?") && w.navigate ? w.navigate(url).then(x => (x || w).focus()) : w.focus());
    return self.clients.openWindow(url);
  }));
});
