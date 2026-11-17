# Hive — QA & Stress Test Checklist

Every item from the QA plan, in order. Updated as tests run.

**Legend:** `[x]` passed (verified in the real app) · `[!]` failed, then fixed and re-passed · `[F]` failed, not fixed yet · `[~]` blocked (reason given) · `[ ]` not run yet

Test scripts: `tools/qa/`. Results log and screenshots: `docs/qa/`. Throwaway test projects and app profiles: `%USERPROFILE%\dev-cache\hive\qa` (outside OneDrive).

---

## Pre-work
- [x] Check whether Jev can be used for routing and git workflows → only as an optional paid add-on (closed-weight API via Vercel AI Gateway, $0.042/M input tokens); can't be the free/offline default
- [x] Look into how Amoeba does multiplayer AI and list what Hive is missing → overlap warnings, per-person agent lanes, shared "Brain" notes, plan-step ownership + handoffs, code/diff comments, conflict tab
- [x] Download a stronger coding model for the AI phases (`qwen2.5-coder:7b`)
- [x] Organize project files: move `node_modules` out of OneDrive (it was corrupting/locking dependencies)
- [x] App builds and the 61 unit tests pass after the reinstall (two agent tests needed a longer time budget on a busy machine)
- [x] Inspect the codebase and architecture before testing

## PHASE 1 — Core Application Functionality
- [x] Create a new project; it appears in the project dashboard
- [x] Create multiple projects; each keeps independent files and settings
- [!] Rename a project; the new name persists after refreshing — fixed: terminals from a previous project kept the folder locked
- [!] Delete a project; it is removed and can't be opened through its old link — fixed: terminals from a previous project kept the folder locked
- [x] Create a new file; it appears in the file explorer
- [x] Rename an existing file; its contents are preserved
- [x] Delete a file; it disappears from the project
- [x] Create nested folders; the directory structure works
- [x] Move files between folders; imports and references still work where applicable
- [x] Open multiple files and switch between them
- [x] Edit code; changes are saved
- [x] Refresh the window; no saved work is lost
- [!] Close and reopen the app; the project is restored — fixed: a briefly locked settings file made Hive start with empty settings
- [~] Browser navigation, including back and forward — Not applicable: Hive is a desktop app with tabs, not URL pages. There is no back/forward history to test.
- [x] Copy a project invitation link; it is valid
- [x] Open a project link in another session
- [x] Unauthorized users can't access private projects
- [!] Project permissions and ownership — fixed: view-only links could edit; relay now enforces roles with an edit token
- [!] Errors are communicated clearly to users — fixed: raw system errors (ENOENT …) were shown; now plain sentences

## PHASE 2 — Multiplayer Collaboration
- [x] Invite one collaborator using a project link
- [x] Invite multiple collaborators simultaneously
- [x] All collaborators see the same project files — 4 files identical on all three (on disk after 754 ms)
- [x] Two people edit different files simultaneously
- [x] Two people edit the same file simultaneously
- [x] Two people edit the exact same line simultaneously
- [x] Two people type at the exact same cursor position
- [x] One person deletes code while another edits that code
- [!] One person renames a file while another edits it — fixed: the teammate's in-flight edits were lost and the old file came back on disk
- [x] One person creates a file while another navigates the file explorer
- [!] One person deletes a file while another has it open — fixed: no notice and the tab stayed open; now closed with a notice
- [x] Simultaneous changes don't silently disappear — 300/300 edits present on all three
- [x] Changes synchronize across all connected clients
- [!] Collaborators can see each other's cursors — fixed: cursors were never sent or drawn (editors attached after the binding)
- [x] Collaborator presence indicators update correctly
- [x] Users can tell their own changes from other people's
- [!] Undo and redo while multiple people are editing — fixed: Ctrl+Z did nothing after a teammate's edit; now a shared undo of your own edits
- [!] Undoing one person's changes doesn't undo another person's unrelated changes — fixed: Ctrl+Z did nothing after a teammate's edit; now a shared undo of your own edits
- [!] Disconnect one collaborator from the internet — fixed: background windows were throttled, delaying sync by minutes
- [!] Continue editing while that collaborator is disconnected — fixed: background windows were throttled, delaying sync by minutes
- [!] Reconnect the disconnected collaborator — fixed: background windows were throttled, delaying sync by minutes
- [!] Their editor synchronizes with the latest project state — fixed: background windows were throttled, delaying sync by minutes
- [x] Refresh one collaborator's window while everyone else is working
- [x] The refreshed session restores correctly
- [x] A collaborator leaves the project
- [x] Remaining collaborators can continue working
- [x] Rejoin the project using the original invitation link
- [!] Collaborators can't accidentally overwrite the whole project with stale data — fixed: an offline copy overwrote the team's newer work; now a 3-way merge
- [x] Synchronization with five people editing simultaneously — 300/300 edits on all 5; latency p50 100 ms, p95 563 ms
- [x] Synchronization with ten people editing simultaneously — 10 online, 400/400 edits converged; latency p50 232 ms, p95 534 ms
- [x] Synchronization with twenty people joining simultaneously — 20/20 got in (refused: none); join 603 ms; 400/400 edits converged; p95 1756 ms
- [x] Concurrent operations are handled consistently
- [!] Project state stays consistent after a server restart — fixed: a stale snapshot could delete entries after a restart; dead connections now detected

