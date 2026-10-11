'use strict';

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || null;
  }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const forbidden = (msg) => new HttpError(403, msg);
const notFound = (msg = 'Not found') => new HttpError(404, msg);
const conflict = (msg, extra) => new HttpError(409, msg, extra);

// Express 4 does not catch rejected promises by itself
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const now = () => Date.now();

function str(v, { name = 'value', min = 0, max = 500, trim = true } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  if (trim) v = v.trim();
  if (v.length < min) throw bad(`${name} is required`);
  if (v.length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return v;
}

function int(v, { name = 'value', min = -Infinity, max = Infinity, def } = {}) {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw bad(`${name} must be a whole number`);
  if (n < min || n > max) throw bad(`${name} must be between ${min} and ${max}`);
  return n;
}

function id(v, name = 'id') {
  return int(v, { name, min: 1, max: Number.MAX_SAFE_INTEGER });
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection as well as quoting
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, wrap, now, str, int, id, csvEscape, formatDuration };
