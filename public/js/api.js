async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (payload) => request('POST', '/api/auth/register', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),

  listBots: () => request('GET', '/api/bots'),
  createBot: (payload) => request('POST', '/api/bots', payload),
  getBot: (id) => request('GET', `/api/bots/${id}`),
  updateBot: (id, payload) => request('PATCH', `/api/bots/${id}`, payload),
  deleteBot: (id) => request('DELETE', `/api/bots/${id}`),
  connectBot: (id, payload) => request('POST', `/api/bots/${id}/connect`, payload),
  disconnectBot: (id) => request('POST', `/api/bots/${id}/disconnect`),
  reconnectBot: (id) => request('POST', `/api/bots/${id}/reconnect`),
  botStatus: (id) => request('GET', `/api/bots/${id}/status`),
  listBotPlugins: (id) => request('GET', `/api/bots/${id}/plugins`),
  setBotPlugin: (id, command, enabled) => request('PATCH', `/api/bots/${id}/plugins/${command}`, { enabled })
};
