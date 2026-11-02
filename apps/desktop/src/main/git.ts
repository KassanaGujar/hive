import { simpleGit, type SimpleGit } from 'simple-git'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import type { GitOps } from '@hive/agents'
import type { GitCommit, GitStatus } from '@hive/shared'
import { projectRoot } from './project'
import { getSettings } from './store'

const git = (cwd: string): SimpleGit => simpleGit({ baseDir: cwd, maxConcurrentProcesses: 4, trimmed: false })

/** Hive's own state (worktrees) lives in .hive/ — keep it out of git without touching .gitignore. */
async function excludeHiveDir(cwd: string) {
  const g = git(cwd)
  const gitDir = (await g.revparse(['--git-common-dir'])).trim()
  const file = path.resolve(cwd, gitDir, 'info', 'exclude')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const cur = existsSync(file) ? await fs.readFile(file, 'utf8') : ''
  if (!cur.split(/\r?\n/).includes('.hive/')) await fs.writeFile(file, cur + (cur.endsWith('\n') || !cur ? '' : '\n') + '.hive/\n')
}

async function ensureIdentity(g: SimpleGit) {
  const name = await g.getConfig('user.name').catch(() => ({ value: null }))
  if (!name.value) await g.addConfig('user.name', getSettings().profile?.name ?? 'Hive user')
  const email = await g.getConfig('user.email').catch(() => ({ value: null }))
  if (!email.value) await g.addConfig('user.email', 'hive@localhost')
}

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

export const gitOps: GitOps = {
  async ensureRepo(root) {
    const g = git(root)
    if (!existsSync(path.join(root, '.git'))) await g.init(['-b', 'main'])
    await ensureIdentity(g)
    await excludeHiveDir(root)
    const hasHead = await g.revparse(['--verify', 'HEAD']).then(() => true).catch(() => false)
    const s = await g.status()
    if (!hasHead || !s.isClean()) {
      await g.add(['-A'])
      await g.commit(hasHead ? 'Hive: snapshot before agent run' : 'Initial snapshot (Hive)', undefined, { '--allow-empty': null })
    }
    return (await g.revparse(['--abbrev-ref', 'HEAD'])).trim()
  },
  async addWorktree(root, wtPath, branch, fromRef) {
    const g = git(root)
    await fs.mkdir(path.dirname(wtPath), { recursive: true })
    if (existsSync(wtPath)) await g.raw(['worktree', 'remove', '--force', wtPath]).catch(() => fs.rm(wtPath, { recursive: true, force: true }))
    await g.raw(['worktree', 'prune'])
    const exists = (await g.branchLocal()).all.includes(branch)
    if (exists) await g.raw(['worktree', 'add', wtPath, branch])
    else await g.raw(['worktree', 'add', '-b', branch, wtPath, fromRef])
  },
  async removeWorktree(root, wtPath) {
    await git(root).raw(['worktree', 'remove', '--force', wtPath]).catch(async () => {
      await fs.rm(wtPath, { recursive: true, force: true })
      await git(root).raw(['worktree', 'prune'])
    })
  },
  async commitAll(cwd, message) {
    const g = git(cwd)
    await ensureIdentity(g)
    await g.add(['-A'])
    const s = await g.status()
    if (s.isClean()) return false
    await g.commit(message)
    return true
  },
  async diff(cwd, fromRef, toRef) {
    return git(cwd).diff([`${fromRef}...${toRef}`, '--stat', '-p'])
  },
  async merge(cwd, branch, message) {
    const g = git(cwd)
    await ensureIdentity(g)
    const s = await g.status()
    if (!s.isClean()) {
      await g.add(['-A'])
      await g.commit('Hive: snapshot before merge')
    }
    try {
      await g.merge(['--no-ff', '-m', message, branch])
      return { ok: true }
    } catch (e: any) {
      const st = await g.status().catch(() => null)
      const conflicts = st?.conflicted?.join(', ') || e?.message || 'merge failed'
      await g.merge(['--abort']).catch(() => {})
      return { ok: false, conflicts }
    }
  },
  async deleteBranch(root, branch) {
    await git(root).deleteLocalBranch(branch, true)
  }
}
