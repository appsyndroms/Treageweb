const manifestName = '__MANIFEST__';
const root = new URL(self.registration.scope);
let files = null;
let key = null;
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'lock') { files = null; key = null; return; }
  if (event.data?.type !== 'unlock' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const response = await fetch(new URL(manifestName, root), { cache: 'no-store' });
      if (!response.ok) throw new Error('Manifest unavailable');
      const manifest = await response.json();
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(event.data.password), 'PBKDF2', false, ['deriveKey']);
      const candidateKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(manifest.salt), iterations: manifest.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(manifest.verifier.iv) }, candidateKey, bytes(manifest.verifier.ciphertext));
      files = manifest.files;
      key = candidateKey;
      event.ports[0].postMessage({ ok: true });
    } catch { event.ports[0].postMessage({ ok: false }); }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return;
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice(root.pathname.length)); }
  catch { event.respondWith(new Response('Invalid URL', { status: 400 })); return; }
  if (['sw.js', 'gate.js', 'gate.html', manifestName].includes(relative) || relative.startsWith('encrypted/')) return;
  event.respondWith((async () => {
    if (!files) {
      if (event.request.mode === 'navigate') return fetch(new URL('gate.html', root), { cache: 'no-store' });
      return new Response('Webben är låst.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    if (relative.endsWith('/') || relative === '') relative += 'index.html';
    if (!Object.hasOwn(files, relative) && Object.hasOwn(files, relative + '/index.html')) {
      url.pathname += '/';
      return Response.redirect(url.href, 302);
    }
    if (!Object.hasOwn(files, relative)) return new Response('Sidan finns inte.', { status: 404 });
    const file = files[relative];
    const response = await fetch(new URL(file.path, root), { cache: 'no-store' });
    if (!response.ok) return new Response('Kunde inte hämta den krypterade filen.', { status: 502 });
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(file.iv) }, key, await response.arrayBuffer());
      return new Response(plaintext, { headers: { 'Content-Type': file.type, 'Cache-Control': 'no-store' } });
    } catch {
      files = null;
      key = null;
      return new Response('Kunde inte dekryptera filen. Lås upp webben igen.', { status: 401 });
    }
  })());
});
