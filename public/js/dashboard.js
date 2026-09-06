import { api } from './api.js';
import { initThemeToggle } from './theme.js';

initThemeToggle(document.getElementById('themeToggle'));

const botListEl = document.getElementById('botList');
const mainEl = document.getElementById('main');
const toastEl = document.getElementById('toast');

let bots = [];
let selectedBotId = null;
let pollTimer = null;

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function statusLabel(status) {
  return { connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected' }[status] || status;
}

function formatUptime(ms) {
  if (!ms) return '—';
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  return `${mins}m`;
}

async function refreshBots() {
  const { bots: list } = await api.listBots();
  bots = list;
  renderBotList();
  if (!selectedBotId && bots.length) selectedBotId = bots[0].id;
  if (selectedBotId) await renderMain();
}

function renderBotList() {
  botListEl.innerHTML = '';
  for (const bot of bots) {
    const item = document.createElement('div');
    item.className = 'bot-list-item' + (bot.id === selectedBotId ? ' active' : '');
    item.innerHTML = `<span class="dot ${bot.status}"></span><span class="name">${escapeHtml(bot.name)}</span>`;
    item.addEventListener('click', () => { selectedBotId = bot.id; renderBotList(); renderMain(); });
    botListEl.appendChild(item);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function renderMain() {
  clearTimeout(pollTimer);
  const bot = bots.find((b) => b.id === selectedBotId);
  if (!bot) {
    mainEl.innerHTML = `<div class="card empty-state"><i class="fa-solid fa-robot"></i><h2>No bot selected</h2><p>Create a bot to get started.</p></div>`;
    return;
  }

  const { plugins } = await api.listBotPlugins(bot.id);

  mainEl.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>${escapeHtml(bot.name)}</h2>
        <span class="badge ${bot.status}"><i class="fa-solid fa-circle" style="font-size:6px"></i>${statusLabel(bot.status)}</span>
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="label">Number</div><div class="value">${bot.phoneNumber || '—'}</div></div>
        <div class="stat"><div class="label">Uptime</div><div class="value">${formatUptime(bot.uptimeMs)}</div></div>
        <div class="stat"><div class="label">Prefix</div><div class="value">${escapeHtml(bot.prefix)}</div></div>
      </div>
      <div class="row" id="connectionActions"></div>
      <div id="connectionPanel"></div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Settings</h2></div>
      <div class="field">
        <label for="f-name">Bot name</label>
        <input id="f-name" value="${escapeHtml(bot.name)}" />
      </div>
      <div class="field">
        <label for="f-prefix">Prefix</label>
        <input id="f-prefix" value="${escapeHtml(bot.prefix)}" maxlength="3" />
        <div class="hint">Character used before every command. Default: .</div>
      </div>
      <div class="field">
        <label for="f-menu-title">Menu title</label>
        <input id="f-menu-title" value="${escapeHtml(bot.menuTitle)}" />
      </div>
      <div class="field">
        <label for="f-menu-desc">Menu description</label>
        <input id="f-menu-desc" value="${escapeHtml(bot.menuDescription)}" />
      </div>
      <div class="field">
        <label for="f-menu-footer">Menu footer</label>
        <input id="f-menu-footer" value="${escapeHtml(bot.menuFooter)}" />
      </div>
      <button class="btn btn-primary" id="saveSettingsBtn"><i class="fa-solid fa-check"></i> Save settings</button>
    </div>

    <div class="card">
      <div class="card-header"><h2>Plugins</h2></div>
      <div id="pluginList"></div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Danger zone</h2></div>
      <button class="btn btn-danger" id="deleteBotBtn"><i class="fa-solid fa-trash"></i> Delete this bot</button>
    </div>
  `;

  renderConnectionArea(bot);
  renderPluginList(bot, plugins);

  document.getElementById('saveSettingsBtn').addEventListener('click', () => saveSettings(bot.id));
  document.getElementById('deleteBotBtn').addEventListener('click', () => deleteBot(bot.id));

  if (bot.status !== 'connected') {
    pollTimer = setTimeout(() => pollStatus(bot.id), 2000);
  }
}

function renderConnectionArea(bot) {
  const actions = document.getElementById('connectionActions');
  const panel = document.getElementById('connectionPanel');

  if (bot.status === 'connected') {
    actions.innerHTML = `
      <button class="btn" id="reconnectBtn"><i class="fa-solid fa-rotate"></i> Reconnect</button>
      <button class="btn btn-danger" id="disconnectBtn"><i class="fa-solid fa-plug-circle-xmark"></i> Disconnect</button>
    `;
    panel.innerHTML = '';
    document.getElementById('reconnectBtn').addEventListener('click', () => runAction(() => api.reconnectBot(bot.id), 'Reconnecting…'));
    document.getElementById('disconnectBtn').addEventListener('click', () => runAction(() => api.disconnectBot(bot.id), 'Disconnected'));
  } else {
    actions.innerHTML = `<button class="btn btn-primary" id="connectBtn"><i class="fa-solid fa-plug"></i> Connect</button>`;
    document.getElementById('connectBtn').addEventListener('click', () => runAction(() => api.connectBot(bot.id), 'Connecting…'));

    if (bot.qrDataUrl) {
      panel.innerHTML = `<div class="qr-box"><img src="${bot.qrDataUrl}" alt="QR code" /><p>Scan this with WhatsApp &gt; Linked devices</p></div>`;
    } else if (bot.pairingCode) {
      panel.innerHTML = `<div class="qr-box"><div class="pairing-code">${escapeHtml(bot.pairingCode)}</div><p>Enter this code in WhatsApp &gt; Linked devices &gt; Link with phone number</p></div>`;
    } else {
      panel.innerHTML = '';
    }
  }
}

function renderPluginList(bot, plugins) {
  const el = document.getElementById('pluginList');
  el.innerHTML = plugins.map((p) => `
    <div class="plugin-row">
      <div class="meta">
        <div class="name">${escapeHtml(bot.prefix)}${escapeHtml(p.command)}</div>
        <div class="desc">${escapeHtml(p.description)}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-command="${escapeHtml(p.command)}" ${p.enabled ? 'checked' : ''} />
        <span class="slider"></span>
      </label>
    </div>
  `).join('');

  el.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        await api.setBotPlugin(bot.id, input.dataset.command, input.checked);
        toast(input.checked ? 'Plugin enabled' : 'Plugin disabled');
      } catch (err) {
        toast(err.message);
        input.checked = !input.checked;
      }
    });
  });
}

async function pollStatus(botId) {
  if (botId !== selectedBotId) return;
  try {
    const { bot } = await api.botStatus(botId);
    const idx = bots.findIndex((b) => b.id === botId);
    if (idx !== -1) bots[idx] = bot;
    renderBotList();
    renderConnectionArea(bot);
    document.querySelector('.stat-grid').innerHTML = `
      <div class="stat"><div class="label">Number</div><div class="value">${bot.phoneNumber || '—'}</div></div>
      <div class="stat"><div class="label">Uptime</div><div class="value">${formatUptime(bot.uptimeMs)}</div></div>
      <div class="stat"><div class="label">Prefix</div><div class="value">${escapeHtml(bot.prefix)}</div></div>
    `;
    document.querySelector('.badge').outerHTML = `<span class="badge ${bot.status}"><i class="fa-solid fa-circle" style="font-size:6px"></i>${statusLabel(bot.status)}</span>`;
  } catch { /* ignore transient polling errors */ }

  if (botId === selectedBotId) {
    const current = bots.find((b) => b.id === botId);
    if (current && current.status !== 'connected') {
      pollTimer = setTimeout(() => pollStatus(botId), 2000);
    }
  }
}

async function runAction(fn, message) {
  try {
    await fn();
    toast(message);
    await refreshBots();
  } catch (err) {
    toast(err.message);
  }
}

async function saveSettings(botId) {
  try {
    await api.updateBot(botId, {
      name: document.getElementById('f-name').value,
      prefix: document.getElementById('f-prefix').value,
      menuTitle: document.getElementById('f-menu-title').value,
      menuDescription: document.getElementById('f-menu-desc').value,
      menuFooter: document.getElementById('f-menu-footer').value
    });
    toast('Settings saved');
    await refreshBots();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteBot(botId) {
  if (!confirm('Delete this bot? This cannot be undone.')) return;
  try {
    await api.deleteBot(botId);
    selectedBotId = null;
    toast('Bot deleted');
    await refreshBots();
  } catch (err) {
    toast(err.message);
  }
}

document.getElementById('newBotBtn').addEventListener('click', async () => {
  const name = prompt('Bot name:', 'ZoraBot');
  if (!name) return;
  try {
    const { bot } = await api.createBot({ name });
    selectedBotId = bot.id;
    toast('Bot created');
    await refreshBots();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  window.location.href = '/index.html';
});

api.me().then(refreshBots).catch(() => { window.location.href = '/index.html'; });
