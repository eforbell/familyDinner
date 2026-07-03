document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-magic-settings-btn').addEventListener('click', saveMagicSettings);
  document.getElementById('save-grocery-settings-btn').addEventListener('click', saveMagicGrocerySettings);
  document.getElementById('save-recipe-settings-btn').addEventListener('click', saveRecipeSettings);
  loadAllSettings();
});

async function loadAllSettings() {
  await Promise.all([
    loadMagicSettings(),
    loadMagicGrocerySettings(),
    loadRecipeSettings(),
  ]);
}

async function loadMagicSettings() {
  try {
    const res = await fetch('../api/magic-meal/settings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load Magic Meal settings');
    document.getElementById('magic-meal-prompt').value = data.magic_meal_prompt || '';
  } catch (err) {
    setStatus(err.message || 'Could not load Magic Meal settings.', true);
  }
}

async function saveMagicSettings() {
  try {
    const res = await fetch('../api/magic-meal/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magic_meal_prompt: document.getElementById('magic-meal-prompt').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save Magic Meal settings');
    setStatus('Magic Meal settings saved.', false);
  } catch (err) {
    setStatus(err.message || 'Could not save Magic Meal settings.', true);
  }
}

async function loadMagicGrocerySettings() {
  try {
    const res = await fetch('../api/magic-grocery/settings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load Magic Grocery settings');
    document.getElementById('magic-grocery-prompt').value = data.magic_grocery_prompt || '';
  } catch (err) {
    setStatus(err.message || 'Could not load Magic Grocery settings.', true);
  }
}

async function saveMagicGrocerySettings() {
  try {
    const res = await fetch('../api/magic-grocery/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magic_grocery_prompt: document.getElementById('magic-grocery-prompt').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save Magic Grocery settings');
    setStatus('Magic Grocery settings saved.', false);
  } catch (err) {
    setStatus(err.message || 'Could not save Magic Grocery settings.', true);
  }
}

async function loadRecipeSettings() {
  try {
    const res = await fetch('../api/recipe-import/settings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load recipe settings');
    document.getElementById('magic-recipe-import-prompt').value = data.magic_recipe_import_prompt || '';
    document.getElementById('magic-recipe-detail-prompt').value = data.magic_recipe_detail_prompt || '';
  } catch (err) {
    setStatus(err.message || 'Could not load recipe settings.', true);
  }
}

async function saveRecipeSettings() {
  try {
    const res = await fetch('../api/recipe-import/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        magic_recipe_import_prompt: document.getElementById('magic-recipe-import-prompt').value,
        magic_recipe_detail_prompt: document.getElementById('magic-recipe-detail-prompt').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save recipe settings');
    setStatus('Recipe import settings saved.', false);
  } catch (err) {
    setStatus(err.message || 'Could not save recipe settings.', true);
  }
}

function setStatus(message, isError) {
  const node = document.getElementById('settings-status');
  node.textContent = message || '';
  node.classList.remove('hidden', 'error');
  if (!message) node.classList.add('hidden');
  if (isError) node.classList.add('error');
}
