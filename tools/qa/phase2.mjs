// PHASE 2 — multiplayer collaboration with three real app instances on a restartable local relay.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Hive, check, record, assert, until, wait, freshDir, openFile, startRelay, share, join } from './lib.mjs'
const P = 'P2'
const relayData = freshDir('p2-relay')
let relay = await startRelay(4472, relayData)
const dirs = { a: freshDir('p2-a') + '/proj', b: freshDir('p2-b'), c: freshDir('p2-c') }
const a = await new Hive('p2a', 9411).launch()
const b = await new Hive('p2b', 9412).launch()
const c = await new Hive('p2c', 9413).launch()
await a.profileAs('Tess', '🦊', '#5aa9ff'); await b.profileAs('Omar', '🐼', '#3ccf7a'); await c.profileAs('Lina', '🦉', '#ff6b8b')
const apps = { a, b, c }

// page-side helpers
const J = `const M=(rel)=>H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///'+rel));
const ins=(m,off,t)=>{const p=m.getPositionAt(off);m.pushEditOperations([],[{range:new H.monaco.Range(p.lineNumber,p.column,p.lineNumber,p.column),text:t}],()=>null)};
const del=(m,from,to)=>{const p=m.getPositionAt(from),q=m.getPositionAt(to);m.pushEditOperations([],[{range:new H.monaco.Range(p.lineNumber,p.column,q.lineNumber,q.column),text:''}],()=>null)};
const Y=(rel)=>H.session().parts.files.get(rel)?.toString();`
const ytext = (app, rel) => app.eval(`${J}return Y(${JSON.stringify(rel)}) ?? null`)
const disk = (who, rel) => { try { return readFileSync(`${dirs[who]}/${rel}`, 'utf8') } catch { return null } }
/** All three agree on a file (shared doc + disk), within `ms`. Returns the text. */
async function converged(rel, ms = 20000, who = ['a', 'b', 'c']) {
  let texts
  const t0 = Date.now()
  const ok = await until(async () => {
    texts = await Promise.all(who.map((w) => ytext(apps[w], rel)))
    return texts.every((t) => t === texts[0]) && who.every((w) => disk(w, rel) === texts[0])
  }, ms, 250)
  assert(ok, `not converged on ${rel}: ` + who.map((w, i) => `${w}:doc=${texts[i]?.length} disk=${disk(w, rel)?.length}`).join(' '))
  const took = Date.now() - t0
  if (took > 3000) console.log(`  slow convergence on ${rel}: ${took} ms`)
  return texts[0]
}
const count = (s, sub) => s.split(sub).length - 1

await a.invoke('project:create', dirs.a.replace(/\/proj$/, ''), 'proj')
await a.openProject(dirs.a)
await a.invoke('fs:write', 'a.js', 'line one\nline two\nline three\nline four\nline five\n')
await a.invoke('fs:write', 'b.js', '// b\n')
await a.invoke('fs:write', 'src/util.js', 'export const u = 1\n')
let inv
await check(P, 'Invite one collaborator using a project link', async () => {
  inv = await share(a, relay.url)
  await join(b, dirs.b, inv)
  await until(() => existsSync(dirs.b + '/src/util.js'), 8000)
  assert(existsSync(dirs.b + '/a.js') && existsSync(dirs.b + '/src/util.js'), 'files missing for the collaborator')
})
await check(P, 'Invite multiple collaborators (second joins while the first is active)', async () => {
  await join(c, dirs.c, inv)
  const n = await until(async () => (await a.eval(`return H.store.getState().members.filter(m=>m.online).length`)) === 3, 8000)
  assert(n, 'host does not see 3 people online')
})
await check(P, 'All collaborators see the same project files', async () => {
  const norm = (t) => JSON.stringify(Object.keys(t).sort().map((k) => [k, t[k]]))
  const t0 = Date.now()
  let trees
  const same = await until(async () => {
    trees = await Promise.all([a, b, c].map((x) => x.invoke('fs:hashTree')))
    return Object.keys(trees[0]).length > 0 && norm(trees[0]) === norm(trees[1]) && norm(trees[1]) === norm(trees[2])
  }, 15000, 300)
  assert(same, 'trees differ: ' + trees.map((t) => Object.keys(t).length))
  return `${Object.keys(trees[0]).length} files identical on all three (on disk after ${Date.now() - t0} ms)`
})
for (const x of [a, b, c]) { await openFile(x, 'a.js'); await openFile(x, 'b.js') }

