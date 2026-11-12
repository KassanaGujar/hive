import { Notification, BrowserWindow } from 'electron'
import { Orchestrator, chatResultFrom } from './agentsHost'
import type { AgentRun, ApprovalRequest } from '@hive/shared'
import { emit } from './ipc'
import { currentProject, projectRoot } from './project'
import { getSettings, store } from './store'
import { endpointFor, installedModels } from './models'
import { gitOps } from './git'
import { execCapture } from './terminal'
import { recordFeed } from './feed'
import { memoryBudgetGB } from './hardware'
import { smokeTestWeb } from './smoke'
import path from 'node:path'
import { streamChat } from '@hive/models'

const approvals = new Map<string, { req: ApprovalRequest; resolve: (ok: boolean) => void }>()
let modelsCache: Awaited<ReturnType<typeof installedModels>> = []
const persistTimers = new Map<string, NodeJS.Timeout>()

export async function refreshModels() {
  modelsCache = await installedModels()
  return modelsCache
}

export const orchestrator = new Orchestrator({
  projectRoot,
  models: () => modelsCache,
  tierOverrides: () => getSettings().tierOverrides,
  async chat(model, messages, tools, { signal, onText }) {
    return chatResultFrom(streamChat(endpointFor(model), messages, { tools, signal }), onText)
  },
  git: gitOps,
  exec: execCapture,
  requestApproval(req) {
    return new Promise<boolean>((resolve) => {
      approvals.set(req.id, { req, resolve })
      emit('agents:approval', req)
      const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
      if (!focused && Notification.isSupported()) {
        new Notification({ title: 'Hive: an agent needs your OK', body: `${req.agent} wants to run: ${req.command}` }).show()
      }
    })
  },
  emit(run: AgentRun) {
    emit('agents:update', run)
    const project = currentProject()
    if (!project) return
    clearTimeout(persistTimers.get(run.id))
    persistTimers.set(run.id, setTimeout(() => store.runSave(project, run), 500))
  },
  log(runId, agent, taskId, line) {
    emit('agents:log', { runId, agent, taskId, line })
  },
  feed(ev) {
    recordFeed(ev)
  },
  memoryBudgetGB,
  smokeTest: smokeTestWeb,
  fileWritten(runId, agent, taskId, absPath) {
    const rel = path.relative(projectRoot(), absPath).replace(/\\/g, '/')
    emit('agents:file', { runId, agent, taskId, path: rel })
  }
})

export async function startAgents(goal: string, preset?: { title: string; description: string }[], prd?: string) {
  await refreshModels()
  return orchestrator.start(goal, preset, prd)
}

export function answerApproval(id: string, ok: boolean) {
  const a = approvals.get(id)
  if (!a) return
  approvals.delete(id)
  a.resolve(ok)
}

export const pendingApprovals = () => [...approvals.values()].map((a) => a.req)

export function restoreRuns() {
  const project = currentProject()
  if (project) orchestrator.restore(store.runList(project))
}
