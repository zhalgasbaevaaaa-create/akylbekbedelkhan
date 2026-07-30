/**
 * Сервермен байланыс қабаты (CSRF + JWT қолдауымен).
 */
const API_BASE = '/api';

let csrfToken = null;
let authToken = localStorage.getItem('kzrpg_token') || null;

async function ensureCsrf() {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${API_BASE}/csrf-token`, { credentials: 'include' });
  const data = await res.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

export function setToken(token) {
  authToken = token;
  if (token) localStorage.setItem('kzrpg_token', token);
  else localStorage.removeItem('kzrpg_token');
}

export function getToken() {
  return authToken;
}

async function request(path, { method = 'GET', body, raw = false, formData = null } = {}) {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  if (body && !formData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined),
  });

  if (raw) {
    if (!res.ok) throw new Error('Файлды жүктеу мүмкін болмады.');
    return res.blob();
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Қате: ${res.status}`);
    err.status = res.status;
    err.code = data && data.code;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/health'),

  // --- Ойын ---
  register: (payload) => request('/game/register', { method: 'POST', body: payload }),
  tasks: () => request('/game/tasks'),
  me: () => request('/game/me'),
  startAttempt: (characterId) => request('/game/attempt/start', { method: 'POST', body: { characterId } }),
  answer: (payload) => request('/game/answer', { method: 'POST', body: payload }),
  completeRoom: (payload) => request('/game/room/complete', { method: 'POST', body: payload }),
  finishAttempt: (payload) => request('/game/attempt/finish', { method: 'POST', body: payload }),

  // --- Админ ---
  adminLogin: (password) => request('/admin/login', { method: 'POST', body: { password } }),
  adminLogout: () => request('/admin/logout', { method: 'POST' }),
  adminSession: () => request('/admin/session'),
  adminPassword: (payload) => request('/admin/password', { method: 'POST', body: payload }),
  students: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/admin/students${q ? `?${q}` : ''}`);
  },
  studentCard: (id) => request(`/admin/students/${id}`),
  stats: () => request('/admin/stats'),
  adminTasks: (reload = false) => request(`/admin/tasks${reload ? '?reload=1' : ''}`),
  uploadPdf: (file) => {
    const fd = new FormData();
    fd.append('pdf', file);
    return request('/admin/tasks/upload', { method: 'POST', formData: fd });
  },
  sheetsGet: () => request('/admin/sheets'),
  sheetsSave: (payload) => request('/admin/sheets', { method: 'POST', body: payload }),
  sheetsSync: () => request('/admin/sheets/sync', { method: 'POST' }),
  exportUrl: (kind) => `${API_BASE}/admin/export/${kind}`,
};

export default api;
