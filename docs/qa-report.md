# Hive — QA & Stress Test Report

_Generated 2026-11-19 03:28 from `docs/qa/results.jsonl` (latest result per test) and the phase logs. Test machine: Windows 11, i7-10750H (12 logical CPUs), 16 GB RAM, GTX 1660 Ti 6 GB (about half used by other apps), Ollama with qwen2.5-coder:7b (local). The CPU was often near 100% from OneDrive, Explorer and other Claude sessions, so timings are pessimistic._

## 1. Summary

Every item of the plan was either run against the real app (real Electron windows driven over the DevTools protocol, a real relay, real local AI) or marked blocked with a reason. Failures were root-caused; app bugs were fixed and the tests re-run. Remaining failures are listed with their causes.

| Phase | Passed | Failed | Blocked |
|---|---|---|---|
| Core functionality | 19 | 0 | 1 |
| Multiplayer collaboration | 27 | 0 | 0 |
| AI / vibe coding | 25 | 3 | 0 |
| Code execution | 21 | 4 | 0 |
| Performance & stress | 27 | 0 | 0 |
| Challenges: beginner | 49 | 115 | 10 |
| Challenges: intermediate | 22 | 75 | 32 |
| Challenges: advanced | 1 | 97 | 49 |
| Collaborative challenges | 4 | 11 | 0 |
| 30-minute challenge | 0 | 0 | 14 |

Counts are recorded test results; one test can cover several checklist lines (the disconnect/reconnect test covers four, for example). The item-by-item checklist, with every line of the plan, is `docs/qa-checklist.md`.

## 2. Passed tests

### Core functionality
- Create a new project; it appears in the project list
- Create multiple projects; files and settings stay independent
- Rename a project; the new name persists after refresh _(passed after a fix)_
- Delete a project; it is removed and its old path no longer opens _(passed after a fix)_ — old path → Couldn't find "gamma". It may have been moved, renamed or deleted.
- Create a file; it appears in the explorer
- Rename a file; contents are preserved
- Delete a file; it disappears
- Create nested folders
- Move a file between folders (content kept) — file moved; imports in other files are NOT rewritten (no refactoring support)
- Open multiple files and switch between them
- Edit code; changes are saved to disk
- Refresh the window; no saved work is lost and the project reopens
- Close and reopen the app; the project is restored _(passed after a fix)_ — reopened in 2131 ms
- Copy a project invitation link; it is valid _(passed after a fix)_ — link ok (People panel shows it after pressing Share)
- Open the project link in another session _(passed after a fix)_ — friend received the project files
- Unauthorized users cannot read a private project _(passed after a fix)_ — wrong key → no files; wrong room id → no files
- Project permissions and ownership (viewer cannot change files; host can) _(passed after a fix)_ — view-only link has no edit token; relay made Vera a viewer even though her app claimed "editor"; her edit never reached the host; host keeps ownership
- Errors are communicated clearly to users _(passed after a fix)_ — Couldn't find "does/not/exist.txt". It may have been moved, renamed or deleted. \|\| "../../outside.txt" is outside the project \|\| A folder named "alpha" already exists there. \|\| toast: 
- No uncaught errors in the app during Phase 1

### Multiplayer collaboration
- Invite one collaborator using a project link _(passed after a fix)_
- Invite multiple collaborators (second joins while the first is active)
- All collaborators see the same project files _(passed after a fix)_ — 4 files identical on all three (on disk after 754 ms)
- Two people edit different files simultaneously
- Two people edit the same file simultaneously _(passed after a fix)_
- Two people edit the exact same line simultaneously _(passed after a fix)_
- Two people type at the exact same cursor position _(passed after a fix)_ — result: [AAAAABBBBBBBBBBBBBBBAAAAAAAAAAAAAAABBBBB]
- One person deletes code while another edits that code _(passed after a fix)_ — converged; the concurrent insert survived the delete
- One person renames a file while another edits it _(passed after a fix)_
- One person creates a file while another browses the explorer _(passed after a fix)_
- One person deletes a file while another has it open _(passed after a fix)_ — tab closed
- Simultaneous changes do not silently disappear (300 marked edits from 3 people) _(passed after a fix)_ — 300/300 edits present on all three
- Changes synchronize across all connected clients — every test above compares the shared doc and the disk copy on all three machines
- Collaborators can see each other's cursors _(passed after a fix)_ — remote selection rendered with the name label
- Presence indicators update correctly
- Users can tell their own changes from other people's — history shows who changed what, with a diff
- Undo/redo while several people edit: undo only removes your own change _(passed after a fix)_
- Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs _(passed after a fix)_
- Refresh one collaborator's window while everyone works; it restores _(passed after a fix)_
- A collaborator leaves; the others keep working; they rejoin with the original link
- A stale copy cannot overwrite the project (edited outside Hive while closed) _(passed after a fix)_ — both edits merged: "TEAM-EDIT L1 base\nL2 base\nL3 base EDITED-OUTSIDE\n"
- Project state survives a relay (server) restart _(passed after a fix)_
- Concurrent operations are handled consistently — same-file, same-line, same-position, delete-vs-edit and offline merges all converged to identical text on every client
- No uncaught errors in any window during Phase 2
- Synchronization with five people editing simultaneously _(passed after a fix)_ — 300/300 edits on all 5; latency p50 100 ms, p95 563 ms
- Synchronization with ten people editing simultaneously _(passed after a fix)_ — 10 online, 400/400 edits converged; latency p50 232 ms, p95 534 ms
- Synchronization with twenty people joining simultaneously _(passed after a fix)_ — 20/20 got in (refused: none); join 603 ms; 400/400 edits converged; p95 1756 ms

### AI / vibe coding
- AI creates a simple program from a natural-language prompt _(passed after a fix)_ — 36 s
- AI creates a multi-file project _(passed after a fix)_ — lib/shapes.js, app.js
- AI modifies an existing function
- AI adds a feature without changing unrelated functionality
- AI identifies and fixes a syntax error
- AI identifies and fixes a logical error
- AI explains an unfamiliar codebase _(passed after a fix)_ — note: Ask AI only sees the open file; here both files were supplied as context. "This codebase is a simple shopping cart system. It consists of two main files: `shop/cart.js` and `shop/catalog.js`. ##
- AI explains a specific function
- Ambiguous prompt: AI handles uncertainty appropriately — "Could you please specify which file or part of the code you would like me to improve?…"
- AI optimizes a slow algorithm — fib(35): 2461 ms → 0 ms
- AI fixes failing unit tests (by fixing the code)
- AI implements a feature across multiple files _(passed after a fix)_
- Users can inspect AI-generated changes before accepting them — side-by-side diff with Accept / Reject; Reject leaves the file alone
- AI does not silently remove unrelated functionality
- Requesting broken code: the app reports execution errors _(passed after a fix)_ — Exited with code 1. See the Run terminal for details.
- AI references nonexistent files or dependencies _(passed after a fix)_ — Run fails with Node's "Cannot find module" in the terminal + "Exited with code 1. See the Run terminal for details.". Hive does not warn about missing packages before running.
- The AI provider returns an error — shown to the user as: Model request failed (500): {"error":{"message":"upstream exploded"}}
- An AI request times out _(passed after a fix)_ — error after 127 s: The model didn't start answering within 125 seconds. It may be overloaded or unreachable. Try again, or pick another model.
- Users can recover from unsuccessful AI modifications (undo the accepted change) — Ctrl+Z in the editor restores the pre-AI version (and the History panel keeps the diff)
- AI modifies code that another collaborator is currently editing _(passed after a fix)_
- Two collaborators send AI requests simultaneously; they do not overwrite each other
- AI-generated changes are synchronized with all collaborators
- Repeated AI requests (5 in a row) all answer — times: 4.4 s, 14.7 s, 12.5 s, 3.0 s, 0.7 s
- AI response time (measured) — 28 requests on qwen2.5-coder-7b: median 14.7 s, max 126.8 s (full Phase 3 run with the 16k-context native API, night-time load)
- No uncaught errors in the app during Phase 3 _(passed after a fix)_

### Code execution
- Run a basic Hello World program
- Run a program that accepts user input
- Run a program that produces continuous output _(passed after a fix)_ — 32 lines streamed in 2.5 s
- Run a program with multiple files
- Run a program with external dependencies (npm install runs first) — command: npm install && node index.js; status exited
- Missing dependency: the error is understandable — Node error shown + Hive status message: Exited with code 1. See the Run terminal for details.
- Run a program with syntax errors
- Run a program with runtime errors
- Run a program that intentionally throws an exception
- Run a program that uses significant memory — 1 GB allocated, status exited, Hive UI responsive (complete). No memory limit is enforced.
- Run a program that uses significant CPU — UI stayed responsive (worst 31 ms)
- Run an infinite loop
- An infinite loop can be terminated
- Stopping execution actually releases its resources — node process exited
- Run multiple programs simultaneously — Run + a second terminal ran together; note the Run button itself runs one program at a time per window
- One user's execution doesn't interfere with another user's — Each person runs code on their own computer (Hive has no shared execution server); verified separately in Phase 9 runs by two instances.
- Modify code while a previous version is running; running program keeps a consistent version _(passed after a fix)_ — old run kept v1; Restart picked up v2
- Execution output is displayed correctly — output captured from the Run terminal stream in every test above (stdout, stderr, interactive input)
- Errors include useful file names and line numbers — file and line (t.js:4) present
- Execution doesn't expose other users' project files — nothing to expose: each person runs locally, teammates only receive the shared project files
- No uncaught errors in the app during Phase 4

