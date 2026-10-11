'use strict';
const { bad, conflict, notFound, now, str, id: idv } = require('../util');
const { generatePassword } = require('../auth');

function slug(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'team';
}

function makeTeams(db, auth) {
  function cleanMembers(m) {
    if (typeof m === 'string') m = m.split(/[,+\n]/);
    if (!Array.isArray(m)) throw bad('Members must be a list of names');
    const out = m.map((x) => str(x, { name: 'Member name', max: 80 })).filter(Boolean);
    if (out.length < 1) throw bad('A team needs at least one member');
    if (out.length > 6) throw bad('A team can have at most 6 members');
    return out;
  }

  function uniqueUsername(base) {
    let candidate = base; let n = 1;
    const chk = db.prepare('SELECT 1 FROM teams WHERE username = ? COLLATE NOCASE');
    while (chk.get(candidate)) { n += 1; candidate = `${base}-${n}`; }
    return candidate;
  }

  function assertDraftBatch(batchId) {
    if (batchId === null || batchId === undefined) return;
    const b = db.prepare('SELECT id, number, status FROM batches WHERE id = ?').get(batchId);
    if (!b) throw notFound('Batch not found');
    if (b.status !== 'draft') throw conflict(`Batch ${b.number} has already started, so teams can no longer be added to it`);
  }

  async function create({ name, members, username, password, batch_id }) {
    name = str(name, { name: 'Team name', min: 2, max: 60 });
    members = cleanMembers(members);
    if (batch_id !== undefined && batch_id !== null && batch_id !== '') batch_id = idv(batch_id, 'batch'); else batch_id = null;
    assertDraftBatch(batch_id);
    if (db.prepare('SELECT 1 FROM teams WHERE name = ? COLLATE NOCASE').get(name)) throw conflict(`A team named "${name}" already exists`);
    if (username) {
      username = str(username, { name: 'Username', min: 3, max: 40 });
      if (!/^[A-Za-z0-9._-]+$/.test(username)) throw bad('Username may only contain letters, numbers, dot, dash and underscore');
      if (db.prepare('SELECT 1 FROM teams WHERE username = ? COLLATE NOCASE').get(username)) throw conflict(`Username "${username}" is taken`);
    } else {
      username = uniqueUsername(slug(name));
    }
    let generated = false;
    if (!password) { password = generatePassword(10); generated = true; }
    else if (String(password).length < 6) throw bad('Password must be at least 6 characters');
    const hash = await auth.hashPassword(String(password));
    const r = db.prepare('INSERT INTO teams (name, username, password_hash, members, batch_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(name, username, hash, JSON.stringify(members), batch_id, now());
    return { id: Number(r.lastInsertRowid), name, username, password, generated_password: generated, members, batch_id };
  }

  // Bulk: one team per line -> "Team name | Member 1, Member 2"
  async function bulkCreate(text, batch_id) {
    if (typeof text !== 'string') throw bad('Paste one team per line');
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw bad('Paste one team per line: Team name | Member 1, Member 2');
    if (lines.length > 300) throw bad('At most 300 teams at once');
    const created = []; const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const [n, m] = lines[i].split('|');
      try {
        if (m === undefined) throw bad('Use the format: Team name | Member 1, Member 2');
        created.push(await create({ name: n, members: m, batch_id }));
      } catch (e) { errors.push({ line: i + 1, text: lines[i], error: e.message }); }
    }
    return { created, errors };
  }

  function list({ batchId, unassigned } = {}) {
    const where = []; const args = [];
    if (batchId) { where.push('t.batch_id = ?'); args.push(batchId); }
    if (unassigned) where.push('t.batch_id IS NULL');
    const rows = db.prepare(`SELECT t.id, t.name, t.username, t.members, t.batch_id, t.disqualified, t.disqualified_at, t.disqualification_reason,
        b.number AS batch_number, b.status AS batch_status,
        (SELECT COUNT(*) FROM solves s WHERE s.team_id = t.id) AS solved
      FROM teams t LEFT JOIN batches b ON b.id = t.batch_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.name COLLATE NOCASE`).all(...args);
    return rows.map((r) => ({ ...r, members: JSON.parse(r.members || '[]') }));
  }

  function update(teamId, { name, members, batch_id }) {
    const cur = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
    if (!cur) throw notFound('Team not found');
    const next = {
      name: name === undefined ? cur.name : str(name, { name: 'Team name', min: 2, max: 60 }),
      members: members === undefined ? JSON.parse(cur.members) : cleanMembers(members),
      batch_id: batch_id === undefined ? cur.batch_id : (batch_id === null || batch_id === '' ? null : idv(batch_id, 'batch')),
    };
    if (next.batch_id !== cur.batch_id) {
      assertDraftBatch(next.batch_id);
      if (cur.batch_id) {
        const old = db.prepare('SELECT number, status FROM batches WHERE id = ?').get(cur.batch_id);
        if (old && old.status !== 'draft') throw conflict(`Batch ${old.number} has started; this team can no longer be moved`);
      }
    }
    if (db.prepare('SELECT 1 FROM teams WHERE name = ? COLLATE NOCASE AND id != ?').get(next.name, teamId)) throw conflict(`A team named "${next.name}" already exists`);
    db.prepare('UPDATE teams SET name = ?, members = ?, batch_id = ? WHERE id = ?').run(next.name, JSON.stringify(next.members), next.batch_id, teamId);
  }

  async function resetPassword(teamId, password) {
    const t = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!t) throw notFound('Team not found');
    let generated = false;
    if (!password) { password = generatePassword(10); generated = true; }
    else if (String(password).length < 6) throw bad('Password must be at least 6 characters');
    db.prepare('UPDATE teams SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(String(password)), teamId);
    auth.revokeUserSessions('team', teamId);
    return { password, generated_password: generated };
  }

  function disqualify(teamId, reason) {
    const cur = db.prepare('SELECT id, disqualified FROM teams WHERE id = ?').get(teamId);
    if (!cur) throw notFound('Team not found');
    const note = typeof reason === 'string' ? reason.trim() : '';
    db.prepare('UPDATE teams SET disqualified = 1, disqualified_at = ?, disqualification_reason = ? WHERE id = ?')
      .run(now(), note.slice(0, 500), teamId);
    return { id: teamId, disqualified: true, reason: note.slice(0, 500) };
  }

  function reinstate(teamId) {
    const cur = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!cur) throw notFound('Team not found');
    db.prepare('UPDATE teams SET disqualified = 0, disqualified_at = NULL, disqualification_reason = \"\" WHERE id = ?').run(teamId);
    return { id: teamId, disqualified: false, reason: '' };
  }

  function remove(teamId) {
    const r = db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
    if (!r.changes) throw notFound('Team not found');
  }

  return { create, bulkCreate, list, update, resetPassword, disqualify, reinstate, remove };
}

module.exports = { makeTeams };
