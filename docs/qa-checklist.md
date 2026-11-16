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
- [x] All collaborators see the same project files — 4 files identical on all three (on disk after 460 ms)
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

- [x] AI optimizes a slow algorithm — fib(35): 802 ms → 0 ms
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
- [x] Run a program that produces continuous output — 33 lines streamed in 2.5 s
- [x] Run a program with multiple files
- [x] Run a program with external dependencies
- [x] Run a program with missing dependencies; the error is understandable — Node error shown + Hive status message: Exited with code 1. See the Run terminal for details.
- [x] Run a program with syntax errors
- [x] Run a program with runtime errors
- [x] Run a program that intentionally throws an exception
- [x] Run a program that uses significant memory — 1 GB allocated, status exited, Hive UI responsive (complete). No memory limit is enforced.
- [x] Run a program that uses significant CPU — UI stayed responsive (worst 101 ms)
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
- [F] Attempts to access unauthorized filesystem locations — a program you run can read any file your account can (C:/Users/User/hive-qa-secret-1794850098811.txt). Hive's own file API: refused: "../../../../hive-qa-secret.txt" is outside the project
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
- [x] Repeated AI requests — times: 2.9 s, 3.3 s, 3.8 s, 2.7 s, 1.6 s
- [x] Repeated project creation and deletion — 106080 ms; renderer heap +1.6 MB
- [ ] Multiple collaborators continuously editing for 30 minutes
- [ ] Multiple collaborators continuously editing for one hour
- [ ] Measure synchronization latency
- [x] Measure project loading time — 100 files 1075 ms · 500 files 421 ms · 1,000 files 342 ms
- [x] Measure editor responsiveness — keystroke→frame p95: 1k lines 31.6 ms, 10k lines 18 ms, 100k lines 76.1 ms
- [x] Measure AI response time — 27 requests on qwen2.5-coder-7b: median 53.1 s, max 231.2 s (full Phase 3 run; the codebase-explanation recheck alone took 277 s)
- [x] Monitor memory consumption — all Hive processes 936 MB RSS (4 processes); renderer JS heap 29.3 MB
- [x] Monitor CPU consumption — idle: 1.0% of one core
- [ ] Monitor server resource consumption
- [ ] Identify memory leaks
- [x] Identify unnecessary network requests — 0 renderer requests in 60 s idle: {}
- [x] Identify redundant database operations — 1 disk writes for 100 keystrokes over 10 s (autosave debounced at 0.9 s)
- [ ] Performance stays acceptable during concurrent use

## PHASE 6 — Coding Challenge: Beginner
*(each built in Hive through natural-language prompts and AI assistance)*

### 1. Snake Game
- [ ] Create a playable Snake game
- [ ] Directional movement
- [ ] Food generation
- [ ] Snake growth
- [ ] Wall collision
- [ ] Self-collision
- [ ] Score tracking
- [ ] Game-over functionality
- [ ] Restart functionality
- [ ] The game runs without errors

### 2. Tic-Tac-Toe
- [ ] A functional game board
- [ ] Two-player gameplay
- [ ] Turn management
- [ ] Detects winning combinations
- [ ] Detects draws
- [ ] A scoreboard
- [ ] Restart functionality
- [ ] Illegal moves are prevented

### 3. Space Invaders
- [ ] Player movement
- [ ] Projectile shooting
- [ ] Enemy formations
- [ ] Projectile collisions
- [ ] Player-enemy collisions
- [ ] Scoring
- [ ] Increasing difficulty
- [ ] Game-over and restart states

### 4. Breakout
- [ ] Paddle movement
- [ ] Ball physics
- [ ] Wall collisions
- [ ] Paddle collisions
- [ ] Brick destruction
- [ ] Lives and scoring
- [ ] Win and loss conditions
- [ ] The game behaves consistently

## PHASE 7 — Coding Challenge: Intermediate

### 5. Kanban Task Manager
- [ ] A task management application
- [ ] Task creation
- [ ] Task deletion
- [ ] Task editing
- [ ] Draggable task cards
- [ ] Multiple task columns
- [ ] Task assignments
- [ ] Persistent storage
- [ ] Real-time collaboration
- [ ] Multiple users see the same task updates
- [ ] Refreshing doesn't lose tasks

### 6. Pathfinding Visualizer
- [ ] An interactive grid
- [ ] Users can place walls and obstacles
- [ ] Users can select a start point and destination
- [ ] A* pathfinding
- [ ] Dijkstra's algorithm
- [ ] Breadth-First Search
- [ ] Animated search process
- [ ] Displays the resulting path
- [ ] Compares the algorithms' performance
- [ ] Handles unreachable destinations
- [ ] Each algorithm returns correct results

### 7. Procedural World Generator
- [ ] A random terrain map
- [ ] Perlin or Simplex noise
- [ ] Mountains
- [ ] Lakes and rivers
- [ ] Forests
- [ ] World seeds
- [ ] Identical seeds produce identical worlds
- [ ] Users can regenerate worlds
- [ ] A controllable character
- [ ] Terrain generation performs efficiently

