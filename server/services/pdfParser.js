'use strict';
/**
 * PDF -> ойын тапсырмалары (JSON) конвертері.
 *
 * Мұғалім жүктеген PDF автоматты түрде талданады — кодқа ешнәрсе қолмен
 * жазылмайды. PDF ауысса, тапсырмалар да автоматты жаңарады.
 *
 * Қолдайтын тапсырма түрлері:
 *   quiz      — Multiple Choice тест (A) B) C) D) + «Жауап кілті»)
 *   matching  — Сәйкестендіру / Pair matching (Drag & Drop)
 *   timeline  — Хронологиялық рет (даталар + оқиғалар)
 *   cards     — Карточкалар (Факт <-> Түсіндірме)
 */

const crypto = require('crypto');
const { extractRows } = require('./pdfText');
const { buildRecords } = require('./pdfTable');
const { normalizeText, isDivider } = require('./textUtils');

const ROOM_RE = /^(\d{1,2})\s*бөлме\s*[.:]?\s*(.*)$/i;
const KEY_RE = /жауап\s*кілт/i;

/* ------------------------------------------------------------------ */
/* 1. PDF-ті бөлмелерге бөлу                                           */
/* ------------------------------------------------------------------ */

function splitRooms(rows) {
  const rooms = [];
  let cur = null;
  for (const row of rows) {
    const joined = normalizeText(row.cells.map((c) => c.text).join(' '));
    if (!joined || isDivider(joined)) continue;
    const m = joined.match(ROOM_RE);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 50) {
      cur = { index: Number(m[1]), header: m[2] || '', rows: [], lines: [] };
      rooms.push(cur);
      if (m[2]) {
        // rows/lines индекстері әрқашан сәйкес болуы керек
        cur.lines.push(m[2]);
        cur.rows.push({ page: row.page, y: row.y, cells: [] });
      }
      continue;
    }
    if (!cur) continue;
    cur.rows.push(row);
    cur.lines.push(joined);
  }
  return rooms;
}

/** Бөлмені «Жауап кілті» тақырыбымен екіге бөлу */
function splitByKey(room) {
  const bodyRows = [];
  const keyLines = [];
  let inKey = false;
  room.rows.forEach((row, i) => {
    const line = room.lines[i];
    if (KEY_RE.test(line)) { inKey = true; return; }
    if (inKey) keyLines.push(line);
    else bodyRows.push(row);
  });
  // Кілттен кейін жаңа бөлім басталса (мыс. "II бөлім. Карточкалар") — денеге қайтару
  return { bodyRows, keyLines };
}

/* ------------------------------------------------------------------ */
/* 2. Жауап кілттері                                                   */
/* ------------------------------------------------------------------ */

function parseKeyLines(lines) {
  const key = new Map();
  for (const l of lines) {
    if (ROOM_RE.test(l)) break;
    for (const p of l.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Za-zА-Яа-я])\*?(?=\s|$)/g)) {
      const num = Number(p[1]);
      const letter = p[2].toUpperCase();
      if (!key.has(num)) key.set(num, letter);
    }
  }
  return key;
}

/** Бөлмедегі барлық кілт секцияларын жинау */
function collectKeys(room) {
  const key = new Map();
  let inKey = false;
  for (const line of room.lines) {
    if (KEY_RE.test(line)) { inKey = true; continue; }
    if (!inKey) continue;
    if (/^(II|III)\s*бөлім/i.test(line) || ROOM_RE.test(line)) { inKey = false; continue; }
    for (const [k, v] of parseKeyLines([line])) if (!key.has(k)) key.set(k, v);
  }
  return key;
}

/** Карточкалар кілті — «Факт | Дұрыс жауап» кестесінен алынады */
function collectCardKeys(room) {
  let start = -1;
  room.lines.forEach((l, i) => {
    if (/^Факт[\s.:]/i.test(l)) start = i;
  });
  if (start < 0) return new Map();
  return parseKeyLines(room.lines.slice(start + 1));
}

