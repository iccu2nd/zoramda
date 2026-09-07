const API = {
  getKey() {
    try { return localStorage.getItem('zb_api_key') || ''; } catch { return ''; }
  },
  setKey(k) {
    try { localStorage.setItem('zb_api_key', k || ''); } catch {}
  },
  clearKey() {
    try { localStorage.removeItem('zb_api_key'); } catch {}
  },
  async request(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const key = this.getKey();
    if (key) headers['x-api-key'] = key;
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
  me: () => API.request('/api/auth/me'),
  sessions: () => API.request('/api/sessions'),
  createSession: (body) => API.request('/api/sessions', { method: 'POST', body: JSON.stringify(body || {}) }),
  session: (id) => API.request('/api/sessions/' + id),
  qr: (id) => API.request('/api/sessions/' + id + '/qr'),
  pairing: (id) => API.request('/api/sessions/' + id + '/pairing'),
  connect: (id, body) => API.request('/api/sessions/' + id + '/connect', { method: 'POST', body: JSON.stringify(body || {}) }),
  disconnect: (id, body) => API.request('/api/sessions/' + id + '/disconnect', { method: 'POST', body: JSON.stringify(body || {}) }),
  deleteSession: (id) => API.request('/api/sessions/' + id, { method: 'DELETE' }),
  config: () => API.request('/api/config'),
  updateConfig: (body) => API.request('/api/config', { method: 'PATCH', body: JSON.stringify(body) }),
  configSchema: () => API.request('/api/config/schema'),
};

window.API = API;
