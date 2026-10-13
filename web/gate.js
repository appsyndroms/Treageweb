const root = new URL('./', document.currentScript.src);
const status = document.querySelector('#status');
const form = document.querySelector('form');
const username = document.querySelector('#username');
const input = document.querySelector('#password');
const button = form.querySelector('button');
const registration = (async () => {
  if (!isSecureContext || !('serviceWorker' in navigator)) throw new Error('Webben kräver HTTPS och en webbläsare med stöd för service workers.');
  const reg = await navigator.serviceWorker.register(new URL('sw.js?v=__BUILD_VERSION__', root), { scope: root.pathname });
  const installing = reg.installing;
  if (installing) await new Promise((resolve, reject) => {
    installing.addEventListener('statechange', () => {
      if (installing.state === 'activated') resolve();
      else if (installing.state === 'redundant') reject(new Error('Kunde inte uppdatera webbens krypteringsdel. Ladda om sidan.'));
    });
  });
  await navigator.serviceWorker.ready;
  return reg;
})();
registration.catch(error => { status.textContent = error.message; button.disabled = true; });
form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'Låser upp…';
  try {
    const reg = await registration;
    const result = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('Upplåsningen tog för lång tid. Försök igen.')), 60000);
      channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      reg.active.postMessage({ type: 'unlock', username: username.value, password: input.value }, [channel.port2]);
      username.value = '';
      input.value = '';
    });
    if (!result.ok) throw new Error('Kunde inte låsa upp. Kontrollera användarnamn och lösenord.');
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    if (location.pathname === new URL('gate.html', root).pathname) location.replace(root.href);
    else location.reload();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
