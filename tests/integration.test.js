'use strict';
// Full contest flow against a real server instance (real SQLite file, real sandboxed judge).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { REF, startServer, adminClient, waitFor, wait } = require('./helpers');
const { createApp } = require('../server/app');

const START_MSG = 'Select 5 Easy, 10 Medium and 10 Hard questions to start this batch.';

const S = {}; // shared state across the ordered tests below

async function ids(admin, difficulty) {
  const r = await admin.get(`/api/admin/questions?difficulty=${difficulty}&pageSize=100`);
  return r.body.items.map((q) => q.id);
}
async function itemsByTitle(admin, difficulty) {
  const r = await admin.get(`/api/admin/questions?difficulty=${difficulty}&pageSize=100`);
  return Object.fromEntries(r.body.items.map((q) => [q.title, q.id]));
}

async function submitAndWait(client, qid, language, code) {
  const r = await client.post(`/api/team/questions/${qid}/submit`, { language, code });
  assert.equal(r.status, 202, r.text);
  return waitFor(async () => {
    const s = await client.get(`/api/team/submissions/${r.body.id}`);
    return !['queued', 'judging'].includes(s.body.status) ? s.body : null;
  }, { timeout: 120000 });
}

test.before(async () => {
  S.srv = await startServer();
  S.admin = await adminClient(S.srv);
});
test.after(async () => { await S.srv.close(); });

test('security: admin API needs a session, wrong passwords are rejected', async () => {
  const anon = S.srv.client();
  assert.equal((await anon.get('/api/admin/overview')).status, 401);
  assert.equal((await anon.get('/api/admin/questions')).status, 401);
  assert.equal((await anon.post('/api/admin/batches', {})).status, 401);
  assert.equal((await anon.get('/api/team/state')).status, 401);
  const bad = await anon.post('/api/auth/admin/login', { username: 'admin', password: 'nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'Wrong username or password');
  const me = await S.admin.get('/api/auth/me');
  assert.equal(me.body.role, 'admin');
});

test('security: cookies are HttpOnly + SameSite=Strict, cross-origin writes are blocked, headers are set', async () => {
  const res = await fetch(S.srv.base + '/api/auth/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test-admin-password' }),
  });
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const evil = await S.admin.request('POST', '/api/admin/batches', {}, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const text = await fetch(S.srv.base + '/api/admin/batches', {
    method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: S.admin.cookie }, body: 'not-json',
  });
  assert.equal(text.status, 415);
  assert.equal((await S.admin.get('/api/admin/batches')).body.batches.length, 0, 'neither malformed request created a batch');
});

test('security: login is rate limited', async () => {
  const c = S.srv.client();
  let last;
  for (let i = 0; i < 11; i++) last = await c.post('/api/auth/team/login', { username: 'ghost', password: 'x' + i });
  assert.equal(last.status, 429);
  // Confirmed the limiter engages; clear it so it does not poison later tests sharing this loopback IP.
  S.srv.app.ctx.auth.limiter.clear('ip:127.0.0.1');
  S.srv.app.ctx.auth.limiter.clear('team:127.0.0.1:ghost');
});

test('question bank is seeded: 10 easy, 20 medium, 20 hard', async () => {
  const o = await S.admin.get('/api/admin/overview');
  assert.deepEqual([o.body.questions.easy, o.body.questions.medium, o.body.questions.hard], [10, 20, 20]);
  assert.deepEqual(o.body.judge.languages, { c: true, java: true, python: true });
  const list = await S.admin.get('/api/admin/questions?search=knapsack');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].times_used, 0);
});