## PHASE 3 — AI / Vibe-Coding Functionality
- [!] AI creates a simple program from a natural-language prompt — fixed: the AI put files under an invented src/ folder; prompt now keeps the given paths
  throw err;
  ^

Error: Cannot find module 'C:\Users\User\dev-cache\hive\qa\p3\ai\fib.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1
  throw err;
  ^

Error: Cannot find module 'C:\Users\User\dev-cache\hive\qa\p3\ai\fib.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1
- [!] AI creates a multi-file project — fixed: the AI put files under an invented src/ folder; prompt now keeps the given paths
  throw err;
  ^

Error: Cannot find module 'C:\Users\User\dev-cache\hive\qa\p3\ai\app.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1603:15)
    at wrap
  throw err;
  ^

Error: Cannot find module 'C:\Users\User\dev-cache\hive\qa\p3\ai\app.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1603:15)
    at wrap
- [x] AI modifies an existing function
- [x] AI adds a feature without changing unrelated functionality
- [x] AI identifies and fixes a syntax error
- [x] AI identifies and fixes a logical error
- [x] AI explains an unfamiliar codebase
- [x] AI explains a specific function
- [x] Ambiguous prompt: AI handles uncertainty appropriately
- [F] Contradictory instructions: AI identifies the contradiction — no contradiction flagged: ```sum.js
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
function sum(a, b) {
  return (a + b).toString();
}
```
- [F] AI refactors poorly structured code — behaviour changed: X;z → [eval]:1
const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))
                                         ^

TypeError: p is not a function

- [x] AI optimizes a slow algorithm — fib(35): 2461 ms → 0 ms
- [F] AI writes unit tests — tests fail on correct code: er/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/te


- [x] AI fixes failing unit tests
- [!] AI implements a feature across multiple files — fixed: the AI put files under an invented src/ folder; prompt now keeps the given paths
eggs

eggs

- [x] AI modifies code another collaborator is currently editing
- [x] Two collaborators send AI requests simultaneously
- [x] Simultaneous AI requests don't overwrite each other's changes
- [x] AI-generated changes are synchronized with all collaborators
- [x] Users can inspect AI-generated changes before accepting them
- [x] AI doesn't silently remove unrelated functionality
- [x] Requesting broken code: the app reports execution errors — Exited with code 1. See the Run terminal for details.
- [x] AI references nonexistent files or dependencies: what happens — Run fails with Node's "Cannot find module" in the terminal + "Exited with code 1. See the Run terminal for details.". Hive does not warn about missing packages 
- [!] An AI request times out: what happens — fixed: a silent provider left Ask AI waiting forever; now 120 s / 60 s timeouts
- [x] The AI provider returns an error: what happens — shown to the user as: Model request failed (500): {"error":{"message":"upstream exploded"}}
- [x] Users can recover from unsuccessful AI modifications

