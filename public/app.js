// ── State ────────────────────────────────────────────────────
let currentMember = JSON.parse(localStorage.getItem('fd_member') || 'null');
let weekData      = null;
let allMeals      = [];
let swapTarget    = null;  // { date, context }
let todayDate     = null;
let tonightMealId = null;

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateWhoBtn();
  await Promise.all([loadWeek(), loadAllMeals()]);

  if (!currentMember) {
    // First visit — show member picker after a brief delay so the page renders
    setTimeout(openMemberPicker, 400);
  }
});

// ── Data Fetching ─────────────────────────────────────────────
async function loadWeek() {
  try {
    const res  = await fetch('/api/week');
    weekData   = await res.json();
    renderWeekBadge();
    renderTonight();
    renderWeekGrid();
  } catch (e) {
    console.error('Failed to load week', e);
  }
}

async function loadAllMeals() {
  try {
    const res = await fetch('/api/meals');
    allMeals  = await res.json();
  } catch (e) {
    console.error('Failed to load meals', e);
  }
}

// ── Render: Week Badge ────────────────────────────────────────
function renderWeekBadge() {
  if (!weekData) return;
  document.getElementById('week-badge').textContent = `Week ${weekData.rotation_week} of 3`;
}

// ── Render: Tonight ───────────────────────────────────────────
function renderTonight() {
  if (!weekData) return;

  const today = weekData.days.find(d => d.is_today);
  if (!today) return;

  todayDate    = today.date;
  const meal   = today.meal;
  const loading = document.getElementById('tonight-loading');
  const content = document.getElementById('tonight-content');

  loading.classList.add('hidden');
  content.classList.remove('hidden');

  document.getElementById('tonight-day').textContent =
    new Date(today.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (!meal) {
    document.getElementById('tonight-name').textContent = 'Nothing planned';
    return;
  }

  tonightMealId = meal.id;

  if (meal.is_protected) {
    document.getElementById('tonight-name').textContent = 'Order In Night 🛵';
    document.getElementById('tonight-notes').textContent = meal.notes || '';
    document.getElementById('tonight-meta').innerHTML = '<span class="muted">Protected night — no cooking</span>';
    document.querySelector('.tonight-actions').classList.add('hidden');
    return;
  }

  document.getElementById('tonight-name').textContent = meal.name;
  document.getElementById('tonight-notes').textContent = meal.notes || '';
  document.getElementById('tonight-meta').innerHTML = buildMetaBadges(meal);

  // Details panel
  const tips = document.getElementById('tonight-tips');
  tips.textContent = meal.recipe_tips || '';
  if (!meal.recipe_tips) tips.parentElement.style.display = 'none';

  const timing = document.getElementById('tonight-timing');
  if (meal.active_time_min || meal.total_time_min) {
    timing.innerHTML = '';
    if (meal.active_time_min)
      timing.innerHTML += `<span class="timing-chip"><strong>${meal.active_time_min}m</strong> active</span>`;
    if (meal.total_time_min)
      timing.innerHTML += `<span class="timing-chip"><strong>${fmtTime(meal.total_time_min)}</strong> total</span>`;
  } else {
    timing.parentElement.style.display = 'none';
  }

  const equip = document.getElementById('tonight-equipment');
  if (meal.equipment && meal.equipment.length) {
    equip.textContent = '🍳 ' + meal.equipment.join(', ');
  }

  renderVotes('tonight-votes', 'tonight-vote-display', meal.id);
}

// ── Render: Week Grid ─────────────────────────────────────────
function renderWeekGrid() {
  if (!weekData) return;
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  for (const day of weekData.days) {
    grid.appendChild(buildDayCard(day));
  }
}

function buildDayCard(day) {
  const meal  = day.meal;
  const prot  = meal && meal.is_protected;
  const card  = document.createElement('div');

  card.className = [
    'day-card',
    day.is_today   ? 'today'     : '',
    prot           ? 'protected' : '',
  ].join(' ').trim();

  card.dataset.date   = day.date;
  card.dataset.mealId = meal ? meal.id : '';

  const shortDay = new Date(day.date + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

  let mealHtml;
  if (!meal) {
    mealHtml = '<span class="day-meal-name muted">—</span>';
  } else if (prot) {
    mealHtml = '<span class="day-meal-name protected-night">Order In 🛵</span>';
  } else {
    mealHtml = `<span class="day-meal-name">${esc(meal.name)}</span>`;
  }

  const metaHtml = meal && !prot
    ? `<span style="font-size:1rem">${meal.cook || ''}</span>
       <span style="font-size:0.95rem">${ratingEmoji(meal.kid_rating)}</span>
       ${meal.is_override ? '<span class="override-badge">swapped</span>' : ''}
       ${meal.is_new ? '<span class="new-badge">★ NEW</span>' : ''}`
    : '';

  card.innerHTML = `
    <div class="day-card-header">
      <span class="day-name">${shortDay}</span>
      ${mealHtml}
      <div class="day-meta">${metaHtml}</div>
    </div>
    <div class="day-expand-panel" id="panel-${day.date}">
      ${prot ? '' : buildDayExpandHtml(day)}
    </div>
  `;

  if (!prot) {
    card.querySelector('.day-card-header').addEventListener('click', () =>
      toggleDayPanel(day.date)
    );
  }

  return card;
}

function buildDayExpandHtml(day) {
  const meal = day.meal;
  if (!meal) return '<p class="muted" style="font-size:.85rem">Nothing planned.</p>';

  const notes   = meal.notes    ? `<div class="day-notes">${esc(meal.notes)}</div>` : '';
  const tips    = meal.recipe_tips ? `<div class="day-tips">${esc(meal.recipe_tips)}</div>` : '';
  const timing  = buildTimingHtml(meal);
  const equip   = meal.equipment && meal.equipment.length
    ? `<div class="timing-chip" style="display:inline-block;margin-top:.3rem">🍳 ${esc(meal.equipment.join(', '))}</div>` : '';

  return `
    ${notes}
    ${tips}
    <div class="detail-timing">${timing}</div>
    ${equip}
    <div class="day-actions" style="margin-top:.75rem">
      <div class="vote-buttons" id="day-votes-${day.date}"></div>
      <button class="btn-swap" onclick="openSwap('${day.date}', 'day')">Swap ⇄</button>
    </div>
    <div class="day-vote-display" id="day-vote-display-${day.date}"></div>
  `;
}

function toggleDayPanel(date) {
  const panel = document.getElementById(`panel-${date}`);
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (!isOpen) {
    panel.classList.add('open');
    // Load votes lazily when expanded
    const card = panel.closest('.day-card');
    const mealId = card && card.dataset.mealId;
    if (mealId) renderVotes(`day-votes-${date}`, `day-vote-display-${date}`, mealId);
  } else {
    panel.classList.remove('open');
  }
}

// ── Votes ─────────────────────────────────────────────────────
const REACTIONS = ['❤️', '👍', '👎', '🤷'];

async function renderVotes(btnContainerId, displayId, mealId) {
  const btnContainer = document.getElementById(btnContainerId);
  const display      = document.getElementById(displayId);
  if (!btnContainer) return;

  // Render vote buttons
  btnContainer.innerHTML = REACTIONS.map(r =>
    `<button class="vote-btn" data-reaction="${r}" onclick="castVote(${mealId}, '${r}', '${btnContainerId}', '${displayId}')">${r}</button>`
  ).join('');

  // Fetch & show existing votes
  await refreshVoteDisplay(displayId, mealId, btnContainerId);
}

async function castVote(mealId, reaction, btnContainerId, displayId) {
  if (!currentMember) {
    openMemberPicker(() => castVote(mealId, reaction, btnContainerId, displayId));
    return;
  }
  try {
    const res  = await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meal_id: mealId, member_id: currentMember.id, reaction }),
    });
    const data = await res.json();
    if (data.success) refreshVoteDisplay(displayId, mealId, btnContainerId, data.votes);
  } catch (e) {
    console.error('Vote failed', e);
  }
}

