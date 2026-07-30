'use strict';
/**
 * Тапсырмалар қызметі.
 *  - server/uploads ішіндегі PDF-ті автоматты оқиды (PDF.js).
 *  - Файл өзгерсе (mtime/size), тапсырмалар автоматты қайта жүктеледі.
 *  - Дұрыс жауаптар клиентке жіберілмейді, тексеру тек серверде.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { parsePdf } = require('./pdfParser');

let cache = null;      // { payload, signature, file }
let loading = null;

function activePdfPath() {
  const dir = config.uploadsDir;
  fs.mkdirSync(dir, { recursive: true });
  const preferred = path.join(dir, 'tasks.pdf');
  if (fs.existsSync(preferred)) return preferred;
  const pdfs = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return pdfs.length ? path.join(dir, pdfs[0].f) : null;
}

function signatureOf(file) {
  const st = fs.statSync(file);
  return `${path.basename(file)}:${st.size}:${Math.round(st.mtimeMs)}`;
}

/** Тапсырмаларды жүктеу (кэшпен, PDF өзгерсе автоматты жаңарту) */
async function getTasks({ force = false } = {}) {
  const file = activePdfPath();
  if (!file) {
    throw Object.assign(new Error('PDF тапсырма файлы табылмады. server/uploads ішіне PDF жүктеңіз.'), {
      status: 503,
      code: 'NO_PDF',
    });
  }
  const signature = signatureOf(file);
  if (!force && cache && cache.signature === signature) return cache.payload;
  if (loading) return loading;

  loading = (async () => {
    const payload = await parsePdf(file);
    payload.source = path.basename(file);
    cache = { payload, signature, file };
    loading = null;
    return payload;
  })();
  return loading;
}

/** Клиентке арналған нұсқа — дұрыс жауаптарсыз */
function sanitize(payload) {
  return {
    hash: payload.hash,
    source: payload.source,
    roomCount: payload.roomCount,
    totalQuestions: payload.totalQuestions,
    parsedAt: payload.parsedAt,
    rooms: payload.rooms.map((room) => ({
      index: room.index,
      order: room.order,
      title: room.title,
      type: room.type,
      instruction: room.instruction,
      timeLimitSeconds: room.timeLimitSeconds,
      perQuestionSeconds: room.perQuestionSeconds,
      total: room.total,
      stages: room.stages.map((stage) => ({
        id: stage.id,
        type: stage.type,
        total: stage.total,
        items: stage.items.map((item) => sanitizeItem(stage.type, item)),
      })),
    })),
  };
}

function sanitizeItem(type, item) {
  switch (type) {
    case 'quiz':
      return {
        id: item.id, number: item.number, question: item.question, options: item.options,
      };
    case 'matching':
      return {
        id: item.id, number: item.number, group: item.group || 1, left: item.left, right: item.right,
      };
    case 'timeline':
      return { id: item.id, number: item.number, date: item.date, event: item.event };
    case 'cards':
      return { id: item.id, number: item.number, fact: item.fact, explanation: item.explanation };
    default:
      return { id: item.id, number: item.number };
  }
}

/** Бөлме мен кезеңді табу */
function findRoom(payload, roomIndex) {
  return payload.rooms.find((r) => r.index === Number(roomIndex)) || null;
}

/**
 * Жауапты тексеру.
 * @param {object} room  тапсырма бөлмесі
 * @param {string} stageId
 * @param {string} itemId
 * @param {*} value  quiz -> 'A'; matching/timeline/cards -> сәйкес мәтін немесе id
 */
function checkAnswer(room, stageId, itemId, value) {
  const stage = room.stages.find((s) => s.id === stageId) || room.stages[0];
  if (!stage) return { ok: false, correct: false, reason: 'STAGE_NOT_FOUND' };
  const item = stage.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, correct: false, reason: 'ITEM_NOT_FOUND' };

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  let correct = false;
  let expected = null;

  switch (stage.type) {
    case 'quiz':
      expected = item.answer;
      correct = norm(value) === norm(item.answer);
      break;
    case 'matching':
      expected = item.right;
      correct = norm(value) === norm(item.right) || norm(value) === norm(item.letter);
      break;
    case 'timeline':
      // Timeline: күтілетін мән — оқиға мәтіні (сәйкестендіру) немесе реттік нөмір
      expected = item.event;
      correct = norm(value) === norm(item.event)
        || norm(value) === norm(item.letter)
        || Number(value) === Number(item.number);
      break;
    case 'cards':
      expected = item.explanation;
      correct = norm(value) === norm(item.explanation) || norm(value) === norm(item.letter);
      break;
    default:
      correct = false;
  }
  return { ok: true, correct, expected, item, stageType: stage.type };
}

module.exports = { getTasks, sanitize, findRoom, checkAnswer, activePdfPath };
