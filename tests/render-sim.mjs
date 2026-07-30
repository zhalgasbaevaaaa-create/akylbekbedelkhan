/**
 * Render.com деплойының толық симуляциясы.
 *
 * Render дәл осылай іске қосады:
 *   NODE_ENV=production, DB_DRIVER=postgres, DATABASE_URL=<PG сервисі>
 *   startCommand: node server/index.js
 *
 * PostgreSQL ретінде PGlite (нағыз PostgreSQL 18, wasm) қолданылады.
 * Іске қосу: node tests/render-sim.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'server', 'index.js'));

/* --- PGlite-ті `pg` пакеті ретінде көрсету --- */
const pglite = await new PGlite();
const Module = require('module');
const origResolve = Module._resolveFilename;
const FAKE_PG = '\u0000fake-pg';
Module._resolveFilename = function (request, ...rest) {
  if (request === 'pg') return FAKE_PG;
  return origResolve.call(this, request, ...rest);
};
require.cache[FAKE_PG] = {
  id: FAKE_PG,
  filename: FAKE_PG,
  loaded: true,
  exports: {
    Pool: class {
      async query(sql, params) {
        if (!params || !params.length) {
          const res = await pglite.exec(sql);
          const last = res[res.length - 1] || { rows: [] };
          return { rows: last.rows || [], rowCount: last.affectedRows ?? (last.rows || []).length };
        }
        const res = await pglite.query(sql, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      }

      async connect() {
        return { query: (s, p) => this.query(s, p), release() {} };
      }

      // eslint-disable-next-line class-methods-use-this
      async end() {}
    },
  },
};

/* --- Render орта айнымалылары --- */
process.env.NODE_ENV = 'production';
process.env.DB_DRIVER = 'postgres';
process.env.DATABASE_URL = 'postgres://render/kzhistory';
process.env.JWT_SECRET = 'render-simulation-secret-key-123456';
process.env.ADMIN_PASSWORD = 'RenderTest2026';
process.env.PORT = process.env.SIM_PORT || '3401';

console.log('▸ Render симуляциясы басталды (PostgreSQL, production)…\n');
await import(path.join(root, 'server', 'index.js'));
