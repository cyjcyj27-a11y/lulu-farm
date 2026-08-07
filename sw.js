// 루루냥의 제주살이 — 오프라인 캐시 (서비스 워커)
// 페이지(HTML)는 항상 새 것을 먼저 받아서 업데이트가 바로 보이고,
// 그림·코드 같은 나머지는 캐시를 먼저 써서 느린 인터넷에서도 빨리 켜집니다.
const CACHE = 'lulufarm-v3';   // 판 올리면 옛 캐시가 통째로 비워집니다 (이장님 시트·3D 루루 반영)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const accept = e.request.headers.get('accept') || '';
  const isPage = e.request.mode === 'navigate' || accept.includes('text/html');
  e.respondWith(
    caches.open(CACHE).then((cache) => {
      if (isPage) {
        // HTML은 네트워크 우선 — 오프라인일 때만 캐시로
        return fetch(e.request)
          .then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cache.match(e.request));
      }
      // 나머지는 캐시 우선, 뒤에서 새 버전 받아 갱신
      return cache.match(e.request).then((hit) => {
        const fresh = fetch(e.request)
          .then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      });
    })
  );
});
