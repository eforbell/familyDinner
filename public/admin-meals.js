let meals = [];
let filteredMeals = [];
let selectedMealId = null;
let lastMagicDraft = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('meal-form').addEventListener('submit', saveMeal);
  document.getElementById('new-meal-btn').addEventListener('click', resetForm);
  document.getElementById('reset-meal-btn').addEventListener('click', resetForm);
  document.getElementById('delete-meal-btn').addEventListener('click', deleteMeal);
  document.getElementById('meal-search').addEventListener('input', applySearch);
  document.getElementById('magic-generate-btn').addEventListener('click', generateMagicMeal);
  document.getElementById('save-magic-settings-btn').addEventListener('click', saveMagicSettings);
  loadMeals();
  loadMagicSettings();
});

async function loadMeals() {
  try {
    const res = await fetch('/api/rotation');
    const data = await res.json();
    meals = [...data.meals].sort((a, b) => a.name.localeCompare(b.name));
    filteredMeals = meals;
    renderMealList();
    if (!selectedMealId) resetForm();
  } catch (err) {
    setStatus('Could not load meals.', true);
  }
}

function renderMealList() {
  const list = document.getElementById('meal-list');
  if (!filteredMeals.length) {
    list.innerHTML = '<p class="muted">No meals found.</p>';
    return;
  }

  list.innerHTML = filteredMeals.map(meal => `
    <button class="meal-list-item${meal.id === selectedMealId ? ' active' : ''}" type="button" data-id="${meal.id}">
      <span class="meal-list-name">${esc(meal.name)}</span>
      <span class="meal-list-meta">
        ${meal.kid_rating ? esc(meal.kid_rating) : ''}
        ${meal.is_protected ? ' · protected' : ''}
        ${meal.is_new ? ' · new' : ''}
      </span>
    </button>
  `).join('');

  list.querySelectorAll('.meal-list-item').forEach(button => {
    button.addEventListener('click', () => selectMeal(Number(button.dataset.id)));
  });
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

async function selectMeal(mealId) {
  try {
    const res = await fetch(`/api/meals/${mealId}`);
    const meal = await res.json();
    if (!res.ok) throw new Error(meal.error || 'Could not load meal');

    lastMagicDraft = null;
    selectedMealId = meal.id;
    fillForm(meal);
    hideMagicResult();
    renderMealList();
    updateEditorState();
  } catch (err) {
    setStatus(err.message || 'Could not load meal.', true);
  }
}

function fillForm(meal) {
  const form = document.getElementById('meal-form');
  form.elements.name.value = meal.name || '';
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
}

function resetForm() {
  selectedMealId = null;
  lastMagicDraft = null;
  document.getElementById('meal-form').reset();
  hideMagicResult();
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
  const url = selectedMealId ? `/api/meals/${selectedMealId}` : '/api/meals';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const meal = await res.json();
    if (!res.ok) throw new Error(meal.error || 'Save failed');

    selectedMealId = meal.id;
    setStatus(selectedMealId && method === 'PUT' ? 'Meal updated.' : 'Meal created.', false);
    await loadMeals();
    await selectMeal(selectedMealId);
  } catch (err) {
    setStatus(err.message || 'Save failed.', true);
  }
}

async function deleteMeal() {
  if (!selectedMealId) return;
  if (!window.confirm('Delete this meal? This only works if it is not used anywhere yet.')) return;

  try {
    const res = await fetch(`/api/meals/${selectedMealId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    setStatus('Meal deleted.', false);
    resetForm();
    await loadMeals();
  } catch (err) {
    setStatus(err.message || 'Delete failed.', true);
  }
}

async function loadMagicSettings() {
  try {
    const res = await fetch('/api/magic-meal/settings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load Magic Meal settings');
    document.getElementById('magic-meal-prompt').value = data.magic_meal_prompt || '';
  } catch (err) {
    setStatus(err.message || 'Could not load Magic Meal settings.', true);
  }
}

async function saveMagicSettings() {
  try {
    await persistMagicSettings(false);
    setStatus('Magic Meal settings saved.', false);
  } catch (err) {
    setStatus(err.message || 'Could not save Magic Meal settings.', true);
  }
}

async function persistMagicSettings(showStatus) {
  const prompt = document.getElementById('magic-meal-prompt').value;
  const res = await fetch('/api/magic-meal/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magic_meal_prompt: prompt }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Could not save Magic Meal settings');
  }
  if (showStatus) setStatus('Magic Meal settings saved.', false);
  return data;
}

async function generateMagicMeal() {
  const button = document.getElementById('magic-generate-btn');
  button.disabled = true;
  button.textContent = 'Thinking...';

  try {
    await persistMagicSettings(false);

    const res = await fetch('/api/magic-meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_notes: document.getElementById('magic-meal-notes').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Magic Meal failed');

    lastMagicDraft = data.draft;
    selectedMealId = null;
    fillForm(data.draft);
    renderMagicResult(data);
    updateEditorState();
    renderMealList();
    setStatus('Magic Meal drafted a new meal into the form.', false);
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
