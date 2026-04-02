// ── State ────────────────────────────────────────────────────
let currentMember = JSON.parse(localStorage.getItem('fd_member') || 'null');
let weekData      = null;
let allMeals      = [];
let membersCache  = [];
let swapTarget    = null;
let todayDate     = null;
let tonightMealId = null;

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  updateWhoBtn();
  await loadWeek();

  if (!currentMember) {
    // First visit — show member picker after a brief delay so the page renders
    setTimeout(openMemberPicker, 400);
  }
});

// ── Data Fetching ─────────────────────────────────────────────
async function loadWeek() {
  try {
    const res  = await fetch('api/week');
    weekData   = await res.json();
    renderWeekBadge();
    renderTonight();
    renderWeekGrid();
  } catch (e) {
    console.error('Failed to load week', e);
  }
}

async function loadAllMeals() {
  if (allMeals.length) return allMeals;
  try {
    const res = await fetch('api/meals');
    allMeals  = await res.json();
    return allMeals;
  } catch (e) {
    console.error('Failed to load meals', e);
    return [];
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
    const recipeLink = document.getElementById('tonight-recipe-link');
    if (recipeLink) recipeLink.classList.add('hidden');
    document.getElementById('tonight-name').textContent = 'Nothing planned';
    return;
  }

  tonightMealId = meal.id;

  const orderIn = today.order_in;
  const recipeLink = document.getElementById('tonight-recipe-link');
  if (recipeLink) {
    recipeLink.classList.toggle('hidden', !meal.recipe_id);
    if (meal.recipe_id) recipeLink.href = `recipes/${meal.recipe_id}`;
  }

  if (orderIn || (meal && meal.is_protected)) {
    if (recipeLink) recipeLink.classList.add('hidden');
    document.getElementById('tonight-name').textContent = 'Order In Night 🛵';
    document.getElementById('tonight-notes').textContent = 'No cooking tonight — vote for where to order.';
    document.getElementById('tonight-meta').innerHTML = '';
    document.querySelector('.tonight-actions').classList.add('hidden');
    // Show restaurant voting in the details panel
    document.getElementById('tonight-details').classList.remove('hidden');
    document.getElementById('tonight-details-btn').classList.add('hidden');
    document.getElementById('tonight-tips').innerHTML = '';
    document.getElementById('tonight-timing').innerHTML = '';
    document.getElementById('tonight-equipment').textContent = '';
    renderRestaurantVotes('tonight-votes', 'tonight-vote-display', today.date, orderIn);
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
  const meal    = day.meal;
  const orderIn = day.order_in;
  const prot    = !orderIn && meal && meal.is_protected;
  const isOrderIn = !!(orderIn || prot);
  const card    = document.createElement('div');

  card.className = [
    'day-card',
    day.is_today ? 'today'     : '',
    isOrderIn    ? 'order-in'  : '',
  ].join(' ').trim();

  card.dataset.date   = day.date;
  card.dataset.mealId = meal ? meal.id : '';

  const shortDay = new Date(day.date + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

  let mealHtml;
  if (isOrderIn) {
    const leader = orderIn && orderIn.votes && orderIn.votes.find(v => v.count > 0);
    mealHtml = `<span class="day-meal-name order-in-label">🛵 Order In${leader ? ` · ${leader.emoji} ${leader.name}` : ''}</span>`;
  } else if (!meal) {
    mealHtml = '<span class="day-meal-name muted">—</span>';
  } else {
    mealHtml = `<span class="day-meal-name">${esc(meal.name)}</span>`;
  }

  const metaHtml = meal && !isOrderIn
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
      ${buildDayExpandHtml(day)}
    </div>
  `;

  card.querySelector('.day-card-header').addEventListener('click', () =>
    toggleDayPanel(day.date)
  );

  return card;
}

function buildDayExpandHtml(day) {
  const meal    = day.meal;
  const orderIn = day.order_in;
  const prot    = !orderIn && meal && meal.is_protected;

  // Order-in night: show restaurant picker
  if (orderIn) {
    return `
      <div id="restaurant-votes-${day.date}">
        ${buildRestaurantVotesHtml(orderIn, day.date)}
      </div>
      ${meal && meal.is_protected ? '' : `
      <div class="day-actions" style="margin-top:.75rem">
        <button class="btn-danger" onclick="cancelOrderIn('${day.date}')">Cancel order-in</button>
      </div>`}
    `;
  }

  // Protected Thursday — just the order-in toggle
  if (prot) {
    return `<p class="muted" style="font-size:.85rem;margin-bottom:.75rem">Protected night — no cooking.</p>`;
  }

  if (!meal) return '<p class="muted" style="font-size:.85rem">Nothing planned.</p>';

  const notes  = meal.notes       ? `<div class="day-notes">${esc(meal.notes)}</div>` : '';
  const tips   = meal.recipe_tips ? `<div class="day-tips">${esc(meal.recipe_tips)}</div>` : '';
  const timing = buildTimingHtml(meal);
  const equip  = meal.equipment && meal.equipment.length
    ? `<div class="timing-chip" style="display:inline-block;margin-top:.3rem">🍳 ${esc(meal.equipment.join(', '))}</div>` : '';

  return `
    ${notes}
    ${tips}
    <div class="detail-timing">${timing}</div>
    ${equip}
    <div class="day-actions" style="margin-top:.75rem">
      <div class="vote-buttons" id="day-votes-${day.date}"></div>
      ${meal.recipe_id ? `<a class="btn-ghost" href="recipes/${meal.recipe_id}">Recipe</a>` : ''}
      <button class="btn-swap" onclick="openSwap('${day.date}', 'day')">Swap ⇄</button>
      <button class="btn-order-in" onclick="declareOrderIn('${day.date}')">🛵 Order In</button>
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
    const res  = await fetch('api/vote', {
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
      const res = await fetch(`api/votes/${mealId}`);
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
async function openSwap(date, context) {
  swapTarget = { date, context };
  const overlay = document.getElementById('swap-overlay');
  overlay.classList.remove('hidden');

  const d = new Date(date + 'T12:00:00');
  document.getElementById('swap-day-label').textContent =
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  await loadAllMeals();
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
    await fetch('api/swap', {
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
    await fetch(`api/swap/${swapTarget.date}`, { method: 'DELETE' });
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
    if (!membersCache.length) {
      const res  = await fetch('api/members');
      membersCache = await res.json();
    }
    grid.innerHTML = membersCache.map(m =>
      `<button class="member-btn" onclick="selectMember(${m.id})">
        <span class="member-avatar">${m.avatar_emoji}</span>
        <span>${m.name}</span>
      </button>`
    ).join('');
  } catch (e) {
    grid.innerHTML = '<p class="muted">Could not load members.</p>';
  }
}

function selectMember(id) {
  currentMember = membersCache.find(m => m.id === id);
  if (!currentMember) return;
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

// ── Cook Log ──────────────────────────────────────────────────

async function logMadeIt() {
  if (!tonightMealId) return;
  const btn = document.getElementById('made-it-btn');
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = 'Logging...';

  try {
    const res = await fetch('api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meal_id: tonightMealId,
        planned_meal_id: tonightMealId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'log failed');

    btn.textContent = data.already_logged ? '✓ Already logged' : '✓ Logged!';
    btn.classList.add('logged');
    setTimeout(() => btn.remove(), 1200);
  } catch (e) {
    console.error('Log failed', e);
    btn.disabled = false;
    btn.textContent = 'We made it ✅';
  }
}

// ── Order-In ──────────────────────────────────────────────────

async function declareOrderIn(date) {
  try {
    await fetch('api/order-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, created_by: currentMember ? currentMember.name : null }),
    });
    await loadWeek();
  } catch (e) {
    console.error('Failed to declare order-in', e);
  }
}

async function cancelOrderIn(date) {
  try {
    await fetch(`api/order-in/${date}`, { method: 'DELETE' });
    await loadWeek();
  } catch (e) {
    console.error('Failed to cancel order-in', e);
  }
}

async function voteRestaurant(date, restaurantId) {
  if (!currentMember) {
    openMemberPicker(() => voteRestaurant(date, restaurantId));
    return;
  }
  try {
    const res  = await fetch(`api/order-in/${date}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_id: restaurantId, member_id: currentMember.id }),
    });
    const data = await res.json();
    if (data.order_in) {
      // Refresh just this day's panel
      const panel = document.getElementById(`restaurant-votes-${date}`);
      if (panel) panel.innerHTML = buildRestaurantVotesHtml(data.order_in, date);
      // Also refresh tonight if it's today
      const todayEntry = weekData && weekData.days.find(d => d.is_today);
      if (todayEntry && todayEntry.date === date) {
        renderRestaurantVotes('tonight-votes', 'tonight-vote-display', date, data.order_in);
      }
    }
  } catch (e) {
    console.error('Restaurant vote failed', e);
  }
}

function buildRestaurantVotesHtml(orderIn, date) {
  // Use votes embedded in the orderIn object so the initial page load stays lean.
  const voteData = (orderIn && orderIn.votes) ? orderIn.votes : [];
  if (!voteData.length) return '<p class="muted" style="font-size:.85rem">No order-in options available.</p>';

  const myVote = currentMember
    ? voteData.find(r => r.voters && r.voters.includes(currentMember.name))
    : null;

  return `
    <div class="restaurant-grid">
      ${voteData.map(r => {
        const isMyVote = myVote && myVote.id === r.id;
        return `<button class="restaurant-btn${isMyVote ? ' active' : ''}"
                  onclick="voteRestaurant('${date}', ${r.id})">
          <span class="r-emoji">${r.emoji}</span>
          <span class="r-name">${esc(r.name)}</span>
          ${r.count > 0 ? `<span class="r-count">${r.count}</span>` : ''}
          ${r.voters && r.voters.length ? `<span class="r-voters">${r.voters.join(', ')}</span>` : ''}
        </button>`;
      }).join('')}
    </div>
  `;
}

function renderRestaurantVotes(btnContainerId, displayId, date, orderIn) {
  const container = document.getElementById(btnContainerId);
  const display   = document.getElementById(displayId);
  if (container) container.innerHTML = buildRestaurantVotesHtml(orderIn, date);
  if (display)   display.innerHTML = '';
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
  if (rating.includes('🔴')) return '🔴';
  return rating;
}

function kidRatingClass(rating) {
  if (!rating) return '';
  if (rating.includes('🟢')) return 'green';
  if (rating.includes('🟡')) return 'yellow';
  if (rating.includes('🔵')) return 'blue';
  if (rating.includes('🔴')) return 'red';
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
  if (rating.includes('🔴')) return 'Adults only';
  return '';
}

function buildTimingHtml(meal) {
  if (!meal.active_time_min && !meal.total_time_min) return '';
  return [
    meal.active_time_min ? `<span class="timing-chip"><strong>${meal.active_time_min}m</strong> active</span>` : '',
    meal.total_time_min  ? `<span class="timing-chip"><strong>${fmtTime(meal.total_time_min)}</strong> total</span>` : '',
  ].join('');
}