async function refreshVoteDisplay(displayId, mealId, btnContainerId, votes) {
  const display = document.getElementById(displayId);
  if (!display) return;

  if (!votes) {
    try {
      const res = await fetch(`/api/votes/${mealId}`);
      votes = await res.json();
    } catch { return; }
  }

  // Highlight active vote for current member
  if (currentMember && btnContainerId) {
    const myVote = votes.find(v => v.name === currentMember.name);
    document.querySelectorAll(`#${btnContainerId} .vote-btn`).forEach(btn => {
      btn.classList.toggle('active', myVote && btn.dataset.reaction === myVote.reaction);
    });
  }

  // Show vote pills
  display.innerHTML = votes.map(v =>
    `<span class="vote-pill">${v.avatar_emoji} ${v.reaction}</span>`
  ).join('');
}

// ── Tonight Detail Toggle ─────────────────────────────────────
let tonightDetailsOpen = false;
function toggleTonightDetails() {
  tonightDetailsOpen = !tonightDetailsOpen;
  document.getElementById('tonight-details').classList.toggle('hidden', !tonightDetailsOpen);
  document.getElementById('tonight-details-btn').textContent =
    tonightDetailsOpen ? 'Details ▴' : 'Details ▾';
}

// ── Swap Modal ────────────────────────────────────────────────
function openSwap(date, context) {
  swapTarget = { date, context };
  const overlay = document.getElementById('swap-overlay');
  overlay.classList.remove('hidden');

  const d = new Date(date + 'T12:00:00');
  document.getElementById('swap-day-label').textContent =
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const sel = document.getElementById('swap-select');
  sel.innerHTML = allMeals
    .filter(m => !m.is_protected)
    .map(m => `<option value="${m.id}">${m.name}</option>`)
    .join('');

  // Pre-select current meal for this date
  const dayEntry = weekData && weekData.days.find(d => d.date === date);
  if (dayEntry && dayEntry.meal) {
    sel.value = dayEntry.meal.id;
  }
}

