'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const config = require('../config');
const ctrl = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Кіру әрекеті тым көп. 15 минуттан кейін қайталаңыз.' },
});

fs.mkdirSync(config.uploadsDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadsDir),
    // Жүктелген файл әрқашан tasks.pdf болып сақталады -> автоматты жаңару
    filename: (req, file, cb) => cb(null, 'tasks.pdf'),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf'
      && path.extname(file.originalname).toLowerCase() === '.pdf';
    cb(ok ? null : new Error('Тек PDF файл жүктеуге болады.'), ok);
  },
});

router.post(
  '/login',
  loginLimiter,
  [body('password').isString().isLength({ min: 4, max: 128 })],
  handleValidation,
  ctrl.login,
);
router.post('/logout', requireAdmin, ctrl.logout);
router.get('/session', requireAdmin, (req, res) => res.json({ ok: true, role: 'admin' }));

router.post(
  '/password',
  requireAdmin,
  [body('currentPassword').isString(), body('newPassword').isString().isLength({ min: 8, max: 128 })],
  handleValidation,
  ctrl.changePassword,
);

router.get('/students', requireAdmin, ctrl.listStudents);
router.get('/students/:id', requireAdmin, ctrl.studentCard);
router.get('/stats', requireAdmin, ctrl.stats);

router.get('/export/excel', requireAdmin, ctrl.exportExcel);
router.get('/export/pdf', requireAdmin, ctrl.exportPdf);

router.get('/tasks', requireAdmin, ctrl.tasksInfo);
router.post('/tasks/upload', requireAdmin, upload.single('pdf'), ctrl.uploadPdf);

router.get('/sheets', requireAdmin, ctrl.getSheetsSettings);
router.post('/sheets', requireAdmin, ctrl.saveSheetsSettings);
router.post('/sheets/sync', requireAdmin, ctrl.syncSheets);

module.exports = router;
