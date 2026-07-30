'use strict';
const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const ctrl = require('../controllers/gameController');
const { requirePlayer } = require('../middleware/auth');
const { handleValidation } = require('../middleware/validate');

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Тым көп сұраныс. Кейінірек қайталаңыз.' },
});

const NAME_RULE = (field, label, max = 60) => body(field)
  .trim()
  .isLength({ min: 2, max })
  .withMessage(`${label}: 2-${max} таңба болуы керек.`)
  .matches(/^[\p{L}\p{N}\s.'’\-№()]+$/u)
  .withMessage(`${label}: тек әріптер мен сандар рұқсат етілген.`);

router.post(
  '/register',
  registerLimiter,
  [
    NAME_RULE('firstName', 'Аты'),
    NAME_RULE('lastName', 'Тегі'),
    NAME_RULE('group', 'Тобы', 40),
    NAME_RULE('institution', 'Оқу орны', 120),
  ],
  handleValidation,
  ctrl.register,
);

router.get('/tasks', ctrl.getTasks);
router.get('/me', requirePlayer, ctrl.myStatus);

router.post(
  '/attempt/start',
  requirePlayer,
  [body('characterId').optional().isString().isLength({ max: 40 })],
  handleValidation,
  ctrl.startAttempt,
);

router.post(
  '/answer',
  requirePlayer,
  [
    body('attemptId').isInt({ min: 1 }),
    body('roomIndex').isInt({ min: 1, max: 50 }),
    body('stageId').isString().isLength({ min: 1, max: 40 }),
    body('itemId').isString().isLength({ min: 1, max: 40 }),
    body('timeMs').optional().isInt({ min: 0, max: 3600000 }),
  ],
  handleValidation,
  ctrl.checkAnswer,
);

router.post(
  '/room/complete',
  requirePlayer,
  [
    body('attemptId').isInt({ min: 1 }),
    body('roomIndex').isInt({ min: 1, max: 50 }),
    body('heartsLeft').isInt({ min: 0, max: 10 }),
    body('timeMs').isInt({ min: 0, max: 7200000 }),
    body('cleared').isBoolean(),
  ],
  handleValidation,
  ctrl.completeRoom,
);

router.post(
  '/attempt/finish',
  requirePlayer,
  [
    body('attemptId').isInt({ min: 1 }),
    body('status').isIn(['finished', 'failed']),
  ],
  handleValidation,
  ctrl.finishAttempt,
);

module.exports = router;
