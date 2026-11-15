// PHASE 9 — collaborative coding challenges. Two Hive windows (Tess + Omar) in one shared project.
// Each person asks THEIR OWN AI for their half (separate files), accepts it, the halves meet through
// a shared contract, then BOTH run the finished project and it is probed with the challenge checks.
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Hive, check, record, assert, until, wait, freshDir, openFile, startRelay, share, join, OUT, REPO } from './lib.mjs'
import { CHALLENGES } from './challenges.mjs'
import { testChatServer } from './chat-probe.mjs'
const P = 'P9'
const MODEL_HINT = process.env.QA_MODEL ?? 'qwen2.5-coder'
const only = process.argv.slice(2)
const relay = await startRelay(4479, freshDir('p9-relay'))
const tess = await new Hive('p9t', 9491).launch()
const omar = await new Hive('p9o', 9492).launch()
await tess.profileAs('Tess'); await omar.profileAs('Omar', '🐼', '#3ccf7a')
const model = (await tess.invoke('models:installed')).find((m) => m.id.includes(MODEL_HINT))?.id
const C = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]))

const PAIRS = [
  { id: 'snake', label: 'Snake: one person on game mechanics, another on rendering and UI', challenge: 'snake',
    a: { who: 'tess', files: 'logic.js', task: 'You own ONLY logic.js: the game rules and state (grid, snake, food, collisions, score, over, reset, step, setDir, placeFood) as a global object window.SnakeLogic with those functions plus getState(). No drawing, no DOM.' },
    b: { who: 'omar', files: 'index.html and ui.js', task: 'You own ONLY index.html and ui.js: canvas drawing, score display, game-over message, Restart button, arrow keys and the timer. index.html loads logic.js BEFORE ui.js. ui.js uses window.SnakeLogic (functions: reset, step, setDir, placeFood, getState) and defines window.game = {state:()=>SnakeLogic.getState(), step, setDir, reset, pause, placeFood} wrapping it.' } },
  { id: 'chess', label: 'Chess: one person on move validation, another on the AI opponent', challenge: 'chess',
    a: { who: 'tess', files: 'rules.js', task: 'You own ONLY rules.js: board representation, FEN load/export, legal move generation (check, castling, en passant, promotion), make move, inCheck, isCheckmate, isStalemate, perft, as a global window.Rules = {load, fen, moves, move, turn, inCheck, isCheckmate, isStalemate, perft, clone}.' },
    b: { who: 'omar', files: 'index.html, engine.js and ui.js', task: 'You own ONLY index.html, engine.js and ui.js. index.html loads rules.js, engine.js, ui.js in that order. engine.js uses window.Rules to implement evaluate() and minimax search with optional alpha-beta, and defines window.chess = {...Rules functions, evaluate, search(depth,{alphaBeta}), bestMove(depth)}. ui.js draws the clickable board with Unicode pieces and lets the computer play Black.' } },
  { id: 'voxel', label: 'Minecraft clone: one person on terrain generation, another on player mechanics', challenge: 'voxel',
    a: { who: 'tess', files: 'terrain.js', task: 'You own ONLY terrain.js, an ES module: seeded noise, chunk generation (16x16x64 Uint8Array per chunk), getBlock/setBlock on a world map of chunks, chunk meshing with Three.js (import from https://unpkg.com/three@0.160.0/build/three.module.js) with face culling, loading chunks within radius 3 and unloading farther ones, edit persistence in localStorage "voxel-edits". Export class World with getBlock, setBlock, update(playerX, playerZ, scene), loadedChunks(), save(), load(), triangles().' },
    b: { who: 'omar', files: 'index.html and player.js', task: 'You own ONLY index.html and player.js (ES module). Import { World } from "./terrain.js" and Three.js from unpkg. Set up the renderer, camera, first-person controls (WASD, mouse look, jump, gravity), AABB collision against world.getBlock, raycast block break/place, FPS display, and define window.engine as the brief describes, delegating world things to World.' } },
  { id: 'chat', label: 'Chat application: one person on the backend, another on the frontend', challenge: 'chat',
    a: { who: 'tess', files: 'server.js, hive.json', task: 'You own ONLY server.js and hive.json: the whole HTTP/SSE API, persistence and rooms exactly as the brief describes. Serve files from public/.' },
    b: { who: 'omar', files: 'public/index.html and public/client.js', task: 'You own ONLY public/index.html and public/client.js: the chat page using the server API exactly as described (EventSource on /events, fetch POST /send and /typing, GET /history and /online), with timestamps, online list and typing indicator.' } },
  { id: 'physics', label: 'Physics simulator: one person on the physics engine, another on visualization', challenge: 'physics',
    a: { who: 'tess', files: 'engine.js', task: 'You own ONLY engine.js: the physics (bodies, add, clear, step(dt) with gravity, wall + circle collisions with impulses, restitution, floor friction, particles with emit(x,y,n) and lifetimes) as global window.Physics = {bodies, particles, params, add, clear, step, emit}.' },
    b: { who: 'omar', files: 'index.html and view.js', task: 'You own ONLY index.html and view.js. index.html loads engine.js then view.js. view.js draws Physics.bodies/particles on an 800x500 canvas each frame, runs the loop calling Physics.step, click to add a ball, sliders for gravity/restitution/friction writing Physics.params, a Spawn 300 button, FPS/step-time readout, and defines window.sim = {bodies:Physics.bodies, particles (getter), params:Physics.params, add, clear, step, emit, pause}.' } },
  { id: 'pathfinding', label: 'Pathfinding visualizer: one person on algorithms, another on the interface', challenge: 'pathfinding',
    a: { who: 'tess', files: 'algorithms.js', task: 'You own ONLY algorithms.js: pure functions window.Algorithms = {astar(grid,start,end), dijkstra(...), bfs(...)} where grid is {rows, cols, walls:Set of "r,c"} and start/end are [r,c]; each returns {path:[[r,c],...] or [], visitedOrder:[[r,c],...]}. 4-directional, cost 1.' },
    b: { who: 'omar', files: 'index.html, ui.js and style.css', task: 'You own ONLY index.html, ui.js and style.css. index.html loads algorithms.js then ui.js. ui.js builds the 20x30 grid of .cell divs, wall/start/end editing, animates visitedOrder with class "visited" and the path with class "path", shows a "No path" message and a comparison panel, and defines window.pf = {reset, setWall, setStart, setEnd, run(alg,{animate}), compare()} using window.Algorithms.' } }
].filter((p) => !only.length || only.includes(p.id))

