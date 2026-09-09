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
      if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
        msg.classList.add('err');
        msg.textContent = 'Gunakan alamat @gmail.com.';
        return;
      }
      const btn = $('#resendBtn');
      btn.disabled = true;
      btn.textContent = 'Mengirim…';
      try {
        const res = await API.resendVerification({ email });
        if (res.alreadyVerified) {
          msg.classList.add('ok');
          msg.textContent = res.message || 'Email sudah terverifikasi. Silakan masuk.';
          btn.textContent = 'Kirim ulang tautan verifikasi';
          return;
        }
        if (res.emailSent === false) {
          msg.classList.add('err');
          msg.textContent = res.message || res.error || 'Email gagal terkirim. Coba lagi nanti.';
        } else {
          msg.classList.add('ok');
          msg.textContent =
            res.message ||
            'Tautan verifikasi baru sudah dikirim. Cek inbox Gmail dan folder spam.';
        }
      } catch (e) {
        msg.classList.add('err');
        msg.textContent = e.message || 'Gagal mengirim ulang. Coba lagi nanti.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Kirim ulang tautan verifikasi';
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
      const isExpired =
        data.expired || data.code === 'TOKEN_EXPIRED' || data.code === 'TOKEN_INVALID' || e.status === 410;
      setState('error', {
        title: isExpired ? 'Tautan kedaluwarsa / tidak berlaku' : 'Verifikasi gagal',
        desc:
          e.message ||
          'Tautan verifikasi tidak valid atau sudah tidak berlaku. Kirim ulang tautan baru ke email kamu.',
      });
      renderResendForm(data.email || '');
    }
  }

  run();
})();
