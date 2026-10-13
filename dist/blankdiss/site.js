// Enhance saved project tables with the same search, sorting and pagination.
document.querySelectorAll('.table-wrapper').forEach(wrapper => {
  if (!wrapper.querySelector('thead') || !wrapper.querySelector('tbody') || wrapper.querySelector('.trace-table')) return;
  let block = wrapper.closest('.table-block');
  if (!block) {
    block = document.createElement('div'); block.className = 'table-block';
    wrapper.before(block); block.append(wrapper);
  }
  if (!block.querySelector('.table-controls')) {
    const controls = document.createElement('div'); controls.className = 'table-controls'; controls.hidden = true;
    controls.innerHTML = '<label>Sök i tabellen <input type="search"></label><span class="row-count" aria-live="polite"></span><button type="button" data-prev>Föregående</button><button type="button" data-next>Nästa</button>';
    wrapper.before(controls);
  }
  wrapper.querySelectorAll('thead th').forEach(header => {
    if (header.querySelector('button')) return;
    const button = document.createElement('button'); button.type = 'button';
    while (header.firstChild) button.append(header.firstChild);
    header.append(button);
  });
});

document.querySelectorAll('.table-block').forEach(block => {
  const body = block.querySelector('tbody');
  const columns = block.querySelectorAll('thead th').length;
  const rows = [...body.rows].filter(row => !row.classList.contains('empty') && row.cells.length === columns && !row.querySelector('td.empty'));
  if (!rows.length) return;
  const controls = block.querySelector('.table-controls');
  controls.hidden = false;
  const input = controls.querySelector('input');
  const count = controls.querySelector('.row-count');
  const prev = controls.querySelector('[data-prev]');
  const next = controls.querySelector('[data-next]');
  let page = 0, sorted = rows.slice(), direction = 1, column = -1;
  const size = 25;
  const collator = new Intl.Collator('sv', {numeric: true, sensitivity: 'base'});
  const value = (row, index) => {
    const cell = row.cells[index], saved = cell.matches('[data-sort-value]') ? cell : cell.querySelector('[data-sort-value]');
    if (saved) {
      const raw = saved.dataset.sortValue;
      if (raw === '') return null;
      return Number.isFinite(Number(raw)) ? Number(raw) : raw;
    }
    const text = cell.textContent.trim();
    if (!text || text === '—') return null;
    const numeric = text.replace(/[\s\u00a0%]/g, '').replace('−', '-').replace(',', '.');
    return /^[-+]?\d+(\.\d+)?$/.test(numeric) ? Number(numeric) : text;
  };
  function show() {
    const query = input.value.toLocaleLowerCase('sv');
    const live = row => !row.dataset.signalExpires || Date.parse(row.dataset.signalExpires) > Date.now();
    const matches = sorted.filter(row => live(row) && row.textContent.toLocaleLowerCase('sv').includes(query));
    const empty = body.querySelector('.empty');
    if (empty) empty.hidden = sorted.some(live);
    page = Math.min(page, Math.max(0, Math.ceil(matches.length / size) - 1));
    rows.forEach(row => {row.hidden = true;});
    matches.slice(page * size, (page + 1) * size).forEach(row => {row.hidden = false; body.append(row);});
    count.textContent = matches.length ? `${page * size + 1}–${Math.min((page + 1) * size, matches.length)} av ${matches.length}` : 'Inga träffar';
    prev.disabled = page === 0; next.disabled = (page + 1) * size >= matches.length;
  }
  block.querySelectorAll('th').forEach((header, index) => {
    header.querySelector('button').addEventListener('click', () => {
      direction = column === index ? -direction : 1; column = index;
      block.querySelectorAll('th').forEach(h => h.removeAttribute('aria-sort'));
      header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');
      sorted.sort((a, b) => {
        const x = value(a, index), y = value(b, index);
        if (x === null) return y === null ? 0 : 1;
        if (y === null) return -1;
        return direction * (typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y)));
      }); page = 0; show();
    });
  });
  input.addEventListener('input', () => {page = 0; show();});
  prev.addEventListener('click', () => {page--; show();});
  next.addEventListener('click', () => {page++; show();});
  show();
  if (rows.some(row => row.dataset.signalExpires)) setInterval(show, 30000);
});

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
