import type { ChatChunk, ChatMessage, ToolCall, ToolSpec } from '@hive/shared'

/**
 * One client for every model: Ollama (http://localhost:11434/v1), OpenRouter, Groq and the HF router
 * all speak the OpenAI chat-completions format.
 */
export interface Endpoint {
  baseUrl: string
  apiKey?: string
  model: string
  /** false → tools are described in the prompt and parsed from JSON in the reply. */
  nativeTools?: boolean
  extraHeaders?: Record<string, string>
}

export interface ChatOptions {
  tools?: ToolSpec[]
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
}

type OAIMessage = {
  role: string
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

function toOAI(messages: ChatMessage[]): OAIMessage[] {
  return messages.map((m) => {
    const out: OAIMessage = { role: m.role, content: m.content }
    if (m.toolCalls?.length) {
      out.tool_calls = m.toolCalls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.name, arguments: JSON.stringify(t.arguments) }
      }))
    }
    if (m.toolCallId) out.tool_call_id = m.toolCallId
    if (m.name) out.name = m.name
    return out
  })
}

// ---------- JSON tool-call fallback ----------

export function toolPrompt(tools: ToolSpec[]): string {
  const lines = tools.map(
    (t) => `- ${t.name}: ${t.description}\n  arguments schema: ${JSON.stringify(t.parameters)}`
  )
  return [
    'You can call tools. To call one, reply with ONLY a JSON object in a ```json code block:',
    '```json',
    '{"tool": "<tool name>", "arguments": { ... }}',
    '```',
    'Call one tool per reply. After the tool result arrives you may call another.',
    'Available tools:',
    ...lines
  ].join('\n')
}

/** Pull a {"tool": ..., "arguments": ...} object out of free text. */
export function parseJsonToolCall(text: string, tools: ToolSpec[]): ToolCall | null {
  const names = new Set(tools.map((t) => t.name))
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fence.exec(text))) candidates.push(m[1])
  // Bare object fallback: first {...} balanced span.
  const start = text.indexOf('{')
  if (start >= 0) candidates.push(balanced(text, start))
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim())
      const name = obj.tool ?? obj.name ?? obj.function
      if (typeof name === 'string' && names.has(name)) {
        const args = obj.arguments ?? obj.args ?? obj.parameters ?? {}
        return {
          id: `call_${Math.random().toString(36).slice(2, 10)}`,
          name,
          arguments: typeof args === 'string' ? safeJson(args) : args
        }
      }
    } catch {
      /* try next */
    }
  }
  return null
}

function balanced(text: string, start: number): string {
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

/** Convert tool-role messages into plain user messages for models without native tools. */
function flattenForFallback(messages: ChatMessage[], tools: ToolSpec[]): ChatMessage[] {
  const out: ChatMessage[] = []
  const sysIdx = messages.findIndex((m) => m.role === 'system')
  const prompt = toolPrompt(tools)
  if (sysIdx === -1) out.push({ role: 'system', content: prompt })
  for (const [i, m] of messages.entries()) {
    if (i === sysIdx) out.push({ role: 'system', content: `${m.content}\n\n${prompt}` })
    else if (m.role === 'tool') out.push({ role: 'user', content: `Tool result (${m.name}):\n${m.content}` })
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      const t = m.toolCalls[0]
      out.push({
        role: 'assistant',
        content: '```json\n' + JSON.stringify({ tool: t.name, arguments: t.arguments }) + '\n```'
      })
    } else out.push({ role: m.role, content: m.content })
  }
  return out
}

// ---------- streaming ----------

export class ToolsUnsupportedError extends Error {}

export async function* streamChat(
  ep: Endpoint,
  messages: ChatMessage[],
  opts: ChatOptions = {}
): AsyncGenerator<ChatChunk> {
  const tools = opts.tools ?? []
  const useNative = tools.length > 0 && ep.nativeTools !== false
  try {
    yield* streamOnce(ep, useNative ? messages : tools.length ? flattenForFallback(messages, tools) : messages, opts, useNative, tools)
  } catch (e) {
    if (e instanceof ToolsUnsupportedError && useNative) {
      yield* streamOnce(ep, flattenForFallback(messages, tools), opts, false, tools)
    } else throw e
  }
}

async function* streamOnce(
  ep: Endpoint,
  messages: ChatMessage[],
  opts: ChatOptions,
  native: boolean,
  tools: ToolSpec[]
): AsyncGenerator<ChatChunk> {
  const body: Record<string, unknown> = {
    model: ep.model,
    messages: toOAI(messages),
    stream: true,
    temperature: opts.temperature ?? 0.2
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (native) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
  }
  const res = await fetch(`${ep.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ep.apiKey ? { Authorization: `Bearer ${ep.apiKey}` } : {}),
      ...ep.extraHeaders
    },
    body: JSON.stringify(body),
    signal: opts.signal
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    if (native && res.status === 400 && /tool/i.test(text)) throw new ToolsUnsupportedError(text)
    throw new Error(`Model request failed (${res.status}): ${text.slice(0, 400)}`)
  }

  const started = Date.now()
  let tokenCount = 0
  let fullText = ''
  const partial = new Map<number, { id: string; name: string; args: string }>()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let json: any
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error))
      const delta = json.choices?.[0]?.delta ?? {}
      if (typeof delta.content === 'string' && delta.content) {
        tokenCount++
        fullText += delta.content
        yield { text: delta.content, tokensPerSec: rate(tokenCount, started) }
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0
        const cur = partial.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        partial.set(idx, cur)
      }
    }
  }

  let toolCalls: ToolCall[] = [...partial.values()]
    .filter((p) => p.name)
    .map((p) => ({ id: p.id, name: p.name, arguments: safeJson(p.args || '{}') }))
  // Some models answer with JSON in text even when native tools were offered.
  if (!toolCalls.length && tools.length) {
    const parsed = parseJsonToolCall(fullText, tools)
    if (parsed) toolCalls = [parsed]
  }
  yield { done: true, toolCalls: toolCalls.length ? toolCalls : undefined, tokensPerSec: rate(tokenCount, started) }
}

function rate(tokens: number, started: number) {
  const s = (Date.now() - started) / 1000
  return s > 0 ? Math.round((tokens / s) * 10) / 10 : 0
}

/** Collect a whole reply. */
export async function chatOnce(ep: Endpoint, messages: ChatMessage[], opts: ChatOptions = {}) {
  let text = ''
  let toolCalls: ToolCall[] | undefined
  let tokensPerSec = 0
  for await (const c of streamChat(ep, messages, opts)) {
    if (c.text) text += c.text
    if (c.toolCalls) toolCalls = c.toolCalls
    if (c.tokensPerSec) tokensPerSec = c.tokensPerSec
  }
  return { text, toolCalls, tokensPerSec }
}

/** Strip <think>…</think> reasoning blocks some models (DeepSeek R1, Qwen3) emit. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}

/** Find the first JSON value in a model reply (fenced or bare). */
export function extractJson<T = unknown>(text: string): T | null {
  const clean = stripThinking(text)
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(clean)
  const candidates = [fence?.[1], clean]
  for (const c of candidates) {
    if (!c) continue
    const i = c.search(/[[{]/)
    if (i < 0) continue
    try {
      return JSON.parse(c.slice(i).trim()) as T
    } catch {
      try {
        return JSON.parse(balancedAny(c, i)) as T
      } catch {
        /* next */
      }
    }
  }
  return null
}

function balancedAny(text: string, start: number) {
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return text.slice(start, i + 1)
  }
  return text.slice(start)
}
