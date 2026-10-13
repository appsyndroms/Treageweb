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
  function mountLogout() {
    const actions = document.querySelector('.site-menu-actions');
    if (actions) {
      actions.append(button);
      button.className = 'site-menu-logout';
      button.removeAttribute('style');
    } else if (!button.closest('footer')) {
      (document.querySelector('footer') || document.body).append(button);
    }
  }
  mountLogout();
  document.addEventListener('treage-menu-ready', mountLogout);
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
