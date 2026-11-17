// PHASE 3 — AI coding. Uses Ask AI's real pieces: its system prompt, chat:stream, its proposal
// parser and applyContent (what the Accept button calls). Generated code is executed to judge it.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createServer } from 'node:http'
import { Hive, check, record, assert, until, wait, freshDir, openFile, startRelay, share, join, OUT } from './lib.mjs'
const P = 'P3'
const MODEL_HINT = process.env.QA_MODEL ?? 'qwen2.5-coder'
const base = freshDir('p3')
const a = await new Hive('p3a', 9431).launch()
await a.profileAs('Tess')
const proj = await a.invoke('project:create', base, 'ai')
await a.openProject(proj)
const models = await a.invoke('models:installed')
const model = models.find((m) => m.id.includes(MODEL_HINT))?.id ?? models[0]?.id
assert(model, 'no AI model installed')
console.log('model:', model)
const transcript = []
const timings = []

/** Ask the AI like the Ask AI panel does. ctxFiles are included the way the panel includes the open file. */
async function ask(prompt, ctxFiles = [], { app = a, mdl = model, timeoutMs = 300000 } = {}) {
  const t0 = Date.now()
  const r = await app.eval(`
    const ctx=${JSON.stringify(ctxFiles)};
    let user='';const bases={};
    for(const f of ctx){const t=await h.invoke('fs:read',f);bases[f]=t;user+='Open file: '+f+'\\n\\x60\\x60\\x60'+f+'\\n'+t+'\\n\\x60\\x60\\x60\\n\\n'}
    user+=${JSON.stringify(prompt)};
    const msgs=[{role:'system',content:H.chat.SYSTEM},{role:'user',content:user}];
    let text='',err=null,done=false,id=null;const early=[];
    const off=h.on('chat:chunk',(c)=>{if(id===null){early.push(c);return}if(c.streamId!==id)return;if(c.chunk.text)text+=c.chunk.text;if(c.error)err=c.error;if(c.chunk.done)done=true});
    id=await h.invoke('chat:stream',${JSON.stringify(mdl)},msgs);
    for(const c of early){if(c.streamId!==id)continue;if(c.chunk.text)text+=c.chunk.text;if(c.error)err=c.error;if(c.chunk.done)done=true}
    const end=Date.now()+${timeoutMs};while(!done&&!err&&Date.now()<end)await w(200);
    off();
    if(!done&&!err){await h.invoke('chat:abort',id);err='TEST-TIMEOUT'}
    return {text,err,bases}`)
  const ms = Date.now() - t0
  timings.push(ms)
  const visible = r.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const proposals = (await app.eval(`return H.chat.parseProposals(${JSON.stringify(visible)})`)).map((p) => ({ ...p, base: r.bases?.[p.path] }))
  transcript.push({ prompt, ctxFiles, ms, err: r.err, reply: visible.slice(0, 4000) })
  writeFileSync(`${OUT}/phase3-transcript.json`, JSON.stringify(transcript, null, 1))
  return { text: visible, err: r.err, proposals, ms }
}
/** Accept every proposal (what pressing Accept does). */
async function accept(proposals, app = a) {
  for (const p of proposals) await app.eval(`const __r=await H.files.applyProposal(${JSON.stringify(p.path)},${JSON.stringify(p.base ?? null)}??(await h.invoke('fs:read',${JSON.stringify(p.path)}).catch(()=>'')),${JSON.stringify(p.content)});if(!__r.ok)throw new Error('Accept refused: '+${JSON.stringify(p.path)}+' changed in the same place since the AI read it');return 1`)
  await wait(1200)
}
const write = (rel, text) => { mkdirSync(`${proj}/${rel}`.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(`${proj}/${rel}`, text) }
const read = (rel) => (existsSync(`${proj}/${rel}`) ? readFileSync(`${proj}/${rel}`, 'utf8') : null)
const node = (args, cwd = proj) => {
  try { return { code: 0, out: execSync(`node ${args}`, { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) } } catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') } }
}
const needProposal = (r, path) => {
  assert(!r.err, 'AI error: ' + r.err)
  const p = r.proposals.find((x) => !path || x.path === path || x.path.endsWith('/' + path))
  assert(p, `AI gave no file proposal${path ? ' for ' + path : ''}. Reply starts: ` + r.text.slice(0, 200))
  return p
}

await check(P, 'AI creates a simple program from a natural-language prompt', async () => {
  const r = await ask('Create fib.js: a Node program that prints the first 10 Fibonacci numbers starting 0 1, comma-separated on one line.')
  await accept([needProposal(r, 'fib.js')])
  const o = node('fib.js')
  assert(/0,\s*1,\s*1,\s*2,\s*3,\s*5,\s*8,\s*13,\s*21,\s*34/.test(o.out), 'output: ' + o.out.slice(0, 200))
  return `${Math.round(r.ms / 1000)} s`
})
await check(P, 'AI creates a multi-file project', async () => {
  const r = await ask('Create two files: lib/shapes.js exporting area(w,h) and perimeter(w,h) with module.exports, and app.js that requires ./lib/shapes and prints "area=12 perimeter=14" for w=3,h=4 using those functions.')
  assert(r.proposals.length >= 2, `only ${r.proposals.length} file(s) proposed`)
  await accept(r.proposals)
  const o = node('app.js')
  assert(o.out.includes('area=12') && o.out.includes('perimeter=14'), o.out.slice(0, 300))
  return r.proposals.map((p) => p.path).join(', ')
})
write('greet.js', "function greet(name) {\n  return 'Hi ' + name\n}\n\nfunction farewell(name) {\n  return 'Bye ' + name\n}\n\nmodule.exports = { greet, farewell }\n")
await check(P, 'AI modifies an existing function', async () => {
  const r = await ask("Change greet so it returns 'Hello, NAME!' with the name in upper case. Don't change anything else.", ['greet.js'])
  await accept([needProposal(r, 'greet.js')])
  const o = node(`-e "const g=require('./greet');console.log(g.greet('ada')+'|'+g.farewell('ada'))"`)
  assert(o.out.trim() === 'Hello, ADA!|Bye ada', o.out)
})
write('calc.js', "function add(a, b) { return a + b }\nfunction sub(a, b) { return a - b }\nfunction mul(a, b) { return a * b }\n\nmodule.exports = { add, sub, mul }\n")
await check(P, 'AI adds a feature without changing unrelated functionality', async () => {
  const r = await ask('Add a div(a, b) function that throws an Error when b is 0, and export it.', ['calc.js'])
  await accept([needProposal(r, 'calc.js')])
  const o = node(`-e "const c=require('./calc');let t;try{c.div(1,0)}catch(e){t='threw'};console.log([c.add(2,3),c.sub(5,2),c.mul(3,4),c.div(8,2),t].join(','))"`)
  assert(o.out.trim() === '5,3,12,4,threw', o.out)
})
write('broken.js', "function total(items) {\n  let sum = 0\n  for (const i of items) {\n    sum += i.price\n  \n  return sum\n}\nconsole.log(total([{ price: 2 }, { price: 3 }]))\n")
await check(P, 'AI identifies and fixes a syntax error', async () => {
  assert(node('--check broken.js').code !== 0, 'test file should be broken')
  const r = await ask('This file has a syntax error. Find it and fix it.', ['broken.js'])
  await accept([needProposal(r, 'broken.js')])
  const o = node('broken.js')
  assert(o.code === 0 && o.out.trim() === '5', o.out)
})
write('even.js', "// returns true when n is even\nfunction isEven(n) {\n  return n % 2 === 1\n}\nmodule.exports = { isEven }\n")
await check(P, 'AI identifies and fixes a logical error', async () => {
  const r = await ask('isEven gives wrong answers. Find the logic bug and fix it.', ['even.js'])
  await accept([needProposal(r, 'even.js')])
  const o = node(`-e "const {isEven}=require('./even');console.log([0,1,2,7,10].map(isEven).join(','))"`)
  assert(o.out.trim() === 'true,false,true,false,true', o.out)
})
write('shop/cart.js', "const { priceOf } = require('./catalog')\nclass Cart {\n  constructor() { this.lines = new Map() }\n  add(sku, qty = 1) { this.lines.set(sku, (this.lines.get(sku) ?? 0) + qty) }\n  total() { let t = 0; for (const [sku, q] of this.lines) t += priceOf(sku) * q; return Math.round(t * 100) / 100 }\n}\nmodule.exports = { Cart }\n")
write('shop/catalog.js', "const PRICES = { apple: 0.5, bread: 2.25, milk: 1.1 }\nfunction priceOf(sku) {\n  if (!(sku in PRICES)) throw new Error('unknown item ' + sku)\n  return PRICES[sku]\n}\nmodule.exports = { priceOf }\n")
await check(P, 'AI explains an unfamiliar codebase', async () => {
  const r = await ask('Explain what this codebase does and how the files fit together.', ['shop/cart.js', 'shop/catalog.js'])
  assert(!r.err, r.err)
  const t = r.text.toLowerCase()
  const hits = ['cart', 'price', 'total', 'catalog'].filter((k) => t.includes(k))
  assert(hits.length >= 3, 'explanation misses key ideas: ' + r.text.slice(0, 300))
  return 'note: Ask AI only sees the open file; here both files were supplied as context. "' + r.text.slice(0, 160).replace(/\s+/g, ' ') + '…"'
})
await check(P, 'AI explains a specific function', async () => {
  const r = await ask('Explain exactly what Cart.total() does, including rounding.', ['shop/cart.js'])
  const t = r.text.toLowerCase()
  assert(t.includes('round') && (t.includes('quantity') || t.includes('qty')) && t.includes('price'), r.text.slice(0, 300))
})
await check(P, 'Ambiguous prompt: AI handles uncertainty appropriately', async () => {
  const r = await ask('Make it better.')
  const t = r.text.toLowerCase()
  const asks = /\?/.test(r.text) && /(which|what|could you|can you|clarify|more (detail|context|information)|specify)/.test(t)
  assert(asks && r.proposals.length === 0, 'did not ask for clarification: ' + r.text.slice(0, 250))
  return '"' + r.text.slice(0, 160).replace(/\s+/g, ' ') + '…"'
})
await check(P, 'Contradictory instructions: AI identifies the contradiction', async () => {
  const r = await ask('Write sum.js with a function sum(a,b) that returns the numeric sum of two numbers, but it must always return a string and must never return a string.')
  const t = r.text.toLowerCase()
  assert(/(contradict|conflict|inconsistent|impossible|cannot both|can't both|mutually exclusive|both .* and .* not possible)/.test(t), 'no contradiction flagged: ' + r.text.slice(0, 250))
})
write('messy.js', "function p(d){var r=[];for(var i=0;i<d.length;i++){if(d[i].a==true){if(d[i].v>10){r.push(d[i].n.toUpperCase())}else{r.push(d[i].n)}}}return r.join(';')}\nmodule.exports={p}\n")
await check(P, 'AI refactors poorly structured code (same behaviour)', async () => {
  const probe = `-e "const {p}=require('./messy');console.log(p([{a:true,v:20,n:'x'},{a:false,v:1,n:'y'},{a:true,v:3,n:'z'}]))"`
  const before = node(probe).out
  const r = await ask('Refactor this into clean, readable modern JavaScript with good names. Keep the exported name p and the exact behaviour.', ['messy.js'])
  await accept([needProposal(r, 'messy.js')])
  const after = node(probe).out
  assert(after === before, `behaviour changed: ${before.trim()} → ${after.trim()}`)
  const lines = read('messy.js').split('\n').length
  assert(lines > 3, 'not reformatted')
})
write('slow.js', "function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2) }\nmodule.exports = { fib }\n")
await check(P, 'AI optimizes a slow algorithm', async () => {
  const time = () => { const o = node(`-e "const {fib}=require('./slow');const t=Date.now();const v=fib(35);console.log(v+' '+(Date.now()-t))"`); const [v, ms] = o.out.trim().split(' '); return { v, ms: +ms } }
  const b = time()
  const r = await ask('fib is far too slow for n=35+. Make it fast (linear time) and keep the same results and export.', ['slow.js'])
  await accept([needProposal(r, 'slow.js')])
  const f = time()
  assert(f.v === b.v, `result changed ${b.v} → ${f.v}`)
  assert(f.ms < b.ms / 5 || f.ms < 5, `not faster: ${b.ms} ms → ${f.ms} ms`)
  return `fib(35): ${b.ms} ms → ${f.ms} ms`
})
write('strings.js', "function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : '' }\nfunction reverse(s) { return [...s].reverse().join('') }\nmodule.exports = { capitalize, reverse }\n")
await check(P, 'AI writes unit tests (and they catch a planted bug)', async () => {
  const r = await ask("Write strings.test.js that tests capitalize and reverse using node:test and node:assert (require('node:test') and require('node:assert')). Include an empty-string case.", ['strings.js'])
  await accept([needProposal(r, 'strings.test.js')])
  const good = node('--test strings.test.js')
  assert(good.code === 0, 'tests fail on correct code: ' + good.out.slice(-300))
  const orig = read('strings.js')
  write('strings.js', orig.replace("[...s].reverse().join('')", 's'))
  const bad = node('--test strings.test.js')
  write('strings.js', orig)
  assert(bad.code !== 0, 'tests did not catch a broken reverse()')
})
write('price.js', "function applyDiscount(price, pct) {\n  return price - price * pct\n}\nmodule.exports = { applyDiscount }\n")
write('price.test.js', "const test = require('node:test')\nconst assert = require('node:assert')\nconst { applyDiscount } = require('./price')\ntest('10% off 200', () => assert.strictEqual(applyDiscount(200, 10), 180))\ntest('0% off', () => assert.strictEqual(applyDiscount(50, 0), 50))\n")
await check(P, 'AI fixes failing unit tests (by fixing the code)', async () => {
  assert(node('--test price.test.js').code !== 0, 'should fail first')
  const r = await ask('price.test.js is failing. The tests are correct (pct is a percentage like 10). Fix price.js.\n\nTest file:\n```price.test.js\n' + read('price.test.js') + '\n```', ['price.js'])
  await accept(r.proposals.filter((p) => p.path === 'price.js'))
  assert(read('price.test.js').includes('180'), 'AI changed the tests instead')
  const o = node('--test price.test.js')
  assert(o.code === 0, o.out.slice(-300))
})
write('todo/store.js', "const items = []\nfunction add(text) { items.push({ text }) }\nfunction list() { return items.map((i) => i.text) }\nmodule.exports = { add, list }\n")
write('todo/cli.js', "const store = require('./store')\nstore.add('milk')\nstore.add('eggs')\nconsole.log(store.list().join('\\n'))\n")
await check(P, 'AI implements a feature across multiple files', async () => {
  const r = await ask('Add a "done" feature: store.js gets complete(index) that marks an item done, and list() shows done items as "[x] text" and others as "[ ] text". Update cli.js to complete item 0 before printing. Output both full files.', ['todo/store.js', 'todo/cli.js'])
  assert(r.proposals.length >= 2, `${r.proposals.length} file(s) proposed: ` + r.proposals.map((p) => p.path))
  await accept(r.proposals)
  const o = node('todo/cli.js')
  assert(o.out.includes('[x] milk') && o.out.includes('[ ] eggs'), o.out)
})
await check(P, 'Users can inspect AI-generated changes before accepting them', async () => {
  write('inspect.js', 'const keep = 1\n')
  const before = read('inspect.js')
  await a.eval(`H.store.getState().openTab({id:'proposal:inspect.js:1',kind:'diff',title:'✨ inspect.js',path:'inspect.js',original:${JSON.stringify(before)},modified:'const keep = 2\\n',proposal:true});await w(800);return 1`)
  const ui = await a.eval(`return {diff:!!document.querySelector('.monaco-diff-editor'),accept:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Accept'),reject:[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Reject')}`)
  assert(read('inspect.js') === before, 'file changed before Accept')
  assert(ui.diff && ui.accept && ui.reject, JSON.stringify(ui))
  await a.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reject').click();await w(500);return 1`)
  assert(read('inspect.js') === before, 'Reject changed the file')
  return 'side-by-side diff with Accept / Reject; Reject leaves the file alone'
})
await check(P, 'AI does not silently remove unrelated functionality', async () => {
  write('big.js', Array.from({ length: 12 }, (_, i) => `function f${i}() { return ${i} }`).join('\n') + `\nmodule.exports = { ${Array.from({ length: 12 }, (_, i) => 'f' + i).join(', ')} }\n`)
  const r = await ask('Make f3 return 300 instead of 3.', ['big.js'])
  await accept([needProposal(r, 'big.js')])
  const o = node(`-e "const m=require('./big');console.log(Object.keys(m).length+':'+[0,1,2,3,4,11].map(i=>m['f'+i]()).join(','))"`)
  assert(o.out.trim() === '12:0,1,2,300,4,11', 'functions lost or changed: ' + o.out)
})
await check(P, 'Requesting broken code: the app reports execution errors', async () => {
  const r = await ask('Create crash.js that reads a property of undefined on purpose so it crashes with a TypeError.')
  await accept([needProposal(r, 'crash.js')])
  write('hive.json', '{"command":"node crash.js"}')
  await a.invoke('run:start')
  await until(async () => (await a.invoke('run:state')).status !== 'running', 45000)
  const s = await a.invoke('run:state')
  assert(s.status === 'failed' && /code/.test(s.message ?? ''), JSON.stringify(s))
  return s.message
})
await check(P, 'AI references nonexistent files or dependencies', async () => {
  const r = await ask('Create uses-lib.js that uses the npm package "left-pad-ultra-9000" to pad "x" to 5 characters and print it.')
  await accept([needProposal(r, 'uses-lib.js')])
  write('hive.json', '{"command":"node uses-lib.js"}')
  await a.invoke('run:start')
  await until(async () => (await a.invoke('run:state')).status !== 'running', 45000)
  const s = await a.invoke('run:state')
  assert(s.status === 'failed', 'ran without the package?! ' + JSON.stringify(s))
  return 'Run fails with Node\'s "Cannot find module" in the terminal + "' + s.message + '". Hive does not warn about missing packages before running.'
})

// --- provider failure modes, with a fake OpenAI-compatible server
let mode = 'error'
const fake = createServer((req, res) => {
  if (req.url.endsWith('/models')) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
  if (mode === 'error') return res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'upstream exploded' } }))
  // 'hang': accept and never answer
})
await new Promise((r) => fake.listen(4499, '127.0.0.1', r))
const saved = await a.invoke('custom:save', { name: 'QA fake', baseUrl: 'http://127.0.0.1:4499/v1', key: 'test' })
await a.invoke('custom:setModels', saved.id, ['fake-model'])
const fakeId = (await a.invoke('models:installed')).find((m) => m.id.includes('fake-model'))?.id
await check(P, 'The AI provider returns an error', async () => {
  assert(fakeId, 'fake provider model not listed')
  mode = 'error'
  const r = await ask('hello', [], { mdl: fakeId, timeoutMs: 30000 })
  assert(r.err && r.err !== 'TEST-TIMEOUT', 'no error surfaced')
  assert(/500|upstream exploded/.test(r.err), 'error text unclear: ' + r.err)
  return 'shown to the user as: ' + r.err
})
await check(P, 'An AI request times out', async () => {
  mode = 'hang'
  const r = await ask('hello', [], { mdl: fakeId, timeoutMs: 200000 })
  assert(r.err !== 'TEST-TIMEOUT', 'a provider that never answers leaves Ask AI waiting forever (test gave up after 200 s); only the Stop button ends it')
  return 'error after ' + Math.round(r.ms / 1000) + ' s: ' + r.err
})
fake.close()
await a.invoke('custom:remove', saved.id)
await check(P, 'Users can recover from unsuccessful AI modifications (undo the accepted change)', async () => {
  write('recover.js', 'const important = "keep me"\n')
  await openFile(a, 'recover.js')
  await a.eval(`await H.files.applyContent('recover.js','// AI broke everything\\n');return 1`)
  await wait(1200)
  assert(read('recover.js').includes('broke'), 'change not applied')
  await a.eval(`H.store.getState().activate('file:recover.js',0);await w(300);const ed=H.monaco.editor.getEditors().find(e=>e.getModel()?.uri.path==='/recover.js');ed.focus();ed.trigger('keyboard','undo',null);await w(1500);return 1`)
  assert(read('recover.js').includes('keep me'), 'undo did not restore the file: ' + read('recover.js'))
  return 'Ctrl+Z in the editor restores the pre-AI version (and the History panel keeps the diff)'
})

