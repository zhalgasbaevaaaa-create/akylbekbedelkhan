/**
 * PostgreSQL адаптерінің сынағы (PGlite = нағыз PostgreSQL, wasm).
 *
 * Мақсаты: SQLite-та жұмыс істейтін код PostgreSQL-де де дұрыс жүретінін
 * тексеру. Render/Railway тегін жоспарында диск болмағандықтан, дерекқор
 * ретінде PostgreSQL қолданылады.
 *
 * Іске қосу: node tests/postgres.test.mjs
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);

/* PGlite-ті `pg` пакеті ретінде көрсету (Pool API эмуляциясы) */
const pglite = await new PGlite();
const Module = require('module');
const origResolve = Module._resolveFilename;
const FAKE_PG = '\u0000fake-pg';
Module._resolveFilename = function (request, ...rest) {
  if (request === 'pg') return FAKE_PG;
  return origResolve.call(this, request, ...rest);
};
require.cache[FAKE_PG] = {
  id: FAKE_PG,
  filename: FAKE_PG,
  loaded: true,
  exports: {
    Pool: class {
      // eslint-disable-next-line class-methods-use-this
      async query(sql, params) {
        // node-postgres параметрсіз сұраныста simple query протоколын қолданады
        // (сонда ғана бірнеше команданы бір рет жіберуге болады)
        if (params === undefined || params.length === 0) {
          const res = await pglite.exec(sql);
          const last = res[res.length - 1] || { rows: [] };
          return { rows: last.rows || [], rowCount: last.affectedRows ?? (last.rows || []).length };
        }
        const res = await pglite.query(sql, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      }

      async connect() {
        return { query: (s, p) => this.query(s, p), release() {} };
      }

      // eslint-disable-next-line class-methods-use-this
      async end() {}
    },
  },
};

process.env.DB_DRIVER = 'postgres';
process.env.DATABASE_URL = 'postgres://pglite/test';
process.env.JWT_SECRET = 'pg-test-secret';
process.env.NODE_ENV = 'test';

const { migrate } = require('../server/database/schema.js');
const { getDb } = require('../server/database/db.js');
const { createApp } = require('../server/app.js');
const taskService = require('../server/services/taskService.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let base;
let server;
let csrf;
const cookies = {};

const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

function storeCookies(res) {
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i)] = pair.slice(i + 1);
  });
}

async function call(path, { method = 'GET', body, token, raw = false } = {}) {
  const headers = { Cookie: cookieHeader() };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  let data = null;
  try { data = await res.json(); } catch (_) { /* бос жауап */ }
  return { status: res.status, data };
}

/* ---------------------------- Сынақтар ---------------------------- */

test('PostgreSQL адаптері қосылады', async () => {
  const db = getDb();
  assert.strictEqual(db.dialect, 'postgres');
  const rows = await db.query('SELECT 1 AS ok');
  assert.strictEqual(Number(rows[0].ok), 1);
});

test('Схема PostgreSQL-де құрылады (SERIAL, DOUBLE PRECISION)', async () => {
  const db = getDb();
  const tables = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1",
  );
  const names = tables.map((t) => t.table_name);
  ['students', 'attempts', 'room_results', 'answer_logs', 'best_scores', 'settings']
    .forEach((t) => assert.ok(names.includes(t), `${t} кестесі болуы керек`));

  const acc = await db.query(
    "SELECT data_type FROM information_schema.columns WHERE table_name='attempts' AND column_name='accuracy'",
  );
  assert.strictEqual(acc[0].data_type, 'double precision', 'REAL -> DOUBLE PRECISION');
});

test('$1 плейсхолдерлері PostgreSQL-де жұмыс істейді', async () => {
  const db = getDb();
  await db.run('INSERT INTO settings (key, value) VALUES ($1, $2)', ['pg_probe', 'мән']);
  const row = await db.one('SELECT value FROM settings WHERE key = $1', ['pg_probe']);
  assert.strictEqual(row.value, 'мән');
});

test('Админ паролі bcrypt hash түрінде сақталды', async () => {
  const row = await getDb().one("SELECT value FROM settings WHERE key = 'admin_password_hash'");
  assert.ok(row && row.value.startsWith('$2'), 'bcrypt hash болуы керек');
});

const student = {
  firstName: 'Айдана', lastName: 'Қуанышқызы', group: 'PG-01', institution: 'PostgreSQL колледжі',
};
let playerToken;

test('Студент тіркеледі (PostgreSQL)', async () => {
  const { status, data } = await call('/api/game/register', { method: 'POST', body: student });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.attemptsLeft, 3);
  playerToken = data.token;
});

async function playFullGame() {
  const start = await call('/api/game/attempt/start', {
    method: 'POST', body: { characterId: 'batyr_1' }, token: playerToken,
  });
  assert.strictEqual(start.status, 200);
  const attemptId = start.data.attemptId;
  const full = await taskService.getTasks();

  for (const room of full.rooms) {
    for (const stage of room.stages) {
      for (const item of stage.items) {
        const value = stage.type === 'quiz' ? item.answer
          : stage.type === 'matching' ? item.right
            : stage.type === 'timeline' ? item.event : item.explanation;
        const res = await call('/api/game/answer', {
          method: 'POST',
          token: playerToken,
          body: {
            attemptId, roomIndex: room.index, stageId: stage.id,
            itemId: item.id, value: String(value), timeMs: 400,
          },
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.correct, true, `дұрыс жауап: ${item.id}`);
      }
    }
    const done = await call('/api/game/room/complete', {
      method: 'POST',
      token: playerToken,
      body: { attemptId, roomIndex: room.index, heartsLeft: 5, timeMs: 20000, cleared: true },
    });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.data.bonus, 15, 'бонустар PostgreSQL-де де есептеледі');
  }

  const fin = await call('/api/game/attempt/finish', {
    method: 'POST', token: playerToken, body: { attemptId, status: 'finished' },
  });
  assert.strictEqual(fin.status, 200);
  return fin.data;
}

