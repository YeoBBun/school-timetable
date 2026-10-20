// 앱으로 설치(PWA)용 서비스 워커: 늘 인터넷에서 새 파일을 먼저 받고(업데이트가 바로 반영되게),
// 인터넷이 안 될 때만 저장해 둔 앱 파일을 쓴다. 구글 로그인 · 드라이브 요청은 건드리지 않는다.
const CACHE = 'jindo-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const isApp = url.origin === self.location.origin;
  const isLib = url.hostname === 'cdnjs.cloudflare.com' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (req.method !== 'GET' || !(isApp || isLib)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
