'use strict';

function notFound(req, res) {
  res.status(404).json({ error: 'Сұралған ресурс табылмады.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error('[SERVER ERROR]', err);
  res.status(status).json({
    error: err.expose === false || status >= 500
      ? 'Серверде қате шықты. Кейінірек қайталап көріңіз.'
      : err.message,
    code: err.code || undefined,
  });
}

module.exports = { notFound, errorHandler };
