const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const state = {
  user: null,
  bots: [],
  plugins: {},
  pollTimer: null,
  currentModalBotId: null
};

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function show(view) {
  $('#view-auth').classList.toggle('hidden', view !== 'auth');
  $('#view-main').classList.toggle('hidden', view !== 'main');
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('zora-theme', theme);
  const label = $('#theme-label');
  if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#eef0f4');
}

function initTheme() {
  const t = localStorage.getItem('zora-theme') || 'light';
  setTheme(t);
  $('#btn-theme')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });
}

function statusLabel(s) {
  const map = {
    connected: 'Connected',
    connecting: 'Connecting',
    qr: 'Scan QR',
    pairing: 'Pairing Code',
    disconnected: 'Disconnected'
  };
  return map[s] || s;
}

function formatUptime(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function renderBots() {
  const list = $('#bots-list');
  const empty = $('#empty-state');
  if (!state.bots.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.bots.map((b) => `
    <div class="bot-card" data-id="${b.id}">
      <div class="bot-card-top">
        <div>
          <div class="bot-name">${escapeHtml(b.name)}</div>
          <div class="bot-meta">
            <span class="status-badge ${b.status}">
              <span class="dot"></span>
              ${statusLabel(b.status)}
            </span>
            <span>${b.phoneNumber ? '+' + escapeHtml(b.phoneNumber) : 'Belum terhubung'}</span>
            <span>Uptime ${formatUptime(b.uptime)}</span>
          </div>
        </div>
      </div>
      <div class="bot-actions">
        ${b.status === 'disconnected' ? `
          <button class="btn btn-primary btn-sm" data-action="connect" data-id="${b.id}">Connect</button>
        ` : `
          <button class="btn btn-outline btn-sm" data-action="disconnect" data-id="${b.id}">Disconnect</button>
          ${b.status !== 'pairing' ? `<button class="btn btn-outline btn-sm" data-action="reconnect" data-id="${b.id}">Reconnect</button>` : ''}
        `}
        <button class="btn btn-outline btn-sm" data-action="settings" data-id="${b.id}">Settings</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${b.id}">Hapus</button>
      </div>
      ${b.qr && (b.status === 'qr' || b.status === 'connecting') ? `
        <div class="bot-qr">
          <img src="${b.qr}" alt="QR Code" />
          <p>Scan QR dengan WhatsApp</p>
        </div>
      ` : ''}
      ${b.pairingCode && (b.status === 'pairing' || b.status === 'connecting') ? `
        <div class="bot-pairing">
          <div class="pairing-code">${escapeHtml(b.pairingCode)}</div>
          <p class="text-secondary">Masukkan kode di WhatsApp → Perangkat Tertaut → Tautkan dengan nomor telepon</p>
        </div>
      ` : ''}
    </div>
  `).join('');

  list.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleBotAction(btn.dataset.action, btn.dataset.id));
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function handleBotAction(action, id) {
  try {
    if (action === 'connect') {
      window.location.href = `/connect?id=${encodeURIComponent(id)}`;
      return;
    } else if (action === 'disconnect') {
      await api(`/bots/${id}/disconnect`, { method: 'POST' });
    } else if (action === 'reconnect') {
      await api(`/bots/${id}/reconnect`, { method: 'POST' });
    } else if (action === 'delete') {
      if (!confirm('Hapus bot ini? Session akan dihapus.')) return;
      await api(`/bots/${id}`, { method: 'DELETE' });
    } else if (action === 'settings') {
      openSettings(id);
      return;
    }
    await refreshBots();
  } catch (err) {
    alert(err.message);
  }
}

function openConnectModal(botId) {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;
  state.currentModalBotId = botId;
  $('#modal-title').textContent = 'Hubungkan ' + (bot.name || 'Bot');
  const body = $('#modal-body');
  body.innerHTML = `
    <div class="settings-section">
      <h3>Metode</h3>
      <div class="connect-methods">
        <button type="button" class="btn btn-outline btn-block connect-method" data-method="qr">
          <i class="fa-solid fa-qrcode"></i>
          <span>QR Code</span>
        </button>
        <button type="button" class="btn btn-outline btn-block connect-method" data-method="pairing">
          <i class="fa-solid fa-mobile-screen"></i>
          <span>Pairing Code</span>
        </button>
      </div>
    </div>
    <div id="pairing-fields" class="settings-section hidden">
      <h3>Nomor WhatsApp</h3>
      <div class="field">
        <label>Kode negara + nomor (hanya angka)</label>
        <input type="tel" id="pair-phone" placeholder="6281234567890" inputmode="numeric" autocomplete="tel" />
        <p class="setting-desc" style="margin-top:0.4rem">Contoh: 6281234567890 (tanpa +, spasi, atau strip)</p>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="btn-start-pairing" style="margin-top:0.75rem">
        Minta Pairing Code
      </button>
    </div>
  `;
  $('#modal-overlay').classList.remove('hidden');

  body.querySelector('[data-method="qr"]').addEventListener('click', async () => {
    try {
      closeModal();
      await api(`/bots/${botId}/connect`, { method: 'POST', body: { method: 'qr' } });
      await refreshBots();
    } catch (err) {
      alert(err.message);
    }
  });

  body.querySelector('[data-method="pairing"]').addEventListener('click', () => {
    $('#pairing-fields').classList.remove('hidden');
    body.querySelectorAll('.connect-method').forEach((b) => b.classList.remove('btn-primary'));
    body.querySelector('[data-method="pairing"]').classList.add('btn-primary');
    body.querySelector('[data-method="pairing"]').classList.remove('btn-outline');
    body.querySelector('[data-method="qr"]').classList.add('btn-outline');
    body.querySelector('[data-method="qr"]').classList.remove('btn-primary');
  });

  $('#btn-start-pairing')?.addEventListener('click', async () => {
    const phone = $('#pair-phone')?.value?.trim() || '';
    try {
      closeModal();
      await api(`/bots/${botId}/connect`, {
        method: 'POST',
        body: { method: 'pairing', phone }
      });
      await refreshBots();
    } catch (err) {
      alert(err.message);
    }
  });
}

async function openSettings(botId) {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;
  state.currentModalBotId = botId;

  if (!Object.keys(state.plugins).length) {
    try {
      const data = await api('/plugins');
      state.plugins = data.plugins || {};
    } catch {}
  }

  const body = $('#modal-body');
  $('#modal-title').textContent = bot.name;

  const pluginsHtml = Object.values(state.plugins).map((p) => {
    const enabled = bot.plugins?.[p.command] !== false;
    return `
      <div class="plugin-item">
        <div>
          <code>${escapeHtml(p.command)}</code>
          <span class="text-secondary" style="margin-left:0.4rem;font-size:0.8rem">${escapeHtml(p.description || '')}</span>
        </div>
        <button type="button" class="toggle ${enabled ? 'on' : ''}" data-plugin="${p.command}" aria-label="Toggle plugin"></button>
      </div>
    `;
  }).join('') || '<p class="text-secondary">Tidak ada plugin</p>';

  body.innerHTML = `
    <div class="settings-section">
      <h3>Umum</h3>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Nama Bot</div>
          <div class="setting-desc">Ditampilkan di menu dan info</div>
        </div>
        <div class="setting-control">
          <input type="text" id="set-name" value="${escapeHtml(bot.name)}" maxlength="64" />
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Prefix</div>
          <div class="setting-desc">Karakter sebelum command. Default: .</div>
        </div>
        <div class="setting-control">
          <input type="text" id="set-prefix" value="${escapeHtml(bot.prefix || '.')}" maxlength="5" style="width:60px" />
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Menu</h3>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Judul Menu</div>
        </div>
        <div class="setting-control">
          <input type="text" id="set-menuTitle" value="${escapeHtml(bot.menuTitle || '')}" />
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Deskripsi Menu</div>
        </div>
        <div class="setting-control">
          <input type="text" id="set-menuDescription" value="${escapeHtml(bot.menuDescription || '')}" />
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Footer</div>
        </div>
        <div class="setting-control">
          <input type="text" id="set-footer" value="${escapeHtml(bot.footer || '')}" />
        </div>
      </div>
    </div>
    <div class="settings-section">
      <h3>Plugin</h3>
      <div class="plugin-list" id="plugin-toggles">
        ${pluginsHtml}
      </div>
    </div>
    <div style="margin-top:1.25rem">
      <button type="button" class="btn btn-primary btn-block" id="btn-save-settings">Simpan</button>
    </div>
  `;

  $('#modal-overlay').classList.remove('hidden');

  body.querySelectorAll('.toggle[data-plugin]').forEach((btn) => {
    btn.addEventListener('click', () => btn.classList.toggle('on'));
  });

  $('#btn-save-settings').addEventListener('click', async () => {
    const plugins = {};
    body.querySelectorAll('.toggle[data-plugin]').forEach((btn) => {
      plugins[btn.dataset.plugin] = btn.classList.contains('on');
    });
    const patch = {
      name: $('#set-name').value.trim() || bot.name,
      prefix: $('#set-prefix').value.trim() || '.',
      menuTitle: $('#set-menuTitle').value.trim(),
      menuDescription: $('#set-menuDescription').value.trim(),
      footer: $('#set-footer').value.trim(),
      plugins
    };
    try {
      await api(`/bots/${botId}`, { method: 'PATCH', body: patch });
      closeModal();
      await refreshBots();
    } catch (err) {
      alert(err.message);
    }
  });
}

function closeModal() {
  $('#modal-overlay').classList.add('hidden');
  state.currentModalBotId = null;
}

async function refreshBots() {
  try {
    const data = await api('/bots');
    state.bots = data.bots || [];
    renderBots();
  } catch (err) {
    if (err.message.includes('Unauthorized') || err.message.includes('Session')) {
      stopPoll();
      state.user = null;
      show('auth');
    }
  }
}

function startPoll() {
  stopPoll();
  state.pollTimer = setInterval(refreshBots, 3000);
}

function stopPoll() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function trySession() {
  try {
    const data = await api('/auth/me');
    state.user = data.user;
    show('main');
    await refreshBots();
    startPoll();
  } catch {
    show('auth');
  }
}

function initAuth() {
  $$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      $('#form-login').classList.toggle('hidden', !isLogin);
      $('#form-register').classList.toggle('hidden', isLogin);
    });
  });

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#login-error');
    errEl.classList.add('hidden');
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { username: fd.get('username'), password: fd.get('password') }
      });
      state.user = data.user;
      show('main');
      await refreshBots();
      startPoll();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = $('#register-error');
    errEl.classList.add('hidden');
    try {
      const data = await api('/auth/register', {
        method: 'POST',
        body: { username: fd.get('username'), password: fd.get('password') }
      });
      state.user = data.user;
      show('main');
      await refreshBots();
      startPoll();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });

  $('#btn-logout')?.addEventListener('click', async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    stopPoll();
    state.user = null;
    state.bots = [];
    show('auth');
  });

  const create = async () => {
    try {
      await api('/bots', { method: 'POST', body: { name: 'ZoraBot' } });
      await refreshBots();
    } catch (err) {
      alert(err.message);
    }
  };
  $('#btn-create-bot')?.addEventListener('click', create);
  $('#btn-create-bot-empty')?.addEventListener('click', create);

  $('#modal-close')?.addEventListener('click', closeModal);
  $('#modal-overlay')?.addEventListener('click', (e) => {
    if (e.target === $('#modal-overlay')) closeModal();
  });
}

initTheme();
initAuth();
trySession();
