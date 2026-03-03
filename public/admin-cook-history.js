let cookHistoryEntries = [];
let filteredCookHistoryEntries = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cook-history-search').addEventListener('input', applyCookHistoryFilters);
  document.getElementById('cook-history-from').addEventListener('change', applyCookHistoryFilters);
  loadCookHistory();
});

async function loadCookHistory() {
  try {
    const res = await fetch('../api/cook-log?limit=150');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load cook history');
    cookHistoryEntries = Array.isArray(data.entries) ? data.entries : [];
    applyCookHistoryFilters();
  } catch (err) {
    setStatus(err.message || 'Could not load cook history.', true);
    const wrap = document.getElementById('cook-history-table-wrap');
    if (wrap) {
      wrap.innerHTML = '<p class="muted">Could not load cook history.</p>';
    }
  }
}

function applyCookHistoryFilters() {
  const query = document.getElementById('cook-history-search').value.trim().toLowerCase();
  const fromDate = document.getElementById('cook-history-from').value;

  filteredCookHistoryEntries = cookHistoryEntries.filter(entry => {
    const matchesQuery = !query || [
      entry.meal_name,
      entry.planned_meal_name,
      entry.notes,
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
    const matchesDate = !fromDate || String(entry.cooked_date || '').slice(0, 10) >= fromDate;
    return matchesQuery && matchesDate;
  });

  renderCookHistory();
}

function renderCookHistory() {
  const meta = document.getElementById('cook-history-meta');
  const wrap = document.getElementById('cook-history-table-wrap');
  if (!meta || !wrap) return;

  meta.textContent = filteredCookHistoryEntries.length
    ? `${filteredCookHistoryEntries.length} of ${cookHistoryEntries.length} logged dinners shown.`
    : 'Recent nights logged from the dinner plan.';

  if (!cookHistoryEntries.length) {
    wrap.innerHTML = '<p class="muted">No cook history logged yet.</p>';
    return;
  }

  if (!filteredCookHistoryEntries.length) {
    wrap.innerHTML = '<p class="muted">No cook history matches those filters.</p>';
    return;
  }

  wrap.innerHTML = `
    <table class="cook-history-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Cooked</th>
          <th scope="col">Plan</th>
          <th scope="col">Result</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${filteredCookHistoryEntries.map(entry => `
          <tr>
            <td>${esc(fmtHistoryDate(entry.cooked_date))}</td>
            <td>${buildCookHistoryMealCell(entry.meal_id, entry.meal_name || 'Unknown meal')}</td>
            <td>${entry.planned_meal_id ? buildCookHistoryMealCell(entry.planned_meal_id, entry.planned_meal_name || 'Unknown meal') : '—'}</td>
            <td>${entry.was_planned ? 'As planned' : 'Changed'}</td>
            <td>${esc(entry.notes || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function buildCookHistoryMealCell(mealId, mealName) {
  if (!mealId) return esc(mealName || 'Unknown meal');
  return `<a class="cook-history-meal-link" href="../admin/meals?mealId=${mealId}">${esc(mealName)}</a>`;
}

function fmtHistoryDate(dateStr) {
  const normalized = String(dateStr || '').slice(0, 10);
  if (!normalized) return '—';

  const date = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateStr);

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function setStatus(message, isError) {
  const el = document.getElementById('cook-history-status');
  el.textContent = message;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
