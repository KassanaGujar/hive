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
    <div className="flex h-full items-center justify-center overflow-auto bg-bg px-4 py-10">
      <div className="w-full max-w-[520px]">
        {/* centred as one block: left-aligned in a 520 px column, the comb sat visibly left of the window's centre */}
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src={icon} alt="" className="h-12 w-12" />
          <div>
            <h1 className="display text-[30px] leading-none font-bold">Hive</h1>
            <p className="mt-1 text-[14px] text-muted">
              Hi {settings.profile?.name}. What are we building?
            </p>
          </div>
        </div>
        {/* the start actions are cells of a comb, laid like the agents' honeycomb: two above, one tucked below */}
        <div className="comb" role="group" aria-label="Start">
          <Cell icon={<FolderPlus />} label="New project" onClick={safe(newProjectFlow)} />
          <Cell icon={<FolderOpen />} label="Open folder" onClick={safe(openFolderFlow)} />
          <Cell icon={<Users />} label="Join with invite" onClick={onJoin} />
        </div>
        {settings.recentProjects.length > 0 && (
          <div className="mt-6">
            <h2 className="label mb-2">Recent</h2>
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

/** Pointy-top hexagon, 100 wide in a 100×115.5 box. */
const HEX = '50,1 99,29 99,86.5 50,114.5 1,86.5 1,29'

function Cell({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const clip = `hex-${label.replace(/\W/g, '')}`
  return (
    <button onClick={onClick} className="comb-cell">
      <svg viewBox="0 0 100 115.5" aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <clipPath id={clip}>
            <polygon points={HEX} />
          </clipPath>
        </defs>
        <polygon points={HEX} className="comb-wax" />
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y="0" width="100" height="115.5" className="comb-honey" />
        </g>
        <polygon points={HEX} className="comb-edge" />
      </svg>
      <span className="relative flex flex-col items-center gap-2 text-[13px] font-semibold">
        <span className="text-accent">{icon}</span>
        {label}
      </span>
    </button>
  )
}
