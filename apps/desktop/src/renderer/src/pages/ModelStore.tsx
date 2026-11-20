import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Download, ExternalLink, Loader2, Pause, Play, Plus, Search, Trash2, X } from 'lucide-react'
import { fitLabel } from '@hive/models'
import type { Catalog, CatalogEntry, CustomProvider, FitLabel, Hardware, HfFile, HfModel, InstalledModel, OpenRouterModel, PullProgress, Tier } from '@hive/shared'
import { fmtGB, invoke } from '../lib/api'
import { useStore } from '../store'
import { refreshModels } from '../lib/actions'

type Tab = 'local' | 'hf' | 'online' | 'own' | 'subs' | 'installed'

const FIT: Record<FitLabel, { text: string; cls: string }> = {
  'runs-well': { text: 'Runs well', cls: 'bg-ok/15 text-ok' },
  slow: { text: 'Slow here', cls: 'bg-warn/15 text-warn' },
  'too-big': { text: 'Too big', cls: 'bg-bad/15 text-bad' }
}

/** Fit of any download by size alone (used for Hugging Face files, which have no catalog entry). */
function fitBySize(sizeGB: number, hw: Hardware): FitLabel {
  if (sizeGB * 1.2 + 2 > hw.totalRamGB) return 'too-big'
  if (hw.vramGB >= sizeGB + 1.5 || sizeGB <= 2.5) return 'runs-well'
  return 'slow'
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

  const tabs: [Tab, string][] = [
    ['local', 'Run on this PC'],
    ['hf', 'Search Hugging Face'],
    ['online', 'Free online'],
    ['own', 'Your own keys'],
    ['subs', 'Your subscriptions'],
    ['installed', `Installed (${models.length})`]
  ]

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-8 py-7">
        <h1 className="display text-[26px] font-bold">Models</h1>
        <p className="mt-1 mb-5 max-w-2xl text-muted">
          {hw
            ? `This PC has ${hw.totalRamGB} GB of memory${hw.gpuName ? ` and a ${hw.gpuName}${hw.vramGB ? ` with ${hw.vramGB} GB` : ''}` : ', no separate graphics card'}, and ${fmtGB(hw.freeDiskGB)} of free disk. Each model shows how well it fits.`
            : 'Checking this PC…'}
        </p>
        <div className="mb-5 flex gap-5 border-b border-line">
          {tabs.map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 pb-2 text-[13px] font-medium transition-colors ${tab === t ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
              {label}
            </button>
          ))}
        </div>
        {ollama && !ollama.installed && (tab === 'local' || tab === 'hf') && <OllamaMissing onDone={() => invoke('ollama:status').then(setOllama)} />}
        {!catalog || !hw ? (
          <div className="text-muted">Loading…</div>
        ) : tab === 'local' ? (
          <LocalTab catalog={catalog} hw={hw} installed={models} />
        ) : tab === 'hf' ? (
          <HuggingFaceTab hw={hw} installed={models} />
        ) : tab === 'online' ? (
          <OnlineTab catalog={catalog} installed={models} />
        ) : tab === 'own' ? (
          <OwnKeysTab installed={models} />
        ) : tab === 'subs' ? (
          <SubscriptionsTab />
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
      <div className="flex-1">
        Ollama, the free engine that runs models on your PC, isn't installed yet.{msg && <div className="text-[12px] text-warn">{msg}</div>}
      </div>
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

// ---------- download controls shared by the built-in list and Hugging Face ----------

function PullControls({ pullName, sizeGB, hw, installed, tooBig }: { pullName: string; sizeGB: number; hw: Hardware; installed: boolean; tooBig: boolean }) {
  const pull = useStore((s) => s.pulls[pullName]) as PullProgress | undefined
  const pct = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0
  const downloading = pull?.state === 'downloading'
  const paused = pull?.state === 'paused'
  const noDisk = sizeGB + 1 > hw.freeDiskGB
  return (
    <div>
      {(downloading || paused) && (
        <div className="mb-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {paused ? 'Paused' : pull!.status} at {pct}%{pull!.total ? ` of ${fmtGB(pull!.total / 1024 ** 3)}` : ''}
          </div>
        </div>
      )}
      {pull?.state === 'error' && <div className="mb-2 text-[11px] text-bad">{pull.error}</div>}
      <div className="flex gap-2">
        {installed ? (
          <span className="flex items-center gap-1 text-[12px] font-medium text-ok">
            <Check size={14} /> Installed
          </span>
        ) : downloading ? (
          <>
            <button className="btn" onClick={() => invoke('ollama:pause', pullName)}>
              <Pause size={12} /> Pause
            </button>
            <button className="btn" onClick={() => invoke('ollama:cancel', pullName)}>
              <X size={12} /> Cancel
            </button>
          </>
        ) : paused ? (
          <>
            <button className="btn-primary" onClick={() => invoke('ollama:pull', pullName)}>
              <Play size={12} /> Resume
            </button>
            <button className="btn" onClick={() => invoke('ollama:cancel', pullName)}>
              <X size={12} /> Cancel
            </button>
          </>
        ) : (
          <button className="btn-primary" disabled={tooBig || noDisk} title={noDisk ? 'Not enough free disk space' : tooBig ? 'Needs more memory than this PC has' : undefined} onClick={() => invoke('ollama:pull', pullName)}>
            <Download size={12} /> Download {fmtGB(sizeGB)}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- built-in list ----------

function LocalTab({ catalog, hw, installed }: { catalog: Catalog; hw: Hardware; installed: InstalledModel[] }) {
  const [q, setQ] = useState('')
  const [fits, setFits] = useState(true)
  const local = useMemo(() => catalog.models.filter((m) => m.source === 'ollama'), [catalog])
  const shown = local.filter((m) => (!fits || fitLabel(m, hw) !== 'too-big') && (!q || `${m.name} ${m.family} ${m.pullName}`.toLowerCase().includes(q.toLowerCase())))
  const families = [...new Set(shown.map((m) => m.family))]
  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search size={14} className="absolute top-2 left-2.5 text-muted" />
          <input className="input !pl-8" placeholder={`Filter ${local.length} models`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" className="accent-[var(--accent)]" checked={fits} onChange={(e) => setFits(e.target.checked)} /> Only ones that fit this PC
        </label>
        <span className="text-[12px] text-muted">{shown.length} shown</span>
      </div>
      {shown.length === 0 && <div className="text-muted">Nothing matches. Try the Hugging Face tab; it searches far more models.</div>}
      <div className="flex flex-col gap-7">
        {families.map((f) => (
          <section key={f}>
            <h2 className="display mb-2.5 text-[15px] font-semibold">{f}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shown
                .filter((m) => m.family === f)
                .sort((a, b) => a.sizeGB - b.sizeGB)
                .map((m) => (
                  <LocalCard key={m.id} m={m} hw={hw} installed={installed.some((i) => i.id === m.id)} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function LocalCard({ m, hw, installed }: { m: CatalogEntry; hw: Hardware; installed: boolean }) {
  const label = fitLabel(m, hw)
  const fit = FIT[label]
  return (
    <div className="card flex flex-col gap-2 p-3.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{m.name}</div>
          <div className="text-[11.5px] text-muted">
            Needs about {m.minRamGB} GB of memory. Coding score {m.codingScore}.
          </div>
        </div>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ${fit.cls}`}>{fit.text}</span>
      </div>
      {m.description && <div className="text-[12px] text-muted">{m.description}</div>}
      <div className="mt-auto pt-1">
        <PullControls pullName={m.pullName!} sizeGB={m.sizeGB} hw={hw} installed={installed} tooBig={label === 'too-big'} />
      </div>
    </div>
  )
}

// ---------- Hugging Face ----------

function HuggingFaceTab({ hw, installed }: { hw: Hardware; installed: InstalledModel[] }) {
  const [q, setQ] = useState('coder')
  const [list, setList] = useState<HfModel[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setBusy(true)
      setErr('')
      try {
        setList(await invoke('library:searchHF', q))
      } catch (e) {
        setErr(`Couldn't reach Hugging Face (${(e as Error).message}). Check your internet.`)
      }
      setBusy(false)
    }, 350)
  }, [q])

  return (
    <div>
      <p className="mb-4 max-w-2xl text-muted">
        Hugging Face hosts hundreds of thousands of free, open models. Anything published in GGUF format can run on your PC through Ollama. Pick a size that fits; smaller files are faster and a little less accurate.
      </p>
      <div className="relative mb-4 max-w-lg">
        <Search size={14} className="absolute top-2 left-2.5 text-muted" />
        <input className="input !pl-8" autoFocus placeholder="Search, for example: qwen coder, llama 3, deepseek" value={q} onChange={(e) => setQ(e.target.value)} />
        {busy && <Loader2 size={14} className="absolute top-2 right-2.5 animate-spin text-muted" />}
      </div>
      {err && <div className="mb-3 text-bad">{err}</div>}
      <div className="flex flex-col gap-2">
        {list.map((m) => (
          <HfRow key={m.id} m={m} hw={hw} installed={installed} />
        ))}
        {!busy && !err && list.length === 0 && <div className="text-muted">No models found for that search.</div>}
      </div>
    </div>
  )
}

const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

function HfRow({ m, hw, installed }: { m: HfModel; hw: Hardware; installed: InstalledModel[] }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<HfFile[] | null>(null)
  const [err, setErr] = useState('')
  const [author, name] = m.id.split('/')
  const toggle = async () => {
    setOpen(!open)
    if (files || open) return
    try {
      setFiles(await invoke('library:hfFiles', m.id))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  // show the sizes people actually want first: 4-bit, then nearby
  const order = (f: HfFile) => (f.quant.startsWith('Q4_K_M') ? 0 : f.quant.startsWith('Q4') ? 1 : f.quant.startsWith('Q5') ? 2 : f.quant.startsWith('Q6') ? 3 : f.quant.startsWith('Q3') ? 4 : 5)
  return (
    <div className="card">
      <button className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left" onClick={toggle}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block text-[11.5px] text-muted">
            by {author}, {compact(m.downloads)} downloads
            {m.gated && ', needs a Hugging Face login'}
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-3.5 py-3">
          {err && <div className="text-bad">{err}</div>}
          {!files && !err && <div className="text-muted">Looking up sizes…</div>}
          {files?.length === 0 && <div className="text-muted">This repository has no single-file GGUF downloads.</div>}
          <div className="flex flex-col gap-2.5">
            {files
              ?.slice()
              .sort((a, b) => order(a) - order(b) || a.sizeGB - b.sizeGB)
              .slice(0, 6)
              .map((f) => {
                const label = fitBySize(f.sizeGB, hw)
                return (
                  <div key={f.quant} className="flex items-center gap-3">
                    <span className="w-24 font-mono text-[11.5px]">{f.quant}</span>
                    <span className={`w-20 rounded-md px-1.5 py-0.5 text-center text-[10.5px] font-semibold ${FIT[label].cls}`}>{FIT[label].text}</span>
                    <div className="flex-1">
                      <PullControls pullName={f.pullName} sizeGB={f.sizeGB} hw={hw} installed={installed.some((i) => i.model.toLowerCase() === f.pullName.toLowerCase())} tooBig={label === 'too-big'} />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- free online ----------

function OnlineTab({ catalog, installed }: { catalog: Catalog; installed: InstalledModel[] }) {
  const providers = Object.entries(catalog.providers) as [keyof Catalog['providers'], Catalog['providers'][keyof Catalog['providers']]][]
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-muted">
        For PCs that can't run big models. Each service has a free tier: make a free account, paste the key once, and it stays encrypted on this PC. Only free models appear on this tab.
      </p>
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
      <div className="mb-3 flex items-center gap-2">
        <h2 className="display flex-1 text-[15px] font-semibold">{name}</h2>
        <button className="btn" onClick={() => invoke('shell:openExternal', keyUrl)}>
          Get a free key <ExternalLink size={12} />
        </button>
      </div>
      {hasKey ? (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-ok">
          <Check size={14} /> Key saved
          <button
            className="btn-ghost"
            onClick={async () => {
              await invoke('secrets:delete', `key:${id}`)
              setHasKey(false)
              refreshModels()
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="mb-3 flex gap-2">
          <input className="input font-mono" type="password" placeholder="Paste your free key" value={key} onChange={(e) => setKey(e.target.value)} onPaste={(e) => test(e.clipboardData.getData('text'))} />
          <button className="btn" disabled={state.busy || !key} onClick={() => test(key)}>
            {state.busy ? <Loader2 size={12} className="animate-spin" /> : 'Check key'}
          </button>
        </div>
      )}
      {state.msg && <div className={`mb-2 text-[12px] ${state.ok ? 'text-ok' : 'text-bad'}`}>{state.msg}</div>}
      <div className="flex flex-col">
        {models.map((m) => (
          <ModelToggle key={m.id} id={m.id} label={m.name} detail={`coding score ${m.codingScore}`} disabled={!hasKey} on={installed.some((i) => i.id === m.id)} />
        ))}
      </div>
      {id === 'openrouter' && <OpenRouterFree hasKey={hasKey} installed={installed} known={new Set(models.map((m) => m.endpointModel!))} />}
    </div>
  )
}

function ModelToggle({ id, label, detail, disabled, on }: { id: string; label: string; detail?: string; disabled: boolean; on: boolean }) {
  return (
    <label className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${disabled ? 'opacity-60' : 'hover:bg-panel2'}`}>
      <input
        type="checkbox"
        className="accent-[var(--accent)]"
        disabled={disabled}
        checked={on}
        onChange={async (e) => {
          await invoke('models:connectHosted', id, e.target.checked)
          refreshModels()
        }}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="text-[11px] text-muted">{detail}</span>}
    </label>
  )
}

/** Every model OpenRouter currently offers for free, fetched live. */
function OpenRouterFree({ hasKey, installed, known }: { hasKey: boolean; installed: InstalledModel[]; known: Set<string> }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<OpenRouterModel[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (open && !list) invoke('library:openrouter').then((l) => setList(l.filter((m) => m.free && !known.has(m.id)))).catch(() => setList([]))
  }, [open])
  const shown = (list ?? []).filter((m) => !q || `${m.name} ${m.id}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="mt-2 border-t border-line pt-2">
      <button className="flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Every free model on OpenRouter right now{list ? ` (${list.length})` : ''}
      </button>
      {open && (
        <div className="mt-2">
          {!list ? (
            <div className="text-muted">Loading the live list…</div>
          ) : (
            <>
              <input className="input mb-1.5 max-w-xs" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="max-h-72 overflow-auto">
                {shown.map((m) => (
                  <ModelToggle key={m.id} id={`or:${m.id}`} label={m.name.replace(/\s*\(free\)$/i, '')} detail={`${Math.round(m.contextTokens / 1000)}k context`} disabled={!hasKey} on={installed.some((i) => i.id === `or:${m.id}`)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- your own keys ----------

const PRESETS: { name: string; baseUrl: string; keyUrl?: string; note?: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  { name: 'OpenRouter (all models)', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys' },
  { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { name: 'Fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', keyUrl: 'https://fireworks.ai/account/api-keys' },
  { name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai' },
  { name: 'LM Studio (on this PC)', baseUrl: 'http://localhost:1234/v1', note: 'No key needed.' }
]

function OwnKeysTab({ installed }: { installed: InstalledModel[] }) {
  const [providers, setProviders] = useState<CustomProvider[]>([])
  const [form, setForm] = useState<{ name: string; baseUrl: string; key: string; keyUrl?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [fresh, setFresh] = useState<{ id: string; models: string[] } | null>(null)
  const load = () => invoke('custom:list').then(setProviders)
  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    if (!form) return
    setBusy(true)
    const r = await invoke('custom:save', { name: form.name, baseUrl: form.baseUrl, key: form.key })
    setBusy(false)
    setMsg({ ok: r.ok, text: r.message })
    if (r.ok) {
      setFresh({ id: r.id, models: r.models })
      setForm(null)
      load()
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-2xl text-muted">
        Already pay for an AI service? Add it here with your own API key and its models join your team. The provider bills you for what you use; Hive adds nothing on top. Keys are encrypted on this PC and never shared with teammates.
      </p>
      <div>
        <div className="label mb-2">Add a provider</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip hover:border-accent hover:text-fg" onClick={() => (setMsg(null), setForm({ name: p.name, baseUrl: p.baseUrl, key: '', keyUrl: p.keyUrl }))}>
              <Plus size={11} /> {p.name}
            </button>
          ))}
          <button className="chip hover:border-accent hover:text-fg" onClick={() => (setMsg(null), setForm({ name: '', baseUrl: 'https://', key: '' }))}>
            <Plus size={11} /> Another OpenAI-compatible service
          </button>
        </div>
      </div>

      {form && (
        <div className="card flex flex-col gap-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <div className="label mb-1">Name</div>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              <div className="label mb-1">API address</div>
              <input className="input font-mono" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </label>
          </div>
          <label>
            <div className="label mb-1 flex items-center gap-2">
              API key
              {form.keyUrl && (
                <button type="button" className="flex items-center gap-1 font-normal text-accent" onClick={() => invoke('shell:openExternal', form.keyUrl!)}>
                  Where do I find it? <ExternalLink size={11} />
                </button>
              )}
            </div>
            <input className="input font-mono" type="password" placeholder="Paste the key from your account" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          </label>
          {msg && !msg.ok && <div className="text-[12px] text-bad">{msg.text}</div>}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || !form.baseUrl} onClick={save}>
              {busy && <Loader2 size={12} className="animate-spin" />} Connect
            </button>
            <button className="btn" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg?.ok && <div className="text-[12px] text-ok">{msg.text} Switch on the models you want below.</div>}

      {providers.map((p) => (
        <OwnProvider key={p.id} p={p} installed={installed} preload={fresh?.id === p.id ? fresh.models : undefined} onChange={load} />
      ))}
      {providers.length === 0 && !form && <div className="text-muted">No providers added yet.</div>}
    </div>
  )
}

function OwnProvider({ p, installed, preload, onChange }: { p: CustomProvider; installed: InstalledModel[]; preload?: string[]; onChange: () => void }) {
  const [available, setAvailable] = useState<string[] | null>(preload ?? null)
  const [q, setQ] = useState('')
  const [manual, setManual] = useState('')
  const [open, setOpen] = useState(!!preload || p.models.length === 0)
  useEffect(() => {
    if (open && !available) invoke('custom:models', p.id).then(setAvailable).catch(() => setAvailable([]))
  }, [open])
  const set = async (models: string[]) => {
    await invoke('custom:setModels', p.id, models)
    onChange()
    refreshModels()
  }
  const toggle = (m: string, on: boolean) => set(on ? [...p.models, m] : p.models.filter((x) => x !== m))
  const all = [...new Set([...p.models, ...(available ?? [])])]
  const shown = all.filter((m) => !q || m.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="display text-[15px] font-semibold">{p.name}</span>
          <span className="truncate font-mono text-[11px] text-muted">{p.baseUrl.replace(/^https?:\/\//, '')}</span>
        </button>
        <span className="text-[11.5px] text-muted">{p.models.length} switched on</span>
        <button
          className="btn-ghost"
          title="Remove this provider and its key"
          onClick={async () => {
            if (!confirm(`Remove ${p.name} and its key from this PC?`)) return
            await invoke('custom:remove', p.id)
            onChange()
            refreshModels()
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <div className="mt-3">
          {!available ? (
            <div className="text-muted">Loading the model list…</div>
          ) : (
            <>
              {all.length > 8 && <input className="input mb-2 max-w-xs" placeholder={`Filter ${all.length} models`} value={q} onChange={(e) => setQ(e.target.value)} />}
              <div className="max-h-64 overflow-auto">
                {shown.map((m) => (
                  <label key={m} className="flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-panel2">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={p.models.includes(m)} onChange={(e) => toggle(m, e.target.checked)} />
                    <span className="truncate font-mono text-[12px]">{m}</span>
                    {installed.some((i) => i.id === `custom:${p.id}:${m}`) && <span className="text-[11px] text-ok">in your team</span>}
                  </label>
                ))}
              </div>
              <form
                className="mt-2 flex max-w-md gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (manual.trim()) toggle(manual.trim(), true)
                  setManual('')
                }}
              >
                <input className="input font-mono" placeholder="Or type a model name exactly" value={manual} onChange={(e) => setManual(e.target.value)} />
                <button className="btn" disabled={!manual.trim()}>
                  Add
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- installed ----------

function InstalledTab({ installed }: { installed: InstalledModel[] }) {
  const toast = useStore((s) => s.toast)
  const [testing, setTesting] = useState<string | null>(null)
  if (!installed.length) return <div className="text-muted">Nothing yet. Download a model, or connect an online one.</div>
  const disk = installed.reduce((a, m) => a + m.sizeGB, 0)
  const where = (m: InstalledModel) => (m.source === 'ollama' ? `On this PC, ${fmtGB(m.sizeGB)}` : m.source === 'custom' ? 'Your own key' : `Free online (${m.source})`)
  return (
    <div>
      <div className="mb-3 text-muted">Models on this PC use {fmtGB(disk)} of disk.</div>
      <div className="flex flex-col gap-2">
        {installed.map((m) => (
          <div key={m.id} className="card flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{m.name}</div>
              <div className="text-[11.5px] text-muted">{where(m)}</div>
            </div>
            <label className="flex items-center gap-1.5 text-[12px] text-muted">
              Role
              <select
                className="input !w-auto !py-1"
                value={m.tier}
                onChange={async (e) => {
                  await invoke('models:setTier', m.id, e.target.value as Tier)
                  refreshModels()
                }}
              >
                <option value="top">Architect</option>
                <option value="lead">Reviewer</option>
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
                  toast(`${m.name} answered: ${reply.slice(0, 120)}`, 'ok')
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
                  if (!confirm(`Delete ${m.name} from this PC? This frees ${fmtGB(m.sizeGB)}. You can download it again later.`)) return
                  try {
                    await invoke('ollama:delete', m.model)
                    toast(`Deleted ${m.name} (${fmtGB(m.sizeGB)} freed).`, 'ok')
                  } catch (e) {
                    toast(`Couldn't delete ${m.name}: ${(e as Error).message}. Is Ollama running?`, 'error')
                  }
                  refreshModels()
                }}
                aria-label="Delete model"
              >
                <Trash2 size={12} />
              </button>
            ) : m.source !== 'custom' ? (
              <button
                className="btn"
                onClick={async () => {
                  await invoke('models:connectHosted', m.id, false)
                  refreshModels()
                }}
              >
                Disconnect
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- coding-agent CLIs the user already pays for ----------

type CliAgentRow = { source: 'claude-code' | 'codex'; name: string; version: string | null; enabled: boolean; installUrl: string }

function SubscriptionsTab() {
  const [rows, setRows] = useState<CliAgentRow[] | null>(null)
  const load = () => invoke('models:cliAgents').then(setRows)
  useEffect(() => {
    load()
  }, [])
  const toggle = async (r: CliAgentRow) => {
    await invoke('models:setCliAgent', r.source, !r.enabled)
    await load()
    refreshModels()
  }
  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-muted">
        Already pay for Claude or ChatGPT? Turn on its coding CLI and the AI team can use it: it plans, reviews and
        builds whole tasks with your own subscription, so no free daily limit applies. Hive starts the official CLI on
        this PC and it signs in with your account. Hive never sees your password or token. Each task uses some of
        your plan's usage.
      </p>
      {!rows ? (
        <div className="text-muted">Looking for installed CLIs…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <div key={r.source} className="card flex items-center gap-4 p-4">
              <div className="flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-[12px] text-muted">
                  {r.version ? `Installed (${r.version}). Sign in once by running it in a terminal.` : 'Not installed on this PC.'}
                </div>
              </div>
              {r.version ? (
                <label className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={r.enabled} onChange={() => toggle(r)} /> Use in the AI team
                </label>
              ) : (
                <button className="btn" onClick={() => invoke('shell:openExternal', r.installUrl)}>
                  <ExternalLink size={12} /> How to install
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
