(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PAGES = ['sessions', 'config', 'plugins', 'admin', 'account', 'pricing', 'payment'];
  const WA_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbC7SGt65yDCUxYwUS3U';
  const UPGRADE_DISMISS_KEY = 'zb_upgrade_dismiss_at';

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
    } catch (e) {
      API.clearToken();
      if (API.clearAdminKey) API.clearAdminKey();
      currentUser = null;
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


  let selectedUpgradePlan = 'pro';

  function shouldShowUpgradeModal() {
    if (!currentUser) return false;
    if (currentUser.isAdmin || currentUser.role === 'admin') return false;
    const plan = (currentUser.plan || 'free').toLowerCase();
    if (plan !== 'free' && userHasBotSettings()) return false;
    try {
      const ts = Number(sessionStorage.getItem(UPGRADE_DISMISS_KEY) || 0);
      // once per browser tab session after dismiss
      if (ts) return false;
    } catch {}
    return true;
  }

  function openUpgradeModal() {
    const ov = $('#upgradeOverlay');
    if (!ov) return;
    selectedUpgradePlan = 'pro';
    ov.classList.remove('hidden');
    ov.querySelectorAll('.upgrade-plan').forEach((b) => {
      b.classList.toggle('selected', b.dataset.plan === selectedUpgradePlan);
    });
  }

  function closeUpgradeModal(dismiss) {
    $('#upgradeOverlay')?.classList.add('hidden');
    if (dismiss) {
      try {
        sessionStorage.setItem(UPGRADE_DISMISS_KEY, String(Date.now()));
      } catch {}
    }
  }

  function bindUpgradeModal() {
    const ov = $('#upgradeOverlay');
    if (!ov || ov.dataset.bound) return;
    ov.dataset.bound = '1';
    $('#upgradeClose')?.addEventListener('click', () => closeUpgradeModal(true));
    $('#upgradeLater')?.addEventListener('click', () => closeUpgradeModal(true));
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeUpgradeModal(true);
    });
    ov.querySelectorAll('.upgrade-plan').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedUpgradePlan = btn.dataset.plan || 'pro';
        ov.querySelectorAll('.upgrade-plan').forEach((b) =>
          b.classList.toggle('selected', b === btn)
        );
      });
    });
    $('#upgradeCta')?.addEventListener('click', async () => {
      const plan = selectedUpgradePlan || 'pro';
      const cta = $('#upgradeCta');
      if (cta) {
        cta.disabled = true;
        cta.textContent = 'Menyiapkan…';
      }
      try {
        const { payment } = await API.paymentCheckout(plan);
        activeCheckoutTrxId = payment.trxId;
        try {
          sessionStorage.setItem('zb_active_trx', payment.trxId);
        } catch {}
        closeUpgradeModal(true);
        activatePage('payment');
        toast('QRIS siap', 'success');
      } catch (e) {
        toast(e.message || 'Checkout gagal', 'error');
        activatePage('pricing');
        closeUpgradeModal(true);
      } finally {
        if (cta) {
          cta.disabled = false;
          cta.innerHTML = '⚡ Upgrade Sekarang';
        }
      }
    });
  }

  async function maybeShowUpgradePrompt() {
    bindUpgradeModal();
    try {
      await syncPlanFromServer();
    } catch {}
    if (shouldShowUpgradeModal()) {
      setTimeout(() => openUpgradeModal(), 450);
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
    maybeShowUpgradePrompt();
    updateVerifyBanner();
  }

  function updateVerifyBanner() {
    const banner = $('#verifyBanner');
    if (!banner) return;
    const show = !!currentUser && currentUser.emailVerified === false;
    banner.classList.toggle('hidden', !show);
  }

  let verifyResendCooldownUntil = 0;
  $('#verifyBannerBtn')?.addEventListener('click', async () => {
    const btn = $('#verifyBannerBtn');
    const msg = $('#verifyBannerMsg');
    if (Date.now() < verifyResendCooldownUntil) return;
    btn.disabled = true;
    msg.textContent = '';
    try {
      const res = await API.resendVerification({ email: currentUser?.email });
      msg.textContent = res.message || 'Email verifikasi terkirim, cek inbox kamu.';
      verifyResendCooldownUntil = Date.now() + 60000;
      setTimeout(() => { btn.disabled = false; }, 60000);
    } catch (e) {
      msg.textContent = e.message || 'Gagal mengirim ulang.';
      btn.disabled = false;
    }
  });

  function showAuthForm(which) {
    const login = which === 'login';
    const register = which === 'register';
    const emailSent = which === 'emailSent';
    $('#loginForm')?.classList.toggle('hidden', !login);
    $('#registerForm')?.classList.toggle('hidden', !register);
    $('#emailSentPanel')?.classList.toggle('hidden', !emailSent);
    $('#loginError') && ($('#loginError').textContent = '');
    $('#registerError') && ($('#registerError').textContent = '');
    const msg = $('#emailSentMsg');
    if (msg) msg.textContent = '';
  }

  function showEmailSentPanel({ email, emailSent }) {
    showAuthForm('emailSent');
    const title = $('#emailSentTitle');
    const desc = $('#emailSentDesc');
    const addr = $('#emailSentAddress');
    if (title) title.textContent = emailSent !== false ? 'Email verifikasi terkirim' : 'Akun berhasil dibuat';
    if (desc) {
      desc.textContent =
        emailSent !== false
          ? 'Kami sudah mengirim tautan verifikasi ke email di bawah. Buka inbox Gmail, klik tautan, lalu masuk di sini.'
          : 'Akun sudah dibuat, tapi pengiriman email gagal. Coba kirim ulang di bawah, atau cek folder spam.';
    }
    if (addr) addr.textContent = email || '';
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
  $('#emailSentLoginBtn')?.addEventListener('click', () => showAuthForm('login'));
  $('#emailSentResendBtn')?.addEventListener('click', async () => {
    const email = ($('#emailSentAddress')?.textContent || '').trim();
    const msg = $('#emailSentMsg');
    if (!email) {
      if (msg) msg.textContent = 'Email tidak ditemukan.';
      return;
    }
    const btn = $('#emailSentResendBtn');
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Mengirim…';
    try {
      const res = await API.resendVerification({ email });
      if (msg) msg.textContent = res.message || 'Tautan verifikasi baru dikirim. Cek inbox Gmail.';
      toast('Email verifikasi dikirim ulang', 'success');
    } catch (e) {
      if (msg) msg.textContent = e.message || 'Gagal mengirim ulang.';
      toast(e.message || 'Gagal kirim ulang', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

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
      if (e2.status === 403 && (e2.data?.code === 'EMAIL_NOT_VERIFIED' || e2.data?.requiresVerification)) {
        const email = e2.data?.email || '';
        errEl.innerHTML =
          (e2.message || 'Email belum diverifikasi.') +
          (email
            ? ` <button type="button" class="btn btn-sm btn-ghost" id="loginResendBtn" style="margin-left:0.35rem;display:inline-flex;vertical-align:middle">Kirim ulang verifikasi</button>`
            : '');
        $('#loginResendBtn')?.addEventListener('click', async () => {
          const btn = $('#loginResendBtn');
          if (btn) btn.disabled = true;
          try {
            const res = await API.resendVerification({ email });
            toast(res.message || 'Tautan verifikasi dikirim. Cek inbox Gmail.', 'success');
          } catch (err) {
            toast(err.message || 'Gagal kirim ulang.', 'error');
          } finally {
            if (btn) btn.disabled = false;
          }
        });
      } else {
        errEl.textContent = e2.message || 'Gagal masuk.';
      }
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
      const res = await API.register({
        username,
        email,
        password,
        confirmPassword,
      });
      // Tidak set token — user harus verifikasi email dulu.
      API.clearToken();
      currentUser = null;
      if ($('#loginUsername')) $('#loginUsername').value = username;
      showEmailSentPanel({ email: res.email || email, emailSent: res.emailSent });
      toast(
        res.emailSent !== false
          ? 'Email verifikasi terkirim. Cek inbox Gmail.'
          : 'Akun dibuat. Kirim ulang email verifikasi.',
        res.emailSent !== false ? 'success' : 'warning'
      );
    } catch (e2) {
      errEl.style.color = '';
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
    const link = document.querySelector('.side-link[data-page="' + page + '"]');
    if (link) link.classList.add('active');
    if (page === 'config' || page === 'plugins') {
      $('#navBotSettings')?.classList.add('active');
    }
    PAGES.forEach((p) => {
      const el = $('#page-' + p);
      if (el) el.classList.toggle('hidden', p !== page);
    });
    if (page === 'config') loadConfig();
    if (page === 'sessions') loadSessions();
    if (page === 'plugins') loadPlugins();
    if (page === 'account') loadAccount();
    if (page === 'config' || page === 'plugins') applyBotSettingsGate();
    if (page === 'pricing') loadPricing();
    if (page === 'payment') loadPaymentPage();
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
    if (navBotSettingsGroup) navBotSettingsGroup.style.display = hasSession ? '' : 'none';

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

  /** Only show the session dropdown when there's more than one session to pick from */
  function toggleSessionPick(selectEl, sessions) {
    const pick = selectEl?.closest('.session-pick');
    if (pick) pick.style.display = (sessions || []).length > 1 ? '' : 'none';
  }

  async function loadConfig() {
    if (!userHasBotSettings()) { applyBotSettingsGate(); return; }

    const box = $('#configForm');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">Loading…</p>';
    try {
      const selHtml = `<div class="field session-pick"><label>Session</label><select id="configSessionSelect"></select></div>`;
      box.innerHTML = selHtml + '<div id="configFields"></div>';
      const select = $('#configSessionSelect');
      const sessions = await fillSessionSelect(select, selectedConfigSession);
      toggleSessionPick(select, sessions);
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
            <div class="field">
              <label>limit default user baru</label>
              <input type="number" min="0" data-k="defaultLimit" value="${escapeAttr(config.defaultLimit ?? 10)}">
            </div>
            <div class="switch-row">
              <span>premium unlimited</span>
              <div class="switch ${config.premiumUnlimited !== false ? 'on' : ''}" data-k="premiumUnlimited" data-bool></div>
            </div>
            <div class="field" id="premiumLimitField" style="${config.premiumUnlimited !== false ? 'display:none' : ''}">
              <label>limit default premium (jika tidak unlimited)</label>
              <input type="number" min="0" data-k="premiumDefaultLimit" value="${escapeAttr(config.premiumDefaultLimit ?? 100)}">
            </div>
            <p class="hint" style="margin:0.4rem 0 0;font-size:0.78rem;color:var(--muted)">Biaya limit per fitur diatur di menu Plugins (toggle Use Limit + angka).</p>
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
    if (!userHasBotSettings()) {
      toast('Upgrade ke Pro untuk menyimpan config', 'warning');
      activatePage('pricing');
      return;
    }
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
    if (!userHasBotSettings()) { applyBotSettingsGate(); return; }

    const box = $('#pluginList');
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">Loading…</p>';
    try {
      box.innerHTML = `<div class="field session-pick"><label>Session</label><select id="pluginSessionSelect"></select></div><div id="pluginCards"></div>`;
      const select = $('#pluginSessionSelect');
      const sessions = await fillSessionSelect(select, selectedPluginSession);
      toggleSessionPick(select, sessions);
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

          const useLimitOn = !!p.useLimit;
          const limitCostVal = p.limitCost ?? 1;
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
            <div class="switch-row" style="margin:0.35rem 0">
              <span>Use Limit</span>
              <div class="switch ${useLimitOn ? 'on' : ''}" data-act="useLimit" role="switch"></div>
            </div>
            <div class="field plugin-limit-cost" style="margin:0.25rem 0 ${useLimitOn ? '0.35rem' : '0'};${useLimitOn ? '' : 'display:none'}">
              <label>Limit cost (angka yang dipotong)</label>
              <input type="number" min="0" data-act="limitCost" value="${escapeAttr(limitCostVal)}" />
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
            if (sw.dataset.act === 'useLimit') {
              const costBox = card.querySelector('.plugin-limit-cost');
              if (costBox) costBox.style.display = sw.classList.contains('on') ? '' : 'none';
            }
          });
        });

        card.querySelector('[data-act="saveState"]')?.addEventListener('click', async () => {
          const enabled = card.querySelector('[data-act="toggle"]').classList.contains('on');
          const useLimit = !!card.querySelector('[data-act="useLimit"]')?.classList.contains('on');
          const limitCostRaw = card.querySelector('[data-act="limitCost"]')?.value;
          const limitCost = useLimit ? Math.max(0, parseInt(limitCostRaw, 10) || 1) : 0;
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
              [file]: { enabled, permissions, commands, useLimit, limitCost },
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
              [file]: { enabled: true, permissions: defaults, commands: [], useLimit: false, limitCost: 0 },
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



  /* ——— plan access, pricing, payment ——— */
  let activeCheckoutTrxId = null;
  let payCountdownTimer = null;

  function userHasBotSettings() {
    if (!currentUser) return false;
    if (currentUser.isAdmin || currentUser.role === 'admin') return true;
    const f = currentUser.features;
    if (f && typeof f.botSettings === 'boolean') return f.botSettings;
    const plan = (currentUser.plan || 'free').toLowerCase();
    return plan === 'pro' || plan === 'business';
  }

  function formatRp(n) {
    return 'Rp' + Number(n || 0).toLocaleString('id-ID');
  }

  function formatWib(iso) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }) + ' WIB';
    } catch {
      return String(iso);
    }
  }

  function statusLabel(s) {
    const map = {
      pending: 'Pending',
      paid: 'Success',
      expired: 'Expired',
      failed: 'Failed',
      unknown: 'Unknown',
    };
    return map[s] || s || '-';
  }

  function payStatusIcon(s) {
    if (s === 'paid') {
      return `<span class="pay-badge ok" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </span>`;
    }
    if (s === 'pending') {
      return `<span class="pay-badge wait pay-badge-pulse" aria-hidden="true">
        <svg class="pay-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path class="pay-clock-hand" d="M12 7v5l3 2"/></svg>
      </span>`;
    }
    return `<span class="pay-badge bad" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
    </span>`;
  }

  function showPayCheckOverlay(state, message) {
    const ov = $('#payCheckOverlay');
    const card = $('#payCheckCard');
    if (!ov || !card) return;
    let body = '';
    if (state === 'loading') {
      body = `
        <div class="pay-check-icon loading">
          <span class="pay-check-spinner"></span>
        </div>
        <p class="pay-check-msg">Memeriksa status pembayaran…</p>`;
    } else if (state === 'paid') {
      body = `
        <div class="pay-check-icon success">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M14.5 27.5l7.5 7.5 15-16"/></svg>
        </div>
        <p class="pay-check-msg">${escapeHtml(message || 'Pembayaran berhasil')}</p>`;
    } else if (state === 'pending') {
      body = `
        <div class="pay-check-icon pending">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M18 18l16 16M34 18L18 34"/></svg>
        </div>
        <p class="pay-check-msg">${escapeHtml(message || 'Pembayaran belum masuk')}</p>`;
    } else {
      body = `
        <div class="pay-check-icon error">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M18 18l16 16M34 18L18 34"/></svg>
        </div>
        <p class="pay-check-msg">${escapeHtml(message || 'Status gagal / expired')}</p>`;
    }
    card.innerHTML = body;
    ov.classList.remove('hidden');
    if (state !== 'loading') {
      const auto = setTimeout(() => hidePayCheckOverlay(), state === 'paid' ? 2200 : 1800);
      ov.onclick = () => {
        clearTimeout(auto);
        hidePayCheckOverlay();
      };
    } else {
      ov.onclick = null;
    }
  }

  function hidePayCheckOverlay() {
    const ov = $('#payCheckOverlay');
    if (!ov) return;
    ov.classList.add('hidden');
    ov.onclick = null;
  }

  function renderFeatureLock(el) {
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="lock-card">
        <div class="lock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </div>
        <h3>Bot Settings terkunci</h3>
        <p>Upgrade ke Pro untuk mengakses pengaturan bot.</p>
        <button type="button" class="btn lock-upgrade-btn">Upgrade ke Pro</button>
      </div>`;
    el.querySelector('.lock-upgrade-btn')?.addEventListener('click', () => openUpgradeModal());
  }

  function renderLockedConfigPreview() {
    const box = $('#configForm');
    if (!box) return;
    box.innerHTML = `
      <div class="field"><label>nama bot</label><input value="Botenv" disabled tabindex="-1"></div>
      <div class="field-row">
        <div class="field"><label>prefix</label><input value="." disabled tabindex="-1"></div>
        <div class="field"><label>owner name</label><input value="Owner" disabled tabindex="-1"></div>
      </div>
      <div class="field"><label>nomor owner</label><input value="628xxxxxxxxxx" disabled tabindex="-1"></div>
      <div class="switch-row"><span>mode publik</span><div class="switch on"></div></div>
      <div class="switch-row"><span>anti spam</span><div class="switch on"></div></div>
      <div class="field"><label>pesan maintenance</label><textarea disabled tabindex="-1">Bot sedang maintenance.</textarea></div>
      <div class="field"><label>pesan limit habis</label><textarea disabled tabindex="-1">Limit kamu sudah habis.</textarea></div>
    `;
  }

  function renderLockedPluginsPreview() {
    const box = $('#pluginList');
    if (!box) return;
    box.innerHTML = `
      <div class="plugin-card" style="pointer-events:none">
        <div class="plugin-head"><strong>main/help.js</strong><span class="hint">help, menu</span></div>
        <div class="switch-row"><span>enabled</span><div class="switch on"></div></div>
        <div class="field"><label>custom commands</label><input value="help, menu" disabled></div>
      </div>
      <div class="plugin-card" style="pointer-events:none">
        <div class="plugin-head"><strong>main/ping.js</strong><span class="hint">ping</span></div>
        <div class="switch-row"><span>enabled</span><div class="switch on"></div></div>
      </div>
      <div class="plugin-card" style="pointer-events:none">
        <div class="plugin-head"><strong>admin/group.js</strong><span class="hint">kick, promote…</span></div>
        <div class="switch-row"><span>enabled</span><div class="switch"></div></div>
      </div>
    `;
  }

  function applyBotSettingsGate() {
    const locked = !userHasBotSettings();
    const configGate = $('#configGate');
    const pluginsGate = $('#pluginsGate');
    const configLocked = $('#configLocked');
    const pluginsLocked = $('#pluginsLocked');
    const saveBtn = $('#saveConfigBtn');

    if (locked) {
      configGate?.classList.add('is-locked');
      pluginsGate?.classList.add('is-locked');
      renderFeatureLock(configLocked);
      renderFeatureLock(pluginsLocked);
      renderLockedConfigPreview();
      renderLockedPluginsPreview();
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.setAttribute('aria-disabled', 'true');
      }
    } else {
      configGate?.classList.remove('is-locked');
      pluginsGate?.classList.remove('is-locked');
      configLocked?.classList.add('hidden');
      pluginsLocked?.classList.add('hidden');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.removeAttribute('aria-disabled');
      }
    }
  }

  async function syncPlanFromServer() {
    try {
      const me = await API.paymentMe();
      if (!currentUser) currentUser = {};
      currentUser.plan = me.plan;
      currentUser.planExpiresAt = me.planExpiresAt;
      currentUser.maxSessions = me.maxSessions;
      currentUser.features = me.features || {};
      currentUser._planMeta = me;
      applyBotSettingsGate();
      return me;
    } catch {
      applyBotSettingsGate();
      return null;
    }
  }

  async function refreshDashOverview() {
    /* overview cards removed */
  }

  async function loadPricing() {
    const root = $('#pricingRoot');
    if (!root) return;
    root.innerHTML = '<p class="hint">Memuat paket…</p>';
    try {
      const [plansRes, me] = await Promise.all([API.paymentPlans(), syncPlanFromServer()]);
      const plans = plansRes.plans || [];
      const cur = (me?.plan || 'free').toLowerCase();

      let html = `<div class="pay-current">
        <strong>Paket aktif:</strong> ${escapeHtml((me?.plan || 'free').toUpperCase())}
        <span class="hint"> · maks ${me?.maxSessions ?? 1} session${
          me?.planExpiresAt ? ' · berlaku s/d ' + formatWib(me.planExpiresAt) : ''
        }</span>
      </div>
      <div class="pricing-grid dash-pricing">`;

      for (const p of plans) {
        const isCurrent = cur === p.id;
        const canBuy = p.amount > 0;
        html += `<div class="price-card ${isCurrent ? 'featured' : ''}">
          ${isCurrent ? '<div class="price-badge">aktif</div>' : ''}
          <div class="price-tier">${escapeHtml(p.name)}</div>
          <div class="price-amount">${p.amount > 0 ? formatRp(p.amount) : 'Rp0'}<span>${
            p.amount > 0 ? '/bulan' : ''
          }</span></div>
          <ul class="price-features">
            ${(p.featureList || p.features || [])
              .map((f) => (typeof f === 'string' ? `<li>${escapeHtml(f)}</li>` : ''))
              .join('')}
          </ul>
          ${
            canBuy
              ? `<button type="button" class="btn" style="width:100%;justify-content:center" data-buy="${escapeAttr(
                  p.id
                )}">${isCurrent ? 'Perpanjang' : 'Pilih paket'}</button>`
              : `<button type="button" class="btn btn-ghost" style="width:100%;justify-content:center" disabled>Gratis</button>`
          }
        </div>`;
      }
      html += '</div>';
      root.innerHTML = html;
      root.querySelectorAll('[data-buy]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Menyiapkan…';
          try {
            const { payment } = await API.paymentCheckout(btn.dataset.buy);
            activeCheckoutTrxId = payment.trxId;
            try {
              sessionStorage.setItem('zb_active_trx', payment.trxId);
            } catch {}
            activatePage('payment');
            toast('QRIS siap', 'success');
          } catch (e) {
            toast(e.message || 'Checkout gagal', 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Pilih paket';
          }
        });
      });
    } catch (e) {
      root.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  function stopPayCountdown() {
    if (payCountdownTimer) {
      clearInterval(payCountdownTimer);
      payCountdownTimer = null;
    }
  }

  function startPayCountdown(expiredAt, el) {
    stopPayCountdown();
    if (!el || !expiredAt) return;
    const end = new Date(expiredAt).getTime();
    function tick() {
      const left = end - Date.now();
      if (left <= 0) {
        el.textContent = 'Berakhir dalam 00:00';
        stopPayCountdown();
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      el.textContent =
        'Berakhir dalam ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    tick();
    payCountdownTimer = setInterval(tick, 1000);
  }

  async function loadPaymentPage() {
    const root = $('#paymentRoot');
    if (!root) return;
    let trxId = activeCheckoutTrxId;
    try {
      if (!trxId) trxId = sessionStorage.getItem('zb_active_trx');
    } catch {}
    if (!trxId) {
      root.innerHTML = `
        <div class="checkout-card">
          <p>Belum ada transaksi aktif.</p>
          <button type="button" class="btn" id="goPricingBtn">Pilih paket</button>
        </div>`;
      $('#goPricingBtn')?.addEventListener('click', () => activatePage('pricing'));
      return;
    }
    root.innerHTML = '<p class="hint">Memuat transaksi…</p>';
    try {
      const { payment } = await API.paymentGet(trxId);
      activeCheckoutTrxId = payment.trxId;
      renderPaymentPage(payment);
    } catch (e) {
      root.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>
        <button type="button" class="btn" id="goPricingBtn2">Pilih paket</button>`;
      $('#goPricingBtn2')?.addEventListener('click', () => activatePage('pricing'));
    }
  }

  async function downloadQrisImage(imgEl, filename) {
    const name = filename || 'qris-botenv.png';
    const saveBlob = (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
    // Prefer canvas from displayed image (no navigate to qrserver)
    try {
      if (imgEl && imgEl.complete && imgEl.naturalWidth) {
        const canvas = document.createElement('canvas');
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(imgEl, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) {
          saveBlob(blob);
          return true;
        }
      }
    } catch (_) {}
    // Fallback: fetch image URL as blob
    try {
      const src = imgEl?.src;
      if (!src) return false;
      const res = await fetch(src, { mode: 'cors' });
      const blob = await res.blob();
      saveBlob(blob);
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderPaymentPage(payment) {
    const root = $('#paymentRoot');
    if (!root || !payment) return;
    const canPay = payment.status === 'pending';
    const qrUrl = payment.qrString
      ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(payment.qrString)}`
      : '';
    const qrBlock = payment.qrString
      ? `<div class="qris-box">
           <img class="qris-img" id="qrisImg" alt="QRIS" width="300" height="300" crossorigin="anonymous" src="${qrUrl}"/>
         </div>
         <div class="qris-actions">
           <button type="button" class="btn btn-sm btn-ghost" id="dlQris">Download QRIS</button>
         </div>`
      : `<p class="hint">QRIS tidak tersedia. Buat pembayaran baru.</p>`;

    root.innerHTML = `
      <div class="checkout-card pay-page-card">
        <div class="pay-status-row">
          ${payStatusIcon(payment.status)}
          <div>
            <div class="pay-status-text">${statusLabel(payment.status)}</div>
            <div class="hint">${escapeHtml((payment.plan || '').toUpperCase())} · ${formatRp(
              payment.totalAmount || payment.amount
            )}</div>
          </div>
        </div>
        <div class="pay-meta">
          <div class="pay-meta-row">
            <span class="pay-meta-label">ID transaksi</span>
            <code class="pay-meta-value allow-select">${escapeHtml(payment.trxId)}</code>
          </div>
          <div class="pay-meta-row">
            <span class="pay-meta-label">Nominal</span>
            <strong class="pay-meta-value">${formatRp(payment.totalAmount || payment.amount)}</strong>
          </div>
          <div class="pay-meta-row">
            <span class="pay-meta-label">Berlaku hingga</span>
            <strong class="pay-meta-value">${formatWib(payment.expiredAt)}</strong>
          </div>
        </div>
        ${canPay ? `<div class="pay-countdown" id="payCountdown">Berakhir dalam --:--</div>` : ''}
        ${canPay ? qrBlock : ''}
        <p class="pay-note">Bayar hanya via QRIS. Setelah transfer, tekan <strong>Cek Status</strong> — status tidak dicek otomatis.</p>
        <div class="toolbar" style="gap:0.5rem;flex-wrap:wrap;margin-top:0.15rem">
          ${
            canPay
              ? `<button type="button" class="btn" id="checkPayBtn">Cek Status</button>`
              : ''
          }
          ${
            payment.status === 'expired' || payment.status === 'failed'
              ? `<button type="button" class="btn" id="newPayBtn">Buat Pembayaran Baru</button>`
              : ''
          }
          <button type="button" class="btn btn-ghost" id="backPricingBtn">Kembali ke Pricing</button>
        </div>
        <p class="hint" id="payMsg" style="margin-top:0.6rem;text-align:center"></p>
      </div>`;

    if (canPay && payment.expiredAt) {
      startPayCountdown(payment.expiredAt, $('#payCountdown'));
    }

    $('#dlQris')?.addEventListener('click', async () => {
      const btn = $('#dlQris');
      const img = $('#qrisImg');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Menyimpan…';
      }
      try {
        // Wait for image if still loading
        if (img && !img.complete) {
          await new Promise((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            setTimeout(resolve, 4000);
          });
        }
        const ok = await downloadQrisImage(img, `qris-${payment.trxId}.png`);
        if (ok) toast('QRIS disimpan ke Downloads / Galeri', 'success');
        else toast('Gagal menyimpan. Tahan gambar QR lalu pilih Simpan.', 'error');
      } catch (e) {
        toast(e.message || 'Gagal download QRIS', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Download QRIS';
        }
      }
    });

    $('#checkPayBtn')?.addEventListener('click', async () => {
      const b = $('#checkPayBtn');
      if (b) {
        b.disabled = true;
        b.textContent = 'Mengecek…';
      }
      showPayCheckOverlay('loading');
      try {
        const res = await API.paymentCheck(payment.trxId);
        const st = res.payment?.status || 'pending';
        if (st === 'paid') {
          showPayCheckOverlay('paid', res.message || 'Pembayaran berhasil');
          await syncPlanFromServer();
          try {
            const u = await API.me();
            if (u?.user) Object.assign(currentUser, u.user);
            else if (u) Object.assign(currentUser, u);
          } catch {}
        } else if (st === 'pending') {
          showPayCheckOverlay('pending', res.message || 'Pembayaran belum masuk');
        } else {
          showPayCheckOverlay('error', res.message || statusLabel(st));
        }
        setTimeout(() => {
          renderPaymentPage(res.payment);
          const msg = $('#payMsg');
          if (msg) msg.textContent = res.message || '';
        }, st === 'paid' ? 900 : 500);
      } catch (e) {
        showPayCheckOverlay('error', e.message || 'Gagal cek status');
        toast(e.message || 'Gagal cek status', 'error');
      } finally {
        const b2 = $('#checkPayBtn');
        if (b2) {
          b2.disabled = false;
          b2.textContent = 'Cek Status';
        }
      }
    });

    $('#newPayBtn')?.addEventListener('click', () => activatePage('pricing'));
    $('#backPricingBtn')?.addEventListener('click', () => activatePage('pricing'));
  }

  /* ——— account ——— */
  let apiKeyVisible = false;

  async function loadAccount() {
    const box = $('#accountBox');
    if (!box) return;
    box.innerHTML = '<p style="color:var(--muted);font-weight:500">memuat...</p>';
    try {
      const raw = await API.me();
      const user = raw?.user || raw;
      if (currentUser) Object.assign(currentUser, user);
      else currentUser = user;
      try {
        const me = await API.paymentMe();
        currentUser.plan = me.plan || currentUser.plan;
        currentUser.planExpiresAt = me.planExpiresAt;
        currentUser.maxSessions = me.maxSessions;
        currentUser.features = me.features || currentUser.features;
      } catch {}
      renderAccount(currentUser);
      updateVerifyBanner();
    } catch (e) {
      box.innerHTML = `<p style="color:var(--red)">${escapeHtml(e.message)}</p>`;
    }
  }

  function renderAccount(user) {
    const box = $('#accountBox');
    if (!box) return;
    const plan = (user.plan || 'free').toUpperCase();
    const exp = user.planExpiresAt
      ? new Date(user.planExpiresAt).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '—';
    const maxS = user.maxSessions ?? 1;
    box.innerHTML = `
      <div class="field"><label>username</label><input value="${escapeAttr(user.username || '')}" disabled></div>
      <div class="field">
        <label>email</label>
        <input value="${escapeAttr(user.email || '-')}" disabled>
        <span class="chip-mini" style="margin-top:0.4rem;display:inline-block;${user.emailVerified ? '' : 'color:var(--orange)'}">${user.emailVerified ? 'terverifikasi' : 'belum diverifikasi'}</span>
        ${user.emailVerified ? '' : '<button class="btn btn-sm btn-ghost" id="accountResendBtn" type="button" style="margin-left:0.5rem">kirim ulang verifikasi</button>'}
      </div>
      <div class="field"><label>nama</label><input value="${escapeAttr(user.name || '-')}" disabled></div>
      <div class="field"><label>role</label><input value="${escapeAttr(user.isAdmin ? 'admin' : 'user')}" disabled></div>
      <div class="field"><label>plan</label><input value="${escapeAttr(plan)}" disabled></div>
      <div class="field"><label>masa berlaku plan</label><input value="${escapeAttr(exp)}" disabled></div>
      <div class="field"><label>maks session</label><input value="${escapeAttr(String(maxS))}" disabled></div>
      <div class="toolbar" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">
        <button class="btn btn-sm" id="accountUpgradeBtn" type="button">Upgrade plan</button>
      </div>
    `;
    $('#accountUpgradeBtn')?.addEventListener('click', () => activatePage('pricing'));
    $('#accountResendBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await API.resendVerification({ email: user.email });
        toast(res.message || 'Email verifikasi terkirim');
      } catch (err) {
        toast(err.message || 'Gagal mengirim ulang', 'error');
      } finally {
        setTimeout(() => { btn.disabled = false; }, 60000);
      }
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
      const [stats, usersData, sessionsData, pluginsData] = await Promise.all([
        API.adminStats(),
        API.adminUsers({ limit: 50 }),
        API.adminSessions(),
        API.adminPlugins().catch(() => ({ plugins: [], folders: [] })),
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
        <div id="adminPanelUsers" class="admin-panel">
          <div class="admin-section" style="margin:0">
            <div class="admin-section-head">
              <h2 class="admin-h2">Users</h2>
              <input type="search" id="adminUserQ" placeholder="Search username / email" class="admin-search" />
            </div>
            <div id="adminUserList"></div>
          </div>
        </div>

        <div id="adminPanelSessions" class="admin-panel">
          <div class="admin-section" style="margin:0">
            <div class="admin-section-head">
              <h2 class="admin-h2">Bot yang konek</h2>
              <button class="btn btn-sm btn-ghost" type="button" id="adminRefreshSessions">Refresh</button>
            </div>
            <div id="adminSessionList"></div>
          </div>
        </div>

        <div id="adminPanelPlugins" class="admin-panel">
          <div class="admin-section" style="margin:0">
            <div class="admin-section-head">
              <h2 class="admin-h2">List plugins</h2>
              <div class="toolbar" style="gap:0.4rem;flex-wrap:wrap">
                <button class="btn btn-sm" type="button" id="adminPluginNew">+ Plugin baru</button>
                <button class="btn btn-sm btn-ghost" type="button" id="adminPluginReload">Reload</button>
              </div>
            </div>
            <p class="hint" style="margin:0 0 0.6rem;font-size:0.8rem;color:var(--muted)">
              Edit source seperti <code>plugins/**/*.js</code>. Simpan = tulis disk + hot-reload.
            </p>
            <div id="adminPluginList" class="admin-plugin-list"></div>
            <div id="adminPluginEditor" class="admin-plugin-editor hidden" style="margin-top:0.85rem">
              <div class="field-row" style="gap:0.5rem;flex-wrap:wrap;align-items:flex-end">
                <div class="field" style="flex:1;min-width:140px">
                  <label>Path file</label>
                  <input type="text" id="adminPluginPath" placeholder="tools/hello.js" />
                </div>
                <div class="field" style="width:120px">
                  <label>Folder</label>
                  <select id="adminPluginFolder"></select>
                </div>
                <div class="field" style="width:120px">
                  <label>Command</label>
                  <input type="text" id="adminPluginCmd" placeholder="hello" />
                </div>
                <button class="btn btn-sm btn-ghost" type="button" id="adminPluginTpl">Isi template</button>
              </div>
              <div class="field" style="margin-top:0.5rem">
                <label>Source script</label>
                <textarea id="adminPluginSource" rows="18" spellcheck="false" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.78rem;line-height:1.45;tab-size:2"></textarea>
              </div>
              <div class="toolbar" style="margin-top:0.55rem;gap:0.4rem;flex-wrap:wrap">
                <button class="btn btn-sm" type="button" id="adminPluginSave">Simpan &amp; reload</button>
                <button class="btn btn-sm btn-ghost" type="button" id="adminPluginClose">Tutup editor</button>
                <button class="btn btn-sm btn-ghost" type="button" id="adminPluginDelete" style="color:var(--red)">Hapus file</button>
                <span id="adminPluginMeta" class="hint" style="margin-left:auto;font-size:0.78rem;color:var(--muted)"></span>
              </div>
            </div>
          </div>
        </div>
      `;

      $('#adminLockBtn')?.addEventListener('click', () => {
        API.clearAdminKey();
        renderAdminGate(box);
      });

      renderAdminUsers(usersData.users || []);
      renderAdminSessions(sessionsData.sessions || []);
      setupAdminPluginEditor(pluginsData);

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

  function setupAdminPluginEditor(initial) {
    const folders = initial?.folders || ['main', 'tools', 'group', 'admin', 'downloader', 'owner', 'sticker', 'other'];
    const folderSel = $('#adminPluginFolder');
    if (folderSel) {
      folderSel.innerHTML = folders.map((f) => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`).join('');
      folderSel.value = 'tools';
    }

    function renderList(plugins) {
      const el = $('#adminPluginList');
      if (!el) return;
      if (!plugins?.length) {
        el.innerHTML = '<div class="empty">Belum ada plugin di disk.</div>';
        return;
      }
      const byFolder = {};
      for (const p of plugins) {
        const f = p.folder || 'other';
        if (!byFolder[f]) byFolder[f] = [];
        byFolder[f].push(p);
      }
      let html = '';
      for (const f of Object.keys(byFolder).sort()) {
        html += `<div class="plugin-folder open" style="margin-bottom:0.5rem">
          <div class="plugin-folder-name" style="font-weight:700;margin-bottom:0.35rem">${escapeHtml(f)} <span class="hint">(${byFolder[f].length})</span></div>`;
        for (const p of byFolder[f]) {
          const cmds = (p.commands || []).map((c) => '.' + c).join('  ') || '—';
          html += `<div class="card admin-plugin-card" data-file="${escapeAttr(p.file)}" style="padding:0.55rem 0.7rem;margin-bottom:0.35rem;cursor:pointer">
            <div class="admin-user-top">
              <div>
                <div class="plugin-name">${escapeHtml(p.file)}${p.loaded ? '' : ' · <span style="color:var(--orange)">not loaded</span>'}${p.heavy ? ' · heavy' : ''}</div>
                <div class="plugin-tags">${escapeHtml(cmds)}</div>
              </div>
              <button class="btn btn-sm btn-ghost" type="button" data-act="edit">Edit</button>
            </div>
          </div>`;
        }
        html += '</div>';
      }
      el.innerHTML = html;
      el.querySelectorAll('.admin-plugin-card').forEach((card) => {
        const open = async () => {
          try {
            const data = await API.adminPluginSource(card.dataset.file);
            openPluginEditor(data);
          } catch (e) {
            toast(e.message || 'Gagal baca source');
          }
        };
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-act="edit"]') || e.currentTarget === card) open();
        });
      });
    }

    function openPluginEditor(data) {
      const ed = $('#adminPluginEditor');
      if (!ed) return;
      ed.classList.remove('hidden');
      $('#adminPluginPath').value = data.file || '';
      $('#adminPluginSource').value = data.source || '';
      const folder = (data.file || '').split('/')[0];
      if (folder && folderSel) folderSel.value = folder;
      const meta = $('#adminPluginMeta');
      if (meta) {
        meta.textContent = data.loaded
          ? `loaded · cmds: ${(data.commands || []).join(', ') || '—'}`
          : 'file ada, belum ter-load';
      }
      ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    renderList(initial?.plugins || []);

    $('#adminPluginNew')?.addEventListener('click', async () => {
      const folder = folderSel?.value || 'tools';
      const cmd = ($('#adminPluginCmd')?.value || 'hello').trim() || 'hello';
      try {
        const tpl = await API.adminPluginTemplate({ folder, name: cmd, command: cmd });
        openPluginEditor({ file: tpl.suggestedFile, source: tpl.source, loaded: false, commands: [cmd] });
      } catch (e) {
        toast(e.message || 'Gagal template');
      }
    });

    $('#adminPluginTpl')?.addEventListener('click', async () => {
      const folder = folderSel?.value || 'tools';
      const cmd = ($('#adminPluginCmd')?.value || 'hello').trim() || 'hello';
      try {
        const tpl = await API.adminPluginTemplate({ folder, name: cmd, command: cmd });
        $('#adminPluginPath').value = tpl.suggestedFile;
        $('#adminPluginSource').value = tpl.source;
        toast('Template diisi');
      } catch (e) {
        toast(e.message || 'Gagal template');
      }
    });

    $('#adminPluginSave')?.addEventListener('click', async () => {
      const file = ($('#adminPluginPath')?.value || '').trim();
      const source = $('#adminPluginSource')?.value ?? '';
      if (!file) return toast('Isi path file (folder/nama.js)');
      try {
        const res = await API.adminSavePluginSource(file, source);
        toast((res.created ? 'Plugin dibuat · ' : 'Plugin diupdate · ') + res.file);
        const list = await API.adminPlugins();
        renderList(list.plugins || []);
        openPluginEditor({
          file: res.file,
          source,
          loaded: true,
          commands: res.commands,
        });
      } catch (e) {
        toast(e.message || 'Save gagal');
      }
    });

    $('#adminPluginDelete')?.addEventListener('click', async () => {
      const file = ($('#adminPluginPath')?.value || '').trim();
      if (!file) return toast('Tidak ada file');
      if (!confirm('Hapus plugin ' + file + ' dari disk?')) return;
      try {
        await API.adminDeletePluginSource(file);
        toast('Dihapus · ' + file);
        $('#adminPluginEditor')?.classList.add('hidden');
        const list = await API.adminPlugins();
        renderList(list.plugins || []);
      } catch (e) {
        toast(e.message || 'Delete gagal');
      }
    });

    $('#adminPluginClose')?.addEventListener('click', () => {
      $('#adminPluginEditor')?.classList.add('hidden');
    });

    $('#adminPluginReload')?.addEventListener('click', async () => {
      try {
        const r = await API.adminReloadPlugins();
        toast(`Reloaded · ${r.count || 0} plugins`);
        const list = await API.adminPlugins();
        renderList(list.plugins || []);
      } catch (e) {
        toast(e.message || 'Reload gagal');
      }
    });
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
        const plan = (u.plan || 'free').toLowerCase();
        return `<div class="card admin-user-card" data-uid="${escapeAttr(u.userId)}">
          <div class="admin-user-top">
            <div>
              <div class="plugin-name">${escapeHtml(u.username)}${u.role === 'admin' ? ' · admin' : ''}</div>
              <div class="plugin-tags">${escapeHtml(u.email || '—')} · ${escapeHtml(u.name || '—')} · ${sess.total || 0} sessions · ${sess.connected || 0} connected</div>
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
            <label>Plan</label>
            <select data-act="plan">
              <option value="free" ${plan === 'free' ? 'selected' : ''}>free</option>
              <option value="pro" ${plan === 'pro' ? 'selected' : ''}>pro</option>
              <option value="business" ${plan === 'business' ? 'selected' : ''}>business</option>
            </select>
          </div>
          <div class="admin-user-row">
            <label>Max sessions</label>
            <input type="number" min="0" max="50" data-act="maxSessions" value="${u.maxSessions ?? 5}" />
          </div>
          <div class="toolbar" style="margin-top:0.55rem;gap:0.4rem;flex-wrap:wrap">
            <button class="btn btn-sm" data-act="saveUser" type="button">Save</button>
            <button class="btn btn-sm btn-ghost" data-act="upgradePro" type="button">Upgrade Pro</button>
            <button class="btn btn-sm btn-ghost" data-act="deleteUser" type="button" style="color:var(--red)">Hapus akun</button>
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
          plan: card.querySelector('[data-act="plan"]').value,
          maxSessions: parseInt(card.querySelector('[data-act="maxSessions"]').value, 10),
        };
        try {
          await API.adminPatchUser(uid, body);
          toast('User updated');
        } catch (e) {
          toast(e.message || 'Update failed');
        }
      });
      card.querySelector('[data-act="upgradePro"]')?.addEventListener('click', async () => {
        try {
          await API.adminPatchUser(uid, { plan: 'pro' });
          toast('User upgraded to Pro');
          loadAdmin();
        } catch (e) {
          toast(e.message || 'Upgrade failed');
        }
      });
      card.querySelector('[data-act="deleteUser"]')?.addEventListener('click', async () => {
        if (!confirm('Hapus akun ini permanen beserta semua session-nya?')) return;
        try {
          await API.adminDeleteUser(uid);
          toast('Akun dihapus');
          loadAdmin();
        } catch (e) {
          toast(e.message || 'Delete failed');
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
