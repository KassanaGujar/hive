import { simpleGit, type SimpleGit } from 'simple-git'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import type { GitOps } from './orchestrator'

/**
 * Real git implementation of the orchestrator's GitOps: a worktree + branch per agent task,
 * merges in dependency order. Node-only (no Electron), so it's testable.
 */
const git = (cwd: string): SimpleGit => simpleGit({ baseDir: cwd, maxConcurrentProcesses: 4, trimmed: false })

/** Hive's own state (worktrees) lives in .hive/ — keep it out of git without touching .gitignore. */
export async function excludeHiveDir(cwd: string) {
  const g = git(cwd)
  const gitDir = (await g.revparse(['--git-common-dir'])).trim()
  const file = path.resolve(cwd, gitDir, 'info', 'exclude')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const cur = existsSync(file) ? await fs.readFile(file, 'utf8') : ''
  const lines = cur.split(/\r?\n/)
  if (!lines.includes('.hive/')) {
    const sep = cur === '' || cur.endsWith('\n') ? '' : '\n'
    await fs.writeFile(file, `${cur}${sep}.hive/\n`)
  }
}

export async function ensureIdentity(g: SimpleGit, name: string) {
  const n = await g.getConfig('user.name').catch(() => ({ value: null }))
  if (!n.value) await g.addConfig('user.name', name)
  const e = await g.getConfig('user.email').catch(() => ({ value: null }))
  if (!e.value) await g.addConfig('user.email', 'hive@localhost')
}

export function createGitOps(identityName: () => string = () => 'Hive user'): GitOps {
  const ensureIdentity_ = (g: SimpleGit) => ensureIdentity(g, identityName())
  return {
    async ensureRepo(root) {
      const g = git(root)
      if (!existsSync(path.join(root, '.git'))) await g.init(['-b', 'main'])
      await ensureIdentity_(g)
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
      await git(root)
        .raw(['worktree', 'remove', '--force', wtPath])
        .catch(async () => {
          await fs.rm(wtPath, { recursive: true, force: true })
          await git(root).raw(['worktree', 'prune'])
        })
    },
    async commitAll(cwd, message) {
      const g = git(cwd)
      await ensureIdentity_(g)
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
      await ensureIdentity_(g)
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
}
