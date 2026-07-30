'use strict';
/** Дерекқорды толық тазарту (қауіпті — барлық нәтиже жойылады) */
const fs = require('fs');
const config = require('../server/config');

if (config.db.driver !== 'sqlite') {
  console.error('Бұл құрал тек SQLite үшін. PostgreSQL-де қолмен тазалаңыз.');
  process.exit(1);
}
for (const f of [config.db.file, `${config.db.file}-wal`, `${config.db.file}-shm`]) {
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('жойылды:', f); }
}
require('../server/database/schema').migrate().then(() => {
  console.log('✅ Дерекқор қайта құрылды.');
  process.exit(0);
});
