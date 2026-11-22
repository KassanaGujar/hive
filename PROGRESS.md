# Hive — build progress (resume file)

## 🔖 RESUME HERE (2026-11-21): plain-prompt results, model picker, play-test — merged into `main` (not pushed)
1. Plain prompts (8 people, casual follow-ups; Claude Code; score on the last message, after tester fixes):
   one agent (Automatic) 36/38 with 28 model calls; full team 24/38 with 165 calls. Team bugs were real and came
   from splitting files: tic-tac-toe Reset wired to `reset-btn` while the page has `reset-button`; Breakout starts
   at once and ends with alert() and no restart; Flappy cat with no pipes; drawing colour picker never changes the
   brush. Tester fixes along the way (re-scored on saved games): HTML5 drag (CDP), keep tapping while filming
   (flappy cat 2/5 → 4/5), alert/confirm pop-ups reported (team Breakout 0/5 → 4/5).
2. Model picker: Models → Subscriptions → Model. Claude Code: Automatic (default: Haiku for planning/no-tool calls,
   Sonnet for building and play-testing), Haiku, Sonnet, Opus, account default. Codex: free text. Settings.cliModel;
   HIVE_CLI_MODEL overrides. resolveCliModel() in packages/agents/src/cliAgents.ts.
3. Play-test before showing (default on; Settings.playTest; HIVE_PLAYTEST=0/1): apps/desktop/src/main/playtest.ts.
   After the smoke test passes, Claude Code plays the app offscreen and returns problems, which go to the integration
   fix round (then it plays again, up to MAX_INTEGRATION_ROUNDS). Only when Claude Code is in the team. On saved
   games: found the dead Reset button (68 s, 3 calls), no false alarm on the working one (98 s, 4 calls).
   End to end (full team + play-test + Automatic model): tic-tac-toe 4/4 → 6/6, Breakout 4/4 → 5/5 (team without
   it: 3/6 and 0/5). In Breakout it caught "starts the instant the page loads", "no restart" and "lives never go
   down", and the fix round repaired them.
4. Still open: hosted free models "fetch failed"; Hive hung ~2 min into a local Ollama run; /verify blocked.

## 🔖 RESUME HERE (2026-11-20): subscriptions, one-agent mode, Amoeba features — all on branch `subscription-agents`
1. Built (commits c4420e2..49c5b27, stacked on `qa-fixes` ← `right-sized-tasks`):
   - Claude Code / Codex CLIs as team models (Models → Subscriptions); Hive never sees the user's token.
   - From Amoeba: code map, resume after a crash, team-vs-solo benchmark (tools/qa/compare-coordination.mjs).
   - Run modes: `team` (plan, split, review), `single` (one agent + Hive checks + integration test, no AI review),
     `solo` (QA baseline only). Automatic = single when the strongest model is a subscription CLI. Switch: Models →
     Subscriptions → "How the work is split" (settings.coordination); env HIVE_COORDINATION overrides it for QA.
   - Single mode asks for `window.hiveSelfTest()` (requirement checks); the integration smoke test runs it.
2. QA, Claude Code (spec-style prompts): single mode 126/126 with the World self-test rerun (World was 7/10: noise
   never normalised; with hiveSelfTest 10/10). Full team 118/126 (World 9, Chess 13/15, Visual 8/10, Pathfinding
   8/11) with ~7x the model calls. Hosted free rerun: 4 of 5 "fetch failed" (no plan), World 0/10 not probed.
   Local 7B: Hive stopped answering the QA harness ~2 min into Snake (main.log ends there); never finished. Open bug.
   ⚠ These briefs are technical specs with test hooks, not how people talk. Real test: plain prompts (below).
5. Plain-prompt set: tools/qa/plain-challenges.mjs (8 everyday requests + casual follow-ups in the same project),
   tools/qa/run-plain.mjs, judged by tools/qa/tester.mjs (Claude Code plays via tools/qa/player.cjs: real keys and
   clicks, screenshots only, never the code). Results: docs/qa/plain-results.json. Try the tester on a built game:
   `node tools/qa/try-tester.mjs <id> <folder>`.
   Probe fixes (all re-scored on saved games with tools/qa/reprobe.mjs, originals kept in `originalFinal`):
   Invaders (moving target), Breakout (two rows hit), Voxel (hidden windows drew WebGL at ~2 fps; probe never
   let a frame draw). pagecheck.cjs now shows its window off screen with occlusion throttling off.
3. Run commands: `HIVE_CLI_AGENTS=claude-code HIVE_TEAM_MODELS=cli:claude-code QA_TAG=claude-code
   QA_COORDINATION=team|single|off node tools/qa/run-challenges-team.mjs <ids>`. Local: `HIVE_TEAM_MODELS=qwen2.5-coder:7b
   QA_TAG=sized-local …`. Hosted free: the command in the 2026-11-18 section below.
4. /verify (gstack) is blocked by the permission classifier in this environment: commits went in after
   `npm test`, typecheck and build passed.

## 🔖 (2026-11-18 02:00): P6–P8 on free keys done as far as quotas allow
1. Free keys live in the kept QA profile ~/dev-cache/hive/qa/profile-cloud (OpenRouter + Groq). Run:
   QA_PROFILE=cloud HIVE_TEAM_MODELS=groq-gpt-oss-120b,groq-gpt-oss-20b,groq-qwen3.8-27b,or-nemotron-3-ultra-free,or-north-mini-code-free,or-gemma-4-31b-free QA_TAG=free-hosted QA_EVAL_TIMEOUT=600000 node tools/qa/run-challenges-team.mjs <ids>
2. Results: Tic-Tac-Toe 8/8, Snake 9/10, Breakout 6/8, Kanban 5/11, Invaders 2/8. BLOCKED (free quotas exhausted):
   pathfinding world chat voxel physics chess visual. Model fallback works (logs "[agents] … using …" in main.log).
3. ⏭ Next: rerun the BLOCKED seven when quotas reset (~24 h), or with a paid key if the user chooses; P9 hosted rerun.
   Known open: task card shows the assigned model after a fallback. User still owes: wrangler deploy, Phase 10 users.

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
