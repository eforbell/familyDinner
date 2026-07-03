let meals = [];
let filteredMeals = [];
let selectedMealId = null;
let lastMagicDraft = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('meal-form').addEventListener('submit', saveMeal);
  document.getElementById('new-meal-btn').addEventListener('click', () => {
    resetForm();
    openMealModal();
  });
  document.getElementById('meal-cancel-btn').addEventListener('click', closeMealModal);
  document.getElementById('meal-modal-close').addEventListener('click', closeMealModal);
  document.getElementById('meal-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeMealModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMealModal();
  });
  document.getElementById('delete-meal-btn').addEventListener('click', deleteMeal);
  document.getElementById('meal-search').addEventListener('input', applySearch);
  document.getElementById('magic-generate-btn').addEventListener('click', generateMagicMeal);
  loadMeals();
});

async function loadMeals() {
  try {
    const res = await fetch('../api/meals');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load meals');
    meals = data;
    applySearch();
    const preselectedMealId = getMealIdFromQuery();
    if (preselectedMealId) await selectMeal(preselectedMealId);
  } catch (err) {
    setStatus('Could not load meals.', true);
  }
}

function fmtTime(mins) {
  if (!mins) return '';
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

function renderMealList() {
  const list = document.getElementById('meal-list');
  if (!filteredMeals.length) {
    list.innerHTML = '<p class="muted">No meals found.</p>';
    return;
  }

  list.innerHTML = filteredMeals.map(meal => {
    const chips = [
      ratingDot(meal.kid_rating),
      meal.cook || '',
      fmtTime(meal.total_time_min),
      meal.is_new ? '★ NEW' : '',
      meal.is_protected ? 'no-cook' : '',
    ].filter(Boolean).map(chip => `<span class="mp-chip">${esc(chip)}</span>`).join('');

    return `
      <button class="meal-card-item${meal.id === selectedMealId ? ' active' : ''}" type="button" data-id="${meal.id}">
        <span class="meal-list-name">${esc(meal.name)}</span>
        <span class="meal-card-meta">${chips}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.meal-card-item').forEach(button => {
    button.addEventListener('click', () => selectMeal(Number(button.dataset.id)));
  });
}

// ── Modal ─────────────────────────────────────────────────────
function openMealModal() {
  setModalStatus('');
  document.getElementById('meal-modal').classList.remove('hidden');
  const nameInput = document.getElementById('meal-form').elements.name;
  setTimeout(() => nameInput.focus(), 40);
}

function closeMealModal() {
  const modal = document.getElementById('meal-modal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  setModalStatus('');
  selectedMealId = null;
  lastMagicDraft = null;
  renderMealList();
}

function setModalStatus(message) {
  const el = document.getElementById('meal-modal-status');
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function applySearch() {
  const query = document.getElementById('meal-search').value.trim().toLowerCase();
  filteredMeals = !query
    ? meals
    : meals.filter(meal => {
        const haystack = [
          meal.name,
          meal.cook,
          meal.kid_rating,
          ...(meal.tags || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      });
  renderMealList();
}

function getMealIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const mealId = Number(params.get('mealId'));
  return Number.isInteger(mealId) && mealId > 0 ? mealId : null;
}

async function selectMeal(mealId) {
  try {
    const res = await fetch(`../api/meals/${mealId}`);
    const meal = await res.json();
    if (!res.ok) throw new Error(meal.error || 'Could not load meal');

    lastMagicDraft = null;
    selectedMealId = meal.id;
    fillForm(meal);
    hideMagicResult();
    renderMealList();
    updateEditorState();
    openMealModal();
  } catch (err) {
    setStatus(err.message || 'Could not load meal.', true);
  }
}

function fillForm(meal) {
  const form = document.getElementById('meal-form');
  form.elements.name.value = meal.name || '';
  form.elements.recipe_id.value = meal.recipe_id || '';
  form.elements.notes.value = meal.notes || '';
  form.elements.recipe_tips.value = meal.recipe_tips || '';
  form.elements.active_time_min.value = meal.active_time_min ?? '';
  form.elements.total_time_min.value = meal.total_time_min ?? '';
  form.elements.equipment.value = (meal.equipment || []).join(', ');
  form.elements.cook.value = meal.cook || '';
  form.elements.kid_rating.value = meal.kid_rating || '';
  form.elements.tags.value = (meal.tags || []).join(', ');
  form.elements.is_new.checked = Boolean(meal.is_new);
  form.elements.is_protected.checked = Boolean(meal.is_protected);
  const linkedRecipeRow = document.getElementById('linked-recipe-row');
  const linkedRecipeLink = document.getElementById('linked-recipe-link');
  const hasRecipe = Boolean(meal.recipe_id);
  linkedRecipeRow.classList.toggle('hidden', !hasRecipe);
  if (hasRecipe) linkedRecipeLink.href = `../recipes/${meal.recipe_id}`;
}

function resetForm() {
  selectedMealId = null;
  lastMagicDraft = null;
  document.getElementById('meal-form').reset();
  document.getElementById('meal-form').elements.recipe_id.value = '';
  document.getElementById('linked-recipe-row').classList.add('hidden');
  hideMagicResult();
  setModalStatus('');
  updateEditorState();
  renderMealList();
}

function updateEditorState() {
  document.getElementById('meal-form-title').textContent = selectedMealId ? 'Edit meal' : (lastMagicDraft ? 'Magic Meal draft' : 'New meal');
  document.getElementById('meal-form-subtitle').textContent = selectedMealId
    ? `Editing meal #${selectedMealId}. Save to update the existing record.`
    : (lastMagicDraft ? 'Magic Meal drafted this as a new meal. Edit anything you want, then save it like a normal meal.' : 'Fill this in, then save it into the catalog.');
  document.getElementById('delete-meal-btn').classList.toggle('hidden', !selectedMealId);
}

async function saveMeal(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    name: form.elements.name.value,
    recipe_id: form.elements.recipe_id.value,
    notes: form.elements.notes.value,
    recipe_tips: form.elements.recipe_tips.value,
    active_time_min: form.elements.active_time_min.value,
    total_time_min: form.elements.total_time_min.value,
    equipment: form.elements.equipment.value,
    cook: form.elements.cook.value,
    kid_rating: form.elements.kid_rating.value,
    tags: form.elements.tags.value,
    is_new: form.elements.is_new.checked,
    is_protected: form.elements.is_protected.checked,
  };

  const method = selectedMealId ? 'PUT' : 'POST';
  const url = selectedMealId ? `../api/meals/${selectedMealId}` : '../api/meals';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const meal = await res.json();
    if (!res.ok) throw new Error(meal.error || 'Save failed');

    setStatus(method === 'PUT' ? `“${meal.name}” updated.` : `“${meal.name}” added to the library.`, false);
    closeMealModal();
    await loadMeals();
  } catch (err) {
    setModalStatus(err.message || 'Save failed.');
  }
}

async function deleteMeal() {
  if (!selectedMealId) return;
  if (!window.confirm('Delete this meal? This only works if it is not used anywhere yet.')) return;

  try {
    const res = await fetch(`../api/meals/${selectedMealId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    setStatus('Meal deleted.', false);
    closeMealModal();
    resetForm();
    await loadMeals();
  } catch (err) {
    setModalStatus(err.message || 'Delete failed.');
  }
}

async function generateMagicMeal() {
  const button = document.getElementById('magic-generate-btn');
  button.disabled = true;
  button.textContent = 'Thinking...';

  try {
    const res = await fetch('../api/magic-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_notes: '' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Magic Meal failed');

    lastMagicDraft = data.draft;
    selectedMealId = null;
    fillForm(data.draft);
    renderMagicResult(data);
    updateEditorState();
    renderMealList();
    openMealModal();
    setStatus('Magic Meal drafted a new meal — review and save it.', false);
  } catch (err) {
    setStatus(err.message || 'Magic Meal failed.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Magic Meal';
  }
}

function renderMagicResult(data) {
  const result = document.getElementById('magic-meal-result');
  result.classList.remove('hidden');
  document.getElementById('magic-meal-why').textContent = data.draft.why_it_fits || '';
  document.getElementById('magic-meal-summary').textContent =
    `Drafted from ${data.context_summary.meal_count} existing meals and your saved Magic Meal guidance.`;
}

function hideMagicResult() {
  document.getElementById('magic-meal-result').classList.add('hidden');
  document.getElementById('magic-meal-why').textContent = '';
  document.getElementById('magic-meal-summary').textContent = '';
}

function setStatus(message, isError) {
  const el = document.getElementById('meal-admin-status');
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
