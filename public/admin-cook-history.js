let cookHistoryEntries = [];
let filteredCookHistoryEntries = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('cook-history-search').addEventListener('input', applyCookHistoryFilters);
  document.getElementById('cook-history-from').addEventListener('change', applyCookHistoryFilters);
  document.getElementById('cook-history-to').addEventListener('change', applyCookHistoryFilters);
  document.getElementById('cook-history-changed-only').addEventListener('change', applyCookHistoryFilters);
  document.getElementById('cook-history-last-month').addEventListener('click', applyLastMonthPreset);
  document.getElementById('cook-history-clear-filters').addEventListener('click', clearCookHistoryFilters);
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
  const toDate = document.getElementById('cook-history-to').value;
  const changedOnly = document.getElementById('cook-history-changed-only').checked;

  filteredCookHistoryEntries = cookHistoryEntries.filter(entry => {
    const cookedDate = String(entry.cooked_date || '').slice(0, 10);
    const matchesQuery = !query || [
      entry.meal_name,
      entry.planned_meal_name,
      entry.notes,
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
    const matchesFromDate = !fromDate || cookedDate >= fromDate;
    const matchesToDate = !toDate || cookedDate <= toDate;
    const matchesChangedOnly = !changedOnly || !entry.was_planned;
    return matchesQuery && matchesFromDate && matchesToDate && matchesChangedOnly;
  });

  renderCookHistory();
  renderCookHistorySummary();
}

function applyLastMonthPreset() {
  const today = new Date();
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  document.getElementById('cook-history-from').value = toDateInputValue(lastMonthStart);
  document.getElementById('cook-history-to').value = toDateInputValue(lastMonthEnd);
  applyCookHistoryFilters();
}

function clearCookHistoryFilters() {
  document.getElementById('cook-history-search').value = '';
  document.getElementById('cook-history-from').value = '';
  document.getElementById('cook-history-to').value = '';
  document.getElementById('cook-history-changed-only').checked = false;
  applyCookHistoryFilters();
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

function renderCookHistorySummary() {
  const meta = document.getElementById('cook-history-summary-meta');
  const summary = document.getElementById('cook-history-summary');
  if (!meta || !summary) return;

  if (!cookHistoryEntries.length) {
    meta.textContent = 'Counts update with your current filters.';
    summary.innerHTML = '<p class="muted">No cook history logged yet.</p>';
    return;
  }

  if (!filteredCookHistoryEntries.length) {
    meta.textContent = 'Counts update with your current filters.';
    summary.innerHTML = '<p class="muted">No meals to summarize for the current filters.</p>';
    return;
  }

  const changedCount = filteredCookHistoryEntries.filter(entry => !entry.was_planned).length;
  meta.textContent = `${filteredCookHistoryEntries.length} logged dinners in view, ${changedCount} changed from plan.`;

  const counts = new Map();
  for (const entry of filteredCookHistoryEntries) {
    const key = entry.meal_id || `unknown:${entry.meal_name || ''}`;
    if (!counts.has(key)) {
      counts.set(key, {
        mealId: entry.meal_id || null,
        mealName: entry.meal_name || 'Unknown meal',
        timesCooked: 0,
        changedCount: 0,
        lastCookedDate: String(entry.cooked_date || '').slice(0, 10),
      });
    }

    const current = counts.get(key);
    current.timesCooked += 1;
    if (!entry.was_planned) current.changedCount += 1;
    const cookedDate = String(entry.cooked_date || '').slice(0, 10);
    if (cookedDate && cookedDate > current.lastCookedDate) {
      current.lastCookedDate = cookedDate;
    }
  }

  const topMeals = [...counts.values()]
    .sort((a, b) => (
      b.timesCooked - a.timesCooked ||
      b.lastCookedDate.localeCompare(a.lastCookedDate) ||
      a.mealName.localeCompare(b.mealName)
    ))
    .slice(0, 8);

  summary.innerHTML = topMeals.map(item => `
    <article class="history-summary-card">
      <div class="history-summary-count">${item.timesCooked}</div>
      <div class="history-summary-body">
        <div class="history-summary-name">${buildCookHistoryMealCell(item.mealId, item.mealName)}</div>
        <div class="history-summary-meta">
          Last cooked ${esc(fmtHistoryDate(item.lastCookedDate))}
          ${item.changedCount ? ` · ${item.changedCount} changed from plan` : ''}
        </div>
      </div>
    </article>
  `).join('');
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

function toDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
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
