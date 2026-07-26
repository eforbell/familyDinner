// Plan the Week — the weekly planning surface.
// Weeks are planned explicitly (plan_days); the rotation is only a suggestion
// source, surfaced per-day and through the autofill bar.

let weekOffset = 1; // default to next week — that's the weekly chore
let planData = null;
let currentMember = JSON.parse(localStorage.getItem('fd_member') || 'null');
let lastGroceryList = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('plan-prev-btn').addEventListener('click', () => shiftWeek(-1));
  document.getElementById('plan-fwd-btn').addEventListener('click', () => shiftWeek(1));
  document.getElementById('plan-this-btn').addEventListener('click', () => setWeek(0));
  document.getElementById('plan-next-btn').addEventListener('click', () => setWeek(1));
  document.getElementById('autofill-rotation-btn').addEventListener('click', () => autofill('rotation'));
  document.getElementById('autofill-lastweek-btn').addEventListener('click', () => autofill('previous_week'));
  document.getElementById('magic-grocery-generate-btn').addEventListener('click', openMagicGroceryModal);
  document.getElementById('magic-grocery-run-btn').addEventListener('click', generateMagicGrocery);
  document.getElementById('magic-grocery-modal-close').addEventListener('click', closeMagicGroceryModal);
  document.getElementById('magic-grocery-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeMagicGroceryModal();
  });
  document.getElementById('print-grocery-btn').addEventListener('click', printMagicGrocery);
  loadPlan();
});

function setWeek(offset) {
  weekOffset = offset;
  loadPlan();
}

function shiftWeek(delta) {
  weekOffset += delta;
  loadPlan();
}

function weekStartForOffset(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return localDateStr(d);
}

async function loadPlan() {
  renderWeekSwitch();
  try {
    const res = await fetch(`api/plan?week_start=${weekStartForOffset(weekOffset)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load plan');
    planData = data;
    render();
  } catch (err) {
    setStatus(err.message || 'Could not load the plan.', true);
  }
}

async function savePlanDay(date, mealId) {
  try {
    const res = await fetch('api/plan/day', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        meal_id: mealId,
        created_by: currentMember ? currentMember.name : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    await loadPlan();
    setStatus(mealId ? 'Saved.' : 'Cleared.', false);
  } catch (err) {
    setStatus(err.message || 'Save failed.', true);
  }
}

async function autofill(source) {
  const btn = document.getElementById(source === 'rotation' ? 'autofill-rotation-btn' : 'autofill-lastweek-btn');
  btn.disabled = true;
  try {
    const res = await fetch('api/plan/autofill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week_start: weekStartForOffset(weekOffset),
        source,
        created_by: currentMember ? currentMember.name : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Autofill failed');
    planData = data.plan;
    render();
    setStatus(data.filled
      ? `Filled ${data.filled} night${data.filled === 1 ? '' : 's'}.`
      : 'Nothing to fill — no source meals for the empty nights.', !data.filled);
  } catch (err) {
    setStatus(err.message || 'Autofill failed.', true);
  } finally {
    btn.disabled = false;
  }
}

function pickDay(date) {
  const day = findDay(date);
  const d = new Date(date + 'T12:00:00');
  MealPicker.open({
    title: `Dinner for ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
    subtitle: 'Search the meal library, or clear the day.',
    currentMealId: day && day.meal ? day.meal.id : null,
    allowClear: Boolean(day && day.meal),
    onSelect: meal => savePlanDay(date, meal ? meal.id : null),
  });
}

async function toggleOrderIn(date, on) {
  try {
    if (on) {
      await fetch('api/order-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, created_by: currentMember ? currentMember.name : null }),
      });
    } else {
      await fetch(`api/order-in/${date}`, { method: 'DELETE' });
    }
    await loadPlan();
  } catch (err) {
    setStatus('Could not update order-in.', true);
  }
}

function findDay(date) {
  return planData && planData.days ? planData.days.find(day => day.date === date) : null;
}

// ── Magic Grocery ──────────────────────────────────────────────
function openMagicGroceryModal() {
  const modal = document.getElementById('magic-grocery-modal');
  modal.classList.remove('hidden');
  document.getElementById('magic-grocery-title').textContent = 'Magic Grocery';
  document.getElementById('magic-grocery-subtitle').textContent = planData
    ? `Generate a grocery list for ${fmtMonthDay(planData.week_start)} – ${fmtMonthDay(planData.days[6].date)}.`
    : 'Generate a grocery list from the week currently in focus.';
  document.getElementById('magic-grocery-notes').focus();
}

function closeMagicGroceryModal() {
  document.getElementById('magic-grocery-modal').classList.add('hidden');
}

