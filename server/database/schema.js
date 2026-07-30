'use strict';
/** Дерекқор схемасы және миграция */
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const config = require('../config');

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  student_group TEXT NOT NULL,
  institution   TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (first_name, last_name, student_group, institution)
);

CREATE TABLE IF NOT EXISTS attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  character_id   TEXT,
  status         TEXT NOT NULL DEFAULT 'in_progress',
  score          INTEGER NOT NULL DEFAULT 0,
  correct_count  INTEGER NOT NULL DEFAULT 0,
  wrong_count    INTEGER NOT NULL DEFAULT 0,
  accuracy       REAL NOT NULL DEFAULT 0,
  total_time_ms  INTEGER NOT NULL DEFAULT 0,
  rooms_cleared  INTEGER NOT NULL DEFAULT 0,
  stopped_room   INTEGER,
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at    TEXT,
  play_date      TEXT,
  play_time      TEXT,
  UNIQUE (student_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS room_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id    INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  room_index    INTEGER NOT NULL,
  room_title    TEXT,
  room_type     TEXT,
  score         INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count   INTEGER NOT NULL DEFAULT 0,
  hearts_left   INTEGER NOT NULL DEFAULT 0,
  bonus         INTEGER NOT NULL DEFAULT 0,
  time_ms       INTEGER NOT NULL DEFAULT 0,
  cleared       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (attempt_id, room_index)
);

CREATE TABLE IF NOT EXISTS answer_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id  INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  room_index  INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  question    TEXT,
  is_correct  INTEGER NOT NULL,
  time_ms     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS best_scores (
  student_id    INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  best_score    INTEGER NOT NULL DEFAULT 0,
  best_accuracy REAL NOT NULL DEFAULT 0,
  best_time_ms  INTEGER NOT NULL DEFAULT 0,
  attempts_used INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_rooms_attempt   ON room_results(attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answer_logs(attempt_id);
CREATE INDEX IF NOT EXISTS idx_answers_qid     ON answer_logs(question_id);
`;

const PG_SCHEMA = SQLITE_SCHEMA
  .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
  .replace(/datetime\('now'\)/g, 'to_char(now(), \'YYYY-MM-DD HH24:MI:SS\')')
  .replace(/REAL/g, 'DOUBLE PRECISION');

async function migrate() {
  const db = getDb();
  await db.exec(db.dialect === 'postgres' ? PG_SCHEMA : SQLITE_SCHEMA);

  await syncAdminPassword(db);
  return db;
}

/**
 * Админ паролін bcrypt hash ретінде сақтау / жаңарту.
 *
 * Маңызды: hash дерекқорда сақталады, ал дерекқор деплойлар арасында
 * өмір сүреді. Сондықтан ADMIN_PASSWORD орта айнымалысы өзгерсе, hash
 * автоматты жаңартылады — әйтпесе пароль ұмытылса, панельге кіру мүмкін
 * болмай қалар еді.
 *
 * Панель арқылы қойылған пароль (ADMIN_PASSWORD берілмеген жағдайда)
 * өзгеріссіз қалады.
 */
async function syncAdminPassword(db) {
  const row = await db.one('SELECT value FROM settings WHERE key = $1', ['admin_password_hash']);
  const envPassword = String(process.env.ADMIN_PASSWORD || '').trim();
  const envHash = String(config.admin.passwordHash || '').trim();

  // 1) Алғаш рет — hash жасаймыз
  if (!row) {
    const hash = envHash || bcrypt.hashSync(config.admin.password, config.admin.bcryptRounds);
    await db.run('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_password_hash', hash]);
    console.log('[ADMIN] Пароль hash-і құрылды.');
    return;
  }

  // 2) ADMIN_PASSWORD_HASH тікелей берілсе — соны қолданамыз
  if (envHash && envHash !== row.value) {
    await db.run('UPDATE settings SET value = $1 WHERE key = $2', [envHash, 'admin_password_hash']);
    console.log('[ADMIN] Пароль hash-і ADMIN_PASSWORD_HASH мәнінен жаңартылды.');
    return;
  }

  // 3) ADMIN_PASSWORD берілген және сақталған hash-пен сәйкес келмесе — жаңартамыз
  if (envPassword && !bcrypt.compareSync(envPassword, row.value)) {
    const hash = bcrypt.hashSync(envPassword, config.admin.bcryptRounds);
    await db.run('UPDATE settings SET value = $1 WHERE key = $2', [hash, 'admin_password_hash']);
    console.log('[ADMIN] Пароль ADMIN_PASSWORD орта айнымалысынан жаңартылды.');
  }
}

module.exports = { migrate, SQLITE_SCHEMA };
