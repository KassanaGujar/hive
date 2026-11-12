import { FolderOpen, FolderPlus, Users } from 'lucide-react'
import { useStore } from '../store'
import icon from '../assets/icon.png'
import { newProjectFlow, openFolderFlow, openProject } from '../lib/actions'

export function Welcome({ onJoin }: { onJoin: () => void }) {
  const settings = useStore((s) => s.settings)!
  const toast = useStore((s) => s.toast)
  const safe = (fn: () => Promise<unknown>) => () => fn().catch((e) => toast(e.message, 'error'))
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
              <button key={p} className="block w-full truncate rounded px-2 py-1.5 text-left hover:bg-panel2" onClick={safe(() => openProject(p))} title={p}>
                <span className="font-medium">{p.split(/[\\/]/).pop()}</span> <span className="text-muted">{p}</span>
              </button>
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