async function ask(app, dir, prompt) {
  const files = (await app.invoke('fs:hashTree')) ?? {}
  const ctxFiles = Object.keys(files).filter((f) => /\.(html|js|css|json)$/.test(f) && !f.startsWith('.'))
  const r = await app.eval(`
    const files=${JSON.stringify(ctxFiles)};let ctx='';for(const f of files){const t=await h.invoke('fs:read',f);if(t.length<40000)ctx+='Open file: '+f+'\\n\\x60\\x60\\x60'+f+'\\n'+t+'\\n\\x60\\x60\\x60\\n\\n'}
    const msgs=[{role:'system',content:H.chat.SYSTEM},{role:'user',content:ctx+${JSON.stringify(prompt)}}];
    let text='',err=null,done=false,id=null;const early=[];
    const off=h.on('chat:chunk',(c)=>{if(id===null){early.push(c);return}if(c.streamId!==id)return;if(c.chunk.text)text+=c.chunk.text;if(c.error)err=c.error;if(c.chunk.done)done=true});
    id=await h.invoke('chat:stream',${JSON.stringify(model)},msgs);
    for(const c of early){if(c.streamId!==id)continue;if(c.chunk.text)text+=c.chunk.text;if(c.error)err=c.error;if(c.chunk.done)done=true}
    const end=Date.now()+900000;while(!done&&!err&&Date.now()<end)await w(300);off();return {text,err}`)
  const proposals = await app.eval(`return H.chat.parseProposals(${JSON.stringify(r.text.replace(/<think>[\s\S]*?<\/think>/g, ''))})`)
  return { ...r, proposals }
}
async function acceptOwned(app, proposals, allowed) {
  const ok = proposals.filter((p) => allowed.some((f) => p.path === f || p.path.endsWith('/' + f)))
  for (const p of ok) await app.eval(`await H.files.applyContent(${JSON.stringify(p.path)},${JSON.stringify(p.content)});return 1`)
  await wait(1500)
  return ok.map((p) => p.path)
}
async function probe(app, c, dir, tag) {
  if (c.kind === 'server') return testChatServer(app, dir)
  const st = await app.invoke('run:start')
  if (!st.previewUrl) return { result: { _run: st.message }, errors: [] }
  const pf = `${dir}/.probe.js`, of = `${dir}/.probe-${tag}.json`
  writeFileSync(pf, c.probe)
  spawnSync(process.execPath, [path.join(REPO, 'node_modules/electron/cli.js'), path.join(REPO, 'tools/qa/pagecheck.cjs'), st.previewUrl, pf, of, `${OUT}/collab-${c.id}-${tag}.png`], { timeout: 120000, stdio: 'ignore' })
  await app.invoke('run:stop')
  return existsSync(of) ? JSON.parse(readFileSync(of, 'utf8')) : { result: {}, errors: ['probe produced no output'] }
}
const filesOf = (s) => s.split(/,| and /).map((x) => x.trim()).filter(Boolean)
const results = {}
for (const pair of PAIRS) {
  const c = C[pair.challenge]
  const tdir = freshDir(`p9-${pair.id}-tess`) + '/proj'
  await tess.invoke('project:create', tdir.replace(/\/proj$/, ''), 'proj')
  await tess.openProject(tdir)
  await tess.invoke('fs:write', 'CONTRACT.md', `# ${c.title}\n\nTess: ${pair.a.task}\n\nOmar: ${pair.b.task}\n\nFull brief:\n${c.brief}\n`)
  const inv = await share(tess, relay.url)
  const odir = freshDir(`p9-${pair.id}-omar`)
  await join(omar, odir, inv)
  await until(() => existsSync(odir + '/CONTRACT.md'), 15000)
  const brief = (part) => `We are two people building this together. Read CONTRACT.md for who owns which files.\n${part.task}\nOutput the COMPLETE content of every file you own. Do not output files you don't own.\n\nFull brief for the whole app:\n${c.brief}`
  const [ra, rb] = await Promise.all([ask(tess, tdir, brief(pair.a)), ask(omar, odir, brief(pair.b))])
  const accA = await acceptOwned(tess, ra.proposals, filesOf(pair.a.files))
  const accB = await acceptOwned(omar, rb.proposals, filesOf(pair.b.files))
  await wait(2500)
  // integration round: each sees the other's code and fixes their own side once
  let resT = await probe(tess, c, tdir, 'r1')
  let failing = c.items.filter((it) => resT.result?.[it] !== true)
  let rounds = 1
  for (let r = 2; r <= 3 && failing.length; r++) {
    rounds = r
    const fix = `I ran our app. Failing: \n${failing.map((f) => `- ${f}: ${resT.result?.[f] ?? '?'}`).join('\n')}\n${(resT.errors ?? []).slice(0, 4).join('\n')}\nFix it by changing ONLY the files you own (see CONTRACT.md). Output complete files.`
    const [fa, fb] = await Promise.all([ask(tess, tdir, fix + `\n${pair.a.task}`), ask(omar, odir, fix + `\n${pair.b.task}`)])
    await acceptOwned(tess, fa.proposals, filesOf(pair.a.files))
    await acceptOwned(omar, fb.proposals, filesOf(pair.b.files))
    await wait(2500)
    resT = await probe(tess, c, tdir, 'r' + r)
    failing = c.items.filter((it) => resT.result?.[it] !== true)
  }
  const resO = await probe(omar, c, odir, 'omar')
  const same = JSON.stringify(Object.keys(await tess.invoke('fs:hashTree')).sort()) === JSON.stringify(Object.keys(await omar.invoke('fs:hashTree')).sort())
  const passT = c.items.filter((it) => resT.result?.[it] === true).length
  const passO = c.items.filter((it) => resO.result?.[it] === true).length
  results[pair.id] = { tessFiles: accA, omarFiles: accB, rounds, passT, passO, total: c.items.length, failing: Object.fromEntries(failing.map((f) => [f, resT.result?.[f] ?? '?'])), sameFiles: same }
  writeFileSync(`${OUT}/phase9.json`, JSON.stringify(results, null, 1))
  const pass = accA.length > 0 && accB.length > 0 && passT === c.items.length && passO === c.items.length
  record(P, pair.label, pass ? 'PASS' : 'FAIL', `Tess wrote ${accA.join(', ') || 'nothing'}; Omar wrote ${accB.join(', ') || 'nothing'}; ${rounds} round(s); features working: ${passT}/${c.items.length} on Tess's machine, ${passO}/${c.items.length} on Omar's${failing.length ? '; failing: ' + failing.slice(0, 4).join('; ') : ''}`)
  await omar.eval(`H.actions.closeProject();return 1`)
  await tess.eval(`H.actions.closeProject();return 1`)
}

