const payloadName = '__PAYLOAD__';
const root = new URL(self.registration.scope);
let files = null;
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'lock') { files = null; return; }
  if (event.data?.type !== 'unlock' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const response = await fetch(new URL(payloadName, root), { cache: 'no-store' });
      if (!response.ok) throw new Error('Payload unavailable');
      const payload = await response.json();
      const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(event.data.password), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(payload.salt), iterations: payload.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv) }, key, bytes(payload.ciphertext));
      files = JSON.parse(new TextDecoder().decode(plaintext));
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
  if (['sw.js', 'gate.js', 'gate.html', payloadName].includes(relative)) return;
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
    return new Response(bytes(file.body), { headers: { 'Content-Type': file.type, 'Cache-Control': 'no-store' } });
  })());
});