### Performance & stress
- Open a project with 100 files — open 1075 ms, search 1981 ms (100 hits), full-tree hash 111 ms
- Open a project with 500 files — open 421 ms, search 4436 ms (500 hits), full-tree hash 400 ms
- Open a project with 1000 files — open 342 ms, search 13712 ms (1000 hits), full-tree hash 600 ms
- Open a source file with 1,000 lines — open 320 ms; keystroke→frame p50 12.3 ms, p95 31.6 ms, max 161.9 ms
- Open a source file with 10,000 lines — open 544 ms; keystroke→frame p50 11.1 ms, p95 18 ms, max 76.2 ms
- Open a very large source file (100,000 lines, 4.5 MB) and measure editor responsiveness _(passed after a fix)_ — keystroke→frame p50 7 ms, p95 34–44 ms, max 55–153 ms over 3 rounds (was p95 54–76 ms, spikes to 1.2 s). Files over 2 MB open as plain text, like VS Code large-file mode.
- Rapid typing and deletion — 3,000 keystrokes + 2,000 deletes in 4202 ms; text intact
- Rapid switching between files _(passed after a fix)_ — 200 tab switches: 29–31 ms each over 3 rounds (was 43–55 ms). One editor per pane now swaps documents and keeps each file's place.
- Rapid project navigation — 15 project switches in 11234 ms
- A project with 50 dependencies — open 843 ms; node_modules (550 files) skipped by search (1 hits) and sharing (2 files hashed)
- A project with hundreds of dependencies — open 239 ms; node_modules (4400 files) skipped by search (1 hits) and sharing (2 files hashed)
- A project with deeply nested directories (60 levels) — open 938 ms; path length 509 chars works
- Repeated project creation and deletion (20 cycles) — 106080 ms; renderer heap +1.6 MB
- Measure project loading time — 100 files 1075 ms · 500 files 421 ms · 1,000 files 342 ms
- Measure editor responsiveness — keystroke→frame p95: 1k lines 31.6 ms, 10k lines 18 ms, 100k lines 76.1 ms
- Monitor memory consumption — all Hive processes 936 MB RSS (4 processes); renderer JS heap 29.3 MB
- Monitor CPU consumption (idle 20 s) — idle: 1.0% of one core
- Identify unnecessary network requests (60 s idle, solo project) — 0 renderer requests in 60 s idle: {}
- Identify redundant storage operations (writes while typing) — 1 disk writes for 100 keystrokes over 10 s (autosave debounced at 0.9 s)
- Redundant storage operations in a shared project (state file rewrites) — 1 full rewrites of a 936 KB state file during 10 s of typing (debounced 1.5 s; each rewrite re-encodes the whole project)
- No uncaught errors during Phase 5
- Multiple collaborators continuously editing for 30 minutes — 18997 edits; files identical everywhere: {"a.js":true,"b.js":true,"shared.js":true}; sync latency median 132 ms; renderer heap 39.4→93.3 MB (A), 57.3→63.3 MB (B); app RSS 1015/955 MB; relay 100 MB, 61
- Multiple collaborators continuously editing for one hour — 18353 edits; files identical everywhere: {"a.js":true,"b.js":true,"shared.js":true}; sync latency median 226 ms; renderer heap 39.4→69.8 MB (A), 57.3→80 MB (B); app RSS 952/875 MB; relay 69 MB, 159.1 
- Measure synchronization latency — 65 samples over 60 min on the local relay: p50 180 ms, p95 455 ms (Cloudflare relay measured separately)
- Monitor server resource consumption — relay process 57→69 MB RSS, 158.2 CPU-s over 60 min
- Identify memory leaks — renderer heap from min 5 to min 60: A 39.4→69.8 MB, B 57.3→80 MB; RSS A 883→952 MB
- Performance stays acceptable during concurrent use — 20 people joined at once and converged (p95 1.8 s); 2 people typing non-stop for an hour: every check identical, median sync latency 80-130 ms in the first 30 min rising to ~220 ms by 60 min (was 616 

### Challenges: beginner
- 1. Snake Game — Create a playable Snake game _(passed after a fix)_ — re-checked with the fixed probe (restart before measuring movement)
- 1. Snake Game — Directional movement _(passed after a fix)_ — re-checked with the fixed probe (restart before measuring movement)
- 1. Snake Game — Food generation _(passed after a fix)_ — re-checked with the fixed probe (restart before measuring movement)
- 1. Snake Game — Wall collision _(passed after a fix)_ — re-checked with the fixed probe (restart before measuring movement)
- 1. Snake Game — The game runs without errors _(passed after a fix)_ — no console errors (fixed probe)
- 2. Tic-Tac-Toe — A functional game board _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — Two-player gameplay _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — Turn management _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — Detects winning combinations _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — Detects draws _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — A scoreboard _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — Restart functionality _(passed after a fix)_ — after 1 round(s)
- 2. Tic-Tac-Toe — Illegal moves are prevented _(passed after a fix)_ — after 1 round(s)
- 3. Space Invaders — Enemy formations — after 3 round(s)
- 4. Breakout — The game behaves consistently — after 3 round(s)
- 1. Snake Game (AI team qwen2.5-coder-7b-solo) — The game runs without errors — AI team (architect Qwen2.5 Coder 7B, leads Qwen2.5 Coder 7B, workers Qwen2.5 Coder 7B)
- 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — A functional game board — AI team (architect Qwen2.5 Coder 7B, leads Qwen2.5 Coder 7B, workers Qwen2.5 Coder 7B)
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — A functional game board — checked by clicking, like a player
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — Two-player gameplay — checked by clicking, like a player
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — Turn management — checked by clicking, like a player
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — Detects winning combinations — checked by clicking, like a player
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — Detects draws — checked by clicking, like a player
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — Restart functionality — checked by clicking, like a player
- 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — Illegal moves are prevented — checked by clicking, like a player
- 2. Tic-Tac-Toe (AI team openrouter-free) — A functional game board — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — Two-player gameplay — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — Turn management — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — Detects winning combinations — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — Detects draws — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — A scoreboard — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — Restart functionality — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 2. Tic-Tac-Toe (AI team openrouter-free) — Illegal moves are prevented — AI team (architect Nemotron 3 Ultra 550B (OpenRouter free), leads Nemotron 3 Ultra 550B (OpenRouter free), workers North Mini Code 30B (OpenRouter free))
- 1. Snake Game (AI team groq-free) — Create a playable Snake game _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Directional movement _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Food generation _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Snake growth _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Wall collision _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Self-collision _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Score tracking _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — Restart functionality _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 1. Snake Game (AI team groq-free) — The game runs without errors _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads gpt-oss 20B (Groq free tier), workers gpt-oss 20B (Groq free tier))
- 3. Space Invaders (AI team free-hosted) — Player movement _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 3. Space Invaders (AI team free-hosted) — Enemy formations _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 4. Breakout (AI team free-hosted) — Paddle movement _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 4. Breakout (AI team free-hosted) — Ball physics _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 4. Breakout (AI team free-hosted) — Wall collisions _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 4. Breakout (AI team free-hosted) — Paddle collisions _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 4. Breakout (AI team free-hosted) — Win and loss conditions _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 4. Breakout (AI team free-hosted) — The game behaves consistently _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M

### Challenges: intermediate
- 5. Kanban Task Manager — Task deletion _(passed after a fix)_ — after 3 round(s)
- 5. Kanban Task Manager — Multiple task columns — after 3 round(s)
- 5. Kanban Task Manager — Persistent storage — after 3 round(s)
- 5. Kanban Task Manager — Multiple users see the same task updates — after 3 round(s)
- 5. Kanban Task Manager — Refreshing doesn't lose tasks — after 3 round(s)
- 6. Pathfinding Visualizer — An interactive grid _(passed after a fix)_ — after 3 round(s)
- 6. Pathfinding Visualizer — Users can place walls and obstacles _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — A random terrain map _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Perlin or Simplex noise _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Mountains _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Lakes and rivers _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Forests _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — World seeds _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Identical seeds produce identical worlds _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Users can regenerate worlds _(passed after a fix)_ — after 3 round(s)
- 7. Procedural World Generator — Terrain generation performs efficiently _(passed after a fix)_ — after 3 round(s)
- 8. Real-Time Chat Application — A chat interface — after 3 round(s)
- 5. Kanban Task Manager (AI team free-hosted) — Task deletion _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 5. Kanban Task Manager (AI team free-hosted) — Multiple task columns _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 5. Kanban Task Manager (AI team free-hosted) — Persistent storage _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 5. Kanban Task Manager (AI team free-hosted) — Multiple users see the same task updates _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M
- 5. Kanban Task Manager (AI team free-hosted) — Refreshing doesn't lose tasks _(passed after a fix)_ — AI team (architect gpt-oss 120B (Groq free tier), leads Nemotron 3 Ultra 550B (OpenRouter free)/Gemma 4 31B (OpenRouter free)/gpt-oss 20B (Groq free tier)/Qwen3.8 27B (Groq free tier), workers North M

### Challenges: advanced
- 10. Physics Simulator — An interactive physics simulation — after 3 round(s)

### Collaborative challenges
- Collaborators ask AI to modify separate parts of the same project
- Collaborators can understand each other's changes _(passed after a fix)_ — History shows: edited game.js game.js
- Code integration doesn't silently overwrite existing functionality
- Collaborators can recover from conflicting changes — Omar undid his overwrite and the restored file reached Tess

## 3. Failed tests