/* ------------------------------------------------------------------ */
/* 3. Тест (Multiple Choice)                                           */
/* ------------------------------------------------------------------ */

function parseQuiz(room) {
  const { keyLines } = splitByKey(room);
  const key = parseKeyLines(keyLines);
  if (!key.size) return null;

  const questions = [];
  let cur = null;
  for (const raw of room.lines) {
    if (KEY_RE.test(raw)) break;
    const line = raw.trim();
    const opt = line.match(/^([A-Ea-e])\)\s*(.+)$/);
    if (opt && cur) {
      cur.options.push({ id: opt[1].toUpperCase(), text: normalizeText(opt[2]) });
      continue;
    }
    const q = line.match(/^(\d{1,3})[.)]\s+(.{4,})$/);
    if (q) {
      if (cur && cur.options.length >= 2) questions.push(cur);
      cur = { num: Number(q[1]), text: normalizeText(q[2]), options: [] };
      continue;
    }
    if (cur && cur.options.length === 0 && line.length > 3 && !/бөлме|тест/i.test(line)) {
      cur.text = normalizeText(cur.text + ' ' + line);
    }
  }
  if (cur && cur.options.length >= 2) questions.push(cur);

  const items = questions
    .filter((q) => key.has(q.num) && q.options.some((o) => o.id === key.get(q.num)))
    .map((q) => ({
      id: `q${q.num}`,
      number: q.num,
      question: q.text,
      options: q.options,
      answer: key.get(q.num),
    }));

  return items.length >= 2 ? { type: 'quiz', items } : null;
}

/* ------------------------------------------------------------------ */
/* 4. Сәйкестендіру (Matching / Pair)                                  */
/* ------------------------------------------------------------------ */

const LETTER_ONLY = /^([A-Z])$/;
const LETTER_PREFIX = /^([A-Z])\s+(.{2,})$/;

/**
 * Кесте жазбаларынан сол жақ / әріп / оң жақ бағандарын анықтау.
 */
function recordsToPairs(records) {
  const parsed = [];
  for (const rec of records) {
    let letter = null;
    let leftParts = [];
    let rightParts = [];
    let seen = false;

    for (const col of rec.cols) {
      const only = col.text.match(LETTER_ONLY);
      const pref = col.text.match(LETTER_PREFIX);
      if (!seen && only) {
        letter = only[1];
        seen = true;
        continue;
      }
      if (!seen && pref && /^[A-Z]$/.test(pref[1])) {
        letter = pref[1];
        seen = true;
        rightParts.push(pref[2]);
        continue;
      }
      if (seen) rightParts.push(col.text);
      else leftParts.push(col.text);
    }

    // "1 Керей хан A 1511–1523 жж." — бір ұяшықта
    if (!seen && leftParts.length) {
      const merged = leftParts.join(' ');
      const inline = merged.match(/^(.+?)\s+([A-Z])\s+(.+)$/);
      if (inline) {
        leftParts = [inline[1]];
        letter = inline[2];
        rightParts = [inline[3]];
        seen = true;
      }
    }

    const left = normalizeText(leftParts.join(' '));
    const right = normalizeText(rightParts.join(' '));
    if (!seen || !letter) continue;
    parsed.push({ num: rec.num, left, right, letter });
  }
  return parsed;
}

