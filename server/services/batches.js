'use strict';
const { bad, conflict, notFound, now, str, int } = require('../util');
const { REQUIRED } = require('./scoring');

const START_MESSAGE = 'Select 5 Easy, 10 Medium and 10 Hard questions to start this batch.';
const DIFF_ORDER = `CASE bq.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

function makeBatches(db, scoring, audit, config) {
  function row(id) {
    const b = db.prepare('SELECT * FROM batches WHERE id = ?').get(id);
    if (!b) throw notFound('Batch not found');
    return b;
  }

  // Complete any running batch whose time is up (called by the scheduler and lazily by requests)
  function expireDue() {
    const t = now();
    const due = db.prepare(`SELECT id, number FROM batches WHERE status = 'running' AND ends_at <= ?`).all(t);
    for (const b of due) {
      const r = db.prepare(`UPDATE batches SET status = 'completed', finished_at = ends_at WHERE id = ? AND status = 'running'`).run(b.id);
      if (r.changes) audit({ type: 'system' }, 'batch.auto_completed', 'batch', b.id, { number: b.number });
    }
    return due.length;
  }

  function counts(batchId) {
    const c = { easy: 0, medium: 0, hard: 0 };
    for (const r of db.prepare('SELECT difficulty, COUNT(*) n FROM batch_questions WHERE batch_id = ? GROUP BY difficulty').all(batchId)) c[r.difficulty] = r.n;
    c.total = c.easy + c.medium + c.hard;
    return c;
  }

  function validateSelection(batchId) {
    const c = counts(batchId);
    const valid = c.easy === REQUIRED.easy && c.medium === REQUIRED.medium && c.hard === REQUIRED.hard;
    return { ...c, required: { ...REQUIRED, total: 25 }, valid, message: valid ? '' : START_MESSAGE };
  }

  function decorate(b) {
    const t = now();
    const out = {
      id: b.id, number: b.number, name: b.name, status: b.status, duration_minutes: b.duration_minutes,
      created_at: b.created_at, started_at: b.started_at, ends_at: b.ends_at, finished_at: b.finished_at, started_by: b.started_by,
      paused_remaining_ms: Number(b.paused_remaining_ms || 0), paused_at: b.paused_at,
      team_count: db.prepare('SELECT COUNT(*) n FROM teams WHERE batch_id = ?').get(b.id).n,
      selection: validateSelection(b.id),
    };
    out.remaining_ms = b.status === 'running' ? Math.max(0, b.ends_at - t) : (b.status === 'paused' ? Math.max(0, Number(b.paused_remaining_ms || 0)) : 0);
    return out;
  }

  function list() {
    expireDue();
    return db.prepare('SELECT * FROM batches ORDER BY number').all().map(decorate);
  }

  function get(id) {
    expireDue();
    return decorate(row(id));
  }

  function nextNumber() {
    return (db.prepare('SELECT COALESCE(MAX(number), 0) m FROM batches').get().m || 0) + 1;
  }

  function create({ number, name, duration_minutes } = {}) {
    const n = int(number, { name: 'Batch number', min: 1, max: 9999, def: nextNumber() });
    if (db.prepare('SELECT 1 FROM batches WHERE number = ?').get(n)) throw conflict(`Batch ${n} already exists`);
    const d = int(duration_minutes, { name: 'Duration', min: 1, max: 600, def: config.defaultBatchMinutes });
    const r = db.prepare('INSERT INTO batches (number, name, duration_minutes, created_at) VALUES (?,?,?,?)')
      .run(n, str(name, { name: 'Name', max: 80 }), d, now());
    return Number(r.lastInsertRowid);
  }

  function update(id, { number, name, duration_minutes }) {
    const b = row(id);
    if (b.status !== 'draft') throw conflict('Batch settings are locked once the batch has started');
    const n = int(number, { name: 'Batch number', min: 1, max: 9999, def: b.number });
    if (n !== b.number && db.prepare('SELECT 1 FROM batches WHERE number = ?').get(n)) throw conflict(`Batch ${n} already exists`);
    const d = int(duration_minutes, { name: 'Duration', min: 1, max: 600, def: b.duration_minutes });
    db.prepare('UPDATE batches SET number = ?, name = ?, duration_minutes = ? WHERE id = ?')
      .run(n, name === undefined ? b.name : str(name, { name: 'Name', max: 80 }), d, id);
  }

  function remove(id) {
    const b = row(id);
    if (b.status !== 'draft') throw conflict('Started batches are part of the audit trail and cannot be deleted');
    db.transaction(() => {
      db.prepare('UPDATE teams SET batch_id = NULL WHERE batch_id = ?').run(id);
      db.prepare('DELETE FROM batches WHERE id = ?').run(id);
    })();
    return b;
  }

  /**
   * Replace the batch's draft selection with the given question ids.
   * Partial selections are allowed while drafting; the counts must never exceed 5/10/10.
   * Nothing is ever chosen automatically: the caller (admin) supplies every id.
   */
  function setSelection(batchId, questionIds) {
    const b = row(batchId);
    if (b.status !== 'draft') throw conflict('The question set is locked because this batch has already started');
    if (!Array.isArray(questionIds)) throw bad('questionIds must be a list');
    const ids = questionIds.map((x) => int(x, { name: 'question id', min: 1 }));
    if (new Set(ids).size !== ids.length) throw bad('A question was selected more than once');
    const qs = ids.length
      ? db.prepare(`SELECT id, difficulty, archived FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    if (qs.length !== ids.length) throw bad('One or more selected questions do not exist');
    if (qs.some((q) => q.archived)) throw bad('Archived questions cannot be selected');
    const per = { easy: 0, medium: 0, hard: 0 };
    qs.forEach((q) => { per[q.difficulty] += 1; });
    for (const d of Object.keys(REQUIRED)) {
      if (per[d] > REQUIRED[d]) throw bad(`Select at most ${REQUIRED[d]} ${d} questions (you selected ${per[d]})`);
    }
    db.transaction(() => {
      db.prepare('DELETE FROM batch_questions WHERE batch_id = ?').run(batchId);
      const ins = db.prepare('INSERT INTO batch_questions (batch_id, question_id, difficulty) VALUES (?,?,?)');
      qs.forEach((q) => ins.run(batchId, q.id, q.difficulty));
    })();
    return validateSelection(batchId);
  }

  function selectedIds(batchId) {
    return db.prepare(`SELECT bq.question_id id FROM batch_questions bq WHERE bq.batch_id = ? ORDER BY ${DIFF_ORDER}, bq.question_id`).all(batchId).map((r) => r.id);
  }

  function selectedDetails(batchId) {
    return db.prepare(`SELECT bq.question_id AS id, bq.difficulty, bq.position, q.title, q.topic
      FROM batch_questions bq JOIN questions q ON q.id = bq.question_id
      WHERE bq.batch_id = ? ORDER BY ${DIFF_ORDER}, COALESCE(bq.position, 999), bq.question_id`).all(batchId);
  }

  function start(batchId, actor) {
    expireDue();
    const started = db.transaction(() => {
      const b = row(batchId);
      if (b.status !== 'draft') throw conflict(`Batch ${b.number} has already ${b.status === 'running' ? 'started' : 'finished'}`);
      const v = validateSelection(batchId);
      if (!v.valid) throw bad(START_MESSAGE, { selection: v });
      const teams = db.prepare('SELECT COUNT(*) n FROM teams WHERE batch_id = ?').get(batchId).n;
      if (teams < 1) throw bad('Assign at least one team to this batch before starting it.');
      // Fixed presentation order for every team: Easy (Q1-5), Medium (Q6-15), Hard (Q16-25)
      const ordered = db.prepare(`SELECT bq.question_id FROM batch_questions bq WHERE bq.batch_id = ? ORDER BY ${DIFF_ORDER}, bq.question_id`).all(batchId);
      const setPos = db.prepare('UPDATE batch_questions SET position = ? WHERE batch_id = ? AND question_id = ?');
      ordered.forEach((r, i) => setPos.run(i + 1, batchId, r.question_id));
      const t = now();
      // The DB trigger re-checks 5/10/10 here as a second line of defence
      db.prepare(`UPDATE batches SET status = 'running', started_at = ?, ends_at = ?, started_by = ? WHERE id = ?`)
        .run(t, t + b.duration_minutes * 60 * 1000, actor ? actor.admin.username : 'system', batchId);
      audit(actor, 'batch.started', 'batch', batchId, { number: b.number, teams, questions: ordered.map((r) => r.question_id) });
      return get(batchId);
    })();
    return started;
  }

  function finish(batchId, actor) {
    expireDue();
    const b = row(batchId);
    if (b.status !== 'running') throw conflict('Only a running batch can be ended');
    const t = now();
    db.prepare(`UPDATE batches SET status = 'completed', finished_at = ?, ends_at = MIN(ends_at, ?) WHERE id = ? AND status = 'running'`).run(t, t, batchId);
    audit(actor, 'batch.ended_early', 'batch', batchId, { number: b.number });
    return get(batchId);
  }

  function pause(batchId, actor) {
    expireDue();
    const b = row(batchId);
    if (b.status !== 'running') throw conflict('Only a running batch can be paused');
    const t = now();
    const remaining = Math.max(0, Number(b.ends_at || t) - t);
    db.prepare(`UPDATE batches SET status = 'paused', paused_remaining_ms = ?, ends_at = ?, paused_at = ?, started_by = COALESCE(started_by, ?) WHERE id = ? AND status = 'running'`)
      .run(remaining, t, t, actor ? actor.admin.username : 'system', batchId);
    audit(actor, 'batch.paused', 'batch', batchId, { number: b.number, remaining_ms: remaining });
    return get(batchId);
  }

  function resume(batchId, actor) {
    expireDue();
    const b = row(batchId);
    if (b.status !== 'paused') throw conflict('Only a paused batch can be resumed');
    const t = now();
    const remaining = Math.max(0, Number(b.paused_remaining_ms || 0));
    const endsAt = t + remaining;
    db.prepare(`UPDATE batches SET status = 'running', ends_at = ?, paused_remaining_ms = 0, paused_at = NULL WHERE id = ? AND status = 'paused'`)
      .run(endsAt, batchId);
    audit(actor, 'batch.resumed', 'batch', batchId, { number: b.number, remaining_ms: remaining });
    return get(batchId);
  }

  // Full audit view of a batch: locked question set, participating teams and results
  function history(batchId) {
    expireDue();
    const b = decorate(row(batchId));
    const questions = selectedDetails(batchId);
    const usage = db.prepare(`SELECT q.id, (SELECT COUNT(*) FROM solves s WHERE s.question_id = q.id AND s.batch_id = ?) AS solved_by
      FROM questions q WHERE q.id IN (SELECT question_id FROM batch_questions WHERE batch_id = ?)`).all(batchId, batchId);
    const solvedBy = new Map(usage.map((u) => [u.id, u.solved_by]));
    const grouped = { easy: [], medium: [], hard: [] };
    questions.forEach((q) => grouped[q.difficulty].push({ ...q, solved_by: solvedBy.get(q.id) || 0 }));
    const teams = db.prepare('SELECT id, name, username, members FROM teams WHERE batch_id = ? ORDER BY name COLLATE NOCASE').all(batchId)
      .map((t) => ({ ...t, members: JSON.parse(t.members || '[]') }));
    const results = b.status === 'draft' ? [] : scoring.leaderboard({ batchId });
    return { batch: b, questions: grouped, teams, results };
  }

  function historyList() {
    return list().map((b) => ({ ...b, questions: selectedDetails(b.id) }));
  }

  return { list, get, create, update, remove, setSelection, selectedIds, selectedDetails, validateSelection, start, finish, pause, resume, expireDue, history, historyList, row, counts, START_MESSAGE };
}

module.exports = { makeBatches, START_MESSAGE };
