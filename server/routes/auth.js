'use strict';
const express = require('express');
const { HttpError, bad, wrap, str } = require('../util');

module.exports = function authRoutes(ctx) {
  const { db, auth, audit } = ctx;
  const r = express.Router();

  async function login(req, res, role) {
    const username = str(req.body && req.body.username, { name: 'Username', min: 1, max: 80 });
    const password = str(req.body && req.body.password, { name: 'Password', min: 1, max: 200, trim: false });
    const keys = [`ip:${req.ip}`, `${role}:${req.ip}:${username.toLowerCase()}`];
    for (const k of keys) {
      const c = auth.limiter.check(k);
      if (!c.allowed) {
        res.setHeader('Retry-After', String(Math.ceil(c.retryAfterMs / 1000)));
        throw new HttpError(429, `Too many failed attempts. Try again in ${Math.ceil(c.retryAfterMs / 60000)} minute(s).`);
      }
    }
    const row = role === 'admin'
      ? db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ? COLLATE NOCASE').get(username)
      : db.prepare('SELECT id, name, username, password_hash, members, batch_id FROM teams WHERE username = ? COLLATE NOCASE').get(username);
    let ok = false;
    if (row) ok = await auth.verifyPassword(password, row.password_hash); else await auth.burnTime(password);
    if (!ok) {
      keys.forEach((k) => auth.limiter.fail(k));
      audit({ type: role, name: username }, `${role}.login_failed`, role, null, { ip: req.ip });
      throw new HttpError(401, 'Wrong username or password');
    }
    keys.forEach((k) => auth.limiter.clear(k));
    auth.createSession(res, req, role, row.id);
    if (role === 'admin') {
      audit({ role: 'admin', admin: row }, 'admin.login', 'admin', row.id, { ip: req.ip });
      return res.json({ role, admin: { id: row.id, username: row.username } });
    }
    audit({ role: 'team', team: row }, 'team.login', 'team', row.id, { ip: req.ip });
    return res.json({ role, team: { id: row.id, name: row.name, members: JSON.parse(row.members || '[]') } });
  }

  r.post('/admin/login', wrap((req, res) => login(req, res, 'admin')));
  r.post('/team/login', wrap((req, res) => login(req, res, 'team')));

  r.post('/logout', (req, res) => {
    auth.destroySession(req);
    auth.clearCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!req.auth) return res.json({ role: null });
    if (req.auth.role === 'admin') return res.json({ role: 'admin', admin: req.auth.admin });
    const t = req.auth.team;
    return res.json({ role: 'team', team: { id: t.id, name: t.name, members: t.members } });
  });

  r.post('/admin/password', auth.requireAdmin, wrap(async (req, res) => {
    const current = str(req.body.current, { name: 'Current password', min: 1, max: 200, trim: false });
    const next = str(req.body.next, { name: 'New password', min: 8, max: 200, trim: false });
    const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(req.auth.admin.id);
    if (!(await auth.verifyPassword(current, row.password_hash))) throw bad('Current password is wrong');
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(next), req.auth.admin.id);
    audit(req.auth, 'admin.password_changed', 'admin', req.auth.admin.id);
    res.json({ ok: true });
  }));

  return r;
};
