'use strict';
const fs = require('fs');

function seedIfEmpty(questions, file) {
  if (!file || !fs.existsSync(file)) return null;
  if (questions.stats().total > 0) return null;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = questions.importMany(list);
  if (report.errors.length) throw new Error('Seed file is invalid: ' + JSON.stringify(report.errors.slice(0, 3)));
  return report;
}

module.exports = { seedIfEmpty };

if (require.main === module) {
  (async () => {
    const { createApp } = require('./app');
    const app = await createApp({ seedOnEmpty: false });
    const { questions, config } = app.ctx;
    const list = JSON.parse(fs.readFileSync(process.argv[2] || config.seedFile, 'utf8'));
    const report = questions.importMany(list);
    console.log(`Imported ${report.created} question(s), skipped ${report.skipped} duplicate(s).`);
    if (report.errors.length) { console.error(report.errors); process.exitCode = 1; }
    await app.close();
  })();
}
