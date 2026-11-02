# Hive — Product Requirements & MVP Plan (condensed copy)
Nov 2, 2026 · @Beanman

Hive is a free desktop coding app friends install with one click: a VS Code-style workspace where a
team of free AI models builds software together, ranked so the strongest model leads and smaller models
do the work. The MVP ships every feature below and ends with an installer a friend can download,
double-click and use within 10 minutes.

**Free-only principle.** Local models (default) via Ollama: Qwen Coder, DeepSeek, gpt-oss, Llama, Gemma,
Devstral. Optional free hosted: OpenRouter `:free`, Groq free tier, Hugging Face free inference — a free
key pasted once; paid models are filtered out and never shown.

**Success criteria.** (1) clean Win11 PC: download → AI-written running hello world in <10 min, no
terminal. (2) all features end to end. (3) two friends on different networks see each other's changes
within 2 s. (4) zero money spent.

**Non-goals:** paid models/billing, extension marketplace, mobile/web, public sign-up/accounts/teams >10,
code signing.

**Users:** Host (strong PC, runs agents, approvals), Builder friend (16 GB laptop, live edit), Ideas
friend (planning room, maybe hosted model).

**Journeys:** 1 install & first run (wizard installs git + Ollama, recommends model, New project / Join
code). 2 build with agents (goal → Architect plan → approve → workers in worktrees → Lead review →
approve merge → Run). 3 collaborate (invite code, live files/cursors/terminal output, change feed).
4 plan together (planning room chat → Planner AI updates plan doc traceably → Send to agents).

## F1 Installer, launch, setup wizard
NSIS per-user .exe (no admin), .dmg/.AppImage from same pipeline; shortcuts; open <3 s; first-run wizard
(hardware scan RAM/GPU/VRAM/disk, silent git + Ollama install, starter model recommendation, name +
avatar); auto-update from GitHub Releases; static download page with per-OS buttons + 3-step first-launch
guide incl. SmartScreen "Run anyway".
Acceptance: clean Win11 VM, download → open workspace, no terminal, <10 min incl. 4–5 GB model.

## F2 Free model store
Local tab (Ollama cards: name, size, RAM needed, fit label Runs well / Slow / Too big, Download with
progress/pause/cancel). Free online tab (OpenRouter :free, Groq, HF; Get free key link; key tested on
paste; only free endpoints). Installed tab (disk used, delete, tier). Catalog JSON fetched from GitHub on
launch with bundled fallback. Default tier per model (Top/Lead/Worker), user override.
Starter catalog: Qwen Coder 7/14/32B (+hosted), gpt-oss 20/120B, DeepSeek 7/14/32B, Devstral 24B,
Llama 3.x 3/8/70B, Gemma 3 4/12/27B, Phi-4 14B. RAM figures to be checked vs Ollama before release.
Acceptance: download w/ progress survives restart, appears in Installed, answers test prompt; key
validated <5 s; no paid model can be added.

## F3 Workspace
Activity bar, explorer, tabbed Monaco, bottom terminals, right panel (AI chat, Agents, Changes,
Planning). Explorer: create/rename/delete-to-recycle-bin/drag-move/live refresh. Editor: highlighting,
find/replace, search across files, split, diff, autosave. Terminal: PowerShell/zsh/bash, tabs, split,
clickable paths. Git panel: changes, stage, commit, branch switch, history. AI chat: ask selected model
about open file; proposes edits as accept/reject diff. Dark + light themes.
Acceptance: 2,000-file folder without lag; edit/save/commit; npm install with colour.

## F4 Run code
Run button + F5: detect package.json scripts (dev/start), Python main.py/app.py, static HTML (built-in
server + preview), Go, Rust, Java, C/C++. `hive.json` overrides command/env/port. Stop/Restart; preview
tab for localhost. Missing runtime → message + official download link.

## F5 Agent hierarchy with worktrees
Ranking by tier + catalog codingScore → Architect, Leads, Workers; drag to override. Flow: goal →
Architect plan (tasks, files, order, owner) → user approves → each task in own worktree + branch
`hive/agent-<name>/<task>` → Lead reviews diff (max 3 rounds) → Architect merges in dependency order →
user approves final merge. Tools: read file, write file, list files, search, run command (worktree only),
report done. Agents board: card per agent (model, role, task, status, live log, token speed, diff;
pause/stop/reassign/take over). Safety: deleting outside worktree, installing packages, network, push →
held for approval; 5-min timeout. Resource guard on RAM/VRAM. Single-model mode.
Orchestrator: task queue in SQLite; worker loop ≤40 steps; Lead review separate call; merge conflict →
new Architect task.

## F6 Collaboration and change feed
Invite: 6-char code + link, ≤10 people, remove, Editor/Viewer roles. Live editing (Yjs), coloured
cursors. Change feed of every event (file created/edited/renamed/deleted, commit, agent merge, run
started/failed, join/leave) with who/when/files/diff preview. Toasts, unread badge, desktop
notifications. Project chat with @mentions and file/line links. Offline edits sync later, marked "synced
late". Model files and keys never leave the machine. Invite codes random, expire 24 h; rooms E2E
encrypted with key in invite link. Feed event: {id, at, actor, actorType, kind, files, diffRef, summary}.

## F7 Planning room
Split: team chat left, plan doc right, both live. Plan doc sections: Goal, Features, Decisions, Open
questions, Tasks (owner, status), Who's doing what. Planner AI (Architect model) updates every few
messages or on "Update plan"; each AI edit tagged with source message(s), undoable; never overwrites a
human edit without proposing. Send to agents → F5 plan. Export PLAN.md.

## Architecture
Electron + TS, React/Tailwind/Zustand, Monaco, xterm.js + node-pty, chokidar, simple-git, Ollama
(localhost:11434, OpenAI-compatible), one OpenAI-compatible client for hosted, Yjs, relay server (Docker,
free host or home PC via Cloudflare Tunnel), SQLite, safeStorage, electron-builder + electron-updater.
Renderer talks to main only through a typed IPC bridge (contextIsolation, no Node in renderer).
Catalog entry: id, name, family, source (ollama|openrouter|groq|hf), pullName|endpointModel, sizeGB,
minRamGB, minVramGB, contextTokens, tier, codingScore, free: true (required), keyUrl.

## Open questions (user answers)
- Free hosted tier in v1.0? **yes** · Final name? **keep Hive for now** · Relay host? **compare
  options first** · Beta OS? **Windows only**

## Testing
Vitest units: catalog filter, ranking, scheduler, project detection, feed event builder. Integration:
orchestrator vs small local model; Yjs sync between two instances. Playwright e2e. Clean VMs.