test('question CRUD, validation and import', async () => {
  const good = {
    title: 'Echo', difficulty: 'easy', topic: 'IO', statement: 'Print the input', input_format: 'x', output_format: 'x',
    tests: [{ input: 'hi\n', output: 'hi\n', sample: true }, { input: 'yo\n', output: 'yo\n' }],
  };
  assert.equal((await S.admin.post('/api/admin/questions', { ...good, difficulty: 'legendary' })).status, 400);
  assert.equal((await S.admin.post('/api/admin/questions', { ...good, tests: [{ input: 'a', output: 'a' }] })).status, 400); // no sample
  assert.equal((await S.admin.post('/api/admin/questions', { ...good, tests: [{ input: 'a', output: 'a', sample: true }] })).status, 400); // no hidden
  const created = await S.admin.post('/api/admin/questions', good);
  assert.equal(created.status, 201);
  assert.equal((await S.admin.post('/api/admin/questions', good)).status, 409); // duplicate title
  const got = await S.admin.get(`/api/admin/questions/${created.body.id}`);
  assert.equal(got.body.tests.length, 2);
  assert.equal((await S.admin.put(`/api/admin/questions/${created.body.id}`, { ...good, topic: 'Basics' })).status, 200);
  assert.equal((await S.admin.del(`/api/admin/questions/${created.body.id}`)).status, 200);
  const imp = await S.admin.post('/api/admin/questions/import', { questions: [{ ...good, title: 'Echo 2' }, { ...good, title: 'Echo 3' }] });
  assert.equal(imp.body.created, 2);
  const again = await S.admin.post('/api/admin/questions/import', { questions: [{ ...good, title: 'Echo 2' }] });
  assert.equal(again.body.skipped, 1);
  const badImp = await S.admin.post('/api/admin/questions/import', { questions: [{ title: 'x' }] });
  assert.equal(badImp.status, 422);
  for (const t of ['Echo 2', 'Echo 3']) {
    const f = await S.admin.get(`/api/admin/questions?search=${encodeURIComponent(t)}`);
    await S.admin.del(`/api/admin/questions/${f.body.items[0].id}`);
  }
  assert.equal((await S.admin.get('/api/admin/questions/export')).body.length, 50);
});

test('batch: manual selection is validated and start is blocked until exactly 5/10/10', async () => {
  S.easy = await ids(S.admin, 'easy'); S.medium = await ids(S.admin, 'medium'); S.hard = await ids(S.admin, 'hard');
  S.easyByTitle = await itemsByTitle(S.admin, 'easy');
  const created = await S.admin.post('/api/admin/batches', { name: 'Morning' });
  assert.equal(created.status, 201);
  S.b1 = created.body.id;
  assert.equal(created.body.batch.duration_minutes, 25);
  assert.equal(created.body.batch.number, 1);

  // nothing is ever selected automatically
  const empty = await S.admin.get(`/api/admin/batches/${S.b1}/selection`);
  assert.deepEqual(empty.body.question_ids, []);
  assert.equal(empty.body.validation.valid, false);

  // starting with no teams / no selection gives the required message
  let r = await S.admin.post(`/api/admin/batches/${S.b1}/start`);
  assert.equal(r.status, 400); assert.equal(r.body.error, START_MSG);

  // too many of one difficulty
  r = await S.admin.put(`/api/admin/batches/${S.b1}/selection`, { question_ids: S.easy.slice(0, 6) });
  assert.equal(r.status, 400); assert.match(r.body.error, /at most 5 easy/);
  // duplicates / unknown ids
  assert.equal((await S.admin.put(`/api/admin/batches/${S.b1}/selection`, { question_ids: [S.easy[0], S.easy[0]] })).status, 400);
  assert.equal((await S.admin.put(`/api/admin/batches/${S.b1}/selection`, { question_ids: [999999] })).status, 400);

  // 4 easy + 10 medium + 10 hard is not enough
  const short = [...S.easy.slice(0, 4), ...S.medium.slice(0, 10), ...S.hard.slice(0, 10)];
  r = await S.admin.put(`/api/admin/batches/${S.b1}/selection`, { question_ids: short });
  assert.equal(r.body.validation.valid, false);
  assert.deepEqual([r.body.validation.easy, r.body.validation.medium, r.body.validation.hard], [4, 10, 10]);
  r = await S.admin.post(`/api/admin/batches/${S.b1}/start`);
  assert.equal(r.status, 400); assert.equal(r.body.error, START_MSG);

  // the admin picks a specific (non-first) set: the exact ids must be stored as given.
  // A few specific easy titles are pinned in because later tests submit solutions for them by name.
  const pinned = ['Sum of Two Numbers', 'Even or Odd', 'Leap Year'].map((t) => S.easyByTitle[t]);
  const fillerEasy = S.easy.filter((i) => !pinned.includes(i)).slice(0, 2);
  S.set1 = [...pinned, ...fillerEasy, ...S.medium.slice(5, 15), ...S.hard.slice(3, 13)];
  r = await S.admin.put(`/api/admin/batches/${S.b1}/selection`, { question_ids: S.set1 });
  assert.equal(r.status, 200); assert.equal(r.body.validation.valid, true);
  const sel = await S.admin.get(`/api/admin/batches/${S.b1}/selection`);
  assert.deepEqual([...sel.body.question_ids].sort((a, b) => a - b), [...S.set1].sort((a, b) => a - b));
});

