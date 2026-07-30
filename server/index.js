'use strict';
const config = require('./config');
const { migrate } = require('./database/schema');
const { createApp } = require('./app');
const taskService = require('./services/taskService');

async function main() {
  await migrate();
  console.log(`[DB] ${config.db.driver} дайын.`);

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
