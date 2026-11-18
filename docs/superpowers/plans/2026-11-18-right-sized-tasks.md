# Right-Sized Tasks for the AI Team: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every AI-team task is sized to what the model doing it can actually handle: big jobs go to strong models or get split, small models get narrow jobs with only the context they need.

**Architecture:** Two new pure functions: a model *capacity* profile (`packages/models/src/capacity.ts`) and a task *size* estimate (`packages/agents/src/sizing.ts`). The plan pipeline (`scheduler.ts`) uses them to split oversized tasks, and the scheduler loop (`Orchestrator.pump`) uses them to route each task to the cheapest free model that fits. Workers get an `edit_file` tool and a context budget, so they don't have to re-send whole files. Outcomes are recorded per model and tighten its capacity over time.

**Tech Stack:** TypeScript, Electron main process, vitest, the existing `@hive/models` / `@hive/agents` / `@hive/shared` packages.

**Spec:** this conversation (2026-11-18) plus the findings below. No separate spec doc.

## Why: what the code does today (verified 2026-11-18)

1. **Routing ignores fit.** `pump()` (`packages/agents/src/orchestrator.ts:209`) gives a ready task to the task's owner or *any* free worker. The worker pool is built once from `team.workers` (`orchestrator.ts:127`), so the strongest models never work on tasks themselves. They only step in after 3 failed review rounds (`orchestrator.ts:300`).
2. **The architect is pushed toward big tasks.** `architectPlanPrompt` says "1 to 6 tasks. Fewer is better" and knows nothing about the workers' limits (`prompts.ts`).
3. **Planned tasks get merged into bigger ones.** `enforceFileOwnership` folds any task that shares a file into the file's owner (`scheduler.ts:120`). This produced the free-hosted Visual run's "Implement core graph logic…; Implement DOM rendering, dragging, and wiring", two big jobs in one task.
4. **Workers must re-send whole files.** The only write tool is `write_file` with full content (`tools.ts:17`). A 600-line game.js is one huge reply, beyond what a 3–7B model writes reliably and beyond Groq Qwen3.8's 1,000 output tokens a minute.
5. **The context sent is fixed, not budgeted.** The worker prompt always includes the whole file list, up to 6 owned files × 6,000 chars, and 3,000 chars of the plan document (PRD) (`orchestrator.ts:332`). The lead review always sends up to 24,000 chars of diff (`prompts.ts`). Neither is sized to the model, which is why Groq's 7,000-input-tokens-a-minute cap refused the reviews and integration rounds.
6. **Some limits are guesses.** `contextTokens` defaults to 8,192 when unknown. Hosted per-minute caps are not modelled at all, only learned the hard way from a 413.

## Global Constraints

- Repo `C:\dev\hive`; never in OneDrive. Tests: `npx vitest run` in each package; typecheck: `npx tsc --noEmit -p .` in `apps/desktop`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new npm dependencies.
- Don't download or delete models without asking the user. One Ollama job at a time.
- Hosted free quotas are scarce. Unit tests use fake models and the local SSE test server, never real providers.
- Existing behaviour stays the default when nothing is known: a model with no capacity data and a task with no size estimate route exactly as today.
- Router decisions are logged in plain words, e.g. `Router: "Game logic" (large, ~3,200 tokens to write) → bee (gpt-oss 120B)`.

## Review Focus

1. **Only one model installed.** It plays every role. Routing must never wait forever for a "capable" worker. If nothing fits even after splitting, run on the best model anyway and log why. (Test in Task 5.)
2. **Planner output with no files or empty descriptions.** The size estimate falls back to "medium" and nothing crashes. (Test in Task 2.)
3. **The architect's re-split is invalid JSON or still oversized.** At most one re-plan round, then a deterministic split; the plan is capped at 12 tasks. (Test in Task 4.)
4. **Sequential same-file parts where part 1 fails.** Part 2 is cancelled through the existing `starvedTasks` path, and integration can still create the file. (Test in Task 4.)
5. **A model whose learned cap is tiny (Qwen3.8: 1,000 output tokens a minute).** It still gets small jobs but never a whole-file write it can't finish. (Test in Task 5.)

