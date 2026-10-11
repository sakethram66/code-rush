'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  difficulty      TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  topic           TEXT NOT NULL DEFAULT '',
  statement       TEXT NOT NULL,
  input_format    TEXT NOT NULL DEFAULT '',
  output_format   TEXT NOT NULL DEFAULT '',
  constraints_text TEXT NOT NULL DEFAULT '',
  time_limit_ms   INTEGER NOT NULL DEFAULT 2000 CHECK (time_limit_ms BETWEEN 100 AND 20000),
  memory_limit_mb INTEGER NOT NULL DEFAULT 256 CHECK (memory_limit_mb BETWEEN 16 AND 2048),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_diff ON questions(difficulty, archived);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_title_diff ON questions(title COLLATE NOCASE, difficulty);

CREATE TABLE IF NOT EXISTS test_cases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id     INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  input           TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_sample       INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_tests_question ON test_cases(question_id, position);

CREATE TABLE IF NOT EXISTS batches (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           INTEGER NOT NULL UNIQUE CHECK (number > 0),
  name             TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed')),
  duration_minutes INTEGER NOT NULL DEFAULT 25 CHECK (duration_minutes BETWEEN 1 AND 600),
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  ends_at          INTEGER,
  finished_at      INTEGER,
  started_by       TEXT,
  paused_remaining_ms INTEGER NOT NULL DEFAULT 0,
  paused_at       INTEGER
);

