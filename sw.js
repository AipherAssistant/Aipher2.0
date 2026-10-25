const V='aipher-v5.1.6',ARCH=['./','index.html','styles.css','app.js','aipher-nucleo.js','aipher-swarm.js','manifest.json','datos/valores-iniciales.json','datos/personalidades.json','datos/recetas/indice.json','datos/recetas/youtube.json','datos/recetas/memoria.json','assets/icons/icon-192.png','assets/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ARCH)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==V).map(n=>caches.delete(n)))).then(()=>self.clients.claim()).then(()=>self.clients.matchAll().then(cs=>cs.forEach(c=>c.postMessage({tipo:'nueva-version',version:V})))))});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
/* Red primero, con 4 s de espera: si la red no responde, se usa la copia guardada. Solo se guardan respuestas 200. */
e.respondWith((async()=>{const ac=new AbortController(),t=setTimeout(()=>ac.abort(),4000);
 try{const r=await fetch(e.request,{signal:ac.signal});clearTimeout(t);
  if(r.status===200){const cp=r.clone();e.waitUntil(caches.open(V).then(c=>c.put(e.request,cp)).catch(()=>{}))}return r}
 catch{clearTimeout(t);const m=await caches.match(e.request,{ignoreSearch:true});if(m)return m;return fetch(e.request)}})())});
