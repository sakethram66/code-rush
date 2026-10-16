'use strict';
const { HttpError, bad, forbidden, notFound, now, int } = require('../util');
const { execute, LANGS } = require('../judge/judge');
const { POINTS_BY_DIFFICULTY, MAX_SCORE, QUESTIONS_PER_BATCH } = require('./scoring');

function tooMany(msg) { return new HttpError(429, msg); }

function makeContest(db, batches, queue, config, audit) {
  const lastAction = new Map();      // teamId -> timestamp of last run/submit (cooldown)
  const activeRuns = new Set();      // teamIds with a run currently in flight

  // ---- context / access helpers ----
  function batchOf(team) {
    batches.expireDue();
    const teamRow = db.prepare('SELECT batch_id FROM teams WHERE id = ?').get(team.id);
    if (!teamRow || !teamRow.batch_id) return null;
    return db.prepare('SELECT * FROM batches WHERE id = ?').get(teamRow.batch_id);
  }

  function requireBatch(team) {
    const b = batchOf(team);
    if (!b) throw forbidden('You have not been assigned to a batch yet. Please ask an organiser.');
    return b;
  }

  function requireLive(team) {
    const b = requireBatch(team);
    const row = db.prepare('SELECT disqualified FROM teams WHERE id = ?').get(team.id);
    if (row && row.disqualified) throw forbidden('This team has been disqualified from the contest.');
    if (b.status === 'draft') throw forbidden('Your batch has not started yet.');
    if (b.status === 'paused') throw forbidden('This batch is paused. Please wait for the organiser to resume it.');
    if (b.status === 'completed' || now() > b.ends_at) throw forbidden('Time is up. This batch has ended and no more code can be run or submitted.');
    return b;
  }

  function requireQuestion(batchId, qid) {
    const q = db.prepare(`SELECT q.*, bq.position, bq.difficulty AS bq_difficulty FROM batch_questions bq
      JOIN questions q ON q.id = bq.question_id WHERE bq.batch_id = ? AND bq.question_id = ?`).get(batchId, qid);
    if (!q) throw notFound('That question is not part of your batch');
    return q;
  }

  function checkCode(language, code) {
    if (!LANGS.includes(language)) throw bad('Language must be c, java or python');
    if (typeof code !== 'string') throw bad('Code is required');
    if (Buffer.byteLength(code) > config.maxCodeBytes) throw bad(`Code is too large (max ${Math.round(config.maxCodeBytes / 1024)} KB)`);
    if (code.includes('\u0000')) throw bad('Code contains invalid characters');
  }

  function cooldown(teamId) {
    const t = now(); const last = lastAction.get(teamId) || 0;
    const wait = config.submissionCooldownMs - (t - last);
    if (wait > 0) throw tooMany(`Please wait ${Math.ceil(wait / 1000)}s before running or submitting again.`);
    lastAction.set(teamId, t);
  }

  // ---- dashboard state ----
  function state(team) {
    const teamRow = db.prepare('SELECT disqualified FROM teams WHERE id = ?').get(team.id);
    const b = batchOf(team);
    const t = now();
    const out = { server_now: t, team: { id: team.id, name: team.name, members: team.members }, max_score: MAX_SCORE, total_questions: QUESTIONS_PER_BATCH, points_by_difficulty: POINTS_BY_DIFFICULTY, disqualified: !!(teamRow && teamRow.disqualified) };
    if (!b) return { ...out, phase: 'unassigned', batch: null };
    const batch = { id: b.id, number: b.number, status: b.status, duration_minutes: b.duration_minutes, started_at: b.started_at, ends_at: b.ends_at, finished_at: b.finished_at };
    if (b.status === 'draft') return { ...out, phase: 'waiting', batch };
    const solvedRows = db.prepare('SELECT question_id, solved_at FROM solves WHERE team_id = ?').all(team.id);
    const solved = new Set(solvedRows.map((r) => r.question_id));
    const questions = db.prepare(`SELECT bq.position, bq.difficulty, q.id, q.title, q.topic,
        (SELECT COUNT(*) FROM submissions s WHERE s.team_id = ? AND s.question_id = q.id) AS attempts
      FROM batch_questions bq JOIN questions q ON q.id = bq.question_id
      WHERE bq.batch_id = ? ORDER BY bq.position`).all(team.id, b.id)
      .map((q) => ({ ...q, points: POINTS_BY_DIFFICULTY[q.difficulty], status: solved.has(q.id) ? 'solved' : (q.attempts ? 'attempted' : 'unsolved') }));
    const groups = { easy: 0, medium: 0, hard: 0 };
    questions.forEach((q) => { groups[q.difficulty] += 1; });
    const phase = b.status === 'running' && t <= b.ends_at ? 'running' : (b.status === 'paused' ? 'paused' : 'finished');
    return {
      ...out, phase, batch,
      remaining_ms: b.status === 'running' ? Math.max(0, b.ends_at - t) : (b.status === 'paused' ? Math.max(0, Number(b.paused_remaining_ms || 0)) : 0),
      solved: solved.size, score: questions.reduce((total, q) => total + (solved.has(q.id) ? q.points : 0), 0),
      counts: groups, questions,
      pending: db.prepare(`SELECT COUNT(*) n FROM submissions WHERE team_id = ? AND status IN ('queued','judging')`).get(team.id).n,
    };
  }

  // ---- a single problem (never includes hidden tests) ----
  function question(team, qid) {
    const b = requireBatch(team);
    if (b.status === 'draft') throw forbidden('Your batch has not started yet.');
    const q = requireQuestion(b.id, qid);
    const samples = db.prepare('SELECT position, input, expected_output FROM test_cases WHERE question_id = ? AND is_sample = 1 ORDER BY position').all(qid)
      .map((s) => ({ input: s.input, output: s.expected_output }));
    const drafts = {};
    for (const d of db.prepare('SELECT language, code, updated_at FROM drafts WHERE team_id = ? AND question_id = ?').all(team.id, qid)) drafts[d.language] = { code: d.code, updated_at: d.updated_at };
    const last = db.prepare('SELECT language FROM drafts WHERE team_id = ? AND question_id = ? ORDER BY updated_at DESC LIMIT 1').get(team.id, qid);
    const solved = !!db.prepare('SELECT 1 FROM solves WHERE team_id = ? AND question_id = ?').get(team.id, qid);
    return {
      id: q.id, position: q.position, title: q.title, difficulty: q.bq_difficulty, points: POINTS_BY_DIFFICULTY[q.bq_difficulty], topic: q.topic,
      statement: q.statement, input_format: q.input_format, output_format: q.output_format, constraints: q.constraints_text,
      time_limit_ms: q.time_limit_ms, memory_limit_mb: q.memory_limit_mb, samples, drafts, last_language: last ? last.language : null,
      solved, submissions: submissions(team, qid),
    };
  }

  function saveDraft(team, qid, language, code) {
    const b = requireLive(team);
    requireQuestion(b.id, qid);
    checkCode(language, code);
    const t = now();
    db.prepare(`INSERT INTO drafts (team_id, question_id, language, code, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(team_id, question_id, language) DO UPDATE SET code = excluded.code, updated_at = excluded.updated_at`)
      .run(team.id, qid, language, code, t);
    return { saved_at: t };
  }

  // ---- run (never scored) ----
  async function run(team, qid, { language, code, mode, input }) {
    const b = requireLive(team);
    const q = requireQuestion(b.id, qid);
    checkCode(language, code);
    if (mode !== 'samples') throw bad('Custom input is disabled. Only sample runs are allowed.');
    if (activeRuns.has(team.id)) throw tooMany('Your previous run is still in progress.');
    const cases = db.prepare('SELECT input, expected_output FROM test_cases WHERE question_id = ? AND is_sample = 1 ORDER BY position').all(qid)
      .map((t) => ({ input: t.input, expected: t.expected_output, expose: true }));
    cooldown(team.id);
    activeRuns.add(team.id);
    try {
      const res = await queue.enqueue(() => execute({ language, code, cases, timeLimitMs: q.time_limit_ms, memoryMb: q.memory_limit_mb, stopOnFail: false }, config.judge));
      return { mode, status: res.status, message: res.message || '', passed: res.passed || 0, total: res.total || cases.length, exec_ms: res.execMs || 0, cases: res.cases };
    } finally {
      activeRuns.delete(team.id);
    }
  }

  // ---- submit (scored) ----
  function submit(team, qid, { language, code }) {
    const b = requireLive(team);
    requireQuestion(b.id, qid);
    checkCode(language, code);
    if (!code.trim()) throw bad('Write some code before submitting');
    const inflight = db.prepare(`SELECT COUNT(*) n FROM submissions WHERE team_id = ? AND status IN ('queued','judging')`).get(team.id).n;
    if (inflight >= 1) throw tooMany('Your previous submission is still being judged.');
    cooldown(team.id);
    const t = now();
    // Persist the exact code with the latest draft so a refresh shows what was submitted
    const r = db.prepare(`INSERT INTO submissions (team_id, batch_id, question_id, language, code, status, submitted_at) VALUES (?,?,?,?,?,'queued',?)`)
      .run(team.id, b.id, qid, language, code, t);
    db.prepare(`INSERT INTO drafts (team_id, question_id, language, code, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(team_id, question_id, language) DO UPDATE SET code = excluded.code, updated_at = excluded.updated_at`).run(team.id, qid, language, code, t);
    const id = Number(r.lastInsertRowid);
    enqueueJudging(id);
    return { id, status: 'queued', submitted_at: t };
  }

  function enqueueJudging(submissionId) {
    queue.enqueue(() => judgeSubmission(submissionId)).catch((e) => {
      // Never leave a submission stuck in the queue state
      db.prepare(`UPDATE submissions SET status = 'internal_error', message = ?, judged_at = ? WHERE id = ? AND status IN ('queued','judging')`)
        .run('Judge error: ' + e.message, now(), submissionId);
    });
  }

  async function judgeSubmission(submissionId) {
    const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
    if (!s || !['queued', 'judging'].includes(s.status)) return;
    db.prepare(`UPDATE submissions SET status = 'judging' WHERE id = ?`).run(submissionId);
    const q = db.prepare('SELECT time_limit_ms, memory_limit_mb FROM questions WHERE id = ?').get(s.question_id);
    // Samples run first, then hidden tests. No test data is ever returned to the team.
    const tests = db.prepare('SELECT input, expected_output FROM test_cases WHERE question_id = ? ORDER BY is_sample DESC, position').all(s.question_id);
    const res = await execute({
      language: s.language, code: s.code, timeLimitMs: q.time_limit_ms, memoryMb: q.memory_limit_mb, stopOnFail: true,
      cases: tests.map((t) => ({ input: t.input, expected: t.expected_output, expose: false })),
    }, config.judge);
    db.transaction(() => {
      db.prepare(`UPDATE submissions SET status = ?, passed_tests = ?, total_tests = ?, failed_test = ?, exec_time_ms = ?, message = ?, judged_at = ? WHERE id = ?`)
        .run(res.status, res.passed || 0, res.total || tests.length, res.failedTest || null, res.execMs || null, (res.message || '').slice(0, 4000), now(), submissionId);
      if (res.status === 'accepted') {
        // Credit uses the time the code was submitted, so queue delays never cost a team points or rank.
        db.prepare('INSERT OR IGNORE INTO solves (team_id, question_id, batch_id, submission_id, solved_at) VALUES (?,?,?,?,?)')
          .run(s.team_id, s.question_id, s.batch_id, submissionId, s.submitted_at);
      }
    })();
  }

  // On startup, anything left mid-judging (server restart) is judged again, oldest first
  function recover() {
    db.prepare(`UPDATE submissions SET status = 'queued' WHERE status = 'judging'`).run();
    const rows = db.prepare(`SELECT id FROM submissions WHERE status = 'queued' ORDER BY id`).all();
    rows.forEach((r) => enqueueJudging(r.id));
    return rows.length;
  }

  const PUBLIC_COLS = 'id, question_id, language, status, passed_tests, total_tests, failed_test, exec_time_ms, message, submitted_at, judged_at';

  function submissions(team, qid) {
    return db.prepare(`SELECT ${PUBLIC_COLS} FROM submissions WHERE team_id = ? AND question_id = ? ORDER BY id DESC LIMIT 30`).all(team.id, qid);
  }

  function submission(team, id, { withCode = false } = {}) {
    const s = db.prepare(`SELECT ${PUBLIC_COLS}${withCode ? ', code' : ''} FROM submissions WHERE id = ? AND team_id = ?`).get(id, team.id);
    if (!s) throw notFound('Submission not found');
    return s;
  }

  return { state, question, saveDraft, run, submit, submissions, submission, recover, judgeSubmission, batchOf };
}

module.exports = { makeContest };
