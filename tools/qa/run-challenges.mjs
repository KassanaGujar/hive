// PHASES 6–8: build each challenge through Hive's AI, run it with Hive's Run button, probe every feature,
// feed failures back to the AI (like a user would) for up to ROUNDS rounds, record the final result.
//   node tools/qa/run-challenges.mjs [id ...]
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { Hive, record, assert, until, wait, freshDir, OUT, DESKTOP, REPO } from './lib.mjs'
import { CHALLENGES } from './challenges.mjs'
import { testChatServer } from './chat-probe.mjs'
const ROUNDS = Number(process.env.QA_ROUNDS ?? 4)
const MODEL_HINT = process.env.QA_MODEL ?? 'qwen2.5-coder'
const only = process.argv.slice(2)
const list = CHALLENGES.filter((c) => !only.length || only.includes(c.id))
const a = await new Hive('chal', 9461).launch()
await a.profileAs('Tess')
const model = (await a.invoke('models:installed')).find((m) => m.id.includes(MODEL_HINT))?.id
assert(model, 'model not installed: ' + MODEL_HINT)
const summary = existsSync(`${OUT}/challenges.json`) ? JSON.parse(readFileSync(`${OUT}/challenges.json`, 'utf8')) : {}

function projectFiles(dir) {
  const out = []
  const walk = (d) => { for (const n of readdirSync(d)) { if (n.startsWith('.') || n === 'node_modules' || n === 'data') continue; const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(html|js|mjs|css|json)$/.test(n) && statSync(p).size < 60000) out.push(path.relative(dir, p).replace(/\\/g, '/')) } }
  walk(dir)
  return out
}
async function ask(dir, prompt) {
  const files = projectFiles(dir)
  const t0 = Date.now()
  const r = await a.eval(`
    const files=${JSON.stringify(files)};let ctx='';const bases={};
    for(const f of files){const t=await h.invoke('fs:read',f);bases[f]=t;ctx+='Open file: '+f+'\\n\\x60\\x60\\x60'+f+'\\n'+t+'\\n\\x60\\x60\\x60\\n\\n'}
    const msgs=[{role:'system',content:H.chat.SYSTEM},{role:'user',content:ctx+${JSON.stringify(prompt)}}];
    let text='',err=null,done=false,id=null;const early=[];
    const off=h.on('chat:chunk',(c)=>{if(id===null){early.push(c);return}if(c.streamId!==id)return;if(c.chunk.text)text+=c.chunk.text;if(c.error)err=c.error;if(c.chunk.done)done=true});
    id=await h.invoke('chat:stream',${JSON.stringify(model)},msgs);
    for(const c of early){if(c.streamId!==id)continue;if(c.chunk.text)text+=c.chunk.text;if(c.error)err=c.error;if(c.chunk.done)done=true}
    const end=Date.now()+900000;while(!done&&!err&&Date.now()<end)await w(300);off();if(!done&&!err){await h.invoke('chat:abort',id);err='timeout'}
    return {text,err,bases}`)
  const text = r.text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const proposals = (await a.eval(`return H.chat.parseProposals(${JSON.stringify(text)})`)).map((p) => ({ ...p, base: r.bases?.[p.path] }))
  for (const p of proposals) await a.eval(`const __r=await H.files.applyProposal(${JSON.stringify(p.path)},${JSON.stringify(p.base ?? null)}??(await h.invoke('fs:read',${JSON.stringify(p.path)}).catch(()=>'')),${JSON.stringify(p.content)});if(!__r.ok)throw new Error('Accept refused: '+${JSON.stringify(p.path)}+' changed in the same place since the AI read it');return 1`)
  await wait(800)
  return { ms: Date.now() - t0, err: r.err, files: proposals.map((p) => p.path), reply: text }
}
async function probeWeb(c, dir, round) {
  const st = await a.invoke('run:start')
  if (!st.previewUrl) return { result: { _run: st.message ?? 'no preview' }, errors: [] }
  const probeFile = `${dir}/.probe.js`, outFile = `${dir}/.probe-out.json`
  writeFileSync(probeFile, c.probe)
  spawnSync(process.execPath, [path.join(REPO, 'node_modules/electron/cli.js'), path.join(REPO, 'tools/qa/pagecheck.cjs'), st.previewUrl, probeFile, outFile, `${OUT}/challenge-${c.id}-r${round}.png`], { timeout: 120000, stdio: 'ignore' })
  await a.invoke('run:stop')
  return existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { result: { _run: 'probe produced no output' }, errors: [] }
}

for (const c of list) {
  const dir = freshDir(`chal-${c.id}`)
  await a.invoke('project:open', dir)
  await a.invoke('fs:write', 'README.md', `# ${c.title}\n`)
  await a.openProject(dir)
  const log = { title: c.title, model, rounds: [], bugsFound: 0 }
  let prompt = c.brief
  let final = {}, errors = []
  const everFailed = new Set()
  for (let round = 1; round <= ROUNDS; round++) {
    const r = await ask(dir, prompt)
    let res
    if (c.kind === 'server') res = await testChatServer(a, dir)
    else res = await probeWeb(c, dir, round)
    final = res.result ?? {}
    errors = res.errors ?? []
    const failing = c.items.filter((it) => final[it] !== true)
    failing.forEach((f) => everFailed.add(f))
    log.rounds.push({ round, aiMs: r.ms, aiError: r.err, filesWritten: r.files, passed: c.items.length - failing.length, failing: Object.fromEntries(failing.map((f) => [f, final[f] ?? 'not checked'])), consoleErrors: errors.slice(0, 5), probeError: final.probeError ?? final._run })
    console.log(`[${c.id}] round ${round}: ${c.items.length - failing.length}/${c.items.length} pass (AI ${Math.round(r.ms / 1000)} s, files ${r.files.join(',') || 'none'})`)
    writeFileSync(`${OUT}/challenges.json`, JSON.stringify({ ...summary, [c.id]: log }, null, 1))
    if (!failing.length && !errors.length) break
    prompt = `I ran the app and tested it. These requirements are failing:\n${failing.map((f) => `- ${f}: ${final[f] ?? 'not working'}`).join('\n')}\n${errors.length ? `Browser console errors:\n${errors.slice(0, 5).join('\n')}\n` : ''}${final.probeError ? `Test error: ${final.probeError}\n` : ''}Fix the code. Output the COMPLETE content of every file you change. The original requirements were:\n${c.brief}`
  }
  log.bugsFound = everFailed.size
  log.final = Object.fromEntries(c.items.map((it) => [it, final[it] === true ? true : final[it] ?? 'not checked']))
  summary[c.id] = log
  writeFileSync(`${OUT}/challenges.json`, JSON.stringify(summary, null, 1))
  for (const it of c.items) record(c.phase, `${c.title} — ${it}`, final[it] === true ? 'PASS' : 'FAIL', final[it] === true ? `after ${log.rounds.length} round(s)` : String(final[it] ?? 'not checked'))
  if (c.items.includes('The game runs without errors')) {/* covered by probe + console errors */}
}
await a.kill()
process.exit(0)
