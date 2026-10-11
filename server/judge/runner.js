'use strict';
// Low-level sandboxed process execution used by the judge.
//
// Isolation layers (each is applied when the host supports it):
//   * unprivileged uid/gid via setpriv (when the server runs as root) so judged code cannot read the DB / secrets
//   * `unshare --net` (root only, if permitted) to remove network access
//   * prlimit: CPU seconds, address space, file size, process count, core files, open files, stack
//   * wall-clock timeout with SIGKILL of the whole process group
//   * stdout/stderr size caps
//   * clean temp directory per run, minimal environment
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let toolCache = null;

function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) { /* next */ }
  }
  return null;
}

function detectTools() {
  if (toolCache) return toolCache;
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const t = {
    linuxHost: process.platform === 'linux',
    isRoot,
    prlimit: which('prlimit'),
    setpriv: isRoot ? which('setpriv') : null,
    unshare: null,
    gcc: which('gcc') || which('cc'),
    python: which('python3') || which('python'),
    java: which('java'),
    javac: which('javac'),
  };
  if (isRoot) {
    const u = which('unshare');
    if (u) {
      const r = spawnSync(u, ['--net', 'true'], { timeout: 3000 });
      if (r.status === 0) t.unshare = u;
    }
  }
  t.javaCompilerViaModule = !t.javac && !!t.java &&
    spawnSync(t.java, ['--describe-module', 'jdk.compiler'], { timeout: 8000 }).status === 0;
  t.languages = {
    c: !!t.gcc,
    java: !!t.java && (!!t.javac || t.javaCompilerViaModule),
    python: !!t.python,
  };
  toolCache = t;
  return t;
}

function truncate(buf, max) {
  if (buf.length <= max) return buf.toString('utf8');
  return buf.subarray(0, max).toString('utf8') + '\n…[truncated]';
}

/**
 * Run one command inside the sandbox.
 * @returns {Promise<{exitCode,signal,stdout,stderr,timedOut,outputExceeded,wallMs,spawnError}>}
 */
function runSandboxed(opts, cfg) {
  const tools = detectTools();
  const {
    cmd, args = [], cwd, stdin = '', timeoutMs, memoryMb = null, cpuSeconds = null,
    nproc = 256, fsizeMb = 16, stackMb = null, maxOutput = cfg.maxOutputBytes, network = false,
  } = opts;

  const chain = [];
  if (tools.isRoot) {
    if (tools.unshare && !network) chain.push(tools.unshare, '--net');
    if (tools.setpriv) {
      chain.push(tools.setpriv, `--reuid=${cfg.uid}`, `--regid=${cfg.gid}`, '--clear-groups', '--no-new-privs');
    }
  }
  if (tools.prlimit) {
    chain.push(tools.prlimit, '--core=0', '--nofile=256', `--nproc=${nproc}`, `--fsize=${fsizeMb * 1024 * 1024}`);
    if (cpuSeconds) chain.push(`--cpu=${cpuSeconds}`);
    if (memoryMb) chain.push(`--as=${Math.round(memoryMb * 1024 * 1024)}`);
    if (stackMb) chain.push(`--stack=${Math.round(stackMb * 1024 * 1024)}`);
  }
  chain.push(cmd, ...args);

  const spawnOpts = {
    cwd,
    detached: true, // own process group so the whole tree can be killed
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: cwd,
      TMPDIR: cwd,
      LANG: 'C.UTF-8',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  };
  // Fallback privilege drop when setpriv is unavailable
  if (tools.isRoot && !tools.setpriv) { spawnOpts.uid = cfg.uid; spawnOpts.gid = cfg.gid; }

  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let child;
    try {
      child = spawn(chain[0], chain.slice(1), spawnOpts);
    } catch (e) {
      return resolve({ exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, outputExceeded: false, wallMs: 0, spawnError: e.message });
    }

    const out = []; const err = [];
    let outLen = 0; let errLen = 0;
    let timedOut = false; let outputExceeded = false; let spawnError = null; let settled = false;

    const killGroup = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (__) { /* gone */ } }
    };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);

    child.stdout.on('data', (d) => {
      outLen += d.length;
      if (outLen <= maxOutput + 1) out.push(d);
      if (outLen > maxOutput && !outputExceeded) { outputExceeded = true; killGroup(); }
    });
    child.stderr.on('data', (d) => {
      errLen += d.length;
      if (errLen <= 64 * 1024) err.push(d);
    });
    child.stdin.on('error', () => { /* program may exit without reading its input */ });
    try { child.stdin.end(stdin); } catch (_) { /* ignore */ }

    child.on('error', (e) => { spawnError = e.message; });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killGroup(); // reap anything the program left running in the background
      const wallMs = Number((process.hrtime.bigint() - started) / 1000000n);
      resolve({
        exitCode: code, signal,
        stdout: truncate(Buffer.concat(out), maxOutput),
        stderr: truncate(Buffer.concat(err), 64 * 1024),
        timedOut, outputExceeded, wallMs, spawnError,
      });
    });
  });
}

// Per-run scratch directory owned by the sandbox user.
//
// The dropped-privilege user needs execute ("search") permission on *every* ancestor directory of the
// run dir, not just the run dir itself - otherwise it gets EACCES even though the leaf directory and
// file are readable to it. The default workDir (under the OS temp dir) already satisfies this in
// production, but a JUDGE_WORK_DIR nested inside a private directory (as in the test harness, or a
// custom deployment) would not, so make sure the configured workDir and its immediate parent both grant
// search access to everyone.
async function ensureTraversable(dir) {
  try { await fs.promises.chmod(dir, 0o711); } catch (_) { /* not ours to chmod */ }
}

async function makeWorkDir(cfg) {
  const tools = detectTools();
  await fs.promises.mkdir(cfg.workDir, { recursive: true, mode: 0o711 });
  await ensureTraversable(cfg.workDir);
  await ensureTraversable(path.dirname(cfg.workDir));
  const dir = await fs.promises.mkdtemp(path.join(cfg.workDir, 'run-'));
  await fs.promises.chmod(dir, 0o700);
  if (tools.isRoot) {
    await fs.promises.chown(dir, cfg.uid, cfg.gid);
    await fs.promises.chmod(dir, 0o750);
  }
  return dir;
}

async function writeSandboxFile(dir, name, content, cfg) {
  const tools = detectTools();
  const p = path.join(dir, name);
  await fs.promises.writeFile(p, content, { mode: 0o644 });
  if (tools.isRoot) await fs.promises.chown(p, cfg.uid, cfg.gid);
  return p;
}

const removeDir = (dir) => fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});

module.exports = { detectTools, runSandboxed, makeWorkDir, writeSandboxFile, removeDir };
