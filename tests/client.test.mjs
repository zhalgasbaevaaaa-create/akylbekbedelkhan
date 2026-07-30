/**
 * Клиенттік модульдердің сынағы (jsdom ортасында).
 * Іске қосу: node tests/client.test.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(root, '..', 'client');

const dom = new JSDOM(
  '<!DOCTYPE html><html><body><div id="app"></div><div id="toast-host"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} cloneNode() { return new globalThis.Audio(); } addEventListener() {} };
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const ui = await import('../client/src/components/ui.js');
const { renderStage } = await import('../client/src/components/tasks.js');

/* ------------------------------ UI ------------------------------- */

test('el() XSS енгізуден қорғайды', () => {
  const node = ui.el('div', { text: '<img src=x onerror=alert(1)>' });
  assert.strictEqual(node.children.length, 0, 'HTML элемент құрылмауы керек');
  assert.ok(node.textContent.includes('<img'), 'мәтін ретінде сақталады');
  const node2 = ui.el('div', { html: '<script>bad()</script>' });
  assert.strictEqual(node2.querySelector('script'), null, 'script енгізілмейді');
});

test('shuffle() барлық элементті сақтайды', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = ui.shuffle(src);
  assert.strictEqual(out.length, src.length);
  assert.deepStrictEqual([...out].sort((a, b) => a - b), src);
  assert.notStrictEqual(out, src, 'бастапқы массив өзгермеуі керек');
});

test('formatTime() дұрыс форматтайды', () => {
  assert.strictEqual(ui.formatTime(0), '00:00');
  assert.strictEqual(ui.formatTime(65000), '01:05');
  assert.strictEqual(ui.formatTime(3599000), '59:59');
});

/* ---------------------------- Tasks ------------------------------ */

function makeCtx(host, overrides = {}) {
  const state = { correct: 0, wrong: 0, done: false, progress: [0, 0] };
  return {
    state,
    ctx: {
      host,
      timeLimitSeconds: null,
      perQuestionSeconds: null,
      check: async () => ({ correct: true }),
      onCorrect: () => { state.correct += 1; },
      onWrong: () => { state.wrong += 1; },
      onProgress: (d, t) => { state.progress = [d, t]; },
      onDone: () => { state.done = true; },
      isAlive: () => true,
      feedback: () => {},
      setTimer: () => {},
      ...overrides,
    },
  };
}

const quizStage = {
  id: 's1',
  type: 'quiz',
  total: 2,
  items: [
    { id: 'q1', number: 1, question: 'Сұрақ 1', options: [{ id: 'A', text: 'A нұсқа' }, { id: 'B', text: 'B нұсқа' }] },
    { id: 'q2', number: 2, question: 'Сұрақ 2', options: [{ id: 'A', text: 'A2' }, { id: 'B', text: 'B2' }] },
  ],
};

test('Quiz рендері сұрақ пен нұсқаларды көрсетеді', () => {
  const host = document.createElement('div');
  const { ctx } = makeCtx(host);
  renderStage(quizStage, ctx);
  assert.ok(host.querySelector('.quiz-question'), 'сұрақ бар');
  assert.strictEqual(host.querySelectorAll('.quiz-option').length, 2, '2 нұсқа');
});

test('Quiz: дұрыс жауап onCorrect шақырады', async () => {
  const host = document.createElement('div');
  const { ctx, state } = makeCtx(host);
  renderStage(quizStage, ctx);
  host.querySelector('.quiz-option').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(state.correct, 1);
  assert.strictEqual(state.wrong, 0);
});

test('Quiz: қате жауап onWrong шақырады', async () => {
  const host = document.createElement('div');
  const { ctx, state } = makeCtx(host, { check: async () => ({ correct: false, expected: 'B' }) });
  renderStage(quizStage, ctx);
  host.querySelector('.quiz-option').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(state.wrong, 1);
  assert.strictEqual(state.correct, 0);
});

const matchStage = {
  id: 's2',
  type: 'matching',
  total: 3,
  items: [
    { id: 'm1', number: 1, group: 1, left: 'Сол 1', right: 'Оң 1' },
    { id: 'm2', number: 2, group: 1, left: 'Сол 2', right: 'Оң 2' },
    { id: 'm3', number: 3, group: 1, left: 'Сол 3', right: 'Оң 3' },
  ],
};

test('Matching рендері слоттар мен чиптерді құрады', () => {
  const host = document.createElement('div');
  const { ctx } = makeCtx(host);
  renderStage(matchStage, ctx);
  assert.strictEqual(host.querySelectorAll('.match-slot').length, 3);
  assert.strictEqual(host.querySelectorAll('.chip').length, 3);
  const rights = [...host.querySelectorAll('.chip')].map((c) => c.textContent);
  assert.deepStrictEqual([...rights].sort(), ['Оң 1', 'Оң 2', 'Оң 3'], 'барлық жауап бар');
});