---

### Task 1: Model capacity profile

**Files:**
- Create: `packages/models/src/capacity.ts`
- Modify: `packages/models/src/index.ts` (export), `packages/shared/src/types.ts` (add optional `limits` to `InstalledModel`), `catalog/catalog.json` (add `limits` for Groq entries), `apps/desktop/src/main/models.ts` (copy `limits` from the catalog onto installed models)
- Test: `packages/models/src/capacity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/types.ts
  interface ModelLimits { inputPerMinute?: number; outputPerMinute?: number; maxOutput?: number }
  interface InstalledModel { /* … */ limits?: ModelLimits }
  // models/capacity.ts
  interface ModelCapacity { contextTokens: number; maxOutput: number; inputPerMinute: number; outputPerMinute: number; skill: number }
  function capacityOf(m: InstalledModel, learned?: Partial<ModelLimits>): ModelCapacity
  function limitsFromError(msg: string): Partial<ModelLimits> | null
  ```

**Rules `capacityOf` implements (values decided here):**
- `contextTokens`:
  - Ollama: `min(m.contextTokens || 8192, 16384)`, the same cap as `endpointFor` in `models.ts:211`.
  - Hosted: `m.contextTokens`.
- `maxOutput`: the first of these that applies:
  - learned or catalog `maxOutput`;
  - Ollama by size: `sizeGB < 3` → 1500, `< 6` → 3000, otherwise 6144;
  - hosted: 6144 (`AGENT_MAX_REPLY_TOKENS`).
  - Then clamp to `outputPerMinute` when that is set.
- Per-minute values default to `Infinity`.
- `skill` = `codingScore`.
- Learned values win over catalog values, and catalog values win over defaults.

`limitsFromError` parses the provider's own numbers. For example, `"output tokens per minute (OTPM): Limit 1000"` gives `{ outputPerMinute: 1000 }` and `"input tokens per minute (ITPM): Limit 7000"` gives `{ inputPerMinute: 7000 }`.

- [ ] **Step 1: Write failing tests** `capacity.test.ts`:
  - `capacityOf(ollama 2GB model).maxOutput === 1500`
  - `capacityOf(ollama ctx 32768).contextTokens === 16384`
  - Groq Qwen3.8 with `limits {outputPerMinute:1000, inputPerMinute:7000}` → `maxOutput === 1000`
  - a learned limit overrides the catalog one
  - `limitsFromError` on the two real Groq messages above returns the numbers; on `"boom"` it returns `null`
- [ ] **Step 2: Run** `npx vitest run src/capacity.test.ts` in `packages/models`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `capacity.ts`. Add the `limits` field. Add catalog limits:
  - `groq-qwen3.8-27b`: `{inputPerMinute:7000, outputPerMinute:1000}`
  - `groq-gpt-oss-120b` and `groq-gpt-oss-20b`: `{inputPerMinute:8000}`

  Copy `limits` in `installedModels`.
- [ ] **Step 4: Run** the models tests (all 24+ pass) and the desktop `tsc`.
- [ ] **Step 5: Commit** `models: capacity profile per model (context, reply size, per-minute caps)`.

### Task 2: Task size estimate

**Files:**
- Create: `packages/agents/src/sizing.ts`
- Test: `packages/agents/src/sizing.test.ts`

**Interfaces:**
- Consumes: `PlanTask` from `@hive/shared`.
- Produces:
  ```ts
  type SizeClass = 'small' | 'medium' | 'large'
  interface TaskSize { outputTokens: number; inputTokens: number; parts: number; hard: number; size: SizeClass }
  function estimateTask(t: PlanTask, existing: Record<string, number> /* path → chars */, extraContextChars?: number): TaskSize
  function fits(size: TaskSize, cap: ModelCapacity): boolean
  ```

