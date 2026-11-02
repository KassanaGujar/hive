import type { AgentTask } from '@hive/shared'

export function architectPlanPrompt(goal: string, fileList: string, workerNames: string[]): string {
  return `You are the Architect of a small AI coding team. Break the goal into a short plan of concrete
coding tasks that smaller worker models can each finish alone in one sitting.

Goal: ${goal}

Existing project files (may be empty):
${fileList || '(empty project)'}

Workers available: ${workerNames.join(', ')}

Rules:
- 1 to 6 tasks. Fewer is better for small projects.
- Give each task the files it creates or edits. Avoid two tasks editing the same file.
- Use dependsOn (task ids) so a task that needs another's files runs after it.
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