test('Толық ойын PostgreSQL-де өтеді (7 бөлме)', async () => {
  const result = await playFullGame();
  const tasks = await taskService.getTasks();
  assert.strictEqual(result.roomsCleared, 7);
  assert.strictEqual(result.correct, tasks.totalQuestions);
  assert.strictEqual(result.totalScore, tasks.totalQuestions + 7 * 15);
  assert.strictEqual(result.accuracy, 100);
  assert.strictEqual(result.rooms.length, 7);
});

test('SUM/AVG агрегаттары PostgreSQL-де дұрыс (numeric түрі)', async () => {
  const db = getDb();
  const row = await db.one(
    `SELECT SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
            AVG(time_ms) AS avg_time
       FROM answer_logs`,
  );
  assert.ok(Number(row.correct) > 100, 'SUM дұрыс есептелді');
  assert.ok(Number(row.avg_time) > 0, 'AVG дұрыс есептелді');
});

test('Best Score PostgreSQL-де есептеледі', async () => {
  const row = await getDb().one('SELECT * FROM best_scores LIMIT 1');
  assert.ok(row);
  assert.strictEqual(Number(row.attempts_used), 1);
  const max = await getDb().one('SELECT MAX(score) AS m FROM attempts');
  assert.strictEqual(Number(row.best_score), Number(max.m));
});

test('3 әрекет шектеуі PostgreSQL-де жұмыс істейді', async () => {
  await playFullGame();
  await playFullGame();
  const me = await call('/api/game/me', { token: playerToken });
  assert.strictEqual(me.data.attemptsLeft, 0);
  const blocked = await call('/api/game/attempt/start', {
    method: 'POST', body: { characterId: 'batyr_1' }, token: playerToken,
  });
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.data.error, 'Сіз бұл ойынды орындау лимитін аяқтадыңыз.');
});

let adminToken;

test('Админ PostgreSQL-де кіреді', async () => {
  const res = await call('/api/admin/login', { method: 'POST', body: { password: 'Akilbek8080' } });
  assert.strictEqual(res.status, 200);
  adminToken = res.data.token;
});

test('LOWER() іздеуі кириллицамен PostgreSQL-де жұмыс істейді', async () => {
  const found = await call('/api/admin/students?search=айдана', { token: adminToken });
  assert.strictEqual(found.status, 200);
  assert.strictEqual(found.data.total, 1, 'кіші әріппен іздеу табуы керек');
  const byGroup = await call('/api/admin/students?group=PG-01', { token: adminToken });
  assert.strictEqual(byGroup.data.total, 1);
});

test('Студенттер тізімінде 3 әрекет бағаны толы', async () => {
  const { data } = await call('/api/admin/students', { token: adminToken });
  const s = data.students[0];
  assert.ok(s.attempt1 != null && s.attempt2 != null && s.attempt3 != null);
  assert.strictEqual(Number(s.attempts_used), 3);
});

test('Статистика PostgreSQL-де есептеледі', async () => {
  const { status, data } = await call('/api/admin/stats', { token: adminToken });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.totals.students, 1);
  assert.strictEqual(data.totals.attempts, 3);
  assert.ok(data.totals.avgScore > 0);
  assert.strictEqual(data.rooms.length, 7);
  assert.ok(data.questions.length > 100);
  assert.ok(data.top10.length >= 1);
});

test('Excel экспорты PostgreSQL деректерімен жұмыс істейді', async () => {
  const { status, buffer } = await call('/api/admin/export/excel', { token: adminToken, raw: true });
  assert.strictEqual(status, 200);
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]['Аты'], 'Айдана');
  assert.ok(Number(rows[0]['Best Score']) > 0);
});

test('PDF есебі PostgreSQL деректерімен жасалады', async () => {
  const { status, buffer } = await call('/api/admin/export/pdf', { token: adminToken, raw: true });
  assert.strictEqual(status, 200);
  assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
});

test('SQL Injection PostgreSQL-де де қауіпсіз', async () => {
  const evil = await call("/api/admin/students?search=' OR 1=1 --", { token: adminToken });
  assert.strictEqual(evil.status, 200);
  assert.strictEqual(evil.data.total, 0);
  const still = await getDb().one('SELECT COUNT(*) AS c FROM students');
  assert.ok(Number(still.c) >= 1, 'кесте бүлінбеді');
});

/* ----------------------------- Runner ----------------------------- */

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
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}\n    \x1b[31m${err.message}\x1b[0m`);
    failed += 1;
  }
}
server.close();
await pglite.close();
console.log(`\n  ${passed} өтті, ${failed} құлады\n`);
process.exit(failed ? 1 : 0);
