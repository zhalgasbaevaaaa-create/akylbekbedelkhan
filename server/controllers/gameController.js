'use strict';
/**
 * Ойын логикасы толығымен серверде тексеріледі:
 *   - 3 әрекет шектеуі
 *   - жүрек жүйесі (5 жан)
 *   - ұпай, бонус, дәлдік, уақыт
 *   - Best Score автоматты есептеу
 */
const config = require('../config');
const auth = require('../middleware/auth');
const { sanitizeString } = require('../middleware/validate');
const studentModel = require('../models/studentModel');
const attemptModel = require('../models/attemptModel');
const taskService = require('../services/taskService');
const sheets = require('../services/googleSheets');
const { getDb } = require('../database/db');

const LIMIT_MESSAGE = 'Сіз бұл ойынды орындау лимитін аяқтадыңыз.';

/* --------------------------- Тіркелу --------------------------- */

async function register(req, res, next) {
  try {
    const firstName = sanitizeString(req.body.firstName, 60);
    const lastName = sanitizeString(req.body.lastName, 60);
    const group = sanitizeString(req.body.group, 40);
    const institution = sanitizeString(req.body.institution, 120);

    const student = await studentModel.findOrCreate({ firstName, lastName, group, institution });
    const status = await studentModel.canPlay(student.id);

    if (!status.allowed) {
      return res.status(403).json({
        error: LIMIT_MESSAGE,
        code: 'ATTEMPT_LIMIT',
        attemptsUsed: status.used,
        maxAttempts: status.max,
      });
    }

    const token = auth.sign({ role: 'player', studentId: student.id }, config.jwt.playerExpiresIn);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production',
      maxAge: 6 * 60 * 60 * 1000,
    });

    return res.json({
      token,
      student: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        group: student.student_group,
        institution: student.institution,
      },
      attemptsUsed: status.used,
      maxAttempts: status.max,
      attemptsLeft: status.max - status.used,
    });
  } catch (err) {
    return next(err);
  }
}

/* ----------------------- Әрекетті бастау ----------------------- */

async function startAttempt(req, res, next) {
  try {
    const studentId = req.player.studentId;
    const status = await studentModel.canPlay(studentId);
    if (!status.allowed) {
      return res.status(403).json({ error: LIMIT_MESSAGE, code: 'ATTEMPT_LIMIT' });
    }
    await attemptModel.dropUnfinished(studentId);

    const characterId = sanitizeString(req.body.characterId || 'batyr_1', 40);
    const attempt = await attemptModel.create(studentId, status.used + 1, characterId);
    const tasks = await taskService.getTasks();

    return res.json({
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      attemptsLeft: status.max - status.used - 1,
      hearts: config.game.hearts,
      tasks: taskService.sanitize(tasks),
    });
  } catch (err) {
    return next(err);
  }
}

/* --------------------- Жауапты тексеру ------------------------- */

async function checkAnswer(req, res, next) {
  try {
    const { attemptId, roomIndex, stageId, itemId, value, timeMs } = req.body;
    const attempt = await attemptModel.findById(Number(attemptId));
    if (!attempt || attempt.student_id !== req.player.studentId) {
      return res.status(404).json({ error: 'Әрекет табылмады.' });
    }
    if (attempt.status !== 'in_progress') {
      return res.status(409).json({ error: 'Бұл әрекет аяқталған.' });
    }

    const tasks = await taskService.getTasks();
    const room = taskService.findRoom(tasks, roomIndex);
    if (!room) return res.status(404).json({ error: 'Бөлме табылмады.' });

    const result = taskService.checkAnswer(room, String(stageId), String(itemId), value);
    if (!result.ok) return res.status(400).json({ error: 'Тапсырма табылмады.' });

    await attemptModel.logAnswers(attempt.id, room.index, [{
      id: itemId,
      question: result.item.question || result.item.left || result.item.date || result.item.fact,
      correct: result.correct,
      timeMs: Number(timeMs) || 0,
    }]);

    return res.json({
      correct: result.correct,
      expected: result.correct ? undefined : result.expected,
      points: result.correct ? 1 : 0,
    });
  } catch (err) {
    return next(err);
  }
}

/* --------------------- Бөлмені аяқтау -------------------------- */

