'use strict';
const bcrypt = require('bcryptjs');
const config = require('../config');
const auth = require('../middleware/auth');
const settings = require('../models/settingsModel');
const taskService = require('../services/taskService');
const sheets = require('../services/googleSheets');
const { getDb } = require('../database/db');
const { sanitizeString } = require('../middleware/validate');

/* ------------------------------ Кіру ------------------------------ */

async function login(req, res, next) {
  try {
    const password = String(req.body.password || '');
    const hash = await settings.get('admin_password_hash');
    const valid = hash ? await bcrypt.compare(password, hash) : false;
    if (!valid) {
      return res.status(401).json({ error: 'Пароль қате.' });
    }
    const token = auth.sign({ role: 'admin' }, config.jwt.adminExpiresIn);
    res.cookie('admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    });
    return res.json({ token, expiresIn: config.jwt.adminExpiresIn });
  } catch (err) {
    return next(err);
  }
}

function logout(req, res) {
  res.clearCookie('admin_token');
  res.json({ ok: true });
}

async function changePassword(req, res, next) {
  try {
    const current = String(req.body.currentPassword || '');
    const next_ = String(req.body.newPassword || '');
    if (next_.length < 8) {
      return res.status(400).json({ error: 'Жаңа пароль кемінде 8 таңба болуы керек.' });
    }
    const hash = await settings.get('admin_password_hash');
    if (!hash || !(await bcrypt.compare(current, hash))) {
      return res.status(401).json({ error: 'Ағымдағы пароль қате.' });
    }
    await settings.set('admin_password_hash', bcrypt.hashSync(next_, config.admin.bcryptRounds));
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

/* --------------------------- Студенттер --------------------------- */

const STUDENT_SQL = `
  SELECT s.id, s.first_name, s.last_name, s.student_group, s.institution, s.created_at,
         COALESCE(b.best_score, 0)     AS best_score,
         COALESCE(b.best_accuracy, 0)  AS best_accuracy,
         COALESCE(b.best_time_ms, 0)   AS best_time_ms,
         COALESCE(b.attempts_used, 0)  AS attempts_used,
         (SELECT score FROM attempts a WHERE a.student_id = s.id AND a.attempt_number = 1
            AND a.status <> 'in_progress') AS attempt1,
         (SELECT score FROM attempts a WHERE a.student_id = s.id AND a.attempt_number = 2
            AND a.status <> 'in_progress') AS attempt2,
         (SELECT score FROM attempts a WHERE a.student_id = s.id AND a.attempt_number = 3
            AND a.status <> 'in_progress') AS attempt3,
         (SELECT MAX(finished_at) FROM attempts a WHERE a.student_id = s.id) AS last_played
    FROM students s
    LEFT JOIN best_scores b ON b.student_id = s.id
`;

async function fetchStudents({ search = '', group = '', institution = '' } = {}) {
  const db = getDb();
  const where = [];
  const params = [];

  if (search) {
    const like = `%${search.toLowerCase()}%`;
    params.push(like, like, like);
    const n = params.length;
    where.push(`(LOWER(s.first_name) LIKE $${n - 2} OR LOWER(s.last_name) LIKE $${n - 1} OR LOWER(s.student_group) LIKE $${n})`);
  }
  if (group) {
    params.push(group);
    where.push(`s.student_group = $${params.length}`);
  }
  if (institution) {
    params.push(institution);
    where.push(`s.institution = $${params.length}`);
  }

  const sql = `${STUDENT_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY best_score DESC, best_time_ms ASC, s.last_name ASC`;
  return db.query(sql, params);
}

async function listStudents(req, res, next) {
  try {
    const rows = await fetchStudents({
      search: sanitizeString(req.query.search || '', 60),
      group: sanitizeString(req.query.group || '', 40),
      institution: sanitizeString(req.query.institution || '', 120),
    });
    return res.json({ total: rows.length, students: rows });
  } catch (err) {
    return next(err);
  }
}

async function studentCard(req, res, next) {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const student = await db.one(`${STUDENT_SQL} WHERE s.id = $1`, [id]);
    if (!student) return res.status(404).json({ error: 'Студент табылмады.' });

    const attempts = await db.query(
      'SELECT * FROM attempts WHERE student_id = $1 ORDER BY attempt_number ASC', [id],
    );
    for (const a of attempts) {
      a.rooms = await db.query(
        'SELECT * FROM room_results WHERE attempt_id = $1 ORDER BY room_index ASC', [a.id],
      );
    }
    return res.json({ student, attempts });
  } catch (err) {
    return next(err);
  }
}

/* --------------------------- Статистика --------------------------- */

async function stats(req, res, next) {
  try {
    const db = getDb();
    const totals = await db.one(`
      SELECT (SELECT COUNT(*) FROM students) AS student_count,
             (SELECT COUNT(*) FROM attempts WHERE status <> 'in_progress') AS attempt_count,
             (SELECT COALESCE(AVG(score), 0) FROM attempts WHERE status <> 'in_progress') AS avg_score,
             (SELECT COALESCE(AVG(accuracy), 0) FROM attempts WHERE status <> 'in_progress') AS avg_accuracy,
             (SELECT COALESCE(AVG(total_time_ms), 0) FROM attempts WHERE status <> 'in_progress') AS avg_time_ms
    `);

    const top10 = await db.query(`${STUDENT_SQL}
      WHERE COALESCE(b.best_score, 0) > 0
      ORDER BY best_score DESC, best_time_ms ASC LIMIT 10`);

    const rooms = await db.query(`
      SELECT room_index, MAX(room_title) AS title,
             COUNT(*) AS plays,
             SUM(CASE WHEN cleared = 1 THEN 1 ELSE 0 END) AS cleared_count,
             SUM(CASE WHEN cleared = 0 THEN 1 ELSE 0 END) AS stopped_count,
             AVG(score) AS avg_score, AVG(time_ms) AS avg_time_ms,
             SUM(correct_count) AS correct_total, SUM(wrong_count) AS wrong_total
        FROM room_results
       GROUP BY room_index ORDER BY room_index ASC`);

    const questions = await db.query(`
      SELECT question_id, room_index, MAX(question) AS question,
             SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_count,
             SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS wrong_count,
             COUNT(*) AS total
        FROM answer_logs
       GROUP BY question_id, room_index
       ORDER BY room_index ASC, wrong_count DESC`);

    const groups = await db.query(
      'SELECT student_group AS name, COUNT(*) AS c FROM students GROUP BY student_group ORDER BY name',
    );
    const institutions = await db.query(
      'SELECT institution AS name, COUNT(*) AS c FROM students GROUP BY institution ORDER BY name',
    );

    return res.json({
      totals: {
        students: Number(totals.student_count),
        attempts: Number(totals.attempt_count),
        avgScore: Number(Number(totals.avg_score).toFixed(2)),
        avgAccuracy: Number(Number(totals.avg_accuracy).toFixed(2)),
        avgTimeMs: Number(totals.avg_time_ms),
      },
      top10,
      rooms: rooms.map((r) => ({
        index: r.room_index,
        title: r.title,
        plays: Number(r.plays),
        cleared: Number(r.cleared_count),
        stopped: Number(r.stopped_count),
        avgScore: Number(Number(r.avg_score).toFixed(2)),
        avgTimeMs: Number(r.avg_time_ms),
        correct: Number(r.correct_total),
        wrong: Number(r.wrong_total),
      })),
      questions: questions.map((q) => ({
        id: q.question_id,
        roomIndex: q.room_index,
        question: q.question,
        correct: Number(q.correct_count),
        wrong: Number(q.wrong_count),
        total: Number(q.total),
        successRate: q.total ? Number(((q.correct_count / q.total) * 100).toFixed(1)) : 0,
      })),
      filters: { groups, institutions },
    });
  } catch (err) {
    return next(err);
  }
}

/* ---------------------------- Экспорт ----------------------------- */

async function exportExcel(req, res, next) {
  try {
    const XLSX = require('xlsx');
    const rows = await fetchStudents({});
    const data = rows.map((r, i) => ({
      '№': i + 1,
      'Аты': r.first_name,
      'Тегі': r.last_name,
      'Тобы': r.student_group,
      'Оқу орны': r.institution,
      '1-әрекет': r.attempt1 ?? '—',
      '2-әрекет': r.attempt2 ?? '—',
      '3-әрекет': r.attempt3 ?? '—',
      'Best Score': Number(r.best_score),
      'Accuracy (%)': Number(Number(r.best_accuracy).toFixed(1)),
      'Total Time': sheets.formatMs(r.best_time_ms),
      'Әрекет саны': Number(r.attempts_used),
      'Date': (r.last_played || '').slice(0, 19).replace('T', ' '),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 5 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 28 }, { wch: 10 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Нәтижелер');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="kz-history-results-${Date.now()}.xlsx"`);
    return res.send(buf);
  } catch (err) {
    return next(err);
  }
}

async function exportPdf(req, res, next) {
  try {
    const PDFDocument = require('pdfkit');
    const path = require('path');
    const fs = require('fs');
    const rows = await fetchStudents({});

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    // Кириллица үшін Unicode қаріп
    const fontCandidates = [
      path.join(config.root, 'client', 'assets', 'fonts', 'DejaVuSans.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ];
    const boldCandidates = [
      path.join(config.root, 'client', 'assets', 'fonts', 'DejaVuSans-Bold.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    ];
    const regular = fontCandidates.find((p) => fs.existsSync(p));
    const bold = boldCandidates.find((p) => fs.existsSync(p));
    if (regular) doc.registerFont('body', regular);
    if (bold) doc.registerFont('head', bold);
    const F = regular ? 'body' : 'Helvetica';
    const FB = bold ? 'head' : 'Helvetica-Bold';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kz-history-report-${Date.now()}.pdf"`);
    doc.pipe(res);

    doc.font(FB).fontSize(18).fillColor('#c9a227')
      .text('ҚАЗАҚСТАН ТАРИХЫ RPG — НӘТИЖЕЛЕР ЕСЕБІ', { align: 'center' });
    doc.moveDown(0.3);
    doc.font(F).fontSize(9).fillColor('#555')
      .text(`Есеп жасалған күні: ${new Date().toLocaleString('kk-KZ')}   |   Барлық студент: ${rows.length}`, { align: 'center' });
    doc.moveDown(0.8);

    const headers = ['№', 'Аты', 'Тегі', 'Тобы', 'Оқу орны', '1', '2', '3', 'Best', 'Acc %', 'Уақыт', 'Күні'];
    const widths = [24, 78, 78, 55, 150, 32, 32, 32, 40, 42, 50, 100];
    const startX = doc.page.margins.left;
    let y = doc.y;

    const drawRow = (cells, isHeader = false) => {
      const h = 20;
      if (y + h > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });
        y = doc.page.margins.top;
      }
      let x = startX;
      doc.rect(startX, y, widths.reduce((a, b) => a + b, 0), h)
        .fill(isHeader ? '#1b2233' : '#ffffff');
      cells.forEach((cell, i) => {
        doc.font(isHeader ? FB : F).fontSize(isHeader ? 9 : 8)
          .fillColor(isHeader ? '#f0c040' : '#111')
          .text(String(cell), x + 4, y + 6, { width: widths[i] - 8, ellipsis: true, lineBreak: false });
        x += widths[i];
      });
      doc.strokeColor('#dddddd').lineWidth(0.5)
        .rect(startX, y, widths.reduce((a, b) => a + b, 0), h).stroke();
      y += h;
    };

    drawRow(headers, true);
    rows.forEach((r, i) => drawRow([
      i + 1, r.first_name, r.last_name, r.student_group, r.institution,
      r.attempt1 ?? '—', r.attempt2 ?? '—', r.attempt3 ?? '—',
      Number(r.best_score), Number(r.best_accuracy).toFixed(1),
      sheets.formatMs(r.best_time_ms), (r.last_played || '—').slice(0, 16).replace('T', ' '),
    ]));

    doc.end();
    return undefined;
  } catch (err) {
    return next(err);
  }
}

/* ------------------------ PDF тапсырмалар ------------------------- */

async function uploadPdf(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF файл жүктелмеді.' });
    const tasks = await taskService.getTasks({ force: true });
    return res.json({
      ok: true,
      file: req.file.filename,
      roomCount: tasks.roomCount,
      totalQuestions: tasks.totalQuestions,
      hash: tasks.hash,
      rooms: tasks.rooms.map((r) => ({
        index: r.index, title: r.title, type: r.type, total: r.total,
        stages: r.stages.map((s) => ({ type: s.type, total: s.total })),
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function tasksInfo(req, res, next) {
  try {
    const tasks = await taskService.getTasks({ force: req.query.reload === '1' });
    return res.json({
      source: tasks.source,
      hash: tasks.hash,
      parsedAt: tasks.parsedAt,
      roomCount: tasks.roomCount,
      totalQuestions: tasks.totalQuestions,
      rooms: tasks.rooms.map((r) => ({
        index: r.index, title: r.title, type: r.type, total: r.total,
        timeLimitSeconds: r.timeLimitSeconds, perQuestionSeconds: r.perQuestionSeconds,
        stages: r.stages.map((s) => ({ id: s.id, type: s.type, total: s.total })),
      })),
    });
  } catch (err) {
    return next(err);
  }
}

/* -------------------------- Google Sheets ------------------------- */

async function getSheetsSettings(req, res, next) {
  try {
    const cfg = await sheets.getSettings();
    return res.json({
      enabled: cfg.enabled,
      spreadsheetId: cfg.spreadsheetId || '',
      sheetName: cfg.sheetName || 'Нәтижелер',
      hasCredentials: Boolean(cfg.credentials),
    });
  } catch (err) {
    return next(err);
  }
}

async function saveSheetsSettings(req, res, next) {
  try {
    const saved = await sheets.saveSettings(req.body);
    return res.json({ ok: true, settings: saved });
  } catch (err) {
    return next(err);
  }
}

async function syncSheets(req, res, next) {
  try {
    const rows = await fetchStudents({});
    const result = await sheets.syncAll(rows);
    if (!result.synced) {
      return res.status(400).json({ error: 'Google Sheets бапталмаған.', code: result.reason });
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  login, logout, changePassword, listStudents, studentCard, stats,
  exportExcel, exportPdf, uploadPdf, tasksInfo,
  getSheetsSettings, saveSheetsSettings, syncSheets, fetchStudents,
};
