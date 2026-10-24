const V='aipher-v5.1.2',ARCH=['./','index.html','styles.css','app.js','aipher-swarm.js','manifest.json','datos/valores-iniciales.json','datos/personalidades.json','datos/recetas/indice.json','datos/recetas/youtube.json','datos/recetas/memoria.json','assets/icons/icon-192.png','assets/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ARCH)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==V).map(n=>caches.delete(n)))).then(()=>self.clients.claim()).then(()=>self.clients.matchAll().then(cs=>cs.forEach(c=>c.postMessage({tipo:'nueva-version',version:V})))))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});
