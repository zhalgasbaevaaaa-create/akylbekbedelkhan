'use strict';
require('dotenv').config();

const path = require('path');

const root = path.resolve(__dirname, '..', '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',

  root,
  clientDir: path.join(root, 'client'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(root, 'server', 'uploads'),
  dataDir: process.env.DATA_DIR || path.join(root, 'server', 'database', 'data'),

  db: {
    driver: (process.env.DB_DRIVER || 'sqlite').toLowerCase(), // sqlite | postgres
    file: process.env.SQLITE_FILE || path.join(root, 'server', 'database', 'data', 'game.db'),
    url: process.env.DATABASE_URL || '',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'kz-history-rpg-dev-secret-change-me',
    playerExpiresIn: process.env.JWT_PLAYER_TTL || '6h',
    adminExpiresIn: process.env.JWT_ADMIN_TTL || '8h',
  },

  admin: {
    // Әдепкі пароль .env арқылы ауыстырылады. bcrypt hash дерекқорда сақталады.
    password: process.env.ADMIN_PASSWORD || 'Akilbek8080',
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  },

  game: {
    maxAttempts: Number(process.env.MAX_ATTEMPTS || 3),
    hearts: Number(process.env.HEARTS_PER_ROOM || 5),
    bonusNoHeartLost: Number(process.env.BONUS_PERFECT_HEARTS || 5),
    bonusAllCorrect: Number(process.env.BONUS_ALL_CORRECT || 10),
  },

  googleSheets: {
    enabled: String(process.env.GOOGLE_SHEETS_ENABLED || 'false') === 'true',
    spreadsheetId: process.env.GOOGLE_SHEETS_ID || '',
    credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  },

  security: {
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 600),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  },
};

module.exports = config;
