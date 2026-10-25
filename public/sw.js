self.addEventListener('install',e=>e.waitUntil(caches.open('dt1').then(c=>c.addAll(['/','/app.js','/style.css']))));
self.addEventListener('fetch',e=>{if(e.request.url.includes('/api/'))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});
