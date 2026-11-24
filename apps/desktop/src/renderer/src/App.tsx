import { useEffect, useState } from 'react'
import { invoke, on } from './lib/api'
import { setMonacoTheme } from './lib/monaco'
import { useStore } from './store'
import { SetupWizard } from './pages/SetupWizard'
import { Welcome } from './pages/Welcome'
import { Workspace } from './pages/Workspace'
import { Toasts } from './components/Toasts'
import { openProject } from './lib/actions'
import { JoinDialog } from './components/JoinDialog'

export function App() {
  const settings = useStore((s) => s.settings)
  const root = useStore((s) => s.root)
  const [joinLink, setJoinLink] = useState<string | null>(null)

  useEffect(() => {
    const st = useStore.getState()
    invoke('settings:get').then((settings) => st.set({ settings }))
    invoke('ollama:pulls').then((list) => st.set({ pulls: Object.fromEntries(list.map((p) => [p.pullName, p])) }))
    invoke('run:state').then((run) => st.set({ run }))
    invoke('agents:approvals').then((approvals) => st.set({ approvals }))
    const offs = [
      on('run:state', (run) => useStore.getState().set({ run })),
      on('ollama:progress', (p) => {
        const s = useStore.getState()
        s.set({ pulls: { ...s.pulls, [p.pullName]: p } })
        if (p.state === 'done') {
          s.toast(`${p.pullName} is ready`, 'ok')
          invoke('models:installed').then((models) => useStore.getState().set({ models }))
        }
        if (p.state === 'error') s.toast(`Download failed: ${p.error}`, 'error')
      }),
      on('agents:update', (run) => useStore.getState().upsertRun(run)),
      on('agents:approval', (req) => {
        const s = useStore.getState()
        // the AI team page shows it and the rail badge counts it; don't pull the person off the page they're on
        s.set({ approvals: [...s.approvals, req] })
        s.toast(`${req.agent} needs your OK to run a command`, 'info', { label: 'Review', run: () => useStore.getState().set({ page: 'team' }) })
      }),
      on('app:openInvite', ({ link }) => setJoinLink(link)),
      on('updater:ready', ({ version, manual }) =>
        manual
          ? useStore.getState().toast(`Hive ${version} is out.`, 'ok', {
              label: 'Download it',
              run: () => invoke('shell:openExternal', 'https://github.com/KassanaGujar/hive/releases/latest')
            })
          : useStore.getState().toast(`Hive ${version} is ready.`, 'ok', { label: 'Restart now', run: () => invoke('updater:install') })
      )
    ]
    return () => offs.forEach((f) => f())
  }, [])

  useEffect(() => {
    if (!settings) return
    document.documentElement.classList.toggle('dark', settings.theme === 'dark')
    setMonacoTheme(settings.theme)
  }, [settings?.theme])

  // Reopen the last project on launch.
  useEffect(() => {
    if (settings?.setupComplete && !root && settings.recentProjects[0] && !sessionStorage.getItem('hive.closedProject')) {
      openProject(settings.recentProjects[0]).catch((e) => useStore.getState().toast(`Couldn't reopen the last project: ${e.message}`, 'error'))
    }
  }, [settings?.setupComplete])

  if (!settings) return <div className="flex h-full items-center justify-center text-muted">Starting Hive…</div>

  return (
    <>
      {!settings.setupComplete ? <SetupWizard /> : root ? <Workspace /> : <Welcome onJoin={() => setJoinLink('')} />}
      {joinLink !== null && settings.setupComplete && <JoinDialog initial={joinLink} onClose={() => setJoinLink(null)} />}
      <Toasts />
    </>
  )
}
