document.addEventListener('DOMContentLoaded', () => {
  loadRecipe();
  document.getElementById('recipe-detail-create-meal').addEventListener('click', createMealFromRecipe);
});

async function loadRecipe() {
  const recipeId = Number(window.location.pathname.split('/').filter(Boolean).pop());
  if (!Number.isInteger(recipeId) || recipeId < 1) {
    setStatus('Invalid recipe id.', true);
    return;
  }

  try {
    const res = await fetch(`../api/recipes/${recipeId}`);
    const recipe = await res.json();
    if (!res.ok) throw new Error(recipe.error || 'Could not load recipe');
    renderRecipe(recipe);
  } catch (err) {
    setStatus(err.message || 'Could not load recipe.', true);
  }
}

function renderRecipe(recipe) {
  document.title = `${recipe.title} · Family Dinner`;
  document.getElementById('recipe-detail-title').textContent = recipe.title;
  document.getElementById('recipe-detail-description').textContent = recipe.description || 'No description yet.';
  document.getElementById('recipe-detail-edit').href = `../recipes?recipeId=${recipe.id}`;

  const meta = [];
  if (recipe.servings_text) meta.push(recipe.servings_text);
  if (recipe.prep_time_min) meta.push(`${recipe.prep_time_min} min prep`);
  if (recipe.cook_time_min) meta.push(`${recipe.cook_time_min} min cook`);
  if (recipe.total_time_min) meta.push(`${recipe.total_time_min} min total`);
  if (recipe.source_domain) meta.push(`<a href="${recipe.source_url}" target="_blank" rel="noreferrer">${esc(recipe.source_domain)}</a>`);
  document.getElementById('recipe-detail-meta').innerHTML = meta.map(item => `<span class="timing-chip">${item}</span>`).join('');

  document.getElementById('recipe-detail-ingredients').innerHTML = (recipe.ingredients || [])
    .map(item => `<li>${esc(item.display_text)}</li>`)
    .join('');

  document.getElementById('recipe-detail-steps').innerHTML = (recipe.steps || [])
    .map(item => `<li>${esc(item.instruction_text)}</li>`)
    .join('');

  const notesCard = document.getElementById('recipe-detail-notes-card');
  notesCard.classList.toggle('hidden', !recipe.notes);
  document.getElementById('recipe-detail-notes').textContent = recipe.notes || '';

  const linkedMealLink = document.getElementById('recipe-detail-meal-link');
  const createMealBtn = document.getElementById('recipe-detail-create-meal');
  if (recipe.linked_meal) {
    linkedMealLink.classList.remove('hidden');
    linkedMealLink.href = `../admin/meals?mealId=${recipe.linked_meal.id}`;
    linkedMealLink.textContent = `Open linked meal: ${recipe.linked_meal.name}`;
    createMealBtn.classList.add('hidden');
  } else {
    linkedMealLink.classList.add('hidden');
    createMealBtn.classList.remove('hidden');
    createMealBtn.dataset.recipeId = String(recipe.id);
  }
}

async function createMealFromRecipe() {
  const recipeId = Number(document.getElementById('recipe-detail-create-meal').dataset.recipeId);
  if (!recipeId) return;

  try {
    const res = await fetch(`../api/recipes/${recipeId}/create-meal`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create meal');
    await loadRecipe();
    setStatus(data.created ? 'Meal created from recipe.' : 'Recipe already has a linked meal.', false);
  } catch (err) {
    setStatus(err.message || 'Could not create meal.', true);
  }
}

function setStatus(message, isError) {
  const node = document.getElementById('recipe-detail-status');
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
