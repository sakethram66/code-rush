'use strict';
// Usage: node scripts/create-admin.js <username> [password]
// Creates an admin, or resets the password if the username already exists.
const { openDb } = require('../server/db');
const { loadConfig } = require('../server/config');
const { hashPassword, generatePassword } = require('../server/auth');

(async () => {
  const [username, given] = process.argv.slice(2);
  if (!username) { console.error('Usage: node scripts/create-admin.js <username> [password]'); process.exit(1); }
  const password = given || generatePassword(14);
  if (password.length < 8) { console.error('Password must be at least 8 characters'); process.exit(1); }
  const db = openDb(loadConfig().dbPath);
  const hash = await hashPassword(password);
  const ex = db.prepare('SELECT id FROM admins WHERE username = ? COLLATE NOCASE').get(username);
  if (ex) db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, ex.id);
  else db.prepare('INSERT INTO admins (username, password_hash, created_at) VALUES (?,?,?)').run(username, hash, Date.now());
  if (ex) db.prepare('DELETE FROM sessions WHERE role = ? AND user_id = ?').run('admin', ex.id);
  console.log(`${ex ? 'Password reset' : 'Admin created'}: ${username} / ${password}`);
  db.close();
})();
