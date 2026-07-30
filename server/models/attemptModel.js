'use strict';
const { getDb } = require('../database/db');

async function create(studentId, attemptNumber, characterId) {
  const db = getDb();
  await db.run(
    `INSERT INTO attempts (student_id, attempt_number, character_id, status, play_date, play_time)
     VALUES ($1, $2, $3, 'in_progress', $4, $5)`,
    [
      studentId,
      attemptNumber,
      characterId || null,
      new Date().toISOString().slice(0, 10),
      new Date().toISOString().slice(11, 19),
    ],
  );
  return db.one(
    'SELECT * FROM attempts WHERE student_id = $1 AND attempt_number = $2',
    [studentId, attemptNumber],
  );
}

const findById = (id) => getDb().one('SELECT * FROM attempts WHERE id = $1', [id]);

const listByStudent = (studentId) => getDb().query(
  'SELECT * FROM attempts WHERE student_id = $1 ORDER BY attempt_number ASC',
  [studentId],
);

async function saveRoomResult(attemptId, r) {
  const db = getDb();
  const existing = await db.one(
    'SELECT id FROM room_results WHERE attempt_id = $1 AND room_index = $2',
    [attemptId, r.roomIndex],
  );
  const params = [
    r.roomTitle || null, r.roomType || null, r.score || 0, r.correct || 0, r.wrong || 0,
    r.heartsLeft || 0, r.bonus || 0, r.timeMs || 0, r.cleared ? 1 : 0,
  ];
  if (existing) {
    await db.run(
      `UPDATE room_results SET room_title=$1, room_type=$2, score=$3, correct_count=$4,
              wrong_count=$5, hearts_left=$6, bonus=$7, time_ms=$8, cleared=$9
        WHERE id = $10`,
      [...params, existing.id],
    );
  } else {
    await db.run(
      `INSERT INTO room_results
        (room_title, room_type, score, correct_count, wrong_count, hearts_left, bonus, time_ms, cleared, attempt_id, room_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [...params, attemptId, r.roomIndex],
    );
  }
}

async function logAnswers(attemptId, roomIndex, answers) {
  const db = getDb();
  for (const a of answers) {
    await db.run(
      `INSERT INTO answer_logs (attempt_id, room_index, question_id, question, is_correct, time_ms)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [attemptId, roomIndex, String(a.id), a.question || null, a.correct ? 1 : 0, a.timeMs || 0],
    );
  }
}

const roomResults = (attemptId) => getDb().query(
  'SELECT * FROM room_results WHERE attempt_id = $1 ORDER BY room_index ASC',
  [attemptId],
);

async function finalize(attemptId, data) {
  await getDb().run(
    `UPDATE attempts
        SET status=$1, score=$2, correct_count=$3, wrong_count=$4, accuracy=$5,
            total_time_ms=$6, rooms_cleared=$7, stopped_room=$8,
            finished_at=$9, play_date=$10, play_time=$11
      WHERE id = $12`,
    [
      data.status,
      data.score, data.correct, data.wrong, data.accuracy,
      data.totalTimeMs, data.roomsCleared, data.stoppedRoom || null,
      new Date().toISOString(),
      new Date().toISOString().slice(0, 10),
      new Date().toISOString().slice(11, 19),
      attemptId,
    ],
  );
  return findById(attemptId);
}

/** Аяқталмай қалған әрекеттерді жою (қайта бастау үшін) */
const dropUnfinished = (studentId) => getDb().run(
  "DELETE FROM attempts WHERE student_id = $1 AND status = 'in_progress'",
  [studentId],
);

module.exports = {
  create, findById, listByStudent, saveRoomResult, logAnswers,
  roomResults, finalize, dropUnfinished,
};
