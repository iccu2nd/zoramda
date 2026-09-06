export function initThemeToggle(buttonEl) {
  const icon = buttonEl.querySelector('i');

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    localStorage.setItem('zora-theme', theme);
  }

  const saved = localStorage.getItem('zora-theme') || 'light';
  apply(saved);

  buttonEl.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    apply(current === 'dark' ? 'light' : 'dark');
  });
}