test('Matching: барлық сәйкестік дұрыс болса onDone шақырылады', async () => {
  const host = document.createElement('div');
  const { ctx, state } = makeCtx(host);
  renderStage(matchStage, ctx);
  const slots = [...host.querySelectorAll('.match-slot')];
  const chips = [...host.querySelectorAll('.chip')];
  for (let i = 0; i < slots.length; i++) {
    chips[i].click();
    slots[i].click();
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.strictEqual(state.correct, 3);
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(state.done, true, 'кезең аяқталуы керек');
});

test('Matching: қате чип банкке қайтады', async () => {
  const host = document.createElement('div');
  const { ctx, state } = makeCtx(host, { check: async () => ({ correct: false }) });
  renderStage(matchStage, ctx);
  const slot = host.querySelector('.match-slot');
  const chip = host.querySelector('.chip');
  chip.click();
  slot.click();
  await new Promise((r) => setTimeout(r, 900));
  assert.strictEqual(state.wrong, 1);
  assert.ok(chip.closest('#chip-bank'), 'чип банкке оралуы керек');
});

test('Timeline рендері даталарды хронологиялық ретпен көрсетеді', () => {
  const host = document.createElement('div');
  const { ctx } = makeCtx(host);
  renderStage({
    id: 's3', type: 'timeline', total: 3,
    items: [
      { id: 't3', number: 3, date: '1227 ж.', event: 'Оқиға C' },
      { id: 't1', number: 1, date: '1206 ж.', event: 'Оқиға A' },
      { id: 't2', number: 2, date: '1211 ж.', event: 'Оқиға B' },
    ],
  }, ctx);
  const dates = [...host.querySelectorAll('.date-badge')].map((n) => n.textContent);
  assert.deepStrictEqual(dates, ['1206 ж.', '1211 ж.', '1227 ж.'], 'даталар ретімен');
  assert.strictEqual(host.querySelectorAll('.chip').length, 3);
});

test('Cards рендері фактілер мен түсіндірмелерді құрады', () => {
  const host = document.createElement('div');
  const { ctx } = makeCtx(host);
  renderStage({
    id: 's4', type: 'cards', total: 2,
    items: [
      { id: 'c1', number: 1, fact: 'Факт 1', explanation: 'Түсіндірме 1' },
      { id: 'c2', number: 2, fact: 'Факт 2', explanation: 'Түсіндірме 2' },
    ],
  }, ctx);
  assert.strictEqual(host.querySelectorAll('.fact-card').length, 2);
  assert.strictEqual(host.querySelectorAll('.chip').length, 2);
});

test('Matching бірнеше бөлімді (group) ретімен көрсетеді', async () => {
  const host = document.createElement('div');
  const { ctx } = makeCtx(host);
  renderStage({
    id: 's5', type: 'matching', total: 4,
    items: [
      { id: 'a1', number: 1, group: 1, left: 'L1', right: 'R1' },
      { id: 'a2', number: 2, group: 1, left: 'L2', right: 'R2' },
      { id: 'b1', number: 3, group: 2, left: 'L3', right: 'R3' },
      { id: 'b2', number: 4, group: 2, left: 'L4', right: 'R4' },
    ],
  }, ctx);
  assert.strictEqual(host.querySelectorAll('.match-slot').length, 2, 'алдымен 1-бөлім');
  const slots = [...host.querySelectorAll('.match-slot')];
  const chips = [...host.querySelectorAll('.chip')];
  for (let i = 0; i < 2; i++) { chips[i].click(); slots[i].click(); await new Promise((r) => setTimeout(r, 20)); }
  await new Promise((r) => setTimeout(r, 900));
  const texts = [...host.querySelectorAll('.match-slot')].map((s) => s.textContent);
  assert.ok(texts.some((t) => t.includes('L3')), '2-бөлім ашылуы керек');
});

test('Барлық HTML файлдарда inline onclick жоқ (CSP-ге сай)', () => {
  const files = ['index.html', 'admin/index.html'];
  for (const f of files) {
    const html = fs.readFileSync(path.join(clientDir, f), 'utf8');
    assert.ok(!/\son[a-z]+\s*=/i.test(html), `${f}: inline оқиға өңдегіші болмауы керек`);
  }
});

test('styles.css барлық қажетті класты қамтиды', () => {
  const css = fs.readFileSync(path.join(clientDir, 'src', 'styles.css'), 'utf8');
  ['.quiz-option', '.match-slot', '.chip', '.fact-card', '.timeline-slot',
    '#hearts', '.timer-bar', '.stat-box', '.confetti'].forEach((cls) => {
    assert.ok(css.includes(cls), `${cls} стилі болуы керек`);
  });
});

/* ------------------------------ Runner ---------------------------- */

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
    passed += 1;
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m ${t.name}\n    \x1b[31m${err.message}\x1b[0m`);
    failed += 1;
  }
}
console.log(`\n  ${passed} өтті, ${failed} құлады\n`);
process.exit(failed ? 1 : 0);
