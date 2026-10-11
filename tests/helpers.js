'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/app');

const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'reference_solutions.json'), 'utf8'));

function tmpDir(prefix = 'coderush-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Minimal HTTP client with a cookie jar
class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async request(method, url, body, headers = {}) {
    const res = await fetch(this.base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) { const c = set.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* csv etc. */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  get(u) { return this.request('GET', u); }
  post(u, b = {}) { return this.request('POST', u, b); }
  put(u, b = {}) { return this.request('PUT', u, b); }
  del(u) { return this.request('DELETE', u); }
}

async function startServer(overrides = {}) {
  const dir = overrides.dir || tmpDir();
  const app = await createApp({
    dbPath: path.join(dir, 'test.db'), port: 0, host: '127.0.0.1', log: () => {},
    submissionCooldownMs: 0, loginMaxAttempts: 10,
    judge: { workDir: path.join(dir, 'judge'), concurrency: 2 },
    seedOnEmpty: true, ...overrides,
  });
  const server = await app.listen();
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, base, dir, client: () => new Client(base), close: () => app.close() };
}

async function adminClient(srv) {
  const c = srv.client();
  const r = await c.post('/api/auth/admin/login', { username: 'admin', password: 'test-admin-password' });
  if (r.status !== 200) throw new Error('admin login failed: ' + r.text);
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 60000, interval = 200 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timed out');
    await wait(interval);
  }
}

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-admin-password';

module.exports = { REF, tmpDir, Client, startServer, adminClient, wait, waitFor };
