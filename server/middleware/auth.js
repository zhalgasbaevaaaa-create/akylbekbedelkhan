'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config');

function sign(payload, expiresIn) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn });
}

function verify(token) {
  return jwt.verify(token, config.jwt.secret);
}

function extract(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  if (req.cookies && req.cookies.admin_token) return req.cookies.admin_token;
  return null;
}

function requirePlayer(req, res, next) {
  const token = extract(req);
  if (!token) return res.status(401).json({ error: 'Авторизация қажет.' });
  try {
    const data = verify(token);
    if (data.role !== 'player') return res.status(403).json({ error: 'Рұқсат жоқ.' });
    req.player = data;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Сессия мерзімі бітті. Қайта кіріңіз.' });
  }
}

function requireAdmin(req, res, next) {
  const token = (req.cookies && req.cookies.admin_token) || extract(req);
  if (!token) return res.status(401).json({ error: 'Админ авторизациясы қажет.' });
  try {
    const data = verify(token);
    if (data.role !== 'admin') return res.status(403).json({ error: 'Рұқсат жоқ.' });
    req.admin = data;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Админ сессиясы аяқталды.' });
  }
}

module.exports = { sign, verify, requirePlayer, requireAdmin };
