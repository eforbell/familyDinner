let recipes = [];
let filteredRecipes = [];
let selectedRecipeId = null;
let importRecordId = null;

const form = () => document.getElementById('recipe-form');

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('recipe-search').addEventListener('input', applySearch);
  document.getElementById('new-recipe-btn').addEventListener('click', resetForm);
  document.getElementById('reset-recipe-btn').addEventListener('click', resetForm);
  document.getElementById('recipe-import-btn').addEventListener('click', importRecipe);
  document.getElementById('recipe-form').addEventListener('submit', saveRecipe);
  document.getElementById('recipe-create-meal-btn').addEventListener('click', createMealFromRecipe);
  loadRecipes();
});

async function loadRecipes() {
  try {
    const res = await fetch('../api/recipes');
    recipes = await res.json();
    filteredRecipes = recipes;
    renderRecipeList();
    const params = new URLSearchParams(window.location.search);
    const recipeId = Number(params.get('recipeId'));
    if (Number.isInteger(recipeId) && recipeId > 0) {
      await selectRecipe(recipeId);
    }
  } catch (err) {
    setStatus('Could not load recipes.', true);
  }
}

function renderRecipeList() {
  const list = document.getElementById('recipe-list');
  if (!filteredRecipes.length) {
    list.innerHTML = '<p class="muted">No recipes found.</p>';
    return;
  }

  list.innerHTML = filteredRecipes.map(recipe => `
    <button class="meal-list-item${recipe.id === selectedRecipeId ? ' active' : ''}" type="button" data-id="${recipe.id}">
      <span class="meal-list-name">${esc(recipe.title)}</span>
      <span class="meal-list-meta">
        ${recipe.total_time_min ? `${recipe.total_time_min} min` : 'time flexible'}
        ${recipe.linked_meal ? ` · linked to ${esc(recipe.linked_meal.name)}` : ''}
      </span>
    </button>
  `).join('');

  list.querySelectorAll('.meal-list-item').forEach(button => {
    button.addEventListener('click', () => selectRecipe(Number(button.dataset.id)));
  });
}

function applySearch() {
  const query = document.getElementById('recipe-search').value.trim().toLowerCase();
  filteredRecipes = !query
    ? recipes
    : recipes.filter(recipe => [
        recipe.title,
        recipe.description,
        ...(recipe.tags || []),
      ].filter(Boolean).join(' ').toLowerCase().includes(query));
  renderRecipeList();
}

async function selectRecipe(recipeId) {
  try {
    const res = await fetch(`../api/recipes/${recipeId}`);
    const recipe = await res.json();
    if (!res.ok) throw new Error(recipe.error || 'Could not load recipe');
    selectedRecipeId = recipe.id;
    fillForm(recipe);
    renderRecipeList();
    updateEditorState(recipe);
    history.replaceState(null, '', `recipes?recipeId=${recipe.id}`);
  } catch (err) {
    setStatus(err.message || 'Could not load recipe.', true);
  }
}

function fillForm(recipe) {
  importRecordId = null;
  document.getElementById('recipe-import-id').value = '';
  document.getElementById('recipe-import-url').value = '';
  applyRecipeToForm(recipe);
  hideImportSummary();
}

function resetForm() {
  selectedRecipeId = null;
  importRecordId = null;
  form().reset();
  document.getElementById('recipe-import-id').value = '';
  document.getElementById('recipe-import-url').value = '';
  hideImportSummary();
  updateEditorState(null);
  renderRecipeList();
  history.replaceState(null, '', 'recipes');
}

function updateEditorState(recipe) {
  document.getElementById('recipe-form-title').textContent = selectedRecipeId ? 'Edit recipe' : 'New recipe';
  document.getElementById('recipe-form-subtitle').textContent = selectedRecipeId
    ? `Editing recipe #${selectedRecipeId}.`
    : (importRecordId ? 'Imported recipe draft — review, fix anything, then save.' : 'Add a recipe manually or import one from a URL.');

  const viewLink = document.getElementById('recipe-view-link');
  viewLink.classList.toggle('hidden', !selectedRecipeId);
  if (selectedRecipeId) viewLink.href = `../recipes/${selectedRecipeId}`;

  const createMealBtn = document.getElementById('recipe-create-meal-btn');
  createMealBtn.classList.toggle('hidden', !selectedRecipeId);

  const linkedMealLink = document.getElementById('recipe-linked-meal-link');
  const linkedMeal = recipe && recipe.linked_meal ? recipe.linked_meal : null;
  linkedMealLink.classList.toggle('hidden', !linkedMeal);
  if (linkedMeal) {
    linkedMealLink.href = `meals?mealId=${linkedMeal.id}`;
    linkedMealLink.textContent = `Open linked meal: ${linkedMeal.name}`;
  }
}

