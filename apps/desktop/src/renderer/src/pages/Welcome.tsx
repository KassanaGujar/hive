import { FolderOpen, FolderPlus, Pencil, Trash2, Users } from 'lucide-react'
import { invoke } from '../lib/api'
import { useStore, ask } from '../store'
import icon from '../assets/icon.png'
import { newProjectFlow, openFolderFlow, openProject } from '../lib/actions'

export function Welcome({ onJoin }: { onJoin: () => void }) {
  const settings = useStore((s) => s.settings)!
  const toast = useStore((s) => s.toast)
  const safe = (fn: () => Promise<unknown>) => () => fn().catch((e) => toast(e.message, 'error'))
  const refresh = async () => useStore.getState().set({ settings: await invoke('settings:get') })
  const rename = (p: string) => async () => {
    const name = await ask('Rename project', p.split(/[\\/]/).pop() ?? '')
    if (!name) return
    await invoke('project:rename', p, name)
    await refresh()
    toast(`Renamed to ${name}`, 'ok')
  }
  const remove = (p: string) => async () => {
    const name = p.split(/[\\/]/).pop() ?? p
    const typed = await ask(`Delete "${name}"? The folder moves to the Recycle Bin. Type its name to confirm.`, '', name)
    if (typed === null) return
    if (typed.trim() !== name) return toast('The name did not match, so nothing was deleted.', 'error')
    await invoke('project:delete', p)
    await refresh()
    toast(`${name} moved to the Recycle Bin`, 'ok')
  }
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="w-[520px]">
        <div className="mb-8 flex items-center gap-3">
          <img src={icon} alt="" className="h-14 w-14" />
          <div>
            <div className="display text-[28px] leading-none font-bold">Hive</div>
            <div className="text-muted">
              Hi {settings.profile?.avatar} {settings.profile?.name}. What are we building?
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Big icon={<FolderPlus />} label="New project" onClick={safe(newProjectFlow)} />
          <Big icon={<FolderOpen />} label="Open folder" onClick={safe(openFolderFlow)} />
          <Big icon={<Users />} label="Join with invite" onClick={onJoin} />
        </div>
        {settings.recentProjects.length > 0 && (
          <div className="mt-8">
            <div className="label mb-2">Recent</div>
            {settings.recentProjects.map((p) => (
              <div key={p} className="group flex items-center rounded hover:bg-panel2" data-project={p}>
                <button className="min-w-0 flex-1 truncate px-2 py-1.5 text-left" onClick={safe(() => openProject(p))} title={p}>
                  <span className="font-medium">{p.split(/[\\/]/).pop()}</span> <span className="text-muted">{p}</span>
                </button>
                <button className="btn-ghost opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Rename ${p}`} title="Rename" onClick={safe(rename(p))}>
                  <Pencil size={13} />
                </button>
                <button className="btn-ghost opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete ${p}`} title="Delete" onClick={safe(remove(p))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Big({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card flex flex-col items-center gap-2 p-5 text-[13px] font-medium hover:border-accent">
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  )
}
