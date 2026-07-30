'use strict';
const { getDb } = require('../database/db');
const config = require('../config');

/** Студентті табу немесе құру (аты+тегі+тобы+оқу орны бойынша бірегей) */
async function findOrCreate({ firstName, lastName, group, institution }) {
  const db = getDb();
  const found = await db.one(
    `SELECT * FROM students
      WHERE first_name = $1 AND last_name = $2 AND student_group = $3 AND institution = $4`,
    [firstName, lastName, group, institution],
  );
  if (found) return found;

  await db.run(
    `INSERT INTO students (first_name, last_name, student_group, institution)
     VALUES ($1, $2, $3, $4)`,
    [firstName, lastName, group, institution],
  );
  return db.one(
    `SELECT * FROM students
      WHERE first_name = $1 AND last_name = $2 AND student_group = $3 AND institution = $4`,
    [firstName, lastName, group, institution],
  );
}

const findById = (id) => getDb().one('SELECT * FROM students WHERE id = $1', [id]);

/** Пайдаланылған әрекеттер саны (аяқталған + жүріп жатқан) */
async function attemptsUsed(studentId) {
  const row = await getDb().one(
    `SELECT COUNT(*) AS c FROM attempts
      WHERE student_id = $1 AND status IN ('finished', 'failed')`,
    [studentId],
  );
  return Number(row ? row.c : 0);
}

async function canPlay(studentId) {
  const used = await attemptsUsed(studentId);
  return { allowed: used < config.game.maxAttempts, used, max: config.game.maxAttempts };
}

/** Best Score-ты 3 әрекеттен кейін автоматты есептеу */
async function recalcBest(studentId) {
  const db = getDb();
  const row = await db.one(
    `SELECT COALESCE(MAX(score), 0)                        AS best_score,
            COALESCE(MAX(accuracy), 0)                     AS best_accuracy,
            COALESCE(MIN(NULLIF(total_time_ms, 0)), 0)     AS best_time_ms,
            COUNT(*)                                       AS attempts_used
       FROM attempts
      WHERE student_id = $1 AND status IN ('finished', 'failed')`,
    [studentId],
  );
  const exists = await db.one('SELECT student_id FROM best_scores WHERE student_id = $1', [studentId]);
  const params = [
    Number(row.best_score) || 0,
    Number(row.best_accuracy) || 0,
    Number(row.best_time_ms) || 0,
    Number(row.attempts_used) || 0,
    studentId,
  ];
  if (exists) {
    await db.run(
      `UPDATE best_scores
          SET best_score = $1, best_accuracy = $2, best_time_ms = $3, attempts_used = $4
        WHERE student_id = $5`,
      params,
    );
  } else {
    await db.run(
      `INSERT INTO best_scores (best_score, best_accuracy, best_time_ms, attempts_used, student_id)
       VALUES ($1, $2, $3, $4, $5)`,
      params,
    );
  }
  return db.one('SELECT * FROM best_scores WHERE student_id = $1', [studentId]);
}

module.exports = { findOrCreate, findById, attemptsUsed, canPlay, recalcBest };
