'use strict';

(function () {
  const app = document.getElementById('app');
  const activePage = document.body.dataset.navPage;
  const navRoot = document.body.dataset.navRoot || '.';

  if (!app || !activePage) return;

  const icons = {
    week: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2.5v3M14 2.5v3M3 8h14"/></svg>',
    recipes: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3.5h9a2 2 0 0 1 2 2V16l-2-1-2 1-2-1-2 1-2-1-2 1V5.5a2 2 0 0 1 2-2Z"/><path d="M7 7h6M7 10h6"/></svg>',
    tonight: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 2.8A7.2 7.2 0 1 0 17.2 13 6.4 6.4 0 1 1 12.5 2.8Z"/></svg>',
    meals: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h14"/><path d="M5 10v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5"/><path d="M6.5 8V5.8M9.5 8V4.8M12.5 8V5.3M15.5 8V4.6"/></svg>',
    planner: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2.5v3M14 2.5v3M3 8h14"/><path d="M6.5 11h2M11.5 11h2M6.5 14h2"/></svg>',
    more: '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/></svg>',
  };

  const navItems = [
    { id: 'week', label: 'Week', icon: 'week', path: '' },
    { id: 'recipes', label: 'Recipes', icon: 'recipes', path: 'recipes' },
    { id: 'tonight', label: 'Tonight', icon: 'tonight', path: 'tonight' },
    { id: 'recipe-builder', label: 'Recipe Builder', icon: 'recipes', path: 'admin/recipes' },
    { id: 'meals', label: 'Meals', icon: 'meals', path: 'admin/meals' },
    { id: 'planner', label: 'Planner', icon: 'planner', path: 'admin' },
  ];

  const primaryItems = navItems.slice(0, 3);
  const secondaryItems = navItems.slice(3);

  function hrefFor(path) {
    const base = navRoot === '..' ? '..' : '.';
    return path ? `${base}/${path}` : `${base}/`;
  }

  function navItemHtml(item, active) {
    return `<a href="${hrefFor(item.path)}" class="fd-nav-item${active ? ' active' : ''}" data-nav-id="${item.id}">
      <span class="fd-nav-icon">${icons[item.icon]}</span>
      <span class="fd-nav-label">${item.label}</span>
    </a>`;
  }

  const sidebar = document.createElement('nav');
  sidebar.className = 'fd-app-sidebar';
  sidebar.setAttribute('aria-label', 'Family Dinner navigation');
  sidebar.innerHTML = `
    <a href="${hrefFor('')}" class="fd-nav-logo">
      <span class="fd-nav-logo-mark">🍽️</span>
      <span class="fd-nav-logo-copy">
        <strong>Dinner</strong>
        <small>Family hub</small>
      </span>
    </a>
    <div class="fd-nav-section">
      ${primaryItems.map(item => navItemHtml(item, item.id === activePage)).join('')}
    </div>
    <div class="fd-nav-divider"></div>
    <div class="fd-nav-section fd-nav-section-secondary">
      ${secondaryItems.map(item => navItemHtml(item, item.id === activePage)).join('')}
    </div>
  `;

  const bottomBar = document.createElement('nav');
  bottomBar.className = 'fd-app-bottom-bar';
  bottomBar.setAttribute('aria-label', 'Family Dinner mobile navigation');
  const moreActive = secondaryItems.some(item => item.id === activePage);
  bottomBar.innerHTML = `
    ${primaryItems.map(item => navItemHtml(item, item.id === activePage)).join('')}
    <button class="fd-nav-item fd-nav-more-btn${moreActive ? ' active' : ''}" id="fd-nav-more-btn" type="button" aria-label="More destinations">
      <span class="fd-nav-icon">${icons.more}</span>
      <span class="fd-nav-label">More</span>
    </button>
  `;

  const moreSheet = document.createElement('div');
  moreSheet.className = 'fd-more-sheet hidden';
  moreSheet.innerHTML = `
    <div class="fd-more-sheet-backdrop"></div>
    <div class="fd-more-sheet-panel">
      <div class="fd-more-sheet-header">
        <strong>More</strong>
        <span class="muted">Recipe, meal, and planning tools</span>
      </div>
      ${secondaryItems.map(item => navItemHtml(item, item.id === activePage)).join('')}
    </div>
  `;

  document.body.insertBefore(sidebar, app);
  document.body.appendChild(bottomBar);
  document.body.appendChild(moreSheet);
  document.body.classList.add('app-has-nav');

  const moreButton = document.getElementById('fd-nav-more-btn');
  const moreBackdrop = moreSheet.querySelector('.fd-more-sheet-backdrop');

  function closeMoreSheet() {
    moreSheet.classList.add('hidden');
  }

  function toggleMoreSheet() {
    moreSheet.classList.toggle('hidden');
  }

  moreButton.addEventListener('click', toggleMoreSheet);
  moreBackdrop.addEventListener('click', closeMoreSheet);
})();