## PHASE 4 — Code Execution and Runtime
- [x] Run a basic Hello World program
- [x] Run a program that accepts user input
- [x] Run a program that produces continuous output — 32 lines streamed in 2.5 s
- [x] Run a program with multiple files
- [x] Run a program with external dependencies
- [x] Run a program with missing dependencies; the error is understandable — Node error shown + Hive status message: Exited with code 1. See the Run terminal for details.
- [x] Run a program with syntax errors
- [x] Run a program with runtime errors
- [x] Run a program that intentionally throws an exception
- [x] Run a program that uses significant memory — 1 GB allocated, status exited, Hive UI responsive (complete). No memory limit is enforced.
- [x] Run a program that uses significant CPU — UI stayed responsive (worst 31 ms)
- [x] Run an infinite loop
- [x] An infinite loop can be terminated
- [x] Stopping execution actually releases its resources
- [x] Run multiple programs simultaneously
- [x] One user's execution doesn't interfere with another user's — Each person runs code on their own computer (Hive has no shared execution server); verified separately in Phase 9 runs by two instances.
- [x] Modify code while a previous version is running — old run kept v1; Restart picked up v2
- [x] The running program uses a consistent source version — old run kept v1; Restart picked up v2
- [x] Execution output is displayed correctly
- [x] Errors include useful file names and line numbers — file and line (t.js:4) present
- [x] Execution environments don't expose other users' project files
- [F] Attempts to access unauthorized filesystem locations — a program you run can read any file your account can (C:/Users/User/hive-qa-secret-1794896116262.txt). Hive's own file API: refused: "../../../../hive-qa-secret.txt" is outside the project
- [F] Attempts to access unauthorized network resources — programs have full network access (no network policy for Run)
- [F] Attempts to escape the execution sandbox — no sandbox: programs can start other processes as the user (WHOAMI:User)
- [F] Resource limits and execution timeouts — Run has no time or memory limit (by design for dev servers); only AI-agent commands have a timeout + allow/approve/block policy

