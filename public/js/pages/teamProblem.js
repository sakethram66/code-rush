import { api } from '../api.js';
import { el, clear, toast, debounce, fmtDateTime, SUBMISSION_LABELS } from '../util.js';
import { navigate } from '../router.js';

const STARTERS = {
  python: '# Read input with input(), print your answer with print()\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n    }\n}\n',
};
const LANG_LABEL = { python: 'Python 3', c: 'C', java: 'Java' };

export async function renderTeamProblem(root, params) {
  clear(root);
  let destroyed = false;
  let saveTimer = null;
  let submissionPoll = null;

  let q;
  try { q = await api.get(`/api/team/questions/${params.id}`); }
  catch (e) { root.appendChild(el('div', { class: 'empty' }, e.message)); return {}; }

  let language = q.last_language || 'python';
  const editor = el('textarea', { class: 'code-editor', spellcheck: 'false' });
  editor.value = (q.drafts[language] && q.drafts[language].code) || STARTERS[language];
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = editor;
      editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 4;
      queueSave();
    }
  });

  const saveNote = el('div', { class: 'autosave-note' }, '');
  const queueSave = debounce(async () => {
    try { await api.put(`/api/team/questions/${q.id}/draft`, { language, code: editor.value }); saveNote.textContent = `Saved ${new Date().toLocaleTimeString()}`; }
    catch (e) { saveNote.textContent = 'Could not save draft: ' + e.message; }
  }, 700);
  editor.addEventListener('input', queueSave);

  const langSelect = el('select', {}, Object.keys(LANG_LABEL).map((l) => el('option', { value: l, selected: l === language }, LANG_LABEL[l])));
  langSelect.addEventListener('change', () => {
    language = langSelect.value;
    editor.value = (q.drafts[language] && q.drafts[language].code) || STARTERS[language];
    queueSave();
  });

  root.appendChild(el('a', { href: '#/team', style: 'display:inline-block;margin-bottom:14px' }, '← Back to dashboard'));

  const split = el('div', { class: 'problem-split' });
  root.appendChild(split);

  // ---- left: statement ----
  const statement = el('div', { class: 'statement panel' });
  statement.appendChild(el('div', { class: 'panel-head' }, [
    el('h1', {}, `Q${q.position}. ${q.title}`),
    el('span', { class: `badge badge-${q.difficulty}` }, q.difficulty[0].toUpperCase() + q.difficulty.slice(1)),
  ]));
  if (q.solved) statement.appendChild(el('div', { class: 'alert alert-success' }, 'You have already solved this question.'));
  statement.appendChild(el('p', { style: 'white-space:pre-wrap' }, q.statement));
  if (q.input_format) statement.appendChild(el('div', {}, [el('h4', {}, 'Input format'), el('p', { style: 'white-space:pre-wrap' }, q.input_format)]));
  if (q.output_format) statement.appendChild(el('div', {}, [el('h4', {}, 'Output format'), el('p', { style: 'white-space:pre-wrap' }, q.output_format)]));
  if (q.constraints) statement.appendChild(el('div', {}, [el('h4', {}, 'Constraints'), el('p', { style: 'white-space:pre-wrap' }, q.constraints)]));
  statement.appendChild(el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:8px' }, `Time limit ${q.time_limit_ms} ms · Memory limit ${q.memory_limit_mb} MB`));
  q.samples.forEach((s, i) => {
    statement.appendChild(el('div', { class: 'sample' }, [
      el('h3', {}, `Sample ${i + 1}`),
      el('div', { class: 'cols' }, [
        el('div', {}, [el('h4', {}, 'Input'), el('pre', {}, s.input)]),
        el('div', {}, [el('h4', {}, 'Output'), el('pre', {}, s.output)]),
      ]),
    ]));
  });
  split.appendChild(statement);

  // ---- right: editor + run/submit ----
  const right = el('div');
  const toolbar = el('div', { class: 'editor-toolbar' }, [
    langSelect,
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => runCode('samples') }, 'Run samples'),
    el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: submitCode }, 'Submit'),
  ]);
  right.append(el('div', { class: 'panel' }, [toolbar, editor, saveNote]));

  const runResultBox = el('div', { class: 'run-panel' });
  right.appendChild(runResultBox);
  const submitResultBox = el('div', { class: 'run-panel' });
  right.appendChild(submitResultBox);

  const historyBox = el('div', { class: 'panel' }, [el('h3', {}, 'Your submissions')]);
  right.appendChild(historyBox);
  renderHistory(q.submissions);

  split.appendChild(right);

  async function runCode(mode) {
    clear(runResultBox);
    runResultBox.appendChild(el('div', { class: 'empty' }, [el('span', { class: 'spinner' }), ' Running…']));
    try {
      const res = await api.post(`/api/team/questions/${q.id}/run`, { language, code: editor.value, mode, input: '' });
      clear(runResultBox);
      runResultBox.appendChild(el('div', { class: `alert ${res.status === 'accepted' || res.status === 'ok' ? 'alert-success' : 'alert-error'}` },
        `${res.status === 'accepted' ? 'All samples passed' : 'Some samples failed'}${res.message ? ': ' + res.message : ''}`));
      res.cases.forEach((c, i) => runResultBox.appendChild(caseCard(c, i)));
    } catch (e) {
      clear(runResultBox);
      runResultBox.appendChild(el('div', { class: 'alert alert-error' }, e.message));
    }
  }

  function caseCard(c, i) {
    const ok = c.status === 'accepted' || c.status === 'ok';
    const body = [];
    if (c.input !== undefined) body.push(pairBlock('Input', c.input, 'Your output', c.actual));
    if (c.expected !== null && c.expected !== undefined) body.push(pairBlock('Expected output', c.expected, 'Note', c.note || (c.stderr ? c.stderr : '')));
    else if (c.stderr) body.push(el('div', {}, [el('h4', {}, 'Stderr'), el('pre', {}, c.stderr)]));
    return el('div', { class: 'case-result' }, [
      el('div', { class: 'hd' }, [el('span', {}, `Case ${i + 1} · ${c.timeMs}ms`), el('span', { class: `badge ${ok ? 'badge-solved' : 'badge-hard'}` }, SUBMISSION_LABELS[c.status] || c.status)]),
      ...body,
    ]);
  }
  function pairBlock(l1, v1, l2, v2) {
    return el('div', { class: 'bd' }, [el('div', {}, [el('h4', {}, l1), el('pre', {}, v1)]), el('div', {}, [el('h4', {}, l2), el('pre', {}, v2 || '')])]);
  }

  async function submitCode() {
    if (!editor.value.trim()) { toast('Write some code first.', 'error'); return; }
    clear(submitResultBox);
    submitResultBox.appendChild(el('div', { class: 'alert alert-info' }, [el('span', { class: 'spinner' }), ' Submitting…']));
    try {
      const r = await api.post(`/api/team/questions/${q.id}/submit`, { language, code: editor.value });
      pollSubmission(r.id);
    } catch (e) {
      clear(submitResultBox);
      submitResultBox.appendChild(el('div', { class: 'alert alert-error' }, e.message));
    }
  }

  function pollSubmission(id) {
    if (submissionPoll) clearInterval(submissionPoll);
    submissionPoll = setInterval(async () => {
      if (destroyed) return clearInterval(submissionPoll);
      try {
        const s = await api.get(`/api/team/submissions/${id}`);
        if (s.status === 'queued' || s.status === 'judging') return;
        clearInterval(submissionPoll);
        clear(submitResultBox);
        const ok = s.status === 'accepted';
        submitResultBox.appendChild(el('div', { class: `alert ${ok ? 'alert-success' : 'alert-error'}` }, [
          el('strong', {}, SUBMISSION_LABELS[s.status] || s.status),
          ok ? ' — question solved, +10 points.' : ` — ${s.passed_tests}/${s.total_tests} hidden tests passed.${s.message ? ' ' + s.message : ''}`,
        ]));
        if (ok) { toast('Accepted! +10 points.', 'success'); q.solved = true; }
        const fresh = await api.get(`/api/team/questions/${q.id}/submissions`);
        renderHistory(fresh);
      } catch (e) { clearInterval(submissionPoll); }
    }, 1200);
  }

  function renderHistory(list) {
    const rows = historyBox.querySelectorAll('.kv, .empty');
    rows.forEach((r) => r.remove());
    if (!list.length) { historyBox.appendChild(el('div', { class: 'empty' }, 'No submissions yet.')); return; }
    list.forEach((s) => {
      historyBox.appendChild(el('div', { class: 'kv' }, [
        el('span', {}, [`${LANG_LABEL[s.language]} · `, el('span', { class: 'muted' }, fmtDateTime(s.submitted_at))]),
        el('span', { class: `badge ${s.status === 'accepted' ? 'badge-solved' : s.status === 'queued' || s.status === 'judging' ? 'badge-attempted' : 'badge-hard'}` }, SUBMISSION_LABELS[s.status] || s.status),
      ]));
    });
  }

  return { destroy() { destroyed = true; if (submissionPoll) clearInterval(submissionPoll); } };
}