test('teams: create, bulk-create and assign to the batch', async () => {
  let r = await S.admin.post('/api/admin/teams', { name: 'Alpha', members: ['Asha', 'Ben'], batch_id: S.b1, username: 'alpha', password: 'alpha-pass' });
  assert.equal(r.status, 201);
  r = await S.admin.post('/api/admin/teams', { name: 'Bravo', members: 'Chen, Dee', batch_id: S.b1 });
  assert.equal(r.status, 201); assert.ok(r.body.password.length >= 10); S.bravo = r.body;
  assert.equal((await S.admin.post('/api/admin/teams', { name: 'alpha', members: ['x'] })).status, 409);
  const bulk = await S.admin.post('/api/admin/teams/bulk', { text: 'Charlie | Eve, Finn\nbad line without pipe\nDelta | Gus', batch_id: S.b1 });
  assert.equal(bulk.body.created.length, 2); assert.equal(bulk.body.errors.length, 1);
  const list = await S.admin.get('/api/admin/teams');
  assert.equal(list.body.teams.length, 4);
  // remove the two bulk teams again (still draft) so the batch has exactly Alpha and Bravo
  for (const t of bulk.body.created) assert.equal((await S.admin.del(`/api/admin/teams/${t.id}`)).status, 200);
  S.alphaId = list.body.teams.find((t) => t.name === 'Alpha').id;
});

test('team login and lobby before the batch starts', async () => {
  S.alpha = S.srv.client();
  assert.equal((await S.alpha.post('/api/auth/team/login', { username: 'alpha', password: 'wrong-pass' })).status, 401);
  assert.equal((await S.alpha.post('/api/auth/team/login', { username: 'alpha', password: 'alpha-pass' })).status, 200);
  const st = await S.alpha.get('/api/team/state');
  assert.equal(st.body.phase, 'waiting'); assert.equal(st.body.batch.number, 1);
  assert.equal(st.body.questions, undefined);
  assert.equal((await S.alpha.get(`/api/team/questions/${S.set1[0]}`)).status, 403);
  assert.equal((await S.alpha.get('/api/admin/overview')).status, 401); // team cannot use the admin API
  S.bravoC = S.srv.client();
  assert.equal((await S.bravoC.post('/api/auth/team/login', { username: S.bravo.username, password: S.bravo.password })).status, 200);
});

test('start batch: locks the question set, fixes the order, starts the server timer', async () => {
  const before = Date.now();
  const r = await S.admin.post(`/api/admin/batches/${S.b1}/start`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, 'running');
  assert.ok(r.body.started_at >= before);
  assert.equal(r.body.ends_at - r.body.started_at, 25 * 60 * 1000);

  // locked: selection, settings and deletion are all refused
  for (const p of [
    S.admin.put(`/api/admin/batches/${S.b1}/selection`, { question_ids: [...S.easy.slice(0, 5), ...S.medium.slice(0, 10), ...S.hard.slice(0, 10)] }),
    S.admin.put(`/api/admin/batches/${S.b1}`, { duration_minutes: 5 }),
    S.admin.del(`/api/admin/batches/${S.b1}`),
    S.admin.post(`/api/admin/batches/${S.b1}/start`),
  ]) assert.equal((await p).status, 409);
  // a used question can no longer be edited or deleted
  const q = await S.admin.get(`/api/admin/questions/${S.set1[0]}`);
  assert.equal(q.body.locked, true);
  assert.equal((await S.admin.put(`/api/admin/questions/${S.set1[0]}`, q.body)).status, 409);
  assert.equal((await S.admin.del(`/api/admin/questions/${S.set1[0]}`)).status, 409);
  // teams can no longer be added
  assert.equal((await S.admin.post('/api/admin/teams', { name: 'Late', members: ['x'], batch_id: S.b1 })).status, 409);

  // even raw SQL cannot change the set (DB trigger)
  const db = S.srv.app.db;
  assert.throws(() => db.prepare('DELETE FROM batch_questions WHERE batch_id = ?').run(S.b1), /locked/);
  assert.throws(() => db.prepare('UPDATE batch_questions SET question_id = ? WHERE batch_id = ? AND question_id = ?').run(S.easy[0], S.b1, S.set1[0]), /locked/);

  // usage information is now visible in the bank
  const used = await S.admin.get(`/api/admin/questions/${S.set1[0]}`);
  assert.deepEqual(used.body.used_in, [1]);
  const unused = await S.admin.get('/api/admin/questions?usage=unused&pageSize=100');
  assert.equal(unused.body.total, 25);
  const usedList = await S.admin.get('/api/admin/questions?usage=used&pageSize=100');
  assert.equal(usedList.body.total, 25);
});

