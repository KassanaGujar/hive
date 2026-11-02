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

## Status by milestone
- [ ] M0 Foundations
- [ ] M1 Workspace + Run (F3, F4)
- [ ] M2 Model store + AI chat (F2)
- [ ] M3 Agent hierarchy (F5)
- [ ] M4 Collaboration (F6)
- [ ] M5 Planning room (F7)
- [ ] M6 Setup wizard, download page, CI (F1)

## Next up
- Renderer UI (apps/desktop/src/renderer): layout, explorer, Monaco, terminal, git, run, model store,
  AI chat, agents board, collab (invite/join/feed/chat), planning room, setup wizard.
- Then: typecheck + `npm run build`, launch with `npm run dev`, fix issues.
- Then: CI workflow, download page (site/), docs/relay-hosting.md.

## Done so far
- packages/shared (types + typed IPC contract), packages/models (catalog filter, fit labels, ranking,
  OpenAI-compatible streaming client + JSON tool fallback), packages/editor (project detection),
  packages/agents (policy, scheduler, guard, sandboxed tools, Orchestrator), packages/collab (E2E crypto,
  invites, protocol, plan doc logic, feed, HiveProvider), services/relay (+ Dockerfile). 43 tests pass.
- apps/desktop main process: store (node:sqlite), secrets, project/fs, terminal (node-pty), git (+GitOps),
  runner, ollama manager, hardware, models, agents host, setup (git via winget), updater, embedded relay.

## Log
- 2026-11-02: repo initialised; core packages committed; main process written.
