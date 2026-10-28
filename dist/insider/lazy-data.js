(() => {
  const targets = [...document.querySelectorAll('[data-page-table]')];
  if (!targets.length) return;
  const page = targets[0].dataset.pageTable;
  let pending;
  const load = () => {
    if (!pending) pending = fetch(`./data/pages/${encodeURIComponent(page)}.json?v=${encodeURIComponent(targets[0].dataset.pageVersion)}`)
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(data => {
        for (const part of data.tables) {
          const body = document.getElementById(part.id);
          if (body) { body.innerHTML = part.html; body.removeAttribute('data-page-table'); }
        }
        document.dispatchEvent(new CustomEvent('treage:tables-loaded'));
      }).catch(error => {
        pending = null;
        targets.forEach(body => {
          body.replaceChildren();
          const row = body.insertRow(), cell = row.insertCell(); cell.colSpan = 30;
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = 'Underlaget kunde inte laddas. Försök igen';
          button.addEventListener('click', load); cell.append(button);
        });
      });
    return pending;
  };
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, {rootMargin: '200px'});
    targets.forEach(body => observer.observe(body));
  } else load();
})();
