'use strict';
const { createApp } = require('./app');

(async () => {
  const app = await createApp();
  await app.listen();
  console.log(`Code Rush is running on http://localhost:${app.config.port}`);
  const stop = async (sig) => {
    console.log(`\n${sig} received - shutting down (waiting for running judgments)...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
})().catch((e) => { console.error(e); process.exit(1); });
