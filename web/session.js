(() => {
  const root = new URL('./', document.currentScript.src);
  let reloading = false;
  const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', reload);
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'locked') reload();
  });
  navigator.serviceWorker.register(new URL('sw.js?v=__BUILD_VERSION__', root), { scope: root.pathname }).catch(() => {});
  let button = document.getElementById('logout');
  if (!button) {
    button = document.createElement('button');
    button.id = 'logout';
    button.type = 'button';
    document.body.append(button);
  }
  button.textContent = 'Logga ut';
  button.style.cssText = 'position:fixed;right:1rem;bottom:1rem;z-index:1000;width:auto;padding:.5rem 1rem;border:1px solid #65758b;border-radius:.5rem;background:#172235;color:#fff;font:inherit;cursor:pointer;box-shadow:0 2px 8px #0004';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Loggar ut…';
    try {
      const reg = await navigator.serviceWorker.ready;
      await new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(new Error('Försök igen')), 10000);
        channel.port1.onmessage = event => {
          clearTimeout(timer);
          channel.port1.close();
          if (event.data?.ok) resolve(); else reject(new Error('Försök igen'));
        };
        (navigator.serviceWorker.controller || reg.active).postMessage({ type: 'lock' }, [channel.port2]);
      });
      reload();
    } catch {
      button.disabled = false;
      button.textContent = 'Logga ut – försök igen';
    }
  });
})();