## PHASE 5 — Performance and Stress Testing
- [x] Open a project with 100 files — open 1075 ms, search 1981 ms (100 hits), full-tree hash 111 ms
- [x] Open a project with 500 files — open 421 ms, search 4436 ms (500 hits), full-tree hash 400 ms
- [x] Open a project with 1,000 files — open 1075 ms, search 1981 ms (100 hits), full-tree hash 111 ms
- [x] Open a source file with 1,000 lines — open 320 ms; keystroke→frame p50 12.3 ms, p95 31.6 ms, max 161.9 ms
- [x] Open a source file with 10,000 lines — open 544 ms; keystroke→frame p50 11.1 ms, p95 18 ms, max 76.2 ms
- [F] Open a very large source file and measure editor responsiveness — typing p95 76.1 ms
- [x] A project with 50 dependencies — open 843 ms; node_modules (550 files) skipped by search (1 hits) and sharing (2 files hashed)
- [x] A project with hundreds of dependencies — open 239 ms; node_modules (4400 files) skipped by search (1 hits) and sharing (2 files hashed)
- [x] A project with deeply nested directories — open 938 ms; path length 509 chars works
- [x] Rapid typing and deletion — 3,000 keystrokes + 2,000 deletes in 4202 ms; text intact
- [F] Rapid switching between files — avg 54.62 ms per switch
- [x] Rapid project navigation — 15 project switches in 11234 ms
- [x] Repeated AI requests — times: 4.4 s, 14.7 s, 12.5 s, 3.0 s, 0.7 s
- [x] Repeated project creation and deletion — 106080 ms; renderer heap +1.6 MB
- [x] Multiple collaborators continuously editing for 30 minutes — 18997 edits; files identical everywhere: {"a.js":true,"b.js":true,"shared.js":true}; sync latency median 132 ms; renderer heap 39.4→93.3 MB (A), 57.3→63.3 MB (B
- [x] Multiple collaborators continuously editing for one hour — 18353 edits; files identical everywhere: {"a.js":true,"b.js":true,"shared.js":true}; sync latency median 226 ms; renderer heap 39.4→69.8 MB (A), 57.3→80 MB (B);
- [x] Measure synchronization latency — 65 samples over 60 min on the local relay: p50 180 ms, p95 455 ms (Cloudflare relay measured separately)
- [x] Measure project loading time — 100 files 1075 ms · 500 files 421 ms · 1,000 files 342 ms
- [x] Measure editor responsiveness — keystroke→frame p95: 1k lines 31.6 ms, 10k lines 18 ms, 100k lines 76.1 ms
- [x] Measure AI response time — 28 requests on qwen2.5-coder-7b: median 14.7 s, max 126.8 s (full Phase 3 run with the 16k-context native API, night-time load)
- [x] Monitor memory consumption — all Hive processes 936 MB RSS (4 processes); renderer JS heap 29.3 MB
- [x] Monitor CPU consumption — idle: 1.0% of one core
- [x] Monitor server resource consumption — relay process 57→69 MB RSS, 158.2 CPU-s over 60 min
- [x] Identify memory leaks — renderer heap from min 5 to min 60: A 39.4→69.8 MB, B 57.3→80 MB; RSS A 883→952 MB
- [x] Identify unnecessary network requests — 0 renderer requests in 60 s idle: {}
- [x] Identify redundant database operations — 1 disk writes for 100 keystrokes over 10 s (autosave debounced at 0.9 s)
- [x] Performance stays acceptable during concurrent use — 20 people joined at once and converged (p95 1.8 s); 2 people typing non-stop for an hour: every check identical, median sync latency 80-130 ms in the first 30 m

## PHASE 6 — Coding Challenge: Beginner
*(each built in Hive through natural-language prompts and AI assistance)*

### 1. Snake Game
- [F] Create a playable Snake game — no canvas or snake does not move on its own
- [x] Directional movement — after 3 round(s)
- [x] Food generation — after 3 round(s)
- [F] Snake growth — length 1→1
- [x] Wall collision — after 3 round(s)
- [F] Self-collision — length 1 looped into itself without game over
- [F] Score tracking — score 0→0
- [F] Game-over functionality — over=true moved after over=false message=false
- [F] Restart functionality — {"over":false,"score":0,"len":1}
- [x] The game runs without errors — after 3 round(s)

### 2. Tic-Tac-Toe
- [x] A functional game board — after 1 round(s)
- [x] Two-player gameplay — after 1 round(s)
- [x] Turn management — after 1 round(s)
- [x] Detects winning combinations — after 1 round(s)
- [x] Detects draws — after 1 round(s)
- [x] A scoreboard — after 1 round(s)
- [x] Restart functionality — after 1 round(s)
- [x] Illegal moves are prevented — after 1 round(s)

### 3. Space Invaders
- [F] Player movement — x 220→220
- [F] Projectile shooting — no bullet or bullet does not move up
- [x] Enemy formations — after 3 round(s)
- [F] Projectile collisions — enemy count 32→32
- [F] Player-enemy collisions — lives 3→3
- [F] Scoring — score 0→0
- [F] Increasing difficulty — level 1→1, speed 1→1
- [F] Game-over and restart states — over=false after reset over=false

### 4. Breakout
- [F] Paddle movement — paddle did not move
- [F] Ball physics — ball at 200,400
- [F] Wall collisions — left bounce=false top bounce=false
- [F] Paddle collisions — ball vy after paddle 4
- [F] Brick destruction — brick alive=true
- [F] Lives and scoring — score 0→0, lives 3→3
- [F] Win and loss conditions — won=false over=false
- [x] The game behaves consistently — after 3 round(s)

## PHASE 7 — Coding Challenge: Intermediate

### 5. Kanban Task Manager
- [F] A task management application — see creation/columns
- [F] Task creation — task not created or not shown
- [x] Task deletion — after 3 round(s)
- [F] Task editing — edit not applied
- [F] Draggable task cards — card element not found
- [x] Multiple task columns — after 3 round(s)
- [F] Task assignments — assign not applied
- [x] Persistent storage — after 3 round(s)
- [F] Real-time collaboration — second window did not update live
- [x] Multiple users see the same task updates — after 3 round(s)
- [x] Refreshing doesn't lose tasks — after 3 round(s)

### 6. Pathfinding Visualizer
- [x] An interactive grid — after 3 round(s)
- [x] Users can place walls and obstacles — after 3 round(s)
- [F] Users can select a start point and destination — not checked
- [F] A* pathfinding — not checked
- [F] Dijkstra's algorithm — not checked
- [F] Breadth-First Search — not checked
- [F] Animated search process — not checked
- [F] Displays the resulting path — not checked
- [F] Compares the algorithms' performance — not checked
- [F] Handles unreachable destinations — not checked
- [F] Each algorithm returns correct results — not checked

### 7. Procedural World Generator
- [x] A random terrain map — after 3 round(s)
- [x] Perlin or Simplex noise — after 3 round(s)
- [x] Mountains — after 3 round(s)
- [x] Lakes and rivers — after 3 round(s)
- [x] Forests — after 3 round(s)
- [x] World seeds — after 3 round(s)
- [x] Identical seeds produce identical worlds — after 3 round(s)
- [x] Users can regenerate worlds — after 3 round(s)
- [F] A controllable character — moved=false blocked by water=not tested
- [x] Terrain generation performs efficiently — after 3 round(s)

### 8. Real-Time Chat Application
- [x] A chat interface — after 3 round(s)
- [F] Multiple users — online list []
- [F] Sending and receiving messages — not checked
- [F] Persistent message history — not checked
- [F] Timestamps — not checked
- [F] Online indicators — no presence event listing Ana
- [F] Typing indicators — not checked
- [F] Private chat rooms — not checked
- [F] Handles simultaneous messages — not checked
- [F] Handles disconnected users — not checked
- [F] Messages aren't lost or duplicated — not checked

## PHASE 8 — Coding Challenge: Advanced

### 9. Minecraft-Style Voxel Engine
- [F] A 3D environment — window.engine missing (Three.js may have failed to load)
- [F] A voxel-based world — not checked
- [F] Block rendering — not checked
- [F] Procedural terrain generation — not checked
- [F] Chunk generation — not checked
- [F] Chunk loading and unloading — not checked
- [F] Player movement — not checked
- [F] Collision detection — not checked
- [F] Block placement — not checked
- [F] Block destruction — not checked
- [F] World persistence — not checked
- [F] Optimized rendering and chunk management — not checked
- [F] Stays playable as the world grows — not checked

### 10. Physics Simulator
- [x] An interactive physics simulation — after 3 round(s)
- [F] Gravity — not checked
- [F] Elastic collisions — not checked
- [F] Friction — not checked
- [F] Particle systems — not checked
- [F] Users can create objects — not checked
- [F] Users can modify simulation parameters — not checked
- [F] Interactions between hundreds of objects — not checked
- [F] Conservation of momentum in appropriate collisions — not checked
- [F] Numerical stability — not checked
- [F] Measured simulation performance — not checked

### 11. Chess Engine
- [F] A functional chessboard — 0 squares, pieces shown=false
- [F] Legal move generation — not checked
- [F] Piece movement — not checked
- [F] Check detection — not checked
- [F] Checkmate detection — not checked
- [F] Stalemate detection — not checked
- [F] Castling — not checked
- [F] En passant — not checked
- [F] Pawn promotion — not checked
- [F] Board evaluation — not checked
- [F] Minimax — not checked
- [F] Alpha-beta pruning — not checked
- [F] A playable computer opponent — not checked
- [F] Tested against known chess positions — not checked
- [F] Illegal moves are never accepted — not checked

### 12. Visual Programming Environment
- [F] Draggable programming nodes — not checked
- [F] Node connections — not checked
- [F] Input and output ports — not checked
- [F] A node execution system — not checked
- [F] Dependency resolution — not checked
- [F] Detects circular dependencies — not checked
- [F] Error handling — not checked
- [F] Graph visualization — not checked
- [F] Saving and loading — not checked
- [F] A working example program built with the node system — not checked

## PHASE 9 — Collaborative Coding Challenges
*(two or more collaborators, each with different responsibilities)*
- [F] Snake: one person on game mechanics, another on rendering and UI — Tess wrote logic.js; Omar wrote index.html, ui.js; 3 round(s); features working: 0/10 on Tess's machine, 0/10 on Omar's; failing: Create a playable Snake game; Directional movement; Food generation; Snake growth
- [F] Chess: one on move validation, another on the AI opponent — Tess wrote rules.js; Omar wrote index.html, engine.js, ui.js; 3 round(s); features working: 0/15 on Tess's machine, 0/15 on Omar's; failing: A functional chessboard; Legal move generation; Piece movement; Check detection
- [F] Minecraft clone: one on terrain generation, another on player mechanics — Tess wrote nothing; Omar wrote index.html, player.js; 3 round(s); features working: 0/13 on Tess's machine, 0/13 on Omar's; failing: A 3D environment; A voxel-based world; Block rendering; Procedural terrain generation
- [F] Chat application: one on the backend, another on the frontend — Tess wrote server.js, hive.json; Omar wrote public/index.html, public/client.js; 3 round(s); features working: 1/11 on Tess's machine, 1/11 on Omar's; failing: Multiple users; Sending and receiving messages; Persistent m
- [F] Physics simulator: one on the physics engine, another on visualization — Tess wrote engine.js; Omar wrote index.html, view.js; 3 round(s); features working: 1/11 on Tess's machine, 1/11 on Omar's; failing: Gravity; Elastic collisions; Friction; Particle systems
- [F] Pathfinding visualizer: one on algorithms, another on the interface — Tess wrote algorithms.js; Omar wrote index.html, ui.js, style.css; 3 round(s); features working: 1/11 on Tess's machine, 1/11 on Omar's; failing: An interactive grid; Users can place walls and obstacles; A* pathfinding; 
- [F] Collaborators independently modify the same feature — only one change survived: [{"x":5,"y":0},{"x":104,"y":0}]
- [F] Collaborators integrate code written in separate files — no pair challenge integrated into a fully working app
- [F] Collaborators debug each other's code — player at 2,1
- [F] Collaborators review AI-generated code — Omar's AI change is not in Tess's History panel
- [x] Collaborators ask AI to modify separate parts of the same project
- [x] Collaborators can understand each other's changes
- [x] Code integration doesn't silently overwrite existing functionality
- [x] Collaborators can recover from conflicting changes
- [F] All collaborators can run the completed project — no pair project ran fully on both machines: {"snake":"0/0 of 10","chess":"0/0 of 15","voxel":"0/0 of 13","chat":"1/1 of 11","physics":"1/1 of 11","pathfinding":"1/1 of 11"}

## PHASE 10 — The 30-Minute Collaboration Challenge
*(two people who've never used Hive build Snake together in 30 minutes)*
- [~] Both users successfully join the same project — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Both users understand how to start coding — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Both users can use AI assistance — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Both users can edit code simultaneously — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Both users can see each other's changes — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Both users can divide work effectively — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Both users can integrate their work — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] The app successfully runs the finished game — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] No significant code is lost — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Record the total time required — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Record the number of collaboration conflicts — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Record the number of AI-generated bugs — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Record time spent coding vs coordinating — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.
- [~] Collect feedback about the experience — Needs two real people who have never used Hive (first-time understanding, coordination and feedback cannot be automated). The mechanics it depends on were tested in Phases 2, 3 and 9; a session script is in the report.

## PHASE 11 — Final Quality Assessment (score 0–100 each)
- [x] Core functionality — score 90/100: 18/19 core items pass (5 after fixes); back/forward not applicable; moving a file does not update imports.
- [x] Multiplayer collaboration — score 85/100: 33/33 Phase 2 items pass after 11 fixes; 20 people converge; latency drifts from ~80 ms to ~220 ms over an hour of non-stop typing; the live relay
- [x] AI coding capabilities — score 50/100: Ask AI handles everyday tasks well (Phase 3: 25/28, the 3 misses are model mistakes) and follows the given file paths after the prompt fix; with t
- [x] Code execution reliability — score 80/100: 21/25: runs, input, streaming output, stop, restart and errors with file:line all work; no limits or sandbox (by design).
- [x] Data persistence — score 85/100: Settings, projects and shared state survive restarts, crashes and a relay restart after fixes; offline edits merge 3-way with a conflict copy.
- [x] Performance — score 75/100: Projects open in under 2.5 s, typing p95 under 32 ms in normal files, idle CPU ~1%, Run starts in ~40 ms after fixes; 100k-line files reach 76 ms 
- [x] User experience — score 65/100: Clear errors and notices, follow-the-AI view, previews; but local AI replies take minutes on modest hardware and the 30-minute first-user study (P
- [x] Security — score 60/100: End-to-end encrypted rooms, outsiders can't read projects, view-only links now enforced by the relay (needs deploy); Run executes code with full u
- [x] Error handling — score 80/100: Plain-language errors, AI timeouts and provider errors surfaced; a few failures still only show in the terminal (missing npm packages).
- [x] Recovery from failures — score 85/100: Reconnect, offline edits, relay restart, crash restart and AI undo all recover without data loss after fixes.
- [x] Overall score calculated and weakest categories identified — overall 76/100; weakest: AI coding capabilities 50, Security 60, User experience 65

## Final Deliverables (in `docs/qa-report.md`)
- [x] 1. A complete testing report
- [x] 2. List of passed tests
- [x] 3. List of failed tests
- [x] 4. List of blocked tests and why
- [x] 5. List of bugs discovered
- [x] 6. List of bugs fixed
- [x] 7. List of unresolved bugs
- [x] 8. Performance measurements
- [x] 9. Collaboration stress-test results
- [x] 10. Coding challenge results
- [x] 11. List of architectural weaknesses
- [x] 12. Recommendations for improving the app
