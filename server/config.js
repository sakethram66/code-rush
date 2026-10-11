'use strict';
const path = require('path');

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const ROOT = path.resolve(__dirname, '..');

function loadConfig(overrides = {}) {
  const { judge: judgeOverride, ...rest } = overrides;
  const cfg = {
    root: ROOT,
    port: int('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'coderush.db'),
    publicDir: path.join(ROOT, 'public'),
    seedFile: path.join(ROOT, 'seed', 'questions.json'),
    isProd: process.env.NODE_ENV === 'production',
    cookieSecure: bool('COOKIE_SECURE', false),
    trustProxy: bool('TRUST_PROXY', false),
    adminSessionHours: int('ADMIN_SESSION_HOURS', 12),
    teamSessionHours: int('TEAM_SESSION_HOURS', 8),
    defaultBatchMinutes: int('BATCH_MINUTES', 25),
    maxCodeBytes: int('MAX_CODE_BYTES', 64 * 1024),
    maxCustomInputBytes: int('MAX_CUSTOM_INPUT_BYTES', 64 * 1024),
    submissionCooldownMs: int('SUBMISSION_COOLDOWN_MS', 3000),
    loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 10),
    loginWindowMs: int('LOGIN_WINDOW_MS', 5 * 60 * 1000),
    judge: {
      concurrency: int('JUDGE_CONCURRENCY', 2),
      workDir: process.env.JUDGE_WORK_DIR || path.join(require('os').tmpdir(), 'coderush-judge'),
      // uid/gid the judged programs run as when the server runs as root
      uid: int('JUDGE_UID', 65534),
      gid: int('JUDGE_GID', 65534),
      compileTimeoutMs: int('JUDGE_COMPILE_TIMEOUT_MS', 20000),
      maxOutputBytes: int('JUDGE_MAX_OUTPUT_BYTES', 1024 * 1024),
      // Multipliers applied to a question's base time limit
      timeMultiplier: { c: 1, java: 2, python: 3 },
      // Virtual memory headroom: interpreters/JVM reserve much more address space than they use
      memoryHeadroomMb: { c: 0, java: 0, python: 128 },
    },
    seedOnEmpty: bool('SEED_ON_EMPTY', true),
    ...rest,
  };
  cfg.judge = { ...cfg.judge, ...(judgeOverride || {}) };
  return cfg;
}

module.exports = { loadConfig, ROOT };
