(function () {
  const KEY = 'zb_theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function updateToggleButtons() {
    const isDark = currentTheme() === 'dark';
    document.querySelectorAll('[data-theme-input]').forEach((input) => {
      input.checked = isDark;
    });
    document.querySelectorAll('[data-theme-toggle]').forEach((el) => {
      el.setAttribute('aria-pressed', String(isDark));
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
    document.querySelectorAll('[data-theme-input]').forEach((input) => {
      input.addEventListener('change', function () {
        apply(input.checked ? 'dark' : 'light');
      });
    });
  });

  window.zbTheme = { toggle, apply, current: currentTheme };
})();