async function completeRoom(req, res, next) {
  try {
    const { attemptId, roomIndex, heartsLeft, timeMs, cleared } = req.body;
    const attempt = await attemptModel.findById(Number(attemptId));
    if (!attempt || attempt.student_id !== req.player.studentId) {
      return res.status(404).json({ error: 'Әрекет табылмады.' });
    }
    const tasks = await taskService.getTasks();
    const room = taskService.findRoom(tasks, roomIndex);
    if (!room) return res.status(404).json({ error: 'Бөлме табылмады.' });

    // Ұпайды сервердегі жауап журналынан есептеу (клиентке сенбейміз)
    const db = getDb();
    const stat = await db.one(
      `SELECT SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS wrong
         FROM answer_logs WHERE attempt_id = $1 AND room_index = $2`,
      [attempt.id, room.index],
    );
    const correct = Number(stat.correct || 0);
    const wrong = Number(stat.wrong || 0);
    const hearts = Math.max(0, Math.min(config.game.hearts, Number(heartsLeft) || 0));

    let bonus = 0;
    const isCleared = Boolean(cleared) && hearts > 0;
    if (isCleared) {
      if (hearts === config.game.hearts) bonus += config.game.bonusNoHeartLost;
      if (correct === room.total && wrong === 0) bonus += config.game.bonusAllCorrect;
    }
    const score = correct + bonus;

    await attemptModel.saveRoomResult(attempt.id, {
      roomIndex: room.index,
      roomTitle: room.title,
      roomType: room.type,
      score,
      correct,
      wrong,
      heartsLeft: hearts,
      bonus,
      timeMs: Number(timeMs) || 0,
      cleared: isCleared,
    });

    return res.json({ roomIndex: room.index, score, correct, wrong, bonus, heartsLeft: hearts, cleared: isCleared });
  } catch (err) {
    return next(err);
  }
}

/* ---------------------- Ойынды аяқтау -------------------------- */

async function finishAttempt(req, res, next) {
  try {
    const { attemptId, status } = req.body;
    const attempt = await attemptModel.findById(Number(attemptId));
    if (!attempt || attempt.student_id !== req.player.studentId) {
      return res.status(404).json({ error: 'Әрекет табылмады.' });
    }
    if (attempt.status !== 'in_progress') {
      return res.status(409).json({ error: 'Бұл әрекет аяқталған.' });
    }

    const rooms = await attemptModel.roomResults(attempt.id);
    const tasks = await taskService.getTasks();

    const totals = rooms.reduce((acc, r) => ({
      score: acc.score + Number(r.score),
      correct: acc.correct + Number(r.correct_count),
      wrong: acc.wrong + Number(r.wrong_count),
      timeMs: acc.timeMs + Number(r.time_ms),
      cleared: acc.cleared + (r.cleared ? 1 : 0),
    }), { score: 0, correct: 0, wrong: 0, timeMs: 0, cleared: 0 });

    const answered = totals.correct + totals.wrong;
    const accuracy = answered ? (totals.correct / answered) * 100 : 0;
    const finalStatus = status === 'failed' ? 'failed' : 'finished';
    const stoppedRoom = finalStatus === 'failed'
      ? (rooms.length ? Math.max(...rooms.map((r) => r.room_index)) : 1)
      : null;

    const finished = await attemptModel.finalize(attempt.id, {
      status: finalStatus,
      score: totals.score,
      correct: totals.correct,
      wrong: totals.wrong,
      accuracy: Number(accuracy.toFixed(2)),
      totalTimeMs: totals.timeMs,
      roomsCleared: totals.cleared,
      stoppedRoom,
    });

    const best = await studentModel.recalcBest(attempt.student_id);
    const student = await studentModel.findById(attempt.student_id);
    const used = await studentModel.attemptsUsed(attempt.student_id);

    // Google Sheets (OPTIONAL) — фонда, қате болса ойын бұзылмайды
    sheets.appendResult([
      student.first_name, student.last_name, student.student_group, student.institution,
      finished.attempt_number, totals.score, Number(accuracy.toFixed(1)),
      sheets.formatMs(totals.timeMs), new Date().toISOString().slice(0, 19).replace('T', ' '),
    ]).catch((e) => console.warn('[Sheets] синхрондау сәтсіз:', e.message));

    return res.json({
      status: finalStatus,
      attemptNumber: finished.attempt_number,
      attemptsUsed: used,
      attemptsLeft: Math.max(0, config.game.maxAttempts - used),
      totalScore: totals.score,
      correct: totals.correct,
      wrong: totals.wrong,
      accuracy: Number(accuracy.toFixed(2)),
      totalTimeMs: totals.timeMs,
      roomsCleared: totals.cleared,
      roomCount: tasks.roomCount,
      bestScore: Number(best.best_score),
      rooms: rooms.map((r) => ({
        index: r.room_index,
        title: r.room_title,
        type: r.room_type,
        score: Number(r.score),
        correct: Number(r.correct_count),
        wrong: Number(r.wrong_count),
        bonus: Number(r.bonus),
        heartsLeft: Number(r.hearts_left),
        timeMs: Number(r.time_ms),
        cleared: Boolean(r.cleared),
      })),
    });
  } catch (err) {
    return next(err);
  }
}

/* ------------------------ Тапсырмалар -------------------------- */

async function getTasks(req, res, next) {
  try {
    const tasks = await taskService.getTasks();
    return res.json(taskService.sanitize(tasks));
  } catch (err) {
    return next(err);
  }
}

async function myStatus(req, res, next) {
  try {
    const status = await studentModel.canPlay(req.player.studentId);
    const attempts = await attemptModel.listByStudent(req.player.studentId);
    return res.json({
      ...status,
      attemptsLeft: Math.max(0, status.max - status.used),
      attempts: attempts.map((a) => ({
        number: a.attempt_number, score: a.score, status: a.status, date: a.play_date,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  register, startAttempt, checkAnswer, completeRoom, finishAttempt, getTasks, myStatus,
  LIMIT_MESSAGE,
};
