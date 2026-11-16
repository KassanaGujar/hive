// Checklist wording → test name, where they differ too much for word matching (used by sync-checklist.mjs).
export const ALIAS = {
  // Phase 1
  "Delete a project; it is removed and can't be opened through its old link": 'Delete a project; it is removed and its old path no longer opens',
  'Create nested folders; the directory structure works': 'Create nested folders',
  'Move files between folders; imports and references still work where applicable': 'Move a file between folders (content kept)',
  'Browser navigation, including back and forward': 'Browser navigation (back / forward)',
  "Unauthorized users can't access private projects": 'Unauthorized users cannot read a private project',
  // Phase 2
  'Invite multiple collaborators simultaneously': 'Invite multiple collaborators (second joins while the first is active)',
  "Simultaneous changes don't silently disappear": 'Simultaneous changes do not silently disappear (300 marked edits from 3 people)',
  'Undo and redo while multiple people are editing': 'Undo/redo while several people edit: undo only removes your own change',
  "Undoing one person's changes doesn't undo another person's unrelated changes": 'Undo/redo while several people edit: undo only removes your own change',
  'Disconnect one collaborator from the internet': 'Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs',
  'Continue editing while that collaborator is disconnected': 'Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs',
  'Reconnect the disconnected collaborator': 'Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs',
  'Their editor synchronizes with the latest project state': 'Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs',
  "Refresh one collaborator's window while everyone else is working": "Refresh one collaborator's window while everyone works; it restores",
  'The refreshed session restores correctly': "Refresh one collaborator's window while everyone works; it restores",
  'A collaborator leaves the project': 'A collaborator leaves; the others keep working; they rejoin with the original link',
  'Remaining collaborators can continue working': 'A collaborator leaves; the others keep working; they rejoin with the original link',
  'Rejoin the project using the original invitation link': 'A collaborator leaves; the others keep working; they rejoin with the original link',
  "Collaborators can't accidentally overwrite the whole project with stale data": 'A stale copy cannot overwrite the project (edited outside Hive while closed)',
  'Project state stays consistent after a server restart': 'Project state survives a relay (server) restart',
  'One person creates a file while another navigates the file explorer': 'One person creates a file while another browses the explorer',
  "Users can tell their own changes from other people's": "Users can tell their own changes from other people's",
  // Phase 4
  'Run a program with missing dependencies; the error is understandable': 'Missing dependency: the error is understandable',
  'Modify code while a previous version is running': 'Modify code while a previous version is running; running program keeps a consistent version',
  'The running program uses a consistent source version': 'Modify code while a previous version is running; running program keeps a consistent version',
  'Run a program with external dependencies': 'Run a program with external dependencies (npm install runs first)',
  // Phase 3
  'Two collaborators send AI requests simultaneously': 'Two collaborators send AI requests simultaneously; they do not overwrite each other',
  "Simultaneous AI requests don't overwrite each other's changes": 'Two collaborators send AI requests simultaneously; they do not overwrite each other',
  // Phase 5
  'Repeated AI requests': 'P3|Repeated AI requests (5 in a row) all answer',
  'Measure AI response time': 'P3|AI response time (measured)',
  'Open a very large source file and measure editor responsiveness': 'Open a very large source file (100,000 lines, 4.5 MB) and measure editor responsiveness',
  'Performance stays acceptable during concurrent use': 'Performance stays acceptable during concurrent use'
}

// app bugs found by a test and fixed (test name → what was wrong); these get [!] once they pass again
export const FIXED = {
  'Rename a project; the new name persists after refresh': 'terminals from a previous project kept the folder locked',
  'Delete a project; it is removed and its old path no longer opens': 'terminals from a previous project kept the folder locked',
  'Project permissions and ownership (viewer cannot change files; host can)': 'view-only links could edit; relay now enforces roles with an edit token',
  'Errors are communicated clearly to users': 'raw system errors (ENOENT …) were shown; now plain sentences',
  'Close and reopen the app; the project is restored': 'a briefly locked settings file made Hive start with empty settings',
  "Collaborators can see each other's cursors": 'cursors were never sent or drawn (editors attached after the binding)',
  'Undo/redo while several people edit: undo only removes your own change': "Ctrl+Z did nothing after a teammate's edit; now a shared undo of your own edits",
  'A stale copy cannot overwrite the project (edited outside Hive while closed)': "an offline copy overwrote the team's newer work; now a 3-way merge",
  'One person deletes a file while another has it open': 'no notice and the tab stayed open; now closed with a notice',
  'Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs': 'background windows were throttled, delaying sync by minutes',
  'One person renames a file while another edits it': "the teammate's in-flight edits were lost and the old file came back on disk",
  'Project state survives a relay (server) restart': 'a stale snapshot could delete entries after a restart; dead connections now detected',
  'AI creates a simple program from a natural-language prompt': 'the AI put files under an invented src/ folder; prompt now keeps the given paths',
  'AI creates a multi-file project': 'the AI put files under an invented src/ folder; prompt now keeps the given paths',
  'AI implements a feature across multiple files': 'the AI put files under an invented src/ folder; prompt now keeps the given paths',
  'An AI request times out': 'a silent provider left Ask AI waiting forever; now 120 s / 60 s timeouts'
}
