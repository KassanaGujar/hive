import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { HiveProvider, openInvite, parseInvite, type InviteInfo } from '@hive/collab'
import { invoke } from '../lib/api'
import { useStore } from '../store'
import { Modal } from './Toasts'
import { ProjectSession } from '../collab/session'
import { openProject } from '../lib/actions'

/**
 * Join a friend's project with a link (carries the room key) or a 6-character code (looks up the
 * sealed invite on the relay).
 */
export function JoinDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const settings = useStore((s) => s.settings)!
  const [text, setText] = useState(initial)
  const [relay, setRelay] = useState(settings.relayUrl)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const parsed = parseInvite(text)
  const codeOnly = !!parsed.code && !parsed.roomKey

  const join = async () => {
    setBusy(true)
    setErr('')
    try {
      let info: InviteInfo
      if (parsed.roomKey && parsed.roomId && parsed.relayUrl) {
        info = { relayUrl: parsed.relayUrl, roomId: parsed.roomId, roomKey: parsed.roomKey, projectName: parsed.projectName ?? 'project', role: parsed.role ?? 'editor', editToken: parsed.editToken }
      } else if (parsed.code) {
        const sealed = await HiveProvider.fetchInvite(relay, parsed.code)
        if (!sealed) throw new Error('That code was not found or has expired (codes last 24 hours). Ask for a new one.')
        info = await openInvite(parsed.code, sealed)
      } else throw new Error('Paste an invite link or type the 6-character code.')

      const parent = await invoke('dialog:openFolder')
      if (!parent) return setBusy(false)
      const dir = await invoke('project:create', parent, info.projectName, { empty: true }).catch(async (e: Error) => {
        if (/already exists/.test(e.message)) return `${parent}${parent.endsWith('\\') || parent.endsWith('/') ? '' : '/'}${info.projectName}`
        throw e
      })
      await invoke('project:open', dir)
      await ProjectSession.prepareJoin(dir, info)
      await openProject(dir)
      if (relay !== settings.relayUrl && codeOnly) useStore.getState().set({ settings: await invoke('settings:set', { relayUrl: relay }) })
      useStore.getState().set({ page: 'people' })
      useStore.getState().toast(`Joined ${info.projectName}. Files are syncing…`, 'ok')
      onClose()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-semibold">Join a friend's project</div>
        <div>
          <div className="label mb-1">Invite link or code</div>
          <input className="input font-mono text-[13px]" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="hive://join?…  or  ABC123" />
        </div>
        {codeOnly && (
          <div>
            <div className="label mb-1">Relay server (ask your host)</div>
            <input className="input font-mono" value={relay} onChange={(e) => setRelay(e.target.value)} />
          </div>
        )}
        <div className="text-[11px] text-muted">You'll pick a folder on this PC; the project's files are copied into it and stay in sync.</div>
        {err && <div className="text-[12px] text-bad">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !text.trim()} onClick={join}>
            {busy && <Loader2 size={14} className="animate-spin" />} Join
          </button>
        </div>
      </div>
    </Modal>
  )
}
