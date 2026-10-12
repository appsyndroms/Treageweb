document.querySelectorAll('.table-block').forEach(block => {
  const body = block.querySelector('tbody');
  const rows = [...body.rows].filter(row => !row.classList.contains('empty'));
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
    const cell = row.cells[index], saved = cell.querySelector('[data-sort-value]');
    if (saved) return saved.dataset.sortValue === '' ? null : Number(saved.dataset.sortValue);
    const text = cell.textContent.trim(); return text === '—' ? null : text;
  };
  function show() {
    const query = input.value.toLocaleLowerCase('sv');
    const matches = sorted.filter(row => row.textContent.toLocaleLowerCase('sv').includes(query));
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
        return direction * (typeof x === 'number' ? x - y : collator.compare(x, y));
      }); page = 0; show();
    });
  });
  input.addEventListener('input', () => {page = 0; show();});
  prev.addEventListener('click', () => {page--; show();});
  next.addEventListener('click', () => {page++; show();});
  show();
});
