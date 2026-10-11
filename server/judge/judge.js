'use strict';
const path = require('path');
const { detectTools, runSandboxed, makeWorkDir, writeSandboxFile, removeDir } = require('./runner');

const LANGS = ['c', 'java', 'python'];

// Line-wise comparison that ignores trailing whitespace and trailing blank lines
function normalize(s) {
  const lines = String(s).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\f\v]+$/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
function outputsMatch(actual, expected) {
  const a = normalize(actual); const e = normalize(expected);
  if (a.length !== e.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== e[i]) return false;
  return true;
}

function scrub(text, dir) {
  if (!text) return '';
  let t = String(text);
  if (dir) t = t.split(dir + path.sep).join('').split(dir).join('');
  return t.length > 4000 ? t.slice(0, 4000) + '\n…[truncated]' : t;
}
const clip = (s, n = 4000) => (s.length > n ? s.slice(0, n) + '\n…[truncated]' : s);

function javaClassName(code) {
  const m = /public\s+(?:final\s+|abstract\s+)*class\s+([A-Za-z_$][\w$]*)/.exec(code);
  return m ? m[1] : 'Main';
}

async function compile(language, code, dir, cfg) {
  const tools = detectTools();
  const common = { cwd: dir, timeoutMs: cfg.compileTimeoutMs, cpuSeconds: Math.ceil(cfg.compileTimeoutMs / 1000), nproc: 512, network: false };
  if (language === 'python') {
    await writeSandboxFile(dir, 'main.py', code, cfg);
    const checker = [
      'import sys',
      "src = open('main.py', encoding='utf-8').read()",
      'try:',
      "    compile(src, 'main.py', 'exec')",
      'except (SyntaxError, ValueError) as e:',
      "    print('%s: %s (line %s)' % (e.__class__.__name__, getattr(e, 'msg', e), getattr(e, 'lineno', '?')))",
      "    t = getattr(e, 'text', None)",
      '    if t: print(t.rstrip())',
      '    sys.exit(1)',
    ].join('\n');
    const r = await runSandboxed({ ...common, cmd: tools.python, args: ['-B', '-c', checker], memoryMb: 512 }, cfg);
    return { ok: r.exitCode === 0 && !r.timedOut, output: scrub(r.stderr || r.stdout, dir), run: { cmd: tools.python, args: ['-B', '-I', 'main.py'] } };
  }
  if (language === 'c') {
    await writeSandboxFile(dir, 'main.c', code, cfg);
    const r = await runSandboxed({ ...common, cmd: tools.gcc,
      args: ['-O2', '-std=gnu17', '-pipe', '-fmax-errors=8', '-o', 'main', 'main.c', '-lm'], memoryMb: 1536 }, cfg);
    return { ok: r.exitCode === 0 && !r.timedOut, output: scrub(r.stderr || r.stdout, dir), run: { cmd: path.join(dir, 'main'), args: [] } };
  }
  // java
  const cls = javaClassName(code);
  await writeSandboxFile(dir, `${cls}.java`, code, cfg);
  const cmd = tools.javac ? tools.javac : tools.java;
  const args = tools.javac
    ? ['-encoding', 'UTF-8', '-Xmaxerrs', '8', `${cls}.java`]
    : ['-Xshare:auto', '-XX:+UseSerialGC', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8', '-Xmaxerrs', '8', `${cls}.java`];
  const r = await runSandboxed({ ...common, cmd, args, memoryMb: null, nproc: 512 }, cfg);
  return { ok: r.exitCode === 0 && !r.timedOut, output: scrub(r.stderr || r.stdout, dir), run: { cmd: tools.java, args: null, cls } };
}

function runSpec(language, compiled, dir, { memoryMb, timeMs }, cfg) {
  const tools = detectTools();
  const mult = cfg.timeMultiplier[language] || 1;
  const grace = language === 'java' ? 700 : language === 'python' ? 150 : 50;
  const limits = {
    cwd: dir,
    timeoutMs: Math.round(timeMs * mult) + grace,
    cpuSeconds: Math.ceil((timeMs * mult) / 1000) + 2,
    stackMb: Math.min(memoryMb, 256),
  };
  if (language === 'c') {
    return { ...limits, cmd: compiled.run.cmd, args: [], memoryMb: memoryMb + cfg.memoryHeadroomMb.c + 32 };
  }
  if (language === 'python') {
    return { ...limits, cmd: tools.python, args: ['-B', '-I', 'main.py'], memoryMb: memoryMb + cfg.memoryHeadroomMb.python + 64 };
  }
  // Java reserves lots of address space, so bound the heap instead of RLIMIT_AS
  return {
    ...limits, memoryMb: null, nproc: 512,
    cmd: tools.java,
    args: [`-Xmx${memoryMb}m`, '-Xss64m', '-Xms16m', '-XX:+UseSerialGC', '-XX:-UsePerfData', '-XX:TieredStopAtLevel=4',
      '-Xshare:auto', '-cp', dir, compiled.run.cls],
  };
}

function classify(r, language) {
  if (r.spawnError) return { status: 'internal_error', note: r.spawnError };
  if (r.timedOut) return { status: 'time_limit' };
  if (r.outputExceeded) return { status: 'output_limit' };
  const errText = r.stderr || '';
  if (/MemoryError|OutOfMemoryError|std::bad_alloc|Cannot allocate memory|Java heap space|GC overhead/i.test(errText)) {
    return { status: 'memory_limit' };
  }
  if (r.signal === 'SIGKILL') return { status: 'memory_limit' }; // OOM killer / RLIMIT enforcement
  if (r.signal) return { status: 'runtime_error', note: `Terminated by signal ${r.signal}` };
  if (r.exitCode !== 0) return { status: 'runtime_error', note: `Exit code ${r.exitCode}` };
  return { status: 'ok' };
}

/**
 * Compile once, then execute the program against each case.
 *
 * cases: [{ input, expected|null, expose:boolean }]
 *   - expose=true  : the result includes input / expected / actual / stderr (samples & custom input only)
 *   - expose=false : hidden test, only verdict + time are returned (nothing that could leak test data)
 * opts: { stopOnFail, timeLimitMs, memoryMb }
 */
async function execute({ language, code, cases, timeLimitMs = 2000, memoryMb = 256, stopOnFail = true }, cfg) {
  const tools = detectTools();
  if (!LANGS.includes(language)) return { status: 'internal_error', message: 'Unsupported language', cases: [] };
  if (!tools.linuxHost) return { status: 'internal_error', message: 'Code judging requires a Linux host for sandbox isolation. Run Code Rush on Linux or in Docker.', cases: [] };
  if (!tools.languages[language]) {
    return { status: 'internal_error', message: `The ${language} toolchain is not installed on the judge host.`, cases: [] };
  }
  const dir = await makeWorkDir(cfg);
  try {
    const comp = await compile(language, code, dir, cfg);
    if (!comp.ok) {
      return { status: 'compile_error', message: comp.output || 'Compilation failed', cases: [], passed: 0, total: cases.length };
    }
    const results = [];
    let passed = 0; let maxMs = 0; let final = 'accepted'; let failedTest = null; let message = '';
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const r = await runSandboxed({ ...runSpec(language, comp, dir, { memoryMb, timeMs: timeLimitMs }, cfg), stdin: c.input }, cfg);
      const cls = classify(r, language);
      let status = cls.status;
      let matched = null;
      if (status === 'ok') {
        if (c.expected === null || c.expected === undefined) { status = 'ok'; }
        else {
          matched = outputsMatch(r.stdout, c.expected);
          status = matched ? 'accepted' : 'wrong_answer';
        }
      }
      maxMs = Math.max(maxMs, r.wallMs);
      const entry = { index: i + 1, status, timeMs: r.wallMs, expose: !!c.expose };
      if (c.expose) {
        entry.input = clip(c.input, 2000);
        entry.expected = c.expected == null ? null : clip(c.expected, 2000);
        entry.actual = clip(r.stdout, 4000);
        entry.stderr = scrub(r.stderr, dir);
        if (cls.note) entry.note = cls.note;
      }
      results.push(entry);
      if (status === 'accepted') passed++;
      else if (c.expected !== null && c.expected !== undefined && status !== 'ok') {
        if (final === 'accepted') { final = status; failedTest = i + 1; message = cls.note || ''; }
        if (stopOnFail) break;
      } else if (status !== 'ok' && final === 'accepted') {
        final = status; failedTest = i + 1; message = cls.note || '';
        if (stopOnFail) break;
      }
    }
    return { status: final, passed, total: cases.length, failedTest, execMs: maxMs, message, cases: results };
  } catch (e) {
    return { status: 'internal_error', message: 'Judge error: ' + e.message, cases: [] };
  } finally {
    await removeDir(dir);
  }
}

module.exports = { execute, outputsMatch, normalize, LANGS, javaClassName, detectTools };