- **[AI / vibe coding] Contradictory instructions: AI identifies the contradiction** — no contradiction flagged: ```sum.js function sum(a, b) {   return (a + b).toString(); } ```
- **[AI / vibe coding] AI refactors poorly structured code (same behaviour)** — behaviour changed: X;z → [eval]:1 const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))                                          ^  TypeError: p is not a function     at [eval]:1:42     at runScriptInThisContext (node:internal/vm:219:10)    
- **[AI / vibe coding] AI writes unit tests (and they catch a planted bug)** — tests fail on correct code: er/test:1402:25)       at Test.processPendingSubtests (node:internal/test_runner/test:974:18)       at Test.postRun (node:internal/test_runner/test:1542:19)       at Test.run (node:internal/test_runner/test:1467:12)       at async startSubtestAfterBootstrap (node:internal
- **[Code execution] Attempts to access unauthorized filesystem locations** — a program you run can read any file your account can (C:/Users/User/hive-qa-secret-1794896116262.txt). Hive's own file API: refused: "../../../../hive-qa-secret.txt" is outside the project
- **[Code execution] Attempts to access unauthorized network resources** — programs have full network access (no network policy for Run)
- **[Code execution] Attempts to escape the execution sandbox** — no sandbox: programs can start other processes as the user (WHOAMI:User)
- **[Code execution] Resource limits and execution timeouts** — Run has no time or memory limit (by design for dev servers); only AI-agent commands have a timeout + allow/approve/block policy
- **[Challenges: beginner] 1. Snake Game — Snake growth** — length 1→1 (re-checked with the fixed probe)
- **[Challenges: beginner] 1. Snake Game — Self-collision** — length 1 looped into itself without game over (re-checked with the fixed probe)
- **[Challenges: beginner] 1. Snake Game — Score tracking** — score 0→0 (re-checked with the fixed probe)
- **[Challenges: beginner] 1. Snake Game — Game-over functionality** — over=true moved after over=false message=false (re-checked with the fixed probe)
- **[Challenges: beginner] 1. Snake Game — Restart functionality** — {"over":false,"score":0,"len":1} (re-checked with the fixed probe)
- **[Challenges: beginner] 3. Space Invaders — Player movement** — x 220→220
- **[Challenges: beginner] 3. Space Invaders — Projectile shooting** — no bullet or bullet does not move up
- **[Challenges: beginner] 3. Space Invaders — Projectile collisions** — enemy count 32→32
- **[Challenges: beginner] 3. Space Invaders — Player-enemy collisions** — lives 3→3
- **[Challenges: beginner] 3. Space Invaders — Scoring** — score 0→0
- **[Challenges: beginner] 3. Space Invaders — Increasing difficulty** — level 1→1, speed 1→1
- **[Challenges: beginner] 3. Space Invaders — Game-over and restart states** — over=false after reset over=false
- **[Challenges: beginner] 4. Breakout — Paddle movement** — paddle did not move
- **[Challenges: beginner] 4. Breakout — Ball physics** — ball at 200,400
- **[Challenges: beginner] 4. Breakout — Wall collisions** — left bounce=false top bounce=false
- **[Challenges: beginner] 4. Breakout — Paddle collisions** — ball vy after paddle 4
- **[Challenges: beginner] 4. Breakout — Brick destruction** — brick alive=true
- **[Challenges: beginner] 4. Breakout — Lives and scoring** — score 0→0, lives 3→3
- **[Challenges: beginner] 4. Breakout — Win and loss conditions** — won=false over=false
- **[Challenges: intermediate] 5. Kanban Task Manager — A task management application** — see creation/columns
- **[Challenges: intermediate] 5. Kanban Task Manager — Task creation** — task not created or not shown
- **[Challenges: intermediate] 5. Kanban Task Manager — Task editing** — edit not applied
- **[Challenges: intermediate] 5. Kanban Task Manager — Draggable task cards** — card element not found
- **[Challenges: intermediate] 5. Kanban Task Manager — Task assignments** — assign not applied
- **[Challenges: intermediate] 5. Kanban Task Manager — Real-time collaboration** — second window did not update live
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Users can select a start point and destination** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — A* pathfinding** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Dijkstra's algorithm** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Breadth-First Search** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Animated search process** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Displays the resulting path** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Compares the algorithms' performance** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Handles unreachable destinations** — not checked
- **[Challenges: intermediate] 6. Pathfinding Visualizer — Each algorithm returns correct results** — not checked
- **[Challenges: intermediate] 7. Procedural World Generator — A controllable character** — moved=false blocked by water=not tested
- **[Challenges: intermediate] 8. Real-Time Chat Application — Multiple users** — online list []
- **[Challenges: intermediate] 8. Real-Time Chat Application — Sending and receiving messages** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Persistent message history** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Timestamps** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Online indicators** — no presence event listing Ana
- **[Challenges: intermediate] 8. Real-Time Chat Application — Typing indicators** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Private chat rooms** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Handles simultaneous messages** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Handles disconnected users** — not checked
- **[Challenges: intermediate] 8. Real-Time Chat Application — Messages aren't lost or duplicated** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — A 3D environment** — window.engine missing (Three.js may have failed to load)
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — A voxel-based world** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Block rendering** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Procedural terrain generation** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Chunk generation** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Chunk loading and unloading** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Player movement** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Collision detection** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Block placement** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Block destruction** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — World persistence** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Optimized rendering and chunk management** — not checked
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine — Stays playable as the world grows** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Gravity** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Elastic collisions** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Friction** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Particle systems** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Users can create objects** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Users can modify simulation parameters** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Interactions between hundreds of objects** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Conservation of momentum in appropriate collisions** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Numerical stability** — not checked
- **[Challenges: advanced] 10. Physics Simulator — Measured simulation performance** — not checked
- **[Challenges: advanced] 11. Chess Engine — A functional chessboard** — 0 squares, pieces shown=false
- **[Challenges: advanced] 11. Chess Engine — Legal move generation** — not checked
- **[Challenges: advanced] 11. Chess Engine — Piece movement** — not checked
- **[Challenges: advanced] 11. Chess Engine — Check detection** — not checked
- **[Challenges: advanced] 11. Chess Engine — Checkmate detection** — not checked
- **[Challenges: advanced] 11. Chess Engine — Stalemate detection** — not checked
- **[Challenges: advanced] 11. Chess Engine — Castling** — not checked
- **[Challenges: advanced] 11. Chess Engine — En passant** — not checked
- **[Challenges: advanced] 11. Chess Engine — Pawn promotion** — not checked
- **[Challenges: advanced] 11. Chess Engine — Board evaluation** — not checked
- **[Challenges: advanced] 11. Chess Engine — Minimax** — not checked
- **[Challenges: advanced] 11. Chess Engine — Alpha-beta pruning** — not checked
- **[Challenges: advanced] 11. Chess Engine — A playable computer opponent** — not checked
- **[Challenges: advanced] 11. Chess Engine — Tested against known chess positions** — not checked
- **[Challenges: advanced] 11. Chess Engine — Illegal moves are never accepted** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Draggable programming nodes** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Node connections** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Input and output ports** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — A node execution system** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Dependency resolution** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Detects circular dependencies** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Error handling** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Graph visualization** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — Saving and loading** — not checked
- **[Challenges: advanced] 12. Visual Programming Environment — A working example program built with the node system** — not checked
- **[Collaborative challenges] Snake: one person on game mechanics, another on rendering and UI** — Tess wrote logic.js; Omar wrote index.html, ui.js; 3 round(s); features working: 0/10 on Tess's machine, 0/10 on Omar's; failing: Create a playable Snake game; Directional movement; Food generation; Snake growth
- **[Collaborative challenges] Chess: one person on move validation, another on the AI opponent** — Tess wrote rules.js; Omar wrote index.html, engine.js, ui.js; 3 round(s); features working: 0/15 on Tess's machine, 0/15 on Omar's; failing: A functional chessboard; Legal move generation; Piece movement; Check detection
- **[Collaborative challenges] Minecraft clone: one person on terrain generation, another on player mechanics** — Tess wrote nothing; Omar wrote index.html, player.js; 3 round(s); features working: 0/13 on Tess's machine, 0/13 on Omar's; failing: A 3D environment; A voxel-based world; Block rendering; Procedural terrain generation
- **[Collaborative challenges] Chat application: one person on the backend, another on the frontend** — Tess wrote server.js, hive.json; Omar wrote public/index.html, public/client.js; 3 round(s); features working: 1/11 on Tess's machine, 1/11 on Omar's; failing: Multiple users; Sending and receiving messages; Persistent message history; Timestamps
- **[Collaborative challenges] Physics simulator: one person on the physics engine, another on visualization** — Tess wrote engine.js; Omar wrote index.html, view.js; 3 round(s); features working: 1/11 on Tess's machine, 1/11 on Omar's; failing: Gravity; Elastic collisions; Friction; Particle systems
- **[Collaborative challenges] Pathfinding visualizer: one person on algorithms, another on the interface** — Tess wrote algorithms.js; Omar wrote index.html, ui.js, style.css; 3 round(s); features working: 1/11 on Tess's machine, 1/11 on Omar's; failing: An interactive grid; Users can place walls and obstacles; A* pathfinding; Dijkstra's algorithm
- **[Collaborative challenges] Collaborators independently modify the same feature** — only one change survived: [{"x":5,"y":0},{"x":104,"y":0}]
- **[Collaborative challenges] Collaborators integrate code written in separate files** — no pair challenge integrated into a fully working app
- **[Collaborative challenges] Collaborators debug each other's code** — player at 2,1
- **[Collaborative challenges] Collaborators review AI-generated code** — Omar's AI change is not in Tess's History panel
- **[Collaborative challenges] All collaborators can run the completed project** — no pair project ran fully on both machines: {"snake":"0/0 of 10","chess":"0/0 of 15","voxel":"0/0 of 13","chat":"1/1 of 11","physics":"1/1 of 11","pathfinding":"1/1 of 11"}
- **[Challenges: beginner] 1. Snake Game (AI team) — Create a playable Snake game** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Directional movement** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Food generation** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Snake growth** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Wall collision** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Self-collision** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Score tracking** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Game-over functionality** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — Restart functionality** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team) — The game runs without errors** — team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — A functional game board** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — Two-player gameplay** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — Turn management** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — Detects winning combinations** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — Detects draws** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — A scoreboard** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — Restart functionality** — team run failed: team did not finish: working 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team) — Illegal moves are prevented** — team run failed: team did not finish: working 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Create a playable Snake game** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Directional movement** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Food generation** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Snake growth** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Wall collision** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Self-collision** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Score tracking** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Game-over functionality** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — Restart functionality** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen3.5-4b) — The game runs without errors** — no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — A functional game board** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — Two-player gameplay** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — Turn management** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — Detects winning combinations** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — Detects draws** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — A scoreboard** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — Restart functionality** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3.5-4b) — Illegal moves are prevented** — team run failed: no plan: failed Model request failed (500): {"error":"timed out waiting for llama-server to start - "}
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Create a playable Snake game** — no canvas or snake does not move on its own
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Directional movement** — down then ArrowLeft: [{"x":100,"y":100},{"x":100,"y":100},{"x":100,"y":100}]
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Food generation** — food {"x":200,"y":200}
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Snake growth** — length 3→3
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Wall collision** — never hit the wall in 40 steps
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Self-collision** — length 3 looped into itself without game over
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Score tracking** — score undefined→undefined
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Game-over functionality** — over=undefined moved after over=false message=false
- **[Challenges: beginner] 1. Snake Game (AI team qwen2.5-coder-7b-solo) — Restart functionality** — {"len":3}
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — Two-player gameplay** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — Turn management** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — Detects winning combinations** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — Detects draws** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — A scoreboard** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — Restart functionality** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen2.5-coder-7b-solo) — Illegal moves are prevented** — not checked
- **[Challenges: beginner] 2. Tic-Tac-Toe (qwen2.5-coder-7b-solo, click-through) — A scoreboard** — scoreboard "X: 0 \| O: 0" → "X: 0 \| O: 0"
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Create a playable Snake game** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Directional movement** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Food generation** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Snake growth** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Wall collision** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Self-collision** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Score tracking** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Game-over functionality** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — Restart functionality** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team qwen3-4b-solo) — The game runs without errors** — no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — A functional game board** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — Two-player gameplay** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — Turn management** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — Detects winning combinations** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — Detects draws** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — A scoreboard** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — Restart functionality** — team run failed: no plan: planning 
- **[Challenges: beginner] 2. Tic-Tac-Toe (AI team qwen3-4b-solo) — Illegal moves are prevented** — team run failed: no plan: planning 
- **[Challenges: beginner] 1. Snake Game (AI team groq-free) — Game-over functionality** — over=true moved after over=false message=false
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Player movement** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Projectile shooting** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Enemy formations** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Projectile collisions** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Player-enemy collisions** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Scoring** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Increasing difficulty** — not checked
- **[Challenges: beginner] 3. Space Invaders (AI team groq-free) — Game-over and restart states** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Paddle movement** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Ball physics** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Wall collisions** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Paddle collisions** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Brick destruction** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Lives and scoring** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — Win and loss conditions** — not checked
- **[Challenges: beginner] 4. Breakout (AI team groq-free) — The game behaves consistently** — not checked
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — A task management application** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Task creation** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Task deletion** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Task editing** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Draggable task cards** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Multiple task columns** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Task assignments** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Persistent storage** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Real-time collaboration** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Multiple users see the same task updates** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team groq-free) — Refreshing doesn't lose tasks** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — An interactive grid** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Users can place walls and obstacles** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Users can select a start point and destination** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — A* pathfinding** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Dijkstra's algorithm** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Breadth-First Search** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Animated search process** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Displays the resulting path** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Compares the algorithms' performance** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Handles unreachable destinations** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 6. Pathfinding Visualizer (AI team groq-free) — Each algorithm returns correct results** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — A random terrain map** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Perlin or Simplex noise** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Mountains** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Lakes and rivers** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Forests** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — World seeds** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Identical seeds produce identical worlds** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Users can regenerate worlds** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — A controllable character** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 7. Procedural World Generator (AI team groq-free) — Terrain generation performs efficiently** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — A chat interface** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Multiple users** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Sending and receiving messages** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Persistent message history** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Timestamps** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Online indicators** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Typing indicators** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Private chat rooms** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Handles simultaneous messages** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Handles disconnected users** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: intermediate] 8. Real-Time Chat Application (AI team groq-free) — Messages aren't lost or duplicated** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — A 3D environment** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — A voxel-based world** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Block rendering** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Procedural terrain generation** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Chunk generation** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Chunk loading and unloading** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Player movement** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Collision detection** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Block placement** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Block destruction** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — World persistence** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Optimized rendering and chunk management** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 9. Minecraft-Style Voxel Engine (AI team groq-free) — Stays playable as the world grows** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — An interactive physics simulation** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Gravity** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Elastic collisions** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Friction** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Particle systems** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Users can create objects** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Users can modify simulation parameters** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Interactions between hundreds of objects** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Conservation of momentum in appropriate collisions** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Numerical stability** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 10. Physics Simulator (AI team groq-free) — Measured simulation performance** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — A functional chessboard** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Legal move generation** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Piece movement** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Check detection** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Checkmate detection** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Stalemate detection** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Castling** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — En passant** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Pawn promotion** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Board evaluation** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Minimax** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Alpha-beta pruning** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — A playable computer opponent** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Tested against known chess positions** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 11. Chess Engine (AI team groq-free) — Illegal moves are never accepted** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Draggable programming nodes** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Node connections** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Input and output ports** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — A node execution system** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Dependency resolution** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Detects circular dependencies** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Error handling** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Graph visualization** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — Saving and loading** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: advanced] 12. Visual Programming Environment (AI team groq-free) — A working example program built with the node system** — team run failed: team did not finish: failed No task finished successfully.
- **[Challenges: beginner] 3. Space Invaders (AI team free-hosted) — Projectile shooting** — no bullet or bullet does not move up
- **[Challenges: beginner] 3. Space Invaders (AI team free-hosted) — Projectile collisions** — enemy count 32→32
- **[Challenges: beginner] 3. Space Invaders (AI team free-hosted) — Player-enemy collisions** — lives undefined→undefined
- **[Challenges: beginner] 3. Space Invaders (AI team free-hosted) — Scoring** — score 0→0
- **[Challenges: beginner] 3. Space Invaders (AI team free-hosted) — Increasing difficulty** — level 1→1, speed 1→1
- **[Challenges: beginner] 3. Space Invaders (AI team free-hosted) — Game-over and restart states** — over=undefined after reset over=undefined
- **[Challenges: beginner] 4. Breakout (AI team free-hosted) — Brick destruction** — brick alive=false
- **[Challenges: beginner] 4. Breakout (AI team free-hosted) — Lives and scoring** — score 0→20, lives 3→2
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team free-hosted) — A task management application** — see creation/columns
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team free-hosted) — Task creation** — task not created or not shown
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team free-hosted) — Task editing** — edit not applied
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team free-hosted) — Draggable task cards** — card element not found
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team free-hosted) — Task assignments** — assign not applied
- **[Challenges: intermediate] 5. Kanban Task Manager (AI team free-hosted) — Real-time collaboration** — second window did not update live

