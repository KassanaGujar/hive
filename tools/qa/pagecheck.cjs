// Load a web page in a hidden Electron window, run a probe script in it, print JSON.
//   electron tools/qa/pagecheck.cjs <url> <probe.js> <out.json> [screenshot.png]
// The probe file's body runs as an async function in the page and must return a JSON value.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const [url, probeFile, outFile, shotFile] = process.argv.slice(-4).filter((x) => !x.startsWith('--'))
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
