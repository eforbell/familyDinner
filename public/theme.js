const THEME_STORAGE_KEY = 'fd_theme';
const DEFAULT_THEME = 'dark';

function preferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : DEFAULT_THEME;
}

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute('content', nextTheme === 'light' ? '#f6f1eb' : '#0f0f0f');
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.textContent = nextTheme === 'light' ? '🌙' : '☀️';
    button.setAttribute('aria-label', nextTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    button.setAttribute('title', nextTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  });
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || preferredTheme();
  const nextTheme = current === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(preferredTheme());
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', toggleTheme);
  });
});
