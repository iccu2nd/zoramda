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

  getAdminKey() {
    try { return sessionStorage.getItem('zb_admin_key') || ''; } catch { return ''; }
  },
  setAdminKey(k) {
    try {
      if (k) sessionStorage.setItem('zb_admin_key', k);
      else sessionStorage.removeItem('zb_admin_key');
    } catch {}
  },
  clearAdminKey() {
    try { sessionStorage.removeItem('zb_admin_key'); } catch {}
  },

  async request(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const token = this.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // Admin routes: prefer ADMIN_API_KEY when provided
    const adminKey = this.getAdminKey();
    if (adminKey && String(path).startsWith('/api/admin')) {
      headers['x-api-key'] = adminKey;
      // Admin key auth should not mix with user JWT for these routes
      delete headers['Authorization'];
    }

    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  register: (body) => API.request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => API.request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => API.request('/api/auth/me'),
  rotateApiKey: () => API.request('/api/auth/apikey/rotate', { method: 'POST' }),
  verifyEmail: (token) => API.request('/api/auth/verify-email?token=' + encodeURIComponent(token)),
  resendVerification: (body) =>
    API.request('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify(body || {}) }),

  sessions: () => API.request('/api/sessions'),
  createSession: (body) => API.request('/api/sessions', { method: 'POST', body: JSON.stringify(body || {}) }),
  session: (id) => API.request('/api/sessions/' + id),
  qr: (id) => API.request('/api/sessions/' + id + '/qr'),
  pairing: (id) => API.request('/api/sessions/' + id + '/pairing'),
  connect: (id, body) => API.request('/api/sessions/' + id + '/connect', { method: 'POST', body: JSON.stringify(body || {}) }),
  disconnect: (id, body) => API.request('/api/sessions/' + id + '/disconnect', { method: 'POST', body: JSON.stringify(body || {}) }),
  deleteSession: (id) => API.request('/api/sessions/' + id, { method: 'DELETE' }),

  config: (sessionId) => API.request('/api/config/' + encodeURIComponent(sessionId)),
  updateConfig: (sessionId, body) =>
    API.request('/api/config/' + encodeURIComponent(sessionId), {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  configSchema: () => API.request('/api/config/schema/fields'),

  plugins: () => API.request('/api/plugins'),
  sessionPlugins: (sessionId) =>
    API.request('/api/plugins/session/' + encodeURIComponent(sessionId)),
  updateSessionPlugins: (sessionId, plugins) =>
    API.request('/api/plugins/session/' + encodeURIComponent(sessionId), {
      method: 'PATCH',
      body: JSON.stringify({ plugins }),
    }),
  updatePluginResponses: (sessionId, command, body) =>
    API.request(
      '/api/plugins/session/' +
        encodeURIComponent(sessionId) +
        '/' +
        encodeURIComponent(command) +
        '/responses',
      { method: 'PATCH', body: JSON.stringify(body) }
    ),

  adminStats: () => API.request('/api/admin/stats'),
  adminUsers: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return API.request('/api/admin/users' + (q ? '?' + q : ''));
  },
  adminPatchUser: (userId, body) =>
    API.request('/api/admin/users/' + encodeURIComponent(userId), {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  adminDeleteUser: (userId) =>
    API.request('/api/admin/users/' + encodeURIComponent(userId), { method: 'DELETE' }),
  adminSessions: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return API.request('/api/admin/sessions' + (q ? '?' + q : ''));
  },
  adminDisconnectSession: (id, body) =>
    API.request('/api/admin/sessions/' + encodeURIComponent(id) + '/disconnect', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),
  adminDeleteSession: (id) =>
    API.request('/api/admin/sessions/' + encodeURIComponent(id), { method: 'DELETE' }),

  adminPlugins: () => API.request('/api/admin/plugins'),
  adminPluginTemplate: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return API.request('/api/admin/plugins/template' + (q ? '?' + q : ''));
  },
  adminPluginSource: (file) =>
    API.request('/api/admin/plugins/source?file=' + encodeURIComponent(file)),
  adminSavePluginSource: (file, source) =>
    API.request('/api/admin/plugins/source', {
      method: 'PUT',
      body: JSON.stringify({ file, source }),
    }),
  adminDeletePluginSource: (file) =>
    API.request('/api/admin/plugins/source', {
      method: 'DELETE',
      body: JSON.stringify({ file }),
    }),
  adminReloadPlugins: () =>
    API.request('/api/admin/plugins/reload', { method: 'POST' }),

  paymentPlans: () => API.request('/api/payment/plans'),
  paymentMe: () => API.request('/api/payment/me'),
  paymentCheckout: (plan) =>
    API.request('/api/payment/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
  paymentGet: (trxId) => API.request('/api/payment/' + encodeURIComponent(trxId)),
  paymentCheck: (trxId) =>
    API.request('/api/payment/' + encodeURIComponent(trxId) + '/check', { method: 'POST' }),
  paymentHistory: () => API.request('/api/payment'),
};

window.API = API;
