'use strict';
const express = require('express');
const { wrap, id, bad } = require('../util');

module.exports = function teamRoutes(ctx) {
  const { auth, contest } = ctx;
  const r = express.Router();
  r.use(auth.requireTeam);

  r.get('/state', (req, res) => res.json(contest.state(req.auth.team)));

  r.get('/questions/:id', (req, res) => res.json(contest.question(req.auth.team, id(req.params.id))));

  r.put('/questions/:id/draft', (req, res) => {
    const { language, code } = req.body || {};
    res.json(contest.saveDraft(req.auth.team, id(req.params.id), language, code));
  });

  r.post('/questions/:id/run', wrap(async (req, res) => {
    res.json(await contest.run(req.auth.team, id(req.params.id), req.body || {}));
  }));

  r.post('/questions/:id/submit', (req, res) => {
    res.status(202).json(contest.submit(req.auth.team, id(req.params.id), req.body || {}));
  });

  r.get('/questions/:id/submissions', (req, res) => res.json(contest.submissions(req.auth.team, id(req.params.id))));

  r.get('/submissions/:id', (req, res) => res.json(contest.submission(req.auth.team, id(req.params.id), { withCode: req.query.code === '1' })));

  return r;
};
