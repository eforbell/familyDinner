'use strict';

// Shared searchable meal picker overlay.
// Usage: MealPicker.open({ title, subtitle, allowClear, currentMealId, onSelect })
// onSelect receives a meal object, or null when the user clears the day.
(function () {
  const apiRoot = document.body.dataset.navRoot === '..' ? '..' : '.';

  let overlay = null;
  let options = null;
  let results = [];
  let activeIndex = -1;
  let searchTimer = null;
  let requestSeq = 0;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'overlay mp-overlay hidden';
    overlay.innerHTML = `
      <div class="overlay-box mp-box" role="dialog" aria-modal="true" aria-label="Pick a meal">
        <div class="mp-head">
          <h2 id="mp-title">Pick a meal</h2>
          <p id="mp-subtitle" class="muted"></p>
        </div>
        <input id="mp-search" type="search" placeholder="Search meals…" autocomplete="off">
        <div id="mp-results" class="mp-results" role="listbox"></div>
        <div class="mp-actions">
          <button id="mp-clear" class="btn-danger hidden" type="button">Clear this day</button>
          <button id="mp-cancel" class="btn-ghost" type="button">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('#mp-cancel').addEventListener('click', close);
    overlay.querySelector('#mp-clear').addEventListener('click', () => {
      const cb = options && options.onSelect;
      close();
      if (cb) cb(null);
    });

    const search = overlay.querySelector('#mp-search');
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runSearch(search.value), 180);
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActive(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0 && results[activeIndex]) pick(results[activeIndex]);
        else if (results.length === 1) pick(results[0]);
      } else if (event.key === 'Escape') {
        close();
      }
    });

    return overlay;
  }

  async function runSearch(query) {
    const seq = ++requestSeq;
    const q = String(query || '').trim();
    try {
      const url = q
        ? `${apiRoot}/api/meals?q=${encodeURIComponent(q)}&limit=50`
        : `${apiRoot}/api/meals`;
      const res = await fetch(url);
      const data = await res.json();
      if (seq !== requestSeq) return; // a newer search superseded this one
      results = Array.isArray(data) ? data.filter(m => !m.is_protected || options.includeProtected) : [];
      activeIndex = -1;
      renderResults(q);
    } catch {
      if (seq !== requestSeq) return;
      results = [];
      renderResults(q, true);
    }
  }

  function renderResults(query, failed) {
    const list = overlay.querySelector('#mp-results');
    if (failed) {
      list.innerHTML = '<p class="muted mp-empty">Could not load meals.</p>';
      return;
    }
    if (!results.length) {
      list.innerHTML = `<p class="muted mp-empty">No meals match “${esc(query)}”.</p>`;
      return;
    }

    list.innerHTML = results.map((meal, index) => {
      const isCurrent = options.currentMealId && meal.id === options.currentMealId;
      const chips = [
        ratingDot(meal.kid_rating),
        meal.cook || '',
        fmtTime(meal.total_time_min),
        meal.is_new ? '★ NEW' : '',
      ].filter(Boolean).map(chip => `<span class="mp-chip">${esc(chip)}</span>`).join('');
      return `
        <button class="mp-item${isCurrent ? ' current' : ''}" type="button" role="option"
                data-index="${index}" id="mp-item-${index}">
          <span class="mp-item-name">${esc(meal.name)}${isCurrent ? ' <span class="mp-current-tag">current</span>' : ''}</span>
          <span class="mp-item-meta">${chips}</span>
        </button>
      `;
    }).join('');

    list.querySelectorAll('.mp-item').forEach(button => {
      button.addEventListener('click', () => pick(results[Number(button.dataset.index)]));
    });
  }

  function moveActive(delta) {
    if (!results.length) return;
    activeIndex = (activeIndex + delta + results.length) % results.length;
    overlay.querySelectorAll('.mp-item').forEach((el, i) => {
      el.classList.toggle('active', i === activeIndex);
      if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function pick(meal) {
    const cb = options && options.onSelect;
    close();
    if (cb && meal) cb(meal);
  }

  function open(opts) {
    options = opts || {};
    ensureOverlay();
    overlay.querySelector('#mp-title').textContent = options.title || 'Pick a meal';
    const subtitle = overlay.querySelector('#mp-subtitle');
    subtitle.textContent = options.subtitle || '';
    subtitle.classList.toggle('hidden', !options.subtitle);
    overlay.querySelector('#mp-clear').classList.toggle('hidden', !options.allowClear);

    const search = overlay.querySelector('#mp-search');
    search.value = '';
    overlay.classList.remove('hidden');
    runSearch('');
    setTimeout(() => search.focus(), 40);
  }

  function close() {
    if (overlay) overlay.classList.add('hidden');
    options = null;
    results = [];
    activeIndex = -1;
  }

  window.MealPicker = { open, close };
})();
