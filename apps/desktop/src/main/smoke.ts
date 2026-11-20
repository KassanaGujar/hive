import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Integration smoke test for agent runs: load the project's index.html in a hidden, sandboxed
 * window, collect JavaScript errors and failed loads, and check that the page shows something.
 * Returns null for projects that aren't plain web pages.
 */
export async function smokeTestWeb(dir: string, settleMs = 2500): Promise<string[] | null> {
  const page = path.join(dir, 'index.html')
  if (!existsSync(page)) return null
  const problems: string[] = []
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `smoke-${Date.now()}` }
  })
  // Electron ≥ 35 passes a details object; older versions pass (event, level, message, line, sourceId).
  win.webContents.on('console-message', (...args: any[]) => {
    const d = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] }
    const isError = d.level === 'error' || d.level === 3
    if (isError) problems.push(`${String(d.message).slice(0, 300)}${d.sourceId ? ` (${path.basename(String(d.sourceId))}:${d.lineNumber ?? '?'})` : ''}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => problems.push(`Failed to load ${path.basename(url)}: ${desc} (${code})`))
  win.webContents.session.webRequest.onErrorOccurred((d) => {
    if (d.url.startsWith('file:')) problems.push(`Missing file: ${path.basename(decodeURIComponent(new URL(d.url).pathname))}`)
  })
  try {
    await win.loadFile(page).catch(() => {})
    await new Promise((r) => setTimeout(r, settleMs))
    const visible = await win.webContents.executeJavaScript(
      `(() => {
        const canvases = [...document.querySelectorAll('canvas')]
        const drawn = canvases.some((c) => { try { const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data; if (!d) return true; for (let i = 4; i < d.length; i += 4 * 97) if (d[i] !== d[0] || d[i+1] !== d[1] || d[i+2] !== d[2]) return true; return false } catch { return true } })
        const text = document.body ? document.body.innerText.trim().length : 0
        return { canvases: canvases.length, drawn, text, elements: document.body ? document.body.querySelectorAll('*').length : 0 }
      })()`,
      true
    )
    if (visible.canvases > 0 && !visible.drawn) problems.push('The <canvas> stays blank — nothing is ever drawn on it.')
    if (visible.canvases === 0 && visible.text === 0) problems.push('The page shows nothing: no <canvas> and no text on screen.')
    problems.push(...(await runSelfTest(win)))
  } catch (e) {
    problems.push(`Smoke test error: ${(e as Error).message}`)
  } finally {
    win.destroy()
  }
  return [...new Set(problems)]
}

/** The app's own check of the goal's requirements (window.hiveSelfTest, see SELF_TEST_BRIEF), if it wrote one. */
async function runSelfTest(win: BrowserWindow): Promise<string[]> {
  const out = await win.webContents
    .executeJavaScript(
      `(async () => {
        if (typeof window.hiveSelfTest !== 'function') return { none: true }
        try {
          const r = await Promise.race([Promise.resolve(window.hiveSelfTest()), new Promise((_, no) => setTimeout(() => no(new Error('took over 10 seconds')), 10000))])
          return { problems: Array.isArray(r) ? r.map((x) => String(x).slice(0, 300)).slice(0, 20) : ['hiveSelfTest() must return an array of problems, got ' + typeof r] }
        } catch (e) { return { problems: ['hiveSelfTest() threw: ' + String(e && e.message || e).slice(0, 300)] } }
      })()`,
      true
    )
    .catch((e: Error) => ({ problems: [`hiveSelfTest() could not run: ${e.message}`] }))
  return out.none ? [] : out.problems.map((p: string) => `Self-test: ${p}`)
}
