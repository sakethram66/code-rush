'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { execute, outputsMatch, javaClassName } = require('../server/judge/judge');
const { makeScoring } = require('../server/services/scoring');
const { csvEscape, formatDuration } = require('../server/util');
const { hashPassword, verifyPassword } = require('../server/auth');

const START_MSG = 'Select 5 Easy, 10 Medium and 10 Hard questions to start this batch.';

function seedDb() {
  const db = openDb(':memory:');
  const ins = db.prepare(`INSERT INTO questions (title, difficulty, statement, created_at, updated_at) VALUES (?,?,?,1,1)`);
  const ids = { easy: [], medium: [], hard: [] };
  for (const [d, n] of [['easy', 6], ['medium', 11], ['hard', 11]]) {
    for (let i = 0; i < n; i++) ids[d].push(Number(ins.run(`${d}-${i}`, d, 's').lastInsertRowid));
  }
  db.prepare(`INSERT INTO batches (number, created_at) VALUES (1, 1)`).run();
  return { db, ids };
}
const pick = (ids) => [...ids.easy.slice(0, 5), ...ids.medium.slice(0, 10), ...ids.hard.slice(0, 10)];
const addAll = (db, ids, batchId, list) => {
  const diff = (id) => Object.keys(ids).find((k) => ids[k].includes(id));
  for (const id of list) db.prepare('INSERT INTO batch_questions (batch_id, question_id, difficulty) VALUES (?,?,?)').run(batchId, id, diff(id));
};

test('output comparison ignores trailing whitespace and blank lines only', () => {
  assert.ok(outputsMatch('1 2 3\n', '1 2 3'));
  assert.ok(outputsMatch('a  \r\nb\r\n\r\n', 'a\nb'));
  assert.ok(!outputsMatch('1 2  3', '1 2 3'));
  assert.ok(!outputsMatch('a\nb', 'a\n\nb'));
  assert.ok(!outputsMatch(' a', 'a'));
});

test('judge refuses to run submissions outside Linux', { skip: process.platform === 'linux' }, async () => {
  const result = await execute({ language: 'python', code: 'print(1)', cases: [] }, { maxOutputBytes: 1024 });
  assert.equal(result.status, 'internal_error');
  assert.match(result.message, /requires a Linux host/);
});

test('java class name detection', () => {
  assert.equal(javaClassName('public class Main {}'), 'Main');
  assert.equal(javaClassName('import java.util.*;\npublic final class Solver { }'), 'Solver');
  assert.equal(javaClassName('class Foo {}'), 'Main');
});

