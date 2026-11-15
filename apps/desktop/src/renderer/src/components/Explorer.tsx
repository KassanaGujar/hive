import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, File, FileCode, FileJson, FilePlus, FileText, FolderPlus, Image, RefreshCw } from 'lucide-react'
import { makeFeedEvent } from '@hive/collab'
import type { FileNode } from '@hive/shared'
import { invoke, on } from '../lib/api'
import { useStore, ask, actorName } from '../store'
import { refreshTree, renameFile, deleteFile } from '../lib/actions'
import { disposeModel, renameModel } from '../lib/monaco'
import { session } from '../collab/session'

const FILE_ICON: Record<string, string> = {
  ts: '🟦', tsx: '🟦', js: '🟨', jsx: '🟨', json: '🧾', md: '📝', html: '🌐', css: '🎨', py: '🐍', go: '🐹', rs: '🦀', java: '☕', c: '©', cpp: '➕', png: '🖼', jpg: '🖼', svg: '🖼'
}
const TINT: Record<string, string> = { ts: '#6aa7e8', tsx: '#6aa7e8', js: '#e8c14a', jsx: '#e8c14a', mjs: '#e8c14a', html: '#f08a5d', css: '#63cdc4', scss: '#63cdc4', py: '#86d07d', go: '#63cdc4', rs: '#e0946a', java: '#e0946a', json: '#c9a86a', md: '#a69a86' }
function FileIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const Icon = ext === 'json' ? FileJson : ext === 'md' || ext === 'txt' ? FileText : /^(png|jpe?g|gif|svg|webp|ico)$/.test(ext) ? Image : ext in TINT ? FileCode : File
  return <Icon size={14} className="shrink-0" style={{ color: TINT[ext] ?? 'var(--muted)' }} />
}

function feed(kind: 'file.created' | 'file.renamed' | 'file.deleted', files: string[]) {
  const s = session()
  if (s && !s.shared) s.pushFeed(makeFeedEvent({ actor: actorName(), kind, files }))
}

