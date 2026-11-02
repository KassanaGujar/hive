# Hive — build progress (resume file)

> If a session ends mid-build, read this file first, then `git log --oneline`, then continue
> from "Next up". The full product spec is in `docs/PRD.md`.

## Decisions made (Claude's calls, user said "just go")
- Electron 45 + electron-vite 6 + React 19 + Tailwind 4 + Zustand; TypeScript 5.9.
- npm workspaces monorepo; internal packages are imported via path aliases (`@hive/*` → `packages/*/src`)
  and bundled into the app, so there's no per-package build step.
- SQLite via Node's built-in `node:sqlite` (Electron 45 ships Node 24) — no native rebuild needed.
- Terminal via `@lydell/node-pty` (prebuilt binaries, no Visual Studio build tools needed).
- Collaboration: a custom tiny relay (`services/relay`) that only forwards/stores **encrypted** Yjs
  updates (AES-GCM, key lives in the invite link `#fragment`), so the relay never sees plaintext.
  y-websocket's server can't do E2E (it must read the doc), hence custom.
- Relay hosting is still open (user: "compare options first") — see `docs/relay-hosting.md`.
- Beta is Windows-only (user answer); Mac/Linux targets stay in the builder config but untested.
- Free hosted tier IS included (user answer). Name "Hive" kept as placeholder.

## Status by milestone (code written for ALL features; verification status noted)
- [x] M0 Foundations — monorepo, typed IPC, store, secrets, updater wiring, builder config. (CI workflow: TODO)
- [x] M1 Workspace + Run — VERIFIED in the running app: explorer, Monaco tabs, PowerShell terminal (node-pty),
      Run on static HTML → built-in server → Preview tab shows the page.
- [x] M2 Model store + AI chat — hw scan/ollama/catalog verified via IPC; llama3.2 detected + catalog-matched.
- [x] M3 Agents — VERIFIED: integration test (real git worktrees, scripted models) + a REAL run with llama3.2:3b
      (plan → 6 tasks in worktrees → lead reviews/rounds → merged → final merge; branches cleaned).
      Added file-ownership task merging + owned-file context for small models after that run.
- [~] M4 Collaboration — relay + provider E2E tested (2 clients, encryption, offline, invites). UI two-instance test: next.
- [~] M5 Planning room — logic unit-tested; UI written, not yet clicked through.
- [~] M6 Setup wizard renders (verified); download page, CI workflow, relay-hosting doc: TODO.

## How to test the app (what Claude does)
- Build: `cd apps/desktop && npx electron-vite build`
- Run isolated: `HIVE_USER_DATA=<scratch>/profile1 npx electron . --remote-debugging-port=9333`
- Drive it with a CDP script (eval JS / screenshot) — see git history for scratch `cdp.mjs` idea:
  connect to http://127.0.0.1:9333/json → Runtime.evaluate / Page.captureScreenshot.
- `window.hive.invoke(channel, ...args)` is available in the page for IPC-level checks.

## Next up
1. Two-instance collab test through the UI (host shares via Team panel, friend joins).
2. Planning room click-through with a real model.
3. Download page (site/), GitHub Actions release workflow, docs/relay-hosting.md, README.
4. Re-run real agent test after the ownership change.

## Known gaps / ideas
- Catalog URL + electron-builder `publish.owner` use placeholders (REPLACE_WITH_GITHUB_USER / Beanman).
- No app icon yet (build/icon.ico).
- Viewer role is enforced by the relay for doc updates; editor UI is read-only for viewers.

## Log
- 2026-11-02: repo initialised; core packages; main process; renderer; app builds and runs; real agent run OK.
