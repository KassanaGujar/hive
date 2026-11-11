import type { AgentTask } from '@hive/shared'

export function architectPlanPrompt(goal: string, fileList: string, workerNames: string[]): string {
  return `You are the Architect of a small AI coding team. Break the goal into a short plan of concrete
coding tasks that smaller worker models can each finish alone in one sitting.

Goal: ${goal}

Existing project files (may be empty):
${fileList || '(empty project)'}

Workers available: ${workerNames.join(', ')}

Rules:
- 1 to 6 tasks. Fewer is better for small projects. Each task owns different files.
- Workers run AT THE SAME TIME, so make tasks independent: leave dependsOn empty unless a task truly
  cannot be written without another task's finished file.
- Agree the shared contract up front and repeat it in EVERY task description: file names, element ids,
  function names, how files include each other (e.g. index.html loads style.css and game.js; canvas id "game").
- Use each worker at most once if there are enough tasks.
- Write acceptance as one sentence a reviewer can check by reading the diff.
- Keep it simple and runnable: prefer plain HTML/CSS/JS or the language already used.

Reply with ONLY JSON in this shape:
{"summary": "one sentence", "tasks": [
  {"id": "short-id", "title": "...", "description": "what to build, in detail", "files": ["path"],
   "dependsOn": [], "owner": "${workerNames[0] ?? 'worker'}", "acceptance": "..."}
]}`
}

export function workerSystemPrompt(task: AgentTask, fileList: string, notes?: string): string {
  return `You are a coding agent working alone inside a git worktree (your current folder). Use the tools to
read, write and run code. All paths are relative to your folder.

Task: ${task.title}
Details: ${task.description}
Files you own: ${task.files.join(', ') || '(choose sensible files)'}
Acceptance: ${task.acceptance ?? 'the task is fully done and the code runs'}
${notes ? `\nReviewer notes from the last round — fix these:\n${notes}\n` : ''}
Project files right now:
${fileList || '(empty)'}

Work step by step: look at what exists, write complete files (no placeholders or TODOs), then call
report_done with a one-paragraph summary. Do not ask questions; make reasonable choices.`
}

export function leadReviewPrompt(task: AgentTask, diff: string): string {
  return `You are a Lead reviewer. Review this diff for the task below. Approve if it does what the task asks,
is complete (no placeholders) and has no obvious bugs. Otherwise list concrete fixes.

Task: ${task.title}
Details: ${task.description}
Acceptance: ${task.acceptance ?? 'task is done'}

Diff:
${diff.slice(0, 24000) || '(no changes)'}

Reply with ONLY JSON: {"approved": true|false, "notes": "what to fix, or a short approval note"}`
}

export function plannerPrompt(doc: string, messages: string): string {
  return `You maintain a team's living plan document. Read the new chat messages and propose edits to the
plan. Each item must cite the message id(s) it came from. Record every distinct idea once; skip chit-chat.

Current plan (JSON):
${doc}

New chat messages (id: author: text):
${messages}

Reply with ONLY JSON:
{"edits": [
  {"section": "goal|features|decisions|questions|tasks|who",
   "op": "add|update|remove", "itemId": "existing id for update/remove",
   "text": "...", "owner": "name (tasks only)", "status": "todo|doing|done (tasks only)",
   "sources": ["message id", ...]}
]}`
}

/** PRD/MVP pass: turn the team's chat into a goal and a short buildable task list. */
export function mvpPrompt(chat: string, features: string[]): string {
  return `Turn this team discussion into the MVP for a small app.

Team chat:
${chat}

Features noted so far:
${features.map((f) => `- ${f}`).join('\n') || '(none)'}

Reply with ONLY JSON:
{"goal": "one sentence: what we are building and for whom",
 "tasks": ["3 to 5 concrete build tasks, each a short imperative sentence"]}`
}