export function Explorer() {
  const projectTree = useStore((s) => s.tree)
  const explorerRoot = useStore((s) => s.explorerRoot)
  const [agentTree, setAgentTree] = useState<FileNode[]>([])
  useEffect(() => {
    if (!explorerRoot) return
    const load = () => invoke('fs:treeAt', explorerRoot.dir).then(setAgentTree).catch(() => setAgentTree([]))
    load()
    const off = on('agents:file', load)
    const t = setInterval(load, 4000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [explorerRoot?.dir])
  const tree = explorerRoot ? agentTree : projectTree
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Live refresh when files change on disk (debounced).
  useEffect(
    () =>
      on('fs:changed', (e) => {
        if (e.kind === 'change') return
        clearTimeout(timer.current)
        timer.current = setTimeout(refreshTree, 200)
      }),
    []
  )

  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => toast(e.message, 'error'))
  const parentOf = (node: FileNode | null) => (node ? (node.type === 'dir' ? node.path : node.path.split('/').slice(0, -1).join('/')) : explorerRoot?.dir ?? '')
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

  const newItem = (type: 'file' | 'dir', node: FileNode | null) =>
    guard(async () => {
      const name = await ask(type === 'file' ? 'New file name' : 'New folder name', '', type === 'file' ? 'index.html' : 'src')
      if (!name) return
      const rel = join(parentOf(node), name)
      await invoke('fs:create', rel, type)
      feed('file.created', [rel])
      await refreshTree()
      if (node?.type === 'dir') setOpen((o) => new Set(o).add(node.path))
      if (type === 'file') useStore.getState().openFile(rel)
    })

  const renameItem = (node: FileNode) =>
    guard(async () => {
      const name = await ask('Rename to', node.name)
      if (!name || name === node.name) return
      const to = join(node.path.split('/').slice(0, -1).join('/'), name)
      await moveTo(node, to)
    })

  const moveTo = (node: FileNode, to: string) => renameFile(node.path, to)

  const deleteItem = (node: FileNode) =>
    guard(async () => {
      if (!confirm(`Move "${node.path}" to the ${navigator.userAgent.includes('Mac') ? 'Trash' : 'Recycle Bin'}?`)) return
      await deleteFile(node.path)
    })

  const render = (nodes: FileNode[], depth: number): React.ReactNode =>
    nodes.map((n) => {
      const isOpen = open.has(n.path)
      return (
        <div key={n.path}>
          <div
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/hive-path', JSON.stringify(n))}
            onDragOver={(e) => n.type === 'dir' && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const src = JSON.parse(e.dataTransfer.getData('text/hive-path') || 'null') as FileNode | null
              if (!src || n.type !== 'dir' || src.path === n.path || n.path.startsWith(src.path + '/')) return
              guard(() => moveTo(src, `${n.path}/${src.name}`))
            }}
            onClick={() => {
              if (n.type === 'dir') setOpen((o) => (o.has(n.path) ? (o.delete(n.path), new Set(o)) : new Set(o).add(n.path)))
              else useStore.getState().openFile(n.path)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, node: n })
            }}
            className="mx-1 flex cursor-pointer items-center gap-1.5 truncate rounded-md py-[3px] pr-2 hover:bg-panel2"
            style={{ paddingLeft: 6 + depth * 12 }}
            title={n.path}
          >
            {n.type === 'dir' ? (isOpen ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />) : <FileIcon name={n.name} />}
            <span className="truncate">{n.name}</span>
          </div>
          {n.type === 'dir' && isOpen && n.children && render(n.children, depth + 1)}
        </div>
      )
    })

  return (
    <div className="flex h-full flex-col" onClick={() => setMenu(null)}>
      <div className="flex h-9 items-center gap-1 px-3">
        <span className="pane-title flex-1">Files</span>
        <button className="btn-ghost" title="New file" onClick={() => newItem('file', null)}>
          <FilePlus size={14} />
        </button>
        <button className="btn-ghost" title="New folder" onClick={() => newItem('dir', null)}>
          <FolderPlus size={14} />
        </button>
        <button className="btn-ghost" title="Refresh" onClick={refreshTree}>
          <RefreshCw size={13} />
        </button>
      </div>
      {explorerRoot && (
        <div className="mx-2 mb-1.5 rounded-lg border border-wing/40 bg-wing/10 px-2.5 py-2 text-[11.5px] leading-snug">
          <div>
            You're looking at <b className="text-wing">{explorerRoot.label}</b>, not your project yet. You can open and edit these files.
          </div>
          <button className="mt-1.5 font-semibold text-wing hover:underline" onClick={() => useStore.getState().set({ explorerRoot: null })}>
            Back to my project
          </button>
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-auto pb-8"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, node: null })
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const src = JSON.parse(e.dataTransfer.getData('text/hive-path') || 'null') as FileNode | null
          if (src && src.path.includes('/')) guard(() => moveTo(src, src.name))
        }}
      >
        {tree.length === 0 ? <div className="p-3 text-muted">Empty folder. Right-click to add a file, or ask the agents to build something.</div> : render(tree, 0)}
      </div>
      {menu && (
        <div className="fixed z-50 min-w-40 rounded-md border border-line bg-panel py-1 shadow-xl" style={{ left: menu.x, top: menu.y }}>
          <MenuItem label="New file" onClick={() => newItem('file', menu.node)} />
          <MenuItem label="New folder" onClick={() => newItem('dir', menu.node)} />
          {menu.node && (
            <>
              <MenuItem label="Rename" onClick={() => renameItem(menu.node!)} />
              <MenuItem label="Delete" onClick={() => deleteItem(menu.node!)} danger />
              {menu.node.type === 'file' && <MenuItem label="Open to the side" onClick={() => (useStore.getState().splitRight(), useStore.getState().openFile(menu.node!.path, undefined, 1))} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`block w-full px-3 py-1 text-left hover:bg-panel2 ${danger ? 'text-bad' : ''}`} onClick={onClick}>
      {label}
    </button>
  )
}
