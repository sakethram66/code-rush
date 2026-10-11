'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { makeAuth, makeAudit, hashPassword, generatePassword } = require('./auth');
const { HttpError, now } = require('./util');
const { makeQuestions } = require('./services/questions');
const { makeScoring } = require('./services/scoring');
const { makeBatches } = require('./services/batches');
const { makeTeams } = require('./services/teams');
const { makeContest } = require('./services/contest');
const { JudgeQueue } = require('./judge/queue');
const { detectTools } = require('./judge/judge');
const { seedIfEmpty } = require('./seed');

const SETTING_DEFAULTS = { public_leaderboard: true };

function makeSettings(db) {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?');
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  return {
    get(key) { const r = get.get(key); return r ? JSON.parse(r.value) : SETTING_DEFAULTS[key]; },
    set(key, value) { put.run(key, JSON.stringify(value)); },
    all() { const o = {}; for (const k of Object.keys(SETTING_DEFAULTS)) o[k] = this.get(k); return o; },
  };
}

async function ensureAdmin(db, log) {
  if (db.prepare('SELECT COUNT(*) n FROM admins').get().n > 0) return null;
  const username = process.env.ADMIN_USERNAME || 'admin';
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = generatePassword(14); generated = true; }
  db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?,?,?)').run(username, await hashPassword(password), now());
  if (generated) {
    log(`\n  ┌──────────────────────────────────────────────────────────┐\n  │  First run: admin account created                         │\n  │    username: ${username.padEnd(44)}│\n  │    password: ${password.padEnd(44)}│\n  │  Change it after logging in (Account page).               │\n  └──────────────────────────────────────────────────────────┘\n`);
  } else {
    log(`Admin account "${username}" created from ADMIN_USERNAME / ADMIN_PASSWORD.`);
  }
  return { username, password, generated };
}

async function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const log = overrides.log || ((m) => console.log(m));
  const db = openDb(config.dbPath);
  const auth = makeAuth(db, config);
  const audit = makeAudit(db);
  const scoring = makeScoring(db);
  const questions = makeQuestions(db);
  const batches = makeBatches(db, scoring, audit, config);
  const teams = makeTeams(db, auth);
  const judgeQueue = new JudgeQueue(config.judge.concurrency);
  const contest = makeContest(db, batches, judgeQueue, config, audit);
  const settings = makeSettings(db);
  const ctx = { config, db, auth, audit, scoring, questions, batches, teams, contest, judgeQueue, settings };

  const adminInfo = await ensureAdmin(db, log);
  if (config.seedOnEmpty) {
    const seeded = seedIfEmpty(questions, config.seedFile);
    if (seeded) log(`Seeded question bank with ${seeded.created} questions.`);
  }
  const tools = detectTools();
  if (!tools.linuxHost) log('WARNING: code judging is disabled on this host. Run Code Rush on Linux or in Docker for sandboxed submissions.');
  else for (const [lang, ok] of Object.entries(tools.languages)) if (!ok) log(`WARNING: ${lang} toolchain not found - ${lang} submissions will fail.`);
  if (!tools.prlimit) log('WARNING: prlimit not found - resource limits are NOT enforced. Install util-linux.');
  if (!tools.isRoot) log('NOTE: not running as root - judged code runs as the server user. See README "Security" for hardening.');

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Question bank payloads can carry sizeable test cases (large hidden inputs for hard problems);
  // everything else on the API is small.
  app.use('/api/admin/questions', express.json({ limit: '25mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(auth.attach);
  app.use('/api', auth.csrfGuard);

  app.post('/api/admin/questions/import', auth.requireAdmin, (req, res) => {
    const list = Array.isArray(req.body) ? req.body : req.body && req.body.questions;
    const report = questions.importMany(list, { skipDuplicates: req.body && req.body.skipDuplicates !== false });
    audit(req.auth, 'questions.imported', 'question', null, { created: report.created, skipped: report.skipped, errors: report.errors.length });
    res.status(report.aborted ? 422 : 200).json(report);
  });

  app.use('/api/auth', require('./routes/auth')(ctx));
  app.use('/api/admin', require('./routes/admin')(ctx));
  app.use('/api/team', require('./routes/team')(ctx));
  app.use('/api', require('./routes/public')(ctx));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API endpoint')));

  app.use(express.static(config.publicDir, {
    index: 'index.html', maxAge: config.isProd ? '1h' : 0,
    setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get('*', (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      // Trigger / constraint violations carry a human readable message written for the organiser
      return res.status(409).json({ error: String(err.message).replace(/^.*constraint failed:\s*/i, '') });
    }
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server' });
  });

  // ---- background work ----
  const timers = [];
  timers.push(setInterval(() => { try { batches.expireDue(); } catch (e) { console.error('scheduler', e); } }, 1000));
  timers.push(setInterval(() => { try { auth.purgeExpired(); } catch (e) { console.error('purge', e); } }, 10 * 60 * 1000));
  timers.forEach((t) => t.unref());
  const recovered = contest.recover();
  if (recovered) log(`Re-queued ${recovered} unfinished submission(s) after restart.`);
  batches.expireDue();

  let server = null;
  function listen() {
    return new Promise((resolve) => {
      server = app.listen(config.port, config.host, () => resolve(server));
    });
  }
  async function close() {
    timers.forEach(clearInterval);
    judgeQueue.close();
    await judgeQueue.idle();
    if (server) await new Promise((r) => server.close(r));
    db.close();
  }

  return { app, ctx, db, config, listen, close, adminInfo, get server() { return server; } };
}

module.exports = { createApp };
