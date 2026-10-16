# Code Rush

A self-hosted coding-competition platform. An organiser curates a bank of Easy/Medium/Hard problems,
builds **batches** by hand-picking exactly **5 Easy + 10 Medium + 10 Hard** questions per batch, and
starts the clock. Every team assigned to a batch sees the *same* 25 questions in the same fixed order
(Easy 1–5, Medium 6–15, Hard 16–25) for the batch's duration (25 minutes by default). Code in C, Java or
Python is compiled and judged in a sandboxed process. Solved questions award **2 points for Easy, 3 for
Medium, and 5 for Hard** (90 points maximum per batch), with no partial credit, hints, or penalties.
Organisers can view a combined leaderboard across batches; teams do not have leaderboard access.

## Features

- **Question bank** — CRUD, topics, per-question time/memory limits, sample vs. hidden test cases,
  JSON import/export, archiving (a question used in a started batch can never be silently edited).
- **Manual batch selection** — the organiser picks every question by hand; nothing is ever chosen or
  randomized automatically. A batch cannot start until it has exactly 5/10/10, enforced both in the
  API and by a SQLite trigger (defence in depth). Once started, the question set is locked — the API,
  and the database itself, refuse any change.
- **Sandboxed judge** — C (gcc), Java (`javac`, or the JDK's built-in `jdk.compiler` module as a
  fallback), Python 3. Each run gets CPU/memory/file/process limits, an unprivileged user (when the
  server runs as root), and (where the OS allows it) no network access. See **Security** below.
- **Server-authoritative timer** — a batch's start/end times live in the database; a background
  scheduler completes overdue batches automatically, and submissions after the deadline are rejected
  server-side regardless of what the client's clock says. Survives a server restart.
- **Autosave & resume** — a team's code is autosaved per question per language and reloaded on login,
  on refresh, or after the server restarts.
- **Crash-safe judging** — a submission stuck mid-judgement when the server restarts is re-queued and
  judged again automatically; scoring always uses the original submission time, so queue delays never
  cost a team rank.
- **Full audit trail** — every login, question/batch/team change and batch start is logged. Batch
  history keeps the locked question set, participating teams and final results forever.

## Quick start

For an actual contest, use Linux or Docker so student submissions run with the judge sandbox. Native Windows/macOS startup is suitable for exploring the interface only; code judging is disabled on those hosts.

```bash
npm install
npm start
```

The question bank is seeded automatically from `seed/questions.json` (50 problems) on first boot if
it's empty. On first boot, if no admin account exists yet, one is created and its credentials are
printed once to the console:

```
  First run: admin account created
    username: admin
    password: <random>
```

Open `http://localhost:3000`, log in as that admin, and change the password from **Settings**. Team
accounts are created by the organiser from the **Teams** page (each with a username/password) — teams
have no self-registration.

Copy `.env.example` to `.env` (or export the variables directly) to configure the server; see that file
for every option. To set a fixed admin account instead of the generated one, set `ADMIN_USERNAME` and
`ADMIN_PASSWORD` before the first boot.

## Running with Docker

On Windows, install and start Docker Desktop first, then run:

```bash
docker compose up --build
```

This builds an image with Node, gcc, Python 3 and a JDK preinstalled (the judge needs all three at
*runtime*, not just to build the app), and persists the SQLite database in a named volume. See
`docker-compose.yml` for the environment variables it reads from a `.env` file, and **Security** below
for the `cap_add: SYS_ADMIN` note about network isolation under Docker.

## Running the tests

```bash
npm test
```

This runs unit tests (DB triggers, scoring, judge output-comparison, password hashing) and full
end-to-end integration tests that spin up a real server against a temporary database and a real
sandboxed judge: admin login → build a batch → validate the 5/10/10 requirement → lock on start → teams
receive identical fixed-order questions → solve in C, Java and Python → scoring/leaderboard → timer
expiry → server-restart recovery. There is no mocking of the judge; C/Java/Python code is actually
compiled and executed.