async function generateMagicGrocery() {
  const button = document.getElementById('magic-grocery-run-btn');
  button.disabled = true;
  button.textContent = 'Building list...';

  try {
    const weekStart = planData && planData.week_start ? planData.week_start : weekStartForOffset(weekOffset);
    const res = await fetch('api/magic-grocery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_notes: document.getElementById('magic-grocery-notes').value,
        week_start_date: weekStart,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Magic Grocery failed');

    lastGroceryList = data.list;
    renderMagicGroceryResult(data);
    setStatus('Magic Grocery built a weekly grocery list.', false);
  } catch (err) {
    setStatus(err.message || 'Magic Grocery failed.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Generate list';
  }
}

function renderMagicGroceryResult(data) {
  const result = document.getElementById('magic-grocery-result');
  const list = document.getElementById('magic-grocery-list');
  result.classList.remove('hidden');

  const lines = [data.list.title || 'Weekly Grocery List', ''];
  for (const section of data.list.sections || []) {
    lines.push(`${section.name}:`);
    for (const item of section.items || []) {
      const usedFor = (item.used_for || []).length ? ` (${item.used_for.join(', ')})` : '';
      lines.push(`- ${item.name}${item.quantity ? ` — ${item.quantity}` : ''}${usedFor}`);
    }
    lines.push('');
  }

  if ((data.list.prep_notes || []).length) {
    lines.push('Prep notes:');
    for (const note of data.list.prep_notes) {
      lines.push(`- ${note}`);
    }
  }

  list.textContent = lines.join('\n').trim();
  document.getElementById('magic-grocery-summary').textContent =
    `Built from ${data.context_summary.meal_count} planned cook-at-home meals for ${data.context_summary.week_start} → ${data.context_summary.week_end}.`;
  document.getElementById('print-grocery-btn').classList.remove('hidden');
}

function printMagicGrocery() {
  if (!lastGroceryList) {
    setStatus('Generate a grocery list first, then print it.', true);
    return;
  }

  const title = lastGroceryList.title || 'Weekly Grocery List';
  const body = document.getElementById('magic-grocery-list').textContent || '';

  // Print an isolated document in its own window instead of toggling a
  // print-mode class on the live app page. iOS Safari's print pipeline
  // doesn't reliably hide the app's fixed-position/backdrop-filter
  // elements (nav bars, modal overlay) even after a genuine "leaving
  // print" signal, so anything printed from the same document as the
  // app UI is liable to render app screenshots instead of plain text.
  // A blank popup has nothing else in it to leak through.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    setStatus('Enable pop-ups to use the print view.', true);
    return;
  }

  printWindow.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'color:#111;background:#fff;padding:12mm;margin:0;}' +
    'h1{font-size:1.6rem;margin:0 0 0.75rem;}' +
    'pre{font-family:inherit;font-size:1rem;line-height:1.45;margin:0;white-space:pre-wrap;}' +
    '</style></head><body><h1 id="pg-title"></h1><pre id="pg-body"></pre></body></html>'
  );
  printWindow.document.close();

  printWindow.document.title = title;
  printWindow.document.getElementById('pg-title').textContent = title;
  printWindow.document.getElementById('pg-body').textContent = body;

  printWindow.focus();
  printWindow.print();
}

// ── Render ────────────────────────────────────────────────────
function render() {
  renderRange();
  renderProgress();
  renderAutofill();
  renderDays();
}

function renderWeekSwitch() {
  document.getElementById('plan-this-btn').classList.toggle('active', weekOffset === 0);
  document.getElementById('plan-next-btn').classList.toggle('active', weekOffset === 1);
}

function renderRange() {
  const badge = document.getElementById('plan-range-badge');
  if (!planData) { badge.textContent = ''; return; }
  const label = weekOffset === 0 ? 'This week'
    : weekOffset === 1 ? 'Next week'
    : weekOffset === -1 ? 'Last week'
    : weekOffset > 1 ? `${weekOffset} weeks ahead` : `${-weekOffset} weeks back`;
  const end = planData.days && planData.days[6] ? planData.days[6].date : planData.week_start;
  const rangeText = `${label} · ${fmtMonthDay(planData.week_start)} – ${fmtMonthDay(end)}`;
  badge.textContent = rangeText;
  const groceryLabel = document.getElementById('magic-grocery-week-label');
  if (groceryLabel) groceryLabel.textContent = `Builds from ${fmtMonthDay(planData.week_start)} – ${fmtMonthDay(end)}.`;
}

function plannedCount() {
  if (!planData) return 0;
  return planData.days.filter(day => day.meal || day.order_in).length;
}

function renderProgress() {
  const el = document.getElementById('plan-progress');
  const count = plannedCount();
  el.textContent = count === 7 ? 'All 7 nights planned ✓' : `${count} of 7 nights planned`;
  el.classList.toggle('done', count === 7);
}