test('every team receives the same 25 questions in the same fixed order (Easy 1-5, Medium 6-15, Hard 16-25)', async () => {
  const a = (await S.alpha.get('/api/team/state')).body;
  const b = (await S.bravoC.get('/api/team/state')).body;
  assert.equal(a.phase, 'running');
  assert.equal(a.questions.length, 25);
  assert.deepEqual(a.questions.map((q) => q.id), b.questions.map((q) => q.id));
  assert.deepEqual([...a.questions.map((q) => q.id)].sort((x, y) => x - y), [...S.set1].sort((x, y) => x - y));
  assert.deepEqual(a.questions.map((q) => q.position), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.deepEqual(a.questions.map((q) => q.difficulty), [...Array(5).fill('easy'), ...Array(10).fill('medium'), ...Array(10).fill('hard')]);
  assert.deepEqual(a.counts, { easy: 5, medium: 10, hard: 10 });
  assert.ok(a.remaining_ms > 24 * 60 * 1000 && a.remaining_ms <= 25 * 60 * 1000);
  assert.equal(a.score, 0); assert.equal(a.max_score, 250);
  S.qs = a.questions;
});

test('problem view exposes samples only, never hidden tests or expected outputs', async () => {
  const q = S.qs[0];
  const r = await S.alpha.get(`/api/team/questions/${q.id}`);
  assert.equal(r.status, 200);
  const full = await S.admin.get(`/api/admin/questions/${q.id}`);
  const hidden = full.body.tests.filter((t) => !t.is_sample);
  assert.ok(hidden.length >= 3);
  assert.equal(r.body.samples.length, full.body.tests.filter((t) => t.is_sample).length);
  for (const h of hidden) {
    // Hidden inputs are always distinctive; check those. A short hidden *output* can coincidentally
    // match a sample's output (e.g. both happen to be "9\n"), so pair it with its own input to be sure
    // it's genuinely absent rather than a coincidental short numeric match.
    assert.ok(!r.text.includes(JSON.stringify(h.input)), 'hidden input leaked');
    assert.ok(!r.text.includes(JSON.stringify(h.input) + JSON.stringify(h.expected_output)), 'hidden input+output pair leaked');
  }
  // a question outside the batch is not reachable
  const outside = S.easy.find((id) => !S.set1.includes(id));
  assert.equal((await S.alpha.get(`/api/team/questions/${outside}`)).status, 404);
});

test('autosave and resume: drafts persist per language across sessions', async () => {
  const q = S.qs[0];
  assert.equal((await S.alpha.put(`/api/team/questions/${q.id}/draft`, { language: 'python', code: 'print("draft one")' })).status, 200);
  assert.equal((await S.alpha.put(`/api/team/questions/${q.id}/draft`, { language: 'c', code: 'int main(){return 0;}' })).status, 200);
  assert.equal((await S.alpha.put(`/api/team/questions/${q.id}/draft`, { language: 'cobol', code: 'x' })).status, 400);
  await S.alpha.post('/api/auth/logout');
  assert.equal((await S.alpha.get('/api/team/state')).status, 401);
  const fresh = S.srv.client(); // brand new browser
  await fresh.post('/api/auth/team/login', { username: 'alpha', password: 'alpha-pass' });
  const r = await fresh.get(`/api/team/questions/${q.id}`);
  assert.equal(r.body.drafts.python.code, 'print("draft one")');
  assert.equal(r.body.drafts.c.code, 'int main(){return 0;}');
  assert.equal(r.body.last_language, 'c');
  S.alpha = fresh;
});

test('run: samples and custom input are never scored', async () => {
  const q = S.qs.find((x) => x.title === 'Sum of Two Numbers');
  const okCode = 'a,b=map(int,input().split())\nprint(a+b)';
  const r1 = await S.alpha.post(`/api/team/questions/${q.id}/run`, { language: 'python', code: okCode, mode: 'samples' });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.body.status, 'accepted');
  assert.ok(r1.body.cases.length >= 1 && r1.body.cases.every((c) => c.status === 'accepted' && c.input !== undefined));
  const r2 = await S.alpha.post(`/api/team/questions/${q.id}/run`, { language: 'python', code: okCode, mode: 'custom', input: '40 2\n' });
  assert.equal(r2.status, 400, r2.text);
  assert.match(r2.body.message || r2.text, /custom input.*disabled|mode must be samples/i);
  const r3 = await S.alpha.post(`/api/team/questions/${q.id}/run`, { language: 'python', code: 'print(1)', mode: 'samples' });
  assert.equal(r3.body.status, 'wrong_answer');
  const r4 = await S.alpha.post(`/api/team/questions/${q.id}/run`, { language: 'c', code: 'int main(){ oops }', mode: 'samples' });
  assert.equal(r4.body.status, 'compile_error'); assert.ok(r4.body.message.length > 0);
  const st = await S.alpha.get('/api/team/state');
  assert.equal(st.body.score, 0); // running never scores
  assert.equal(st.body.questions.find((x) => x.id === q.id).status, 'unsolved');
});

