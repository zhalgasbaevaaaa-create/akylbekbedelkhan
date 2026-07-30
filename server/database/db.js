'use strict';
/**
 * Дерекқор адаптері.
 *  - SQLite (әдепкі)  : better-sqlite3
 *  - PostgreSQL       : DB_DRIVER=postgres + DATABASE_URL (pg пакеті қажет)
 *
 * Барлық сұраныстар параметрленген (SQL Injection-ден қорғау).
 * API: query(sql, params) -> rows, run(sql, params) -> {changes, lastId}, one(...)
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let adapter = null;

/* ---------------------------- SQLite ---------------------------- */

function createSqliteAdapter() {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(config.db.file), { recursive: true });
  const db = new Database(config.db.file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // SQLite-тің кірістірілген LOWER() тек ASCII қолдайды.
  // Кириллица/қазақ әріптері үшін Unicode-ты дұрыс өңдейтін нұсқасын тіркейміз.
  db.function('lower', { deterministic: true, varargs: false },
    (value) => (value == null ? null : String(value).toLowerCase()));

  // $1, $2 -> ? (Postgres синтаксисімен үйлесімділік)
  const conv = (sql) => sql.replace(/\$(\d+)/g, '?');

  return {
    dialect: 'sqlite',
    async query(sql, params = []) {
      return db.prepare(conv(sql)).all(params);
    },
    async one(sql, params = []) {
      return db.prepare(conv(sql)).get(params) || null;
    },
    async run(sql, params = []) {
      const info = db.prepare(conv(sql)).run(params);
      return { changes: info.changes, lastId: info.lastInsertRowid };
    },
    async exec(sql) {
      db.exec(sql);
    },
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const res = await fn();
        db.exec('COMMIT');
        return res;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    close() {
      db.close();
    },
  };
}

/* --------------------------- PostgreSQL -------------------------- */

function createPostgresAdapter() {
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (err) {
    throw new Error('PostgreSQL үшін `npm i pg` орнатыңыз немесе DB_DRIVER=sqlite қойыңыз.');
  }
  const pool = new Pool({ connectionString: config.db.url });

  return {
    dialect: 'postgres',
    async query(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows;
    },
    async one(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows[0] || null;
    },
    async run(sql, params = []) {
      const res = await pool.query(sql, params);
      return { changes: res.rowCount, lastId: res.rows[0] ? res.rows[0].id : null };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const res = await fn();
        await client.query('COMMIT');
        return res;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function getDb() {
  if (!adapter) {
    adapter = config.db.driver === 'postgres' ? createPostgresAdapter() : createSqliteAdapter();
  }
  return adapter;
}

module.exports = { getDb };
