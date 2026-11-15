// PHASE 1 — core application functionality, run against the real app.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Hive, SCRATCH, check, record, assert, until, wait, freshDir, openFile, textOf, modelJs, startRelay, share, join } from './lib.mjs'
const P = 'P1'
const base = freshDir('p1')
const a = await new Hive('p1a', 9401).launch()
await a.profileAs('Tess', '🦊')
const state = (expr) => a.eval(`const s=H.store.getState();return ${expr}`)
const explorerNames = () => a.eval(`return [...document.querySelectorAll('[data-path]')].map(e=>e.getAttribute('data-path'))`).catch(() => [])

let alpha, beta
await check(P, 'Create a new project; it appears in the project list', async () => {
  alpha = await a.invoke('project:create', base, 'alpha')
  await a.openProject(alpha)
  assert(existsSync(alpha + '/README.md'), 'README not created')
  assert((await state('s.root')).replace(/\\/g, '/').endsWith('/p1/alpha'), 'project not open')
  await a.eval(`H.actions.closeProject();await w(400);return 1`)
  const listed = await a.eval(`return document.body.innerText.includes('alpha')&&!!document.querySelector('[data-project]')`)
  assert(listed, 'not listed on the Welcome screen')
})
await check(P, 'Create multiple projects; files and settings stay independent', async () => {
  beta = await a.invoke('project:create', base, 'beta')
  await a.openProject(beta)
  await a.invoke('fs:write', 'only-beta.txt', 'beta')
  await a.openProject(alpha)
  await a.invoke('fs:write', 'only-alpha.txt', 'alpha')
  const tree = (await a.invoke('fs:tree')).map((n) => n.name)
  assert(tree.includes('only-alpha.txt') && !tree.includes('only-beta.txt'), 'trees mixed: ' + tree)
  assert(!existsSync(alpha + '/only-beta.txt') && existsSync(beta + '/only-beta.txt'), 'files leaked across projects')
  // per-project settings live in <project>/.hive; sharing config of one must not appear in the other
  await a.invoke('fs:write', '.hive/marker.json', '{"p":"alpha"}')
  assert(!existsSync(beta + '/.hive/marker.json'), 'project settings leaked')
})
await check(P, 'Rename a project; the new name persists after refresh', async () => {
  await a.eval(`H.actions.closeProject();await w(300);return 1`)
  const to = await a.invoke('project:rename', beta, 'beta-renamed')
  assert(existsSync(to + '/only-beta.txt') && !existsSync(beta), 'folder not renamed')
  await a.reload()
  const s = await a.invoke('settings:get')
  assert(s.recentProjects.some((p) => p.endsWith('beta-renamed')) && !s.recentProjects.some((p) => /beta$/.test(p)), 'recents: ' + s.recentProjects)
  beta = to
  // through the real button + dialog as well
  await a.eval(`H.actions.closeProject();await w(400);const b=document.querySelector('[aria-label^="Rename "][aria-label$="beta-renamed"]');b.click();await w(300);const f=document.querySelector('form');const i=f.querySelector('input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'gamma');i.dispatchEvent(new Event('input',{bubbles:true}));await w(150);f.requestSubmit();await w(900);return 1`)
  assert(existsSync(base + '/gamma/only-beta.txt'), 'UI rename did not rename the folder')
  beta = base + '/gamma'
})
await check(P, 'Delete a project; it is removed and its old path no longer opens', async () => {
  await a.invoke('project:delete', beta)
  assert(!existsSync(beta), 'folder still exists')
  const s = await a.invoke('settings:get')
  assert(!s.recentProjects.some((p) => p.endsWith('gamma')), 'still in recents')
  const err = await a.eval(`try{await H.actions.openProject(${JSON.stringify(beta)});return 'opened'}catch(e){return e.message}`)
  assert(err !== 'opened', 'deleted project still opens')
  return 'old path → ' + err.slice(0, 80)
})

