'use strict';
const express = require('express');
const { HttpError } = require('../util');

module.exports = function publicRoutes(ctx) {
  const { scoring, settings, db, judgeQueue } = ctx;
  const { MAX_SCORE } = require('../services/scoring');
  const r = express.Router();

  r.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, time: Date.now() });
  });

  // Combined leaderboard across all batches (no batch winners). Can be hidden by the organiser.
  r.get('/leaderboard', (req, res) => {
    const isAdmin = req.auth && req.auth.role === 'admin';
    if (req.auth && req.auth.role === 'team') {
      throw new HttpError(403, 'The leaderboard is available to organisers only.');
    }
    if (!isAdmin && !settings.get('public_leaderboard')) {
      throw new HttpError(403, 'The leaderboard is hidden by the organiser right now.');
    }
    const rows = scoring.leaderboard().map(({ members, team_id, ...rest }) => rest);
    res.json({ max_score: MAX_SCORE, updated_at: Date.now(), rows, queue: isAdmin ? judgeQueue.stats() : undefined });
  });

  return r;
};