CREATE TABLE IF NOT EXISTS batch_questions (
  batch_id    INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  position    INTEGER,
  PRIMARY KEY (batch_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_bq_question ON batch_questions(question_id);

CREATE TABLE IF NOT EXISTS teams (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  members       TEXT NOT NULL DEFAULT '[]',
  batch_id      INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  disqualified  INTEGER NOT NULL DEFAULT 0 CHECK (disqualified IN (0,1)),
  disqualified_at INTEGER,
  disqualification_reason TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_batch ON teams(batch_id);

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  batch_id      INTEGER NOT NULL REFERENCES batches(id),
  question_id   INTEGER NOT NULL REFERENCES questions(id),
  language      TEXT NOT NULL CHECK (language IN ('c','java','python')),
  code          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued','judging','accepted','wrong_answer','compile_error','runtime_error','time_limit','memory_limit','output_limit','internal_error')),
  passed_tests  INTEGER NOT NULL DEFAULT 0,
  total_tests   INTEGER NOT NULL DEFAULT 0,
  failed_test   INTEGER,
  exec_time_ms  INTEGER,
  message       TEXT NOT NULL DEFAULT '',
  submitted_at  INTEGER NOT NULL,
  judged_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sub_team_q ON submissions(team_id, question_id, id);
CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_sub_batch ON submissions(batch_id);

CREATE TABLE IF NOT EXISTS solves (
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id),
  batch_id      INTEGER NOT NULL REFERENCES batches(id),
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  solved_at     INTEGER NOT NULL,
  PRIMARY KEY (team_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_solves_batch ON solves(batch_id);

CREATE TABLE IF NOT EXISTS drafts (
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  language    TEXT NOT NULL CHECK (language IN ('c','java','python')),
  code        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, question_id, language)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('admin','team')),
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(role, user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id   INTEGER,
  actor_name TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Triggers give defence-in-depth: even a buggy code path or a manual SQL session
// cannot change a batch's question set after it has started, or start an invalid set.
const TRIGGERS = `
DROP TRIGGER IF EXISTS bq_guard_insert;
CREATE TRIGGER bq_guard_insert BEFORE INSERT ON batch_questions
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM batches WHERE id = NEW.batch_id) IS NOT 'draft'
      THEN RAISE(ABORT, 'Question set is locked: this batch has already started')
    WHEN NEW.difficulty IS NOT (SELECT difficulty FROM questions WHERE id = NEW.question_id)
      THEN RAISE(ABORT, 'Difficulty does not match the question')
    WHEN (SELECT archived FROM questions WHERE id = NEW.question_id) = 1
      THEN RAISE(ABORT, 'Archived questions cannot be selected')
  END;
END;

DROP TRIGGER IF EXISTS bq_guard_update;
CREATE TRIGGER bq_guard_update BEFORE UPDATE ON batch_questions
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM batches WHERE id = OLD.batch_id) IS NOT 'draft'
      THEN RAISE(ABORT, 'Question set is locked: this batch has already started')
  END;
END;

DROP TRIGGER IF EXISTS bq_guard_delete;
CREATE TRIGGER bq_guard_delete BEFORE DELETE ON batch_questions
WHEN EXISTS (SELECT 1 FROM batches WHERE id = OLD.batch_id)
BEGIN
  SELECT CASE
    WHEN (SELECT status FROM batches WHERE id = OLD.batch_id) IS NOT 'draft'
      THEN RAISE(ABORT, 'Question set is locked: this batch has already started')
  END;
END;

DROP TRIGGER IF EXISTS batch_status_guard;
CREATE TRIGGER batch_status_guard BEFORE UPDATE OF status ON batches
WHEN NEW.status IS NOT OLD.status
BEGIN
  SELECT CASE
    WHEN OLD.status = 'completed'
      THEN RAISE(ABORT, 'A completed batch cannot change status')
    WHEN OLD.status = 'running' AND NEW.status = 'draft'
      THEN RAISE(ABORT, 'A running batch cannot go back to draft')
    WHEN NEW.status = 'running' AND (
           (SELECT COUNT(*) FROM batch_questions WHERE batch_id = OLD.id AND difficulty = 'easy')   != 5
        OR (SELECT COUNT(*) FROM batch_questions WHERE batch_id = OLD.id AND difficulty = 'medium') != 10
        OR (SELECT COUNT(*) FROM batch_questions WHERE batch_id = OLD.id AND difficulty = 'hard')   != 10)
      THEN RAISE(ABORT, 'Select 5 Easy, 10 Medium and 10 Hard questions to start this batch.')
  END;
END;

DROP TRIGGER IF EXISTS batch_guard_delete;
CREATE TRIGGER batch_guard_delete BEFORE DELETE ON batches
WHEN OLD.status != 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Started batches are part of the audit trail and cannot be deleted');
END;

DROP TRIGGER IF EXISTS batch_guard_number;
CREATE TRIGGER batch_guard_number BEFORE UPDATE OF number, duration_minutes ON batches
WHEN OLD.status != 'draft' AND (NEW.number IS NOT OLD.number OR NEW.duration_minutes IS NOT OLD.duration_minutes)
BEGIN
  SELECT RAISE(ABORT, 'Batch number and duration are locked once the batch has started');
END;

DROP TRIGGER IF EXISTS teams_guard_insert;
CREATE TRIGGER teams_guard_insert BEFORE INSERT ON teams
WHEN NEW.batch_id IS NOT NULL AND (SELECT status FROM batches WHERE id = NEW.batch_id) IS NOT 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Teams cannot join a batch that has already started');
END;

DROP TRIGGER IF EXISTS teams_guard_update;
CREATE TRIGGER teams_guard_update BEFORE UPDATE OF batch_id ON teams
WHEN NEW.batch_id IS NOT OLD.batch_id AND (
     (OLD.batch_id IS NOT NULL AND (SELECT status FROM batches WHERE id = OLD.batch_id) NOT IN ('draft'))
  OR (NEW.batch_id IS NOT NULL AND (SELECT status FROM batches WHERE id = NEW.batch_id) IS NOT 'draft'))
BEGIN
  SELECT RAISE(ABORT, 'Team assignment is locked once a batch has started');
END;

DROP TRIGGER IF EXISTS teams_guard_delete;
CREATE TRIGGER teams_guard_delete BEFORE DELETE ON teams
WHEN OLD.batch_id IS NOT NULL AND (SELECT status FROM batches WHERE id = OLD.batch_id) NOT IN ('draft')
BEGIN
  SELECT RAISE(ABORT, 'Teams of a started batch cannot be deleted (audit trail)');
END;

DROP TRIGGER IF EXISTS solves_guard_member;
CREATE TRIGGER solves_guard_member BEFORE INSERT ON solves
WHEN NOT EXISTS (SELECT 1 FROM batch_questions WHERE batch_id = NEW.batch_id AND question_id = NEW.question_id)
BEGIN
  SELECT RAISE(ABORT, 'Question is not part of this batch');
END;
`;

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(ddl);
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  ensureColumn(db, 'batches', 'paused_remaining_ms', 'ALTER TABLE batches ADD COLUMN paused_remaining_ms INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'batches', 'paused_at', 'ALTER TABLE batches ADD COLUMN paused_at INTEGER');
  ensureColumn(db, 'teams', 'disqualified', 'ALTER TABLE teams ADD COLUMN disqualified INTEGER NOT NULL DEFAULT 0 CHECK (disqualified IN (0,1))');
  ensureColumn(db, 'teams', 'disqualified_at', 'ALTER TABLE teams ADD COLUMN disqualified_at INTEGER');
  ensureColumn(db, 'teams', 'disqualification_reason', 'ALTER TABLE teams ADD COLUMN disqualification_reason TEXT NOT NULL DEFAULT \"\"');
  db.exec(TRIGGERS);
  if (dbPath !== ':memory:') {
    // Judged programs must never be able to read the database
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.chmodSync(dbPath + suffix, 0o600); } catch (_) { /* file may not exist yet */ }
    }
  }
  return db;
}

module.exports = { openDb };
