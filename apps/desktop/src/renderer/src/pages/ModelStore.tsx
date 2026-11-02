import { useEffect, useState } from 'react'
import { Check, Download, ExternalLink, Loader2, Pause, Play, Trash2, X } from 'lucide-react'
import { fitLabel } from '@hive/models'
import type { Catalog, CatalogEntry, Hardware, InstalledModel, Tier } from '@hive/shared'
import { fmtGB, invoke } from '../lib/api'
import { useStore } from '../store'
import { refreshModels } from '../lib/actions'

type Tab = 'local' | 'online' | 'installed'

const FIT = {
  'runs-well': { text: 'Runs well', cls: 'bg-ok/15 text-ok' },
  slow: { text: 'Slow on this PC', cls: 'bg-warn/15 text-warn' },
  'too-big': { text: 'Too big for this PC', cls: 'bg-bad/15 text-bad' }
}

export function ModelStore() {
  const [tab, setTab] = useState<Tab>('local')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [hw, setHw] = useState<Hardware | null>(null)
  const [ollama, setOllama] = useState<{ installed: boolean; running: boolean } | null>(null)
  const models = useStore((s) => s.models)

  useEffect(() => {
    invoke('catalog:get').then(setCatalog)
    invoke('hw:scan').then(setHw)
    invoke('ollama:status').then(setOllama)
    refreshModels()
  }, [])

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-1 text-[18px] font-bold">Model store</div>
        <div className="mb-4 text-muted">
          Every model here is free. {hw && `Your PC: ${hw.totalRamGB} GB RAM${hw.gpuName ? ` · ${hw.gpuName}${hw.vramGB ? ` (${hw.vramGB} GB)` : ''}` : ' · no dedicated GPU'} · ${fmtGB(hw.freeDiskGB)} free.`}
        </div>
        <div className="mb-4 flex gap-1 border-b border-line">
          {(
            [
              ['local', 'On this PC'],
              ['online', 'Free online'],
              ['installed', `Installed (${models.length})`]
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>
        {ollama && !ollama.installed && tab === 'local' && <OllamaMissing onDone={() => invoke('ollama:status').then(setOllama)} />}
        {!catalog || !hw ? (
          <div className="text-muted">Loading…</div>
        ) : tab === 'local' ? (
          <LocalTab catalog={catalog} hw={hw} installed={models} />
        ) : tab === 'online' ? (
          <OnlineTab catalog={catalog} installed={models} />
        ) : (
          <InstalledTab installed={models} />
        )}
      </div>
    </div>
  )
}

function OllamaMissing({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <div className="card mb-4 flex items-center gap-3 border-warn/40 p-3">
      <div className="flex-1">Ollama (the free engine that runs local models) isn't installed yet.{msg && <div className="text-[12px] text-warn">{msg}</div>}</div>
      <button
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const r = await invoke('ollama:install')
          setMsg(r.message)
          setBusy(false)
          onDone()
        }}
      >
        {busy && <Loader2 size={14} className="animate-spin" />} Install Ollama
      </button>
    </div>
  )
}

