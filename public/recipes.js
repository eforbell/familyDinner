let recipes = [];
let filteredRecipes = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('recipe-search').addEventListener('input', applySearch);
  loadRecipes();
});

async function loadRecipes() {
  try {
    const res = await fetch('/api/recipes');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load recipes');
    recipes = data;
    filteredRecipes = data;
    renderRecipeList();
  } catch (err) {
    setStatus(err.message || 'Could not load recipes.', true);
  }
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

function renderRecipeList() {
  const list = document.getElementById('recipe-list');
  if (!filteredRecipes.length) {
    list.innerHTML = '<p class="muted">No recipes found.</p>';
    return;
  }

  list.innerHTML = filteredRecipes.map(recipe => `
    <a class="meal-list-item" href="/recipes/${recipe.id}">
      <span class="meal-list-name">${esc(recipe.title)}</span>
      <span class="meal-list-meta">
        ${recipe.total_time_min ? `${recipe.total_time_min} min` : 'time flexible'}
        ${recipe.linked_meal ? ` · linked to ${esc(recipe.linked_meal.name)}` : ''}
      </span>
    </a>
  `).join('');
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