// --- collaboration + AI
const relay = await startRelay(4473, freshDir('p3-relay'))
const b = await new Hive('p3b', 9432).launch()
await b.profileAs('Omar', '🐼', '#3ccf7a')
const inv = await share(a, relay.url)
const bdir = freshDir('p3-b')
await join(b, bdir, inv)
await until(() => existsSync(bdir + '/calc.js'), 15000)
write('team.js', "function alpha() { return 'a' }\n\nfunction beta() { return 'b' }\n\nfunction gamma() { return 'c' }\n\nmodule.exports = { alpha, beta, gamma }\n")
await until(() => existsSync(bdir + '/team.js'), 8000)
for (const x of [a, b]) await openFile(x, 'team.js')
await check(P, 'AI modifies code that another collaborator is currently editing', async () => {
  const r = await ask("Change alpha to return 'ALPHA'. Keep everything else exactly.", ['team.js'])
  const prop = needProposal(r, 'team.js')
  // while the AI was answering, Omar edited gamma
  await b.eval(`const m=H.monaco.editor.getModel(H.monaco.Uri.parse('hive:///team.js'));const v=m.getValue();const i=v.indexOf("return 'c'");const p=m.getPositionAt(i+9);m.pushEditOperations([],[{range:new H.monaco.Range(p.lineNumber,p.column,p.lineNumber,p.column),text:'-omar'}],()=>null);return 1`)
  await wait(1500)
  await accept([prop])
  await wait(1500)
  const t = await a.eval(`return H.session().parts.files.get('team.js').toString()`)
  assert(t.includes("'ALPHA'"), 'AI change missing')
  assert(t.includes("'c-omar'"), "accepting the AI change wiped out Omar's concurrent edit")
})
await check(P, 'Two collaborators send AI requests simultaneously; they do not overwrite each other', async () => {
  const [ra, rb] = await Promise.all([
    ask("Change beta to return 'BETA'. Keep everything else exactly.", ['team.js']),
    ask("Change gamma to return 'GAMMA'. Keep everything else exactly.", ['team.js'], { app: b })
  ])
  const pa = needProposal(ra, 'team.js'), pb = needProposal(rb, 'team.js')
  await accept([pa], a)
  await wait(1500)
  await accept([pb], b)
  await wait(2000)
  const t = await a.eval(`return H.session().parts.files.get('team.js').toString()`)
  assert(t.includes("'BETA'") && t.includes("'GAMMA'"), "the second accepted AI change overwrote the first: " + JSON.stringify(t))
})
await check(P, 'AI-generated changes are synchronized with all collaborators', async () => {
  const ta = await a.eval(`return H.session().parts.files.get('team.js').toString()`)
  const ok = await until(() => readFileSync(bdir + '/team.js', 'utf8') === ta, 8000)
  assert(ok, "Omar's copy differs from Tess's")
})
await check(P, 'Repeated AI requests (5 in a row) all answer', async () => {
  const ms = []
  for (let i = 0; i < 5; i++) {
    const r = await ask(`Reply with just the number ${i * 7}.`)
    assert(!r.err && r.text.includes(String(i * 7)), `request ${i}: ` + (r.err ?? r.text.slice(0, 80)))
    ms.push(r.ms)
  }
  return 'times: ' + ms.map((x) => (x / 1000).toFixed(1) + ' s').join(', ')
})
const sorted = [...timings].sort((x, y) => x - y)
record(P, 'AI response time (measured)', 'PASS', `${timings.length} requests on ${model}: median ${(sorted[Math.floor(sorted.length / 2)] / 1000).toFixed(1)} s, max ${(sorted[sorted.length - 1] / 1000).toFixed(1)} s`)
const errs = [...a.errors, ...b.errors]
record(P, 'No uncaught errors in the app during Phase 3', errs.length ? 'FAIL' : 'PASS', [...new Set(errs)].slice(0, 3).join(' | '))
await a.kill(); await b.kill(); await relay.stop()
process.exit(0)
