let rotationData = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-restaurants-btn').addEventListener('click', saveRestaurantOptions);
  loadRotation();
});

async function loadRotation() {
  try {
    const res = await fetch('api/rotation');
    rotationData = await res.json();
    renderOrderInSettings();
    renderRotation();
  } catch (err) {
    setStatus('Could not load rotation data.', true);
  }
}

function renderOrderInSettings() {
  if (!rotationData) return;
  const textarea = document.getElementById('restaurant-options');
  if (!textarea) return;
  textarea.value = (rotationData.restaurants || [])
    .map(restaurant => `${restaurant.emoji ? `${restaurant.emoji} ` : ''}${restaurant.name}`)
    .join('\n');
}

function renderRotation() {
  if (!rotationData) return;

  const meta = document.getElementById('rotation-meta');
  if (rotationData.rotation_start_date) {
    meta.textContent = `The template cycles every 3 weeks (Week 1 anchored to ${fmtDate(rotationData.rotation_start_date)}), so autofill knows which template week matches a given calendar week.`;
  } else {
    meta.textContent = 'No rotation start date is set.';
  }

  const grid = document.getElementById('rotation-grid');
  grid.innerHTML = rotationData.weeks.map(week => `
    <section class="rotation-week">
      <div class="rotation-week-head">
        <h2>Week ${week.week_number}</h2>
        <span class="muted">7 recurring slots</span>
      </div>
      <div class="rotation-slots">
        ${week.days.map(day => buildSlotHtml(week.week_number, day)).join('')}
      </div>
    </section>
  `).join('');
}

function buildSlotHtml(weekNumber, day) {
  const meal = day.meal;
  return `
    <form class="rotation-slot" data-week="${weekNumber}" data-day="${day.day_of_week}">
      <div class="rotation-slot-top">
        <div>
          <div class="rotation-day">${day.day_name}</div>
          <div class="rotation-current">${meal ? esc(meal.name) : '<span class="muted">No meal assigned</span>'}</div>
        </div>
        <button type="submit" class="btn-primary rotation-save">Save</button>
      </div>
      <div class="rotation-meta-row">
        ${meal ? buildMealFlags(meal) : '<span class="muted">Empty slot</span>'}
      </div>
      <label class="rotation-select-wrap">
        <span class="vote-label">Pick meal</span>
        <select name="meal_id">
          ${buildMealOptions(day.meal_id)}
        </select>
      </label>
    </form>
  `;
}

function buildMealOptions(selectedMealId) {
  const empty = `<option value="">No meal assigned</option>`;
  const options = rotationData.meals.map(meal => {
    const flags = [
      meal.is_protected ? 'protected' : '',
      meal.is_new ? 'new' : '',
      meal.kid_rating || '',
    ].filter(Boolean).join(' · ');
    return `<option value="${meal.id}"${meal.id === selectedMealId ? ' selected' : ''}>${esc(meal.name)}${flags ? ` (${esc(flags)})` : ''}</option>`;
  });

  return [empty, ...options].join('');
}

function buildMealFlags(meal) {
  return [
    meal.cook ? `<span class="cook-badge">${esc(meal.cook)}</span>` : '',
    meal.kid_rating ? `<span class="kid-badge ${kidRatingClass(meal.kid_rating)}">${esc(meal.kid_rating)}</span>` : '',
    meal.is_new ? '<span class="new-badge">★ NEW</span>' : '',
    meal.is_protected ? '<span class="override-badge">protected</span>' : '',
  ].filter(Boolean).join('');
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('.rotation-slot')) return;
  event.preventDefault();

  const weekNumber = Number(form.dataset.week);
  const dayOfWeek = Number(form.dataset.day);
  const select = form.querySelector('select[name="meal_id"]');
  const saveBtn = form.querySelector('.rotation-save');

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const res = await fetch('api/rotation-slot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week_number: weekNumber,
        day_of_week: dayOfWeek,
        meal_id: select.value || null,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Save failed');
    }

    updateLocalSlot(weekNumber, dayOfWeek, select.value ? Number(select.value) : null);
    renderRotation();
    setStatus(`Saved Week ${weekNumber} ${dayName(dayOfWeek)}.`, false);
  } catch (err) {
    setStatus(err.message || 'Save failed.', true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

function updateLocalSlot(weekNumber, dayOfWeek, mealId) {
  if (!rotationData) return;
  const week = rotationData.weeks.find(entry => entry.week_number === weekNumber);
  const day = week && week.days.find(entry => entry.day_of_week === dayOfWeek);
  if (!day) return;

  day.meal_id = mealId;
  day.meal = mealId ? rotationData.meals.find(meal => meal.id === mealId) || null : null;
}

async function saveRestaurantOptions() {
  const textarea = document.getElementById('restaurant-options');
  try {
    const res = await fetch('api/restaurants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurant_options: textarea.value }),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Could not save order-in options');
    }

    rotationData.restaurants = data.restaurants || [];
    renderOrderInSettings();
    setStatus('Order-in options saved.', false);
  } catch (err) {
    setStatus(err.message || 'Could not save order-in options.', true);
  }
}

function setStatus(message, isError) {
  const el = document.getElementById('rotation-status');
  el.textContent = message;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
}

function fmtDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayName(dayOfWeek) {
  return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][dayOfWeek - 1] || '';
}

function kidRatingClass(rating) {
  if (!rating) return '';
  if (rating.includes('🟢')) return 'green';
  if (rating.includes('🟡')) return 'yellow';
  if (rating.includes('🔵')) return 'blue';
  if (rating.includes('🔴')) return 'red';
  return '';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