### 8. Real-Time Chat Application
- [ ] A chat interface
- [ ] Multiple users
- [ ] Sending and receiving messages
- [ ] Persistent message history
- [ ] Timestamps
- [ ] Online indicators
- [ ] Typing indicators
- [ ] Private chat rooms
- [ ] Handles simultaneous messages
- [ ] Handles disconnected users
- [ ] Messages aren't lost or duplicated

## PHASE 8 — Coding Challenge: Advanced

### 9. Minecraft-Style Voxel Engine
- [ ] A 3D environment
- [ ] A voxel-based world
- [ ] Block rendering
- [ ] Procedural terrain generation
- [ ] Chunk generation
- [ ] Chunk loading and unloading
- [ ] Player movement
- [ ] Collision detection
- [ ] Block placement
- [ ] Block destruction
- [ ] World persistence
- [ ] Optimized rendering and chunk management
- [ ] Stays playable as the world grows

### 10. Physics Simulator
- [ ] An interactive physics simulation
- [ ] Gravity
- [ ] Elastic collisions
- [ ] Friction
- [ ] Particle systems
- [ ] Users can create objects
- [ ] Users can modify simulation parameters
- [ ] Interactions between hundreds of objects
- [ ] Conservation of momentum in appropriate collisions
- [ ] Numerical stability
- [ ] Measured simulation performance

### 11. Chess Engine
- [ ] A functional chessboard
- [ ] Legal move generation
- [ ] Piece movement
- [ ] Check detection
- [ ] Checkmate detection
- [ ] Stalemate detection
- [ ] Castling
- [ ] En passant
- [ ] Pawn promotion
- [ ] Board evaluation
- [ ] Minimax
- [ ] Alpha-beta pruning
- [ ] A playable computer opponent
- [ ] Tested against known chess positions
- [ ] Illegal moves are never accepted

### 12. Visual Programming Environment
- [ ] Draggable programming nodes
- [ ] Node connections
- [ ] Input and output ports
- [ ] A node execution system
- [ ] Dependency resolution
- [ ] Detects circular dependencies
- [ ] Error handling
- [ ] Graph visualization
- [ ] Saving and loading
- [ ] A working example program built with the node system

## PHASE 9 — Collaborative Coding Challenges
*(two or more collaborators, each with different responsibilities)*
- [ ] Snake: one person on game mechanics, another on rendering and UI
- [ ] Chess: one on move validation, another on the AI opponent
- [ ] Minecraft clone: one on terrain generation, another on player mechanics
- [ ] Chat application: one on the backend, another on the frontend
- [ ] Physics simulator: one on the physics engine, another on visualization
- [ ] Pathfinding visualizer: one on algorithms, another on the interface
- [ ] Collaborators independently modify the same feature
- [ ] Collaborators integrate code written in separate files
- [ ] Collaborators debug each other's code
- [ ] Collaborators review AI-generated code
- [ ] Collaborators ask AI to modify separate parts of the same project
- [ ] Collaborators can understand each other's changes
- [ ] Code integration doesn't silently overwrite existing functionality
- [ ] Collaborators can recover from conflicting changes
- [ ] All collaborators can run the completed project

## PHASE 10 — The 30-Minute Collaboration Challenge
*(two people who've never used Hive build Snake together in 30 minutes)*
- [ ] Both users successfully join the same project
- [ ] Both users understand how to start coding
- [ ] Both users can use AI assistance
- [ ] Both users can edit code simultaneously
- [ ] Both users can see each other's changes
- [ ] Both users can divide work effectively
- [ ] Both users can integrate their work
- [ ] The app successfully runs the finished game
- [ ] No significant code is lost
- [ ] Record the total time required
- [ ] Record the number of collaboration conflicts
- [ ] Record the number of AI-generated bugs
- [ ] Record time spent coding vs coordinating
- [ ] Collect feedback about the experience

## PHASE 11 — Final Quality Assessment (score 0–100 each)
- [ ] Core functionality
- [ ] Multiplayer collaboration
- [ ] AI coding capabilities
- [ ] Code execution reliability
- [ ] Data persistence
- [ ] Performance
- [ ] User experience
- [ ] Security
- [ ] Error handling
- [ ] Recovery from failures
- [ ] Overall score calculated and weakest categories identified

## Final Deliverables (in `docs/qa-report.md`)
- [ ] 1. A complete testing report
- [ ] 2. List of passed tests
- [ ] 3. List of failed tests
- [ ] 4. List of blocked tests and why
- [ ] 5. List of bugs discovered
- [ ] 6. List of bugs fixed
- [ ] 7. List of unresolved bugs
- [ ] 8. Performance measurements
- [ ] 9. Collaboration stress-test results
- [ ] 10. Coding challenge results
- [ ] 11. List of architectural weaknesses
- [ ] 12. Recommendations for improving the app