test('contest controls: pause/resume and disqualify team', async () => {
  const batch = (await S.admin.post('/api/admin/batches', { name: 'Pause round', duration_minutes: 25 })).body.batch;
  const team = (await S.admin.post('/api/admin/teams', { name: 'Zulu', members: ['Zoe'], batch_id: batch.id, username: 'zulu', password: 'zulu-pass' })).body;
  await S.admin.put(`/api/admin/batches/${batch.id}/selection`, { question_ids: S.qs.slice(0, 25).map((q) => q.id) });
  await S.admin.post(`/api/admin/batches/${batch.id}/start`);

  const c = S.srv.client();
  assert.equal((await c.post('/api/auth/team/login', { username: 'zulu', password: 'zulu-pass' })).status, 200);

  const pause = await S.admin.post(`/api/admin/batches/${batch.id}/pause`);
  assert.equal(pause.status, 200, pause.text);
  assert.equal(pause.body.status, 'paused');

  const resumed = await S.admin.post(`/api/admin/batches/${batch.id}/resume`);
  assert.equal(resumed.status, 200, resumed.text);
  assert.equal(resumed.body.status, 'running');

  const disq = await S.admin.post(`/api/admin/teams/${team.id}/disqualify`, { reason: 'Test disqualification' });
  assert.equal(disq.status, 200, disq.text);
  assert.equal(disq.body.disqualified, true);

  const state = await c.get('/api/team/state');
  assert.equal(state.status, 200, state.text);
  assert.equal(state.body.disqualified, true);
});

