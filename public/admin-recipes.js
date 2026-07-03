let recipes = [];
let filteredRecipes = [];
let selectedRecipeId = null;
let importRecordId = null;

const form = () => document.getElementById('recipe-form');

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('recipe-search').addEventListener('input', applySearch);
  document.getElementById('new-recipe-btn').addEventListener('click', () => {
    resetForm();
    openRecipeModal();
  });
  document.getElementById('import-recipe-open-btn').addEventListener('click', () => {
    resetForm();
    openRecipeModal({ focusImport: true, showImport: true });
  });
  document.getElementById('recipe-cancel-btn').addEventListener('click', closeRecipeModal);
  document.getElementById('recipe-modal-close').addEventListener('click', closeRecipeModal);
  document.getElementById('recipe-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeRecipeModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeRecipeModal();
  });
  document.getElementById('recipe-import-btn').addEventListener('click', importRecipe);
  document.getElementById('recipe-form').addEventListener('submit', saveRecipe);
  document.getElementById('recipe-create-meal-btn').addEventListener('click', createMealFromRecipe);
  document.getElementById('delete-recipe-btn').addEventListener('click', deleteRecipe);
  loadRecipes();
});

async function loadRecipes() {
  try {
    const res = await fetch('../api/recipes');
    recipes = await res.json();
    if (!res.ok) throw new Error(recipes.error || 'Could not load recipes');
    applySearch();
    const preselectedRecipeId = getRecipeIdFromQuery();
    if (preselectedRecipeId) await selectRecipe(preselectedRecipeId);
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

  list.innerHTML = filteredRecipes.map(recipe => {
    const chips = [
      recipe.total_time_min ? `${recipe.total_time_min} min` : 'time flexible',
      recipe.ingredient_count ? `${recipe.ingredient_count} ingredients` : '',
      recipe.step_count ? `${recipe.step_count} steps` : '',
      recipe.linked_meal ? `linked: ${recipe.linked_meal.name}` : '',
    ].filter(Boolean).map(chip => `<span class="mp-chip">${esc(chip)}</span>`).join('');

    return `
      <button class="meal-card-item${recipe.id === selectedRecipeId ? ' active' : ''}" type="button" data-id="${recipe.id}">
        <span class="meal-list-name">${esc(recipe.title)}</span>
        <span class="meal-card-meta">${chips}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.meal-card-item').forEach(button => {
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
        recipe.source_domain,
        recipe.linked_meal && recipe.linked_meal.name,
        ...(recipe.tags || []),
      ].filter(Boolean).join(' ').toLowerCase().includes(query));
  renderRecipeList();
}

function getRecipeIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const recipeId = Number(params.get('recipeId'));
  return Number.isInteger(recipeId) && recipeId > 0 ? recipeId : null;
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
    openRecipeModal();
  } catch (err) {
    setStatus(err.message || 'Could not load recipe.', true);
  }
}

function openRecipeModal(options = {}) {
  setModalStatus('');
  setImportPanelVisible(Boolean(options.showImport));
  document.getElementById('recipe-modal').classList.remove('hidden');
  const focusTarget = options.focusImport
    ? document.getElementById('recipe-import-url')
    : document.getElementById('recipe-title');
  setTimeout(() => focusTarget.focus(), 40);
}

function closeRecipeModal() {
  const modal = document.getElementById('recipe-modal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  setModalStatus('');
  selectedRecipeId = null;
  importRecordId = null;
  setImportPanelVisible(false);
  hideImportSummary();
  renderRecipeList();
  history.replaceState(null, '', 'recipes');
}

function setImportPanelVisible(isVisible) {
  document.getElementById('recipe-import-panel').classList.toggle('hidden', !isVisible);
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
  setImportPanelVisible(false);
  hideImportSummary();
  setModalStatus('');
  updateEditorState(null);
  renderRecipeList();
  history.replaceState(null, '', 'recipes');
}

function updateEditorState(recipe) {
  document.getElementById('recipe-form-title').textContent = selectedRecipeId ? 'Edit recipe' : 'New recipe';
  document.getElementById('recipe-form-subtitle').textContent = selectedRecipeId
    ? `Editing recipe #${selectedRecipeId}. Save to update the existing record.`
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
  } else {
    linkedMealLink.textContent = 'Open linked meal';
  }

  document.getElementById('delete-recipe-btn').classList.toggle('hidden', !selectedRecipeId);
}

async function importRecipe() {
  const button = document.getElementById('recipe-import-btn');
  const url = document.getElementById('recipe-import-url').value.trim();
  if (!url) {
    setModalStatus('Paste a recipe URL first.');
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
    setImportPanelVisible(true);
    showImportSummary(data.context_summary);
    updateEditorState(null);
    renderRecipeList();
    setStatus('Recipe imported into the editor. Review and save when ready.', false);
    setModalStatus('');
  } catch (err) {
    setModalStatus(err.message || 'Recipe import failed.');
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
    setStatus(method === 'PUT' ? `“${recipe.title}” updated.` : `“${recipe.title}” added to the library.`, false);
    closeRecipeModal();
    await loadRecipes();
  } catch (err) {
    setModalStatus(err.message || 'Save failed.');
  }
}

async function deleteRecipe() {
  if (!selectedRecipeId) return;
  if (!window.confirm('Delete this recipe? Linked meals will stay in the meal library without this recipe link.')) return;

  try {
    const res = await fetch(`../api/recipes/${selectedRecipeId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    setStatus(data.unlinked_meals
      ? `Recipe deleted. ${data.unlinked_meals} linked meal${data.unlinked_meals === 1 ? ' was' : 's were'} kept and unlinked.`
      : 'Recipe deleted.', false);
    closeRecipeModal();
    resetForm();
    await loadRecipes();
  } catch (err) {
    setModalStatus(err.message || 'Delete failed.');
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
    setModalStatus(err.message || 'Could not create meal.');
  }
}

function setStatus(message, isError) {
  const node = document.getElementById('recipe-status');
  node.textContent = message;
  node.classList.remove('hidden', 'is-error', 'error');
  if (isError) node.classList.add('is-error', 'error');
}

function setModalStatus(message) {
  const node = document.getElementById('recipe-modal-status');
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
