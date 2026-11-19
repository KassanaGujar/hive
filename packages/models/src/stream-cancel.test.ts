import { afterEach, describe, expect, it } from 'vitest'
import { setModelFetch, streamChat } from './client'

// A server that would keep sending forever; records whether the client hung up.
function endlessResponse(line: (i: number) => string) {
  const state = { cancelled: false }
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(ctl) {
      ctl.enqueue(new TextEncoder().encode(line(i++)))
    },
    cancel() {
      state.cancelled = true
    }
  })
  return { state, response: new Response(body, { status: 200 }) }
}

afterEach(() => setModelFetch((...a) => fetch(...a)))

describe('leaving a reply early hangs up on the model', () => {
  // Stopping a looping reply only helps if the server stops generating too; an unread open stream kept Ollama busy.
  it('Ollama: the HTTP stream is cancelled when the reader stops early', async () => {
    const { state, response } = endlessResponse(() => JSON.stringify({ message: { content: 'again ' }, done: false }) + '\n')
    setModelFetch(async () => response)
    let n = 0
    for await (const c of streamChat({ baseUrl: 'http://x/v1', model: 'm', ollamaContext: 8192 }, [{ role: 'user', content: 'hi' }])) {
      if (c.text && ++n >= 3) break
    }
    expect(state.cancelled).toBe(true)
  })
  it('OpenAI-style providers: the HTTP stream is cancelled when the reader stops early', async () => {
    const { state, response } = endlessResponse(() => `data: ${JSON.stringify({ choices: [{ delta: { content: 'again ' } }] })}\n\n`)
    setModelFetch(async () => response)
    let n = 0
    for await (const c of streamChat({ baseUrl: 'http://x/v1', model: 'm' }, [{ role: 'user', content: 'hi' }])) {
      if (c.text && ++n >= 3) break
    }
    expect(state.cancelled).toBe(true)
  })
})
