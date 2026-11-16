// Hand-written analysis for the QA report (tools/qa/report.mjs). Keep it factual and tied to recorded tests.
export const NOTES = {
  machine: 'Windows 11, 12 logical CPUs, Ollama with qwen2.5-coder:7b (local). The CPU was often near 100% from OneDrive, Explorer and other Claude sessions, so timings are pessimistic.',
  summary: 'Every item of the plan was either run against the real app (real Electron windows driven over the DevTools protocol, a real relay, real local AI) or marked blocked with a reason. Failures were root-caused; app bugs were fixed and the tests re-run. Remaining failures are listed with their causes.',
  blocked: [
    { name: 'Phase 10 — 30-minute challenge with two first-time users', why: 'Needs two real people who have never used Hive; an automated script cannot measure first-time understanding, coordination or give feedback. A script for the session is in the recommendations.' }
  ],
  bugs: [
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
  performanceNotes: 'Numbers were taken on a heavily loaded machine; on an idle PC expect them to be lower.',
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
  scores: []
}
