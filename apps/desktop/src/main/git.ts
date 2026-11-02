import { simpleGit, type SimpleGit } from 'simple-git'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createGitOps, excludeHiveDir, ensureIdentity as ensureId, type GitOps } from '@hive/agents'
import type { GitCommit, GitStatus } from '@hive/shared'
import { projectRoot } from './project'
import { getSettings } from './store'

const git = (cwd: string): SimpleGit => simpleGit({ baseDir: cwd, maxConcurrentProcesses: 4, trimmed: false })

const ensureIdentity = (g: SimpleGit) => ensureId(g, getSettings().profile?.name ?? 'Hive user')

export async function isRepo(cwd = projectRoot()) {
  return git(cwd).checkIsRepo().catch(() => false)
}

export async function status(): Promise<GitStatus> {
  const root = projectRoot()
  if (!(await isRepo(root)) || !existsSync(path.join(root, '.git'))) {
    return { isRepo: false, branch: '', branches: [], files: [], ahead: 0, behind: 0 }
  }
  const g = git(root)
  const s = await g.status()
  const b = await g.branchLocal().catch(() => ({ all: [] as string[], current: s.current ?? '' }))
  return {
    isRepo: true,
    branch: s.current ?? b.current,
    branches: b.all.filter((x) => !x.startsWith('hive/')),
    files: s.files.map((f) => ({ path: f.path.replace(/^"|"$/g, ''), index: f.index, workingDir: f.working_dir })),
    ahead: s.ahead,
    behind: s.behind
  }
}

export async function init() {
  const root = projectRoot()
  const g = git(root)
  await g.init(['-b', 'main'])
  await ensureIdentity(g)
  await excludeHiveDir(root)
}

export const stage = (paths: string[]) => git(projectRoot()).add(paths.length ? paths : ['-A'])
export const unstage = (paths: string[]) => git(projectRoot()).reset(['-q', 'HEAD', '--', ...paths]).catch(() => git(projectRoot()).rm(['--cached', '-q', ...paths]))

export async function commit(message: string) {
  const g = git(projectRoot())
  await ensureIdentity(g)
  const r = await g.commit(message)
  return r.commit
}

export const checkout = async (branch: string, create?: boolean) => {
  const g = git(projectRoot())
  if (create) await g.checkoutLocalBranch(branch)
  else await g.checkout(branch)
}

export async function log(limit = 50): Promise<GitCommit[]> {
  try {
    const l = await git(projectRoot()).log({ maxCount: limit })
    return l.all.map((c) => ({ hash: c.hash, date: c.date, message: c.message, author: c.author_name }))
  } catch {
    return []
  }
}

export async function diff(file?: string, staged?: boolean) {
  const args = [...(staged ? ['--cached'] : []), ...(file ? ['--', file] : [])]
  return git(projectRoot()).diff(args)
}

/** File content at a ref (default HEAD); '' if it didn't exist. */
export async function show(rel: string, ref = 'HEAD') {
  try {
    return await git(projectRoot()).show([`${ref}:${rel}`])
  } catch {
    return ''
  }
}

// ---------- worktree operations used by the agent orchestrator ----------

export const gitOps: GitOps = createGitOps(() => getSettings().profile?.name ?? 'Hive user')
