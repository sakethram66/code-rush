'use strict';
const express = require('express');
const { wrap, id, bad, csvEscape, int } = require('../util');
const { detectTools } = require('../judge/judge');
const { REQUIRED } = require('./../services/scoring');

module.exports = function adminRoutes(ctx) {
  const { db, auth, audit, questions, batches, teams, scoring, settings, judgeQueue } = ctx;
  const r = express.Router();
  r.use(auth.requireAdmin);

  // ---------- overview ----------
  r.get('/overview', (_req, res) => {
    batches.expireDue();
    const tools = detectTools();
    res.json({
      questions: questions.stats(),
      required: { ...REQUIRED, total: 25 },
      batches: db.prepare(`SELECT status, COUNT(*) n FROM batches GROUP BY status`).all(),
      teams: db.prepare('SELECT COUNT(*) n, SUM(batch_id IS NULL) unassigned FROM teams').get(),
      submissions: db.prepare(`SELECT COUNT(*) total, SUM(status IN ('queued','judging')) pending FROM submissions`).get(),
      judge: { languages: tools.languages, queue: judgeQueue.stats(), sandbox: { linuxHost: tools.linuxHost, privilegeDrop: !!(tools.isRoot), network_isolation: !!tools.unshare, rlimits: !!tools.prlimit } },
      settings: settings.all(),
    });
  });

  // ---------- question bank ----------
  r.get('/questions', (req, res) => {
    const q = req.query;
    res.json(questions.list({
      difficulty: q.difficulty || undefined, topic: q.topic || undefined, search: q.search || undefined,
      usage: ['unused', 'used'].includes(q.usage) ? q.usage : 'any',
      archived: ['no', 'only', 'all'].includes(q.archived) ? q.archived : 'no',
      page: int(q.page, { name: 'page', min: 1, def: 1 }), pageSize: int(q.pageSize, { name: 'pageSize', min: 1, max: 200, def: 25 }),
    }));
  });
  r.get('/questions/topics', (_req, res) => res.json(questions.topics()));
  r.get('/questions/export', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="code-rush-questions.json"');
    res.json(questions.exportAll());
  });
  r.get('/questions/:id', (req, res) => res.json(questions.get(id(req.params.id))));
  r.post('/questions', (req, res) => {
    const newId = questions.create(req.body);
    audit(req.auth, 'question.created', 'question', newId, { title: req.body.title });
    res.status(201).json({ id: newId });
  });
  r.put('/questions/:id', (req, res) => {
    questions.update(id(req.params.id), req.body);
    audit(req.auth, 'question.updated', 'question', id(req.params.id));
    res.json({ ok: true });
  });
  r.post('/questions/:id/archive', (req, res) => {
    questions.setArchived(id(req.params.id), !!(req.body && req.body.archived));
    audit(req.auth, req.body && req.body.archived ? 'question.archived' : 'question.restored', 'question', id(req.params.id));
    res.json({ ok: true });
  });
  r.delete('/questions/:id', (req, res) => {
    questions.remove(id(req.params.id));
    audit(req.auth, 'question.deleted', 'question', id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- batches ----------
  r.get('/batches', (_req, res) => res.json({ batches: batches.list() }));
  r.post('/batches', (req, res) => {
    const newId = batches.create(req.body || {});
    audit(req.auth, 'batch.created', 'batch', newId);
    res.status(201).json({ id: newId, batch: batches.get(newId) });
  });
  r.get('/batches/:id', (req, res) => res.json(batches.get(id(req.params.id))));
  r.put('/batches/:id', (req, res) => {
    batches.update(id(req.params.id), req.body || {});
    audit(req.auth, 'batch.updated', 'batch', id(req.params.id), req.body);
    res.json(batches.get(id(req.params.id)));
  });
  r.delete('/batches/:id', (req, res) => {
    const b = batches.remove(id(req.params.id));
    audit(req.auth, 'batch.deleted', 'batch', b.id, { number: b.number });
    res.json({ ok: true });
  });

  // Current draft selection plus its validation state
  r.get('/batches/:id/selection', (req, res) => {
    const bid = id(req.params.id);
    const batch = batches.get(bid);
    const details = batches.selectedDetails(bid).map((d) => ({
      ...d, used_in: questions.usageMap([d.id]).get(d.id) || [],
    }));
    res.json({ batch, question_ids: details.map((d) => d.id), questions: details, validation: batches.validateSelection(bid), locked: batch.status !== 'draft' });
  });
  r.put('/batches/:id/selection', (req, res) => {
    const bid = id(req.params.id);
    const v = batches.setSelection(bid, req.body && req.body.question_ids);
    res.json({ validation: v });
  });
  // Candidates for the selection screen: usage information is attached to every question
  r.get('/batches/:id/candidates', (req, res) => {
    const bid = id(req.params.id);
    const q = req.query;
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) throw bad('difficulty must be easy, medium or hard');
    res.json(questions.list({
      difficulty: q.difficulty, topic: q.topic || undefined, search: q.search || undefined,
      usage: ['unused', 'used'].includes(q.usage) ? q.usage : 'any', archived: 'no',
      page: int(q.page, { name: 'page', min: 1, def: 1 }), pageSize: int(q.pageSize, { name: 'pageSize', min: 1, max: 100, def: 30 }),
      excludeBatchId: bid,
    }));
  });
  r.post('/batches/:id/start', (req, res) => {
    res.json(batches.start(id(req.params.id), req.auth));
  });
  r.post('/batches/:id/pause', (req, res) => {
    res.json(batches.pause(id(req.params.id), req.auth));
  });
  r.post('/batches/:id/resume', (req, res) => {
    res.json(batches.resume(id(req.params.id), req.auth));
  });
  r.post('/batches/:id/end', (req, res) => {
    res.json(batches.finish(id(req.params.id), req.auth));
  });
  r.get('/batches/:id/history', (req, res) => res.json(batches.history(id(req.params.id))));
  r.get('/batches/:id/results.csv', (req, res) => {
    const bid = id(req.params.id);
    const b = batches.get(bid);
    sendCsv(res, `batch-${b.number}-results.csv`, scoring.leaderboard({ batchId: bid }));
  });
  r.get('/history', (_req, res) => res.json({ batches: batches.historyList() }));

  // ---------- teams ----------
  r.get('/teams', (req, res) => {
    res.json({ teams: teams.list({ batchId: req.query.batch ? id(req.query.batch) : undefined, unassigned: req.query.unassigned === '1' }) });
  });
  r.post('/teams', wrap(async (req, res) => {
    const t = await teams.create(req.body || {});
    audit(req.auth, 'team.created', 'team', t.id, { name: t.name });
    res.status(201).json(t);
  }));
  r.post('/teams/bulk', wrap(async (req, res) => {
    const out = await teams.bulkCreate(req.body && req.body.text, req.body && req.body.batch_id ? id(req.body.batch_id) : null);
    audit(req.auth, 'team.bulk_created', 'team', null, { created: out.created.length, errors: out.errors.length });
    res.status(201).json(out);
  }));
  r.put('/teams/:id', (req, res) => {
    teams.update(id(req.params.id), req.body || {});
    audit(req.auth, 'team.updated', 'team', id(req.params.id), req.body);
    res.json({ ok: true });
  });
  r.post('/teams/:id/reset-password', wrap(async (req, res) => {
    const out = await teams.resetPassword(id(req.params.id), req.body && req.body.password);
    audit(req.auth, 'team.password_reset', 'team', id(req.params.id));
    res.json(out);
  }));
  r.post('/teams/:id/disqualify', (req, res) => {
    const out = teams.disqualify(id(req.params.id), req.body && req.body.reason);
    audit(req.auth, 'team.disqualified', 'team', id(req.params.id), { reason: out.reason });
    res.json({ ...out, disqualified: true });
  });
  r.post('/teams/:id/reinstate', (_req, res) => {
    const out = teams.reinstate(id(req.params.id));
    audit(req.auth, 'team.reinstated', 'team', id(req.params.id));
    res.json({ ...out, disqualified: false });
  });
  r.delete('/teams/:id', (req, res) => {
    teams.remove(id(req.params.id));
    audit(req.auth, 'team.deleted', 'team', id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- leaderboard / settings / audit ----------
  r.get('/leaderboard.csv', (_req, res) => sendCsv(res, 'code-rush-leaderboard.csv', scoring.leaderboard()));

  r.put('/settings', (req, res) => {
    if (req.body && typeof req.body.public_leaderboard === 'boolean') settings.set('public_leaderboard', req.body.public_leaderboard);
    else throw bad('public_leaderboard must be true or false');
    audit(req.auth, 'settings.updated', 'settings', null, req.body);
    res.json(settings.all());
  });

  r.get('/audit', (req, res) => {
    const limit = int(req.query.limit, { name: 'limit', min: 1, max: 500, def: 100 });
    res.json({ entries: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).map((e) => ({ ...e, details: e.details ? JSON.parse(e.details) : null })) });
  });

  function sendCsv(res, filename, rows) {
    const head = ['Rank', 'Team', 'Batch', 'Solved', 'Score', 'Time'];
    const lines = [head.join(',')];
    rows.forEach((x) => lines.push([x.rank, x.team, x.batch, x.solved, x.score, x.time].map(csvEscape).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\r\n') + '\r\n');
  }

  return r;
};
