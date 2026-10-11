'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { HttpError, now } = require('./util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'cr_session';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
      { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

// Used so that unknown usernames cost the same time as known ones
let dummyHash;
async function burnTime(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password');
  await verifyPassword(password, dummyHash);
}

function generatePassword(len = 10) {
  // Unambiguous alphabet (no 0/O, 1/l/I) so passwords can be read out at an event
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

class LoginLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.map = new Map();
  }
  _fresh(key) {
    const t = now();
    const arr = (this.map.get(key) || []).filter((x) => t - x < this.windowMs);
    if (arr.length) this.map.set(key, arr); else this.map.delete(key);
    return arr;
  }
  check(key) {
    const arr = this._fresh(key);
    if (arr.length >= this.max) return { allowed: false, retryAfterMs: this.windowMs - (now() - arr[0]) };
    return { allowed: true };
  }
  fail(key) { const arr = this._fresh(key); arr.push(now()); this.map.set(key, arr); }
  clear(key) { this.map.delete(key); }
}

function makeAuth(db, config) {
  const q = {
    insert: db.prepare('INSERT INTO sessions (token_hash, role, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)'),
    get: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    del: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delUser: db.prepare('DELETE FROM sessions WHERE role = ? AND user_id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    admin: db.prepare('SELECT id, username FROM admins WHERE id = ?'),
    team: db.prepare('SELECT id, name, username, members, batch_id FROM teams WHERE id = ?'),
  };

  function createSession(res, req, role, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const hours = role === 'admin' ? config.adminSessionHours : config.teamSessionHours;
    const t = now();
    q.insert.run(sha256(token), role, userId, t, t + hours * 3600 * 1000, req.ip || '', String(req.headers['user-agent'] || '').slice(0, 200));
    const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${hours * 3600}`];
    if (config.cookieSecure) flags.push('Secure');
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${flags.join('; ')}`);
    return token;
  }

  function clearCookie(res) {
    const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (config.cookieSecure) flags.push('Secure');
    res.setHeader('Set-Cookie', `${COOKIE}=; ${flags.join('; ')}`);
  }

  function destroySession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) q.del.run(sha256(token));
  }

  // Populates req.auth = { role, admin|team } when a valid session cookie is present
  function attach(req, _res, next) {
    req.auth = null;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const s = q.get.get(sha256(token));
      if (s && s.expires_at > now()) {
        if (s.role === 'admin') {
          const admin = q.admin.get(s.user_id);
          if (admin) req.auth = { role: 'admin', admin };
        } else {
          const team = q.team.get(s.user_id);
          if (team) req.auth = { role: 'team', team: { ...team, members: JSON.parse(team.members || '[]') } };
        }
      }
    }
    next();
  }

  const requireAdmin = (req, _res, next) =>
    req.auth && req.auth.role === 'admin' ? next() : next(new HttpError(401, 'Admin login required'));
  const requireTeam = (req, _res, next) =>
    req.auth && req.auth.role === 'team' ? next() : next(new HttpError(401, 'Team login required'));

  // CSRF defence: SameSite=Strict cookie + JSON-only mutations + Origin must match Host
  function csrfGuard(req, _res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch (_) { return next(new HttpError(403, 'Bad origin')); }
      if (host !== req.headers.host) return next(new HttpError(403, 'Cross-origin request blocked'));
    }
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0) {
      return next(new HttpError(415, 'Content-Type must be application/json'));
    }
    next();
  }

  return {
    hashPassword, verifyPassword, burnTime, generatePassword,
    createSession, clearCookie, destroySession, attach, requireAdmin, requireTeam, csrfGuard,
    purgeExpired: () => q.purge.run(now()),
    revokeUserSessions: (role, id) => q.delUser.run(role, id),
    limiter: new LoginLimiter(config.loginMaxAttempts, config.loginWindowMs),
  };
}

function makeAudit(db) {
  const ins = db.prepare('INSERT INTO audit_log (ts, actor_type, actor_id, actor_name, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?,?)');
  return function audit(actor, action, entity, entityId, details) {
    let type = 'system', id = null, name = 'system';
    if (actor && actor.role === 'admin') { type = 'admin'; id = actor.admin.id; name = actor.admin.username; }
    else if (actor && actor.role === 'team') { type = 'team'; id = actor.team.id; name = actor.team.name; }
    else if (actor && actor.type) { ({ type, id = null, name = type } = actor); }
    ins.run(now(), type, id, name, action, entity || null, entityId || null, details ? JSON.stringify(details) : null);
  };
}

module.exports = { makeAuth, makeAudit, hashPassword, verifyPassword, generatePassword, COOKIE };
