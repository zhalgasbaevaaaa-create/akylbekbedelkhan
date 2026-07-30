'use strict';
/**
 * OPTIONAL Google Sheets интеграциясы.
 * Admin баптауында Service Account JSON + Spreadsheet ID енгізілсе,
 * нәтижелер автоматты түрде Google Sheets-ке жазылады.
 * Баптау жоқ болса — жоба қалыпты жұмысын жалғастырады.
 */
const settings = require('../models/settingsModel');
const config = require('../config');

const HEADERS = [
  'Аты', 'Тегі', 'Тобы', 'Оқу орны', '1-әрекет', '2-әрекет', '3-әрекет',
  'Best Score', 'Дәлдік (%)', 'Жалпы уақыт', 'Күні',
];

async function getSettings() {
  const stored = await settings.getJson('google_sheets', null);
  if (stored && stored.enabled) return stored;
  if (config.googleSheets.enabled && config.googleSheets.spreadsheetId) {
    return {
      enabled: true,
      spreadsheetId: config.googleSheets.spreadsheetId,
      credentials: config.googleSheets.credentials,
      sheetName: 'Нәтижелер',
    };
  }
  return { enabled: false };
}

async function saveSettings(next) {
  const clean = {
    enabled: Boolean(next.enabled),
    spreadsheetId: String(next.spreadsheetId || '').trim(),
    credentials: String(next.credentials || '').trim(),
    sheetName: String(next.sheetName || 'Нәтижелер').trim(),
  };
  await settings.setJson('google_sheets', clean);
  return { ...clean, credentials: clean.credentials ? '***' : '' };
}

async function getClient(cfg) {
  const { google } = require('googleapis');
  let creds;
  try {
    creds = typeof cfg.credentials === 'string' ? JSON.parse(cfg.credentials) : cfg.credentials;
  } catch (err) {
    throw new Error('Google Service Account JSON форматы қате.');
  }
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

/** Барлық нәтижелерді Sheets-ке синхрондау */
async function syncAll(rows) {
  const cfg = await getSettings();
  if (!cfg.enabled || !cfg.spreadsheetId || !cfg.credentials) {
    return { synced: false, reason: 'DISABLED' };
  }
  const sheets = await getClient(cfg);
  const values = [HEADERS, ...rows.map((r) => [
    r.first_name, r.last_name, r.student_group, r.institution,
    r.attempt1 ?? '', r.attempt2 ?? '', r.attempt3 ?? '',
    r.best_score ?? 0, Number(r.best_accuracy || 0).toFixed(1),
    formatMs(r.best_time_ms), r.last_played || '',
  ])];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.sheetName}!A1:Z10000`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  return { synced: true, rows: rows.length };
}

/** Бір нәтижені қосу (ойын аяқталғанда, фонда шақырылады) */
async function appendResult(row) {
  const cfg = await getSettings();
  if (!cfg.enabled || !cfg.spreadsheetId || !cfg.credentials) {
    return { synced: false, reason: 'DISABLED' };
  }
  const sheets = await getClient(cfg);
  await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${cfg.sheetName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return { synced: true };
}

function formatMs(ms) {
  const total = Math.round(Number(ms || 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

module.exports = { getSettings, saveSettings, syncAll, appendResult, formatMs, HEADERS };
