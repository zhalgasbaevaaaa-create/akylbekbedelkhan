'use strict';
/**
 * Production build:
 *  - dist/ ішіне клиент пен серверді жинайды
 *  - CSS/JS файлдарын минификациялайды (қарапайым, тәуелсіз минификатор)
 *  - Дерекқор мен .env файлдары көшірілмейді
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const SKIP = new Set([
  'node_modules', 'dist', '.git', 'tests', 'tools', 'coverage',
  '.env', 'game.db', 'game.db-wal', 'game.db-shm', 'data',
]);

function copyDir(src, dest, { minify = false } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to, { minify });
      continue;
    }
    const ext = path.extname(entry.name);
    if (minify && (ext === '.css' || ext === '.js')) {
      const code = fs.readFileSync(from, 'utf8');
      fs.writeFileSync(to, ext === '.css' ? minifyCss(code) : minifyJs(code));
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/** Қауіпсіз CSS минификаторы */
function minifyCss(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * JS минификаторы: блок түсініктемелерін (/* ... *\/), жолдық
 * түсініктемелерді және артық бос жолдарды жол ішіндегі мәтін
 * литералдарын бұзбай алып тастайды.
 */
function minifyJs(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let state = 'code'; // code | line | block | s1 | s2 | tpl | regexMaybe

  while (i < n) {
    const c = code[i];
    const next = code[i + 1];

    if (state === 'code') {
      if (c === '/' && next === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && next === '/') { state = 'line'; i += 2; continue; }
      if (c === "'") state = 's1';
      else if (c === '"') state = 's2';
      else if (c === '`') state = 'tpl';
      out += c; i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; i += 2; continue; }
      i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i += 1; continue;
    }
    // мәтін литералдары — өзгеріссіз
    out += c;
    if (c === '\\') { out += code[i + 1] || ''; i += 2; continue; }
    if ((state === 's1' && c === "'") || (state === 's2' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code';
    }
    i += 1;
  }

  return out
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim())
    .join('\n');
}

function main() {
  console.log('▸ dist/ тазартылуда…');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  console.log('▸ Клиент жиналуда (минификациямен)…');
  copyDir(path.join(root, 'client'), path.join(dist, 'client'), { minify: true });

  console.log('▸ Сервер көшірілуде…');
  copyDir(path.join(root, 'server'), path.join(dist, 'server'));
  fs.mkdirSync(path.join(dist, 'server', 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'server', 'database', 'data'), { recursive: true });

  // PDF тапсырмаларды көшіру
  const pdf = path.join(root, 'server', 'uploads', 'tasks.pdf');
  if (fs.existsSync(pdf)) fs.copyFileSync(pdf, path.join(dist, 'server', 'uploads', 'tasks.pdf'));

  for (const file of ['package.json', '.env.example', 'README.md', 'Dockerfile', 'docker-compose.yml']) {
    const from = path.join(root, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dist, file));
  }

  const size = dirSize(dist);
  console.log(`\n✅ Build дайын: dist/ (${(size / 1024 / 1024).toFixed(2)} МБ)`);
  console.log('   Іске қосу: cd dist && npm ci --omit=dev && npm start\n');
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

main();
