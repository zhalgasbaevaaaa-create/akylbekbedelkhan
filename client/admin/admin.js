/**
 * Админ панелінің логикасы.
 */
import api, { setToken } from '../src/components/api.js';
import { $, $$, el, clear, toast, setAlert, formatTime } from '../src/components/ui.js';

const state = { students: [], stats: null, charts: {}, filters: {} };

/* ------------------------------- Кіру -------------------------------- */

async function login(event) {
  event.preventDefault();
  const alertNode = $('#login-alert');
  setAlert(alertNode, '');
  const btn = $('#btn-login');
  btn.disabled = true;
  btn.textContent = 'Тексерілуде…';
  try {
    const data = await api.adminLogin($('#admin-pass').value);
    setToken(data.token);
    await openDashboard();
  } catch (err) {
    setAlert(alertNode, err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'КІРУ';
  }
}

async function openDashboard() {
  $('#screen-login').classList.remove('active');
  $('#dashboard').hidden = false;
  await refreshAll();
}

async function logout() {
  try { await api.adminLogout(); } catch (_) { /* сессия әлдеқашан жабық */ }
  setToken(null);
  window.location.reload();
}

/* ----------------------------- Деректер ------------------------------ */

async function refreshAll() {
  try {
    const [stats, students] = await Promise.all([api.stats(), api.students()]);
    state.stats = stats;
    state.students = students.students;
    renderKpis();
    renderCharts();
    renderFilters();
    renderStudents();
    renderRooms();
    renderQuestions();
    await loadTasksInfo();
    await loadSheets();
  } catch (err) {
    if (err.status === 401) { setToken(null); window.location.reload(); return; }
    toast(err.message, 'error');
  }
}

/* -------------------------------- KPI -------------------------------- */

function renderKpis() {
  const t = state.stats.totals;
  const items = [
    { icon: '👥', value: t.students, label: 'Жалпы студент' },
    { icon: '🎮', value: t.attempts, label: 'Жалпы әрекет' },
    { icon: '⭐', value: t.avgScore.toFixed(1), label: 'Орташа ұпай' },
    { icon: '🎯', value: `${t.avgAccuracy.toFixed(1)}%`, label: 'Орташа дәлдік' },
    { icon: '⏱', value: formatTime(t.avgTimeMs), label: 'Орташа уақыт' },
    { icon: '🏆', value: state.stats.top10[0] ? state.stats.top10[0].best_score : 0, label: 'Ең жоғары ұпай' },
  ];
  clear($('#kpi-grid')).append(...items.map((i) => el('div', { class: 'kpi' }, [
    el('div', { class: 'icon', text: i.icon }),
    el('div', { class: 'value', text: String(i.value) }),
    el('div', { class: 'label', text: i.label }),
  ])));
}

/* ------------------------------ Charts ------------------------------- */

const CHART_DEFAULTS = {
  plugins: {
    legend: { labels: { color: '#9aa6c4', font: { family: 'Rubik', size: 11 } } },
    tooltip: {
      backgroundColor: 'rgba(10,15,28,.96)',
      borderColor: 'rgba(232,185,35,.3)',
      borderWidth: 1,
      titleColor: '#e8b923',
      bodyColor: '#eef2fb',
      padding: 10,
    },
  },
  scales: {
    x: { ticks: { color: '#9aa6c4', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
    y: { ticks: { color: '#9aa6c4', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true },
  },
  responsive: true,
  maintainAspectRatio: false,
};

function chart(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  const ctx = document.getElementById(id);
  if (!ctx) return;
  state.charts[id] = new Chart(ctx, config);
}

function renderCharts() {
  const { top10, rooms } = state.stats;

  chart('chart-top10', {
    type: 'bar',
    data: {
      labels: top10.map((s) => `${s.first_name} ${s.last_name}`),
      datasets: [{
        label: 'Best Score',
        data: top10.map((s) => Number(s.best_score)),
        backgroundColor: top10.map((_, i) =>
          ['#ffd700', '#cfd6e4', '#d99a5b'][i] || 'rgba(46,196,196,.65)'),
        borderRadius: 6,
      }],
    },
    options: { ...CHART_DEFAULTS, indexAxis: 'y' },
  });

  chart('chart-rooms', {
    type: 'bar',
    data: {
      labels: rooms.map((r) => `${r.index}-бөлме`),
      datasets: [{
        label: 'Орташа ұпай',
        data: rooms.map((r) => r.avgScore),
        backgroundColor: 'rgba(232,185,35,.6)',
        borderColor: '#e8b923',
        borderWidth: 1,
        borderRadius: 6,
      }],
    },
    options: CHART_DEFAULTS,
  });

  chart('chart-progress', {
    type: 'bar',
    data: {
      labels: rooms.map((r) => `${r.index}-бөлме`),
      datasets: [
        { label: 'Өтті', data: rooms.map((r) => r.cleared), backgroundColor: 'rgba(53,194,106,.72)', borderRadius: 5 },
        { label: 'Тоқтады', data: rooms.map((r) => r.stopped), backgroundColor: 'rgba(226,69,59,.72)', borderRadius: 5 },
      ],
    },
    options: { ...CHART_DEFAULTS, scales: { ...CHART_DEFAULTS.scales, x: { ...CHART_DEFAULTS.scales.x, stacked: true }, y: { ...CHART_DEFAULTS.scales.y, stacked: true } } },
  });

  const correct = rooms.reduce((s, r) => s + r.correct, 0);
  const wrong = rooms.reduce((s, r) => s + r.wrong, 0);
  chart('chart-accuracy', {
    type: 'doughnut',
    data: {
      labels: ['Дұрыс жауап', 'Қате жауап'],
      datasets: [{
        data: [correct, wrong],
        backgroundColor: ['rgba(53,194,106,.8)', 'rgba(226,69,59,.8)'],
        borderColor: '#0e1424',
        borderWidth: 3,
      }],
    },
    options: { ...CHART_DEFAULTS, scales: {}, cutout: '62%' },
  });
}

/* ----------------------------- Студенттер ---------------------------- */

function renderFilters() {
  const { groups, institutions } = state.stats.filters;
  const fill = (sel, list, allLabel) => {
    const node = $(sel);
    const current = node.value;
    clear(node).append(el('option', { value: '', text: allLabel }));
    list.forEach((i) => node.append(el('option', { value: i.name, text: `${i.name} (${i.c})` })));
    node.value = current;
  };
  fill('#filter-group', groups, 'Барлық топ');
  fill('#filter-institution', institutions, 'Барлық оқу орны');

  const roomSel = $('#filter-room');
  const cur = roomSel.value;
  clear(roomSel).append(el('option', { value: '', text: 'Барлық бөлме' }));
  state.stats.rooms.forEach((r) => roomSel.append(
    el('option', { value: String(r.index), text: `${r.index}-бөлме · ${r.title || ''}` }),
  ));
  roomSel.value = cur;
}

async function applyStudentFilters() {
  const params = {
    search: $('#filter-search').value.trim(),
    group: $('#filter-group').value,
    institution: $('#filter-institution').value,
  };
  try {
    const data = await api.students(params);
    state.students = data.students;
    renderStudents();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderStudents() {
  const tbody = $('#students-table tbody');
  clear(tbody);
  $('#filter-count').textContent = `Барлығы: ${state.students.length}`;

  if (!state.students.length) {
    tbody.append(el('tr', {}, el('td', { colspan: '11', class: 'empty-row', text: 'Студент табылмады.' })));
    return;
  }

  state.students.forEach((s, i) => {
    const row = el('tr', { onclick: () => openStudent(s.id) }, [
      el('td', { class: `rank${i < 3 ? ` top${i + 1}` : ''}`, text: String(i + 1) }),
      el('td', { text: `${s.last_name} ${s.first_name}` }),
      el('td', { text: s.student_group }),
      el('td', { class: 'muted', text: s.institution }),
      el('td', { class: 'num', text: s.attempt1 != null ? String(s.attempt1) : '—' }),
      el('td', { class: 'num', text: s.attempt2 != null ? String(s.attempt2) : '—' }),
      el('td', { class: 'num', text: s.attempt3 != null ? String(s.attempt3) : '—' }),
      el('td', { class: 'num best', text: String(s.best_score) }),
      el('td', {}, [accuracyBar(Number(s.best_accuracy))]),
      el('td', { class: 'num', text: formatTime(s.best_time_ms) }),
      el('td', { class: 'muted', text: (s.last_played || '—').slice(0, 16).replace('T', ' ') }),
    ]);
    tbody.append(row);
  });
}

function accuracyBar(value) {
  return el('div', { class: 'bar-cell' }, [
    el('div', { class: 'bar-track' }, el('div', {
      class: 'bar-fill', style: { width: `${Math.max(0, Math.min(100, value))}%` },
    })),
    el('span', { style: { fontSize: '.78rem', minWidth: '40px' }, text: `${value.toFixed(0)}%` }),
  ]);
}

/* ------------------------- Студент карточкасы ------------------------ */

async function openStudent(id) {
  try {
    const { student, attempts } = await api.studentCard(id);
    const best = Number(student.best_score);
    const host = $('#student-card-content');
    clear(host).append(
      el('div', { class: 'student-head' }, [
        el('div', { class: 'student-name', text: `${student.last_name} ${student.first_name}` }),
        el('div', { class: 'student-meta', text: `${student.student_group} · ${student.institution}` }),
      ]),
      el('div', { class: 'student-meta',
        text: `Тіркелген күні: ${(student.created_at || '').slice(0, 16)} · Соңғы тапсырған: ${(student.last_played || '—').slice(0, 16).replace('T', ' ')}` }),
      el('div', { class: 'stat-grid' }, [
        stat(best, 'Best Score'),
        stat(`${Number(student.best_accuracy).toFixed(1)}%`, 'Ең жоғары дәлдік'),
        stat(formatTime(student.best_time_ms), 'Ең жылдам уақыт'),
        stat(`${student.attempts_used}/3`, 'Әрекет саны'),
      ]),
      ...attempts.map((a) => attemptBlock(a, best)),
      attempts.length ? null : el('p', { class: 'card-desc', style: { marginTop: '18px' },
        text: 'Бұл студент әлі ойнамаған.' }),
    );
    $('#student-modal').hidden = false;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function attemptBlock(a, best) {
  const isBest = Number(a.score) === best && a.status !== 'in_progress';
  const rows = (a.rooms || []).map((r) => el('tr', {}, [
    el('td', { text: String(r.room_index) }),
    el('td', { text: r.room_title || '—' }),
    el('td', { class: 'num', text: String(r.score) }),
    el('td', { class: 'num ok', text: String(r.correct_count) }),
    el('td', { class: 'num bad', text: String(r.wrong_count) }),
    el('td', { class: 'num', text: `+${r.bonus}` }),
    el('td', { class: 'num', text: '❤'.repeat(r.hearts_left) || '—' }),
    el('td', { class: 'num', text: formatTime(r.time_ms) }),
    el('td', { class: r.cleared ? 'ok' : 'bad', text: r.cleared ? 'Өтті' : 'Тоқтады' }),
  ]));

  return el('div', { class: 'attempt-block' }, [
    el('div', { class: 'attempt-head' }, [
      el('span', {
        class: `attempt-badge${isBest ? ' best' : ''}${a.status === 'failed' ? ' failed' : ''}`,
        text: `${a.attempt_number}-әрекет${isBest ? ' · BEST' : ''}`,
      }),
      el('span', { class: 'student-meta', text: `📅 ${a.play_date || '—'}  🕐 ${a.play_time || '—'}` }),
      el('span', { class: 'student-meta', text: `⭐ ${a.score} ұпай` }),
      el('span', { class: 'student-meta', text: `🎯 ${Number(a.accuracy).toFixed(1)}%` }),
      el('span', { class: 'student-meta', text: `⏱ ${formatTime(a.total_time_ms)}` }),
      el('span', { class: 'student-meta', text: `🏛 ${a.rooms_cleared} бөлме` }),
    ]),
    rows.length
      ? el('div', { class: 'table-scroll' }, el('table', { class: 'data-table' }, [
          el('thead', {}, el('tr', {}, [
            el('th', { text: '№' }), el('th', { text: 'Бөлме' }), el('th', { text: 'Ұпай' }),
            el('th', { text: 'Дұрыс' }), el('th', { text: 'Қате' }), el('th', { text: 'Бонус' }),
            el('th', { text: 'Жан' }), el('th', { text: 'Уақыт' }), el('th', { text: 'Күй' }),
          ])),
          el('tbody', {}, rows),
        ]))
      : el('div', { class: 'card-desc', text: 'Бөлме нәтижелері жоқ.' }),
  ]);
}

function stat(value, label) {
  return el('div', { class: 'stat-box' }, [
    el('div', { class: 'v', text: String(value) }),
    el('div', { class: 'k', text: label }),
  ]);
}

/* ------------------------------ Бөлмелер ----------------------------- */

function renderRooms() {
  const tbody = $('#rooms-table tbody');
  clear(tbody);
  const rooms = state.stats.rooms;
  if (!rooms.length) {
    tbody.append(el('tr', {}, el('td', { colspan: '10', class: 'empty-row', text: 'Деректер жоқ.' })));
    return;
  }
  rooms.forEach((r) => {
    const total = r.correct + r.wrong;
    const acc = total ? (r.correct / total) * 100 : 0;
    tbody.append(el('tr', {}, [
      el('td', { class: 'rank', text: String(r.index) }),
      el('td', { text: r.title || '—' }),
      el('td', { class: 'num', text: String(r.plays) }),
      el('td', { class: 'num ok', text: String(r.cleared) }),
      el('td', { class: 'num bad', text: String(r.stopped) }),
      el('td', { class: 'num best', text: r.avgScore.toFixed(1) }),
      el('td', { class: 'num', text: formatTime(r.avgTimeMs) }),
      el('td', { class: 'num ok', text: String(r.correct) }),
      el('td', { class: 'num bad', text: String(r.wrong) }),
      el('td', {}, [accuracyBar(acc)]),
    ]));
  });
}

/* ------------------------------ Сұрақтар ----------------------------- */

function renderQuestions() {
  const tbody = $('#questions-table tbody');
  clear(tbody);
  const roomFilter = $('#filter-room').value;
  const list = state.stats.questions.filter((q) => !roomFilter || String(q.roomIndex) === roomFilter);
  if (!list.length) {
    tbody.append(el('tr', {}, el('td', { colspan: '6', class: 'empty-row', text: 'Деректер жоқ.' })));
    return;
  }
  list.forEach((q) => {
    tbody.append(el('tr', {}, [
      el('td', { class: 'rank', text: String(q.roomIndex) }),
      el('td', { text: q.question || q.id }),
      el('td', { class: 'num ok', text: String(q.correct) }),
      el('td', { class: 'num bad', text: String(q.wrong) }),
      el('td', { class: 'num', text: String(q.total) }),
      el('td', {}, [accuracyBar(q.successRate)]),
    ]));
  });
}

/* ------------------------------ PDF баптау --------------------------- */

async function loadTasksInfo(reload = false) {
  const host = $('#tasks-info');
  clear(host).append(el('div', { class: 'info-row', text: 'Жүктелуде…' }));
  try {
    const info = await api.adminTasks(reload);
    clear(host).append(
      row('Файл', info.source),
      row('Бөлме саны', String(info.roomCount)),
      row('Жалпы тапсырма', String(info.totalQuestions)),
      row('Нұсқа (hash)', info.hash),
      row('Оқылған уақыт', (info.parsedAt || '').slice(0, 19).replace('T', ' ')),
      ...info.rooms.map((r) => row(
        `${r.index}-бөлме · ${r.title}`,
        r.stages.map((s) => `${typeLabel(s.type)}: ${s.total}`).join(' + '),
      )),
    );
  } catch (err) {
    clear(host).append(el('div', { class: 'info-row', text: err.message }));
  }
}

const typeLabel = (t) => ({
  quiz: 'Тест', matching: 'Сәйкестендіру', timeline: 'Хронология', cards: 'Карточкалар',
}[t] || t);

function row(k, v) {
  return el('div', { class: 'info-row' }, [
    el('span', { text: k }),
    el('b', { text: String(v) }),
  ]);
}

async function uploadPdf(file) {
  const alertNode = $('#upload-alert');
  setAlert(alertNode, 'PDF жүктеліп, талдануда…', 'info');
  try {
    const res = await api.uploadPdf(file);
    setAlert(alertNode,
      `✔ Сәтті! ${res.roomCount} бөлме, ${res.totalQuestions} тапсырма автоматты оқылды.`, 'success');
    toast('Тапсырмалар жаңарды', 'success');
    await loadTasksInfo();
  } catch (err) {
    setAlert(alertNode, err.message, 'error');
  }
}

/* --------------------------- Google Sheets --------------------------- */

async function loadSheets() {
  try {
    const cfg = await api.sheetsGet();
    $('#sheets-id').value = cfg.spreadsheetId || '';
    $('#sheets-name').value = cfg.sheetName || 'Нәтижелер';
    $('#sheets-enabled').checked = Boolean(cfg.enabled);
    $('#sheets-creds').placeholder = cfg.hasCredentials
      ? '••• кілт сақталған (өзгерту үшін жаңасын енгізіңіз)'
      : '{"type":"service_account", ...}';
  } catch (_) { /* маңызды емес */ }
}

async function saveSheets() {
  const alertNode = $('#sheets-alert');
  try {
    await api.sheetsSave({
      enabled: $('#sheets-enabled').checked,
      spreadsheetId: $('#sheets-id').value.trim(),
      sheetName: $('#sheets-name').value.trim() || 'Нәтижелер',
      credentials: $('#sheets-creds').value.trim(),
    });
    setAlert(alertNode, '✔ Баптау сақталды.', 'success');
    $('#sheets-creds').value = '';
    await loadSheets();
  } catch (err) {
    setAlert(alertNode, err.message, 'error');
  }
}

async function syncSheets() {
  const alertNode = $('#sheets-alert');
  setAlert(alertNode, 'Синхрондалуда…', 'info');
  try {
    const res = await api.sheetsSync();
    setAlert(alertNode, `✔ ${res.rows} жол Google Sheets-ке жазылды.`, 'success');
  } catch (err) {
    setAlert(alertNode, err.message, 'error');
  }
}

/* ------------------------------ Экспорт ------------------------------ */

async function download(kind) {
  const btn = kind === 'excel' ? $('#btn-export-excel') : $('#btn-export-pdf');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Дайындалуда…';
  try {
    const res = await fetch(api.exportUrl(kind), { credentials: 'include' });
    if (!res.ok) throw new Error('Экспорт сәтсіз аяқталды.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = kind === 'excel'
      ? `kz-history-results-${Date.now()}.xlsx`
      : `kz-history-report-${Date.now()}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Файл жүктелді', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ----------------------------- Пароль -------------------------------- */

async function changePassword() {
  const alertNode = $('#pass-alert');
  try {
    await api.adminPassword({
      currentPassword: $('#pass-current').value,
      newPassword: $('#pass-new').value,
    });
    setAlert(alertNode, '✔ Пароль өзгертілді.', 'success');
    $('#pass-current').value = '';
    $('#pass-new').value = '';
  } catch (err) {
    setAlert(alertNode, err.message, 'error');
  }
}

/* -------------------------------- Init ------------------------------- */

function initTabs() {
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => {
    $$('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${btn.dataset.tab}`));
  }));
}

function initUpload() {
  const zone = $('#upload-zone');
  const input = $('#pdf-input');
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) uploadPdf(input.files[0]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('over');
  }));
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') uploadPdf(file);
    else toast('Тек PDF файл жүктеуге болады.', 'error');
  });
}

function debounce(fn, ms = 320) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

async function init() {
  initTabs();
  initUpload();

  $('#login-form').addEventListener('submit', login);
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-refresh').addEventListener('click', refreshAll);
  $('#btn-export-excel').addEventListener('click', () => download('excel'));
  $('#btn-export-pdf').addEventListener('click', () => download('pdf'));
  $('#btn-sheets-save').addEventListener('click', saveSheets);
  $('#btn-sheets-sync').addEventListener('click', syncSheets);
  $('#btn-pass-save').addEventListener('click', changePassword);

  $('#filter-search').addEventListener('input', debounce(applyStudentFilters));
  $('#filter-group').addEventListener('change', applyStudentFilters);
  $('#filter-institution').addEventListener('change', applyStudentFilters);
  $('#filter-room').addEventListener('change', renderQuestions);

  $$('#student-modal [data-close]').forEach((n) => n.addEventListener('click', () => {
    $('#student-modal').hidden = true;
  }));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#student-modal').hidden = true;
  });

  // Бұрынғы сессия сақталған ба?
  try {
    await api.adminSession();
    await openDashboard();
  } catch (_) {
    $('#admin-pass').focus();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