// ---- the general collaboration items, in a fresh shared project
const gdir = freshDir('p9-general-tess') + '/proj'
await tess.invoke('project:create', gdir.replace(/\/proj$/, ''), 'proj')
await tess.openProject(gdir)
await tess.invoke('fs:write', 'game.js', "const SPEED = 5\nfunction move(p) { return { x: p.x + SPEED, y: p.y } }\nfunction score(s, pts) { return s + pts }\nfunction reset() { return { x: 0, y: 0 } }\nmodule.exports = { SPEED, move, score, reset }\n")
await tess.invoke('fs:write', 'render.js', "function draw(p) { return 'player at ' + p.x + ',' + p.y }\nmodule.exports = { draw }\n")
const inv = await share(tess, relay.url)
const odir = freshDir('p9-general-omar')
await join(omar, odir, inv)
await until(() => existsSync(odir + '/render.js'), 15000)
for (const x of [tess, omar]) { await openFile(x, 'game.js'); await openFile(x, 'render.js') }
const doc = (app, f) => app.eval(`return H.session().parts.files.get(${JSON.stringify(f)}).toString()`)
const nodeRun = (dir, code) => { const r = spawnSync(process.execPath, ['-e', code], { cwd: dir, encoding: 'utf8' }); return (r.stdout + r.stderr).trim() }

