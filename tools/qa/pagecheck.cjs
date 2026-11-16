// Load a web page in a hidden Electron window, run a probe script in it, print JSON.
//   PAGECHECK_URL=<url> electron tools/qa/pagecheck.cjs <probe.js> <out.json> [screenshot.png]
// (the URL goes in an env var: Electron ignores the script entirely when an argument is a URL)
// The probe file's body runs as an async function in the page and must return a JSON value.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const url = process.env.PAGECHECK_URL
const [probeFile, outFile, shotFile] = process.argv.slice(2).filter((x) => !x.startsWith('--')).slice(-3)
const trace = (m) => process.env.PAGECHECK_TRACE && console.log('[pagecheck]', m)
trace('args ' + JSON.stringify([url, probeFile, outFile, shotFile]))
process.on('uncaughtException', (e) => { console.error('[pagecheck] crash', e); try { fs.writeFileSync(outFile, JSON.stringify({ result: { probeError: 'checker crashed: ' + e.message }, errors: [] })) } catch {} ; app.exit(1) })
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (e) => {
    const level = e.level ?? e.params?.level
    const msg = e.message ?? e.params?.message
    if (level === 'error' || level === 3) errors.push(String(msg).slice(0, 300))
  })
  win.webContents.on('render-process-gone', () => errors.push('renderer crashed'))
  let result
  try {
    await win.loadURL(url)
    await new Promise((r) => setTimeout(r, 1500))
    const body = fs.readFileSync(probeFile, 'utf8')
    result = await Promise.race([
      win.webContents.executeJavaScript(`(async()=>{try{${body}}catch(e){return {probeError:String(e&&e.stack||e)}}})()`, true),
      new Promise((r) => setTimeout(() => r({ probeError: 'probe timed out after 60 s' }), 60000))
    ])
    if (shotFile) fs.writeFileSync(shotFile, (await win.webContents.capturePage()).toPNG())
  } catch (e) {
    result = { probeError: String(e) }
  }
  fs.writeFileSync(outFile, JSON.stringify({ result, errors }, null, 1))
  app.exit(0)
})
