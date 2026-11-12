import { useEffect, useState } from 'react'
import { Check, Cpu, Download, Loader2, X } from 'lucide-react'
import { fitLabel, recommendStarter } from '@hive/models'
import type { Catalog, CatalogEntry, Hardware } from '@hive/shared'
import { AVATARS, COLORS, fmtGB, invoke } from '../lib/api'
import { useStore } from '../store'
import { refreshModels } from '../lib/actions'
import icon from '../assets/icon.png'

type Step = 'profile' | 'machine' | 'model' | 'done'

/** First-run: name + avatar, hardware scan, git + Ollama install, starter model download. */
export function SetupWizard() {
  const [step, setStep] = useState<Step>('profile')
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])
  const [color, setColor] = useState(COLORS[0])

  const saveProfile = async () => {
    const settings = await invoke('settings:set', { profile: { name: name.trim(), avatar, color } })
    useStore.getState().set({ settings })
    setStep('machine')
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="card w-[560px] p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src={icon} alt="" className="h-12 w-12" />
          <div>
            <div className="display text-[22px] leading-tight font-bold">Welcome to Hive</div>
            <div className="text-muted">Free AI coding with your friends. Setup takes a few minutes.</div>
          </div>
        </div>
        <Steps step={step} />
        {step === 'profile' && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="label mb-1">Your name</div>
              <input className="input text-[14px]" autoFocus value={name} placeholder="What should friends see?" onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <div className="label mb-1">Avatar</div>
              <div className="flex flex-wrap gap-1">
                {AVATARS.map((a) => (
                  <button key={a} onClick={() => setAvatar(a)} className={`h-9 w-9 rounded-md text-xl ${a === avatar ? 'bg-accent/30 ring-2 ring-accent' : 'bg-panel2'}`}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1">Cursor colour</div>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ${c === color ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : ''}`} style={{ background: c }} aria-label={c} />
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" disabled={!name.trim()} onClick={saveProfile}>
                Next
              </button>
            </div>
          </div>
        )}
        {step === 'machine' && <MachineStep onNext={() => setStep('model')} />}
        {step === 'model' && <ModelStep onNext={() => setStep('done')} />}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="text-4xl">🎉</div>
            <div className="text-[15px] font-semibold">You're set up.</div>
            <div className="text-muted">Start a new project, or join a friend's with their invite code.</div>
            <button
              className="btn-primary"
              onClick={async () => useStore.getState().set({ settings: await invoke('settings:set', { setupComplete: true }) })}
            >
              Open Hive
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Steps({ step }: { step: Step }) {
  const all: [Step, string][] = [
    ['profile', 'You'],
    ['machine', 'Your PC'],
    ['model', 'First model'],
    ['done', 'Done']
  ]
  const idx = all.findIndex(([s]) => s === step)
  return (
    <div className="mb-6 flex gap-2">
      {all.map(([s, label], i) => (
        <div key={s} className="flex-1">
          <div className={`h-1 rounded ${i <= idx ? 'bg-accent' : 'bg-panel2'}`} />
          <div className={`mt-1 text-[11px] ${i === idx ? 'text-fg' : 'text-muted'}`}>{label}</div>
        </div>
      ))}
    </div>
  )
}

type Check = 'checking' | 'ok' | 'missing' | 'installing' | 'failed'

function MachineStep({ onNext }: { onNext: () => void }) {
  const [hw, setHw] = useState<Hardware | null>(null)
  const [git, setGit] = useState<Check>('checking')
  const [ollama, setOllama] = useState<Check>('checking')
  const [msg, setMsg] = useState('')

  const [attempt, setAttempt] = useState(0)
  const retry = () => {
    setMsg('')
    setGit('checking')
    setOllama('checking')
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    invoke('hw:scan').then(setHw)
    ;(async () => {
      // Check, then install silently whatever is missing.
      const g = await invoke('setup:git')
      if (g.installed) setGit('ok')
      else {
        setGit('installing')
        const r = await invoke('setup:installGit')
        setGit(r.ok ? 'ok' : 'failed')
        if (!r.ok) setMsg(r.message)
      }
    })()
    ;(async () => {
      const o = await invoke('ollama:status')
      if (o.installed) {
        await invoke('ollama:start')
        setOllama('ok')
      } else {
        setOllama('installing')
        const r = await invoke('ollama:install')
        setOllama(r.ok ? 'ok' : 'failed')
        if (!r.ok) setMsg((m) => (m ? m + '\n' : '') + r.message)
      }
    })()
  }, [attempt])

  const row = (label: string, state: Check, detail?: string) => (
    <div className="flex items-center gap-3 rounded-md bg-panel2 px-3 py-2">
      {state === 'ok' ? <Check size={16} className="text-ok" /> : state === 'failed' || state === 'missing' ? <X size={16} className="text-bad" /> : <Loader2 size={16} className="animate-spin text-accent" />}
      <div className="flex-1">
        <div>{label}</div>
        {detail && <div className="text-[11px] text-muted">{detail}</div>}
      </div>
      <div className="text-[11px] text-muted">{state === 'installing' ? 'installing…' : state === 'checking' ? 'checking…' : ''}</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-md bg-panel2 px-3 py-2">
        <Cpu size={16} className="text-accent" />
        {hw ? (
          <div>
            {hw.totalRamGB} GB RAM · {hw.gpuName ?? 'no dedicated GPU'}
            {hw.vramGB ? ` (${hw.vramGB} GB)` : ''} · {fmtGB(hw.freeDiskGB)} free disk
          </div>
        ) : (
          <div className="text-muted">Scanning your PC…</div>
        )}
      </div>
      {row('git', git, 'Gives every AI agent its own safe copy of the code')}
      {row('Ollama', ollama, 'Runs free AI models on this PC')}
      {msg && <div className="whitespace-pre-wrap rounded-md border border-warn/40 p-2 text-[12px] text-warn">{msg}</div>}
      <div className="flex justify-end gap-2">
        {(git === 'failed' || ollama === 'failed') && (
          <>
            <button className="btn" onClick={retry}>
              Check again
            </button>
            <button className="btn" onClick={onNext}>
              Skip for now
            </button>
          </>
        )}
        <button className="btn-primary" disabled={git !== 'ok' || ollama !== 'ok'} onClick={onNext}>
          Next
        </button>
      </div>
    </div>
  )
}

function ModelStep({ onNext }: { onNext: () => void }) {
  const [hw, setHw] = useState<Hardware | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [pick, setPick] = useState<CatalogEntry | null>(null)
  const pull = useStore((s) => (pick?.pullName ? s.pulls[pick.pullName] : undefined))

  useEffect(() => {
    Promise.all([invoke('hw:scan'), invoke('catalog:get')]).then(([h, c]) => {
      setHw(h)
      setCatalog(c)
      setPick(recommendStarter(c, h) ?? null)
    })
  }, [])

  useEffect(() => {
    if (pull?.state === 'done') refreshModels()
  }, [pull?.state])

  if (!hw || !catalog) return <div className="text-muted">Finding a model that fits your PC…</div>
  const local = catalog.models.filter((m) => m.source === 'ollama' && fitLabel(m, hw) !== 'too-big').sort((a, b) => a.sizeGB - b.sizeGB)
  const pct = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0

  return (
    <div className="flex flex-col gap-3">
      <div className="text-muted">We recommend this free coding model for your PC. You can add more later in the Model store.</div>
      <select className="input text-[13px]" value={pick?.id} onChange={(e) => setPick(catalog.models.find((m) => m.id === e.target.value) ?? null)} disabled={!!pull && pull.state === 'downloading'}>
        {local.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} — {fmtGB(m.sizeGB)} — {fitLabel(m, hw) === 'runs-well' ? 'runs well' : 'slow on this PC'}
          </option>
        ))}
      </select>
      {pull && pull.state !== 'cancelled' && (
        <div>
          <div className="h-2 overflow-hidden rounded bg-panel2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pull.state === 'done' ? 100 : pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {pull.state === 'done' ? 'Downloaded ✓' : pull.state === 'error' ? pull.error : `${pull.status} · ${pct}%${pull.total ? ` of ${fmtGB(pull.total / 1024 ** 3)}` : ''}`}
          </div>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <button className="btn" onClick={onNext}>
          {pull?.state === 'downloading' ? 'Continue while it downloads' : 'Skip (use free online models)'}
        </button>
        {pull?.state === 'done' ? (
          <button className="btn-primary" onClick={onNext}>
            Next
          </button>
        ) : (
          <button className="btn-primary" disabled={!pick || pull?.state === 'downloading'} onClick={() => pick?.pullName && invoke('ollama:pull', pick.pullName)}>
            <Download size={14} /> Download {pick ? fmtGB(pick.sizeGB) : ''}
          </button>
        )}
      </div>
    </div>
  )
}