function LocalTab({ catalog, hw, installed }: { catalog: Catalog; hw: Hardware; installed: InstalledModel[] }) {
  const pulls = useStore((s) => s.pulls)
  const local = catalog.models.filter((m) => m.source === 'ollama')
  const families = [...new Set(local.map((m) => m.family))]
  return (
    <div className="flex flex-col gap-6">
      {families.map((f) => (
        <div key={f}>
          <div className="label mb-2">{f}</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {local
              .filter((m) => m.family === f)
              .map((m) => (
                <LocalCard key={m.id} m={m} hw={hw} installed={installed.some((i) => i.id === m.id)} pull={pulls[m.pullName!]} />
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function LocalCard({ m, hw, installed, pull }: { m: CatalogEntry; hw: Hardware; installed: boolean; pull?: import('@hive/shared').PullProgress }) {
  const fit = FIT[fitLabel(m, hw)]
  const pct = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0
  const downloading = pull?.state === 'downloading'
  const paused = pull?.state === 'paused'
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="font-semibold">{m.name}</div>
          <div className="text-[11px] text-muted">
            {fmtGB(m.sizeGB)} download · needs ~{m.minRamGB} GB RAM · {m.tier} tier · score {m.codingScore}
          </div>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${fit.cls}`}>{fit.text}</span>
      </div>
      {m.description && <div className="text-[12px] text-muted">{m.description}</div>}
      {(downloading || paused) && (
        <div>
          <div className="h-1.5 overflow-hidden rounded bg-panel2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {paused ? 'Paused' : pull!.status} · {pct}%{pull!.total ? ` of ${fmtGB(pull!.total / 1024 ** 3)}` : ''}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        {installed ? (
          <span className="flex items-center gap-1 text-[12px] text-ok">
            <Check size={14} /> Installed
          </span>
        ) : downloading ? (
          <>
            <button className="btn" onClick={() => invoke('ollama:pause', m.pullName!)}>
              <Pause size={12} /> Pause
            </button>
            <button className="btn" onClick={() => invoke('ollama:cancel', m.pullName!)}>
              <X size={12} /> Cancel
            </button>
          </>
        ) : paused ? (
          <>
            <button className="btn-primary" onClick={() => invoke('ollama:pull', m.pullName!)}>
              <Play size={12} /> Resume
            </button>
            <button className="btn" onClick={() => invoke('ollama:cancel', m.pullName!)}>
              <X size={12} /> Cancel
            </button>
          </>
        ) : (
          <button
            className="btn-primary"
            disabled={fitLabel(m, hw) === 'too-big' || m.sizeGB + 1 > hw.freeDiskGB}
            title={m.sizeGB + 1 > hw.freeDiskGB ? 'Not enough free disk space' : undefined}
            onClick={() => invoke('ollama:pull', m.pullName!)}
          >
            <Download size={12} /> Download
          </button>
        )}
      </div>
    </div>
  )
}

function OnlineTab({ catalog, installed }: { catalog: Catalog; installed: InstalledModel[] }) {
  const providers = Object.entries(catalog.providers) as [keyof Catalog['providers'], Catalog['providers'][keyof Catalog['providers']]][]
  return (
    <div className="flex flex-col gap-6">
      <div className="text-muted">
        Optional, for PCs that can't run big models. Each service has a free tier: make a free account, paste the key once, and it stays encrypted on this PC — it's never shared with teammates. Only free models are listed.
      </div>
      {providers.map(([id, p]) => (
        <ProviderBlock key={id} id={id} name={p.name} keyUrl={p.keyUrl} models={catalog.models.filter((m) => m.source === id)} installed={installed} />
      ))}
    </div>
  )
}

function ProviderBlock({ id, name, keyUrl, models, installed }: { id: string; name: string; keyUrl: string; models: CatalogEntry[]; installed: InstalledModel[] }) {
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [state, setState] = useState<{ busy: boolean; msg?: string; ok?: boolean }>({ busy: false })
  useEffect(() => {
    invoke('secrets:has', `key:${id}`).then(setHasKey)
  }, [id])

  const test = async (value: string) => {
    if (value.trim().length < 10) return
    setState({ busy: true })
    const r = await invoke('models:testKey', id, value)
    setState({ busy: false, msg: r.message, ok: r.ok })
    if (r.ok) {
      setHasKey(true)
      setKey('')
    }
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex-1 font-semibold">{name}</div>
        <button className="btn" onClick={() => invoke('shell:openExternal', keyUrl)}>
          Get free key <ExternalLink size={12} />
        </button>
      </div>
      {hasKey ? (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-ok">
          <Check size={14} /> Key saved
          <button
            className="btn-ghost text-muted"
            onClick={async () => {
              await invoke('secrets:delete', `key:${id}`)
              setHasKey(false)
              refreshModels()
            }}
          >
            remove
          </button>
        </div>
      ) : (
        <div className="mb-3 flex gap-2">
          <input
            className="input font-mono"
            type="password"
            placeholder="Paste your free key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onPaste={(e) => test(e.clipboardData.getData('text'))}
          />
          <button className="btn" disabled={state.busy || !key} onClick={() => test(key)}>
            {state.busy ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
          </button>
        </div>
      )}
      {state.msg && <div className={`mb-2 text-[12px] ${state.ok ? 'text-ok' : 'text-bad'}`}>{state.msg}</div>}
      <div className="flex flex-col gap-1">
        {models.map((m) => {
          const on = installed.some((i) => i.id === m.id)
          return (
            <label key={m.id} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-panel2">
              <input
                type="checkbox"
                disabled={!hasKey}
                checked={on}
                onChange={async (e) => {
                  await invoke('models:connectHosted', m.id, e.target.checked)
                  refreshModels()
                }}
              />
              <span className="flex-1">{m.name}</span>
              <span className="text-[11px] text-muted">
                {m.tier} · score {m.codingScore}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function InstalledTab({ installed }: { installed: InstalledModel[] }) {
  const toast = useStore((s) => s.toast)
  const [testing, setTesting] = useState<string | null>(null)
  if (!installed.length) return <div className="text-muted">Nothing yet. Download a model from "On this PC" or connect a free online one.</div>
  const disk = installed.reduce((a, m) => a + m.sizeGB, 0)
  return (
    <div>
      <div className="mb-3 text-muted">{fmtGB(disk)} used on disk by local models.</div>
      <div className="flex flex-col gap-2">
        {installed.map((m) => (
          <div key={m.id} className="card flex items-center gap-3 p-3">
            <div className="flex-1">
              <div className="font-semibold">{m.name}</div>
              <div className="text-[11px] text-muted">
                {m.source === 'ollama' ? `local · ${fmtGB(m.sizeGB)}` : `free online · ${m.source}`} · score {m.codingScore}
              </div>
            </div>
            <label className="flex items-center gap-1 text-[12px] text-muted">
              Tier
              <select
                className="input w-auto"
                value={m.tier}
                onChange={async (e) => {
                  await invoke('models:setTier', m.id, e.target.value as Tier)
                  refreshModels()
                }}
              >
                <option value="top">Top</option>
                <option value="lead">Lead</option>
                <option value="worker">Worker</option>
              </select>
            </label>
            <button
              className="btn"
              disabled={testing === m.id}
              onClick={async () => {
                setTesting(m.id)
                try {
                  const reply = await invoke('chat:once', m.id, [{ role: 'user', content: 'Reply with exactly: Hello from Hive!' }])
                  toast(`${m.name}: ${reply.slice(0, 120)}`, 'ok')
                } catch (e) {
                  toast((e as Error).message, 'error')
                }
                setTesting(null)
              }}
            >
              {testing === m.id ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
            </button>
            {m.source === 'ollama' ? (
              <button
                className="btn"
                onClick={async () => {
                  if (!confirm(`Delete ${m.name} from this PC?`)) return
                  await invoke('ollama:delete', m.model)
                  refreshModels()
                }}
                aria-label="Delete model"
              >
                <Trash2 size={12} />
              </button>
            ) : (
              <button
                className="btn"
                onClick={async () => {
                  await invoke('models:connectHosted', m.id, false)
                  refreshModels()
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
