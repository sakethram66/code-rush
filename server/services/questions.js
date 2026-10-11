'use strict';
const { bad, conflict, notFound, now, str, int } = require('../util');

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MAX_TESTS = 60;
const MAX_TEST_BYTES = 6 * 1024 * 1024;

function makeQuestions(db) {
  const usageSql = `
    SELECT bq.question_id, b.number, b.status
    FROM batch_questions bq JOIN batches b ON b.id = bq.batch_id
    WHERE b.status IN ('running','completed')`;

  // ---- input validation (shared by create, update and import) ----
  function validate(input, { partial = false } = {}) {
    if (!input || typeof input !== 'object') throw bad('Question data is required');
    const q = {};
    q.title = str(input.title, { name: 'Title', min: 1, max: 150 });
    const diff = String(input.difficulty || '').toLowerCase();
    if (!DIFFICULTIES.includes(diff)) throw bad('Difficulty must be easy, medium or hard');
    q.difficulty = diff;
    q.topic = str(input.topic, { name: 'Topic', max: 60 });
    q.statement = str(input.statement, { name: 'Statement', min: 1, max: 12000, trim: true });
    q.input_format = str(input.input_format, { name: 'Input format', max: 4000 });
    q.output_format = str(input.output_format, { name: 'Output format', max: 4000 });
    q.constraints_text = str(input.constraints_text ?? input.constraints, { name: 'Constraints', max: 4000 });
    q.time_limit_ms = int(input.time_limit_ms, { name: 'Time limit', min: 100, max: 20000, def: 2000 });
    q.memory_limit_mb = int(input.memory_limit_mb, { name: 'Memory limit', min: 16, max: 2048, def: 256 });

    if (!partial || input.tests !== undefined) {
      if (!Array.isArray(input.tests)) throw bad('tests must be a list');
      if (input.tests.length < 1) throw bad('Add at least one test case');
      if (input.tests.length > MAX_TESTS) throw bad(`At most ${MAX_TESTS} test cases per question`);
      q.tests = input.tests.map((t, i) => {
        if (!t || typeof t !== 'object') throw bad(`Test ${i + 1} is invalid`);
        const inp = t.input === undefined || t.input === null ? '' : String(t.input);
        const out = t.expected_output ?? t.output;
        if (out === undefined || out === null) throw bad(`Test ${i + 1} needs an expected output`);
        const outS = String(out);
        if (Buffer.byteLength(inp) > MAX_TEST_BYTES || Buffer.byteLength(outS) > MAX_TEST_BYTES) {
          throw bad(`Test ${i + 1} is too large (max ${MAX_TEST_BYTES / 1024} KB)`);
        }
        if (outS.trim() === '') throw bad(`Test ${i + 1} expected output is empty`);
        return { input: inp, expected_output: outS, is_sample: (t.is_sample ?? t.sample) ? 1 : 0 };
      });
      if (!q.tests.some((t) => t.is_sample)) throw bad('Mark at least one test case as a sample (visible to teams)');
      if (!q.tests.some((t) => !t.is_sample)) throw bad('Add at least one hidden test case (not a sample)');
    }
    return q;
  }

  const insertQ = db.prepare(`INSERT INTO questions (title, difficulty, topic, statement, input_format, output_format, constraints_text, time_limit_ms, memory_limit_mb, created_at, updated_at)
    VALUES (@title,@difficulty,@topic,@statement,@input_format,@output_format,@constraints_text,@time_limit_ms,@memory_limit_mb,@t,@t)`);
  const insertT = db.prepare('INSERT INTO test_cases (question_id, position, input, expected_output, is_sample) VALUES (?,?,?,?,?)');
  const delT = db.prepare('DELETE FROM test_cases WHERE question_id = ?');

  function isLocked(id) {
    return !!db.prepare(`SELECT 1 FROM batch_questions bq JOIN batches b ON b.id = bq.batch_id
      WHERE bq.question_id = ? AND b.status IN ('running','completed') LIMIT 1`).get(id);
  }

  function create(input) {
    const q = validate(input);
    const dup = db.prepare('SELECT id FROM questions WHERE title = ? COLLATE NOCASE AND difficulty = ?').get(q.title, q.difficulty);
    if (dup) throw conflict(`A ${q.difficulty} question titled "${q.title}" already exists (id ${dup.id})`);
    return db.transaction(() => {
      const { lastInsertRowid } = insertQ.run({ ...q, t: now() });
      q.tests.forEach((t, i) => insertT.run(lastInsertRowid, i + 1, t.input, t.expected_output, t.is_sample));
      return Number(lastInsertRowid);
    })();
  }

  function update(id, input) {
    const cur = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
    if (!cur) throw notFound('Question not found');
    const q = validate(input);
    if (isLocked(id)) {
      throw conflict('This question was used in a batch that has started, so it can no longer be edited. Archive it and create a corrected copy instead.');
    }
    const dup = db.prepare('SELECT id FROM questions WHERE title = ? COLLATE NOCASE AND difficulty = ? AND id != ?').get(q.title, q.difficulty, id);
    if (dup) throw conflict(`Another ${q.difficulty} question is already titled "${q.title}"`);
    if (q.difficulty !== cur.difficulty) {
      const planned = db.prepare('SELECT 1 FROM batch_questions WHERE question_id = ? LIMIT 1').get(id);
      if (planned) throw conflict('Remove this question from draft batches before changing its difficulty');
    }
    db.transaction(() => {
      db.prepare(`UPDATE questions SET title=@title, difficulty=@difficulty, topic=@topic, statement=@statement, input_format=@input_format,
        output_format=@output_format, constraints_text=@constraints_text, time_limit_ms=@time_limit_ms, memory_limit_mb=@memory_limit_mb, updated_at=@t WHERE id=@id`)
        .run({ ...q, t: now(), id });
      delT.run(id);
      q.tests.forEach((t, i) => insertT.run(id, i + 1, t.input, t.expected_output, t.is_sample));
    })();
  }

  function setArchived(id, archived) {
    const r = db.prepare('UPDATE questions SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now(), id);
    if (!r.changes) throw notFound('Question not found');
    if (archived) {
      // Archiving pulls the question out of draft selections (started batches keep it: audit trail)
      db.prepare(`DELETE FROM batch_questions WHERE question_id = ? AND batch_id IN (SELECT id FROM batches WHERE status = 'draft')`).run(id);
    }
  }

  function remove(id) {
    const used = db.prepare('SELECT 1 FROM batch_questions WHERE question_id = ? LIMIT 1').get(id);
    if (used) throw conflict('This question is part of a batch. Archive it instead of deleting it.');
    const r = db.prepare('DELETE FROM questions WHERE id = ?').run(id);
    if (!r.changes) throw notFound('Question not found');
  }

  function usageMap(ids) {
    const map = new Map();
    if (!ids.length) return map;
    const rows = db.prepare(`${usageSql} AND bq.question_id IN (${ids.map(() => '?').join(',')}) ORDER BY b.number`).all(...ids);
    for (const r of rows) {
      if (!map.has(r.question_id)) map.set(r.question_id, []);
      map.get(r.question_id).push(r.number);
    }
    return map;
  }

  // Draft batches that currently include the question (informational, helps organisers avoid overlap)
  function plannedMap(ids, excludeBatchId) {
    const map = new Map();
    if (!ids.length) return map;
    const rows = db.prepare(`SELECT bq.question_id, b.number FROM batch_questions bq JOIN batches b ON b.id = bq.batch_id
      WHERE b.status = 'draft' AND b.id != ? AND bq.question_id IN (${ids.map(() => '?').join(',')}) ORDER BY b.number`)
      .all(excludeBatchId || 0, ...ids);
    for (const r of rows) {
      if (!map.has(r.question_id)) map.set(r.question_id, []);
      map.get(r.question_id).push(r.number);
    }
    return map;
  }

  /**
   * Paged, filterable listing.
   * usage: any | unused | used   (used = part of at least one started batch)
   */
  function list({ difficulty, topic, search, usage = 'any', archived = 'no', page = 1, pageSize = 25, excludeBatchId } = {}) {
    const where = []; const args = [];
    if (difficulty) {
      if (!DIFFICULTIES.includes(difficulty)) throw bad('Unknown difficulty');
      where.push('q.difficulty = ?'); args.push(difficulty);
    }
    if (topic) { where.push('q.topic = ? COLLATE NOCASE'); args.push(topic); }
    if (search) {
      const s = `%${String(search).replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      where.push(`(q.title LIKE ? ESCAPE '\\' OR q.topic LIKE ? ESCAPE '\\' OR CAST(q.id AS TEXT) = ?)`);
      args.push(s, s, String(search).replace(/^Q/i, ''));
    }
    if (archived === 'no') where.push('q.archived = 0');
    else if (archived === 'only') where.push('q.archived = 1');
    const usedExpr = `(SELECT COUNT(*) FROM batch_questions bq JOIN batches b ON b.id = bq.batch_id WHERE bq.question_id = q.id AND b.status IN ('running','completed'))`;
    if (usage === 'unused') where.push(`${usedExpr} = 0`);
    if (usage === 'used') where.push(`${usedExpr} > 0`);
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM questions q ${w}`).get(...args).c;
    pageSize = Math.min(Math.max(pageSize, 1), 200);
    page = Math.max(page, 1);
    const rows = db.prepare(`SELECT q.id, q.title, q.difficulty, q.topic, q.archived, q.time_limit_ms, q.memory_limit_mb,
        ${usedExpr} AS times_used,
        (SELECT COUNT(*) FROM test_cases t WHERE t.question_id = q.id) AS test_count
      FROM questions q ${w}
      ORDER BY CASE q.difficulty WHEN 'easy' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, q.id
      LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize);
    const ids = rows.map((r) => r.id);
    const used = usageMap(ids); const planned = plannedMap(ids, excludeBatchId);
    return {
      total, page, pageSize,
      items: rows.map((r) => ({ ...r, archived: !!r.archived, used_in: used.get(r.id) || [], planned_in: planned.get(r.id) || [] })),
    };
  }

  function get(id, { includeTests = true } = {}) {
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
    if (!q) throw notFound('Question not found');
    const out = { ...q, archived: !!q.archived, locked: isLocked(id) };
    out.used_in = usageMap([id]).get(id) || [];
    out.times_used = out.used_in.length;
    if (includeTests) {
      out.tests = db.prepare('SELECT id, position, input, expected_output, is_sample FROM test_cases WHERE question_id = ? ORDER BY position').all(id)
        .map((t) => ({ ...t, is_sample: !!t.is_sample }));
    }
    return out;
  }

  function topics() {
    return db.prepare(`SELECT topic, difficulty, COUNT(*) n FROM questions WHERE archived = 0 AND topic != '' GROUP BY topic, difficulty ORDER BY topic`).all();
  }

  function stats() {
    const rows = db.prepare(`SELECT difficulty, COUNT(*) n FROM questions WHERE archived = 0 GROUP BY difficulty`).all();
    const s = { easy: 0, medium: 0, hard: 0, total: 0 };
    for (const r of rows) { s[r.difficulty] = r.n; s.total += r.n; }
    return s;
  }

  // Bulk import: array of question objects (same shape as the API). mode: 'skip' duplicates | 'fail' on first problem
  function importMany(list, { skipDuplicates = true } = {}) {
    if (!Array.isArray(list)) throw bad('Import file must contain a JSON list of questions');
    if (list.length > 5000) throw bad('At most 5000 questions per import');
    const report = { created: 0, skipped: 0, errors: [] };
    const validated = [];
    list.forEach((item, i) => {
      try { validated.push({ i, q: validate(item) }); }
      catch (e) { report.errors.push({ index: i + 1, title: item && item.title, error: e.message }); }
    });
    if (report.errors.length) return { ...report, created: 0, aborted: true };
    db.transaction(() => {
      for (const { q } of validated) {
        const dup = db.prepare('SELECT id FROM questions WHERE title = ? COLLATE NOCASE AND difficulty = ?').get(q.title, q.difficulty);
        if (dup) {
          if (skipDuplicates) { report.skipped++; continue; }
          throw conflict(`Duplicate question: "${q.title}"`);
        }
        const { lastInsertRowid } = insertQ.run({ ...q, t: now() });
        q.tests.forEach((t, i) => insertT.run(lastInsertRowid, i + 1, t.input, t.expected_output, t.is_sample));
        report.created++;
      }
    })();
    return report;
  }

  function exportAll() {
    return db.prepare('SELECT id FROM questions ORDER BY id').all().map((r) => {
      const q = get(r.id);
      return {
        title: q.title, difficulty: q.difficulty, topic: q.topic, statement: q.statement,
        input_format: q.input_format, output_format: q.output_format, constraints_text: q.constraints_text,
        time_limit_ms: q.time_limit_ms, memory_limit_mb: q.memory_limit_mb,
        tests: q.tests.map((t) => ({ input: t.input, output: t.expected_output, sample: t.is_sample })),
      };
    });
  }

  return { validate, create, update, setArchived, remove, list, get, topics, stats, importMany, exportAll, isLocked, usageMap };
}

module.exports = { makeQuestions, DIFFICULTIES };
