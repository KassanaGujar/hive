// node tools/qa/screens.mjs [outDir] : screenshots of Hive's main screens, dark and light, for design review.
import { mkdirSync, writeFileSync } from 'node:fs'
import { Hive, freshDir, wait } from './lib.mjs'
const out = process.argv[2] ?? 'docs/screens'
mkdirSync(out, { recursive: true })
const a = await new Hive('screens', 9470).launch()
await a.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
console.log('actions:', await a.eval(`return Object.keys(H.actions).join(',')`))
const shot = async (name) => { await wait(700); await a.shot(`${out}/${name}.png`); console.log('shot', name) }
const theme = (t) => a.eval(`const s=await h.invoke('settings:set',{theme:'${t}'});H.store.getState().set({settings:s});await w(300);return 1`)

for (const t of ['dark', 'light']) {
  await theme(t)
  await a.eval(`H.store.getState().set({settings:{...H.store.getState().settings,setupComplete:false}});return 1`).catch(() => {})
  await shot(`${t}-setup`)
  await a.profileAs('Tess')
  await a.eval(`H.actions.closeProject?.();return 1`).catch(() => {})
  await shot(`${t}-welcome`)
  const dir = freshDir(`screens-${t}`)
  writeFileSync(`${dir}/index.html`, '<!doctype html>\n<html>\n<head><title>Snake</title><link rel="stylesheet" href="style.css"></head>\n<body>\n  <canvas id="game" width="400" height="400"></canvas>\n  <script src="game.js"></script>\n</body>\n</html>\n')
  writeFileSync(`${dir}/game.js`, "const canvas = document.getElementById('game')\nconst ctx = canvas.getContext('2d')\nlet snake = [{ x: 10, y: 10 }]\n\nfunction step() {\n  // move the head one cell\n  const head = { ...snake[0], x: snake[0].x + 1 }\n  snake.unshift(head)\n  snake.pop()\n}\n")
  writeFileSync(`${dir}/style.css`, 'body { background: #111; display: grid; place-items: center; }\n')
  await a.openProject(dir)
  await a.eval(`H.store.getState().openFile('game.js');return 1`).catch(() => {})
  await shot(`${t}-workspace`)
  for (const [name, call] of [['models', 'openModelStore'], ['planning', 'openPlanning']]) {
    await a.eval(`H.actions.${call}?.();return 1`).catch((e) => console.log(name, e.message))
    await shot(`${t}-${name}`)
    await a.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await a.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await wait(400)
  }
  await a.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 700, deviceScaleFactor: 1, mobile: false })
  await shot(`${t}-workspace-small`)
  await a.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
}
await a.kill()
process.exit(0)