function closeSwap() {
  document.getElementById('swap-overlay').classList.add('hidden');
  swapTarget = null;
}

async function confirmSwap() {
  if (!swapTarget) return;
  const mealId = document.getElementById('swap-select').value;
  try {
    await fetch('/api/swap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: swapTarget.date,
        meal_id: mealId,
        created_by: currentMember ? currentMember.name : null,
      }),
    });
    closeSwap();
    await loadWeek();
  } catch (e) {
    console.error('Swap failed', e);
  }
}

async function resetSwap() {
  if (!swapTarget) return;
  try {
    await fetch(`/api/swap/${swapTarget.date}`, { method: 'DELETE' });
    closeSwap();
    await loadWeek();
  } catch (e) {
    console.error('Reset failed', e);
  }
}

// ── Member Picker ─────────────────────────────────────────────
let onMemberPickedCallback = null;

function openMemberPicker(callback) {
  onMemberPickedCallback = callback || null;
  loadAndShowMembers();
  document.getElementById('member-overlay').classList.remove('hidden');
}

async function loadAndShowMembers() {
  const list = document.getElementById('member-list');
  list.innerHTML = '<div class="member-grid"></div>';
  const grid = list.querySelector('.member-grid');

  try {
    const res     = await fetch('/api/members');
    const members = await res.json();
    grid.innerHTML = members.map(m =>
      `<button class="member-btn" onclick="selectMember(${JSON.stringify(JSON.stringify(m))})">
        <span class="member-avatar">${m.avatar_emoji}</span>
        <span>${m.name}</span>
      </button>`
    ).join('');
  } catch (e) {
    grid.innerHTML = '<p class="muted">Could not load members.</p>';
  }
}

function selectMember(memberJson) {
  currentMember = JSON.parse(memberJson);
  localStorage.setItem('fd_member', JSON.stringify(currentMember));
  updateWhoBtn();
  document.getElementById('member-overlay').classList.add('hidden');
  if (onMemberPickedCallback) {
    onMemberPickedCallback();
    onMemberPickedCallback = null;
  }
}

function updateWhoBtn() {
  const btn = document.getElementById('who-btn');
  btn.textContent = currentMember ? currentMember.avatar_emoji : '👤';
  btn.title       = currentMember ? `You are ${currentMember.name} — tap to change` : 'Who are you?';
}

// ── Helpers ───────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins}m`;
}

function ratingEmoji(rating) {
  if (!rating) return '';
  if (rating.includes('🟢')) return '🟢';
  if (rating.includes('🟡')) return '🟡';
  if (rating.includes('🔵')) return '🔵';
  return rating;
}

function kidRatingClass(rating) {
  if (!rating) return '';
  if (rating.includes('🟢')) return 'green';
  if (rating.includes('🟡')) return 'yellow';
  if (rating.includes('🔵')) return 'blue';
  return '';
}

function buildMetaBadges(meal) {
  const cls  = kidRatingClass(meal.kid_rating);
  const desc = kidRatingDesc(meal.kid_rating);
  return [
    meal.cook        ? `<span class="cook-badge">${meal.cook}</span>` : '',
    meal.kid_rating  ? `<span class="kid-badge ${cls}" title="${desc}">${ratingEmoji(meal.kid_rating)} ${desc}</span>` : '',
    meal.is_new      ? '<span class="new-badge">★ NEW</span>' : '',
    meal.is_override ? '<span class="override-badge">swapped</span>' : '',
  ].filter(Boolean).join('');
}

function kidRatingDesc(rating) {
  if (!rating) return '';
  if (rating.includes('🟢')) return 'Whole family';
  if (rating.includes('🟡')) return 'Adults + daughter';
  if (rating.includes('🔵')) return 'Adults + son';
  return '';
}

function buildTimingHtml(meal) {
  if (!meal.active_time_min && !meal.total_time_min) return '';
  return [
    meal.active_time_min ? `<span class="timing-chip"><strong>${meal.active_time_min}m</strong> active</span>` : '',
    meal.total_time_min  ? `<span class="timing-chip"><strong>${fmtTime(meal.total_time_min)}</strong> total</span>` : '',
  ].join('');
}