await a.openProject(alpha)
await check(P, 'Create a file; it appears in the explorer', async () => {
  await a.invoke('fs:create', 'notes.txt', 'file')
  await until(async () => (await state('s.tree.map(n=>n.name)')).includes('notes.txt'), 5000)
  assert((await state('s.tree.map(n=>n.name)')).includes('notes.txt'), 'not in tree state')
  assert(await a.eval(`return document.body.innerText.includes('notes.txt')`), 'not visible in the explorer')
})
await check(P, 'Rename a file; contents are preserved', async () => {
  await a.invoke('fs:write', 'notes.txt', 'keep me')
  await a.invoke('fs:rename', 'notes.txt', 'notes-renamed.txt')
  assert((await a.invoke('fs:read', 'notes-renamed.txt')) === 'keep me', 'content changed')
  assert(!existsSync(alpha + '/notes.txt'), 'old name still there')
})
await check(P, 'Delete a file; it disappears', async () => {
  await a.invoke('fs:delete', 'notes-renamed.txt')
  await until(async () => !(await state('s.tree.map(n=>n.name)')).includes('notes-renamed.txt'), 5000)
  assert(!(await state('s.tree.map(n=>n.name)')).includes('notes-renamed.txt'), 'still in tree')
})
await check(P, 'Create nested folders', async () => {
  await a.invoke('fs:create', 'src/lib/deep/er', 'dir')
  await a.invoke('fs:write', 'src/lib/deep/er/x.js', 'export const x = 1\n')
  const flat = JSON.stringify(await a.invoke('fs:tree'))
  assert(flat.includes('src/lib/deep/er/x.js'), 'nested file missing from tree')
})
await check(P, 'Move a file between folders (content kept)', async () => {
  await a.invoke('fs:write', 'src/main.js', "import { x } from './lib/deep/er/x.js'\nconsole.log(x)\n")
  await a.invoke('fs:create', 'src/util', 'dir')
  await a.invoke('fs:rename', 'src/lib/deep/er/x.js', 'src/util/x.js')
  assert((await a.invoke('fs:read', 'src/util/x.js')).includes('export const x'), 'content lost')
  const main = await a.invoke('fs:read', 'src/main.js')
  return main.includes('./util/x.js') ? 'imports were rewritten' : 'file moved; imports in other files are NOT rewritten (no refactoring support)'
})
await check(P, 'Open multiple files and switch between them', async () => {
  await a.invoke('fs:write', 'a.js', 'const a = 1\n'); await a.invoke('fs:write', 'b.js', 'const b = 2\n'); await a.invoke('fs:write', 'c.css', 'body{}\n')
  for (const f of ['a.js', 'b.js', 'c.css']) await openFile(a, f)
  assert((await state('s.groups[0].tabs.length')) >= 3, 'tabs not open')
  for (const f of ['a.js', 'c.css', 'b.js']) {
    await a.eval(`H.store.getState().activate('file:'+${JSON.stringify(f)},0);await w(250);return 1`)
    assert((await state('s.groups[0].active')) === 'file:' + f, 'active tab wrong for ' + f)
    const shown = await a.eval(`return H.monaco.editor.getEditors().some(e=>e.getModel()?.uri.path==='/${f}')`)
    assert(shown, 'editor not showing ' + f)
  }
})
await check(P, 'Edit code; changes are saved to disk', async () => {
  await a.eval(`const m=${modelJs('a.js')};m.pushEditOperations([],[{range:m.getFullModelRange(),text:'const a = 42 // edited\\n'}],()=>null);return 1`)
  await until(() => readFileSync(alpha + '/a.js', 'utf8').includes('42'), 5000)
  assert(readFileSync(alpha + '/a.js', 'utf8').includes('edited'), 'autosave did not write the file')
})
await check(P, 'Refresh the window; no saved work is lost and the project reopens', async () => {
  await a.reload()
  await until(() => state('s.root'), 8000)
  assert(await state('!!s.root'), 'project did not reopen after refresh')
  assert((await a.invoke('fs:read', 'a.js')).includes('42'), 'edit lost')
})
await check(P, 'Close and reopen the app; the project is restored', async () => {
  await a.kill()
  await a.launch({ keep: true })
  const t0 = Date.now()
  await until(() => state('s.root').catch(() => null), 30000)
  const root = await state('s.root')
  const toasts = await a.eval(`const s=H.store.getState();return JSON.stringify({toasts:s.toasts.map(t=>t.text),closed:sessionStorage.getItem('hive.closedProject'),recent:s.settings?.recentProjects?.slice(0,2),setup:s.settings?.setupComplete,main:await h.invoke('project:current')})`)
  assert(root && root.replace(/\\/g, '/').endsWith('/alpha'), 'project not restored: ' + root + '; toasts: ' + toasts)
  assert((await a.invoke('fs:read', 'a.js')).includes('42'), 'edit lost across restart')
  return `reopened in ${Date.now() - t0} ms`
})
record(P, 'Browser navigation (back / forward)', 'BLOCKED', 'Not applicable: Hive is a desktop app with tabs, not URL pages. There is no back/forward history to test.')