## 4. Blocked tests and why

- **Browser navigation (back / forward)** — Not applicable: Hive is a desktop app with tabs, not URL pages. There is no back/forward history to test.
- **Both users successfully join the same project** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Both users understand how to start coding** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Both users can use AI assistance** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Both users can edit code simultaneously** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Both users can see each other's changes** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Both users can divide work effectively** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Both users can integrate their work** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **The app successfully runs the finished game** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **No significant code is lost** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Record the total time required** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Record the number of collaboration conflicts** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Record the number of AI-generated bugs** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Record time spent coding vs coordinating** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **Collect feedback about the experience** — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- **1. Snake Game (AI team openrouter-free) — Create a playable Snake game** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Directional movement** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Food generation** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Snake growth** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Wall collision** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Self-collision** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Score tracking** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Game-over functionality** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — Restart functionality** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **1. Snake Game (AI team openrouter-free) — The game runs without errors** — OpenRouter free daily limit (about 50 requests a day without credits) was used up before the rerun could plan; not a Hive or model result
- **6. Pathfinding Visualizer (AI team free-hosted) — An interactive grid** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Users can place walls and obstacles** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Users can select a start point and destination** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — A* pathfinding** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Dijkstra's algorithm** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Breadth-First Search** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Animated search process** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Displays the resulting path** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Compares the algorithms' performance** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Handles unreachable destinations** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **6. Pathfinding Visualizer (AI team free-hosted) — Each algorithm returns correct results** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — A random terrain map** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Perlin or Simplex noise** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Mountains** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Lakes and rivers** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Forests** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — World seeds** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Identical seeds produce identical worlds** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Users can regenerate worlds** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — A controllable character** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **7. Procedural World Generator (AI team free-hosted) — Terrain generation performs efficiently** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — A chat interface** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Multiple users** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Sending and receiving messages** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Persistent message history** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Timestamps** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Online indicators** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Typing indicators** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Private chat rooms** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Handles simultaneous messages** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Handles disconnected users** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **8. Real-Time Chat Application (AI team free-hosted) — Messages aren't lost or duplicated** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — A 3D environment** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — A voxel-based world** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Block rendering** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Procedural terrain generation** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Chunk generation** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Chunk loading and unloading** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Player movement** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Collision detection** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Block placement** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Block destruction** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — World persistence** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Optimized rendering and chunk management** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **9. Minecraft-Style Voxel Engine (AI team free-hosted) — Stays playable as the world grows** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — An interactive physics simulation** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Gravity** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Elastic collisions** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Friction** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Particle systems** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Users can create objects** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Users can modify simulation parameters** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Interactions between hundreds of objects** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Conservation of momentum in appropriate collisions** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Numerical stability** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **10. Physics Simulator (AI team free-hosted) — Measured simulation performance** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — A functional chessboard** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Legal move generation** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Piece movement** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Check detection** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Checkmate detection** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Stalemate detection** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Castling** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — En passant** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Pawn promotion** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Board evaluation** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Minimax** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Alpha-beta pruning** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — A playable computer opponent** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Tested against known chess positions** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **11. Chess Engine (AI team free-hosted) — Illegal moves are never accepted** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Draggable programming nodes** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Node connections** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Input and output ports** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — A node execution system** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Dependency resolution** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Detects circular dependencies** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Error handling** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Graph visualization** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — Saving and loading** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **12. Visual Programming Environment (AI team free-hosted) — A working example program built with the node system** — Free-tier limits ran out before the team could build it: OpenRouter free requests/day used up, Groq gpt-oss 120B/20B daily tokens used up, and the last model left (Qwen3.8 27B) is capped at 7,000 input / 1,000 output tokens a minute and then its daily tokens. Hive moved work between models as designed; rerun when the quotas reset.
- **Phase 10 — 30-minute challenge with two first-time users** — Needs two real people who have never used Hive; an automated script cannot measure first-time understanding, coordination or give feedback. A script for the session is in the recommendations.

