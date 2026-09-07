(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PAGES = ['sessions', 'config', 'plugins', 'account', 'admin'];

  let currentUser = null;
  let pollTimer = null;

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s';
      setTimeout(() => el.remove(), 250);
    }, 2800);
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
      return false;
    }
  }

  function showLogin() {
    $('#loginView').classList.remove('hidden');
    $('#appView').classList.add('hidden');
    stopPoll();
  }

  function showApp() {
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    $('#adminNavBtn').classList.toggle('hidden', !currentUser?.isAdmin);
    loadSessions();
    startPoll();
  }

  /* auth tabs */
  $$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      $('#loginForm').classList.toggle('hidden', which !== 'login');
      $('#registerForm').classList.toggle('hidden', which !== 'register');
    });
  });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    const errEl = $('#loginError');
    errEl.textContent = '';
    if (!username || !password) {
      errEl.textContent = 'isi username dan password';
      return;
    }
    $('#loginBtn').disabled = true;
    try {
      const { token, user } = await API.login({ username, password });
      API.setToken(token);
      currentUser = user;
      toast('berhasil masuk');
      showApp();
    } catch (e2) {
      errEl.textContent = e2.message || 'gagal masuk';
    } finally {
      $('#loginBtn').disabled = false;
    }
  });

  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#regName').value.trim();
    const username = $('#regUsername').value.trim();
    const password = $('#regPassword').value;
    const errEl = $('#registerError');
    errEl.textContent = '';
    if (!username || !password) {
      errEl.textContent = 'isi username dan password';
      return;
    }
    $('#registerBtn').disabled = true;
    try {
      const { token, user } = await API.register({ username, password, name });
      API.setToken(token);
      currentUser = user;
      toast('akun dibuat, selamat datang!');
      showApp();
    } catch (e2) {
      errEl.textContent = e2.message || 'gagal daftar';
    } finally {
      $('#registerBtn').disabled = false;
    }
  });

  $('#logoutBtn').addEventListener('click', () => {
    API.clearToken();
    currentUser = null;
    showLogin();
    toast('keluar');
  });

  /* ——— nav ——— */
  $$('.side-link[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.side-link[data-page]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      PAGES.forEach((p) => $('#page-' + p).classList.toggle('hidden', p !== page));
      if (page === 'config') loadConfig();
      if (page === 'sessions') loadSessions();
      if (page === 'plugins') loadPlugins();
      if (page === 'account') loadAccount();
      if (page === 'admin') loadAdminOverview();
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
        body: `<div class="pairing-code">${escapeHtml(result.code)}</div>
          <p style="text-align:center;color:var(--muted);font-size:0.8rem;font-weight:500">
            kode hanya berlaku sebentar, segera masukkan di whatsapp
          </p>`,
        actions: [{ label: 'tutup', ghost: true }],
      });
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

  /* ——— config (per-akun, selalu bisa diedit oleh pemiliknya) ——— */
  async function loadConfig() {
    const box = $('#configForm');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const { config } = await API.config();

      box.innerHTML = `
        <div class="field"><label>nama bot</label><input data-k="botName" value="${escapeAttr(config.botName || '')}"></div>
        <div class="field-row">
          <div class="field"><label>prefix</label><input data-k="prefix" value="${escapeAttr(config.prefix || '.')}"></div>
          <div class="field"><label>nama owner</label><input data-k="ownerName" value="${escapeAttr(config.ownerName || '')}"></div>
        </div>
        <div class="field"><label>nomor owner (pisah koma)</label><input data-k="ownerNumbers" value="${escapeAttr((config.ownerNumbers || []).join(','))}"></div>
        <div class="field"><label>judul menu</label><input data-k="menuTitle" value="${escapeAttr(config.menuTitle || '')}"></div>
        <div class="field"><label>pesan welcome</label><textarea data-k="welcomeMessage">${escapeHtml(config.welcomeMessage || '')}</textarea></div>
        <div class="field"><label>pesan maintenance</label><textarea data-k="maintenanceMessage">${escapeHtml(config.maintenanceMessage || '')}</textarea></div>
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
      `;

      box.querySelectorAll('.switch[data-bool]').forEach((sw) => {
        sw.addEventListener('click', () => sw.classList.toggle('on'));
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  $('#saveConfigBtn').addEventListener('click', async () => {
    const body = {};
    $$('#configForm [data-k]').forEach((el) => {
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
      await API.updateConfig(body);
      toast('config disimpan');
      loadConfig();
    } catch (e) {
      toast(e.message || 'gagal simpan');
    }
  });

  /* ——— plugins (semua command yang ke-load dari folder /plugins) ——— */
  async function loadPlugins() {
    const box = $('#pluginList');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const { plugins } = await API.plugins();
      if (!plugins?.length) {
        box.innerHTML = `<div class="empty">belum ada plugin ter-load.</div>`;
        return;
      }
      box.innerHTML = plugins
        .map(
          (p) => `
        <div class="card plugin-card" data-command="${escapeAttr(p.command)}" style="padding:1.1rem;margin-bottom:1rem">
          <div class="plugin-head">
            <div>
              <div class="plugin-name">.${escapeHtml((p.commands || [p.command]).join(' / .'))}</div>
              <div class="plugin-tags">${(p.tags || []).map(escapeHtml).join(', ')}</div>
            </div>
          </div>
          ${
            p.editable
              ? Object.entries(p.responses)
                  .map(
                    ([key, r]) => `
            <div class="field">
              <label>${escapeHtml(key)}${r.overridden ? ' <span class="chip-mini">custom</span>' : ''}</label>
              <textarea data-resp-key="${escapeAttr(key)}">${escapeHtml(r.value)}</textarea>
            </div>`
                  )
                  .join('')
              : `<p class="hint">tidak ada teks balasan yang bisa diedit untuk command ini.</p>`
          }
          ${
            p.editable
              ? `<div class="toolbar" style="margin-top:0.25rem">
            <button class="btn btn-sm" data-act="savePlugin" type="button">simpan</button>
            <button class="btn btn-sm btn-ghost" data-act="resetPlugin" type="button">reset ke default</button>
          </div>`
              : ''
          }
        </div>`
        )
        .join('');

      box.querySelectorAll('.plugin-card').forEach((card) => {
        const command = card.dataset.command;
        card.querySelector('[data-act="savePlugin"]')?.addEventListener('click', async () => {
          const body = {};
          card.querySelectorAll('[data-resp-key]').forEach((el) => {
            body[el.dataset.respKey] = el.value;
          });
          try {
            await API.updatePluginResponses(command, body);
            toast('respons .' + command + ' disimpan');
            loadPlugins();
          } catch (e) {
            toast(e.message || 'gagal simpan');
          }
        });
        card.querySelector('[data-act="resetPlugin"]')?.addEventListener('click', async () => {
          const body = {};
          card.querySelectorAll('[data-resp-key]').forEach((el) => {
            body[el.dataset.respKey] = ''; // empty string resets to default
          });
          try {
            await API.updatePluginResponses(command, body);
            toast('dikembalikan ke default');
            loadPlugins();
          } catch (e) {
            toast(e.message || 'gagal reset');
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

  /* ——— admin (superadmin — semua user & semua bot) ——— */
  const ADMIN_TABS = ['overview', 'users', 'bots', 'broadcast'];
  let adminBroadcastSessions = [];
  let adminSelectedSessionId = null;

  $$('#adminTabs [data-atab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#adminTabs [data-atab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.atab;
      ADMIN_TABS.forEach((t) => $('#admin' + capitalize(t) + 'Box')?.classList.toggle('hidden', t !== tab));
      if (tab === 'overview') loadAdminOverview();
      if (tab === 'users') loadAdminUsers();
      if (tab === 'bots') loadAdminBots();
      if (tab === 'broadcast') loadAdminBroadcast();
    });
  });

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  async function loadAdminOverview() {
    const box = $('#adminOverviewBox');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const data = await API.adminOverview();
      const statusRows = Object.entries(data.sessions.byStatus || {})
        .map(([k, v]) => `<div class="switch-row"><span>${escapeHtml(k.toLowerCase())}</span><span>${v}</span></div>`)
        .join('');
      box.innerHTML = `
        <div class="card" style="padding:1.25rem;margin-bottom:1rem">
          <h3>users</h3>
          <p>${data.users.total} total &middot; ${data.users.active} aktif</p>
        </div>
        <div class="card" style="padding:1.25rem;margin-bottom:1rem">
          <h3>bots / sessions</h3>
          <p>${data.sessions.total} total</p>
          ${statusRows}
        </div>
        <div class="card" style="padding:1.25rem">
          <h3>server</h3>
          <p>uptime ${Math.floor(data.server.uptimeSeconds / 60)} menit &middot; memory ${data.server.memoryMb} MB</p>
        </div>
      `;
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  async function loadAdminUsers() {
    const box = $('#adminUsersBox');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const { users } = await API.adminUsers();
      if (!users?.length) {
        box.innerHTML = '<div class="empty">belum ada user.</div>';
        return;
      }
      box.innerHTML = `<div class="session-grid">${users
        .map(
          (u) => `
        <div class="session-card" data-id="${u.userId}">
          <div>
            <div class="session-name">${escapeHtml(u.username)} ${u.isAdmin ? '<span class="chip-mini">admin</span>' : ''}</div>
            <div class="session-meta">
              <span class="status-pill ${u.isActive ? 'status-CONNECTED' : 'status-STOPPED'}">${u.isActive ? 'aktif' : 'nonaktif'}</span>
              &middot; ${u.sessionCount} bot ${u.name ? '&middot; ' + escapeHtml(u.name) : ''}
            </div>
          </div>
          <div class="session-actions">
            <button class="btn btn-sm btn-ghost" data-act="edit" type="button">edit</button>
            <button class="btn btn-sm btn-ghost" data-act="password" type="button">reset password</button>
            <button class="btn btn-sm btn-ghost" data-act="deactivate" type="button">nonaktifkan</button>
          </div>
        </div>`
        )
        .join('')}</div>`;

      box.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const userId = btn.closest('.session-card').dataset.id;
          const user = users.find((u) => u.userId === userId);
          handleAdminUserAct(btn.dataset.act, user);
        });
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  async function handleAdminUserAct(act, user) {
    if (act === 'edit') {
      showModal({
        title: 'edit ' + user.username,
        sub: 'ubah role & batas session',
        body: `
          <div class="field"><label>nama</label><input id="editName" value="${escapeAttr(user.name || '')}"></div>
          <div class="field"><label>max session</label><input id="editMax" type="number" min="1" value="${escapeAttr(user.maxSessions || 5)}"></div>
          <div class="switch-row">
            <span>role admin</span>
            <div class="switch ${user.isAdmin ? 'on' : ''}" id="editRole" data-bool></div>
          </div>
        `,
        actions: [
          { label: 'batal', ghost: true },
          {
            label: 'simpan',
            onClick: async () => {
              const isAdmin = $('#editRole').classList.contains('on');
              try {
                await API.adminUpdateUser(user.userId, {
                  name: $('#editName').value.trim(),
                  maxSessions: $('#editMax').value,
                  role: isAdmin ? 'admin' : 'user',
                });
                toast('user diperbarui');
                loadAdminUsers();
              } catch (e) {
                toast(e.message || 'gagal simpan');
              }
            },
          },
        ],
      });
      $('#editRole')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
      return;
    }
    if (act === 'password') {
      showModal({
        title: 'reset password ' + user.username,
        sub: 'minimal 6 karakter',
        body: `<div class="field"><label>password baru</label><input id="newPass" type="password"></div>`,
        actions: [
          { label: 'batal', ghost: true },
          {
            label: 'reset',
            onClick: async () => {
              const pw = $('#newPass')?.value || '';
              try {
                await API.adminResetPassword(user.userId, pw);
                toast('password direset');
              } catch (e) {
                toast(e.message || 'gagal reset');
              }
            },
          },
        ],
      });
      return;
    }
    if (act === 'deactivate') {
      showModal({
        title: 'nonaktifkan ' + user.username + '?',
        sub: 'semua bot milik user ini akan dihentikan.',
        actions: [
          { label: 'batal', ghost: true },
          {
            label: 'nonaktifkan',
            onClick: async () => {
              try {
                await API.adminDeactivateUser(user.userId);
                toast('user dinonaktifkan');
                loadAdminUsers();
              } catch (e) {
                toast(e.message || 'gagal');
              }
            },
          },
        ],
      });
    }
  }

  async function loadAdminBots() {
    const box = $('#adminBotsBox');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const { sessions } = await API.adminSessions();
      if (!sessions?.length) {
        box.innerHTML = '<div class="empty">belum ada bot di platform.</div>';
        return;
      }
      box.innerHTML = `<div class="session-grid">${sessions
        .map(
          (s) => `
        <div class="session-card" data-id="${s.sessionId}">
          <div>
            <div class="session-name">${escapeHtml(s.name || 'session')}</div>
            <div class="session-meta">
              <span class="${statusClass(s.status)}">${(s.status || '').toLowerCase()}</span>
              &middot; owner: ${escapeHtml(s.ownerUsername)}
              ${s.phoneNumber ? ' &middot; ' + escapeHtml(s.phoneNumber) : ''}
            </div>
          </div>
          <div class="session-actions">
            <button class="btn btn-sm btn-ghost" data-act="connect" type="button">connect</button>
            <button class="btn btn-sm btn-ghost" data-act="disconnect" type="button">stop</button>
            <button class="btn btn-sm btn-ghost" data-act="delete" type="button">hapus</button>
          </div>
        </div>`
        )
        .join('')}</div>`;

      box.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.closest('.session-card').dataset.id;
          handleAdminBotAct(btn.dataset.act, id);
        });
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  async function handleAdminBotAct(act, id) {
    try {
      if (act === 'connect') {
        await API.adminConnectSession(id, {});
        toast('menghubungkan...');
        loadAdminBots();
        return;
      }
      if (act === 'disconnect') {
        await API.adminDisconnectSession(id, { logout: false });
        toast('bot dihentikan');
        loadAdminBots();
        return;
      }
      if (act === 'delete') {
        showModal({
          title: 'hapus bot ini?',
          sub: 'session akan logout dari whatsapp dan dihapus.',
          actions: [
            { label: 'batal', ghost: true },
            {
              label: 'hapus',
              onClick: async () => {
                await API.adminDeleteSession(id);
                toast('bot dihapus');
                loadAdminBots();
              },
            },
          ],
        });
      }
    } catch (e) {
      toast(e.message || 'gagal');
    }
  }

  async function loadAdminBroadcast() {
    const box = $('#adminBroadcastBox');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const { sessions } = await API.adminSessions();
      adminBroadcastSessions = (sessions || []).filter((s) => s.status === 'CONNECTED');
      if (!adminBroadcastSessions.length) {
        box.innerHTML = '<div class="empty">tidak ada bot yang sedang terhubung.</div>';
        return;
      }
      if (!adminSelectedSessionId || !adminBroadcastSessions.find((s) => s.sessionId === adminSelectedSessionId)) {
        adminSelectedSessionId = adminBroadcastSessions[0].sessionId;
      }
      renderAdminBroadcast();
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderAdminBroadcast() {
    const box = $('#adminBroadcastBox');
    box.innerHTML = `
      <div class="card" style="padding:1.25rem;margin-bottom:1rem">
        <div class="field">
          <label>pilih bot (terhubung)</label>
          <select id="broadcastSessionSelect">
            ${adminBroadcastSessions
              .map(
                (s) =>
                  `<option value="${s.sessionId}" ${s.sessionId === adminSelectedSessionId ? 'selected' : ''}>${escapeHtml(
                    s.name || s.sessionId
                  )} (${escapeHtml(s.ownerUsername)})</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="field"><label>pesan broadcast</label><textarea id="broadcastMessage" placeholder="dikirim ke semua grup bot ini"></textarea></div>
        <div class="toolbar">
          <button class="btn btn-sm" id="sendBroadcastBtn" type="button">kirim ke semua grup</button>
        </div>
      </div>
      <div class="toolbar" style="margin-bottom:0.5rem">
        <button class="btn btn-sm btn-ghost" id="loadGroupsBtn" type="button">muat daftar grup</button>
      </div>
      <div id="adminGroupList"></div>
    `;

    $('#broadcastSessionSelect').addEventListener('change', (e) => {
      adminSelectedSessionId = e.target.value;
      $('#adminGroupList').innerHTML = '';
    });

    $('#sendBroadcastBtn').addEventListener('click', async () => {
      const message = $('#broadcastMessage').value.trim();
      if (!message) return toast('isi pesan dulu');
      try {
        const r = await API.adminBroadcast(adminSelectedSessionId, message);
        toast(`broadcast dikirim ke ${r.groupCount} grup`);
      } catch (e) {
        toast(e.message || 'gagal broadcast');
      }
    });

    $('#loadGroupsBtn').addEventListener('click', loadAdminGroups);
  }

  async function loadAdminGroups() {
    const list = $('#adminGroupList');
    list.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat grup...</p>';
    try {
      const { groups } = await API.adminGroups(adminSelectedSessionId);
      if (!groups?.length) {
        list.innerHTML = '<div class="empty">bot ini belum join grup manapun.</div>';
        return;
      }
      list.innerHTML = `<div class="session-grid">${groups
        .map(
          (g) => `
        <div class="session-card" data-gid="${escapeAttr(g.id)}">
          <div>
            <div class="session-name">${escapeHtml(g.subject || g.id)}</div>
            <div class="session-meta">${g.participants} member</div>
          </div>
          <div class="session-actions">
            <button class="btn btn-sm btn-ghost" data-gact="tag" type="button">tag</button>
            <button class="btn btn-sm btn-ghost" data-gact="member" type="button">member</button>
            <button class="btn btn-sm btn-ghost" data-gact="settings" type="button">setting</button>
          </div>
        </div>`
        )
        .join('')}</div>`;

      list.querySelectorAll('[data-gact]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const gid = btn.closest('.session-card').dataset.gid;
          handleAdminGroupAct(btn.dataset.gact, gid);
        });
      });
    } catch (e) {
      list.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  function handleAdminGroupAct(act, groupId) {
    const sid = adminSelectedSessionId;
    if (act === 'tag') {
      showModal({
        title: 'tag member grup',
        sub: 'kirim mention ke semua member',
        body: `
          <div class="field"><label>pesan (opsional)</label><textarea id="tagMessage"></textarea></div>
          <div class="switch-row"><span>sembunyikan daftar nomor (hidetag)</span><div class="switch" id="tagHide" data-bool></div></div>
        `,
        actions: [
          { label: 'batal', ghost: true },
          {
            label: 'kirim',
            onClick: async () => {
              try {
                await API.adminGroupTag(sid, groupId, {
                  message: $('#tagMessage').value.trim(),
                  hide: $('#tagHide').classList.contains('on'),
                });
                toast('tag terkirim');
              } catch (e) {
                toast(e.message || 'gagal');
              }
            },
          },
        ],
      });
      $('#tagHide')?.addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
      return;
    }
    if (act === 'member') {
      showModal({
        title: 'kelola member',
        sub: 'kick / promote / demote berdasarkan nomor',
        body: `
          <div class="field"><label>nomor</label><input id="memberNumber" placeholder="628xxxxxxxxxx"></div>
          <div class="field">
            <label>aksi</label>
            <select id="memberAction">
              <option value="kick">kick</option>
              <option value="promote">jadikan admin</option>
              <option value="demote">turunkan dari admin</option>
            </select>
          </div>
        `,
        actions: [
          { label: 'batal', ghost: true },
          {
            label: 'jalankan',
            onClick: async () => {
              try {
                await API.adminGroupMembers(sid, groupId, {
                  action: $('#memberAction').value,
                  number: $('#memberNumber').value.trim(),
                });
                toast('berhasil');
              } catch (e) {
                toast(e.message || 'gagal');
              }
            },
          },
        ],
      });
      return;
    }
    if (act === 'settings') {
      showModal({
        title: 'setting grup',
        sub: 'buka/tutup grup, ganti nama/deskripsi',
        body: `
          <div class="toolbar" style="margin-bottom:0.75rem">
            <button class="btn btn-sm btn-ghost" data-gs="open" type="button">buka grup</button>
            <button class="btn btn-sm btn-ghost" data-gs="close" type="button">tutup grup</button>
          </div>
          <div class="field"><label>nama baru</label><input id="groupName"></div>
          <div class="field"><label>deskripsi baru</label><textarea id="groupDesc"></textarea></div>
        `,
        actions: [
          { label: 'tutup', ghost: true },
          {
            label: 'simpan nama & deskripsi',
            keep: true,
            onClick: async () => {
              try {
                const name = $('#groupName').value.trim();
                const desc = $('#groupDesc').value.trim();
                if (name) await API.adminGroupSettings(sid, groupId, { action: 'name', value: name });
                if (desc) await API.adminGroupSettings(sid, groupId, { action: 'desc', value: desc });
                toast('disimpan');
              } catch (e) {
                toast(e.message || 'gagal');
              }
            },
          },
        ],
      });
      $$('#modalBody [data-gs]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            await API.adminGroupSettings(sid, groupId, { action: btn.dataset.gs });
            toast(btn.dataset.gs === 'open' ? 'grup dibuka' : 'grup ditutup');
          } catch (e) {
            toast(e.message || 'gagal');
          }
        })
      );
    }
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
})();
