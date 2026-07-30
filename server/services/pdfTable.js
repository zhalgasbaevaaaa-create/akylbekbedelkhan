'use strict';
/**
 * PDF кестелерін қалпына келтіру.
 *
 * PDF-те кесте жолдары көп жолға созылады және мәтін блоктары ретсіз келеді.
 * Алгоритм:
 *   1) Барлық ұяшықтарды X координаты бойынша бағандарға кластерлейді.
 *   2) Ең сол жақ бағандағы реттік сандар «тірек» (anchor) болады.
 *   3) Қалған әр ұяшық Y бойынша ең жақын тірекке тіркеледі.
 */
const { normalizeText } = require('./textUtils');

const HEADER_WORDS = [
  '№', 'no', 'жауабы', 'әріп', 'сипаттамасы', 'оқиға', 'дата', 'автор', 'еңбегі',
  'қағанат', 'билеушісі', 'сол жақ', 'оң жақ', 'реті', 'дұрыс жауап',
  'басқарған жылдары', 'қазақ хандары', 'жауабы әріп', 'факт', 'сандар',
];
const isHeaderCell = (t) => HEADER_WORDS.includes(t.toLowerCase().replace(/[.:]+$/, ''));
const SECTION_RE = /^((I{1,3}|IV|V)\s*)?бөлім\b/i;
/** Ұяшық ішіндегі "II бөлім. ..." жалғасын кесу */
const stripSection = (t) => t.replace(/\s*(I{1,3}|IV|V)\s*бөлім[\s\S]*$/i, '').trim();

/** X координаталарын бағандарға кластерлеу */
function clusterColumns(cells, tolerance = 20) {
  const xs = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b);
  const clusters = [];
  for (const x of xs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1] <= tolerance) last.push(x);
    else clusters.push([x]);
  }
  return clusters.map((g) => ({ min: g[0], max: g[g.length - 1], center: (g[0] + g[g.length - 1]) / 2 }));
}

function columnIndex(columns, x) {
  for (let i = 0; i < columns.length; i++) {
    if (x >= columns[i].min - 12 && x <= columns[i].max + 12) return i;
  }
  let best = 0;
  let bestD = Infinity;
  columns.forEach((c, i) => {
    const d = Math.abs(c.center - x);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/**
 * @param {Array<{page:number,y:number,cells:Array<{x:number,text:string}>}>} rows
 * @returns {Array<{num:number, cells:Array<{col:number,x:number,text:string}>}>}
 */
function buildRecords(rows) {
  // Барлық ұяшықтарды жинақтау (жалғас беттерде Y қайта басталады -> глобалды Y)
  // Кесте «№ / No» тақырыбынан басталады: одан бұрынғы нұсқаулық мәтіні еленбейді
  let start = rows.findIndex((r) => r.cells.some((c) => /^(№|No)[\s.:]*$/i.test(normalizeText(c.text))));
  if (start < 0) start = rows.findIndex((r) => /^[•\s]*(№|No)\s+\p{L}/u.test(normalizeText(r.cells.map((c) => c.text).join(' '))));
  if (start < 0) start = 0;
  const flat = [];
  const HEADER_ROW_RE = /^[•\s]*(№|No)\s+\p{L}/u;
  rows.slice(start).forEach((row) => {
    const joined = normalizeText(row.cells.map((c) => c.text).join(' '));
    if (HEADER_ROW_RE.test(joined)) return; // қайталанған кесте тақырыбы
    const gy = row.page * 100000 - row.y; // жоғарыдан төмен өсетін глобалды координата
    for (const c of row.cells) {
      const text = normalizeText(c.text);
      const cut = stripSection(text);
      if (!cut || isHeaderCell(cut) || SECTION_RE.test(cut)) continue;
      flat.push({ x: c.x, y: gy, text: cut });
    }
  });
  if (!flat.length) return [];

  const columns = clusterColumns(flat);
  const enriched = flat.map((c) => ({ ...c, col: columnIndex(columns, c.x) }));

  // Тіректер: ең сол жақ бағандағы «таза сан» немесе «сан + мәтін»
  const anchors = [];
  const leftCol = 0;
  for (const c of enriched) {
    if (c.col !== leftCol) continue;
    const m = c.text.match(/^(\d{1,3})(?:\s+(.*))?$/);
    if (!m) continue;
    anchors.push({ num: Number(m[1]), y: c.y, cells: [] , rest: m[2] ? m[2].trim() : '' });
  }
  if (!anchors.length) return [];
  anchors.sort((a, b) => a.y - b.y);

  const MAX_DISTANCE = 46; // кесте жолының шамалас биіктігі
  const findAnchor = (y) => {
    let best = null;
    let bestD = Infinity;
    for (const a of anchors) {
      const d = Math.abs(a.y - y);
      if (d < bestD) { bestD = d; best = a; }
    }
    return bestD <= MAX_DISTANCE ? best : null;
  };

  for (const c of enriched) {
    if (c.col === leftCol && /^\d{1,3}(\s|$)/.test(c.text)) {
      const a = anchors.find((an) => an.y === c.y && an.num === Number(c.text.match(/^(\d{1,3})/)[1]));
      if (a) {
        if (a.rest) a.cells.push({ col: c.col, x: c.x, text: a.rest });
        continue;
      }
    }
    const anchor = findAnchor(c.y);
    if (!anchor) continue; // кестеден тыс мәтін (нұсқаулық, тақырып) — еленбейді
    anchor.cells.push({ col: c.col, x: c.x, text: c.text, y: c.y });
  }

  // Әр тіректің ұяшықтарын баған бойынша біріктіру
  return anchors
    .map((a) => {
      const byCol = new Map();
      for (const c of a.cells.sort((p, q) => p.y - q.y || p.x - q.x)) {
        const prev = byCol.get(c.col);
        byCol.set(c.col, prev ? normalizeText(prev + ' ' + c.text) : c.text);
      }
      const cells = [...byCol.entries()]
        .sort((p, q) => p[0] - q[0])
        .map(([col, text]) => ({ col, x: columns[col].center, text }));
      return { num: a.num, cells, cols: cells };
    })
    .filter((r) => r.cells.length);
}

module.exports = { buildRecords, clusterColumns };
