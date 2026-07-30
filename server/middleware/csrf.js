'use strict';
/**
 * Қарапайым, тәуелсіз CSRF қорғанысы (double submit cookie).
 * GET /api/csrf-token арқылы токен алынады, ол cookie-ге де жазылады.
 * Күй өзгертетін сұраныстарда X-CSRF-Token тақырыбы cookie-мен сәйкес болуы керек.
 */
const crypto = require('crypto');

const COOKIE = 'csrf_token';
const HEADER = 'x-csrf-token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function issue(req, res) {
  let token = req.cookies && req.cookies[COOKIE];
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
    });
  }
  return token;
}

function protect(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const cookieToken = req.cookies && req.cookies[COOKIE];
  const headerToken = req.get(HEADER);
  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'CSRF токені жоқ.' });
  }
  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'CSRF токені жарамсыз.' });
  }
  return next();
}

module.exports = { issue, protect, COOKIE, HEADER };
