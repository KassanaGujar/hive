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

## Status by milestone (all features written; verification noted)
- [x] M0 Foundations — monorepo, typed IPC, SQLite (node:sqlite) store VERIFIED in packaged app, secrets,
      updater wiring, CI workflow (.github/workflows/release.yml — not yet run on GitHub).
- [x] M1 Workspace + Run — VERIFIED: explorer, Monaco, PowerShell terminal, Run static HTML → Preview.
- [x] M2 Model store + AI chat — hw/ollama/catalog verified; llama3.2 detected. Free-online key test not
      exercised (needs a real free key from the user).
- [x] M3 Agents — VERIFIED: integration test (real worktrees) + REAL run with llama3.2:3b end to end.
- [x] M4 Collaboration — VERIFIED with two app instances: host shares (local relay), friend joins, files
      sync both ways (friend→host 1.0 s, host→friend 0.5 s), feed shows teammate edits with diffs,
      teammate terminal mirror visible.
- [x] M5 Planning room — VERIFIED: two people chatting, Planner auto-ran with llama3.2 and added traced items.
- [x] M6 Installer — VERIFIED: `npx electron-builder --win` → release/0.1.0/Hive-Setup-0.1.0.exe (126 MB);
      packaged app runs (catalog, sqlite, node-pty OK). Download page in site/. Relay hosting doc written.

## How to test the app (what Claude does)
- Build: `cd apps/desktop && npx electron-vite build`
- Run isolated: `HIVE_USER_DATA=<scratch>/profile1 npx electron . --remote-debugging-port=9333`
- Drive it with a CDP script (eval JS / screenshot) — see git history for scratch `cdp.mjs` idea:
  connect to http://127.0.0.1:9333/json → Runtime.evaluate / Page.captureScreenshot.
- `window.hive.invoke(channel, ...args)` is available in the page for IPC-level checks.

## Next up
1. User decisions: GitHub repo/username (fill REPLACE_WITH_GITHUB_USER + DEFAULT_CATALOG_URL), relay host
   (see docs/relay-hosting.md), app icon.
2. Not yet click-tested: setup wizard steps 2–3 on a clean VM, code-only invite join through the dialog,
   AI chat accept/reject diff, git panel commit, viewer role, kick, free-online key paste.
3. Small-model quality: Planner misses decisions/questions with 3B; consider stronger default for Architect.
4. Playwright e2e tests (PRD testing plan) — not started.

## Known gaps / ideas
- Catalog URL + electron-builder `publish.owner` use placeholders (REPLACE_WITH_GITHUB_USER / Beanman).
- No app icon yet (build/icon.ico).
- FIXED: Chromium's scrollIntoView now returns a Promise → never return it from useEffect.
- Viewer role is enforced by the relay for doc updates; editor UI is read-only for viewers.

## Log
- 2026-11-02: repo initialised; core packages; main process; renderer; app builds and runs; real agent run OK; collab + planning verified with 2 instances; installer builds.