test('csv escaping neutralises formulas', () => {
  assert.equal(csvEscape('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(formatDuration(125000), '02:05');
});

test('password hashing round-trip', async () => {
  const h = await hashPassword('secret-pass');
  assert.ok(await verifyPassword('secret-pass', h));
  assert.ok(!(await verifyPassword('wrong', h)));
});

test('DB trigger: batch cannot start unless it has exactly 5 easy / 10 medium / 10 hard', () => {
  const { db, ids } = seedDb();
  assert.throws(() => db.prepare(`UPDATE batches SET status='running', started_at=1, ends_at=2 WHERE id=1`).run(), new RegExp(START_MSG.replace(/[.]/g, '\\.')));
  addAll(db, ids, 1, pick(ids).slice(0, 24)); // one short
  assert.throws(() => db.prepare(`UPDATE batches SET status='running' WHERE id=1`).run(), /Select 5 Easy/);
  addAll(db, ids, 1, [ids.hard[9], ids.hard[10]]); // 5/10/11 -> too many is invalid as well
  assert.throws(() => db.prepare(`UPDATE batches SET status='running' WHERE id=1`).run(), /Select 5 Easy/);
});

test('DB trigger: question set is immutable once the batch is running', () => {
  const { db, ids } = seedDb();
  addAll(db, ids, 1, pick(ids));
  db.prepare(`UPDATE batches SET status='running', started_at=1, ends_at=2 WHERE id=1`).run();
  assert.throws(() => db.prepare('DELETE FROM batch_questions WHERE batch_id=1').run(), /locked/);
  assert.throws(() => db.prepare('INSERT INTO batch_questions (batch_id, question_id, difficulty) VALUES (1,?,?)').run(ids.easy[5], 'easy'), /locked/);
  assert.throws(() => db.prepare("UPDATE batch_questions SET question_id=? WHERE batch_id=1 AND question_id=?").run(ids.easy[5], ids.easy[0]), /locked/);
  assert.throws(() => db.prepare('DELETE FROM batches WHERE id=1').run(), /audit trail/);
  assert.throws(() => db.prepare(`UPDATE batches SET status='draft' WHERE id=1`).run(), /cannot go back/);
  db.prepare(`UPDATE batches SET status='completed' WHERE id=1`).run();
  assert.throws(() => db.prepare(`UPDATE batches SET status='running' WHERE id=1`).run(), /completed batch/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM batch_questions WHERE batch_id=1').get().n, 25);
});

test('DB trigger: difficulty snapshot must match the question', () => {
  const { db, ids } = seedDb();
  assert.throws(() => db.prepare('INSERT INTO batch_questions (batch_id, question_id, difficulty) VALUES (1,?,?)').run(ids.easy[0], 'hard'), /Difficulty/);
});

test('DB trigger: teams cannot move into or out of a started batch', () => {
  const { db, ids } = seedDb();
  addAll(db, ids, 1, pick(ids));
  db.prepare(`INSERT INTO batches (number, created_at) VALUES (2, 1)`).run();
  db.prepare(`INSERT INTO teams (name, username, password_hash, batch_id, created_at) VALUES ('T','t','x',1,1)`).run();
  db.prepare(`UPDATE batches SET status='running', started_at=1, ends_at=2 WHERE id=1`).run();
  assert.throws(() => db.prepare('UPDATE teams SET batch_id=2 WHERE username=?').run('t'), /locked/);
  assert.throws(() => db.prepare('DELETE FROM teams WHERE username=?').run('t'), /audit/);
  assert.throws(() => db.prepare(`INSERT INTO teams (name, username, password_hash, batch_id, created_at) VALUES ('U','u','x',1,1)`).run(), /already started/);
});

test('leaderboard: 10 points per solve, ranked by score then time, ties share a rank', () => {
  const { db, ids } = seedDb();
  addAll(db, ids, 1, pick(ids));
  const mk = (n) => Number(db.prepare(`INSERT INTO teams (name, username, password_hash, batch_id, created_at) VALUES (?,?,'x',1,1)`).run(n, n).lastInsertRowid);
  const [a, b, c, d, e] = ['A', 'B', 'C', 'D', 'E'].map(mk);
  db.prepare(`UPDATE batches SET status='running', started_at=1000, ends_at=999999 WHERE id=1`).run();
  const solve = (team, q, at) => {
    const sid = Number(db.prepare(`INSERT INTO submissions (team_id,batch_id,question_id,language,code,status,submitted_at) VALUES (?,1,?,'python','x','accepted',?)`).run(team, q, at).lastInsertRowid);
    db.prepare('INSERT INTO solves (team_id,question_id,batch_id,submission_id,solved_at) VALUES (?,?,1,?,?)').run(team, q, sid, at);
  };
  const q = pick(ids);
  for (let i = 0; i < 25; i++) solve(a, q[i], 2000 + i);        // 250 points, last solve at +1024s..
  for (let i = 0; i < 3; i++) solve(b, q[i], 61000);              // 30 pts, 60s
  for (let i = 0; i < 3; i++) solve(c, q[i], 61000);              // 30 pts, 60s (tie with B)
  for (let i = 0; i < 3; i++) solve(d, q[i], 31000);              // 30 pts, 30s (faster)
  const lb = makeScoring(db).leaderboard();
  const by = Object.fromEntries(lb.map((r) => [r.team, r]));
  assert.equal(by.A.score, 250); assert.equal(by.A.solved, 25); assert.equal(by.A.rank, 1);
  assert.equal(by.D.rank, 2);
  assert.equal(by.B.rank, 3); assert.equal(by.C.rank, 3);
  assert.equal(by.E.score, 0); assert.equal(by.E.rank, 5); assert.equal(by.E.time, '—');
  assert.equal(by.D.time, '00:30');
  // a solve for a question outside the batch is rejected by the DB
  db.prepare(`INSERT INTO questions (title, difficulty, statement, created_at, updated_at) VALUES ('x','easy','s',1,1)`).run();
  assert.throws(() => db.prepare('INSERT INTO solves (team_id,question_id,batch_id,submission_id,solved_at) VALUES (?,?,1,1,5)').run(e, 9999), /not part of this batch/);
});