function parseMatching(room) {
  const { bodyRows } = splitByKey(room);
  const records = buildRecords(bodyRows);
  const raw = recordsToPairs(records).filter((r) => r.left || r.right);
  if (raw.length < 2) return null;

  // Секцияларға бөлу (әріп/номер қайталанса — жаңа бөлім)
  const sections = [];
  let sec = null;
  for (const r of raw) {
    if (!sec || sec.letters.has(r.letter) || sec.nums.has(r.num)) {
      sec = { rows: [], letters: new Set(), nums: new Set(), rights: new Map() };
      sections.push(sec);
    }
    sec.rows.push(r);
    sec.letters.add(r.letter);
    sec.nums.add(r.num);
    if (r.right) sec.rights.set(r.letter, r.right);
  }

  const key = collectKeys(room);
  const items = [];
  sections.forEach((s, si) => {
    for (const r of s.rows) {
      if (!r.left) continue;
      const mapped = key.get(r.num);
      const letter = mapped && s.rights.has(mapped) ? mapped : r.letter;
      const right = s.rights.get(letter);
      if (!right) continue;
      items.push({
        id: `m${si + 1}_${r.num}`,
        number: r.num,
        group: si + 1,
        left: r.left,
        right,
        letter,
      });
    }
  });
  // Қайталанған сол жақтарды алып тастау
  const seenLeft = new Set();
  const unique = items.filter((i) => {
    const k = i.group + '|' + i.left;
    if (seenLeft.has(k)) return false;
    seenLeft.add(k);
    return true;
  });
  return unique.length >= 2 ? { type: 'matching', items: unique } : null;
}

/* ------------------------------------------------------------------ */
/* 5. Timeline                                                         */
/* ------------------------------------------------------------------ */

const DATE_ONLY = /^(\d{3,4}(?:–\d{2,4})?)\s*(жж?\.?)?$/;

function parseTimeline(room) {
  const { bodyRows } = splitByKey(room);
  const records = buildRecords(bodyRows);

  const dates = [];
  for (const rec of records) {
    const txt = normalizeText(rec.cols.map((c) => c.text).join(' '));
    if (DATE_ONLY.test(txt)) dates.push({ num: rec.num, date: txt });
  }
  if (dates.length < 3) return null;

  // Оқиғалар: "A Өзбек хан ..." жолдары
  const events = new Map();
  for (const line of room.lines) {
    if (KEY_RE.test(line)) break;
    const m = line.match(/^([A-Z])\s+(.{8,})$/);
    if (m && !events.has(m[1])) events.set(m[1], normalizeText(m[2]));
  }
  if (events.size < 3) return null;

  // "Реті / Дұрыс жауап" кестесі
  const orderIdx = room.lines.findIndex((l) => /^Реті/i.test(l));
  const key = parseKeyLines(orderIdx >= 0 ? room.lines.slice(orderIdx) : room.lines);
  if (!key.size) return null;

  const items = [];
  const used = new Set();
  for (const d of dates) {
    const letter = key.get(d.num);
    const event = letter ? events.get(letter) : null;
    if (!event || used.has(letter)) continue;
    used.add(letter);
    items.push({ id: `t${d.num}`, number: d.num, date: d.date, event, letter });
  }
  return items.length >= 3 ? { type: 'timeline', items } : null;
}

/* ------------------------------------------------------------------ */
/* 6. Карточкалар                                                      */
/* ------------------------------------------------------------------ */

function parseCards(room) {
  const start = room.lines.findIndex((l) => /карточкалар/i.test(l));
  if (start < 0) return null;

  const facts = new Map();
  const explains = new Map();
  let mode = null;
  let curFact = null;
  let curLetter = null;

  for (let i = start; i < room.lines.length; i++) {
    const l = room.lines[i];
    if (/^[АA]\s*карточка/i.test(l)) { mode = 'fact'; curFact = null; continue; }
    if (/^[ВB]\s*карточка/i.test(l)) { mode = 'exp'; curLetter = null; continue; }
    if (KEY_RE.test(l)) { mode = 'key'; continue; }
    if (mode === 'fact') {
      const f = l.match(/^(\d{1,2})\s*-?\s*карточка/i);
      if (f) { curFact = Number(f[1]); if (!facts.has(curFact)) facts.set(curFact, ''); continue; }
      if (curFact && l.length > 5) facts.set(curFact, normalizeText(facts.get(curFact) + ' ' + l));
    } else if (mode === 'exp') {
      const only = l.match(/^([A-Z])$/);
      if (only) { curLetter = only[1]; if (!explains.has(curLetter)) explains.set(curLetter, ''); continue; }
      const inline = l.match(/^([A-Z])\s+(.{6,})$/);
      if (inline) { curLetter = inline[1]; explains.set(curLetter, normalizeText(inline[2])); continue; }
      if (curLetter && l.length > 5) {
        explains.set(curLetter, normalizeText((explains.get(curLetter) || '') + ' ' + l));
      }
    }
  }
  if (facts.size < 2 || explains.size < 2) return null;

  const key = collectCardKeys(room);
  const items = [];
  for (const [num, fact] of facts) {
    const letter = key.get(num);
    const explanation = letter ? explains.get(letter) : null;
    if (!fact || !explanation) continue;
    items.push({ id: `c${num}`, number: num, fact, explanation, letter });
  }
  return items.length >= 2 ? { type: 'cards', items } : null;
}