test('submissions: C, Java and Python are judged; wrong answers do not score and never leak test data', async () => {
  const sum = S.qs.find((x) => x.title === 'Sum of Two Numbers');
  const c = '#include <stdio.h>\nint main(){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b);return 0;}';
  const java = 'import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);long a=s.nextLong(),b=s.nextLong();System.out.println(a+b);}}';

  // truncation bug: fits in a 16-bit short for the small sample sums, wraps around for the large hidden ones
  const bugC = '#include <stdio.h>\nint main(){long long a,b;scanf("%lld %lld",&a,&b);short r=(short)(a+b);printf("%d\\n",r);return 0;}';
  const wa = await submitAndWait(S.bravoC, sum.id, 'c', bugC);
  assert.equal(wa.status, 'wrong_answer');
  assert.ok(wa.failed_test > 2, 'samples pass, a hidden test fails');
  assert.ok(!JSON.stringify(wa).includes('1000000000'), 'no test data in the verdict');
  let st = (await S.bravoC.get('/api/team/state')).body;
  assert.equal(st.score, 0); assert.equal(st.questions.find((x) => x.id === sum.id).status, 'attempted');

  const ce = await submitAndWait(S.bravoC, sum.id, 'java', 'public class Main { void x( }');
  assert.equal(ce.status, 'compile_error'); assert.ok(ce.message.includes('error'));

  const okC = await submitAndWait(S.bravoC, sum.id, 'c', c);
  assert.equal(okC.status, 'accepted'); assert.equal(okC.passed_tests, okC.total_tests);
  st = (await S.bravoC.get('/api/team/state')).body;
  assert.equal(st.score, 10); assert.equal(st.solved, 1);
  assert.equal(st.questions.find((x) => x.id === sum.id).status, 'solved');

  // a second accepted answer never adds points for the same question
  const okJava = await submitAndWait(S.bravoC, sum.id, 'java', java);
  assert.equal(okJava.status, 'accepted');
  assert.equal((await S.bravoC.get('/api/team/state')).body.score, 10);

  const leap = S.qs.find((x) => x.title === 'Leap Year');
  const py = await submitAndWait(S.bravoC, leap.id, 'python', REF['Leap Year']);
  assert.equal(py.status, 'accepted');
  assert.equal((await S.bravoC.get('/api/team/state')).body.score, 20);

  // infinite loop -> time limit, and it still leaves the queue clean
  const tle = await submitAndWait(S.bravoC, S.qs.find((x) => x.title === 'Even or Odd').id, 'python', 'while True: pass');
  assert.equal(tle.status, 'time_limit');
});

test('Alpha solves all 25 questions (Python reference solutions) and reaches the maximum score of 250', async () => {
  for (const q of S.qs) {
    const res = await submitAndWait(S.alpha, q.id, 'python', REF[q.title]);
    assert.equal(res.status, 'accepted', `${q.title}: ${res.status} (${res.message || ''}) failed test ${res.failed_test}`);
  }
  const st = (await S.alpha.get('/api/team/state')).body;
  assert.equal(st.score, 250); assert.equal(st.solved, 25);
  assert.ok(st.questions.every((q) => q.status === 'solved'));
});

test('leaderboard: combined ranking with rank, team, batch, solved, score, time', async () => {
  const pub = S.srv.client();
  const r = await pub.get('/api/leaderboard');
  assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, 2);
  assert.equal(r.body.rows[0].team, 'Alpha'); assert.equal(r.body.rows[0].rank, 1);
  assert.equal(r.body.rows[0].score, 250); assert.equal(r.body.rows[0].batch, 1); assert.equal(r.body.rows[0].solved, 25);
  assert.match(r.body.rows[0].time, /^\d\d:\d\d$/);
  assert.equal(r.body.rows[1].team, 'Bravo'); assert.equal(r.body.rows[1].rank, 2); assert.equal(r.body.rows[1].score, 20);
  assert.equal(r.body.rows[0].members, undefined); assert.equal(r.body.rows[0].team_id, undefined);
  // organiser can hide it from the public and teams, but admin still sees it
  assert.equal((await S.admin.put('/api/admin/settings', { public_leaderboard: false })).status, 200);
  assert.equal((await pub.get('/api/leaderboard')).status, 403);
  assert.equal((await S.admin.get('/api/leaderboard')).status, 200);
  await S.admin.put('/api/admin/settings', { public_leaderboard: true });
  const csv = await S.admin.get('/api/admin/leaderboard.csv');
  assert.match(csv.text, /^Rank,Team,Batch,Solved,Score,Time/);
  assert.match(csv.text, /Alpha,1,25,250/);
});

test('sandbox: judged code cannot read the database or reach the network', async () => {
  const dbPath = S.srv.app.config.dbPath;
  const q = S.qs.find((x) => x.title === 'Leap Year');
  const probe = `#include <stdio.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
int main(){
  FILE*f=fopen("${dbPath}","r"); printf("%s\\n", f?"LEAK":"denied");
  int s=socket(AF_INET,SOCK_STREAM,0); struct sockaddr_in a={0}; a.sin_family=AF_INET; a.sin_port=htons(80); inet_pton(AF_INET,"1.1.1.1",&a.sin_addr);
  printf("%s\\n", connect(s,(void*)&a,sizeof a)==0?"NET":"nonet"); return 0; }`;
  const r = await S.alpha.post(`/api/team/questions/${q.id}/run`, { language: 'c', code: probe, mode: 'custom', input: '1\n' });
  assert.equal(r.status, 200);
  const out = r.body.cases[0].actual;
  if (process.getuid && process.getuid() === 0) {
    assert.match(out, /denied/); assert.match(out, /nonet/);
  } else {
    assert.match(out, /nonet|NET/); // non-root hosts only get resource limits (documented)
  }
});

