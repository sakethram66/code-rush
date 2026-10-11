# PROJECT_PROGRESS.md — Code Rush

> Resume point for the next session. Update the checklist as work completes.
> Project root: `code-rush/` (Node 22 + Express + better-sqlite3, vanilla-JS SPA, no build step).

## Architecture decisions (do not re-litigate)
- **Stack**: Express API, SQLite (better-sqlite3, WAL), static SPA in `public/` (ES modules, hash routing).
- **Auth**: scrypt password hashes; opaque session tokens (sha-256 stored), HttpOnly+SameSite=Strict cookie; JSON-only mutations + Origin check (CSRF); login rate-limit.
- **Timer**: batch-wide. `started_at` / `ends_at` stored in DB (epoch ms). Server is authoritative; a 1s scheduler completes expired batches; submissions rejected once `now > ends_at`. Survives restarts.
- **Question lock**: DB triggers reject any change to `batch_questions` when batch is not `draft`, and reject `draft→running` unless the set is exactly 5 easy / 10 medium / 10 hard. App layer validates first with friendly messages.
- **Scoring**: 10 pts per solved question (accepted = all tests passed, submitted before `ends_at`). Max 250. Ranking: score desc → time of last accepted solve (relative to batch start) asc. No penalties/hints.
- **Judge**: C (gcc), Java (javac or `java -m jdk.compiler`), Python 3. Runs with `prlimit` (cpu/as/nproc/fsize), process-group kill on timeout, output cap, unprivileged uid when server runs as root. Bounded in-process queue; queued/judging submissions re-enqueued on restart.
- **Seed data**: `tools/generate_seed.py` (reference solutions produce expected outputs) → `seed/questions.json` (50 problems: 10 easy / 20 medium / 20 hard).

## Checklist
- [x] Project scaffold + deps + fonts
- [x] DB schema + triggers (`server/db.js`)
- [x] Auth (`server/auth.js`)
- [x] Judge runner + judge + queue (`server/judge/*`)
- [x] Services (questions, teams, batches, scoring)
- [x] Routes (auth, admin, team, public)
- [x] Seed generator + `seed/questions.json`
- [x] Frontend (login, admin, team, leaderboard)
- [x] Automated tests (unit + integration, all 3 languages)
- [x] Docs (README), Dockerfile, docker-compose, .env.example
- [x] Final full test run + zip

## Notes / gotchas
- Sandbox has Java **JRE only**; compile via `java -m jdk.compiler/com.sun.tools.javac.Main` when `javac` is absent.
- Tests: `npm test` (spawns real server on a temp DB).

## Backend status (verified)
`npm test` passes: 31/31 (9 unit + 22 end-to-end integration tests against a real server + real sandboxed judge).
Fixed two real bugs found by testing, both worth knowing about if touching this code again:
1. `server/config.js` — `loadConfig(overrides)` used to let a partial `overrides.judge` object
   clobber the full default judge config (spread order bug). Fixed by destructuring `judge` out of
   `overrides` and merging it separately.
2. `server/judge/runner.js` `makeWorkDir()` — the sandboxed (dropped-privilege) user needs *execute*
   permission on every ancestor directory of its working dir, not just the leaf. If `JUDGE_WORK_DIR`
   is nested inside a directory that isn't world-traversable (e.g. a private temp dir), every run fails
   with `EACCES`. Fixed by chmod'ing `cfg.workDir` and its immediate parent to add o+x. The default
   config (workDir under the OS tmp dir) was never affected, but this would have broken custom
   `JUDGE_WORK_DIR` deployments.

Next: frontend (public/), then docs/Dockerfile, then a final full re-run + zip.

## Frontend status (verified)
Built as a vanilla-JS ES-module SPA (public/), hash routing, no build step. Design: a "scoreboard, not
spreadsheet" visual identity (split-flap/stadium-scoreboard aesthetic; Barlow Condensed for
headings/timer, IBM Plex Mono for all numbers/code, semantic-only color accents). Verified end-to-end
by scripting the exact API calls each page makes (login -> create batch -> manual 5/10/10 selection via
candidates/selection endpoints -> team creation -> start -> team dashboard state -> problem view ->
draft autosave -> run samples -> submit -> scoring -> team + public leaderboard) against the real
running server; all responses match what the page code expects. Static asset serving (index.html, JS
modules, CSS, vendored fonts) confirmed via curl. All page JS files pass `node --check`.

Pages: login (role switch), admin (overview, question bank + editor with test-case editor & import/
export, batches list, batch detail = manual selection UI with live 5/10/10 counters & used-in/planned-in
indicators + locked results view after start, teams incl. bulk create, audit log, settings incl. own
password change), team (dashboard with live countdown + difficulty-grouped problem list, problem view
with statement/samples/code editor/autosave/run/submit/submission history), combined leaderboard
(works logged out, as team, or as admin).

Next: README, Dockerfile/docker-compose/.env.example, then a final full `npm test` run and packaging.