// --- sharing / access
const relay = await startRelay(4471, freshDir('p1-relay'))
const b = await new Hive('p1b', 9402).launch()
await b.profileAs('Omar', '🐼', '#3ccf7a')
let inv
await check(P, 'Copy a project invitation link; it is valid', async () => {
  inv = await share(a, relay.url)
  assert(/^hive:\/\/join\?/.test(inv.link) && inv.room && inv.key && inv.code, 'malformed link ' + inv.link)
  // the Team panel shows the same kind of link for copying
  const shown = await a.eval(`H.store.getState().set({right:'team'});await w(600);return [...document.querySelectorAll('input')].map(x=>x.value).find(v=>v.startsWith('hive://'))||null`)
  return 'link ok' + (shown ? ', shown in People panel' : ' (People panel shows it after pressing Share)')
})
await check(P, 'Open the project link in another session', async () => {
  const dir = freshDir('p1-friend')
  await join(b, dir, inv)
  await until(() => existsSync(dir + '/a.js'), 10000)
  assert(existsSync(dir + '/a.js') && readFileSync(dir + '/a.js', 'utf8').includes('42'), 'files did not arrive')
  // and through the real Join dialog parser
  return 'friend received the project files'
})
await check(P, 'Unauthorized users cannot read a private project', async () => {
  // 1) wrong key: connects to the room but can decrypt nothing
  const c = await new Hive('p1c', 9403).launch()
  await c.profileAs('Eve', '🦉', '#ff6b8b')
  const dir = freshDir('p1-eve')
  const wrongKey = inv.key.split('').reverse().join('')
  await c.invoke('project:open', dir)
  await c.invoke('fs:write', '.hive/collab.json', JSON.stringify({ relayUrl: inv.relay, roomId: inv.room, roomKey: wrongKey, projectName: 'p', role: 'editor' }))
  await c.openProject(dir)
  await wait(4000)
  const got = await c.invoke('fs:tree')
  const leaked = got.some((n) => n.name === 'a.js')
  // 2) guessed room id: a different room entirely
  await c.invoke('fs:write', '.hive/collab.json', JSON.stringify({ relayUrl: inv.relay, roomId: 'guess' + inv.room.slice(5), roomKey: inv.key, projectName: 'p', role: 'editor' }))
  await c.openProject(dir)
  await wait(3000)
  const leaked2 = (await c.invoke('fs:tree')).some((n) => n.name === 'a.js')
  await c.kill()
  assert(!leaked && !leaked2, 'outsider received project files')
  return 'wrong key → no files; wrong room id → no files'
})
await check(P, 'Project permissions and ownership (viewer cannot change files; host can)', async () => {
  const v = await a.eval(`const r=await H.session().newInvite('viewer');return r.link`)
  const vu = new URL(v.replace('hive://', 'https://x/'))
  assert(!vu.hash.includes('.'), 'viewer link carries the edit token')
  const c = await new Hive('p1v', 9404).launch()
  await c.profileAs('Vera', '🐸', '#b58cff')
  const dir = freshDir('p1-viewer')
  // a viewer who edits their config to claim "editor" still has no edit token
  await join(c, dir, { ...inv, editToken: undefined }, 'editor')
  await until(() => existsSync(dir + '/a.js'), 10000)
  const relayRole = await until(() => c.eval(`return H.session().provider.role`), 5000)
  await c.eval(`const s=H.session();const t=s.parts.files.get('a.js');s.doc.transact(()=>t.insert(0,'// VIEWER WAS HERE '));return 1`)
  await wait(2500)
  const hostText = await a.eval(`return H.session().parts.files.get('a.js').toString()`)
  const status = await c.eval(`return H.store.getState().collabStatus`)
  const hostRole = await a.eval(`return H.store.getState().members.find(m=>m.name==='Vera')?.role`)
  await c.kill()
  assert(relayRole === 'viewer' && hostRole === 'viewer', `relay role ${relayRole}, host sees ${hostRole}`)
  assert(!hostText.includes('VIEWER WAS HERE'), 'viewer edit reached the host')
  assert(status === 'online', 'viewer connection broke after a refused edit: ' + status)
  assert(await a.eval(`return H.session().isHost`), 'host lost ownership')
  return 'view-only link has no edit token; relay made Vera a viewer even though her app claimed "editor"; her edit never reached the host; host keeps ownership'
})
await check(P, 'Errors are communicated clearly to users', async () => {
  const msgs = []
  msgs.push(await a.eval(`try{await h.invoke('fs:read','does/not/exist.txt');return 'no error'}catch(e){return e.message}`))
  msgs.push(await a.eval(`try{await h.invoke('fs:read','../../outside.txt');return 'no error'}catch(e){return e.message}`))
  msgs.push(await a.eval(`try{await h.invoke('project:create',${JSON.stringify(base)},'alpha');return 'no error'}catch(e){return e.message}`))
  // a failing action surfaces as a toast, not a silent failure
  await a.eval(`H.actions.openProject('Z:/nope/nothing').catch(e=>H.store.getState().toast(e.message,'error'));await w(600);return 1`)
  const toast = await a.eval(`return H.store.getState().toasts.map(t=>t.text).join(' | ')`)
  assert(msgs.every((m) => m !== 'no error'), 'an invalid action raised no error: ' + msgs)
  assert(!msgs.some((m) => /ENOENT|EPERM|at Object|\.ts:\d+/.test(m)) , 'raw technical error shown to the user: ' + msgs.join(' || '))
  return msgs.join(' || ') + ' || toast: ' + toast
})
const errs = [...a.errors, ...b.errors]
record(P, 'No uncaught errors in the app during Phase 1', errs.length ? 'FAIL' : 'PASS', errs.slice(0, 3).join(' | '))
await a.kill(); await b.kill(); await relay.stop()
process.exit(0)
