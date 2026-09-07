const API = {
  getToken() {
    try { return localStorage.getItem('zb_token') || ''; } catch { return ''; }
  },
  setToken(t) {
    try { localStorage.setItem('zb_token', t || ''); } catch {}
  },
  clearToken() {
    try { localStorage.removeItem('zb_token'); } catch {}
  },
  async request(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = this.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  // auth
  register: (body) => API.request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => API.request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => API.request('/api/auth/me'),
  rotateApiKey: () => API.request('/api/auth/apikey/rotate', { method: 'POST' }),

  // sessions
  sessions: () => API.request('/api/sessions'),
  createSession: (body) => API.request('/api/sessions', { method: 'POST', body: JSON.stringify(body || {}) }),
  session: (id) => API.request('/api/sessions/' + id),
  qr: (id) => API.request('/api/sessions/' + id + '/qr'),
  pairing: (id) => API.request('/api/sessions/' + id + '/pairing'),
  connect: (id, body) => API.request('/api/sessions/' + id + '/connect', { method: 'POST', body: JSON.stringify(body || {}) }),
  disconnect: (id, body) => API.request('/api/sessions/' + id + '/disconnect', { method: 'POST', body: JSON.stringify(body || {}) }),
  deleteSession: (id) => API.request('/api/sessions/' + id, { method: 'DELETE' }),

  // config
  config: () => API.request('/api/config'),
  updateConfig: (body) => API.request('/api/config', { method: 'PATCH', body: JSON.stringify(body) }),
  configSchema: () => API.request('/api/config/schema'),

  // plugins
  plugins: () => API.request('/api/plugins'),
  updatePluginResponses: (command, body) =>
    API.request('/api/plugins/' + encodeURIComponent(command) + '/responses', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

window.API = API;
