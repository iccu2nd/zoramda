(function () {
  const KEY = 'zb_theme';

  // sun = "lagi terang, klik buat gelap" · moon = "lagi gelap, klik buat terang"
  const SUN =
    '<svg data-theme-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON =
    '<svg data-theme-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function updateToggleButtons() {
    const isDark = currentTheme() === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const icon = btn.querySelector('[data-theme-icon]');
      if (icon) icon.outerHTML = isDark ? MOON : SUN;
      const label = btn.querySelector('[data-theme-label]');
      if (label) label.textContent = isDark ? 'mode terang' : 'mode gelap';
      btn.setAttribute('aria-pressed', String(isDark));
    });
  }

  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'dark' ? '#0f1115' : '#eef0f4';
    updateToggleButtons();
  }

  function toggle() {
    apply(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  document.addEventListener('DOMContentLoaded', function () {
    updateToggleButtons();
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', toggle);
    });
  });

  window.zbTheme = { toggle, apply, current: currentTheme };
})();