function renderAutofill() {
  const bar = document.getElementById('plan-autofill');
  const emptyCount = 7 - plannedCount();
  bar.classList.toggle('hidden', emptyCount === 0);
  if (emptyCount > 0) {
    document.getElementById('plan-autofill-title').textContent =
      `Fill the ${emptyCount === 7 ? '' : emptyCount + ' '}empty night${emptyCount === 1 ? '' : 's'}`;
  }
}

function renderDays() {
  const wrap = document.getElementById('plan-days');
  if (!planData) return;
  wrap.innerHTML = planData.days.map(day => buildDayRow(day)).join('');

  wrap.querySelectorAll('[data-pick]').forEach(btn =>
    btn.addEventListener('click', () => pickDay(btn.dataset.pick)));
  wrap.querySelectorAll('[data-clear]').forEach(btn =>
    btn.addEventListener('click', () => savePlanDay(btn.dataset.clear, null)));
  wrap.querySelectorAll('[data-suggest]').forEach(btn =>
    btn.addEventListener('click', () => savePlanDay(btn.dataset.suggest, Number(btn.dataset.mealId))));
  wrap.querySelectorAll('[data-order-in]').forEach(btn =>
    btn.addEventListener('click', () => toggleOrderIn(btn.dataset.orderIn, btn.dataset.on === '1')));
}

function buildDayRow(day) {
  const d = new Date(day.date + 'T12:00:00');
  const shortDay = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const meal = day.meal;
  const isExplicitOrderIn = Boolean(day.order_in && !(meal && meal.is_protected));
  const isProtectedNight = Boolean(meal && meal.is_protected);

  let body;
  let actions;

  if (isExplicitOrderIn || isProtectedNight) {
    const label = isProtectedNight && meal ? esc(meal.name) : 'Order In Night';
    body = `<span class="plan-meal-name">🛵 ${label}</span>
            <span class="plan-meal-meta"><span class="mp-chip">no cooking</span></span>`;
    actions = isExplicitOrderIn
      ? `<button class="btn-ghost" type="button" data-order-in="${day.date}" data-on="0">Cancel order-in</button>`
      : `<button class="btn-ghost" type="button" data-pick="${day.date}">Change</button>
         <button class="btn-ghost plan-clear" type="button" data-clear="${day.date}">Clear</button>`;
  } else if (meal) {
    const chips = [
      meal.cook || '',
      ratingDot(meal.kid_rating),
      meal.total_time_min ? fmtTime(meal.total_time_min) : '',
      meal.is_new ? '★ NEW' : '',
    ].filter(Boolean).map(chip => `<span class="mp-chip">${esc(chip)}</span>`).join('');
    body = `<span class="plan-meal-name">${esc(meal.name)}</span>
            <span class="plan-meal-meta">${chips}</span>`;
    actions = `
      ${meal.recipe_id ? `<a class="btn-ghost" href="recipes/${meal.recipe_id}">Recipe</a>` : ''}
      <button class="btn-ghost" type="button" data-pick="${day.date}">Change</button>
      <button class="btn-ghost plan-clear" type="button" data-clear="${day.date}">Clear</button>
    `;
  } else {
    const suggestion = day.rotation_suggestion;
    body = `<span class="plan-meal-name muted">Nothing planned</span>
            ${suggestion ? `
              <span class="plan-suggestion">
                Rotation suggests <strong>${esc(suggestion.name)}</strong>
                <button class="plan-suggestion-use" type="button"
                        data-suggest="${day.date}" data-meal-id="${suggestion.id}">Use it</button>
              </span>` : ''}`;
    actions = `
      <button class="btn-primary plan-pick-btn" type="button" data-pick="${day.date}">Pick a meal</button>
      <button class="btn-ghost" type="button" data-order-in="${day.date}" data-on="1">🛵 Order in</button>
    `;
  }

  return `
    <div class="plan-day${day.is_today ? ' today' : ''}${!meal && !day.order_in ? ' empty' : ''}">
      <div class="plan-day-date">
        <span class="plan-day-name">${shortDay}</span>
        <span class="plan-day-num">${monthDay}</span>
        ${day.is_today ? '<span class="plan-today-tag">today</span>' : ''}
      </div>
      <div class="plan-day-body">${body}</div>
      <div class="plan-day-actions">${actions}</div>
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────
function setStatus(message, isError) {
  const el = document.getElementById('plan-status');
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.toggle('is-error', Boolean(isError));
  clearTimeout(setStatus._timer);
  if (!isError) setStatus._timer = setTimeout(() => el.classList.add('hidden'), 2200);
}

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtMonthDay(dateStr) {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function ratingDot(rating) {
  if (!rating) return '';
  for (const dot of ['🟢', '🟡', '🔵', '🔴']) {
    if (rating.includes(dot)) return dot;
  }
  return '';
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
