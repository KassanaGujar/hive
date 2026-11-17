// Click-through check: tests a built game the way a person would (clicks, visible text), without the window.game
// test hook the brief asks for. Used when the AI ignored the hook, so "not checked" can't hide a working game — or
// a broken one. Results are recorded as "<title> (<label>, click-through) — <item>".
//   node tools/qa/ui-check.mjs <challenge id> <project dir> <label>
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { record, OUT, REPO, SCRATCH } from './lib.mjs'
import { CHALLENGES } from './challenges.mjs'

const UI_PROBES = {
  tictactoe: `
const R={};const cells=()=>[...document.querySelectorAll('.cell,[data-index]')].slice(0,9);const txt=()=>document.body.innerText;
const click=async(i)=>{cells()[i].click();await new Promise(r=>setTimeout(r,60))};
const restart=async()=>{const b=[...document.querySelectorAll('button')].find(b=>/restart|reset|new game|play again/i.test(b.textContent));if(b){b.click();await new Promise(r=>setTimeout(r,60))}return b};
const scoreEl=document.querySelector('#scoreboard,#score,.scoreboard,.score,[id*=score],[class*=score]');const score=()=>scoreEl?scoreEl.innerText:'';
R['A functional game board']=cells().length===9||cells().length+' cells';
await click(4);R['Two-player gameplay']=cells()[4].textContent.trim()==='X'||'clicking a cell did not place X';
R['Turn management']=/\\bO\\b/.test(txt())||'status does not say it is O\\'s turn';
await click(0);R['Two-player gameplay']=R['Two-player gameplay']===true&&cells()[0].textContent.trim()==='O'?true:(R['Two-player gameplay']===true?'second click did not place O':R['Two-player gameplay']);
await click(4);await click(8);R['Illegal moves are prevented']=(cells()[4].textContent.trim()==='X'&&cells()[8].textContent.trim()==='X')||'clicking an occupied cell changed it or used up the turn';
await restart();const s0=score();for(const i of [0,3,1,4,2])await click(i);
R['Detects winning combinations']=/X[^\\n]*win|win[^\\n]*X/i.test(txt())||'no "X wins" message after X takes the top row';
await click(8);if(R['Illegal moves are prevented']===true&&cells()[8].textContent.trim())R['Illegal moves are prevented']='a move was accepted after the game was won';
const s1=score();R['A scoreboard']=(scoreEl&&s1!==s0&&/1/.test(s1))||('scoreboard '+(scoreEl?JSON.stringify(s0)+' → '+JSON.stringify(s1):'missing'));
await restart();for(const i of [0,1,2,4,3,5,7,6,8])await click(i);R['Detects draws']=/draw|tie/i.test(txt())||'no draw/tie message after a full board with no winner';
const s2=score();const b=await restart();
R['Restart functionality']=(b&&cells().every(c=>!c.textContent.trim())&&score()===s2)||(b?'board not cleared, or the score was reset':'no Restart button');
return R`
}

const [id, dir, label] = process.argv.slice(2)
const c = CHALLENGES.find((x) => x.id === id)
if (!c || !UI_PROBES[id] || !dir || !label) throw new Error('usage: ui-check.mjs <' + Object.keys(UI_PROBES).join('|') + '> <dir> <label>')
const pf = path.join(SCRATCH, `ui-${id}.probe.js`), of = path.join(SCRATCH, `ui-${id}.out.json`)
writeFileSync(pf, UI_PROBES[id])
spawnSync(process.execPath, [path.join(REPO, 'node_modules/electron/cli.js'), path.join(REPO, 'tools/qa/pagecheck.cjs'), pf, of], { timeout: 120000, stdio: 'ignore', env: { ...process.env, PAGECHECK_URL: pathToFileURL(path.join(dir, 'index.html')).href } })
const res = existsSync(of) ? JSON.parse(readFileSync(of, 'utf8')) : { result: { probeError: 'no output' }, errors: [] }
const r = res.result ?? {}
const pass = c.items.filter((it) => r[it] === true).length
console.log(`[${id}] ${label}, click-through: ${pass}/${c.items.length}${r.probeError ? ' — ' + r.probeError : ''}${res.errors?.length ? ' — page errors: ' + res.errors[0] : ''}`)
for (const it of c.items) {
  console.log(`  ${r[it] === true ? 'PASS' : 'FAIL'}  ${it}${r[it] === true ? '' : ' — ' + (r[it] ?? r.probeError ?? 'not checked')}`)
  record(c.phase, `${c.title} (${label}, click-through) — ${it}`, r[it] === true ? 'PASS' : 'FAIL', r[it] === true ? 'checked by clicking, like a player' : String(r[it] ?? r.probeError ?? 'not checked').slice(0, 200))
}
const f = `${OUT}/challenges-team.json`, s = JSON.parse(readFileSync(f, 'utf8'))
const key = Object.keys(s).find((k) => k === `${id}@${label}`)
if (key) { s[key].clickThrough = Object.fromEntries(c.items.map((it) => [it, r[it] === true ? true : r[it] ?? 'not checked'])); writeFileSync(f, JSON.stringify(s, null, 1)) }