async function importRecipe() {
  const button = document.getElementById('recipe-import-btn');
  const url = document.getElementById('recipe-import-url').value.trim();
  if (!url) {
    setStatus('Paste a recipe URL first.', true);
    return;
  }

  button.disabled = true;
  button.textContent = 'Importing…';
  try {
    const res = await fetch('../api/recipes/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Recipe import failed');

    selectedRecipeId = null;
    importRecordId = data.import_record_id;
    document.getElementById('recipe-import-id').value = data.import_record_id;
    fillImportedDraft(data.draft);
    showImportSummary(data.context_summary);
    updateEditorState(null);
    renderRecipeList();
    setStatus('Recipe imported into the editor. Review and save when ready.', false);
  } catch (err) {
    setStatus(err.message || 'Recipe import failed.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Import recipe';
  }
}

function fillImportedDraft(recipe) {
  applyRecipeToForm(recipe);
}

function applyRecipeToForm(recipe) {
  document.getElementById('recipe-title').value = recipe.title || '';
  document.getElementById('recipe-description').value = recipe.description || '';
  document.getElementById('recipe-source-url').value = recipe.source_url || '';
  document.getElementById('recipe-source-title').value = recipe.source_title || '';
  document.getElementById('recipe-servings').value = recipe.servings_text || '';
  document.getElementById('recipe-image-url').value = recipe.image_url || '';
  document.getElementById('recipe-prep-time').value = recipe.prep_time_min ?? '';
  document.getElementById('recipe-cook-time').value = recipe.cook_time_min ?? '';
  document.getElementById('recipe-total-time').value = recipe.total_time_min ?? '';
  document.getElementById('recipe-tags').value = (recipe.tags || []).join(', ');
  document.getElementById('recipe-notes').value = recipe.notes || '';
  document.getElementById('recipe-ingredients').value = (recipe.ingredients || []).map(item => item.display_text).join('\n');
  document.getElementById('recipe-steps').value = (recipe.steps || []).map(item => item.instruction_text).join('\n');
}

function showImportSummary(summary) {
  const panel = document.getElementById('recipe-import-summary');
  panel.classList.remove('hidden');
  document.getElementById('recipe-import-meta').textContent = summary.used_json_ld
    ? `Imported with ${summary.model_used}. JSON-LD was available and cleanup ran.`
    : `Imported with ${summary.model_used}. The source needed extraction from page text.`;
}

function hideImportSummary() {
  document.getElementById('recipe-import-summary').classList.add('hidden');
  document.getElementById('recipe-import-meta').textContent = '';
}

function buildPayload() {
  return {
    import_id: document.getElementById('recipe-import-id').value,
    title: document.getElementById('recipe-title').value,
    description: document.getElementById('recipe-description').value,
    source_url: document.getElementById('recipe-source-url').value,
    source_title: document.getElementById('recipe-source-title').value,
    servings_text: document.getElementById('recipe-servings').value,
    image_url: document.getElementById('recipe-image-url').value,
    prep_time_min: document.getElementById('recipe-prep-time').value,
    cook_time_min: document.getElementById('recipe-cook-time').value,
    total_time_min: document.getElementById('recipe-total-time').value,
    tags: document.getElementById('recipe-tags').value,
    notes: document.getElementById('recipe-notes').value,
    ingredients: document.getElementById('recipe-ingredients').value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean),
    steps: document.getElementById('recipe-steps').value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean),
  };
}

async function saveRecipe(event) {
  event.preventDefault();

  try {
    const payload = buildPayload();
    const method = selectedRecipeId ? 'PUT' : 'POST';
    const url = selectedRecipeId ? `../api/recipes/${selectedRecipeId}` : '../api/recipes';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const recipe = await res.json();
    if (!res.ok) throw new Error(recipe.error || 'Save failed');

    selectedRecipeId = recipe.id;
    importRecordId = null;
    await loadRecipes();
    await selectRecipe(recipe.id);
    setStatus(selectedRecipeId && method === 'PUT' ? 'Recipe updated.' : 'Recipe created.', false);
  } catch (err) {
    setStatus(err.message || 'Save failed.', true);
  }
}

async function createMealFromRecipe() {
  if (!selectedRecipeId) return;
  try {
    const res = await fetch(`../api/recipes/${selectedRecipeId}/create-meal`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create meal');
    const message = data.created ? 'Meal created from recipe.' : 'Recipe already has a linked meal.';
    setStatus(message, false);
    await loadRecipes();
    await selectRecipe(selectedRecipeId);
  } catch (err) {
    setStatus(err.message || 'Could not create meal.', true);
  }
}

function setStatus(message, isError) {
  const node = document.getElementById('recipe-status');
  node.textContent = message;
  node.classList.remove('hidden');
  node.classList.toggle('is-error', Boolean(isError));
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
