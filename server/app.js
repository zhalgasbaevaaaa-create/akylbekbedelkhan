'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const csrf = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const gameRoutes = require('./routes/gameRoutes');
const adminRoutes = require('./routes/adminRoutes');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  /* ------------------------- Қауіпсіздік ------------------------- */
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cors({
    origin: config.security.corsOrigins.includes('*') ? true : config.security.corsOrigins,
    credentials: true,
  }));

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  if (config.env !== 'test') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  app.use('/api', rateLimit({
    windowMs: config.security.rateLimitWindowMs,
    max: config.security.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Сұраныс лимиті асып кетті.' },
  }));

  /* ---------------------------- CSRF ----------------------------- */
  app.get('/api/csrf-token', (req, res) => res.json({ csrfToken: csrf.issue(req, res) }));
  app.use('/api', csrf.protect);

  /* --------------------------- Routes ---------------------------- */
  app.get('/api/health', (req, res) => res.json({
    status: 'ok', env: config.env, time: new Date().toISOString(),
  }));
  app.use('/api/game', gameRoutes);
  app.use('/api/admin', adminRoutes);

  /* -------------------------- Статика ---------------------------- */
  // /admin статикалық қалтаға дейін өңделеді (301 redirect болмас үшін)
  app.get(['/admin', '/admin/'], (req, res) =>
    res.sendFile(path.join(config.clientDir, 'admin', 'index.html')));
  app.get('/', (req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));

  /*
   * Кэш стратегиясы.
   *
   * Ресурстар (сурет, аудио) сирек өзгереді — оларды ұзақ кэштеуге болады.
   * Ал HTML/CSS/JS әр деплойда өзгеруі мүмкін: оларды ұзақ кэштесек,
   * студенттердің браузері ескі нұсқаны ұстап қалады да, түзетулер
   * көрінбейді. Сондықтан код файлдары әрқашан серверден тексеріледі
   * (no-cache = ETag арқылы жылдам валидация, өзгермесе 304 қайтады).
   */
  const LONG_CACHE = /\.(png|jpe?g|gif|webp|svg|ico|ogg|mp3|wav|woff2?|ttf|otf)$/i;

  app.use(express.static(config.clientDir, {
    redirect: false,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (config.env !== 'production') {
        res.setHeader('Cache-Control', 'no-store');
        return;
      }
      if (LONG_CACHE.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      } else {
        // HTML, CSS, JS — деплойдан кейін бірден жаңарады
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));

  app.use('/api', notFound);
  app.use((req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
