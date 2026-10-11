'use strict';
const { formatDuration } = require('../util');

const POINTS_PER_QUESTION = 10;
const QUESTIONS_PER_BATCH = 25;
const MAX_SCORE = POINTS_PER_QUESTION * QUESTIONS_PER_BATCH; // 250
const REQUIRED = { easy: 5, medium: 10, hard: 10 };

function makeScoring(db) {
  /**
   * Leaderboard rows for teams whose batch has started.
   * Ranking: score desc, then time of the last accepted solve (from batch start) asc.
   * Teams with identical score and time share a rank (1,2,2,4).
   * No penalties, hints or bonuses exist: score = solved * 10.
   */
  function leaderboard({ batchId } = {}) {
    const args = [];
    let where = `b.status IN ('running','completed') AND t.disqualified = 0`;
    if (batchId) { where += ' AND b.id = ?'; args.push(batchId); }
    const rows = db.prepare(`
      SELECT t.id AS team_id, t.name AS team, t.members, b.id AS batch_id, b.number AS batch_number, b.status AS batch_status,
             b.started_at, COUNT(s.question_id) AS solved, MAX(s.solved_at) AS last_solved
      FROM teams t
      JOIN batches b ON b.id = t.batch_id
      LEFT JOIN solves s ON s.team_id = t.id
      WHERE ${where}
      GROUP BY t.id`).all(...args);

    const list = rows.map((r) => {
      const timeMs = r.solved > 0 ? Math.max(0, r.last_solved - r.started_at) : null;
      return {
        team_id: r.team_id, team: r.team, members: JSON.parse(r.members || '[]'),
        batch_id: r.batch_id, batch: r.batch_number, batch_status: r.batch_status,
        solved: r.solved, score: r.solved * POINTS_PER_QUESTION, max_score: MAX_SCORE,
        time_ms: timeMs, time: timeMs === null ? '—' : formatDuration(timeMs),
      };
    });
    list.sort((a, b) => b.score - a.score
      || (a.time_ms === null ? 1 : b.time_ms === null ? -1 : a.time_ms - b.time_ms)
      || a.team.localeCompare(b.team));
    let prev = null; let rank = 0;
    list.forEach((row, i) => {
      if (!prev || prev.score !== row.score || prev.time_ms !== row.time_ms) rank = i + 1;
      row.rank = rank; prev = row;
    });
    return list;
  }

  function teamScore(teamId) {
    const r = db.prepare('SELECT COUNT(*) n, MAX(solved_at) last FROM solves WHERE team_id = ?').get(teamId);
    return { solved: r.n, score: r.n * POINTS_PER_QUESTION, max_score: MAX_SCORE, last_solved_at: r.last };
  }

  return { leaderboard, teamScore };
}

module.exports = { makeScoring, POINTS_PER_QUESTION, QUESTIONS_PER_BATCH, MAX_SCORE, REQUIRED };
