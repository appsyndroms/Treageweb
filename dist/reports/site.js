// One controller per table, including rows loaded or replaced after page load.
(() => {
  const controllers = new WeakMap();
  const collator = new Intl.Collator('sv', {numeric: true, sensitivity: 'base'});
  const missing = /^(?:[—–-]|saknas|n\/a|ej tillgängligt?)$/i;
  function parse(raw) {
    const text = String(raw).trim();
    if (!text || missing.test(text)) return null;
    if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text)) {
      const date = Date.parse(text);
      if (Number.isFinite(date)) return date;
    }
    let number = text.replace(/[\s\u00a0\u202f]/g, '').replace(/[−–]/g, '-');
    number = number.replace(/(?:%|kr|sek|pp|procentenheter|dagar|instrumentdagar|rapporthändelser|händelser|rader|instrument|st)$/i, '');
    if (number.includes(',')) number = number.replace(/\./g, '').replace(',', '.');
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(number) ? Number(number) : text;
  }
  function value(row, index) {
    const cell = row.cells[index];
    const saved = cell.matches('[data-sort-value]') ? cell : cell.querySelector('[data-sort-value]');
    if (saved) return parse(saved.dataset.sortValue);
    const main = cell.cloneNode(true);
    main.querySelectorAll('.subtle, small, details').forEach(detail => detail.remove());
    return parse(main.textContent);
  }
  function enhance(table) {
    if (controllers.has(table) || !table.tHead || !table.tBodies.length) return;
    const headers = [...table.tHead.rows[table.tHead.rows.length - 1].cells];
    if (!headers.length) return;
    const wrapper = table.closest('.table-wrapper') || table;
    let block = wrapper.parentElement;
    if (!block.classList.contains('table-block') || block.querySelectorAll('table').length !== 1) {
      block = document.createElement('div'); block.className = 'table-block';
      wrapper.before(block); block.append(wrapper);
    }
    let controls = block.querySelector('.table-controls');
    if (!controls) {
      controls = document.createElement('div'); controls.className = 'table-controls';
      controls.innerHTML = '<label>Sök i tabellen <input type="search"></label><span class="row-count" aria-live="polite"></span><button type="button" data-prev>Föregående</button><button type="button" data-next>Nästa</button>';
      wrapper.before(controls);
    }
    const input = controls.querySelector('input'), count = controls.querySelector('.row-count');
    const prev = controls.querySelector('[data-prev]'), next = controls.querySelector('[data-next]');
    let body, rows = [], sorted = [], page = 0, column = -1, direction = 1, expiryTimer;
    const size = 25;
    const observer = new MutationObserver(refresh);
    const observe = () => observer.observe(table, {childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['data-sort-value', 'data-signal-expires']});
    function show() {
      observer.disconnect();
      try {
        const query = input.value.toLocaleLowerCase('sv');
        const live = row => !row.dataset.signalExpires || Date.parse(row.dataset.signalExpires) > Date.now();
        const matches = sorted.filter(row => live(row) && row.textContent.toLocaleLowerCase('sv').includes(query));
        page = Math.min(page, Math.max(0, Math.ceil(matches.length / size) - 1));
        const visible = new Set(matches.slice(page * size, (page + 1) * size));
        rows.forEach(row => { row.hidden = !visible.has(row); });
        const rowSet = new Set(rows), hasLiveRows = rows.some(live);
        [...body.rows].filter(row => !rowSet.has(row)).forEach(row => { row.hidden = hasLiveRows; });
        controls.hidden = !rows.length;
        count.textContent = matches.length ? `${page * size + 1}–${Math.min((page + 1) * size, matches.length)} av ${matches.length}` : 'Inga träffar';
        prev.disabled = page === 0; next.disabled = (page + 1) * size >= matches.length;
      } finally { observe(); }
    }
    function order() {
      if (column < 0) return;
      const values = new Map(rows.map(row => [row, value(row, column)]));
      sorted.sort((a, b) => {
        const x = values.get(a), y = values.get(b);
        if (x === null) return y === null ? 0 : 1;
        if (y === null) return -1;
        return direction * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
      });
      observer.disconnect();
      const fragment = document.createDocumentFragment();
      sorted.forEach(row => fragment.append(row)); body.append(fragment);
    }
    function refresh() {
      body = table.tBodies[0];
      if (!body) return;
      rows = [...body.rows].filter(row => !row.classList.contains('empty') && row.cells.length === headers.length &&
        !row.querySelector('td.empty') && [...row.cells].every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
      sorted = rows.slice(); page = 0; order(); show();
      if (!expiryTimer && rows.some(row => row.dataset.signalExpires)) expiryTimer = setInterval(() => {
        if (!table.isConnected) { clearInterval(expiryTimer); return; }
        show();
      }, 30000);
    }
    headers.forEach((header, index) => {
      header.scope = 'col'; header.setAttribute('aria-sort', 'none');
      let button = header.querySelector('button');
      if (!button) {
        button = document.createElement('button'); button.type = 'button';
        while (header.firstChild) button.append(header.firstChild);
        header.append(button);
      }
      button.title = 'Sortera stigande eller fallande';
      button.addEventListener('click', () => {
        direction = column === index ? -direction : 1; column = index;
        headers.forEach(h => h.setAttribute('aria-sort', 'none'));
        header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
        page = 0; order(); show();
      });
    });
    input.addEventListener('input', () => { page = 0; show(); });
    prev.addEventListener('click', () => { page--; show(); });
    next.addEventListener('click', () => { page++; show(); });
    controllers.set(table, {refresh});
    refresh();
  }
  document.querySelectorAll('table').forEach(enhance);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    const parent = node.closest('table');
    if (parent && !controllers.has(parent)) enhance(parent);
    if (node.matches('table')) enhance(node);
    node.querySelectorAll('table').forEach(enhance);
  }))).observe(document.body, {childList: true, subtree: true});
})();

// Reopening yesterday's static bundle must not resurrect expired signals.
const counters = document.querySelectorAll('[data-count-action]');
if (counters.length) {
  fetch('./data.json').then(response => response.json()).then(data => {
    const refresh = () => counters.forEach(counter => {
      counter.textContent = data.signals.signals.filter(signal =>
        signal.action === counter.dataset.countAction && Date.parse(signal.expires_at) > Date.now()).length;
    });
    refresh();
    setInterval(refresh, 30000);
  }).catch(() => counters.forEach(counter => { counter.textContent = '—'; }));
}
