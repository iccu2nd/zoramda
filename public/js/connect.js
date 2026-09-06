const $ = (sel) => document.querySelector(sel);

const params = new URLSearchParams(window.location.search);
const botId = params.get('id');

let pollTimer = null;

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

function showState(name) {
  ['loading', 'missing-id', 'connected', 'picker', 'waiting', 'error'].forEach((s) => {
    $(`#state-${s}`).classList.toggle('hidden', s !== name);
  });
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function renderWaiting(bot) {
  showState('waiting');
  const qrBox = $('#waiting-qr');
  const pairBox = $('#waiting-pairing');
  qrBox.classList.toggle('hidden', !(bot.qr && bot.status !== 'pairing'));
  pairBox.classList.toggle('hidden', !bot.pairingCode);
  if (bot.qr) $('#qr-img').src = bot.qr;
  if (bot.pairingCode) $('#pairing-code-text').textContent = bot.pairingCode;

  const statusText = {
    connecting: 'Menghubungkan...',
    qr: 'Menunggu scan QR...',
    pairing: 'Menunggu kode dimasukkan...'
  };
  $('#waiting-status').textContent = statusText[bot.status] || 'Menunggu...';
}

function renderConnected(bot) {
  stopPoll();
  showState('connected');
  $('#connected-phone').textContent = bot.phoneNumber ? '+' + bot.phoneNumber : '';
}

function startPolling() {
  stopPoll();
  pollTimer = setInterval(async () => {
    try {
      const { bot } = await api(`/bots/${botId}`);
      if (bot.status === 'connected') {
        renderConnected(bot);
      } else if (bot.status === 'disconnected') {
        stopPoll();
        showState('picker');
      } else {
        renderWaiting(bot);
      }
    } catch (err) {
      stopPoll();
      $('#error-text').textContent = err.message;
      showState('error');
    }
  }, 2000);
}

function wirePicker() {
  const body = $('#state-picker');

  body.querySelector('[data-method="qr"]').addEventListener('click', async () => {
    try {
      const { bot } = await api(`/bots/${botId}/connect`, { method: 'POST', body: { method: 'qr' } });
      renderWaiting(bot);
      startPolling();
    } catch (err) {
      alert(err.message);
    }
  });

  body.querySelector('[data-method="pairing"]').addEventListener('click', () => {
    $('#pairing-fields').classList.remove('hidden');
    body.querySelectorAll('.connect-method').forEach((b) => {
      b.classList.remove('btn-primary');
      b.classList.add('btn-outline');
    });
    const pairBtn = body.querySelector('[data-method="pairing"]');
    pairBtn.classList.add('btn-primary');
    pairBtn.classList.remove('btn-outline');
  });

  $('#btn-start-pairing').addEventListener('click', async () => {
    const phone = $('#pair-phone').value.trim();
    try {
      const { bot } = await api(`/bots/${botId}/connect`, {
        method: 'POST',
        body: { method: 'pairing', phone }
      });
      renderWaiting(bot);
      startPolling();
    } catch (err) {
      alert(err.message);
    }
  });

  $('#btn-cancel-waiting').addEventListener('click', async () => {
    try {
      stopPoll();
      await api(`/bots/${botId}/disconnect`, { method: 'POST' });
    } catch {}
    $('#pairing-fields').classList.add('hidden');
    showState('picker');
  });
}

async function init() {
  if (!botId) {
    showState('missing-id');
    return;
  }

  try {
    await api('/auth/me');
  } catch {
    window.location.href = '/?redirect=connect&id=' + encodeURIComponent(botId);
    return;
  }

  try {
    const { bot } = await api(`/bots/${botId}`);
    $('#bot-name-label').textContent = bot.name ? `Hubungkan ${bot.name}` : 'Hubungkan Bot';

    if (bot.status === 'connected') {
      renderConnected(bot);
    } else if (bot.status === 'qr' || bot.status === 'pairing' || (bot.status === 'connecting' && (bot.qr || bot.pairingCode))) {
      renderWaiting(bot);
      startPolling();
    } else {
      showState('picker');
    }
  } catch (err) {
    $('#error-text').textContent = err.message;
    showState('error');
  }
}

wirePicker();
init();
