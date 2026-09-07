(function () {
  const KEY = 'zb_theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function updateToggleButtons() {
    const isDark = currentTheme() === 'dark';

    // Dual Light / Dark switches (landing + anywhere using data-theme-set)
    document.querySelectorAll('[data-theme-set]').forEach((btn) => {
      const mode = btn.getAttribute('data-theme-set');
      const sw = btn.querySelector('.switch');
      const active = mode === (isDark ? 'dark' : 'light');
      btn.classList.toggle('is-active', active);
      if (sw) {
        sw.classList.toggle('on', active);
        sw.setAttribute('aria-checked', String(active));
      }
    });

    // Legacy single toggle buttons (sidebar)
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = isDark ? 'Light' : 'Dark';
      btn.setAttribute('aria-pressed', String(isDark));
      // If it has an inner switch, reflect state
      const sw = btn.querySelector('.switch');
      if (sw) sw.classList.toggle('on', isDark);
    });
  }

  function apply(t) {
    const theme = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0f1115' : '#eef0f4';
    updateToggleButtons();
  }

  function toggle() {
    apply(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateToggleButtons();

    document.querySelectorAll('[data-theme-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        apply(btn.getAttribute('data-theme-set'));
      });
    });

    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', toggle);
    });
  });

  window.zbTheme = { toggle, apply, current: currentTheme };
})();
