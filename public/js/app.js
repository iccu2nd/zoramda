(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PAGES = ['sessions', 'config', 'plugins', 'account'];

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
    const navConfig = document.getElementById('navConfig');
    const navPlugins = document.getElementById('navPlugins');
    if (navConfig) navConfig.style.display = hasSession ? '' : 'none';
    if (navPlugins) navPlugins.style.display = hasSession ? '' : 'none';

    // If user is on config/plugins but no sessions left, bounce to sessions
    if (!hasSession) {
      const onConfig = !$('#page-config').classList.contains('hidden');
      const onPlugins = !$('#page-plugins').classList.contains('hidden');
      if (onConfig || onPlugins) {
        $$('.side-link[data-page]').forEach((b) => b.classList.remove('active'));
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
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat session...</p>';
    try {
      const selHtml = `<div class="field session-pick"><label>Session</label><select id="configSessionSelect"></select></div>`;
      box.innerHTML = selHtml + '<div id="configFields"></div>';
      const select = $('#configSessionSelect');
      const sessions = await fillSessionSelect(select, selectedConfigSession);
      if (!sessions.length) {
        $('#configFields').innerHTML = '<div class="empty">buat session dulu di halaman Sessions.</div>';
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
      box.innerHTML = `
        <p class="sub" style="margin-bottom:0.75rem">Settings berlaku langsung untuk session ini saja. Session lain tidak terpengaruh.</p>
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
      `;
      box.querySelectorAll('.switch[data-bool]').forEach((sw) => {
        sw.addEventListener('click', () => sw.classList.toggle('on'));
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  $('#saveConfigBtn').addEventListener('click', async () => {
    if (!selectedConfigSession) {
      toast('pilih session dulu');
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
      toast('settings session disimpan');
      renderConfigFields(selectedConfigSession);
    } catch (e) {
      toast(e.message || 'gagal simpan');
    }
  });

  /* ——— plugins (toggle + permission per-session) ——— */
  async function loadPlugins() {
    const box = $('#pluginList');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat session...</p>';
    try {
      box.innerHTML = `<div class="field session-pick"><label>Session</label><select id="pluginSessionSelect"></select></div><div id="pluginCards"></div>`;
      const select = $('#pluginSessionSelect');
      const sessions = await fillSessionSelect(select, selectedPluginSession);
      if (!sessions.length) {
        $('#pluginCards').innerHTML = '<div class="empty">buat session dulu di halaman Sessions.</div>';
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
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat plugins...</p>';
    try {
      const { plugins, permissions } = await API.sessionPlugins(sessionId);
      if (!plugins?.length) {
        box.innerHTML = `<div class="empty">tidak ada plugin ter-load.</div>`;
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
      };

      // Group by top-level folder (admin, main, owner, …)
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

      let html = '';
      for (const folder of sortedFolders) {
        const list = groups[folder].slice().sort((a, b) => String(a.file).localeCompare(String(b.file)));
        html += `<div class="plugin-folder">
          <div class="plugin-folder-head">
            <span class="plugin-folder-name">${escapeHtml(folder)}</span>
            <span class="plugin-folder-count">${list.length} plugin</span>
          </div>`;

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
              return `<div class="switch-row perm-toggle-row">
                <span>${escapeHtml(permLabels[perm] || perm)}</span>
                <div class="switch ${on ? 'on' : ''}" data-perm="${escapeAttr(perm)}" role="switch" aria-checked="${on ? 'true' : 'false'}"></div>
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

          html += `<div class="card plugin-card" data-file="${escapeAttr(p.file)}" data-command="${escapeAttr(primary)}" data-defaults='${defaultPermsAttr}'>
            <div class="plugin-head">
              <div class="plugin-head-text">
                <div class="plugin-name">${escapeHtml(baseName)}</div>
                <div class="plugin-tags">${escapeHtml(cmds)}</div>
              </div>
              <div class="switch ${p.enabled ? 'on' : ''}" data-act="toggle" title="ON/OFF"></div>
            </div>
            <div class="perm-box">
              <div class="perm-box-title">Permissions</div>
              ${permToggles}
            </div>
            ${responsesHtml}
            <div class="toolbar plugin-actions">
              <button class="btn btn-sm" data-act="saveState" type="button">simpan</button>
              <button class="btn btn-sm btn-ghost" data-act="resetDefault" type="button">reset default</button>
            </div>
          </div>`;
        }
        html += `</div>`;
      }

      box.innerHTML = html;

      box.querySelectorAll('.plugin-card').forEach((card) => {
        const file = card.dataset.file;
        const command = card.dataset.command;
        let defaults = ['everyone'];
        try {
          defaults = JSON.parse(card.dataset.defaults || '["everyone"]');
        } catch (_) {}

        card.querySelectorAll('.switch').forEach((sw) => {
          sw.addEventListener('click', () => sw.classList.toggle('on'));
        });

        card.querySelector('[data-act="saveState"]')?.addEventListener('click', async () => {
          const enabled = card.querySelector('[data-act="toggle"]').classList.contains('on');
          const permissions = [...card.querySelectorAll('.switch[data-perm].on')].map(
            (el) => el.dataset.perm
          );
          if (!permissions.length) permissions.push('everyone');
          try {
            await API.updateSessionPlugins(sessionId, {
              [file]: { enabled, permissions },
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
            toast('disimpan · ' + file);
          } catch (e) {
            toast(e.message || 'gagal simpan');
          }
        });

        card.querySelector('[data-act="resetDefault"]')?.addEventListener('click', async () => {
          try {
            // Restore plugin defaults: enabled + default permissions
            await API.updateSessionPlugins(sessionId, {
              [file]: { enabled: true, permissions: defaults },
            });
            // Reset response text overrides if any
            if (command && card.querySelectorAll('[data-resp-key]').length) {
              const body = {};
              card.querySelectorAll('[data-resp-key]').forEach((el) => {
                body[el.dataset.respKey] = '';
              });
              await API.updatePluginResponses(sessionId, command, body);
            }
            toast('reset default · ' + file);
            renderPluginCards(sessionId);
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
