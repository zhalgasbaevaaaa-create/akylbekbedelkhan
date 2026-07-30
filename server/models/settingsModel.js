'use strict';
const { getDb } = require('../database/db');

async function get(key) {
  const row = await getDb().one('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : null;
}

async function set(key, value) {
  const db = getDb();
  const existing = await db.one('SELECT key FROM settings WHERE key = $1', [key]);
  if (existing) {
    await db.run('UPDATE settings SET value = $1 WHERE key = $2', [String(value), key]);
  } else {
    await db.run('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, String(value)]);
  }
  return value;
}

async function getJson(key, fallback = null) {
  const raw = await get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

const setJson = (key, obj) => set(key, JSON.stringify(obj));

module.exports = { get, set, getJson, setJson };
