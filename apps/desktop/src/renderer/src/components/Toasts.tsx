import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <>
      <div className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-lg ${
              t.kind === 'error' ? 'border-bad/50 bg-panel text-fg' : t.kind === 'ok' ? 'border-ok/50 bg-panel' : 'border-line bg-panel'
            }`}
          >
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.kind === 'error' ? 'bg-bad' : t.kind === 'ok' ? 'bg-ok' : 'bg-accent'}`} />
            <div className="flex-1 leading-snug">
              {t.text}
              {t.action && (
                <button className="mt-1 block font-semibold text-accent" onClick={() => (t.action!.run(), dismiss(t.id))}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button className="text-muted hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <AskDialog />
    </>
  )
}

function AskDialog() {
  const ask = useStore((s) => s.ask)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ask) {
      setValue(ask.initial)
      setTimeout(() => ref.current?.select(), 0)
    }
  }, [ask])
  if (!ask) return null
  const done = (v: string | null) => {
    ask.resolve(v)
    useStore.getState().set({ ask: null })
  }
  return (
    <Modal onClose={() => done(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          done(value.trim() || null)
        }}
        className="flex flex-col gap-3"
      >
        <div className="text-[14px] font-semibold">{ask.title}</div>
        <input ref={ref} className="input" value={value} placeholder={ask.placeholder} onChange={(e) => setValue(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn-primary">OK</button>
        </div>
      </form>
    </Modal>
  )
}

export function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card max-h-[85vh] overflow-auto p-5 shadow-2xl ${wide ? 'w-[640px]' : 'w-[420px]'}`}>{children}</div>
    </div>
  )
}
