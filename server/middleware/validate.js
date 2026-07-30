'use strict';
const { validationResult } = require('express-validator');

/** XSS қорғанысы: қауіпті таңбаларды тазарту */
function sanitizeString(value, maxLength = 200) {
  return String(value == null ? '' : value)
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Енгізілген деректер дұрыс емес.',
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  return next();
}

module.exports = { sanitizeString, handleValidation };