test('batch history keeps the locked question set, teams and results for audit', async () => {
  const h = await S.admin.get(`/api/admin/batches/${S.b1}/history`);
  assert.equal(h.status, 200);
  assert.equal(h.body.questions.easy.length, 5); assert.equal(h.body.questions.medium.length, 10); assert.equal(h.body.questions.hard.length, 10);
  assert.deepEqual(h.body.questions.easy.map((q) => q.id), S.qs.slice(0, 5).map((q) => q.id));
  assert.equal(h.body.teams.length, 2);
  assert.equal(h.body.results[0].team, 'Alpha');
  assert.equal(h.body.questions.hard[0].solved_by, 1);
  const csv = await S.admin.get(`/api/admin/batches/${S.b1}/results.csv`);
  assert.match(csv.text, /Alpha/);
  const audit = await S.admin.get('/api/admin/audit?limit=200');
  assert.ok(audit.body.entries.some((e) => e.action === 'batch.started' && e.details.questions.length === 25));
  assert.ok(audit.body.entries.some((e) => e.action === 'admin.login'));
});

test('a second batch can reuse questions; usage counts are shown to the organiser', async () => {
  const b2 = await S.admin.post('/api/admin/batches', { name: 'Afternoon', duration_minutes: 25 });
  assert.equal(b2.body.batch.number, 2);
  S.b2 = b2.body.id;
  const cand = await S.admin.get(`/api/admin/batches/${S.b2}/candidates?difficulty=easy&pageSize=100`);
  assert.equal(cand.body.total, 10);
  const usedOne = cand.body.items.find((q) => q.id === S.set1[0]);
  assert.equal(usedOne.times_used, 1); assert.deepEqual(usedOne.used_in, [1]);
  assert.equal(cand.body.items.filter((q) => q.times_used === 0).length, 5);
  const unusedOnly = await S.admin.get(`/api/admin/batches/${S.b2}/candidates?difficulty=easy&usage=unused`);
  assert.equal(unusedOnly.body.total, 5);
});

test('timer: server rejects code after the deadline and completes the batch automatically', async () => {
  // Batch 2 = the other 25 questions, with a team; then shorten its deadline to ~2s (as if 25 min had elapsed).
  const sel = [...S.easy.filter((i) => !S.set1.includes(i)), ...S.medium.filter((i) => !S.set1.includes(i)).slice(0, 10), ...S.hard.filter((i) => !S.set1.includes(i)).slice(0, 10)];
  assert.equal(sel.length, 25);
  assert.equal((await S.admin.put(`/api/admin/batches/${S.b2}/selection`, { question_ids: sel })).body.validation.valid, true);
  const t = await S.admin.post('/api/admin/teams', { name: 'Echo', members: ['Zed'], batch_id: S.b2, username: 'echo', password: 'echo-pass' });
  assert.equal(t.status, 201);
  assert.equal((await S.admin.post(`/api/admin/batches/${S.b2}/start`)).status, 200);
  const echo = S.srv.client();
  await echo.post('/api/auth/team/login', { username: 'echo', password: 'echo-pass' });
  const st = (await echo.get('/api/team/state')).body;
  const ev = st.questions.find((q) => q.title === 'Even or Odd') || st.questions[0];
  S.srv.app.db.prepare('UPDATE batches SET ends_at = ? WHERE id = ?').run(Date.now() + 1500, S.b2);
  const near = await echo.post(`/api/team/questions/${ev.id}/submit`, { language: 'python', code: REF[ev.title] });
  assert.equal(near.status, 202); // still inside the time
  await wait(2600);
  const late = await echo.post(`/api/team/questions/${ev.id}/submit`, { language: 'python', code: REF[ev.title] });
  assert.equal(late.status, 403); assert.match(late.body.error, /Time is up/);
  assert.equal((await echo.post(`/api/team/questions/${ev.id}/run`, { language: 'python', code: 'print(1)', mode: 'custom', input: '' })).status, 403);
  assert.equal((await echo.put(`/api/team/questions/${ev.id}/draft`, { language: 'python', code: 'x' })).status, 403);
  const after = (await echo.get('/api/team/state')).body;
  assert.equal(after.phase, 'finished'); assert.equal(after.remaining_ms, 0);
  assert.equal((await S.admin.get(`/api/admin/batches/${S.b2}`)).body.status, 'completed');
  // the submission made before the deadline still gets judged and counted
  const judged = await waitFor(async () => {
    const s = await echo.get(`/api/team/submissions/${near.body.id}`);
    return s.body.status === 'accepted' ? s.body : null;
  });
  assert.equal(judged.status, 'accepted');
  assert.equal((await echo.get('/api/team/state')).body.score, 10);
});

