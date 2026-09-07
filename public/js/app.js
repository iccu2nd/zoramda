(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

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
  }

  $('#overlay').addEventListener('click', (e) => {
    if (e.target === $('#overlay')) hideModal();
  });

  /* ——— auth ——— */
  async function tryAuth() {
    if (!API.getKey()) return false;
    try {
      currentUser = await API.me();
      return true;
    } catch {
      API.clearKey();
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

  $('#loginBtn').addEventListener('click', async () => {
    const key = $('#apiKeyInput').value.trim();
    if (!key) return toast('isi api key dulu');
    API.setKey(key);
    $('#loginBtn').disabled = true;
    try {
      currentUser = await API.me();
      toast('berhasil masuk');
      showApp();
    } catch (e) {
      API.clearKey();
      toast(e.message || 'api key tidak valid');
    } finally {
      $('#loginBtn').disabled = false;
    }
  });

  $('#apiKeyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginBtn').click();
  });

  $('#logoutBtn').addEventListener('click', () => {
    API.clearKey();
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
      $('#page-sessions').classList.toggle('hidden', page !== 'sessions');
      $('#page-config').classList.toggle('hidden', page !== 'config');
      if (page === 'config') loadConfig();
      if (page === 'sessions') loadSessions();
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
                toast('menghubungkan...');
                setTimeout(loadSessions, 800);
                // show pairing if any
                setTimeout(async () => {
                  try {
                    const p = await API.pairing(id);
                    if (p.pairingCode) {
                      showModal({
                        title: 'pairing code',
                        sub: 'masukkan di whatsapp → perangkat tertaut → tautkan dengan nomor telepon',
                        body: `<div class="pairing-code">${escapeHtml(p.pairingCode)}</div>`,
                        actions: [{ label: 'tutup', ghost: true }],
                      });
                    }
                  } catch {}
                }, 1500);
              },
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
            await API.createSession({ name, pairingPhone: pairingPhone || undefined });
            toast('session dibuat');
            loadSessions();
          },
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

  /* ——— config ——— */
  let configCache = {};

  async function loadConfig() {
    const box = $('#configForm');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const { config } = await API.config();
      configCache = { ...config };
      const isAdmin = currentUser?.isAdmin;

      box.innerHTML = `
        <div class="field"><label>nama bot</label><input data-k="botName" value="${escapeAttr(config.botName || '')}" ${isAdmin ? '' : 'disabled'}></div>
        <div class="field-row">
          <div class="field"><label>prefix</label><input data-k="prefix" value="${escapeAttr(config.prefix || '.')}" ${isAdmin ? '' : 'disabled'}></div>
          <div class="field"><label>nama owner</label><input data-k="ownerName" value="${escapeAttr(config.ownerName || '')}" ${isAdmin ? '' : 'disabled'}></div>
        </div>
        <div class="field"><label>nomor owner (pisah koma)</label><input data-k="ownerNumbers" value="${escapeAttr((config.ownerNumbers || []).join(','))}" ${isAdmin ? '' : 'disabled'}></div>
        <div class="field"><label>judul menu</label><input data-k="menuTitle" value="${escapeAttr(config.menuTitle || '')}" ${isAdmin ? '' : 'disabled'}></div>
        <div class="field"><label>pesan maintenance</label><textarea data-k="maintenanceMessage" ${isAdmin ? '' : 'disabled'}>${escapeHtml(config.maintenanceMessage || '')}</textarea></div>
        <div class="switch-row">
          <span>mode publik</span>
          <div class="switch ${config.publicMode ? 'on' : ''}" data-k="publicMode" data-bool ${isAdmin ? '' : 'style="pointer-events:none;opacity:.5"'}></div>
        </div>
        <div class="switch-row">
          <span>maintenance</span>
          <div class="switch ${config.maintenanceMode ? 'on' : ''}" data-k="maintenanceMode" data-bool ${isAdmin ? '' : 'style="pointer-events:none;opacity:.5"'}></div>
        </div>
        <div class="switch-row">
          <span>anti spam</span>
          <div class="switch ${config.antiSpam ? 'on' : ''}" data-k="antiSpam" data-bool ${isAdmin ? '' : 'style="pointer-events:none;opacity:.5"'}></div>
        </div>
        ${isAdmin ? '' : '<p style="margin-top:1rem;color:var(--muted);font-size:0.85rem;font-weight:500">hanya admin yang bisa mengubah config.</p>'}
      `;

      box.querySelectorAll('.switch[data-bool]').forEach((sw) => {
        sw.addEventListener('click', () => sw.classList.toggle('on'));
      });
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  $('#saveConfigBtn').addEventListener('click', async () => {
    if (!currentUser?.isAdmin) {
      toast('hanya admin');
      return;
    }
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