await check(P, 'Collaborators independently modify the same feature', async () => {
  const [ra, rb] = await Promise.all([
    ask(tess, gdir, 'Change move() so the player also moves down by 1 (y + 1). Keep everything else exactly.'),
    ask(omar, odir, 'Change move() so it never lets x go above 100 (clamp). Keep everything else exactly.')
  ])
  await acceptOwned(tess, ra.proposals, ['game.js'])
  await acceptOwned(omar, rb.proposals, ['game.js'])
  await wait(2500)
  const [t, o] = await Promise.all([doc(tess, 'game.js'), doc(omar, 'game.js')])
  assert(t === o, 'the two copies disagree')
  const out = nodeRun(gdir, "const g=require('./game');console.log(JSON.stringify([g.move({x:0,y:0}),g.move({x:99,y:0})]))")
  const v = JSON.parse(out)
  const both = v[0].y === 1 && v[1].x <= 100
  assert(both, `only one change survived: ${out}`)
  return 'both changes merged: ' + out
})
await check(P, 'Collaborators integrate code written in separate files', async () => {
  const ok = Object.values(results).filter((r) => r.tessFiles.length && r.omarFiles.length && r.passT === r.total).length
  assert(Object.keys(results).length, 'no pair challenge ran')
  assert(ok > 0, 'no pair challenge integrated into a fully working app')
  return `${ok}/${Object.keys(results).length} pair challenges integrated into a fully working app`
})
await check(P, "Collaborators debug each other's code", async () => {
  await tess.invoke('fs:write', 'render.js', "function draw(p) { return 'player at ' + p.y + ',' + p.x }\nmodule.exports = { draw }\n")
  await until(async () => (await doc(omar, 'render.js')).includes('p.y +'), 8000)
  const r = await ask(omar, odir, "Tess's draw() prints the coordinates in the wrong order (should be x then y). Fix render.js.")
  await acceptOwned(omar, r.proposals, ['render.js'])
  await until(() => readFileSync(gdir + '/render.js', 'utf8').includes('p.x + '), 8000)
  const out = nodeRun(gdir, "console.log(require('./render').draw({x:1,y:2}))")
  assert(out === 'player at 1,2', out)
})
await check(P, 'Collaborators review AI-generated code', async () => {
  const ev = await tess.eval(`return H.store.getState().feed.filter(e=>e.actor==='Omar'&&e.files?.includes('render.js')).map(e=>({diff:!!e.diff,summary:e.summary}))`)
  assert(ev.length, "Omar's AI change is not in Tess's History panel")
  assert(ev.some((e) => e.diff), 'no diff to review')
  return "Tess sees Omar's AI change with its diff in History. Note: the entry doesn't say it came from AI."
})
await check(P, 'Collaborators ask AI to modify separate parts of the same project', async () => {
  const [ra, rb] = await Promise.all([
    ask(tess, gdir, 'Change score() so it doubles the points (s + pts * 2). Keep everything else exactly.'),
    ask(omar, odir, "Change draw() to return 'P(x,y)' format like 'P(1,2)'. Keep everything else exactly.")
  ])
  await acceptOwned(tess, ra.proposals, ['game.js'])
  await acceptOwned(omar, rb.proposals, ['render.js'])
  await wait(2500)
  const out = nodeRun(gdir, "const g=require('./game'),r=require('./render');console.log(g.score(1,2)+' '+r.draw({x:1,y:2}))")
  assert(out === '5 P(1,2)', out)
})
await check(P, "Collaborators can understand each other's changes", async () => {
  const f = await omar.eval(`return H.store.getState().feed.filter(e=>e.actor==='Tess').slice(-5).map(e=>e.summary+' '+(e.files||[]).join(','))`)
  assert(f.length, 'no history entries from Tess on Omar\'s side')
  return 'History shows: ' + f.join(' | ')
})
await check(P, "Code integration doesn't silently overwrite existing functionality", async () => {
  const out = nodeRun(gdir, "const g=require('./game');console.log(typeof g.reset==='function'&&JSON.stringify(g.reset()))")
  assert(out === '{"x":0,"y":0}', 'reset() was lost or changed: ' + out)
})
await check(P, 'Collaborators can recover from conflicting changes', async () => {
  const before = await doc(tess, 'game.js')
  await omar.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///game.js'));m.pushEditOperations([],[{range:m.getFullModelRange(),text:'// oops, Omar replaced everything\\n'}],()=>null);return 1`)
  await until(async () => (await doc(tess, 'game.js')).includes('oops'), 8000)
  await omar.eval(`H.store.getState().activate('file:game.js',0);await w(300);const ed=H.monaco.editor.getEditors().find(e=>e.getModel()?.uri.path==='/game.js');ed.focus();ed.trigger('keyboard','undo',null);return 1`)
  const ok = await until(async () => (await doc(tess, 'game.js')) === before, 8000)
  assert(ok, 'undo did not restore the code for everyone')
  return 'Omar undid his overwrite and the restored file reached Tess'
})
await check(P, 'All collaborators can run the completed project', async () => {
  const both = Object.values(results).filter((r) => r.passT === r.total && r.passO === r.total).length
  assert(both > 0, 'no pair project ran fully on both machines: ' + JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, r]) => [k, `${r.passT}/${r.passO} of ${r.total}`]))))
  return `${both}/${Object.keys(results).length} projects fully working on both machines`
})
await tess.kill(); await omar.kill(); await relay.stop()
process.exit(0)
