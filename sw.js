// 루루냥의 제주살이 — 오프라인 캐시 (서비스 워커)
// "캐시 먼저 보여주고, 뒤에서 새 버전을 받아 다음 방문 때 반영" 방식이라
// 인터넷이 느리거나 끊겨도 게임이 켜집니다.
const CACHE = 'lulufarm-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((hit) => {
        const fresh = fetch(e.request)
          .then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      })
    )
  );
});
