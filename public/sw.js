// Yoda Research PWA Service Worker v3 (Next.js)
// v2 回應所有 GET 都先拿快取 → 部署後瀏覽器繼續跑舊的 /ta 頁面程式、配新引擎資料而崩潰（2026-11-10）。
// v3：一律先走網路、斷線才退回快取；/_next/（帶 hash 的程式檔，瀏覽器自己會快取）與 /api/ 完全不經手，
//     新舊版程式不會混用。改這支檔的快取行為時要換 CACHE 名稱，舊快取才會被清掉。
const CACHE = 'yoda-v3';
const SHELL = ['/', '/archive', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  const done = caches.keys().then(ks => {
    const old = ks.filter(k => k !== CACHE);
    return Promise.all(old.map(k => caches.delete(k))).then(() => self.clients.claim()).then(() => old.length > 0);
  });
  e.waitUntil(done);
  // 從舊版升上來：開著的分頁可能正跑著舊快取的程式，重新載入一次換成新版（全新安裝不重載）。
  // navigate 不能放進 waitUntil：導覽請求要等 SW 進入 activated 才處理，兩邊互等會卡 5 分鐘（2026-11-10 實測）。
  done.then(up => up && self.clients.matchAll({ type: 'window' })
    .then(cs => cs.forEach(c => c.navigate(c.url).catch(() => {}))));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/') || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
