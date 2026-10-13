// Shared disclosure menu for project pages and the Treageweb entrance.
(() => {
  const header = document.querySelector('.hero > .container');
  if (!header || header.querySelector('.site-menu')) return;
  const switcher = header.querySelector('.project-switcher');
  const menu = document.createElement('details');
  menu.className = 'site-menu';
  menu.innerHTML = `<summary aria-label="Öppna menyn" aria-expanded="false"><span class="menu-icon-open" aria-hidden="true">☰</span><span class="menu-icon-close" aria-hidden="true">✕</span><span>Meny</span></summary><div class="site-menu-panel"><div class="site-menu-actions"></div></div>`;
  const summary = menu.querySelector('summary');
  const panel = menu.querySelector('.site-menu-panel');
  const actions = menu.querySelector('.site-menu-actions');
  function section(label, links) {
    if (!links.length) return;
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', label);
    const title = document.createElement('p');
    title.className = 'site-menu-label'; title.textContent = label;
    nav.append(title);
    for (const link of links) {
      const copy = link.cloneNode(true);
      copy.className = 'site-menu-link';
      nav.append(copy);
    }
    panel.insertBefore(nav, actions);
  }
  let projects = [...(switcher?.querySelectorAll('nav a') || [])];
  if (!projects.length) projects = [...document.querySelectorAll('.project-menu > a')].map(card => {
    const link = document.createElement('a');
    link.href = card.getAttribute('href');
    link.textContent = card.querySelector('h2')?.textContent || card.textContent;
    return link;
  });
  section('Projekt', projects);
  header.append(menu);
  if (switcher) switcher.hidden = true;
  const sync = () => {
    summary.setAttribute('aria-expanded', String(menu.open));
    summary.setAttribute('aria-label', menu.open ? 'Stäng menyn' : 'Öppna menyn');
  };
  menu.addEventListener('toggle', sync);
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false; sync(); summary.focus();
    }
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('a')) { menu.open = false; sync(); }
  });
  document.dispatchEvent(new Event('treage-menu-ready'));
})();
