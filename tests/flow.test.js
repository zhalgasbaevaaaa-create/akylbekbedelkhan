'use strict';
/**
 * End-to-end сынақ: тіркелу -> ойын -> 3 әрекет шектеуі -> админ -> экспорт.
 * Іске қосу: npm test
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
const TEST_DB = path.join(__dirname, 'tmp-test.db');
process.env.SQLITE_FILE = TEST_DB;
process.env.JWT_SECRET = 'test-secret-key-for-e2e-suite';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const { migrate } = require('../server/database/schema');
const { createApp } = require('../server/app');
const taskService = require('../server/services/taskService');

let base;
let server;
let csrf;
let cookies = {};

function cookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  raw.forEach((c) => {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
}

async function call(pathname, { method = 'GET', body, token, raw = false } = {}) {
  const headers = { Cookie: cookieHeader() };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + pathname, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  let data = null;
  try { data = await res.json(); } catch (_) { data = null; }
  return { status: res.status, data };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* --------------------------- Сынақтар --------------------------- */

test('PDF автоматты оқылады және 7 бөлме табылады', async () => {
  const tasks = await taskService.getTasks();
  assert.strictEqual(tasks.roomCount, 7, '7 бөлме болуы керек');
  assert.ok(tasks.totalQuestions > 100, 'тапсырмалар саны жеткілікті');
  const types = tasks.rooms.flatMap((r) => r.stages.map((s) => s.type));
  assert.ok(types.includes('quiz'), 'тест бар');
  assert.ok(types.includes('matching'), 'сәйкестендіру бар');
  assert.ok(types.includes('timeline'), 'timeline бар');
  assert.ok(types.includes('cards'), 'карточкалар бар');
});

test('Клиентке жауап кілттері жіберілмейді', async () => {
  const { status, data } = await call('/api/game/tasks');
  assert.strictEqual(status, 200);
  const json = JSON.stringify(data);
  assert.ok(!json.includes('"answer"'), 'quiz жауабы ағып кетпеуі керек');
  assert.ok(!json.includes('"letter"'), 'кілт әрпі ағып кетпеуі керек');
});

