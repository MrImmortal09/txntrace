let parsedRows = [];

const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtAmount = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderReviewTable() {
  const tbody = document.getElementById('review-body');
  tbody.innerHTML = '';
  const active = parsedRows.filter((r) => !r.removed);
  document.getElementById('row-count').textContent = `(${active.length})`;

  parsedRows.forEach((row, i) => {
    if (row.removed) return;
    const tr = document.createElement('tr');
    tr.className = 'align-top';

    const amountClass = row.type === 'credit' ? 'text-credit' : 'text-debit';
    const sign = row.type === 'credit' ? '+' : '-';

    tr.innerHTML = `
      <td class="px-4 py-3 whitespace-nowrap text-gray-600">${fmtDate(row.date)}</td>
      <td class="px-4 py-3">
        <input data-idx="${i}" data-field="merchant" value="${row.merchant ? row.merchant.replace(/"/g, '&quot;') : ''}"
               class="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-brand focus:outline-none" />
      </td>
      <td class="px-4 py-3">
        <select data-idx="${i}" data-field="category"
                class="rounded border border-gray-200 bg-white px-2 py-1 text-xs">
          <option value="">—</option>
          ${CATEGORIES.map((c) => `<option value="${c}" ${row.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
      <td class="px-4 py-3 text-right font-semibold ${amountClass}">${sign}₹${fmtAmount(row.amount)}</td>
      <td class="px-4 py-3 text-right">
        <button data-idx="${i}" class="remove-row text-xs font-medium text-gray-400 hover:text-debit">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      parsedRows[idx][field] = e.target.value;
    });
  });
  tbody.querySelectorAll('.remove-row').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      parsedRows[Number(e.target.dataset.idx)].removed = true;
      renderReviewTable();
    });
  });
}

function showError(message) {
  const el = document.getElementById('upload-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

document.getElementById('parse-btn').addEventListener('click', async () => {
  const bank = document.getElementById('bank-input').value.trim();
  const fileInput = document.getElementById('file-input');
  const file = fileInput.files[0];

  document.getElementById('upload-error').classList.add('hidden');
  document.getElementById('success-banner').classList.add('hidden');

  if (!bank) return showError('Enter the bank name first.');
  if (!file) return showError('Choose a statement file first.');

  const btn = document.getElementById('parse-btn');
  btn.disabled = true;
  btn.textContent = 'Parsing…';

  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/statements/parse', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to parse statement.');

    parsedRows = data.rows.map((r) => ({ ...r, category: '' }));
    renderReviewTable();
    document.getElementById('review-section').classList.remove('hidden');
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Parse statement';
  }
});

document.getElementById('commit-btn').addEventListener('click', async () => {
  const bank = document.getElementById('bank-input').value.trim();
  const rows = parsedRows.filter((r) => !r.removed);
  if (rows.length === 0) return showError('Nothing left to import.');

  const btn = document.getElementById('commit-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank, rows }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to import.');

    const banner = document.getElementById('success-banner');
    banner.textContent = `Imported ${data.imported} transaction(s).` +
      (data.skipped_duplicates > 0 ? ` Skipped ${data.skipped_duplicates} already-imported duplicate(s).` : '');
    banner.classList.remove('hidden');

    parsedRows = [];
    document.getElementById('review-section').classList.add('hidden');
    document.getElementById('file-input').value = '';
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import into TxnTrace';
  }
});
