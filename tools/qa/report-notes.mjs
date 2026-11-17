// Hand-written analysis for the QA report (tools/qa/report.mjs). Keep it factual and tied to recorded tests.
export const NOTES = {
  machine: 'Windows 11, 12 logical CPUs, Ollama with qwen2.5-coder:7b (local). The CPU was often near 100% from OneDrive, Explorer and other Claude sessions, so timings are pessimistic.',
  summary: 'Every item of the plan was either run against the real app (real Electron windows driven over the DevTools protocol, a real relay, real local AI) or marked blocked with a reason. Failures were root-caused; app bugs were fixed and the tests re-run. Remaining failures are listed with their causes.',
  blocked: [
    { name: 'Phase 10 — 30-minute challenge with two first-time users', why: 'Needs two real people who have never used Hive; an automated script cannot measure first-time understanding, coordination or give feedback. A script for the session is in the recommendations.' }
  ],
  bugs: [
    {"bug":"After closing one project and opening another, files with the same path (README.md, index.html) reused the old project's editor document: the old text could show and edits synced into the old project's session","foundBy":"P9 general checks (History empty after several projects)","severity":"Critical (data integrity)","fixed":true,"fix":"Every file document is disposed when a project is closed or another is opened."},
    {"bug":"History recorded your edit as nothing (its \"before\" text already contained the edit) and could attribute a teammate's simultaneous change to you","foundBy":"P9 general checks","severity":"High (collaboration clarity)","fixed":true,"fix":"Each file's last text is tracked; your pending entry is recorded up to the moment a teammate's change arrives."},
    {"bug":"After switching between shared projects three times, each edit appeared twice in History","foundBy":"P9 investigation","severity":"Low (cosmetic)","fixed":false,"fix":"Not root-caused yet; entries are duplicated, not lost or misattributed."},
    {"bug":"Local Ollama models silently ran with a 4,096-token context: prompts with project files were cut from the start (Hive's instructions and the request lost) and long replies stalled","foundBy":"P7 challenges (replies cut off), confirmed with ollama ps","severity":"High (AI quality on real projects)","fixed":true,"fix":"Local models use Ollama's native API with a 16k context (capped at the model's maximum); a secret-word test confirmed the instructions survive a long prompt."},
    {"bug":"Ask AI ignored files labelled \"html index.html\" or named in a heading before the code","foundBy":"P6 challenges (AI wrote no files)","severity":"Medium","fixed":true,"fix":"Shared proposal parser understands the common labelling styles (unit-tested)."},
    {"bug":"A busy Ollama made Hive report an installed model as \"not installed\"","foundBy":"P6 challenges","severity":"Medium","fixed":true,"fix":"Last good model list kept (also across restarts); lookup retried with a longer wait."},
    {"bug":"Re-saving the whole shared state on every file write slowed long sessions (median sync latency 43 ms to 616 ms after an hour)","foundBy":"P5 one-hour soak","severity":"High (performance)","fixed":true,"fix":"State and sync record saved together on the normal debounce (one-hour median 226 ms after the fix)."},
    { bug: 'Switching projects took ~5 s (waited for old terminals to exit)', foundBy: 'P5 rapid project navigation', severity: 'Medium', fixed: true, fix: 'Only renaming/deleting waits for terminals; switching kills them and moves on (15 switches: 76 s → 11 s).' },
    { bug: 'Renaming or deleting a project failed: its terminal and Run process kept running in the old folder (and leaked)', foundBy: 'P1 rename/delete project', severity: 'High', fixed: true, fix: 'Leaving, renaming or deleting a project now ends its terminals and Run process first; terminal panel restarts per project.' },
    { bug: 'View-only invite links could edit; any viewer could replace the room history', foundBy: 'P1 permissions', severity: 'Critical (security)', fixed: true, fix: 'Edit links carry an edit token whose hash the relay stores; the relay decides roles and refuses viewer edits and snapshots. Needs `wrangler deploy` for the live relay.' },
    { bug: 'Settings looked wiped (setup wizard again, recent projects gone) when Hive was reopened quickly', foundBy: 'P1 close & reopen', severity: 'High', fixed: true, fix: 'A briefly locked database is retried instead of silently switching to an empty store; a dialog appears if it stays locked.' },
    { bug: 'Raw system errors (ENOENT …, full paths) shown to users', foundBy: 'P1 error messages', severity: 'Medium', fixed: true, fix: 'Errors are translated into plain sentences with project-relative paths.' },
    { bug: 'A minimised or background Hive synced minutes late (Chromium timer throttling)', foundBy: 'P2 three-window runs', severity: 'High', fixed: true, fix: 'backgroundThrottling disabled for the main window.' },
    { bug: "Teammates' cursors were never sent or drawn", foundBy: 'P2 cursors', severity: 'Medium', fixed: true, fix: 'Cursor broadcasting and drawing wired when an editor attaches (y-monaco only did it for editors present at creation).' },
    { bug: "Ctrl+Z after a teammate's edit did nothing", foundBy: 'P2 undo', severity: 'High', fixed: true, fix: 'Shared files use a Y.UndoManager that undoes only your own edits; menu, shortcut and command undo all route to it.' },
    { bug: "Renaming a file lost a teammate's in-flight edits; the old file reappeared on disk", foundBy: 'P2 rename while editing', severity: 'High (data loss)', fixed: true, fix: 'Rename keeps the old shared text for 10 s and carries late edits over; editors follow the rename; old file never rewritten.' },
    { bug: "A file edited outside Hive while closed overwrote the team's newer work on rejoin", foundBy: 'P2 stale copy', severity: 'Critical (data loss)', fixed: true, fix: '3-way merge against the last-synced text; real conflicts keep both versions (offline copy saved alongside).' },
    { bug: 'False "offline conflict" after a crash (merge base saved later than the sync record)', foundBy: 'P2 stale copy (intermittent)', severity: 'Medium', fixed: true, fix: 'Local state is saved together with the sync record.' },
    { bug: 'Deleting a file gave a teammate who had it open no notice', foundBy: 'P2 delete while open', severity: 'Low', fixed: true, fix: 'The tab closes with a notice.' },
    { bug: 'A late file-watcher echo of Hive\'s own write could overwrite newer edits', foundBy: 'P2 under load', severity: 'High (data loss)', fixed: true, fix: 'Recent write hashes are remembered; echoes are ignored.' },
    { bug: 'After a relay restart a client could stay "online" on stale text', foundBy: 'P2 relay restart (intermittent)', severity: 'High', fixed: true, fix: 'Client resets its counter on rejoin; relay rejects snapshots covering entries it never had and saves within 250 ms; 60 s silence forces a reconnect.' },
    { bug: 'Tool lookups (where.exe) froze the main process for up to 4 s, stalling every window', foundBy: 'P2 event-loop monitor', severity: 'Medium', fixed: true, fix: 'Lookups are asynchronous and cached; slow IPC and event-loop stalls are logged.' },
    { bug: 'Accepting an AI suggestion overwrote edits made after the AI read the file', foundBy: 'P3 code review + tests', severity: 'High (data loss)', fixed: true, fix: 'Accept applies only the AI\'s changes on top of the current file (3-way merge); refuses when both changed the same lines.' },
    { bug: 'Ask AI saved files under invented folders (src/…) instead of the name asked for', foundBy: 'P3 create program', severity: 'Medium', fixed: true, fix: 'System prompt: use exactly the given paths, keep untouched code, ask when vague, flag contradictions.' },
    { bug: 'A provider that never answered left Ask AI waiting forever', foundBy: 'P3 timeout', severity: 'Medium', fixed: true, fix: '120 s first-token and 60 s stall timeouts with a clear message.' },
    { bug: 'Run has no sandbox, resource limits or timeout: programs can read any file, use the network and start processes as the user', foundBy: 'P4 sandbox tests', severity: 'By design (local IDE)', fixed: false, fix: 'Same model as VS Code; recommendation below.' },
    { bug: 'Under 100% CPU, three windows reloading at once sometimes left a renderer unresponsive', foundBy: 'P2 harness', severity: 'Low (not reproduced under normal load)', fixed: false, fix: 'Not root-caused; main process stayed responsive. Harness avoids simultaneous reloads.' }
  ],
  performanceNotes: 'Numbers were taken on a heavily loaded machine (CPU often 90–100% from OneDrive, Explorer and other apps); on an idle PC expect them to be lower. Search over 1,000 files took 0.6–1.1 s on files already read once, but up to 14–19 s right after the 1,000 test files were created, which matches Windows Defender scanning each new file on first read (the full-tree hash that ran straight after over the same files took 0.6 s). Typing in a 100,000-line (4.5 MB) file stays usable (p50 ~11 ms) but its slowest 5% of keystrokes take ~76 ms, above the 50 ms target, even with the minimap, folding and bracket colouring turned off for such files. AI responses with the local 7B model took a median of 53 s per request (max 231 s) on this CPU.',
  collabNotes: 'Convergence was checked on every client by comparing both the shared document and the file on disk.',
  challengeNotes: 'Each challenge was built only through Hive\'s Ask AI with the local qwen2.5-coder:7b model; failing features were fed back to the AI for up to four rounds, like a user would. Results reflect a 7B local model; a larger or hosted model would do better.',
  weaknesses: [
    'Ask AI sees only the open file; it has no project-wide context or code search, so multi-file work depends on the user pasting context.',
    'Run executes code with the user\'s full rights and no time or memory limits (fine for a local IDE, but there is no isolation option).',
    'The whole shared document is re-encoded and rewritten to `.hive/state.b64` after edits, which grows with project size.',
    'Rooms are capped at 25 people and the relay keeps the full update log in memory per room.',
    'The live Cloudflare relay runs older code until it is redeployed.'
  ],
  recommendations: [
    'Deploy the updated relay (`cd services/relay-cf && npx wrangler deploy`) so view-only links and the 25-person cap apply on the live service.',
    'Give Ask AI project context (file list + search + selected files) and a "files touched" summary on each proposal.',
    'Add an optional Run sandbox: time limit, memory limit, and a "no network" toggle (e.g. a job object on Windows).',
    'Save shared state incrementally (append updates, compact occasionally) instead of rewriting the whole state file.',
    'Run Phase 10 with two real first-time users and record the measurements listed in the plan.',
    'Keep the QA harness (`tools/qa`) in CI for Phases 1, 2 and 4, which need no AI model.'
  ],
  scores: [
    {
      "category": "Core functionality",
      "score": 90,
      "why": "18/19 core items pass (5 after fixes); back/forward not applicable; moving a file does not update imports."
    },
    {
      "category": "Multiplayer collaboration",
      "score": 85,
      "why": "33/33 Phase 2 items pass after 11 fixes; 20 people converge; latency drifts from ~80 ms to ~220 ms over an hour of non-stop typing; the live relay still needs redeploying."
    },
    {
      "category": "AI coding capabilities",
      "score": 45,
      "why": "Ask AI handles small tasks (Phase 3: 23/26) but the local 7B model builds only simple apps (Phase 6: 14/34, Phase 7: 17/43, Phase 8: 1/49 features); Ask AI sees only the open file."
    },
    {
      "category": "Code execution reliability",
      "score": 80,
      "why": "21/25: runs, input, streaming output, stop, restart and errors with file:line all work; no limits or sandbox (by design)."
    },
    {
      "category": "Data persistence",
      "score": 85,
      "why": "Settings, projects and shared state survive restarts, crashes and a relay restart after fixes; offline edits merge 3-way with a conflict copy."
    },
    {
      "category": "Performance",
      "score": 75,
      "why": "Projects open in under 2.5 s, typing p95 under 32 ms for normal files, idle CPU ~1%; 100k-line files reach 76 ms p95; local AI is slow on this PC (~15 prompt tokens/s)."
    },
    {
      "category": "User experience",
      "score": 65,
      "why": "Clear errors and notices, follow-the-AI view, previews; but local AI replies take minutes on modest hardware and the 30-minute first-user study (Phase 10) is still to be run."
    },
    {
      "category": "Security",
      "score": 60,
      "why": "End-to-end encrypted rooms, outsiders can't read projects, view-only links now enforced by the relay (needs deploy); Run executes code with full user rights."
    },
    {
      "category": "Error handling",
      "score": 80,
      "why": "Plain-language errors, AI timeouts and provider errors surfaced; a few failures still only show in the terminal (missing npm packages)."
    },
    {
      "category": "Recovery from failures",
      "score": 85,
      "why": "Reconnect, offline edits, relay restart, crash restart and AI undo all recover without data loss after fixes."
    }
  ]
}