**Rules (values decided here; tune in Task 9 only from measured runs):**
- `outputTokens` is the sum over files, plus 120 per named function. Per file:
  - new `.html` = 500, `.css` = 450, `.js`/`.ts`/`.py` = 400 base;
  - existing file = `chars / 4` (it gets rewritten or edited).
- Named functions are the distinct `name(` identifiers in the description, counting `window.x.method(` mentions too.
- `parts`: how many numbered items (`1.`, `2.`…) or `; `-separated titles the task carries; at least 1.
- `hard`: how many of these words appear: `engine|physics|collision|pathfind|a\*|dijkstra|minimax|chess|topolog|websocket|server|3d|three|voxel|noise|parser|undo|sync`.
- `inputTokens` = (prompt base 900 + existing owned files' chars + `extraContextChars`) / 4.
- `size`:
  - `large` if `outputTokens > 2500`, or `parts > 1`, or `hard >= 2`;
  - `small` if `outputTokens <= 900` and `hard === 0`;
  - otherwise `medium`.
- `fits` is true when:
  - `outputTokens <= cap.maxOutput * 0.8`;
  - `inputTokens + outputTokens <= cap.contextTokens * 0.7`;
  - `inputTokens <= cap.inputPerMinute`;
  - and when `hard >= 2`, also `cap.skill >= 70`.

- [ ] **Step 1: Write failing tests:**
  - a CSS-only task is `small`;
  - the real merged Visual task (copy its description from this plan's "Why" #3) is `large` with `parts === 2`;
  - a chess engine task has `hard >= 2`;
  - a task with `files: []` and description `''` is `medium` and doesn't throw;
  - `fits(large, capacityOf(2GB ollama)) === false`;
  - `fits(small, capacityOf(2GB ollama)) === true`;
  - `fits(any 1,200-output task, qwen3.8 capacity) === false`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** `sizing.ts` (`@hive/agents` already depends on `@hive/models`).
- [ ] **Step 4: Run** the agents tests. All pass.
- [ ] **Step 5: Commit** `agents: estimate each task's size`.

### Task 3: `edit_file` tool (stop re-sending whole files)

**Files:**
- Modify: `packages/agents/src/tools.ts` (spec and `executeTool`), `packages/agents/src/prompts.ts` (worker prompt: when to use it)
- Test: `packages/agents/src/agents.test.ts`

**Interfaces:**
- Produces the tool `edit_file { path, find, replace }`:
  - replaces exactly one occurrence;
  - with no match it returns `Error: text not found in <path>; read_file it and copy the exact text`;
  - with several matches it returns `Error: text appears N times …`.
- It respects `allowedPaths` like `write_file`. It counts as a write for the "said done without writing" check (`orchestrator.ts:388`), so add `edit_file` there next to `write_file`.

- [ ] **Step 1: Write failing tests:**
  - one replacement succeeds;
  - not-found error;
  - multiple-match error;
  - outside `allowedPaths` is refused.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Worker prompt line: "For a file that already exists, change it with edit_file; use write_file only for new files or a full rewrite."
  - `trimHistory` also trims long `find`/`replace` args.
- [ ] **Step 4: Run** the agents tests.
- [ ] **Step 5: Commit** `agents: edit_file tool so small models change files without re-sending them`.

### Task 4: Plans sized to the team

**Files:**
- Modify: `packages/agents/src/prompts.ts` (`architectPlanPrompt` gets the team's budget), `packages/agents/src/scheduler.ts` (`enforceFileOwnership`, `parallelizeWithContract`, new `splitOversized`), `packages/agents/src/orchestrator.ts` (`plan()`: one re-plan round for oversized tasks)
- Test: `packages/agents/src/agents.test.ts`, `packages/agents/src/orchestrator.test.ts`

**Interfaces:**
- Consumes: `estimateTask`, `fits` (Task 2), `capacityOf` (Task 1).
- Produces:
  ```ts
  architectPlanPrompt(goal, fileList, workerNames, budget?: { workerMaxOutput: number; strongMaxOutput: number })
  function splitOversized(plan: AgentPlan, canFit: (t: PlanTask) => boolean): AgentPlan
  function architectSplitPrompt(task: PlanTask, maxOutput: number): string  // in prompts.ts
  ```

**Decisions:**
- **Prompt:**
  - Replace "1 to 6 tasks. Fewer is better" with "Each task must be small enough for its worker: about `${Math.round(workerMaxOutput*0.8/12)}` lines of code to write. Split anything bigger into separate tasks (one file or one group of functions each). Up to 12 tasks."
  - Lines are about 12 tokens each.
- **Merging:** `enforceFileOwnership` merges only when the merged task would still fit (`canFit`). Otherwise the later task becomes a **sequential part** on the same file: same file, `dependsOn: [earlier.id]`, description "Part 2 of <file>: add … to the existing file with edit_file; don't rewrite what part 1 wrote."
- **Keeping the order:** `parallelizeWithContract` must keep `dependsOn` between tasks that share a file. Today it clears all `dependsOn`, which would run part 2 in parallel and clobber part 1. It still clears the rest.
- **Re-plan:** after `normalizePlan`, `plan()` sends each task that fits no team model to the architect once with `architectSplitPrompt`. JSON shape: `{tasks:[…]}`, the same task shape as the plan.
  - If the reply is invalid or still oversized, `splitOversized` splits deterministically:
    - a multi-file task becomes one task per file (reuse `splitForParallelism`'s piece builder; extract it as `pieceFor(task, file)`);
    - a one-file task becomes sequential parts by numbered item.
  - Cap the plan at 12 tasks. Past that, leave tasks oversized; Task 5 routes them to the strongest model.

- [ ] **Step 1: Write failing tests:**
  - `enforceFileOwnership` keeps two big same-file tasks as part 1 → part 2 (not merged) when `canFit` returns false, and still merges when true;
  - `parallelizeWithContract` keeps a same-file `dependsOn` but clears a cross-file one;
  - `splitOversized` turns a 3-file oversized task into 3 tasks and a 2-item one-file task into 2 sequential parts;
  - plan stays ≤ 12 tasks;
  - orchestrator: the architect's re-split reply is used when valid;
  - when it's garbage, the deterministic split is used and planning still completes (fake host chat).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `plan()` computes `budget` from `capacityOf` over `ctl.workerPool` (min `maxOutput`) and the architect.
- [ ] **Step 4: Run** the agents tests. All existing tests still pass, notably "integration can create a file whose worker failed" and the contract-ids test.
- [ ] **Step 5: Commit** `agents: plans sized to the team; big tasks split, same-file parts run in order`.

### Task 5: Route each task to a model that fits

**Files:**
- Modify: `packages/agents/src/orchestrator.ts` (worker pool includes stronger models; `pump()` uses `pickWorker`; `task.size` recorded), `packages/shared/src/types.ts` (`AgentTask.size?: SizeClass`, `AgentTask.estimate?: number`)
- Create: `packages/agents/src/routing.ts`
- Test: `packages/agents/src/routing.test.ts`, `packages/agents/src/orchestrator.test.ts`

**Interfaces:**
- Consumes: `estimateTask`, `fits`, `capacityOf`.
- Produces:
  ```ts
  interface PoolWorker { name: string; model: InstalledModel; busy: boolean }
  type Pick = { worker: PoolWorker; reason: string } | { wait: true; reason: string }
  function pickWorker(size: TaskSize, pool: PoolWorker[], cap: (m: InstalledModel) => ModelCapacity, loadedLocal?: string): Pick
  ```

**Rules:**
- **Candidates** are the free workers whose model `fits`. Choose the *weakest* one that fits (lowest `skill`), which keeps strong models free for big tasks.
  - Tiebreak 1: a local model that's already loaded (`loadedLocal`). Swapping two local models on a 6 GB GPU took most of a 184-minute Snake run.
  - Tiebreak 2: a hosted model over a local one.
- **If no free worker fits** but a busy one would, return `wait`.
- **If no worker in the whole pool fits** (even after Task 4's splitting), pick the strongest free worker and say why in `reason`. This never deadlocks; it covers the one-model case.
- **Pool:** add one extra pool worker per lead/architect model that isn't already in it, named from `WORKER_NAMES`, so a strong model can take a big task directly. Local models keep the existing `ResourceGuard` memory check, so nothing new loads past the memory budget.
- **Log:** `pump()` logs `Router: "<title>" (<size>, ~<outputTokens> tokens to write) → <worker> (<model>)<, reason>`.

- [ ] **Step 1: Write failing tests:**
  - routing.test: a small task goes to the weakest fitting model;
  - a large task skips a 2 GB model and takes gpt-oss 120B;
  - a large task waits when the only fitting worker is busy;
  - one-model pool → that model, with a reason, never `wait`;
  - Qwen3.8 (1,000 output/min) gets a small task but not a 1,200-token one;
  - the loaded local model is preferred.
  - orchestrator.test: with a fake weak and strong model, a large task's `task.model` is the strong model's name.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `pump()`, compute `estimateTask` once per task (store it in `task.size` / `task.estimate`). `existing` is the sizes of the task's files in the integration worktree. Keep the owner preference only when that owner fits.
- [ ] **Step 4: Run** the agents tests.
- [ ] **Step 5: Commit** `agents: route each task to the cheapest model that can do it`.

### Task 6: Context sized to the model

**Files:**
- Modify: `packages/agents/src/orchestrator.ts` (`workerLoop` prompt assembly, `ownedFileContents`)
- Create: `packages/agents/src/context.ts`
- Test: `packages/agents/src/context.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function interfaceSummary(code: string, file: string): string  // top-level function/class names + window.x assignments + element ids, one line each
  function buildWorkerContext(input: { owned: Record<string,string>; others: Record<string,string>; fileList: string[]; prd?: string }, budgetTokens: number): string
  ```
- Budget = `min(cap.contextTokens * 0.5, cap.inputPerMinute * 0.8) - outputTokens estimate`.
- Fill in this order until the budget is used:
  1. owned files in full;
  2. other files' `interfaceSummary`;
  3. file list (truncated to 60 paths);
  4. PRD (truncated).
- 4 chars ≈ 1 token.

- [ ] **Step 1: Write failing tests:**
  - `interfaceSummary` of a sample game.js lists `function update`, `window.game =`, and `#game`;
  - with a 2,000-token budget the output stays ≤ 8,000 chars and still contains the owned file;
  - with a huge budget it includes the PRD.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use it in `workerLoop` instead of the fixed list + `ownedFileContents` + `prd.slice(0, 3000)`.
- [ ] **Step 4: Run** the agents tests.
- [ ] **Step 5: Commit** `agents: worker context fits the model's budget`.

### Task 7: Reviews and integration sized to the lead

**Files:**
- Modify: `packages/agents/src/prompts.ts` (`leadReviewPrompt(task, diff, maxChars)`), `packages/agents/src/orchestrator.ts` (`review()`, `integrate()`)
- Test: `packages/agents/src/orchestrator.test.ts`

**Decisions:**
- The review diff limit = `min(24000, lead budget chars)`.
- When the diff is bigger, review per file: one call per file diff. Approve only if every file is approved; join the notes. This replaces silent truncation.
- The lead is the strongest free lead that `fits` the review input (`pickWorker` logic, reuse).
- `integrate()` gives the integration task the Task 6 context instead of every file in full.

- [ ] **Step 1: Write failing tests:**
  - a 40,000-char diff to a lead with a 7,000 input-per-minute cap produces several review calls, each under the cap (fake chat records prompt sizes);
  - one rejected file → not approved, with that file's notes.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the agents tests.
- [ ] **Step 5: Commit** `agents: reviews and integration fit the lead's limits`.

### Task 8: Learn from outcomes; show it in the UI

**Files:**
- Modify:
  - `packages/agents/src/orchestrator.ts`: `OrchestratorHost` gets `modelStats()` and `recordOutcome(modelId, o)`; call it when a task merges or fails.
  - `apps/desktop/src/main/agents.ts`:
    - store the stats in the `kv` table, key `modelStats`;
    - feed learned `limitsFromError` values in from the fallback catch block;
    - report the model actually used to the task (fixes the open bug "task card shows the assigned model after a fallback").
  - `apps/desktop/src/renderer/src/panels/AgentsPanel.tsx`: size badge on each task card.
- Test: `packages/agents/src/routing.test.ts`, `packages/agents/src/orchestrator.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ModelOutcome { size: SizeClass; outputTokens: number; ok: boolean }
  interface ModelStats { [modelId: string]: { ok: Record<SizeClass, number>; failed: Record<SizeClass, number>; learned?: Partial<ModelLimits> } }
  function learnedCapacity(stats: ModelStats[string] | undefined): Partial<ModelLimits>
  ```
- Rule: a model that failed tasks of a size class twice with no success at that size gets `maxOutput` capped just below that class's smallest failed `outputTokens`, so the router stops giving it that size. A later success at that size removes the cap.
- `host.chat` gets an `onModel?(m: InstalledModel)` callback in its options. The desktop calls it when it switches to a stand-in. The orchestrator sets `task.model` and logs "now using …".
- The card shows "S / M / L" plus the model really used.

- [ ] **Step 1: Write failing tests:**
  - two failed large tasks cap the model below large; one success clears it;
  - a fake host that switches model updates `task.model`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Persist through the existing `store` kv.
- [ ] **Step 4: Run** the agents tests, the models tests, and the desktop `tsc`. Smoke-launch Hive and open the AI team panel on an old run; the cards render.
- [ ] **Step 5: Commit** `agents: learn what each model can handle; show size and the real model on task cards`.

### Task 9: Measure it

**Files:**
- Modify: `tools/qa/report-notes.mjs`, `docs/qa-checklist.md`, `PROGRESS.md`; results go to `docs/qa/results.jsonl` through the existing harness.

**Baseline (already measured, local models, 6 GB GPU):**
- Qwen2.5 Coder 7B alone: Snake 1/10; Tic-Tac-Toe 1/8 by test hook, 7/8 by clicking.
- 7B + Llama 3.2 3B: Snake unfinished after 184 min.

**Steps:**
- [ ] **Step 1:** Rerun locally, one Ollama job at a time, with `QA_TAG=sized-local`:
  - `HIVE_TEAM_MODELS=qwen2.5-coder:7b node tools/qa/run-challenges-team.mjs snake tictactoe breakout`
  - Then add `llama3.2:3b` only if it's still installed; don't download it without asking.
- [ ] **Step 2:** When the free quotas have reset, rerun the 7 BLOCKED challenges on hosted models with `QA_TAG=sized-hosted` (the PROGRESS.md command). Check there are fewer 413/429s in `profile-cloud.main.log` than in the 2026-11-18 batch.
- [ ] **Step 3: Success bar:**
  - Local Snake ≥ 5/10 and Tic-Tac-Toe 8/8, in less time than baseline.
  - Hosted Snake and Tic-Tac-Toe no worse than 9/10 and 8/8.
  - If a result misses the bar, root-cause it before tuning any constant in Task 2. Record a constant change with the run that justified it.
- [ ] **Step 4:** Update the report notes (new bugs/fixes, before/after table), regenerate with `node tools/qa/report.mjs`, run `node tools/qa/sync-checklist.mjs`, update PROGRESS.md, and commit.

## Not in this plan (separate, small)

- Duplicated History entries after 3+ shared-project switches; Run noticing exits 4–8 s late. Quick bug fixes; do them before or after, independently.
- Fine-tuning model weights: rejected (see conversation; not worth it on a 6 GB GPU).
