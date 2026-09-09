(function () {
  const $ = (s, r = document) => r.querySelector(s);

  const ICONS = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`,
  };

  function setState(state, { title, desc }) {
    const icon = $('#verifyIcon');
    icon.className = 'verify-icon state-' + state;
    if (state === 'success') icon.innerHTML = ICONS.success;
    if (state === 'error') icon.innerHTML = ICONS.error;
    $('#verifyTitle').textContent = title;
    $('#verifyDesc').textContent = desc;
  }

  function renderLoginCta(email) {
    const emailHtml = email
      ? `<p class="verify-success-email allow-select">${String(email).replace(/</g, '&lt;')}</p>`
      : '';
    $('#verifyExtra').innerHTML = `
      ${emailHtml}
      <a class="btn btn-block" href="/login">Silakan login</a>
      <p class="verify-note" style="margin-top:0.9rem">Akun sudah aktif. Kamu bisa masuk ke dashboard sekarang.</p>
    `;
  }

  function renderResendForm(prefillEmail) {
    $('#verifyExtra').innerHTML = `
      <div class="verify-resend">
        <div class="outline-field">
          <label for="resendEmail">Email</label>
          <input type="email" id="resendEmail" placeholder="nama@gmail.com" value="${prefillEmail ? String(prefillEmail).replace(/"/g, '&quot;') : ''}">
        </div>
        <p class="verify-msg" id="resendMsg"></p>
        <button class="btn btn-block" id="resendBtn" type="button">Kirim ulang tautan verifikasi</button>
        <p class="verify-note">Sudah verifikasi? <a href="/login">Masuk di sini</a></p>
      </div>
    `;
    $('#resendBtn').addEventListener('click', async () => {
      const email = ($('#resendEmail').value || '').trim();
      const msg = $('#resendMsg');
      msg.className = 'verify-msg';
      msg.textContent = '';
      if (!email) {
        msg.classList.add('err');
        msg.textContent = 'Masukkan alamat email kamu.';
        return;
      }
      const btn = $('#resendBtn');
      btn.disabled = true;
      try {
        const res = await API.resendVerification({ email });
        msg.classList.add('ok');
        msg.textContent = res.message || 'Tautan verifikasi baru sudah dikirim, cek inbox kamu.';
      } catch (e) {
        msg.classList.add('err');
        msg.textContent = e.message || 'Gagal mengirim ulang. Coba lagi nanti.';
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function run() {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');

    if (!token) {
      setState('error', {
        title: 'Tautan tidak valid',
        desc: 'Tautan verifikasi tidak ditemukan. Masukkan email kamu untuk mengirim ulang tautan verifikasi.',
      });
      renderResendForm();
      return;
    }

    try {
      const res = await API.verifyEmail(token);
      if (res.alreadyVerified) {
        setState('success', {
          title: 'Email sudah terverifikasi',
          desc: 'Akun kamu sudah aktif sepenuhnya. Silakan login untuk melanjutkan.',
        });
      } else {
        setState('success', {
          title: 'Akun berhasil diverifikasi',
          desc: 'Email terverifikasi. Akun aktif — silakan login ke dashboard.',
        });
      }
      renderLoginCta(res.email);
    } catch (e) {
      const data = e.data || {};
      if (data.expired) {
        setState('error', {
          title: 'Tautan sudah kedaluwarsa',
          desc: 'Tautan verifikasi ini sudah tidak berlaku. Kirim ulang tautan baru ke email kamu.',
        });
        renderResendForm(data.email);
      } else {
        setState('error', {
          title: 'Verifikasi gagal',
          desc: e.message || 'Tautan verifikasi tidak valid atau sudah digunakan.',
        });
        renderResendForm();
      }
    }
  }

  run();
})();