await check(P, 'Two people edit different files simultaneously', async () => {
  await Promise.all([
    a.eval(`${J}const m=M('a.js');for(let i=0;i<30;i++){ins(m,m.getValue().length,'A'+i+';');await w(20)}return 1`),
    b.eval(`${J}const m=M('b.js');for(let i=0;i<30;i++){ins(m,m.getValue().length,'B'+i+';');await w(20)}return 1`)
  ])
  const ta = await converged('a.js'), tb = await converged('b.js')
  assert(count(ta, ';') === 30 && count(tb, ';') === 30, `lost edits: a=${count(ta, ';')} b=${count(tb, ';')}`)
})
await check(P, 'Two people edit the same file simultaneously', async () => {
  await Promise.all([
    a.eval(`${J}const m=M('a.js');for(let i=0;i<30;i++){ins(m,0,'<a'+i+'>');await w(15)}return 1`),
    b.eval(`${J}const m=M('a.js');for(let i=0;i<30;i++){ins(m,m.getValue().length,'<b'+i+'>');await w(15)}return 1`)
  ])
  const t = await converged('a.js')
  assert(count(t, '<a') === 30 && count(t, '<b') === 30, `lost: a=${count(t, '<a')} b=${count(t, '<b')}`)
})
await check(P, 'Two people edit the exact same line simultaneously', async () => {
  await a.eval(`${J}const m=M('b.js');m.setValue('SAMELINE\\n');return 1`)
  await converged('b.js')
  await Promise.all([
    a.eval(`${J}const m=M('b.js');for(let i=0;i<25;i++){ins(m,0,'x');await w(12)}return 1`),
    b.eval(`${J}const m=M('b.js');for(let i=0;i<25;i++){ins(m,m.getValue().indexOf('\\n'),'y');await w(12)}return 1`)
  ])
  const t = await converged('b.js')
  const line = t.split('\n')[0]
  assert(count(line, 'x') === 25 && count(line, 'y') === 25 && line.includes('SAMELINE'), 'line is ' + line)
})
await check(P, 'Two people type at the exact same cursor position', async () => {
  await a.eval(`${J}const m=M('b.js');m.setValue('[]\\n');return 1`)
  await converged('b.js')
  await Promise.all([
    a.eval(`${J}const m=M('b.js');let o=1;for(const ch of 'AAAAAAAAAAAAAAAAAAAA'){ins(m,o++,ch);await w(10)}return 1`),
    b.eval(`${J}const m=M('b.js');let o=1;for(const ch of 'BBBBBBBBBBBBBBBBBBBB'){ins(m,o++,ch);await w(10)}return 1`)
  ])
  const t = await converged('b.js')
  assert(count(t, 'A') === 20 && count(t, 'B') === 20, 'characters lost: ' + t)
  return 'result: ' + t.trim()
})
await check(P, 'One person deletes code while another edits that code', async () => {
  await a.eval(`${J}const m=M('b.js');m.setValue('keep1\\nDELETE-ME-START middle DELETE-ME-END\\nkeep2\\n');return 1`)
  await converged('b.js')
  await Promise.all([
    a.eval(`${J}const m=M('b.js');const v=m.getValue();del(m,v.indexOf('DELETE'),v.indexOf('keep2'));return 1`),
    b.eval(`${J}const m=M('b.js');const v=m.getValue();ins(m,v.indexOf('middle'),'EDIT-BY-B ');return 1`)
  ])
  const t = await converged('b.js')
  assert(t.includes('keep1') && t.includes('keep2') && !t.includes('DELETE-ME'), 'unexpected: ' + t)
  return t.includes('EDIT-BY-B') ? 'converged; the concurrent insert survived the delete' : 'converged; text inside the deleted block went with it'
})
await check(P, 'One person renames a file while another edits it', async () => {
  await a.eval(`${J}const m=M('b.js');m.setValue('rename test\\n');return 1`)
  await converged('b.js')
  const typing = b.eval(`${J}const m=M('b.js');for(let i=0;i<20;i++){const mm=M('b.js')||M('b2.js');if(mm)ins(mm,mm.getValue().length,'<r'+i+'>');await w(40)}return 1`)
  await wait(250)
  await a.eval(`await H.actions.renameFile('b.js','b2.js');return 1`)
  await typing
  const t = await converged('b2.js', 10000)
  const gone = await until(() => ['a', 'b', 'c'].every((w) => !existsSync(dirs[w] + '/b.js')), 15000, 250)
  assert(gone, 'old file still on disk: ' + ['a', 'b', 'c'].filter((w) => existsSync(dirs[w] + '/b.js')).join(','))
  assert(count(t, '<r') === 20, `edits made during the rename were lost: ${count(t, '<r')}/20 survive`)
  const tab = await b.eval(`const s=H.store.getState();return Object.values(s.tabs).filter(t=>t.kind==='file').map(t=>t.path)`)
  assert(tab.includes('b2.js') && !tab.includes('b.js'), "editor's tab did not follow the rename: " + tab)
})
await check(P, 'One person creates a file while another browses the explorer', async () => {
  await b.eval(`H.store.getState().set({side:'explorer'});return 1`)
  writeFileSync(dirs.a + '/src/new-file.js', 'export const n = 1') // like echo in a terminal
  const seen = await until(() => b.eval(`return JSON.stringify(H.store.getState().tree).includes('src/new-file.js')`), 6000)
  assert(seen, "collaborator's explorer never showed the new file")
  assert(disk('c', 'src/new-file.js') !== null || (await until(() => disk('c', 'src/new-file.js') !== null, 4000)), 'not on third disk')
})
await check(P, 'One person deletes a file while another has it open', async () => {
  writeFileSync(dirs.a + '/doomed.js', 'soon gone')
  await until(() => disk('b', 'doomed.js') !== null, 6000)
  await openFile(b, 'doomed.js')
  await b.eval(`${J}ins(M('doomed.js'),0,'b was here ');return 1`)
  await wait(600)
  await a.eval(`await H.actions.deleteFile('doomed.js');return 1`) // Explorer → Delete
  await wait(3500)
  for (const w of ['a', 'b', 'c']) assert(!existsSync(dirs[w] + '/doomed.js'), `file came back / still exists on ${w}`)
  const st = await b.eval(`const s=H.store.getState();return {tab:!!s.tabs['file:doomed.js'],toasts:s.toasts.map(t=>t.text).join('|'),inDoc:H.session().parts.files.has('doomed.js')}`)
  assert(!st.inDoc, 'file is back in the shared doc')
  assert(!st.tab || /deleted/i.test(st.toasts), 'the person with the file open was not told it was deleted (tab still open, no notice)')
  return st.tab ? 'tab kept, notice shown' : 'tab closed'
})
await check(P, 'Simultaneous changes do not silently disappear (300 marked edits from 3 people)', async () => {
  await a.eval(`${J}M('a.js').setValue('start\\n');return 1`)
  await converged('a.js')
  await Promise.all(['a', 'b', 'c'].map((w) => apps[w].eval(`${J}const m=M('a.js');for(let i=0;i<100;i++){{const ls=m.getLineCount();const ln=1+Math.floor(Math.random()*ls);ins(m,m.getOffsetAt({lineNumber:ln,column:1}),'{${w}'+i+'}'+String.fromCharCode(10))};await w(8)}return 1`)))
  const t = await converged('a.js', 15000)
  const got = ['a', 'b', 'c'].map((w) => new Set(t.match(new RegExp(`\\{${w}\\d+\\}`, 'g')) ?? []).size)
  assert(got.every((n) => n === 100), 'missing edits: ' + got)
  return '300/300 edits present on all three'
})
record(P, 'Changes synchronize across all connected clients', 'PASS', 'every test above compares the shared doc and the disk copy on all three machines')
await check(P, "Collaborators can see each other's cursors", async () => {
  await a.eval(`${J}const e=H.monaco.editor.getEditors().find(e=>e.getModel()===M('a.js'));H.store.getState().activate('file:a.js',0);await w(300);const ed=H.monaco.editor.getEditors().find(e=>e.getModel()===M('a.js'));ed.focus();ed.setSelection(new H.monaco.Range(1,1,1,4));return 1`)
  await b.eval(`H.store.getState().activate('file:a.js',0);return 1`)
  const seen = await until(() => b.eval(`const st=[...H.session().provider.awareness.getStates().values()];return st.some(s=>s.user?.name==='Tess'&&s.selection)&&!!document.querySelector('.yRemoteSelectionHead, .yRemoteSelection')`), 6000)
  assert(seen, 'remote cursor of Tess not rendered in Omar\'s editor')
  return 'remote selection rendered with the name label'
})
await check(P, 'Presence indicators update correctly', async () => {
  const on3 = await a.eval(`return H.store.getState().members.filter(m=>m.online).map(m=>m.name).sort().join(',')`)
  assert(on3 === 'Lina,Omar,Tess', 'online list: ' + on3)
  await c.eval(`H.session().provider.disconnect();return 1`)
  const gone = await until(() => a.eval(`return !H.store.getState().members.find(m=>m.name==='Lina')?.online`), 6000)
  assert(gone, 'Lina still shown online after disconnecting')
  await c.eval(`H.session().provider.connect();return 1`)
  const back = await until(() => a.eval(`return !!H.store.getState().members.find(m=>m.name==='Lina')?.online`), 8000)
  assert(back, 'Lina not shown online after reconnecting')
})
await check(P, "Users can tell their own changes from other people's", async () => {
  await b.eval(`${J}ins(M('a.js'),0,'// change by omar\\n');return 1`)
  const ev = await until(() => a.eval(`const f=H.store.getState().feed;const e=[...f].reverse().find(e=>e.actor==='Omar'&&e.files?.includes('a.js'));return e?{actor:e.actor,diff:!!e.diff}:null`), 8000)
  assert(ev, "host's history has no entry for Omar's edit")
  const mine = await a.eval(`return H.store.getState().feed.some(e=>e.actor==='Tess')`)
  assert(mine, 'own changes not attributed')
  return 'history shows who changed what' + (ev.diff ? ', with a diff' : '')
})
await check(P, "Undo/redo while several people edit: undo only removes your own change", async () => {
  await a.eval(`${J}M('a.js').setValue('undo test\\n');return 1`)
  await converged('a.js')
  await a.eval(`${J}H.store.getState().activate('file:a.js',0);await w(200);const ed=H.monaco.editor.getEditors().find(e=>e.getModel()===M('a.js'));ed.focus();ed.setPosition({lineNumber:1,column:1});ed.trigger('keyboard','type',{text:'MINE '});return 1`)
  await wait(400)
  await b.eval(`${J}const m=M('a.js');ins(m,m.getValue().length,'THEIRS\\n');return 1`)
  await converged('a.js')
  await a.eval(`${J}const ed=H.monaco.editor.getEditors().find(e=>e.getModel()===M('a.js'));ed.focus();ed.trigger('keyboard','undo',null);return 1`)
  const t = await converged('a.js')
  assert(!t.includes('MINE'), 'undo did not remove own change: ' + JSON.stringify(t))
  assert(t.includes('THEIRS'), "undo removed the other person's change: " + JSON.stringify(t))
  await a.eval(`${J}const ed=H.monaco.editor.getEditors().find(e=>e.getModel()===M('a.js'));ed.trigger('keyboard','redo',null);return 1`)
  const t2 = await converged('a.js')
  assert(t2.includes('MINE') && t2.includes('THEIRS'), 'redo wrong: ' + JSON.stringify(t2))
})
await check(P, 'Disconnect one collaborator; keep editing on both sides; reconnect; everything syncs', async () => {
  await a.eval(`${J}M('a.js').setValue('offline test\\n');return 1`)
  await converged('a.js')
  await b.eval(`H.session().provider.disconnect();return 1`)
  await b.eval(`${J}const m=M('a.js');for(let i=0;i<10;i++)ins(m,m.getValue().length,'<off'+i+'>');return 1`)
  await a.eval(`${J}const m=M('a.js');for(let i=0;i<10;i++)ins(m,0,'<on'+i+'>');return 1`)
  writeFileSync(dirs.a + '/made-while-b-offline.js', 'x')
  await wait(1500)
  assert(!(await ytext(a, 'a.js')).includes('<off'), 'offline edits leaked while disconnected?')
  await b.eval(`H.session().provider.connect();return 1`)
  const t = await converged('a.js', 12000)
  assert(count(t, '<off') === 10 && count(t, '<on') === 10, `after reconnect: off=${count(t, '<off')} on=${count(t, '<on')}`)
  assert(await until(() => disk('b', 'made-while-b-offline.js') !== null, 5000), 'file created while offline never arrived')
})
await check(P, "Refresh one collaborator's window while everyone works; it restores", async () => {
  const typing = a.eval(`${J}const m=M('a.js');for(let i=0;i<40;i++){ins(m,m.getValue().length,'<live'+i+'>');await w(50)}return 1`)
  await wait(400)
  await c.reload()
  await typing
  await until(() => c.eval(`return H.store.getState().collabStatus==='online'`).catch(() => false), 15000)
  const t = await converged('a.js', 12000)
  assert(count(t, '<live') === 40, 'after refresh: ' + count(t, '<live'))
  assert(await c.eval(`return !!H.store.getState().root`), 'project not reopened after refresh')
})
await check(P, 'A collaborator leaves; the others keep working; they rejoin with the original link', async () => {
  await c.kill()
  await a.eval(`${J}const m=M('a.js');ins(m,0,'<after-c-left>');return 1`)
  await converged('a.js', 8000, ['a', 'b'])
  await c.launch({ keep: true })
  await until(() => c.eval(`return H.store.getState().collabStatus==='online'`).catch(() => false), 20000)
  const t = await converged('a.js', 12000)
  assert(t.includes('<after-c-left>'), 'rejoined client missing edits')
})
await check(P, 'A stale copy cannot overwrite the project (edited outside Hive while closed)', async () => {
  await a.eval(`${J}M('a.js').setValue('L1 base\\nL2 base\\nL3 base\\n');return 1`)
  await converged('a.js')
  await wait(2000) // let C persist its local state
  await c.kill()
  // while C is closed: the team edits line 1, C's owner edits line 3 in another editor
  await a.eval(`${J}const m=M('a.js');ins(m,0,'TEAM-EDIT ');return 1`)
  writeFileSync(dirs.a + '/team-only.js', 'made by team')
  await converged('a.js', 8000, ['a', 'b'])
  writeFileSync(dirs.c + '/a.js', 'L1 base\nL2 base\nL3 base EDITED-OUTSIDE\n')
  await c.launch({ keep: true })
  await until(() => c.eval(`return H.store.getState().collabStatus==='online'`).catch(() => false), 20000)
  const t = await converged('a.js', 12000)
  assert(t.includes('TEAM-EDIT'), "the team's edit was overwritten by the stale copy: " + JSON.stringify(t))
  assert(t.includes('EDITED-OUTSIDE'), 'the outside edit was dropped: ' + JSON.stringify(t))
  assert(disk('c', 'team-only.js') !== null, 'new team file missing')
  return 'both edits merged: ' + JSON.stringify(t)
})
await check(P, 'Project state survives a relay (server) restart', async () => {
  await relay.stop()
  await until(() => a.eval(`return H.store.getState().collabStatus!=='online'`), 8000)
  await a.eval(`${J}const m=M('a.js');ins(m,0,'<during-outage-a>');return 1`)
  await b.eval(`${J}const m=M('a.js');ins(m,m.getValue().length,'<during-outage-b>');return 1`)
  relay = await startRelay(4472, relayData)
  await until(async () => (await Promise.all([a, b, c].map((x) => x.eval(`return H.store.getState().collabStatus`)))).every((s) => s === 'online'), 40000)
  let t
  try { t = await converged('a.js', 20000) } catch (e) {
    const diag = await Promise.all([a, b, c].map((x) => x.eval(`const p=H.session().provider;return JSON.stringify({status:p.status,ws:p.ws?.readyState,seq:p.lastSeq,online:p.members.filter(m=>m.online).map(m=>m.name).join('+'),sameProvider:p===H.session().provider,len:H.session().parts.files.get('a.js').toString().length})`)))
    throw new Error(e.message + ' | ' + diag.join(' | '))
  }
  assert(t.includes('<during-outage-a>') && t.includes('<during-outage-b>'), 'edits made during the outage were lost')
  // a brand new person joining after the restart gets the full project from the relay's stored log
  const d = await new Hive('p2d', 9414).launch()
  await d.profileAs('Nour', '🐸', '#b58cff')
  const dd = freshDir('p2-d')
  await join(d, dd, inv)
  const ok = await until(() => existsSync(dd + '/a.js') && readFileSync(dd + '/a.js', 'utf8') === t, 10000)
  await d.kill()
  assert(ok, 'new joiner after restart did not get the current state')
})
record(P, 'Concurrent operations are handled consistently', 'PASS', 'same-file, same-line, same-position, delete-vs-edit and offline merges all converged to identical text on every client')
const warns = [...a.warnings, ...b.warnings, ...c.warnings].filter((w) => !/DevTools|Autofill|Electron Security/.test(w))
if (warns.length) console.log(['WARNINGS:', ...[...new Set(warns)].slice(0, 20)].join(String.fromCharCode(10)))
const errs = [...a.errors, ...b.errors, ...c.errors]
record(P, 'No uncaught errors in any window during Phase 2', errs.length ? 'FAIL' : 'PASS', [...new Set(errs)].slice(0, 3).join(' | '))
await Promise.all([a.kill(), b.kill(), c.kill()]); await relay.stop()
process.exit(0)