/* ------------------------------------------------------------------ */
/* 7. Негізгі                                                          */
/* ------------------------------------------------------------------ */

const TYPE_TITLES = {
  quiz: 'Тест сынағы',
  matching: 'Сәйкестендіру залы',
  timeline: 'Хронология залы',
  cards: 'Карточкалар залы',
};

function timeLimitFrom(room) {
  const text = room.lines.join(' ');
  const perQ = text.match(/сұраққа\s*[-–]?\s*(\d{1,3})\s*сек/i);
  const total = text.match(/(?:Барлығы|бөлімге)\s*(\d{1,4})\s*секунд/i);
  return {
    perQuestion: perQ ? Number(perQ[1]) : null,
    total: total ? Number(total[1]) : null,
  };
}

function detectTitle(room, type) {
  const h = normalizeText(room.header).replace(/^[.\s]+/, '');
  const first = h.split(/[.]/)[0].trim();
  if (first && first.length > 3) return first;
  return TYPE_TITLES[type] || `${room.index}-бөлме`;
}

async function parsePdf(filePath) {
  const rows = await extractRows(filePath);
  const rooms = splitRooms(rows);
  const parsedRooms = [];

  const safe = (fn, room) => {
    try {
      return fn(room);
    } catch (err) {
      return null;
    }
  };

  for (const room of rooms) {
    const body = room.lines.join(' ').toLowerCase();
    const stages = [];

    if (/тест/.test(body)) {
      const q = safe(parseQuiz, room);
      if (q) stages.push(q);
    }
    const timeline = safe(parseTimeline, room);
    if (timeline) stages.push(timeline);
    if (!timeline) {
      const m = safe(parseMatching, room);
      if (m) stages.push(m);
    }
    if (/карточка/.test(body)) {
      const c = safe(parseCards, room);
      if (c) stages.push(c);
    }

    if (!stages.length) {
      const fb = safe(parseQuiz, room) || safe(parseMatching, room) || safe(parseCards, room);
      if (!fb) continue;
      stages.push(fb);
    }

    const limits = timeLimitFrom(room);
    const total = stages.reduce((s, st) => s + st.items.length, 0);
    parsedRooms.push({
      index: room.index,
      title: detectTitle(room, stages[0].type),
      type: stages[0].type,
      instruction: normalizeText(room.lines.slice(0, 3).join(' ')),
      timeLimitSeconds: limits.total,
      perQuestionSeconds: limits.perQuestion,
      stages: stages.map((s, i) => ({
        id: `r${room.index}s${i + 1}`,
        type: s.type,
        total: s.items.length,
        items: s.items,
      })),
      total,
    });
  }

  parsedRooms.sort((a, b) => a.index - b.index);
  parsedRooms.forEach((r, i) => { r.order = i + 1; });

  const payload = {
    rooms: parsedRooms,
    roomCount: parsedRooms.length,
    totalQuestions: parsedRooms.reduce((s, r) => s + r.total, 0),
    parsedAt: new Date().toISOString(),
  };
  payload.hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(parsedRooms))
    .digest('hex')
    .slice(0, 16);
  return payload;
}

module.exports = { parsePdf };