## Project structure

```
server/
  db.js            SQLite schema + locking triggers
  auth.js          password hashing, sessions, CSRF, rate limiting
  config.js        environment variable loading and defaults
  judge/
    runner.js      low-level sandboxed process execution
    judge.js       compile + run + compare, per language
    queue.js       bounded-concurrency judging queue
  services/        questions, batches, teams, scoring, contest (business logic)
  routes/          auth, admin, team, public HTTP endpoints
  app.js           Express app wiring, security headers, background scheduler
public/            vanilla-JS SPA (no build step): admin console, team dashboard, leaderboard
seed/questions.json         50 seed problems (10 easy / 20 medium / 20 hard)
tools/                      the generator that produced seed/questions.json (see below)
tests/                      unit + end-to-end integration tests
```

### Regenerating the seed question bank

`seed/questions.json` was produced by `tools/generate_seed.py`, which defines each problem together
with a Python reference solution and runs that solution to produce the expected output for every test
case — so test data can never disagree with the reference implementation. To regenerate it:

```bash
python3 tools/generate_seed.py
```

## Security

Code Rush executes arbitrary, untrusted C/Java/Python programs on the server. The judge applies several
independent layers of defence, each used where the host OS supports it:

1. **Privilege drop** — when the server runs as root (the normal case, including in the provided
   Docker image), judged code runs as an unprivileged uid/gid (`65534` by default, i.e. `nobody`), never
   as the server's own user, so it cannot read the database, session secrets, or other teams' code.
2. **Resource limits** (`prlimit`) — CPU time, address space, file size, process count and core dumps
   are all bounded per run, scaled to each question's time/memory limit (with a per-language multiplier
   since interpreted/JIT languages are inherently slower/heavier: Python ×3, Java ×2 time; Java and
   Python also get extra memory headroom for their runtime overhead).
3. **Process-group timeout kill** — a run that exceeds its wall-clock budget (including forkbombs)
   is `SIGKILL`ed as a whole process group, not just its top-level process.
4. **Network isolation** (`unshare --net`) — removes network access from judged code entirely, when the
   container/host grants the capability to do so. **Under Docker specifically**, this requires
   `cap_add: SYS_ADMIN` (commented out by default in `docker-compose.yml`, since it broadens what the
   container can do); without it, judged code still runs sandboxed and resource-limited, it just isn't
   additionally blocked from opening network sockets. The server detects and logs which layers are
   actually active on startup, and the admin **Overview** page shows the live status of each.
5. **Output size caps** — stdout/stderr are truncated and a run that floods output is killed.
6. **Isolated scratch directories** — each run gets its own temp directory, owned by the sandbox user
   with mode `0750`, removed afterwards.

Other application-level protections: scrypt-hashed passwords; opaque, sha-256-hashed session tokens in
`HttpOnly` + `SameSite=Strict` cookies; a CSRF guard requiring same-origin + `application/json` on every
mutating request; per-IP and per-account login rate limiting; strict input validation on every endpoint;
a restrictive Content-Security-Policy; and hidden-test data that is never returned to teams (only sample
tests and custom-input runs expose input/output — a scored submission's verdict never includes hidden
test contents). The SQLite database file itself is `chmod 600` and lives outside any directory judged
code can reach.

**Threat model note:** this sandboxing is appropriate for a single trusted host running a private
contest (a classroom, a company hackathon, a meetup). It is process-level isolation (rlimits + an
unprivileged user + optional network namespace), not a hardware-virtualized sandbox (like gVisor or a
microVM). If you are hosting a public, adversarial contest at scale, put the judge in its own
container/VM per run or behind a hardened sandbox such as gVisor/Firecracker in addition to the layers
above.

## Environment variables

See `.env.example` for the full list with defaults and explanations (server port/host, database path,
session lifetimes, batch duration default, code size limits, submission cooldown, login rate limits,
and every judge sandbox setting).
