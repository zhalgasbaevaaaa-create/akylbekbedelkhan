'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { migrate } = require('./database/schema');
const { createApp } = require('./app');
const taskService = require('./services/taskService');

/**
 * Деплойда (Render/Fly/Docker) тұрақты диск алғаш рет бос болады.
 * Егер UPLOADS_DIR ішінде PDF жоқ болса — репозиториймен бірге келген
 * tasks.pdf автоматты көшіріледі, сонда ойын бірден жұмыс істейді.
 */
function seedTasksPdf() {
  const target = config.uploadsDir;
  fs.mkdirSync(target, { recursive: true });

  const hasPdf = fs.readdirSync(target).some((f) => f.toLowerCase().endsWith('.pdf'));
  if (hasPdf) return;

  const bundled = path.join(__dirname, 'uploads', 'tasks.pdf');
  if (path.resolve(bundled) === path.resolve(target, 'tasks.pdf')) return;
  if (!fs.existsSync(bundled)) return;

  fs.copyFileSync(bundled, path.join(target, 'tasks.pdf'));
  console.log(`[PDF] Бастапқы tasks.pdf ${target} ішіне көшірілді.`);
}

async function main() {
  await migrate();
  console.log(`[DB] ${config.db.driver} дайын.`);

  seedTasksPdf();

  try {
    const tasks = await taskService.getTasks();
    console.log(`[PDF] ${tasks.source}: ${tasks.roomCount} бөлме, ${tasks.totalQuestions} тапсырма оқылды.`);
  } catch (err) {
    console.warn(`[PDF] ${err.message}`);
  }

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`\n🏰 Қазақстан тарихы RPG — http://localhost:${config.port}`);
    console.log(`🔐 Админ панелі      — http://localhost:${config.port}/admin\n`);
  });

  const shutdown = (signal) => {
    console.log(`\n${signal} сигналы — сервер жабылуда...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Сервер іске қосылмады:', err);
  process.exit(1);
});
