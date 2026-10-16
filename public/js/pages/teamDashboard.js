import { api } from '../api.js';
import { el, clear, fmtDuration, difficultyBadge, statusBadge } from '../util.js';

const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export async function renderTeamDashboard(root) {
  clear(root);
  let clockOffset = 0;
  let pollTimer = null;
  let tickTimer = null;
  let destroyed = false;
  let st = null;

  async function poll() {
    if (destroyed) return;
    try {
      st = await api.get('/api/team/state');
      clockOffset = st.server_now - Date.now();
      draw();
    } catch (e) { /* transient network errors: keep the previous view, retry on next tick */ }
  }

  function draw() {
    if (destroyed || !st) return;
    clear(root);
    root.appendChild(el('h1', {}, `Welcome, ${st.team.name}`));
    root.appendChild(el('p', {}, st.team.members.join(', ')));
    root.appendChild(el('p', { class: 'muted' }, `Points per solved problem: Easy ${st.points_by_difficulty.easy} · Medium ${st.points_by_difficulty.medium} · Hard ${st.points_by_difficulty.hard}.`));

    if (st.phase === 'unassigned') {
      root.appendChild(el('div', { class: 'panel empty' }, 'You have not been assigned to a batch yet. Please check with the organiser.'));
      return;
    }
    if (st.phase === 'waiting') {
      root.appendChild(el('div', { class: 'panel' }, [
        el('h2', {}, `Batch #${st.batch.number}`),
        el('p', {}, `This batch has not started yet. It will run for ${st.batch.duration_minutes} minutes once the organiser starts it — this page will update automatically.`),
      ]));
      return;
    }

    const remaining = st.phase === 'running' ? Math.max(0, st.batch.ends_at - (Date.now() + clockOffset)) : 0;
    const timerBar = el('div', { class: 'panel', style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px' }, [
      el('div', {}, [
        el('div', { class: 'muted', style: 'font-size:12px' }, st.phase === 'running' ? 'Time remaining' : 'Batch finished'),
        el('div', { class: `timer ${remaining < 60000 && st.phase === 'running' ? 'low' : ''}` }, fmtDuration(remaining)),
      ]),
      el('div', { class: 'score-strip' }, [
        scoreChip(st.score, `of ${st.max_score} points`),
        scoreChip(st.solved, `of ${st.total_questions} solved`),
        st.pending ? scoreChip(st.pending, 'judging…') : null,
      ]),
    ]);
    root.appendChild(timerBar);

    if (st.phase === 'finished') {
      root.appendChild(el('div', { class: 'alert alert-info' }, 'Time is up for this batch.'));
    }

    const grouped = { easy: [], medium: [], hard: [] };
    st.questions.forEach((q) => grouped[q.difficulty].push(q));
    const qlist = el('div', { class: 'qlist' });
    Object.keys(grouped).forEach((d) => {
      const solvedCount = grouped[d].filter((q) => q.status === 'solved').length;
      qlist.appendChild(el('div', { class: 'qgroup-label' }, [DIFF_LABEL[d], el('span', { class: 'n' }, `${solvedCount}/${grouped[d].length} solved`)]));
      grouped[d].forEach((q) => {
        qlist.appendChild(el('a', { href: `#/team/questions/${q.id}`, class: 'qrow', style: 'text-decoration:none;color:inherit' }, [
          el('span', { class: 'pos' }, `Q${q.position}`),
          el('span', { class: 'title' }, q.title),
          el('span', { class: 'topic' }, q.topic || ''),
          statusBadge(q.status),
        ]));
      });
    });
    root.appendChild(el('div', { class: 'panel' }, [el('div', { class: 'panel-head' }, [el('h2', {}, 'Problems')]), qlist]));
  }

  function scoreChip(v, label) {
    return el('div', { class: 'score-chip' }, [el('div', { class: 'v' }, String(v)), el('div', { class: 'k' }, label)]);
  }

  await poll();
  pollTimer = setInterval(poll, 6000);
  tickTimer = setInterval(() => { if (st && st.phase === 'running') draw(); }, 1000);

  return { destroy() { destroyed = true; clearInterval(pollTimer); clearInterval(tickTimer); } };
}
