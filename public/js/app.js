(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PAGES = ['sessions', 'config', 'plugins', 'admin', 'account'];

  let currentUser = null;
  let pollTimer = null;

  function toast(msg, type) {
    // auto-detect type from message if not provided
    if (!type) {
      const m = String(msg || '').toLowerCase();
      if (/gagal|fail|error|tolak|forbidden|invalid|tidak/.test(m)) type = 'error';
      else if (/berhasil|saved|disalin|dibuat|dihapus|diperbarui|updated|tersalin|masuk|keluar|reset|menghubungkan|dihentikan/.test(m)) type = 'success';
      else type = 'info';
    }
    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>`,
      error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`,
      warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
      info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
    };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-msg">${escapeHtml(String(msg || ''))}</span>
      <button type="button" class="toast-close" aria-label="Tutup">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <span class="toast-progress"></span>
    `;
    const wrap = $('#toasts');
    wrap.appendChild(el);
    // force reflow then show
    requestAnimationFrame(() => el.classList.add('show'));

    const duration = type === 'error' ? 3800 : 2800;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 320);
    };
    el.querySelector('.toast-close')?.addEventListener('click', close);
    setTimeout(close, duration);
  }

  function showModal({ title, sub = '', body = '', actions = [] }) {
    $('#modalTitle').textContent = title;
    $('#modalSub').textContent = sub;
    $('#modalBody').innerHTML = body;
    const act = $('#modalActions');
    act.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm' + (a.ghost ? ' btn-ghost' : '');
      b.textContent = a.label;
      b.onclick = async () => {
        if (a.onClick) await a.onClick();
        if (!a.keep) hideModal();
      };
      act.appendChild(b);
    });
    $('#overlay').classList.add('show');
  }

  function hideModal() {
    $('#overlay').classList.remove('show');
    stopActivePairingPoll();
  }

  $('#overlay').addEventListener('click', (e) => {
    if (e.target === $('#overlay')) hideModal();
  });

  /* ——— auth ——— */
  async function tryAuth() {
    if (!API.getToken()) return false;
    try {
      currentUser = await API.me();
      return true;
    } catch {
      API.clearToken();
      if (API.clearAdminKey) API.clearAdminKey();
      return false;
    }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    stopPoll();
    if (location.pathname.startsWith('/dash')) {
      try { history.replaceState(null, '', '/login'); } catch (_) {}
    }
  }

  function showApp() {
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    if (location.pathname === '/login' || location.pathname === '/') {
      try { history.replaceState(null, '', '/dash'); } catch (_) {}
    }
    loadSessions();
    startPoll();
  }

  function showAuthForm(which) {
    const login = which === 'login';
    $('#loginForm')?.classList.toggle('hidden', !login);
    $('#registerForm')?.classList.toggle('hidden', login);
    $('#loginError') && ($('#loginError').textContent = '');
    $('#registerError') && ($('#registerError').textContent = '');
  }


  // password visibility toggles
  document.querySelectorAll('.pw-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.target;
      const input = document.getElementById(id);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-on', show);
      btn.querySelector('.icon-eye')?.classList.toggle('hidden', show);
      btn.querySelector('.icon-eye-off')?.classList.toggle('hidden', !show);
      btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    });
  });

  $('#showRegister')?.addEventListener('click', () => showAuthForm('register'));
  $('#showLogin')?.addEventListener('click', () => showAuthForm('login'));

  $('#loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    const errEl = $('#loginError');
    errEl.textContent = '';
    if (!username || !password) {
      errEl.textContent = 'Username dan password wajib diisi.';
      return;
    }
    $('#loginBtn').disabled = true;
    try {
      const { token, user } = await API.login({ username, password });
      API.setToken(token);
      currentUser = user;
      toast('Berhasil masuk');
      showApp();
    } catch (e2) {
      errEl.textContent = e2.message || 'Gagal masuk.';
    } finally {
      $('#loginBtn').disabled = false;
    }
  });

  $('#registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#regUsername').value.trim();
    const email = $('#regEmail').value.trim();
    const password = $('#regPassword').value;
    const confirmPassword = $('#regConfirmPassword').value;
    const phone = ($('#regPhone')?.value || '').trim();
    const errEl = $('#registerError');
    errEl.textContent = '';

    if (!username || !email || !password || !confirmPassword) {
      errEl.textContent = 'Lengkapi semua field yang wajib diisi.';
      return;
    }
    if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
      errEl.textContent = 'Email harus menggunakan alamat @gmail.com.';
      return;
    }
    if (password !== confirmPassword) {
      errEl.textContent = 'Konfirmasi password tidak cocok.';
      return;
    }
    if (password.length < 6) {
      errEl.textContent = 'Password minimal 6 karakter.';
      return;
    }

    $('#registerBtn').disabled = true;
    try {
      const { token, user } = await API.register({
        username,
        email,
        password,
        confirmPassword,
        phone,
      });
      API.setToken(token);
      currentUser = user;
      toast('Akun berhasil dibuat');
      showApp();
    } catch (e2) {
      errEl.textContent = e2.message || 'Pendaftaran gagal.';
    } finally {
      $('#registerBtn').disabled = false;
    }
  });

  $('#logoutBtn').addEventListener('click', () => {
    API.clearToken();
    if (API.clearAdminKey) API.clearAdminKey();
    currentUser = null;
    showLogin();
    toast('Berhasil keluar');
  });

  /* ——— nav ——— */
  function activatePage(page) {
    $$('.side-link[data-page]').forEach((b) => b.classList.remove('active'));
    $$('.side-sublink').forEach((b) => b.classList.remove('active'));
    $('#navBotSettings')?.classList.remove('active');
    PAGES.forEach((p) => $('#page-' + p).classList.toggle('hidden', p !== page));
    if (page === 'config') loadConfig();
    if (page === 'sessions') loadSessions();
    if (page === 'plugins') loadPlugins();
    if (page === 'account') loadAccount();
    if (page === 'admin') loadAdmin();
  }

  $$('.side-link[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activatePage(btn.dataset.page);
      btn.classList.add('active');
      closeSidebar();
    });
  });

  /* Bot Settings submenu: parent expands/collapses, children navigate to
     the config page and pick a tab (config / message / system) */
  $('#navBotSettings')?.addEventListener('click', () => {
    const submenu = $('#submenuBotSettings');
    if (!submenu) return;
    const isOpen = submenu.classList.toggle('open');
    $('#navBotSettings').classList.toggle('expanded', isOpen);
  });

  $$('.side-sublink[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingConfigTab = btn.dataset.configTab || null;
      activatePage(btn.dataset.page);
      btn.classList.add('active');
      $('#navBotSettings')?.classList.add('active');
      closeSidebar();
    });
  });

  function openSidebar() {
    $('#sidebar').classList.add('open');
    $('#sideBackdrop').classList.add('show');
  }
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sideBackdrop').classList.remove('show');
  }
  $('#menuBtn')?.addEventListener('click', openSidebar);
  $('#sideBackdrop')?.addEventListener('click', closeSidebar);

  /* ——— sessions ——— */
  function statusClass(s) {
    return 'status-pill status-' + (s || 'STOPPED');
  }

  /** Show Config / Plugins once user has at least one session (connect not required) */
  function updateConnectedNav(sessions) {
    const hasSession = (sessions || []).length > 0;
    const navBotSettingsGroup = document.getElementById('navBotSettingsGroup');
    const navPlugins = document.getElementById('navPlugins');
    if (navBotSettingsGroup) navBotSettingsGroup.style.display = hasSession ? '' : 'none';
    if (navPlugins) navPlugins.style.display = hasSession ? '' : 'none';

    // If user is on config/plugins but no sessions left, bounce to sessions
    if (!hasSession) {
      const onConfig = !$('#page-config').classList.contains('hidden');
      const onPlugins = !$('#page-plugins').classList.contains('hidden');
      if (onConfig || onPlugins) {
        $$('.side-link[data-page]').forEach((b) => b.classList.remove('active'));
        $$('.side-sublink').forEach((b) => b.classList.remove('active'));
        $('#navBotSettings')?.classList.remove('active', 'expanded');
        $('#submenuBotSettings')?.classList.remove('open');
        const sessionsBtn = document.querySelector('.side-link[data-page="sessions"]');
        if (sessionsBtn) sessionsBtn.classList.add('active');
        PAGES.forEach((p) => $('#page-' + p).classList.toggle('hidden', p !== 'sessions'));
      }
    }
  }

  /* ——— pairing code polling ———
     Backend butuh beberapa detik (dan kadang beberapa kali percobaan)
     untuk dapat kode pairing dari whatsapp. Jadi kita polling endpoint
     /pairing sampai kodenya siap, bukan cek sekali lalu nyerah. */
  let activePairingPoll = null;

  function stopActivePairingPoll() {
    if (activePairingPoll) {
      activePairingPoll.cancelled = true;
      activePairingPoll = null;
    }
  }

  function pollPairingCode(id, { timeoutMs = 30000, intervalMs = 1200 } = {}) {
    const token = { cancelled: false };
    activePairingPoll = token;
    const start = Date.now();

    return new Promise((resolve) => {
      (async function tick() {
        if (token.cancelled) return resolve({ cancelled: true });
        try {
          const p = await API.pairing(id);
          if (token.cancelled) return resolve({ cancelled: true });
          if (p.pairingCode) return resolve({ ok: true, code: p.pairingCode });
          if (p.pairingError) return resolve({ ok: false, error: p.pairingError });
        } catch (e) {
          if (e.status === 401) return resolve({ ok: false, error: 'sesi login habis' });
          // error jaringan sesaat — lanjut coba lagi sampai timeout
        }
        if (Date.now() - start >= timeoutMs) {
          return resolve({ ok: false, error: 'timeout menunggu kode pairing' });
        }
        setTimeout(tick, intervalMs);
      })();
    });
  }

  async function showPairingFlow(id) {
    stopActivePairingPoll();

    showModal({
      title: 'pairing code',
      sub: 'menghubungkan ke whatsapp...',
      body: `<div style="text-align:center;padding:1.25rem 0">
        <div class="pairing-spinner"></div>
        <p style="color:var(--muted);font-weight:500;font-size:0.85rem">
          meminta kode pairing, tunggu sebentar (maks. 30 detik)
        </p>
      </div>`,
      actions: [
        { label: 'batal', ghost: true, onClick: () => stopActivePairingPoll() },
      ],
    });

    const result = await pollPairingCode(id);
    if (result.cancelled) return;

    if (result.ok) {
      showModal({
        title: 'pairing code',
        sub: 'masukkan di whatsapp → perangkat tertaut → tautkan dengan nomor telepon',
        body: `<div class="pairing-code-wrap">
            <div class="pairing-code allow-select" id="pairingCodeValue">${escapeHtml(result.code)}</div>
            <button type="button" class="copy" id="copyPairingBtn" aria-label="Salin kode">
              <span data-text-end="Tersalin!" data-text-initial="Salin kode" class="tooltip"></span>
              <span class="copy-icons">
                <svg class="clipboard" viewBox="0 0 6.35 6.35" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                  <path fill="currentColor" d="M2.43.265c-.3 0-.548.236-.573.53h-.328a.74.74 0 0 0-.735.734v3.822a.74.74 0 0 0 .735.734H4.82a.74.74 0 0 0 .735-.734V1.529a.74.74 0 0 0-.735-.735h-.328a.58.58 0 0 0-.573-.53zm0 .529h1.49c.032 0 .049.017.049.049v.431c0 .032-.017.049-.049.049H2.43c-.032 0-.05-.017-.05-.049V.843c0-.032.018-.05.05-.05zm-.901.53h.328c.026.292.274.528.573.528h1.49a.58.58 0 0 0 .573-.529h.328a.2.2 0 0 1 .206.206v3.822a.2.2 0 0 1-.206.205H1.53a.2.2 0 0 1-.206-.205V1.529a.2.2 0 0 1 .206-.206z"/>
                </svg>
                <svg class="checkmark" viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">
                  <path fill="currentColor" d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z"/>
                </svg>
              </span>
            </button>
          </div>
          <p style="text-align:center;color:var(--muted);font-size:0.8rem;font-weight:500">
            kode hanya berlaku sebentar, segera masukkan di whatsapp
          </p>`,
        actions: [{ label: 'tutup', ghost: true }],
      });
      setTimeout(() => {
        const btn = document.getElementById('copyPairingBtn');
        const codeEl = document.getElementById('pairingCodeValue');
        if (btn && codeEl) {
          btn.addEventListener('click', async () => {
            const text = codeEl.textContent.trim();
            try {
              await navigator.clipboard.writeText(text);
              btn.classList.add('copied');
              toast('Kode pairing disalin');
              setTimeout(() => btn.classList.remove('copied'), 1600);
            } catch {
              const range = document.createRange();
              range.selectNodeContents(codeEl);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              toast('Seleksi kode — tekan salin');
            }
          });
        }
      }, 0);
    } else {
      showModal({
        title: 'pairing code gagal',
        sub: '',
        body: `<p style="color:var(--red);font-weight:500">
            ${escapeHtml(result.error || 'gagal mendapat kode pairing')}
          </p>
          <p style="color:var(--muted);font-size:0.85rem;font-weight:500">
            coba klik "connect" lagi, atau gunakan opsi scan qr sebagai alternatif.
          </p>`,
        actions: [{ label: 'tutup', ghost: true }],
      });
    }
    loadSessions();
  }

  async function loadSessions() {
    const list = $('#sessionList');
    try {
      const { sessions } = await API.sessions();
      updateConnectedNav(sessions);
      if (!sessions?.length) {
        list.innerHTML = `<div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M12 18h.01"/></svg>
          belum ada session.<br>buat yang baru untuk mulai.
        </div>`;
        return;
      }
      list.innerHTML = sessions
        .map(
          (s) => `
        <div class="session-card" data-id="${s.sessionId}">
          <div>
            <div class="session-name">${escapeHtml(s.name || 'session')}</div>
            <div class="session-meta">
              <span class="${statusClass(s.status)}">${(s.status || '').toLowerCase()}</span>
              ${s.phoneNumber ? ' · ' + escapeHtml(s.phoneNumber) : ''}
            </div>
          </div>
          <div class="session-actions">
            <button class="btn btn-sm btn-ghost" data-act="qr" type="button">qr</button>
            <button class="btn btn-sm btn-ghost" data-act="connect" type="button">connect</button>
            <button class="btn btn-sm btn-ghost" data-act="disconnect" type="button">stop</button>
            <button class="btn btn-sm btn-ghost" data-act="delete" type="button">hapus</button>
          </div>
        </div>`
        )
        .join('');

      list.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.closest('.session-card').dataset.id;
          handleSessionAct(btn.dataset.act, id);
        });
      });
    } catch (e) {
      if (e.status === 401) {
        showLogin();
        return;
      }
      list.innerHTML = `<div class="empty">${escapeHtml(e.message)}</div>`;
    }
  }

  async function handleSessionAct(act, id) {
    try {
      if (act === 'qr') {
        const data = await API.qr(id);
        const body = data.qr
          ? `<div class="qr-box"><img src="${data.qr}" alt="qr"></div><p style="text-align:center;color:var(--muted);font-size:0.85rem;font-weight:500">scan dengan whatsapp → perangkat tertaut</p>`
          : `<p style="color:var(--muted);font-weight:500">qr belum tersedia. status: ${(data.status || '-').toLowerCase()}. coba connect dulu.</p>`;
        showModal({
          title: 'scan qr',
          sub: 'status: ' + (data.status || '-').toLowerCase(),
          body,
          actions: [{ label: 'tutup', ghost: true }],
        });
        return;
      }
      if (act === 'connect') {
        showModal({
          title: 'connect session',
          sub: 'opsional: isi nomor untuk pairing code',
          body: `<div class="field"><label>nomor (opsional)</label><input id="pairPhone" placeholder="628xxxxxxxxxx"></div>`,
          actions: [
            { label: 'batal', ghost: true },
            {
              label: 'connect',
              onClick: async () => {
                const phone = $('#pairPhone')?.value?.trim();
                await API.connect(id, phone ? { pairingPhone: phone } : {});
                loadSessions();
                if (phone) {
                  // jangan tutup modal — showPairingFlow akan ganti isinya
                  await showPairingFlow(id);
                } else {
                  hideModal();
                  toast('menghubungkan...');
                }
              },
              keep: true,
            },
          ],
        });
        return;
      }
      if (act === 'disconnect') {
        await API.disconnect(id, { logout: false });
        toast('session dihentikan');
        loadSessions();
        return;
      }
      if (act === 'delete') {
        showModal({
          title: 'hapus session?',
          sub: 'session akan logout dari whatsapp dan dihapus.',
          actions: [
            { label: 'batal', ghost: true },
            {
              label: 'hapus',
              onClick: async () => {
                await API.deleteSession(id);
                toast('session dihapus');
                loadSessions();
              },
            },
          ],
        });
      }
    } catch (e) {
      toast(e.message || 'gagal');
    }
  }

  $('#newSessionBtn').addEventListener('click', () => {
    showModal({
      title: 'session baru',
      sub: 'buat koneksi whatsapp baru',
      body: `
        <div class="field"><label>nama</label><input id="newName" placeholder="bot utama"></div>
        <div class="field"><label>pairing phone (opsional)</label><input id="newPhone" placeholder="628xxxxxxxxxx"></div>
      `,
      actions: [
        { label: 'batal', ghost: true },
        {
          label: 'buat',
          onClick: async () => {
            const name = $('#newName')?.value?.trim();
            const pairingPhone = $('#newPhone')?.value?.trim();
            const info = await API.createSession({ name, pairingPhone: pairingPhone || undefined });
            loadSessions();
            if (pairingPhone && info?.sessionId) {
              await showPairingFlow(info.sessionId);
            } else {
              hideModal();
              toast('session dibuat');
            }
          },
          keep: true,
        },
      ],
    });
  });

  $('#refreshSessions').addEventListener('click', () => {
    loadSessions();
    toast('diperbarui');
  });

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      if (!$('#page-sessions').classList.contains('hidden')) loadSessions();
    }, 8000);
  }
  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ——— Manajemen Bot (per-session) ——— */
  let selectedConfigSession = null;
  let pendingConfigTab = null;
  let currentConfigTab = 'info';
  let selectedPluginSession = null;

  async function fillSessionSelect(selectEl, selectedId, connectedOnly = false) {
    const { sessions } = await API.sessions();
    const list = connectedOnly
      ? (sessions || []).filter((s) => s.status === 'CONNECTED')
      : (sessions || []);
    if (!list.length) {
      selectEl.innerHTML = '<option value="">— tidak ada session —</option>';
      return [];
    }
    selectEl.innerHTML = list
      .map(
        (s) =>
          `<option value="${escapeAttr(s.sessionId)}" ${s.sessionId === selectedId ? 'selected' : ''}>${escapeHtml(s.name || s.sessionId.slice(0, 8))} (${escapeHtml(s.status || '-')})</option>`
      )
      .join('');
    return list;
  }

  async function loadConfig() {
    const box = $('#configForm');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">Loading…</p>';
    try {
      const selHtml = `<div class="field session-pick"><label>Session</label><select id="configSessionSelect"></select></div>`;
      box.innerHTML = selHtml + '<div id="configFields"></div>';
      const select = $('#configSessionSelect');
      const sessions = await fillSessionSelect(select, selectedConfigSession);
      if (!sessions.length) {
        $('#configFields').innerHTML = '<div class="empty">Create a session first from the Sessions page.</div>';
        return;
      }
      if (!selectedConfigSession || !sessions.find((s) => s.sessionId === selectedConfigSession)) {
        selectedConfigSession = sessions[0].sessionId;
        select.value = selectedConfigSession;
      }
      select.addEventListener('change', () => {
        selectedConfigSession = select.value;
        renderConfigFields(selectedConfigSession);
      });
      await renderConfigFields(selectedConfigSession);
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  async function renderConfigFields(sessionId) {
    const box = $('#configFields');
    if (!sessionId) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat config...</p>';
    try {
      const { config } = await API.config(sessionId);
      if (pendingConfigTab) {
        currentConfigTab = pendingConfigTab;
        pendingConfigTab = null;
      }
      const activeTab = currentConfigTab || 'info';
      const titleMap = { info: 'config', pesan: 'message', system: 'system' };
      const pageTitle = document.querySelector('#page-config .page-title');
      if (pageTitle) pageTitle.textContent = titleMap[activeTab] || 'config';
      box.innerHTML = `
        <p class="sub" style="margin-bottom:0.75rem">Settings berlaku langsung untuk session ini saja. Session lain tidak terpengaruh.</p>

        <div class="config-tab-panel" data-panel="info" style="${activeTab === 'info' ? '' : 'display:none'}">
          <div class="field"><label>nama bot</label><input data-k="botName" value="${escapeAttr(config.botName || '')}"></div>
          <div class="field-row">
            <div class="field"><label>prefix</label><input data-k="prefix" value="${escapeAttr(config.prefix || '.')}"></div>
            <div class="field"><label>nama owner</label><input data-k="ownerName" value="${escapeAttr(config.ownerName || '')}"></div>
          </div>
          <div class="field"><label>nomor owner (pisah koma)</label><input data-k="ownerNumbers" value="${escapeAttr((config.ownerNumbers || []).join(','))}"></div>
          <div class="field-row">
            <div class="field"><label>pack name</label><input data-k="packName" value="${escapeAttr(config.packName || '')}"></div>
            <div class="field"><label>author</label><input data-k="author" value="${escapeAttr(config.author || '')}"></div>
          </div>
          <div class="field"><label>judul menu</label><input data-k="menuTitle" value="${escapeAttr(config.menuTitle || '')}"></div>
        </div>

        <div class="config-tab-panel" data-panel="pesan" style="${activeTab === 'pesan' ? '' : 'display:none'}">
          <div class="field"><label>pesan welcome</label><textarea data-k="welcomeMessage">${escapeHtml(config.welcomeMessage || '')}</textarea></div>
          <div class="field"><label>pesan maintenance</label><textarea data-k="maintenanceMessage">${escapeHtml(config.maintenanceMessage || '')}</textarea></div>
          <div class="field"><label>pesan khusus owner</label><textarea data-k="ownerOnlyMessage">${escapeHtml(config.ownerOnlyMessage || '')}</textarea></div>
          <div class="field"><label>pesan khusus admin</label><textarea data-k="adminOnlyMessage">${escapeHtml(config.adminOnlyMessage || '')}</textarea></div>
          <div class="field"><label>pesan khusus group</label><textarea data-k="groupOnlyMessage">${escapeHtml(config.groupOnlyMessage || '')}</textarea></div>
          <div class="field"><label>pesan khusus private chat</label><textarea data-k="privateOnlyMessage">${escapeHtml(config.privateOnlyMessage || '')}</textarea></div>
          <div class="field"><label>pesan khusus premium</label><textarea data-k="premiumOnlyMessage">${escapeHtml(config.premiumOnlyMessage || '')}</textarea></div>
          <div class="field"><label>pesan khusus limit habis</label><textarea data-k="limitMessage">${escapeHtml(config.limitMessage || '')}</textarea></div>
        </div>

        <div class="config-tab-panel" data-panel="system" style="${activeTab === 'system' ? '' : 'display:none'}">
          <p class="sub" style="margin:0 0 0.5rem;font-weight:700;color:var(--text)">Sistem Limit</p>
          <div class="switch-row">
            <span>gunakan limit</span>
            <div class="switch ${config.useLimit ? 'on' : ''}" data-k="useLimit" data-bool></div>
          </div>
          <div id="limitFields" style="${config.useLimit ? '' : 'display:none'}">
            <div class="field-row">
              <div class="field"><label>limit terpakai per perintah</label><input type="number" min="0" data-k="limitCost" value="${escapeAttr(config.limitCost ?? 1)}"></div>
              <div class="field"><label>limit default user baru</label><input type="number" min="0" data-k="defaultLimit" value="${escapeAttr(config.defaultLimit ?? 10)}"></div>
            </div>
            <div class="switch-row">
              <span>premium unlimited</span>
              <div class="switch ${config.premiumUnlimited ? 'on' : ''}" data-k="premiumUnlimited" data-bool></div>
            </div>
            <div class="field" id="premiumLimitField" style="${config.premiumUnlimited ? 'display:none' : ''}">
              <label>limit default premium (jika tidak unlimited)</label>
              <input type="number" min="0" data-k="premiumDefaultLimit" value="${escapeAttr(config.premiumDefaultLimit ?? 100)}">
            </div>
          </div>

          <p class="sub" style="margin:1.1rem 0 0.5rem;font-weight:700;color:var(--text)">Perilaku Bot</p>
          <div class="switch-row">
            <span>mode publik</span>
            <div class="switch ${config.publicMode ? 'on' : ''}" data-k="publicMode" data-bool></div>
          </div>
          <div class="switch-row">
            <span>maintenance</span>
            <div class="switch ${config.maintenanceMode ? 'on' : ''}" data-k="maintenanceMode" data-bool></div>
          </div>
          <div class="switch-row">
            <span>anti spam</span>
            <div class="switch ${config.antiSpam ? 'on' : ''}" data-k="antiSpam" data-bool></div>
          </div>
          <div class="switch-row">
            <span>read message</span>
            <div class="switch ${config.readMessages ? 'on' : ''}" data-k="readMessages" data-bool></div>
          </div>
          <div class="switch-row">
            <span>typing indicator</span>
            <div class="switch ${config.sendTyping ? 'on' : ''}" data-k="sendTyping" data-bool></div>
          </div>
          <div class="switch-row">
            <span>recording indicator</span>
            <div class="switch ${config.sendRecording ? 'on' : ''}" data-k="sendRecording" data-bool></div>
          </div>
        </div>
      `;
      box.querySelectorAll('.switch[data-bool]').forEach((sw) => {
        sw.addEventListener('click', () => {
          sw.classList.toggle('on');
          if (sw.dataset.k === 'useLimit') {
            const fields = box.querySelector('#limitFields');
            if (fields) fields.style.display = sw.classList.contains('on') ? '' : 'none';
          }
          if (sw.dataset.k === 'premiumUnlimited') {
            const field = box.querySelector('#premiumLimitField');
            if (field) field.style.display = sw.classList.contains('on') ? 'none' : '';
          }
        });
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  $('#saveConfigBtn').addEventListener('click', async () => {
    if (!selectedConfigSession) {
      toast('Select a session first');
      return;
    }
    const body = {};
    $$('#configFields [data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.classList.contains('switch')) {
        body[k] = el.classList.contains('on');
      } else if (k === 'ownerNumbers') {
        body[k] = el.value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      } else {
        body[k] = el.value;
      }
    });
    try {
      await API.updateConfig(selectedConfigSession, body);
      toast('Settings saved');
      renderConfigFields(selectedConfigSession);
    } catch (e) {
      toast(e.message || 'Save failed');
    }
  });

  /* ——— plugins (toggle + permission per-session) ——— */
  async function loadPlugins() {
    const box = $('#pluginList');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">Loading…</p>';
    try {
      box.innerHTML = `<div class="field session-pick"><label>Session</label><select id="pluginSessionSelect"></select></div><div id="pluginCards"></div>`;
      const select = $('#pluginSessionSelect');
      const sessions = await fillSessionSelect(select, selectedPluginSession);
      if (!sessions.length) {
        $('#pluginCards').innerHTML = '<div class="empty">Create a session first from the Sessions page.</div>';
        return;
      }
      if (!selectedPluginSession || !sessions.find((s) => s.sessionId === selectedPluginSession)) {
        selectedPluginSession = sessions[0].sessionId;
        select.value = selectedPluginSession;
      }
      select.addEventListener('change', () => {
        selectedPluginSession = select.value;
        renderPluginCards(selectedPluginSession);
      });
      await renderPluginCards(selectedPluginSession);
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  async function renderPluginCards(sessionId) {
    const box = $('#pluginCards');
    if (!sessionId) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">Loading plugins…</p>';
    try {
      const { plugins, permissions } = await API.sessionPlugins(sessionId);
      if (!plugins?.length) {
        box.innerHTML = `<div class="empty">No plugins loaded.</div>`;
        return;
      }
      const allPerms = permissions || ['everyone', 'group', 'private', 'admin', 'botadmin', 'owner'];
      const permLabels = {
        everyone: 'Everyone',
        group: 'Group Only',
        private: 'Private Only',
        admin: 'Admin Group',
        botadmin: 'Bot Admin',
        owner: 'Owner Only',
        premium: 'Premium',
      };

      const groups = {};
      for (const p of plugins) {
        const parts = String(p.file || '').split('/');
        const folder = parts.length > 1 ? parts[0] : 'other';
        if (!groups[folder]) groups[folder] = [];
        groups[folder].push(p);
      }
      const folderOrder = ['main', 'tools', 'group', 'admin', 'downloader', 'owner', 'other'];
      const sortedFolders = Object.keys(groups).sort((a, b) => {
        const ia = folderOrder.indexOf(a);
        const ib = folderOrder.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
      });

      // restore open folders from memory
      if (!window._openPluginFolders) window._openPluginFolders = {};

      let html = '';
      for (const folder of sortedFolders) {
        const list = groups[folder].slice().sort((a, b) => String(a.file).localeCompare(String(b.file)));
        const isOpen = !!window._openPluginFolders[folder];
        const enabledCount = list.filter((p) => p.enabled !== false).length;

        html += `<div class="plugin-folder ${isOpen ? 'open' : ''}" data-folder="${escapeAttr(folder)}">
          <button type="button" class="plugin-folder-toggle" data-act="fold">
            <span class="plugin-folder-left">
              <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>
              <span class="plugin-folder-name">${escapeHtml(folder)}</span>
            </span>
            <span class="plugin-folder-count">${enabledCount}/${list.length}</span>
          </button>
          <div class="plugin-folder-body">`;

        for (const p of list) {
          const primary = (p.commands && p.commands[0]) || '';
          const baseName = String(p.file || '').split('/').pop() || p.file;
          const cmds = (p.commands || []).map((c) => '.' + c).join('  ');
          const activePerms = new Set(p.permissions || p.defaultPermissions || ['everyone']);
          const defaultPerms = p.defaultPermissions || ['everyone'];
          const defaultPermsAttr = escapeAttr(JSON.stringify(defaultPerms));

          const permToggles = allPerms
            .map((perm) => {
              const on = activePerms.has(perm);
              return `<div class="switch-row">
                <span>${escapeHtml(permLabels[perm] || perm)}</span>
                <div class="switch ${on ? 'on' : ''}" data-perm="${escapeAttr(perm)}" role="switch"></div>
              </div>`;
            })
            .join('');

          const responsesHtml =
            p.responses && Object.keys(p.responses).length
              ? `<div class="plugin-responses">
                  ${Object.entries(p.responses)
                    .map(
                      ([key, r]) => `<div class="field">
                    <label>${escapeHtml(key)}${r.overridden ? ' · diubah' : ''}</label>
                    <textarea data-resp-key="${escapeAttr(key)}" rows="2">${escapeHtml(r.value)}</textarea>
                  </div>`
                    )
                    .join('')}
                </div>`
              : '';

          html += `<div class="plugin-card" data-file="${escapeAttr(p.file)}" data-command="${escapeAttr(primary)}" data-defaults='${defaultPermsAttr}'>
            <div class="plugin-head">
              <div class="plugin-head-text">
                <div class="plugin-name">${escapeHtml(baseName)}</div>
                <div class="plugin-tags">${escapeHtml(cmds)}</div>
              </div>
              <div class="switch ${p.enabled ? 'on' : ''}" data-act="toggle" title="ON/OFF"></div>
            </div>
            <div class="field" style="margin:0.45rem 0 0.25rem">
              <label>Custom commands</label>
              <input type="text" data-act="commands" placeholder="${escapeAttr((p.defaultCommands || p.commands || []).join(', '))}" value="${escapeAttr((p.customCommands || []).join(', '))}" />
              <p class="hint" style="margin:0.25rem 0 0;font-size:0.78rem;color:var(--muted)">Leave empty to use defaults (${escapeHtml((p.defaultCommands || p.commands || []).join(', '))})</p>
            </div>
            <div class="perm-list">
              <div class="perm-list-title">Permissions</div>
              ${permToggles}
            </div>
            ${responsesHtml}
            <div class="toolbar plugin-actions">
              <button class="btn btn-sm" data-act="saveState" type="button">Save</button>
              <button class="btn btn-sm btn-ghost" data-act="resetDefault" type="button">Reset</button>
            </div>
          </div>`;
        }

        html += `</div></div>`;
      }

      box.innerHTML = html;

      // folder accordion
      box.querySelectorAll('.plugin-folder-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
          const folderEl = btn.closest('.plugin-folder');
          const name = folderEl.dataset.folder;
          folderEl.classList.toggle('open');
          window._openPluginFolders[name] = folderEl.classList.contains('open');
        });
      });

      box.querySelectorAll('.plugin-card').forEach((card) => {
        const file = card.dataset.file;
        const command = card.dataset.command;
        let defaults = ['everyone'];
        try {
          defaults = JSON.parse(card.dataset.defaults || '["everyone"]');
        } catch (_) {}

        card.querySelectorAll('.switch').forEach((sw) => {
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            sw.classList.toggle('on');
          });
        });

        card.querySelector('[data-act="saveState"]')?.addEventListener('click', async () => {
          const enabled = card.querySelector('[data-act="toggle"]').classList.contains('on');
          const permissions = [...card.querySelectorAll('.switch[data-perm].on')].map(
            (el) => el.dataset.perm
          );
          if (!permissions.length) permissions.push('everyone');
          const cmdInput = card.querySelector('[data-act="commands"]');
          const cmdRaw = (cmdInput?.value || '').trim();
          const commands = cmdRaw
            ? cmdRaw.split(/[,\s]+/).map((c) => c.replace(/^\./, '').toLowerCase()).filter(Boolean)
            : [];
          try {
            await API.updateSessionPlugins(sessionId, {
              [file]: { enabled, permissions, commands },
            });
            const respBody = {};
            let hasResp = false;
            card.querySelectorAll('[data-resp-key]').forEach((el) => {
              respBody[el.dataset.respKey] = el.value;
              hasResp = true;
            });
            if (hasResp && command) {
              await API.updatePluginResponses(sessionId, command, respBody);
            }
            toast('Saved · ' + file);
            // refresh so custom commands & tags update immediately
            await renderPluginCards(sessionId);
          } catch (e) {
            toast(e.message || 'Save failed');
          }
        });

        card.querySelector('[data-act="resetDefault"]')?.addEventListener('click', async () => {
          try {
            await API.updateSessionPlugins(sessionId, {
              [file]: { enabled: true, permissions: defaults, commands: [] },
            });
            if (command && card.querySelectorAll('[data-resp-key]').length) {
              const body = {};
              card.querySelectorAll('[data-resp-key]').forEach((el) => {
                body[el.dataset.respKey] = '';
              });
              await API.updatePluginResponses(sessionId, command, body);
            }
            toast('Reset · ' + file);
            renderPluginCards(sessionId);
          } catch (e) {
            toast(e.message || 'Reset failed');
          }
        });
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  /* ——— account ——— */
  let apiKeyVisible = false;

  async function loadAccount() {
    const box = $('#accountBox');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const user = await API.me();
      currentUser = user;
      apiKeyVisible = false;
      renderAccount(user);
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderAccount(user) {
    const box = $('#accountBox');
    const masked = user.apiKey ? user.apiKey.slice(0, 6) + '••••••••••••••••••' : '-';
    box.innerHTML = `
      <div class="field"><label>username</label><input value="${escapeAttr(user.username || '')}" disabled></div>
      <div class="field"><label>nama</label><input value="${escapeAttr(user.name || '-')}" disabled></div>
      <div class="field"><label>role</label><input value="${escapeAttr(user.role || 'user')}" disabled></div>
      <div class="field">
        <label>api key <span class="hint">(untuk akses programatik — header <code>x-api-key</code>)</span></label>
        <div class="apikey-row">
          <input id="apiKeyField" value="${escapeAttr(apiKeyVisible ? user.apiKey : masked)}" disabled>
          <button class="btn btn-sm btn-ghost" id="toggleApiKey" type="button">${apiKeyVisible ? 'sembunyikan' : 'lihat'}</button>
          <button class="btn btn-sm btn-ghost" id="copyApiKey" type="button">salin</button>
        </div>
      </div>
      <div class="toolbar" style="margin-top:0.5rem">
        <button class="btn btn-sm" id="rotateApiKey" type="button">buat api key baru</button>
      </div>
    `;

    $('#toggleApiKey').addEventListener('click', () => {
      apiKeyVisible = !apiKeyVisible;
      renderAccount(currentUser);
    });
    $('#copyApiKey').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(currentUser.apiKey);
        toast('api key disalin');
      } catch {
        toast('gagal menyalin');
      }
    });
    $('#rotateApiKey').addEventListener('click', () => {
      showModal({
        title: 'buat api key baru?',
        sub: 'api key lama langsung tidak berlaku.',
        actions: [
          { label: 'batal', ghost: true },
          {
            label: 'buat baru',
            onClick: async () => {
              try {
                const { apiKey } = await API.rotateApiKey();
                currentUser.apiKey = apiKey;
                apiKeyVisible = true;
                renderAccount(currentUser);
                toast('api key baru dibuat');
              } catch (e) {
                toast(e.message || 'gagal');
              }
            },
          },
        ],
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  /* boot */
  (async () => {
    if (await tryAuth()) showApp();
    else showLogin();
  })();


  /* ——— admin panel (ADMIN_API_KEY) ——— */
  function renderAdminGate(box) {
    box.innerHTML = `
      <div class="card" style="padding:1.25rem;max-width:420px">
        <h2 class="admin-h2" style="margin-bottom:0.35rem">Admin access</h2>
        <p class="plugin-tags" style="margin-bottom:1rem">Enter the server <code>ADMIN_API_KEY</code> to open the admin panel.</p>
        <div class="field">
          <label>Admin API key</label>
          <input type="password" id="adminKeyInput" placeholder="ADMIN_API_KEY" autocomplete="off" />
        </div>
        <p class="auth-error" id="adminKeyError"></p>
        <button class="btn" type="button" id="adminKeySubmit">Continue</button>
      </div>`;
    $('#adminKeySubmit')?.addEventListener('click', async () => {
      const key = ($('#adminKeyInput')?.value || '').trim();
      const err = $('#adminKeyError');
      if (err) err.textContent = '';
      if (!key) {
        if (err) err.textContent = 'Admin API key is required.';
        return;
      }
      API.setAdminKey(key);
      try {
        await API.adminStats();
        await loadAdmin();
      } catch (e) {
        API.clearAdminKey();
        if (err) err.textContent = e.status === 401 || e.status === 403
          ? 'Invalid admin API key.'
          : (e.message || 'Authentication failed.');
      }
    });
    $('#adminKeyInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#adminKeySubmit')?.click();
    });
  }

  async function loadAdmin() {
    const box = $('#adminBox');
    if (!box) return;

    if (!API.getAdminKey()) {
      renderAdminGate(box);
      return;
    }

    box.innerHTML = '<p style="color:var(--muted);font-weight:500">Loading…</p>';
    try {
      const [stats, usersData, sessionsData] = await Promise.all([
        API.adminStats(),
        API.adminUsers({ limit: 50 }),
        API.adminSessions(),
      ]);

      const s = stats;
      box.innerHTML = `
        <div class="toolbar" style="margin-bottom:0.75rem">
          <div class="spacer"></div>
          <button class="btn btn-sm btn-ghost" type="button" id="adminLockBtn">Sign out admin</button>
        </div>
        <div class="admin-stats">
          <div class="admin-stat"><div class="admin-stat-val">${s.users?.total ?? 0}</div><div class="admin-stat-label">Users</div></div>
          <div class="admin-stat"><div class="admin-stat-val">${s.users?.active ?? 0}</div><div class="admin-stat-label">Active</div></div>
          <div class="admin-stat"><div class="admin-stat-val">${s.sessions?.connectedLive ?? 0}</div><div class="admin-stat-label">Connected</div></div>
          <div class="admin-stat"><div class="admin-stat-val">${s.sessions?.total ?? 0}</div><div class="admin-stat-label">Sessions</div></div>
          <div class="admin-stat"><div class="admin-stat-val">${s.plugins ?? 0}</div><div class="admin-stat-label">Plugins</div></div>
        </div>

        <div class="admin-section">
          <div class="admin-section-head">
            <h2 class="admin-h2">Registered users</h2>
            <input type="search" id="adminUserQ" placeholder="Search username" class="admin-search" />
          </div>
          <div id="adminUserList"></div>
        </div>

        <div class="admin-section">
          <div class="admin-section-head">
            <h2 class="admin-h2">Bot sessions</h2>
            <button class="btn btn-sm btn-ghost" type="button" id="adminRefreshSessions">Refresh</button>
          </div>
          <div id="adminSessionList"></div>
        </div>
      `;

      $('#adminLockBtn')?.addEventListener('click', () => {
        API.clearAdminKey();
        renderAdminGate(box);
      });

      renderAdminUsers(usersData.users || []);
      renderAdminSessions(sessionsData.sessions || []);

      let searchTimer;
      $('#adminUserQ')?.addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
          try {
            const data = await API.adminUsers({ q: e.target.value, limit: 50 });
            renderAdminUsers(data.users || []);
          } catch (err) {
            toast(err.message || 'Search failed');
          }
        }, 280);
      });

      $('#adminRefreshSessions')?.addEventListener('click', async () => {
        try {
          const data = await API.adminSessions();
          renderAdminSessions(data.sessions || []);
          toast('Sessions updated');
        } catch (err) {
          toast(err.message || 'Refresh failed');
        }
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        API.clearAdminKey();
        renderAdminGate(box);
        const err = $('#adminKeyError');
        if (err) err.textContent = 'Invalid or expired admin API key.';
        return;
      }
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderAdminUsers(users) {
    const el = $('#adminUserList');
    if (!el) return;
    if (!users.length) {
      el.innerHTML = '<div class="empty">No users found.</div>';
      return;
    }
    el.innerHTML = users
      .map((u) => {
        const sess = u.sessions || {};
        return `<div class="card admin-user-card" data-uid="${escapeAttr(u.userId)}">
          <div class="admin-user-top">
            <div>
              <div class="plugin-name">${escapeHtml(u.username)}${u.role === 'admin' ? ' · admin' : ''}</div>
              <div class="plugin-tags">${escapeHtml(u.name || '—')} · ${sess.total || 0} sessions · ${sess.connected || 0} connected</div>
            </div>
            <div class="switch ${u.isActive ? 'on' : ''}" data-act="active" title="Active"></div>
          </div>
          <div class="admin-user-row">
            <label>Role</label>
            <select data-act="role">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
            </select>
          </div>
          <div class="admin-user-row">
            <label>Max sessions</label>
            <input type="number" min="0" max="50" data-act="maxSessions" value="${u.maxSessions ?? 5}" />
          </div>
          <div class="toolbar" style="margin-top:0.55rem">
            <button class="btn btn-sm" data-act="saveUser" type="button">Save</button>
          </div>
        </div>`;
      })
      .join('');

    el.querySelectorAll('.admin-user-card').forEach((card) => {
      const uid = card.dataset.uid;
      card.querySelector('[data-act="active"]')?.addEventListener('click', (e) => {
        e.currentTarget.classList.toggle('on');
      });
      card.querySelector('[data-act="saveUser"]')?.addEventListener('click', async () => {
        const body = {
          isActive: card.querySelector('[data-act="active"]').classList.contains('on'),
          role: card.querySelector('[data-act="role"]').value,
          maxSessions: parseInt(card.querySelector('[data-act="maxSessions"]').value, 10),
        };
        try {
          await API.adminPatchUser(uid, body);
          toast('User updated');
        } catch (e) {
          toast(e.message || 'Update failed');
        }
      });
    });
  }

  function renderAdminSessions(sessions) {
    const el = $('#adminSessionList');
    if (!el) return;
    if (!sessions.length) {
      el.innerHTML = '<div class="empty">No active sessions.</div>';
      return;
    }
    el.innerHTML = sessions
      .map((s) => {
        const uname = s.user?.username || s.userId?.slice(0, 8) || '—';
        return `<div class="card admin-session-card" data-sid="${escapeAttr(s.sessionId)}">
          <div class="admin-user-top">
            <div>
              <div class="plugin-name">${escapeHtml(s.name || s.sessionId.slice(0, 8))}</div>
              <div class="plugin-tags">
                <span class="${statusClass(s.status)}">${escapeHtml((s.status || '').toLowerCase())}</span>
                · ${escapeHtml(uname)}
                ${s.phoneNumber ? ' · ' + escapeHtml(s.phoneNumber) : ''}
              </div>
            </div>
          </div>
          <div class="toolbar" style="margin-top:0.55rem">
            <button class="btn btn-sm btn-ghost" data-act="disc" type="button">Disconnect</button>
            <button class="btn btn-sm btn-ghost" data-act="del" type="button">Delete</button>
          </div>
        </div>`;
      })
      .join('');

    el.querySelectorAll('.admin-session-card').forEach((card) => {
      const sid = card.dataset.sid;
      card.querySelector('[data-act="disc"]')?.addEventListener('click', async () => {
        try {
          await API.adminDisconnectSession(sid, { logout: false });
          toast('Session disconnected');
          loadAdmin();
        } catch (e) {
          toast(e.message || 'Disconnect failed');
        }
      });
      card.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
        if (!confirm('Delete this session permanently?')) return;
        try {
          await API.adminDeleteSession(sid);
          toast('Session deleted');
          loadAdmin();
        } catch (e) {
          toast(e.message || 'Delete failed');
        }
      });
    });
  }


})();
