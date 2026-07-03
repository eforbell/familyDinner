let searchTimer = null;
let requestSeq = 0;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('recipe-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadRecipes, 200);
  });
  document.getElementById('recipe-sort').addEventListener('change', loadRecipes);
  loadRecipes();
});

async function loadRecipes() {
  const seq = ++requestSeq;
  const q = document.getElementById('recipe-search').value.trim();
  const sort = document.getElementById('recipe-sort').value;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (sort && sort !== 'title') params.set('sort', sort);

  try {
    const res = await fetch(`api/recipes${params.toString() ? `?${params}` : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load recipes');
    if (seq !== requestSeq) return; // superseded by a newer search
    renderRecipeList(data, q);
  } catch (err) {
    if (seq !== requestSeq) return;
    setStatus(err.message || 'Could not load recipes.', true);
  }
}

function renderRecipeList(recipes, query) {
  const list = document.getElementById('recipe-list');
  const count = document.getElementById('recipe-count');

  count.textContent = recipes.length
    ? `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}${query ? ` matching “${query}”` : ''}`
    : '';

  if (!recipes.length) {
    list.innerHTML = `<p class="muted">${query
      ? `No recipes match “${esc(query)}”.`
      : 'No recipes yet — import one from the Recipe Builder.'}</p>`;
    return;
  }

  list.innerHTML = recipes.map(recipe => {
    const chips = [
      recipe.total_time_min ? `⏱ ${fmtTime(recipe.total_time_min)}` : '',
      recipe.ingredient_count ? `${recipe.ingredient_count} ingredients` : '',
      ...(recipe.tags || []).slice(0, 3),
    ].filter(Boolean).map(chip => `<span class="mp-chip">${esc(chip)}</span>`).join('');

    return `
      <a class="recipe-card" href="recipes/${recipe.id}">
        <span class="recipe-card-title">${esc(recipe.title)}</span>
        ${recipe.description ? `<span class="recipe-card-desc">${esc(recipe.description)}</span>` : ''}
        <span class="recipe-card-meta">${chips}</span>
        ${recipe.linked_meal ? `<span class="recipe-count">On the menu as “${esc(recipe.linked_meal.name)}”</span>` : ''}
      </a>
    `;
  }).join('');
}

function fmtTime(mins) {
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${mins} min`;
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
