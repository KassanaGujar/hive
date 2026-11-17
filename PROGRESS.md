# Hive — build progress (resume file)

## 🔖 RESUME HERE (2026-11-17 18:40): AI team rerun done, report updated
1. ✅ All local model setups run through the AI team (see qa-checklist Phase 6 note, qa-report bugs + challengeNotes).
   Best: Qwen2.5 Coder 7B alone, Tic-Tac-Toe 7/8 by clicking (tools/qa/ui-check.mjs). Limit = ~3 GB free VRAM.
2. ✅ Fixed: project-switch merge (ctl.root), 5-min fetch timeout, think:false, 6k reply cap, model delete feedback.
3. User actions left: add an Anthropic/OpenRouter key for a strong architect and rerun
   (HIVE_TEAM_MODELS=... QA_TAG=... node tools/qa/run-challenges-team.mjs snake tictactoe); restart Ollama with GPU
   apps closed to retry Qwen 3.5; wrangler deploy; Phase 10 with real users; delete unused models (user OK first).

## 🔁 Follow-up in progress (2026-11-17 night)
- The user (via the side session) disputed "7B model too weak": Phases 6–8 used Ask AI directly, never the AI team.
  Snake probe had a timing false negative (fixed: restart before measuring). Running Phase 6 through the team now:
  `node tools/qa/run-challenges-team.mjs` → results "(AI team)", docs/qa/challenges-team.json.
- Claude as architect needs the user to add an Anthropic key in Models → Your own keys (custom models rank top tier).
- Don't call failures "model mistakes" without a strong-model or team control.

## ✅ QA plan complete (2026-11-17)
Report: `docs/qa-report.md` (regenerate: `node tools/qa/report.mjs`). Checklist: `docs/qa-checklist.md` — every line
resolved ([x] pass, [!] fixed+pass, [F] fail with reason, [~] blocked with reason). Overall score 76/100.
30 bugs found, 26 fixed. Open: Run has no sandbox (by design), Run notices exits 4–8 s late (ConPTY), History entries
duplicated after 3+ shared-project switches, renderer stall under extreme load with simultaneous reloads.
**Needs the user:** `cd services/relay-cf && npx wrangler deploy` (live relay gets view-only enforcement, 25-person cap,
snapshot guard); Phase 10 with two real first-time users; reinstall Hive from a fresh installer build to get the fixes.