test('admin can end a running batch early', async () => {
  const b3 = (await S.admin.post('/api/admin/batches', {})).body.id;
  assert.equal((await S.admin.post(`/api/admin/batches/${b3}/end`)).status, 409); // not running
  assert.equal((await S.admin.del(`/api/admin/batches/${b3}`)).status, 200);      // drafts can be deleted
});

test('restart: running batches keep their deadline and unfinished submissions are judged again', async () => {
  // Batch 4 running with one team; leave a submission stuck in "judging" as if the server crashed mid-run.
  const admin = S.admin;
  const fresh = [...S.easy.slice(0, 5), ...S.medium.slice(0, 10), ...S.hard.slice(0, 10)];
  const b4 = (await admin.post('/api/admin/batches', { duration_minutes: 30 })).body.id;
  await admin.put(`/api/admin/batches/${b4}/selection`, { question_ids: fresh });
  await admin.post('/api/admin/teams', { name: 'Foxtrot', members: ['Q'], batch_id: b4, username: 'fox', password: 'fox-pass' });
  const started = (await admin.post(`/api/admin/batches/${b4}/start`)).body;
  const fox = S.srv.client();
  await fox.post('/api/auth/team/login', { username: 'fox', password: 'fox-pass' });
  const q = (await fox.get('/api/team/state')).body.questions.find((x) => x.title === 'Leap Year') || (await fox.get('/api/team/state')).body.questions[0];
  const db = S.srv.app.db;
  const team = db.prepare('SELECT id FROM teams WHERE username = ?').get('fox');
  const sid = Number(db.prepare(`INSERT INTO submissions (team_id, batch_id, question_id, language, code, status, submitted_at) VALUES (?,?,?,?,?, 'judging', ?)`)
    .run(team.id, b4, q.id, 'python', REF[q.title], Date.now()).lastInsertRowid);

  const dir = S.srv.dir;
  await S.srv.close();
  const app2 = await createApp({ dbPath: path.join(dir, 'test.db'), port: 0, host: '127.0.0.1', log: () => {}, submissionCooldownMs: 0, judge: { workDir: path.join(dir, 'judge2') }, seedOnEmpty: false });
  const server2 = await app2.listen();
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  const admin2 = new (require('./helpers').Client)(base2);
  assert.equal((await admin2.post('/api/auth/admin/login', { username: 'admin', password: 'test-admin-password' })).status, 200);
  const b = (await admin2.get(`/api/admin/batches/${b4}`)).body;
  assert.equal(b.status, 'running');
  assert.equal(b.ends_at, started.ends_at, 'timer deadline survives a restart');
  await waitFor(() => {
    const row = app2.db.prepare('SELECT status FROM submissions WHERE id = ?').get(sid);
    return row.status === 'accepted';
  }, { timeout: 60000 });
  assert.equal(app2.db.prepare('SELECT COUNT(*) n FROM solves WHERE team_id = ?').get(team.id).n, 1);
  // sessions survive the restart as well (resume)
  const fox2 = new (require('./helpers').Client)(base2);
  fox2.cookie = fox.cookie;
  assert.equal((await fox2.get('/api/team/state')).status, 200);
  await app2.close();
  S.srv.closed = true;
  S.srv.close = async () => {};
});