## 5. Bugs discovered

| # | Bug | Found by | Severity | Status |
|---|---|---|---|---|
| 1 | Every Run (and AI agent command) went through Windows PowerShell 5.1, which took ~14 s just to start on this PC | P3 broken-code check (Run still "running" after 15 s) | High (performance) | Fixed |
| 2 | Run spent ~9 s looking up 18 tools before starting (cache cleared on every press) | P3 broken-code investigation | Medium | Fixed |
| 3 | Run reports a program's exit 4–8 s (sometimes 15 s+) after it actually ended | P3/P4 timing | Low | Fixed |
| 4 | After closing one project and opening another, files with the same path (README.md, index.html) reused the old project's editor document: the old text could show and edits synced into the old project's session | P9 general checks (History empty after several projects) | Critical (data integrity) | Fixed |
| 5 | History recorded your edit as nothing (its "before" text already contained the edit) and could attribute a teammate's simultaneous change to you | P9 general checks | High (collaboration clarity) | Fixed |
| 6 | After switching between shared projects three times, each edit appeared twice in History | P9 investigation | Low (cosmetic) | Fixed |
| 7 | Local Ollama models silently ran with a 4,096-token context: prompts with project files were cut from the start (Hive's instructions and the request lost) and long replies stalled | P7 challenges (replies cut off), confirmed with ollama ps | High (AI quality on real projects) | Fixed |
| 8 | Ask AI ignored files labelled "html index.html" or named in a heading before the code | P6 challenges (AI wrote no files) | Medium | Fixed |
| 9 | A busy Ollama made Hive report an installed model as "not installed" | P6 challenges | Medium | Fixed |
| 10 | Re-saving the whole shared state on every file write slowed long sessions (median sync latency 43 ms to 616 ms after an hour) | P5 one-hour soak | High (performance) | Fixed |
| 11 | Switching projects took ~5 s (waited for old terminals to exit) | P5 rapid project navigation | Medium | Fixed |
| 12 | Renaming or deleting a project failed: its terminal and Run process kept running in the old folder (and leaked) | P1 rename/delete project | High | Fixed |
| 13 | View-only invite links could edit; any viewer could replace the room history | P1 permissions | Critical (security) | Fixed |
| 14 | Settings looked wiped (setup wizard again, recent projects gone) when Hive was reopened quickly | P1 close & reopen | High | Fixed |
| 15 | Raw system errors (ENOENT …, full paths) shown to users | P1 error messages | Medium | Fixed |
| 16 | A minimised or background Hive synced minutes late (Chromium timer throttling) | P2 three-window runs | High | Fixed |
| 17 | Teammates' cursors were never sent or drawn | P2 cursors | Medium | Fixed |
| 18 | Ctrl+Z after a teammate's edit did nothing | P2 undo | High | Fixed |
| 19 | Renaming a file lost a teammate's in-flight edits; the old file reappeared on disk | P2 rename while editing | High (data loss) | Fixed |
| 20 | A file edited outside Hive while closed overwrote the team's newer work on rejoin | P2 stale copy | Critical (data loss) | Fixed |
| 21 | False "offline conflict" after a crash (merge base saved later than the sync record) | P2 stale copy (intermittent) | Medium | Fixed |
| 22 | Deleting a file gave a teammate who had it open no notice | P2 delete while open | Low | Fixed |
| 23 | A late file-watcher echo of Hive's own write could overwrite newer edits | P2 under load | High (data loss) | Fixed |
| 24 | After a relay restart a client could stay "online" on stale text | P2 relay restart (intermittent) | High | Fixed |
| 25 | Tool lookups (where.exe) froze the main process for up to 4 s, stalling every window | P2 event-loop monitor | Medium | Fixed |
| 26 | Accepting an AI suggestion overwrote edits made after the AI read the file | P3 code review + tests | High (data loss) | Fixed |
| 27 | Ask AI saved files under invented folders (src/…) instead of the name asked for | P3 create program | Medium | Fixed |
| 28 | A provider that never answered left Ask AI waiting forever | P3 timeout | Medium | Fixed |
| 29 | Run has no sandbox, resource limits or timeout: programs can read any file, use the network and start processes as the user | P4 sandbox tests | By design (local IDE) | Open |
| 30 | Under 100% CPU, three windows reloading at once sometimes left a renderer unresponsive | P2 harness | Low (not reproduced under normal load) | Open |
| 31 | Switching projects while the AI team was working made it merge into the wrong folder ("--local can only be used inside a git repository") | P6 AI team Snake run (Hive reopened the last project at startup) | High | Fixed |
| 32 | Long AI requests to a local model died after exactly 5 minutes (Node's fetch gives up waiting for the first byte) | P6 AI team runs (architect replies on a slow GPU) | High | Fixed |
| 33 | Thinking models (Qwen 3.5, Qwen3) spent their whole reply thinking in a hidden field: nothing appeared and the stall timer fired | P6 model comparison | High | Fixed |
| 34 | A small model could write one AI-team reply for an hour (Qwen3 4B, planning); the stall timer only catches silence | P6 Qwen3 4B run | Medium | Fixed |
| 35 | Newer small models (Qwen 3.5 4B/9B) were missing from the model store | P6 model search | Low | Fixed |
| 36 | Deleting a model in Models -> Installed failed silently when Ollama was down, and gave no sign of the space freed | P6 model clean-up | Low | Fixed |
| 37 | The AI lead reviewer approved code that ignored the brief's required test hook (window.game) | P6 AI team Tic-Tac-Toe | Medium (AI quality) | Open |
| 38 | Ollama hangs loading Qwen 3.5 models on this PC ("timed out waiting for llama-server to start"), while other models load | P6 model comparison | Low (Ollama / environment) | Open |
| 39 | All three free OpenRouter models in the catalog (Qwen3 Coder, gpt-oss 120B, Llama 3.3 70B) had stopped being free, so the store offered models that would fail | P6 setting up a hosted architect | High | Fixed |
| 40 | Check key accepted an OpenRouter key that could not run models (it only asked whether the key exists); requests then failed with "401 User not found" shown as raw JSON | P6 hosted setup | Medium | Fixed |
| 41 | Hive sent chat messages with empty content (e.g. the result of reading an empty file); Cohere models reject them, so every Snake task on North Mini Code failed | P6 OpenRouter Snake run | High | Fixed |
| 42 | A briefly busy free model (429) failed the whole AI-team task | P6 OpenRouter setup (Gemma rate-limited) | Medium | Fixed |
| 43 | A garbled tool call from gpt-oss ("read_file<\|channel\|>analysis") failed the game-logic task after one try | P6 Groq Snake run | Medium | Fixed |
| 44 | The integration round could only edit files that already existed, so a file whose worker had failed (game.js) could never be created; it tried and was refused | P6 Groq Snake run | High | Fixed |
| 45 | The team contract listed only file names, so element ids reached only the task that named them (index.html used #game, game.js guessed #gameCanvas and crashed) | P6 Groq Snake run | High | Fixed |
| 46 | When one free model ran out of its daily quota, every remaining AI-team task failed in seconds (a Groq batch: gpt-oss 20B hit its limit and eight challenges failed) | P6–P8 hosted batch | High | Fixed |
| 47 | The model fallback never triggered: it looked for "(429)" but Hive had already rewritten the error into its friendly "(429, per-day)" message, so all 10 challenges of a batch failed at once | P6–P8 hosted batch rerun | High | Fixed |
| 48 | The catalog still offered Groq Llama 3.3 70B after Groq retired it (404), and nothing checked Groq models were still served | P6 Groq setup | Medium | Fixed |
| 49 | A broken JSON tool call that Groq reports mid-reply ("Failed to parse tool call arguments as JSON") failed the Kanban styling task instead of being asked again | P7 hosted batch | Low | Fixed |
| 50 | After a model fallback the task card still shows the originally assigned model (e.g. "North Mini Code") although a Groq model did the work; the switch is only in the app log | P6–P8 hosted batch | Low | Open |
| 51 | The team-challenge harness never stopped a run that timed out, so it kept the one local model busy and the next challenges sat in planning (the right-sized local rerun: Snake overran 3 hours, then Tic-Tac-Toe and Breakout never got a plan) | Right-sized-tasks measurement | Medium (QA tooling only) | Fixed |
| 52 | A project session closed before it had read its saved state saved an empty document over that state | Code review while fixing the History duplicates | High (offline edits could be lost) | Fixed |
| 53 | Stopping a model reply early never hung up, so the model kept generating in the background | Right-sized-tasks measurement follow-up | Medium (wasted local GPU time) | Fixed |
| 54 | A local model stuck repeating one block ran to the 6,144-token reply cap (2.5 hours on a slow GPU) | Right-sized-tasks measurement | Medium | Fixed |
| 55 | Nothing told the user when the local model ran mostly on the processor (other apps holding the GPU), so a run crawled for hours with no explanation | Right-sized-tasks measurement | Medium | Fixed |
| 56 | A briefly rate-limited model (Gemma: "temporarily rate-limited upstream") or one sending broken tool calls (gpt-oss 20B) failed its whole task while other team models were free | Hosted rerun of the blocked challenges | Medium | Fixed |

## 6. Bugs fixed

- **Every Run (and AI agent command) went through Windows PowerShell 5.1, which took ~14 s just to start on this PC** — Run and agent commands use cmd.exe on Windows (starts instantly, handles &&); the interactive terminal stays PowerShell.
- **Run spent ~9 s looking up 18 tools before starting (cache cleared on every press)** — Found tools stay cached and "not found" expires after a minute; only runtime tools are looked up (run:start 9 s to 40 ms).
- **Run reports a program's exit 4–8 s (sometimes 15 s+) after it actually ended** — node-pty only reports an exit after 1 s with no output (each new output restarts that wait). Run now reads the exit code node-pty already has at the real exit: measured about 1 s sooner on an idle PC; the busy-PC case was not re-measured.
- **After closing one project and opening another, files with the same path (README.md, index.html) reused the old project's editor document: the old text could show and edits synced into the old project's session** — Every file document is disposed when a project is closed or another is opened.
- **History recorded your edit as nothing (its "before" text already contained the edit) and could attribute a teammate's simultaneous change to you** — Each file's last text is tracked; your pending entry is recorded up to the moment a teammate's change arrives.
- **After switching between shared projects three times, each edit appeared twice in History** — A project session closed while it was still starting went on to register its disk listener, so each later save was recorded once more per such switch. A closed session now stops starting (unit test reproduces it).
- **Local Ollama models silently ran with a 4,096-token context: prompts with project files were cut from the start (Hive's instructions and the request lost) and long replies stalled** — Local models use Ollama's native API with a 16k context (capped at the model's maximum); a secret-word test confirmed the instructions survive a long prompt.
- **Ask AI ignored files labelled "html index.html" or named in a heading before the code** — Shared proposal parser understands the common labelling styles (unit-tested).
- **A busy Ollama made Hive report an installed model as "not installed"** — Last good model list kept (also across restarts); lookup retried with a longer wait.
- **Re-saving the whole shared state on every file write slowed long sessions (median sync latency 43 ms to 616 ms after an hour)** — State and sync record saved together on the normal debounce (one-hour median 226 ms after the fix).
- **Switching projects took ~5 s (waited for old terminals to exit)** — Only renaming/deleting waits for terminals; switching kills them and moves on (15 switches: 76 s → 11 s).
- **Renaming or deleting a project failed: its terminal and Run process kept running in the old folder (and leaked)** — Leaving, renaming or deleting a project now ends its terminals and Run process first; terminal panel restarts per project.
- **View-only invite links could edit; any viewer could replace the room history** — Edit links carry an edit token whose hash the relay stores; the relay decides roles and refuses viewer edits and snapshots. Needs `wrangler deploy` for the live relay.
- **Settings looked wiped (setup wizard again, recent projects gone) when Hive was reopened quickly** — A briefly locked database is retried instead of silently switching to an empty store; a dialog appears if it stays locked.
- **Raw system errors (ENOENT …, full paths) shown to users** — Errors are translated into plain sentences with project-relative paths.
- **A minimised or background Hive synced minutes late (Chromium timer throttling)** — backgroundThrottling disabled for the main window.
- **Teammates' cursors were never sent or drawn** — Cursor broadcasting and drawing wired when an editor attaches (y-monaco only did it for editors present at creation).
- **Ctrl+Z after a teammate's edit did nothing** — Shared files use a Y.UndoManager that undoes only your own edits; menu, shortcut and command undo all route to it.
- **Renaming a file lost a teammate's in-flight edits; the old file reappeared on disk** — Rename keeps the old shared text for 10 s and carries late edits over; editors follow the rename; old file never rewritten.
- **A file edited outside Hive while closed overwrote the team's newer work on rejoin** — 3-way merge against the last-synced text; real conflicts keep both versions (offline copy saved alongside).
- **False "offline conflict" after a crash (merge base saved later than the sync record)** — Local state is saved together with the sync record.
- **Deleting a file gave a teammate who had it open no notice** — The tab closes with a notice.
- **A late file-watcher echo of Hive's own write could overwrite newer edits** — Recent write hashes are remembered; echoes are ignored.
- **After a relay restart a client could stay "online" on stale text** — Client resets its counter on rejoin; relay rejects snapshots covering entries it never had and saves within 250 ms; 60 s silence forces a reconnect.
- **Tool lookups (where.exe) froze the main process for up to 4 s, stalling every window** — Lookups are asynchronous and cached; slow IPC and event-loop stalls are logged.
- **Accepting an AI suggestion overwrote edits made after the AI read the file** — Accept applies only the AI's changes on top of the current file (3-way merge); refuses when both changed the same lines.
- **Ask AI saved files under invented folders (src/…) instead of the name asked for** — System prompt: use exactly the given paths, keep untouched code, ask when vague, flag contradictions.
- **A provider that never answered left Ask AI waiting forever** — 120 s first-token and 60 s stall timeouts with a clear message.
- **Switching projects while the AI team was working made it merge into the wrong folder ("--local can only be used inside a git repository")** — Each team run remembers its own project folder for planning, worktrees, merge and cleanup (regression test added).
- **Long AI requests to a local model died after exactly 5 minutes (Node's fetch gives up waiting for the first byte)** — Model calls use a fetch with no header deadline; Hive's own stall timer still applies (checked with a server that waits 330 s).
- **Thinking models (Qwen 3.5, Qwen3) spent their whole reply thinking in a hidden field: nothing appeared and the stall timer fired** — Hive asks Ollama for answers without hidden thinking (139 s with nothing shown -> 13 s answer).
- **A small model could write one AI-team reply for an hour (Qwen3 4B, planning); the stall timer only catches silence** — Each AI-team reply is capped at ~6,000 tokens (enough for a whole game file); the plan step retries and then falls back to a one-task plan.
- **Newer small models (Qwen 3.5 4B/9B) were missing from the model store** — Added to the catalog with conservative scores.
- **Deleting a model in Models -> Installed failed silently when Ollama was down, and gave no sign of the space freed** — Confirm shows the size freed; success and failure are both reported.
- **All three free OpenRouter models in the catalog (Qwen3 Coder, gpt-oss 120B, Llama 3.3 70B) had stopped being free, so the store offered models that would fail** — Catalog updated to current free models, and Hive now checks OpenRouter's live free list (hourly, last good list kept offline) and hides any catalog model that is no longer free from the store and the AI team (verified by re-adding a stale entry: it was hidden).
- **Check key accepted an OpenRouter key that could not run models (it only asked whether the key exists); requests then failed with "401 User not found" shown as raw JSON** — Check key sends a real 1-token request; rejected keys and used-up daily limits get plain messages.
- **Hive sent chat messages with empty content (e.g. the result of reading an empty file); Cohere models reject them, so every Snake task on North Mini Code failed** — Empty messages get a short placeholder (unit test).
- **A briefly busy free model (429) failed the whole AI-team task** — The AI team waits and retries up to 4 times; a daily quota fails at once with a clear message.
- **A garbled tool call from gpt-oss ("read_file<|channel|>analysis") failed the game-logic task after one try** — Rejected tool calls are retried twice.
- **The integration round could only edit files that already existed, so a file whose worker had failed (game.js) could never be created; it tried and was refused** — Integration may write every file in the plan (regression test). In the final Groq run this is what produced the working game.
- **The team contract listed only file names, so element ids reached only the task that named them (index.html used #game, game.js guessed #gameCanvas and crashed)** — Every element id and shared window global named anywhere in the plan is repeated in every task (regression test).
- **When one free model ran out of its daily quota, every remaining AI-team task failed in seconds (a Groq batch: gpt-oss 20B hit its limit and eight challenges failed)** — A model out of daily quota (all OpenRouter models together, since that quota is per account) is set aside for 6 hours and the task moves to the best other team model with room; a request too large for one model moves to another.
- **The model fallback never triggered: it looked for "(429)" but Hive had already rewritten the error into its friendly "(429, per-day)" message, so all 10 challenges of a batch failed at once** — One shared classifier decides quota / too large / busy / bad tool call for both the message and the retry logic (unit test with the real provider texts). The next batch moved work from OpenRouter to Groq as designed.
- **The catalog still offered Groq Llama 3.3 70B after Groq retired it (404), and nothing checked Groq models were still served** — Groq models are checked against the live Groq model list (hourly, with the user key) like OpenRouter free models; Llama 3.3 70B replaced by Qwen3.8 27B.
- **A broken JSON tool call that Groq reports mid-reply ("Failed to parse tool call arguments as JSON") failed the Kanban styling task instead of being asked again** — Treated like other garbled tool calls: retried twice (unit test).
- **The team-challenge harness never stopped a run that timed out, so it kept the one local model busy and the next challenges sat in planning (the right-sized local rerun: Snake overran 3 hours, then Tic-Tac-Toe and Breakout never got a plan)** — The harness stops the run (agents:stop) whenever a challenge fails or times out. That rerun is not counted: other apps held the 6 GB GPU, Ollama fit only 9 of 29 layers on it (22 in the baseline) and wrote under 1 token a second.
- **A project session closed before it had read its saved state saved an empty document over that state** — A session saves only after it has loaded its state (unit test).
- **Stopping a model reply early never hung up, so the model kept generating in the background** — Both stream readers cancel the HTTP stream when the reader stops (unit tests for Ollama and OpenAI-style providers).
- **A local model stuck repeating one block ran to the 6,144-token reply cap (2.5 hours on a slow GPU)** — A reply ending in one block repeated 5+ times (2,000+ characters) is cut to one copy and the request is stopped.
- **Nothing told the user when the local model ran mostly on the processor (other apps holding the GPU), so a run crawled for hours with no explanation** — During a run Hive reads Ollama /api/ps every 30 s and shows a plain warning in the AI team panel when under 60% of the model is on the GPU. Not yet seen live (needs a loaded, offloaded model).
- **A briefly rate-limited model (Gemma: "temporarily rate-limited upstream") or one sending broken tool calls (gpt-oss 20B) failed its whole task while other team models were free** — Two more tries on the same model, then the call moves to the next team model; a rate-limited one rests 5 minutes (unit tests for the decision).

## 7. Unresolved bugs

- **Run has no sandbox, resource limits or timeout: programs can read any file, use the network and start processes as the user** — Same model as VS Code; recommendation below.
- **Under 100% CPU, three windows reloading at once sometimes left a renderer unresponsive** — Not root-caused; main process stayed responsive. Harness avoids simultaneous reloads.
- **The AI lead reviewer approved code that ignored the brief's required test hook (window.game)** — A model-quality limit of small local reviewers; the game was checked by clicking instead (7/8).
- **Ollama hangs loading Qwen 3.5 models on this PC ("timed out waiting for llama-server to start"), while other models load** — Outside Hive; likely the 6 GB GPU being shared with games and launchers. Retry after restarting Ollama with GPU apps closed.
- **After a model fallback the task card still shows the originally assigned model (e.g. "North Mini Code") although a Groq model did the work; the switch is only in the app log** — 

## 8. Performance measurements

| Measurement | Result |
|---|---|
| Open project: 100 / 500 / 1,000 files | 1075 / 421 / 342 ms |
| Search 1,000 files | 13712 ms |
| Typing latency (p95): 1k / 10k / 100k-line file | 31.6 / 18 / 76.1 ms |
| Open 100k-line (4.5 MB) file | 622 ms |
| 200 tab switches | 10924 ms |
| Memory (all Hive processes) | 936 MB RSS, renderer heap 29.3 MB |
| Idle CPU | 1% of one core |
| Idle network requests (60 s) | 0 |
| Disk writes for 100 keystrokes (solo) | 1 |
| Shared-state file rewrites while typing | 1 × 936 KB in 10 s |
| Synchronization with five people editing simultaneously | 300/300 edits on all 5; latency p50 100 ms, p95 563 ms |
| Synchronization with ten people editing simultaneously | 10 online, 400/400 edits converged; latency p50 232 ms, p95 534 ms |
| Synchronization with twenty people joining simultaneously | 20/20 got in (refused: none); join 603 ms; 400/400 edits converged; p95 1756 ms |
| AI response time (measured) | 28 requests on qwen2.5-coder-7b: median 14.7 s, max 126.8 s (full Phase 3 run with the 16k-context native API, night-time load) |
| Measure synchronization latency | 65 samples over 60 min on the local relay: p50 180 ms, p95 455 ms (Cloudflare relay measured separately) |

Numbers were taken on a heavily loaded machine (CPU often 90–100% from OneDrive, Explorer and other apps); on an idle PC expect them to be lower. Search over 1,000 files took 0.6–1.1 s on files already read once, but up to 14–19 s right after the 1,000 test files were created, which matches Windows Defender scanning each new file on first read (the full-tree hash that ran straight after over the same files took 0.6 s). Typing in a 100,000-line (4.5 MB) file stays usable (p50 ~11 ms) but its slowest 5% of keystrokes take ~76 ms, above the 50 ms target, even with the minimap, folding and bracket colouring turned off for such files. AI responses with the local 7B model took a median of 53 s per request (max 231 s) on this CPU.

## 9. Collaboration stress-test results

- **Two people edit the exact same line simultaneously**: PASS — 
- **Two people type at the exact same cursor position**: PASS — result: [AAAAABBBBBBBBBBBBBBBAAAAAAAAAAAAAAABBBBB]
- **Simultaneous changes do not silently disappear (300 marked edits from 3 people)**: PASS — 300/300 edits present on all three
- **Project state survives a relay (server) restart**: PASS — 
- **Concurrent operations are handled consistently**: PASS — same-file, same-line, same-position, delete-vs-edit and offline merges all converged to identical text on every client
- **Synchronization with five people editing simultaneously**: PASS — 300/300 edits on all 5; latency p50 100 ms, p95 563 ms
- **Synchronization with ten people editing simultaneously**: PASS — 10 online, 400/400 edits converged; latency p50 232 ms, p95 534 ms
- **Synchronization with twenty people joining simultaneously**: PASS — 20/20 got in (refused: none); join 603 ms; 400/400 edits converged; p95 1756 ms

**Soak test** (2 people typing non-stop, 60 min):

| Minute | Edits sent | Sync latency median | Renderer heap A/B | App RSS A/B | Relay RSS |
|---|---|---|---|---|---|
| 0 | 115 | 64 ms | 25.8/25.9 MB | 586/593 MB | 57 MB |
| 5 | 3277 | 109 ms | 39.4/57.3 MB | 883/919 MB | 76 MB |
| 10 | 6474 | 80 ms | 51.6/58.4 MB | 886/942 MB | 68 MB |
| 15 | 9618 | 243 ms | 47.2/40 MB | 932/929 MB | 74 MB |
| 20 | 12749 | 152 ms | 53.2/67.1 MB | 969/899 MB | 79 MB |
| 25 | 15880 | 180 ms | 93.7/82 MB | 1031/927 MB | 91 MB |
| 30 | 18997 | 132 ms | 93.3/63.3 MB | 1015/955 MB | 100 MB |
| 35 | 2963 | 116 ms | 63.4/79.4 MB | 1040/926 MB | 69 MB |
| 40 | 6053 | 186 ms | 78.1/87.6 MB | 1046/951 MB | 80 MB |
| 45 | 9181 | 487 ms | 70.5/59.5 MB | 977/906 MB | 69 MB |
| 50 | 12177 | 246 ms | 64.2/62.2 MB | 997/941 MB | 71 MB |
| 55 | 15287 | 218 ms | 49.5/70.1 MB | 933/851 MB | 71 MB |
| 60 | 18353 | 226 ms | 69.8/80 MB | 952/875 MB | 69 MB |

Convergence was checked on every client by comparing both the shared document and the file on disk.

## 10. Coding challenge results

| Challenge | Features working at the end | Best round | AI rounds | Features that failed at some point |
|---|---|---|---|---|
| 1. Snake Game | 4/10 | 4/10 | 3 | 9 |
| 2. Tic-Tac-Toe | 8/8 | 8/8 | 1 | 0 |
| 3. Space Invaders | 1/8 | 1/8 | 3 | 8 |
| 4. Breakout | 1/8 | 1/8 | 3 | 7 |
| 5. Kanban Task Manager | 5/11 | 5/11 | 3 | 6 |
| 6. Pathfinding Visualizer | 2/11 | 2/11 | 3 | 11 |
| 7. Procedural World Generator | 9/10 | 9/10 | 3 | 1 |
| 8. Real-Time Chat Application | 1/11 | 1/11 | 3 | 11 |
| 9. Minecraft-Style Voxel Engine | 0/13 | 0/13 | 3 | 13 |
| 10. Physics Simulator | 1/11 | 1/11 | 3 | 10 |
| 11. Chess Engine | 0/15 | 0/15 | 3 | 15 |
| 12. Visual Programming Environment | 0/10 | 0/10 | 3 | 10 |

**1. Snake Game** — not working: Create a playable Snake game (no canvas or snake does not move on its own); Snake growth (length 1→1); Self-collision (length 1 looped into itself without game over); Score tracking (score 0→0); Game-over functionality (over=true moved after over=false message=false); Restart functionality ({"over":false,"score":0,"len":1})

**3. Space Invaders** — not working: Player movement (x 220→220); Projectile shooting (no bullet or bullet does not move up); Projectile collisions (enemy count 32→32); Player-enemy collisions (lives 3→3); Scoring (score 0→0); Increasing difficulty (level 1→1, speed 1→1); Game-over and restart states (over=false after reset over=false)

**4. Breakout** — not working: Paddle movement (paddle did not move); Ball physics (ball at 200,400); Wall collisions (left bounce=false top bounce=false); Paddle collisions (ball vy after paddle 4); Brick destruction (brick alive=true); Lives and scoring (score 0→0, lives 3→3); Win and loss conditions (won=false over=false)

**5. Kanban Task Manager** — not working: A task management application (see creation/columns); Task creation (task not created or not shown); Task editing (edit not applied); Draggable task cards (card element not found); Task assignments (assign not applied); Real-time collaboration (second window did not update live)

**6. Pathfinding Visualizer** — not working: Users can select a start point and destination (not checked); A* pathfinding (not checked); Dijkstra's algorithm (not checked); Breadth-First Search (not checked); Animated search process (not checked); Displays the resulting path (not checked); Compares the algorithms' performance (not checked); Handles unreachable destinations (not checked); Each algorithm returns correct results (not checked)

**7. Procedural World Generator** — not working: A controllable character (moved=false blocked by water=not tested)

**8. Real-Time Chat Application** — not working: Multiple users (online list []); Sending and receiving messages (not checked); Persistent message history (not checked); Timestamps (not checked); Online indicators (no presence event listing Ana); Typing indicators (not checked); Private chat rooms (not checked); Handles simultaneous messages (not checked); Handles disconnected users (not checked); Messages aren't lost or duplicated (not checked)

**9. Minecraft-Style Voxel Engine** — not working: A 3D environment (window.engine missing (Three.js may have failed to load)); A voxel-based world (not checked); Block rendering (not checked); Procedural terrain generation (not checked); Chunk generation (not checked); Chunk loading and unloading (not checked); Player movement (not checked); Collision detection (not checked); Block placement (not checked); Block destruction (not checked); World persistence (not checked); Optimized rendering and chunk management (not checked); Stays playable as the world grows (not checked)

**10. Physics Simulator** — not working: Gravity (not checked); Elastic collisions (not checked); Friction (not checked); Particle systems (not checked); Users can create objects (not checked); Users can modify simulation parameters (not checked); Interactions between hundreds of objects (not checked); Conservation of momentum in appropriate collisions (not checked); Numerical stability (not checked); Measured simulation performance (not checked)

**11. Chess Engine** — not working: A functional chessboard (0 squares, pieces shown=false); Legal move generation (not checked); Piece movement (not checked); Check detection (not checked); Checkmate detection (not checked); Stalemate detection (not checked); Castling (not checked); En passant (not checked); Pawn promotion (not checked); Board evaluation (not checked); Minimax (not checked); Alpha-beta pruning (not checked); A playable computer opponent (not checked); Tested against known chess positions (not checked); Illegal moves are never accepted (not checked)

**12. Visual Programming Environment** — not working: Draggable programming nodes (not checked); Node connections (not checked); Input and output ports (not checked); A node execution system (not checked); Dependency resolution (not checked); Detects circular dependencies (not checked); Error handling (not checked); Graph visualization (not checked); Saving and loading (not checked); A working example program built with the node system (not checked)

**Collaborative challenges (two people, each with their own AI):**

| Pair | Tess wrote | Omar wrote | Rounds | Working on Tess / Omar |
|---|---|---|---|---|
| snake | logic.js | index.html, ui.js | 3 | 0/10 · 0/10 |
| chess | rules.js | index.html, engine.js, ui.js | 3 | 0/15 · 0/15 |
| voxel | – | index.html, player.js | 3 | 0/13 · 0/13 |
| chat | server.js, hive.json | public/index.html, public/client.js | 3 | 1/11 · 1/11 |
| physics | engine.js | index.html, view.js | 3 | 1/11 · 1/11 |
| pathfinding | algorithms.js | index.html, ui.js, style.css | 3 | 1/11 · 1/11 |

Phases 6–8 first ran with Hive's Ask AI only (one model, no architect or lead review). Each challenge was built only through Hive's Ask AI with the local qwen2.5-coder:7b model; failing features were fed back to the AI for up to 3 rounds, like a user would, and every feature was checked mechanically in a hidden browser window. Results reflect a 7B local model on a modest PC; a larger or hosted model would do much better. The first run happened before the context-window fix (Ollama capped prompts at 4,096 tokens): fixing it took the world generator from 0/10 to 9/10, Tic-Tac-Toe from 4/8 (best round) to 8/8 and pathfinding from 0/11 to 2/11; simple games were unchanged. Typical AI failures were genuine code bugs: functions the spec required but left out (placeFood(x,y), pf.reset), game state rebuilt on every call (nothing persisted), libraries used without importing them (THREE, SimplexNoise), and runtime errors (`this.nodes.push is not a function`). In the two-person challenges the halves often disagreed about the shared interface (both sides defining window.game), which is exactly the integration risk Phase 9 is meant to expose. AI team re-run (architect plans, workers build in separate git worktrees, lead reviews, then merge), Snake and Tic-Tac-Toe, with each model setup the PC could run: (1) Qwen2.5 Coder 7B architect/lead + Llama 3.2 3B workers: Snake 0/10, unfinished after 184 min; most of the time went on swapping the two models in and out of the 6 GB GPU. (2) Qwen2.5 Coder 7B alone: Snake 1/10 in 57 min (runs without errors but the snake never moves); Tic-Tac-Toe 1/8 by the test hook, which the AI left out, but 7/8 when checked by clicking like a player (16 min; only the scoreboard never updates). (3) Qwen3 4B alone: no plan within 30 min, twice; measured at 3 tokens/s because 21% of the model spilled onto the CPU, so one capped reply takes ~30 min. (4) Qwen 3.5 4B/9B: Ollama could not load them on this PC. Conclusion: the team pipeline itself works (it planned, built in worktrees, reviewed and merged, after the fixes above); the limit is compute, about 3 GB of free GPU memory. A hosted or larger model would be expected to do far better; this was then measured with free hosted models. Hosted free models (user-supplied free keys, no laptop GPU): Tic-Tac-Toe 8/8 in 5 min (OpenRouter: Nemotron 3 Ultra architect/lead + North Mini Code workers); Snake 9/10 in 7 min (Groq: gpt-oss 120B architect + gpt-oss 20B lead/workers; only the game-over message was missing). Reaching that took six Hive fixes found by these runs (empty messages, integration file rights, team contract ids, retries). Free-tier limits shaped the runs: OpenRouter allows about 50 free requests a day without credits (one Snake rerun was blocked by it) and Groq caps requests at 8,000 tokens a minute (larger review/integration requests were refused). The remaining ten challenges were then run on the same free keys in one batch (2026-11-18): Breakout 6/8 in 3 min, Kanban 5/11, Space Invaders 2/8; the other seven (pathfinding, world, chat, voxel, physics, chess, visual programming) are BLOCKED, not failed: the free allowances ran out mid-batch (OpenRouter free requests/day, then Groq gpt-oss 120B and 20B daily tokens), and the last model with room, Qwen3.8 27B on Groq, is capped at 7,000 input and 1,000 output tokens a minute, too small to write a game file, until its daily tokens ran out too. The Space Invaders and Kanban integration rounds failed on the same caps. Hive moved work between models as designed (logged); a fair score for those seven needs fresh quotas or a paid key.

## 11. Architectural weaknesses

- Ask AI sees only the open file; it has no project-wide context or code search, so multi-file work depends on the user pasting context.
- Run executes code with the user's full rights and no time or memory limits (fine for a local IDE, but there is no isolation option).
- The whole shared document is re-encoded and rewritten to `.hive/state.b64` after edits, which grows with project size.
- Rooms are capped at 25 people and the relay keeps the full update log in memory per room.
- The live Cloudflare relay runs older code until it is redeployed.
- The AI team on one small GPU is slow: roles that use different models swap them in and out, and small reviewers approve code that misses parts of the brief.

## 12. Recommendations

1. Deploy the updated relay (`cd services/relay-cf && npx wrangler deploy`) so view-only links and the 25-person cap apply on the live service.
2. Give Ask AI project context (file list + search + selected files) and a "files touched" summary on each proposal.
3. Add an optional Run sandbox: time limit, memory limit, and a "no network" toggle (e.g. a job object on Windows).
4. Save shared state incrementally (append updates, compact occasionally) instead of rewriting the whole state file.
5. Run Phase 10 with two real first-time users: give them the brief ("Build a fully functional Snake game together in 30 minutes"), one shared project, a stronger model than 7B if possible, and record join time, time to first edit, conflicts, AI bugs, coding vs coordinating time and a short interview afterwards.
6. Use a stronger default model for AI work when the PC allows it (or a free hosted model); a 7B model on CPU+GPU reads prompts at ~15 tokens/s here and cannot build mid-size apps.
7. For the AI team on a modest PC, use one model for every role (no swapping) or a hosted architect/lead; show the measured tokens/s so users know when a model is too slow.
8. Keep the QA harness (`tools/qa`) in CI for Phases 1, 2 and 4, which need no AI model.

## Final quality assessment (Phase 11)

| Category | Score | Why |
|---|---|---|
| Core functionality | 90 | 18/19 core items pass (5 after fixes); back/forward not applicable; moving a file does not update imports. |
| Multiplayer collaboration | 85 | 33/33 Phase 2 items pass after 11 fixes; 20 people converge; latency drifts from ~80 ms to ~220 ms over an hour of non-stop typing; the live relay still needs redeploying. |
| AI coding capabilities | 60 | Ask AI handles everyday tasks well (Phase 3: 25/28; in the 3 misses the AI's output was wrong — a renamed export, a test API that doesn't exist, an unflagged contradiction — not yet re-tested with a stronger model or through the AI team) and follows the given file paths after the prompt fix; built directly with Ask AI and the local 7B model the challenge apps mostly failed (Phase 6: 15/34, Phase 7: 17/43, Phase 8: 1/49 features). These runs did not use Hive's AI team (architect + lead review); a control by another session with Claude Sonnet on the same briefs scored 8/8 (Tic-Tac-Toe) and 9/10 (Snake), so the result says 'a single 7B model without the team', not 'Hive cannot build these'. Re-run through the AI team with every local model this PC could run, the best result was Tic-Tac-Toe 7/8 by clicking (Qwen2.5 Coder 7B); Snake reached 1/10; the limit was about 3 GB of free GPU memory, not the team pipeline. With free hosted models the AI team built Tic-Tac-Toe 8/8 in 5 min and Snake 9/10 in 7 min after six team fixes; Phases 7–8 not yet re-run that way (free daily limits). |
| Code execution reliability | 80 | 21/25: runs, input, streaming output, stop, restart and errors with file:line all work; no limits or sandbox (by design). |
| Data persistence | 85 | Settings, projects and shared state survive restarts, crashes and a relay restart after fixes; offline edits merge 3-way with a conflict copy. |
| Performance | 75 | Projects open in under 2.5 s, typing p95 under 32 ms in normal files, idle CPU ~1%, Run starts in ~40 ms after fixes; 100k-line files now 34-44 ms p95 (plain-text mode over 2 MB), Run notices exits about 1 s sooner than before, and the local 7B model reads prompts at ~15 tokens/s on this PC. |
| User experience | 65 | Clear errors and notices, follow-the-AI view, previews; but local AI replies take minutes on modest hardware and the 30-minute first-user study (Phase 10) is still to be run. |
| Security | 60 | End-to-end encrypted rooms, outsiders can't read projects, view-only links now enforced by the relay (needs deploy); Run executes code with full user rights. |
| Error handling | 80 | Plain-language errors, AI timeouts and provider errors surfaced; a few failures still only show in the terminal (missing npm packages). |
| Recovery from failures | 85 | Reconnect, offline edits, relay restart, crash restart and AI undo all recover without data loss after fixes. |
| **Overall** | **77** | average of the ten categories |

**Weakest categories:** AI coding capabilities (60), Security (60), User experience (65).