## 🔖 BOOKMARK 2026-11-15 evening — QA plan in progress (resume here)
**Checklist (live, every item from the user's plan):** `docs/qa-checklist.md` — sync it with
`node tools/qa/sync-checklist.mjs` after every test batch (reads `docs/qa/results.jsonl`, latest result wins).
**Harness:** `tools/qa/` — `lib.mjs` (launches real Hive windows, drives them over CDP), `phase1..5.mjs`,
`phase9.mjs`, `soak.mjs`, `scale.stress.ts` (5/10/20 people, run via `npx vitest run --config vitest.stress.mts tools/qa/scale.stress.ts`),
`run-challenges.mjs` + `challenges.mjs` + `pagecheck.cjs` + `chat-probe.mjs` (Phases 6–8), `summarize.mjs`.
Test projects/profiles go to `%USERPROFILE%\dev-cache\hive\qa` (outside OneDrive); results/screens to `docs/qa/`.
**Environment notes:** node_modules lives in OneDrive and got corrupted once (a stray `rm -rf` + OneDrive locks);
reinstall with `npm install` (not `npm ci`). OneDrive + Explorer keep the CPU at 100% while syncing node_modules,
which slows convergence. Model for AI phases: `qwen2.5-coder:7b` (downloaded with the user's OK).
**Status:** Phase 1 done (18/19, 1 N/A). Phase 2 being re-run after fixes. Phases 3–11 scripts written, not run.
**Fixed so far:** terminal/run processes left running in old projects (locked folders); view-only links could edit
(relay now enforces an edit token; room cap 25); settings silently reset when the DB was briefly locked; raw
ENOENT errors; background windows throttled (sync lag); remote cursors never sent/drawn; Ctrl+Z after teammates'
edits did nothing (Y.UndoManager); rename while a teammate edits lost edits (rename with 10 s carry-over);
stale offline copy overwrote team work (3-way merge on rejoin); remote delete gave no notice; AI Accept
overwrote concurrent edits (applyProposal 3-way merge); late watcher echo of Hive's own write could overwrite
newer edits (remember recent write hashes).
**Not done / needs the user:** redeploy the Cloudflare relay (`cd services/relay-cf && npx wrangler deploy`) so
the live relay enforces view-only links and the 25-person cap; Phase 10 needs two real people.

## 2026-11-12 — IDE + redesign + models (latest work, done in the main session)
- **Watch/test/edit agent work:** agents announce each write (`agents:file`); "Follow along" opens files live;
  Explorer can show any agent's folder or the combined result (`explorerRoot`, `fs:treeAt`); "Try it" runs the
  combined result before merging (`run:start(dir)`, `AgentRun.previewDir`). Verified with a real llama3.2 run.
- **Redesign:** propolis/honey design system in `index.css` (Hanken Grotesk, Bricolage Grotesque, JetBrains Mono
  bundled via @fontsource), honeycomb agent cells in AgentsPanel, matching Monaco/xterm themes.
- **Models:** `library.ts` — Hugging Face GGUF search (pull as `hf.co/<repo>:<quant>`), live OpenRouter list,
  "Your own keys" (any OpenAI-compatible paid/self-hosted provider; keys in safeStorage). Catalog 26 → 96
  (`tools/expand-catalog.mjs`; sizes approximate — recheck before release). The free-only rule still holds for
  the catalog and Free online tab; paid models only come from keys the user adds themselves.
- **Design skills installed** to ~/.claude/skills: design-taste-frontend (includes redesign), high-end-visual-design,
  anti-ui-slop, ui-ux-pro-max. frontend-design + web-design-guidelines were already there.
- NOT verified: a paid key end to end (needs a real key), downloading a Hugging Face model, light theme pass,
  Mac. The installed copy on this PC must be reinstalled from the new installer to get these changes.
- The 3-AI Snake E2E is still paused (see bookmark below); button labels changed (People, AI team) and the
  driver in tools/e2e was updated to match.

## 🔖 BOOKMARK — paused 2026-11-10 23:18 (resume here)
**Task in progress:** user's test — "3 AI working at once to make Snake. Passes if each person talks and
asks for the snake game, the AI makes the planning doc/PRD/MVP, then a router tells each what to do."

**How to run it:** `tools/e2e/e2e-snake.mjs` (copy of the driver; needs `tools/e2e/cdp.mjs` style helpers inline).
1. `cd apps/desktop && npx electron-vite build`
2. Launch 3 instances (Sam 9351 / Kim 9352 / Ari 9353) with `HIVE_USER_DATA=<scratch>/profile-<name>`
   and `--remote-debugging-port=<port>`, empty folders `<scratch>/snake`, `<scratch>/kim`, `<scratch>/ari`.
3. `node tools/e2e/e2e-snake.mjs <scratch>` → log in `<scratch>/e2e-snake-log.txt`, screenshots `snake-*.png`.

**Status of pass criteria (last run, 23:15):**
- [x] 3 people join live over the Cloudflare relay ("Live · 3 online")
- [x] each person asks for Snake in the Planning room; host sees all 3
- [x] Planner writes PRD/MVP: goal + 4 features + 4 tasks, 9 items traced to chat messages
- [x] Send to agents → router assigns tasks → **3 workers active at once** (bee/wasp/ant) ✅
- [ ] NOT YET VERIFIED after the latest router change: all tasks merge, files sync to Kim+Ari,
      index.html loads every file it references, Kim presses Run and the game actually plays.
      (Previous run with sequential deps: merged + synced + ran, but page was blank because the 3B model
      wrote index.html referencing a game.js nobody wrote → fixed by split-by-file + missing-file check.)

**Next steps:** rerun the E2E to the end; if the page is blank, inspect the generated files — likely
llama3.2:3b quality (one-file-per-worker should help). Consider recommending qwen2.5-coder:7b (needs the
user's OK to download ~4.7 GB). Then report results to the user.

**Fixes made during this test (all committed, 53 unit tests pass):** Planner always writes goal+tasks (MVP pass);
3 workers by default; router (routeTasks, splitForParallelism, parallelizeWithContract); file ownership splits
shared files; tool-name aliases (create_file→write_file); refuse "done" with no writes; never merge empty work;
missing-file check before review; PLAN.md syncs to teammates; file tree refreshes after synced files land.


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
- Beta targets Windows AND macOS (user changed this 2026-11-05). Mac: login-shell PATH fix, silent
  Ollama.app install to ~/Applications, Apple Silicon unified-memory fit, process-group kills, ad-hoc
  signing (afterPack), arm64+x64 dmg/zip, manual update prompt (unsigned apps can't self-update).
  Mac builds come from CI (macos-latest) — NOT yet run or tested on a real Mac.
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
0. Push repo + tag so CI builds the Mac dmg; test on a real Mac (setup wizard, Run, terminal, agents).
1. GitHub = KassanaGujar/hive (placeholders filled; repo NOT created yet — ask before creating/pushing).
   Relay = Cloudflare Worker (services/relay-cf, tested locally with wrangler dev). Needs `wrangler login`
   + `wrangler deploy` by the user, then set DEFAULT_RELAY_URL to the wss://…workers.dev URL.
   Icon = tools/make-icon.mjs → apps/desktop/build/icon.png (honeycomb clipart).
2. Not yet click-tested: setup wizard steps 2–3 on a clean VM, code-only invite join through the dialog,
   AI chat accept/reject diff, git panel commit, viewer role, kick, free-online key paste.
3. Small-model quality: Planner misses decisions/questions with 3B; consider stronger default for Architect.
4. Playwright e2e tests (PRD testing plan) — not started.

## Stress test (2026-11-10) — see docs/stress-test.md
- Collab on live Cloudflare relay: 10 concurrent typists converge; p95 latency 65 ms; churn safe; 6 MB join 1.6 s.
- FIXED: concurrent agent git ops collided (6/8 tasks failed) → GitOps writes serialised.
- FIXED: search/hash now read files in parallel (5x faster). Install folder now %LOCALAPPDATA%\Programs\hive.
- Installer verified by real silent install + launch from desktop shortcut.

## Known gaps / ideas
- FIXED: Chromium's scrollIntoView now returns a Promise → never return it from useEffect.
- Viewer role is enforced by the relay for doc updates; editor UI is read-only for viewers.

## Log
- 2026-11-02: repo initialised; core packages; main process; renderer; app builds and runs; real agent run OK; collab + planning verified with 2 instances; installer builds.
