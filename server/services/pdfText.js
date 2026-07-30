'use strict';
/**
 * PDF мәтінін PDF.js (pdfjs-dist) арқылы оқу.
 * Мәтін элементтері Y координаты бойынша жолдарға, X координаты бойынша
 * кесте ұяшықтарына (cells) топталады. Осының арқасында көп жолды кестелер
 * дұрыс танылады.
 */
const fs = require('fs');

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/**
 * @returns {Promise<Array<{page:number,y:number,cells:Array<{x:number,text:string}>}>>}
 */
async function extractRows(filePath) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const bands = new Map();
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 4) * 4;
      if (!bands.has(y)) bands.set(y, []);
      bands.get(y).push({ x: item.transform[4], w: item.width || 0, s: item.str });
    }
    const ys = [...bands.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const items = bands.get(y).sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = null;
      for (const it of items) {
        if (cur && it.x - (cur.x + cur.w) < 12) {
          // сол ұяшықтың жалғасы
          cur.text += (it.x - (cur.x + cur.w) > 0.8 ? ' ' : '') + it.s;
          cur.w = it.x + (it.width || it.w || 0) - cur.x;
        } else {
          if (cur) cells.push(cur);
          cur = { x: it.x, w: it.w, text: it.s };
        }
      }
      if (cur) cells.push(cur);
      const clean = cells
        .map((c) => ({ x: Math.round(c.x), text: c.text.replace(/\s+/g, ' ').trim() }))
        .filter((c) => c.text);
      if (clean.length) rows.push({ page: p, y, cells: clean });
    }
  }
  await doc.destroy();
  return rows;
}

/** Жолдарды қарапайым мәтін тізіміне айналдыру */
async function extractLines(filePath) {
  const rows = await extractRows(filePath);
  return rows.map((r) => r.cells.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim());
}

module.exports = { extractRows, extractLines };
