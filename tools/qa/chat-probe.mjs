// Challenge 8 probe: starts the AI-written chat server with Hive's Run button and tests its API with
// real HTTP + Server-Sent Events clients. Returns { result: {item: true|reason}, errors: [] }.
import { existsSync } from 'node:fs'
import { wait, until } from './lib.mjs'

function sse(base, user, room) {
  const events = []
  const ctl = new AbortController()
  const ready = fetch(`${base}/events?user=${encodeURIComponent(user)}&room=${encodeURIComponent(room)}`, { signal: ctl.signal }).then(async (res) => {
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    ;(async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
            for (const line of chunk.split('\n')) if (line.startsWith('data:')) try { events.push(JSON.parse(line.slice(5).trim())) } catch {}
          }
        }
      } catch {}
    })()
    return res.status
  }).catch((e) => 'error ' + e.message)
  return { events, ready, close: () => ctl.abort() }
}
const post = (base, p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => { try { return await r.json() } catch { return { status: r.status } } })
const get = (base, p) => fetch(base + p).then((r) => r.json())

export async function testChatServer(app, dir) {
  // Each run tags its own messages: the history file syncs between teammates, so Omar's server started with Tess's
  // test messages already in it and every count was off (11/11 for Tess, 4/11 for Omar on identical files).
  const T = Date.now().toString(36)
  const HELLO = `hello ben ${T}`, SECRET = `only for secret ${T}`, BURST = `burst-${T}-`
  const R = {}
  const errors = []
  const start = async () => {
    await app.invoke('run:stop')
    const st = await app.invoke('run:start')
    if (st.status !== 'running') return null
    for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:3000/'); if (r.status < 500) return 'http://127.0.0.1:3000' } catch {} await wait(250) }
    return null
  }
  const base = await start()
  if (!base) return { result: { 'A chat interface': 'server did not start on port 3000: ' + JSON.stringify(await app.invoke('run:state')) }, errors }
  try {
    const html = await (await fetch(base + '/')).text()
    R['A chat interface'] = (/<input|<textarea/i.test(html) && /send/i.test(html)) || 'GET / has no message box / send button'
    const ana = sse(base, 'Ana', 'lobby'), ben = sse(base, 'Ben', 'lobby'), cy = sse(base, 'Cy', 'secret')
    await Promise.all([ana.ready, ben.ready, cy.ready])
    await wait(600)
    const online = await get(base, '/online?room=lobby').catch(() => [])
    R['Multiple users'] = (Array.isArray(online) && online.includes('Ana') && online.includes('Ben')) || 'online list ' + JSON.stringify(online)
    R['Online indicators'] = (ben.events.some((e) => e.type === 'presence' && (e.online ?? []).includes('Ana'))) || 'no presence event listing Ana'
    const sent = await post(base, '/send', { user: 'Ana', room: 'lobby', text: HELLO })
    await until(() => ben.events.some((e) => e.type === 'message' && e.message?.text === HELLO), 3000)
    const got = ben.events.find((e) => e.type === 'message' && e.message?.text === HELLO)
    R['Sending and receiving messages'] = (!!got && sent?.text === HELLO) || 'Ben did not receive the message'
    R['Timestamps'] = (typeof sent?.ts === 'number' && Math.abs(sent.ts - Date.now()) < 60000 && got?.message?.ts === sent.ts) || 'ts ' + sent?.ts
    await post(base, '/typing', { user: 'Ben', room: 'lobby' })
    await until(() => ana.events.some((e) => e.type === 'typing' && e.user === 'Ben'), 3000)
    R['Typing indicators'] = ana.events.some((e) => e.type === 'typing' && e.user === 'Ben') || 'no typing event'
    await post(base, '/send', { user: 'Cy', room: 'secret', text: SECRET })
    await wait(800)
    const leaked = [...ana.events, ...ben.events].some((e) => e.message?.text === SECRET)
    const cyGot = cy.events.some((e) => e.message?.text === SECRET)
    R['Private chat rooms'] = (!leaked && cyGot && !cy.events.some((e) => e.message?.text === HELLO)) || `leaked to lobby=${leaked}, room member got it=${cyGot}`
    await Promise.all(Array.from({ length: 50 }, (_, i) => post(base, '/send', { user: i % 2 ? 'Ana' : 'Ben', room: 'lobby', text: BURST + i })))
    await wait(1500)
    const burstSeen = ben.events.filter((e) => e.type === 'message' && (e.message?.text ?? '').startsWith(BURST)).map((e) => e.message.text)
    const hist = await get(base, '/history?room=lobby')
    const burstHist = hist.filter((m) => String(m.text).startsWith(BURST)).map((m) => m.text)
    const ids = hist.map((m) => m.id)
    R['Handles simultaneous messages'] = (new Set(burstSeen).size === 50 && burstHist.length === 50) || `live ${new Set(burstSeen).size}/50, history ${burstHist.length}/50`
    R["Messages aren't lost or duplicated"] = (burstSeen.length === 50 && new Set(ids).size === ids.length && burstHist.length === 50) || `live copies ${burstSeen.length} (unique ${new Set(burstSeen).size}), duplicate ids ${ids.length - new Set(ids).size}`
    ben.close()
    await wait(1200)
    const online2 = await get(base, '/online?room=lobby').catch(() => [])
    R['Handles disconnected users'] = (!online2.includes('Ben') && ana.events.some((e) => e.type === 'presence' && !(e.online ?? []).includes('Ben'))) || 'Ben still listed after disconnecting: ' + JSON.stringify(online2)
    ana.close(); cy.close()
    // restart the server: history must survive
    const base2 = await start()
    const hist2 = base2 ? await get(base2, '/history?room=lobby') : []
    R['Persistent message history'] = (existsSync(`${dir}/data/messages.json`) && hist2.some((m) => m.text === HELLO) && hist2.length === hist.length) || `after restart: ${hist2.length} messages (before ${hist.length})`
  } catch (e) {
    R.probeError = String(e.message ?? e)
  }
  await app.invoke('run:stop')
  return { result: R, errors }
}
