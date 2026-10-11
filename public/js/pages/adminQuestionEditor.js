import { api } from '../api.js';
import { el, clear, toast } from '../util.js';
import { navigate } from '../router.js';

let testSeq = 0;

export async function renderAdminQuestionEditor(root, params) {
  clear(root);
  const isNew = !params.id;
  let question = null;
  if (!isNew) {
    try { question = await api.get(`/api/admin/questions/${params.id}`); }
    catch (e) { root.appendChild(el('div', { class: 'empty' }, e.message)); return; }
  }
  const locked = question && question.locked;

  root.appendChild(el('div', { class: 'panel-head' }, [
    el('h1', {}, isNew ? 'New Question' : `Edit Q${question.id}: ${question.title}`),
    el('a', { href: '#/admin/questions', class: 'btn btn-ghost' }, '← Back to bank'),
  ]));

  if (locked) {
    root.appendChild(el('div', { class: 'alert alert-info' },
      'This question has been used in a batch that already started, so it is locked and read-only. Archive it and create a corrected copy if it needs changes.'));
  }

  const f = {
    title: el('input', { type: 'text', value: question ? question.title : '', disabled: locked, maxlength: 150 }),
    difficulty: el('select', { disabled: locked }, ['easy', 'medium', 'hard'].map((d) => el('option', { value: d, selected: question && question.difficulty === d }, d[0].toUpperCase() + d.slice(1)))),
    topic: el('input', { type: 'text', value: question ? question.topic : '', disabled: locked, maxlength: 60 }),
    time_limit_ms: el('input', { type: 'number', value: question ? question.time_limit_ms : 2000, disabled: locked, min: 100, max: 20000, step: 100 }),
    memory_limit_mb: el('input', { type: 'number', value: question ? question.memory_limit_mb : 256, disabled: locked, min: 16, max: 2048, step: 16 }),
    statement: el('textarea', { rows: 6, disabled: locked, style: 'font-family:var(--font-body)' }, question ? question.statement : ''),
    input_format: el('textarea', { rows: 2, disabled: locked, style: 'font-family:var(--font-body)' }, question ? question.input_format : ''),
    output_format: el('textarea', { rows: 2, disabled: locked, style: 'font-family:var(--font-body)' }, question ? question.output_format : ''),
    constraints_text: el('textarea', { rows: 2, disabled: locked, style: 'font-family:var(--font-body)' }, question ? question.constraints_text : ''),
  };

  const testsBox = el('div', { id: 'tests-box' });
  const tests = (question ? question.tests : []).map((t) => ({ key: ++testSeq, input: t.input, expected_output: t.expected_output, is_sample: !!t.is_sample }));
  if (!tests.length) { tests.push({ key: ++testSeq, input: '', expected_output: '', is_sample: true }); tests.push({ key: ++testSeq, input: '', expected_output: '', is_sample: false }); }

  function renderTests() {
    clear(testsBox);
    tests.forEach((t, i) => testsBox.appendChild(testRow(t, i)));
  }

  function testRow(t, i) {
    const sampleCb = el('input', { type: 'checkbox', checked: t.is_sample, disabled: locked, onchange: () => { t.is_sample = sampleCb.checked; } });
    const inputTa = el('textarea', { rows: 3, disabled: locked, placeholder: 'stdin for this test', oninput: () => { t.input = inputTa.value; } }, t.input);
    const outputTa = el('textarea', { rows: 3, disabled: locked, placeholder: 'expected stdout', oninput: () => { t.expected_output = outputTa.value; } }, t.expected_output);
    return el('div', { class: 'panel', style: 'padding:14px;margin-bottom:10px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
        el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
          el('span', { class: 'mono muted' }, `Test ${i + 1}`),
          el('label', { class: 'checkbox-row', style: 'margin:0' }, [sampleCb, el('span', {}, 'Sample (visible to teams)')]),
        ]),
        !locked ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => { tests.splice(i, 1); renderTests(); } }, 'Remove') : null,
      ]),
      el('div', { class: 'row' }, [
        el('div', { style: 'flex:1' }, [el('label', {}, 'Input'), inputTa]),
        el('div', { style: 'flex:1' }, [el('label', {}, 'Expected output'), outputTa]),
      ]),
    ]);
  }
  renderTests();

  const addSampleBtn = el('button', { class: 'btn btn-sm', type: 'button', disabled: locked, onclick: () => { tests.push({ key: ++testSeq, input: '', expected_output: '', is_sample: true }); renderTests(); } }, '+ Add sample test');
  const addHiddenBtn = el('button', { class: 'btn btn-sm', type: 'button', disabled: locked, onclick: () => { tests.push({ key: ++testSeq, input: '', expected_output: '', is_sample: false }); renderTests(); } }, '+ Add hidden test');

  const saveBtn = el('button', { class: 'btn btn-primary', type: 'submit', disabled: locked }, isNew ? 'Create question' : 'Save changes');
  const errorBox = el('div', { class: 'alert alert-error', style: 'display:none' });

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      const payload = {
        title: f.title.value.trim(), difficulty: f.difficulty.value, topic: f.topic.value.trim(),
        statement: f.statement.value.trim(), input_format: f.input_format.value.trim(), output_format: f.output_format.value.trim(),
        constraints_text: f.constraints_text.value.trim(),
        time_limit_ms: Number(f.time_limit_ms.value), memory_limit_mb: Number(f.memory_limit_mb.value),
        tests: tests.map((t) => ({ input: t.input, output: t.expected_output, sample: t.is_sample })),
      };
      saveBtn.disabled = true;
      try {
        if (isNew) {
          const r = await api.post('/api/admin/questions', payload);
          toast('Question created.', 'success');
          navigate(`/admin/questions/${r.id}`);
        } else {
          await api.put(`/api/admin/questions/${question.id}`, payload);
          toast('Question saved.', 'success');
          navigate('/admin/questions');
        }
      } catch (err) {
        errorBox.textContent = err.message; errorBox.style.display = '';
      } finally { saveBtn.disabled = locked; }
    },
  }, [
    errorBox,
    el('div', { class: 'panel' }, [
      el('div', { class: 'field' }, [el('label', {}, 'Title'), f.title]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Difficulty'), f.difficulty]),
        el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Topic'), f.topic]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Time limit (ms)'), f.time_limit_ms]),
        el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Memory limit (MB)'), f.memory_limit_mb]),
      ]),
      el('div', { class: 'field' }, [el('label', {}, 'Statement'), f.statement]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Input format'), f.input_format]),
        el('div', { class: 'field', style: 'flex:1' }, [el('label', {}, 'Output format'), f.output_format]),
      ]),
      el('div', { class: 'field' }, [el('label', {}, 'Constraints'), f.constraints_text]),
    ]),
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h3', {}, 'Test cases'), !locked ? el('div', { style: 'display:flex;gap:8px' }, [addSampleBtn, addHiddenBtn]) : null]),
      el('p', {}, 'At least one sample (shown to teams) and one hidden test (used only for judging) are required.'),
      testsBox,
    ]),
    !locked ? el('div', { style: 'display:flex;gap:10px' }, [saveBtn, el('a', { href: '#/admin/questions', class: 'btn btn-ghost' }, 'Cancel')]) : null,
  ]);

  root.appendChild(form);
}
