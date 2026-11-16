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
- [x] All collaborators see the same project files — 4 files identical on all three (on disk after 110 ms)
- [x] Two people edit different files simultaneously
- [x] Two people edit the same file simultaneously
- [x] Two people edit the exact same line simultaneously
- [x] Two people type at the exact same cursor position
- [x] One person deletes code while another edits that code
- [F] One person renames a file while another edits it — old file still on b's disk
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
- [ ] Synchronization with five people editing simultaneously
- [ ] Synchronization with ten people editing simultaneously
- [ ] Synchronization with twenty people joining simultaneously
- [x] Concurrent operations are handled consistently
- [F] Project state stays consistent after a server restart — not converged on a.js: a:doc=83 disk=83 b:doc=83 disk=83 c:doc=49 disk=49

## PHASE 3 — AI / Vibe-Coding Functionality
- [ ] AI creates a simple program from a natural-language prompt
- [ ] AI creates a multi-file project
- [ ] AI modifies an existing function
- [ ] AI adds a feature without changing unrelated functionality
- [ ] AI identifies and fixes a syntax error
- [ ] AI identifies and fixes a logical error
- [ ] AI explains an unfamiliar codebase
- [ ] AI explains a specific function
- [ ] Ambiguous prompt: AI handles uncertainty appropriately
- [ ] Contradictory instructions: AI identifies the contradiction
- [ ] AI refactors poorly structured code
- [ ] AI optimizes a slow algorithm
- [ ] AI writes unit tests
- [ ] AI fixes failing unit tests
- [ ] AI implements a feature across multiple files
- [ ] AI modifies code another collaborator is currently editing
- [ ] Two collaborators send AI requests simultaneously
- [ ] Simultaneous AI requests don't overwrite each other's changes
- [ ] AI-generated changes are synchronized with all collaborators
- [ ] Users can inspect AI-generated changes before accepting them
- [ ] AI doesn't silently remove unrelated functionality
- [ ] Requesting broken code: the app reports execution errors
- [ ] AI references nonexistent files or dependencies: what happens
- [ ] An AI request times out: what happens
- [ ] The AI provider returns an error: what happens
- [ ] Users can recover from unsuccessful AI modifications

## PHASE 4 — Code Execution and Runtime
- [ ] Run a basic Hello World program
- [ ] Run a program that accepts user input
- [ ] Run a program that produces continuous output
- [ ] Run a program with multiple files
- [ ] Run a program with external dependencies
- [ ] Run a program with missing dependencies; the error is understandable
- [ ] Run a program with syntax errors
- [ ] Run a program with runtime errors
- [ ] Run a program that intentionally throws an exception
- [ ] Run a program that uses significant memory
- [ ] Run a program that uses significant CPU
- [ ] Run an infinite loop
- [ ] An infinite loop can be terminated
- [ ] Stopping execution actually releases its resources
- [ ] Run multiple programs simultaneously
- [ ] One user's execution doesn't interfere with another user's
- [ ] Modify code while a previous version is running
- [ ] The running program uses a consistent source version
- [ ] Execution output is displayed correctly
- [ ] Errors include useful file names and line numbers
- [ ] Execution environments don't expose other users' project files
- [ ] Attempts to access unauthorized filesystem locations
- [ ] Attempts to access unauthorized network resources
- [ ] Attempts to escape the execution sandbox
- [ ] Resource limits and execution timeouts

## PHASE 5 — Performance and Stress Testing
- [ ] Open a project with 100 files
- [ ] Open a project with 500 files
- [ ] Open a project with 1,000 files
- [ ] Open a source file with 1,000 lines
- [ ] Open a source file with 10,000 lines
- [ ] Open a very large source file and measure editor responsiveness
- [ ] A project with 50 dependencies
- [ ] A project with hundreds of dependencies
- [ ] A project with deeply nested directories
- [ ] Rapid typing and deletion
- [ ] Rapid switching between files
- [ ] Rapid project navigation
- [ ] Repeated AI requests
- [ ] Repeated project creation and deletion
- [ ] Multiple collaborators continuously editing for 30 minutes
- [ ] Multiple collaborators continuously editing for one hour
- [ ] Measure synchronization latency
- [ ] Measure project loading time
- [ ] Measure editor responsiveness
- [ ] Measure AI response time
- [ ] Monitor memory consumption
- [ ] Monitor CPU consumption
- [ ] Monitor server resource consumption
- [ ] Identify memory leaks
- [ ] Identify unnecessary network requests
- [ ] Identify redundant database operations
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