test('CSRF қорғанысы жұмыс істейді', async () => {
  const res = await fetch(`${base}/api/game/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'A', lastName: 'B', group: 'C', institution: 'D' }),
  });
  assert.strictEqual(res.status, 403, 'CSRF токенсіз сұраныс тыйылуы керек');
});

test('Валидация қате деректерді қабылдамайды', async () => {
  const { status } = await call('/api/game/register', {
    method: 'POST',
    body: { firstName: 'A', lastName: '', group: '', institution: '' },
  });
  assert.strictEqual(status, 400);
});

const student = {
  firstName: 'Аслан', lastName: 'Серікұлы', group: 'ИС-21', institution: 'Алматы колледжі',
};
let playerToken;

test('Студент тіркеледі', async () => {
  const { status, data } = await call('/api/game/register', { method: 'POST', body: student });
  assert.strictEqual(status, 200);
  assert.ok(data.token);
  assert.strictEqual(data.attemptsLeft, 3);
  playerToken = data.token;
});

/** Толық ойынды ойнау */
async function playFullGame({ perfect = true } = {}) {
  const start = await call('/api/game/attempt/start', {
    method: 'POST', body: { characterId: 'batyr_1' }, token: playerToken,
  });
  assert.strictEqual(start.status, 200, 'ойын басталуы керек');
  const attemptId = start.data.attemptId;
  const full = await taskService.getTasks();

  for (const room of full.rooms) {
    let wrongUsed = 0;
    for (const stage of room.stages) {
      for (const item of stage.items) {
        let value;
        if (stage.type === 'quiz') value = item.answer;
        else if (stage.type === 'matching') value = item.right;
        else if (stage.type === 'timeline') value = item.event;
        else value = item.explanation;
        // Бір қате жауап (perfect емес режимде)
        if (!perfect && wrongUsed === 0) { value = '__QATE__'; wrongUsed += 1; }
        const res = await call('/api/game/answer', {
          method: 'POST', token: playerToken,
          body: { attemptId, roomIndex: room.index, stageId: stage.id, itemId: item.id, value: String(value), timeMs: 500 },
        });
        assert.strictEqual(res.status, 200, `жауап қабылдануы керек (${room.index})`);
        if (perfect) assert.strictEqual(res.data.correct, true, `дұрыс жауап танылуы керек: ${item.id}`);
      }
    }
    const done = await call('/api/game/room/complete', {
      method: 'POST', token: playerToken,
      body: { attemptId, roomIndex: room.index, heartsLeft: perfect ? 5 : 4, timeMs: 30000, cleared: true },
    });
    assert.strictEqual(done.status, 200);
    if (perfect) {
      assert.strictEqual(done.data.correct, room.total, 'барлық жауап дұрыс');
      assert.strictEqual(done.data.bonus, 15, 'жүрек (+5) және толық дұрыс (+10) бонусы');
    }
  }

  const fin = await call('/api/game/attempt/finish', {
    method: 'POST', token: playerToken, body: { attemptId, status: 'finished' },
  });
  assert.strictEqual(fin.status, 200);
  return fin.data;
}

test('1-әрекет: барлық 7 бөлме толық өтіледі, бонустар есептеледі', async () => {
  const result = await playFullGame({ perfect: true });
  const tasks = await taskService.getTasks();
  assert.strictEqual(result.roomsCleared, 7);
  assert.strictEqual(result.correct, tasks.totalQuestions);
  assert.strictEqual(result.wrong, 0);
  assert.strictEqual(result.totalScore, tasks.totalQuestions + 7 * 15);
  assert.strictEqual(result.accuracy, 100);
  assert.strictEqual(result.bestScore, result.totalScore);
  assert.strictEqual(result.attemptsLeft, 2);
  assert.strictEqual(result.rooms.length, 7);
});

test('2-әрекет: қате жауаптармен нәтиже төмен, Best Score сақталады', async () => {
  const result = await playFullGame({ perfect: false });
  assert.ok(result.wrong >= 7, 'қате жауаптар тіркеледі');
  assert.ok(result.accuracy < 100);
  assert.ok(result.bestScore > result.totalScore, 'Best Score бірінші әрекеттен қалады');
  assert.strictEqual(result.attemptsLeft, 1);
});

test('3-әрекеттен кейін лимит бітеді', async () => {
  await playFullGame({ perfect: true });
  const status = await call('/api/game/me', { token: playerToken });
  assert.strictEqual(status.data.attemptsLeft, 0);

  const blocked = await call('/api/game/attempt/start', {
    method: 'POST', body: { characterId: 'batyr_1' }, token: playerToken,
  });
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.data.error, 'Сіз бұл ойынды орындау лимитін аяқтадыңыз.');

  const reRegister = await call('/api/game/register', { method: 'POST', body: student });
  assert.strictEqual(reRegister.status, 403, 'қайта тіркелгенде де лимит күшінде');
  assert.strictEqual(reRegister.data.code, 'ATTEMPT_LIMIT');
});

test('Best Score дұрыс есептелген', async () => {
  const { getDb } = require('../server/database/db');
  const row = await getDb().one('SELECT * FROM best_scores LIMIT 1');
  assert.ok(row);
  assert.strictEqual(Number(row.attempts_used), 3);
  const max = await getDb().one('SELECT MAX(score) AS m FROM attempts');
  assert.strictEqual(Number(row.best_score), Number(max.m));
});

let adminToken;

test('Админ паролі bcrypt арқылы тексеріледі', async () => {
  const bad = await call('/api/admin/login', { method: 'POST', body: { password: 'wrong-pass' } });
  assert.strictEqual(bad.status, 401);

  const ok = await call('/api/admin/login', { method: 'POST', body: { password: 'Akilbek8080' } });
  assert.strictEqual(ok.status, 200);
  assert.ok(ok.data.token);
  adminToken = ok.data.token;

  const { getDb } = require('../server/database/db');
  const row = await getDb().one("SELECT value FROM settings WHERE key = 'admin_password_hash'");
  assert.ok(row.value.startsWith('$2'), 'пароль bcrypt hash түрінде сақталуы керек');
});

test('Админ авторизациясыз кіре алмайды', async () => {
  const res = await fetch(`${base}/api/admin/students`);
  assert.strictEqual(res.status, 401);
});

test('Админ студенттер тізімін, іздеу мен сүзгіні алады', async () => {
  const all = await call('/api/admin/students', { token: adminToken });
  assert.strictEqual(all.status, 200);
  assert.ok(all.data.total >= 1);
  const s = all.data.students[0];
  assert.strictEqual(s.first_name, 'Аслан');
  assert.strictEqual(Number(s.attempts_used), 3);
  assert.ok(s.attempt1 != null && s.attempt2 != null && s.attempt3 != null, '3 әрекет ұпайы бар');

  const found = await call('/api/admin/students?search=аслан', { token: adminToken });
  assert.strictEqual(found.data.total, 1);
  const filtered = await call('/api/admin/students?group=ИС-21', { token: adminToken });
  assert.strictEqual(filtered.data.total, 1);
  const none = await call('/api/admin/students?group=ЖОҚ', { token: adminToken });
  assert.strictEqual(none.data.total, 0);
});

test('SQL Injection әрекеті қауіпсіз өңделеді', async () => {
  const evil = await call("/api/admin/students?search=' OR 1=1 --", { token: adminToken });
  assert.strictEqual(evil.status, 200);
  assert.strictEqual(evil.data.total, 0, 'инъекция нәтиже бермеуі керек');
  const { getDb } = require('../server/database/db');
  const still = await getDb().one('SELECT COUNT(*) AS c FROM students');
  assert.ok(Number(still.c) >= 1, 'кесте бүлінбеуі керек');
});

test('Студент карточкасы толық ақпарат береді', async () => {
  const list = await call('/api/admin/students', { token: adminToken });
  const id = list.data.students[0].id;
  const card = await call(`/api/admin/students/${id}`, { token: adminToken });
  assert.strictEqual(card.status, 200);
  assert.strictEqual(card.data.attempts.length, 3);
  assert.strictEqual(card.data.attempts[0].rooms.length, 7);
});

test('Статистика есептеледі', async () => {
  const { status, data } = await call('/api/admin/stats', { token: adminToken });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.totals.students, 1);
  assert.strictEqual(data.totals.attempts, 3);
  assert.ok(data.totals.avgScore > 0);
  assert.strictEqual(data.rooms.length, 7);
  assert.ok(data.questions.length > 100, 'әр сұрақтың статистикасы бар');
  assert.ok(data.top10.length >= 1);
  assert.ok(data.filters.groups.length >= 1);
});

test('Excel экспорты жұмыс істейді', async () => {
  const { status, buffer } = await call('/api/admin/export/excel', { token: adminToken, raw: true });
  assert.strictEqual(status, 200);
  assert.ok(buffer.length > 1000);
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]['Аты'], 'Аслан');
  assert.ok('Best Score' in rows[0] && 'Accuracy (%)' in rows[0] && 'Total Time' in rows[0]);
});

test('PDF есебі жасалады', async () => {
  const { status, buffer } = await call('/api/admin/export/pdf', { token: adminToken, raw: true });
  assert.strictEqual(status, 200);
  assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  assert.ok(buffer.length > 3000);
});

test('Google Sheets бапталмаса, жоба жұмысын жалғастырады', async () => {
  const cfg = await call('/api/admin/sheets', { token: adminToken });
  assert.strictEqual(cfg.status, 200);
  assert.strictEqual(cfg.data.enabled, false);
  const sync = await call('/api/admin/sheets/sync', { method: 'POST', token: adminToken });
  assert.strictEqual(sync.status, 400, 'бапталмаған кезде қате қайтарады, бірақ сервер құламайды');
});

test('Rate limiting белсенді', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.ok(res.headers.get('ratelimit-limit'), 'RateLimit тақырыптары болуы керек');
});

test('Helmet қауіпсіздік тақырыптарын қосады', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.ok(res.headers.get('content-security-policy'), 'CSP бар');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
});

test('XSS енгізу тазартылады', async () => {
  const evil = {
    firstName: '<script>alert(1)</script>Ер',
    lastName: 'Тарғын',
    group: 'ТР-1',
    institution: 'Тест колледжі',
  };
  const { status, data } = await call('/api/game/register', { method: 'POST', body: evil });
  assert.strictEqual(status, 400, 'қауіпті таңбалар валидациядан өтпейді');
  assert.ok(data.error);
});

/* ------------------------------ Runner ------------------------------ */

(async () => {
  await migrate();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  const res = await fetch(`${base}/api/csrf-token`);
  storeCookies(res);
  csrf = (await res.json()).csrfToken;

  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  \x1b[31m✗\x1b[0m ${t.name}`);
      console.log(`    \x1b[31m${err.message}\x1b[0m`);
      failed += 1;
    }
  }
  server.close();
  console.log(`\n  ${passed} өтті, ${failed} құлады\n`);
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  process.exit(failed ? 1 : 0);
})();
