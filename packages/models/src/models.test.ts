import { describe, expect, it } from 'vitest'
import type { Hardware, InstalledModel } from '@hive/shared'
import { filterCatalog, fitLabel, recommendStarter } from './catalog'
import { rankTeam } from './ranking'
import { extractJson, parseJsonToolCall } from './client'
import { parseProposals } from './proposals'
import catalogJson from '../../../catalog/catalog.json'

const hw16: Hardware = { totalRamGB: 16, freeRamGB: 8, gpuName: null, vramGB: 0, freeDiskGB: 200, cpuCores: 8, platform: 'win32' }
const hwGpu: Hardware = { ...hw16, totalRamGB: 64, gpuName: 'RTX 4090', vramGB: 24 }

describe('catalog filter', () => {
  it('drops entries without free: true', () => {
    const c = filterCatalog({
      models: [
        { id: 'a', name: 'A', source: 'ollama', pullName: 'a', free: true },
        { id: 'b', name: 'B', source: 'ollama', pullName: 'b' },
        { id: 'c', name: 'C', source: 'ollama', pullName: 'c', free: 'yes' }
      ]
    })
    expect(c.models.map((m) => m.id)).toEqual(['a'])
  })
  it('drops OpenRouter models that are not :free variants', () => {
    const c = filterCatalog({
      models: [
        { id: 'p', name: 'Paid', source: 'openrouter', endpointModel: 'anthropic/claude', free: true },
        { id: 'f', name: 'Free', source: 'openrouter', endpointModel: 'x/y:free', free: true }
      ]
    })
    expect(c.models.map((m) => m.id)).toEqual(['f'])
  })
  it('accepts the bundled catalog fully', () => {
    const c = filterCatalog(catalogJson)
    expect(c.models.length).toBe((catalogJson as any).models.length)
  })
})

describe('fit labels', () => {
  const cat = filterCatalog(catalogJson)
  const get = (id: string) => cat.models.find((m) => m.id === id)!
  it('labels by RAM and VRAM', () => {
    expect(fitLabel(get('gpt-oss-120b'), hw16)).toBe('too-big')
    expect(fitLabel(get('qwen2.5-coder-7b'), hw16)).toBe('slow')
    expect(fitLabel(get('qwen2.5-coder-7b'), hwGpu)).toBe('runs-well')
    expect(fitLabel(get('qwen2.5-coder-1.5b'), hw16)).toBe('runs-well')
  })
  it('recommends a starter that fits', () => {
    expect(recommendStarter(cat, hwGpu)?.sizeGB).toBeLessThanOrEqual(10)
    expect(recommendStarter(cat, hw16)).toBeDefined()
  })
})

const model = (id: string, tier: InstalledModel['tier'], codingScore: number): InstalledModel => ({
  id, name: id, source: 'ollama', model: id, tier, codingScore, sizeGB: 1, minRamGB: 1, contextTokens: 8192
})

describe('ranking', () => {
  it('puts the strongest model as architect', () => {
    const t = rankTeam([model('w', 'worker', 50), model('top', 'top', 80), model('l', 'lead', 60)])
    expect(t.architect?.id).toBe('top')
    expect(t.leads.map((m) => m.id)).toEqual(['l'])
    expect(t.workers.map((m) => m.id)).toEqual(['w'])
  })
  it('single model plays every role', () => {
    const t = rankTeam([model('only', 'worker', 50)])
    expect(t.architect?.id).toBe('only')
    expect(t.leads[0].id).toBe('only')
    expect(t.workers[0].id).toBe('only')
  })
  it('respects tier overrides', () => {
    const t = rankTeam([model('a', 'top', 80), model('b', 'worker', 50)], { b: 'top', a: 'worker' })
    expect(t.architect?.id).toBe('b')
  })
})

describe('json helpers', () => {
  const tools = [{ name: 'write_file', description: '', parameters: {} }]
  it('parses fenced tool calls', () => {
    const c = parseJsonToolCall('ok\n```json\n{"tool":"write_file","arguments":{"path":"a"}}\n```', tools)
    expect(c?.name).toBe('write_file')
    expect(c?.arguments).toEqual({ path: 'a' })
  })
  it('ignores unknown tools', () => {
    expect(parseJsonToolCall('{"tool":"rm_rf","arguments":{}}', tools)).toBeNull()
  })
  it('extracts json after think blocks', () => {
    expect(extractJson('<think>{"no":1}</think> here {"a": [1, 2]} trailing')).toEqual({ a: [1, 2] })
  })
})

import { canonicalToolName } from './client'
describe('tool name aliases', () => {
  const tools = ['write_file', 'read_file', 'report_done'].map((name) => ({ name, description: '', parameters: {} }))
  it('maps near-miss names small models invent', () => {
    expect(canonicalToolName('create_file', tools)).toBe('write_file')
    expect(canonicalToolName('Finish', tools)).toBe('report_done')
    expect(canonicalToolName('write_file', tools)).toBe('write_file')
    expect(canonicalToolName('rm_rf', tools)).toBe('rm_rf')
  })
  it('parses {"name":"create_file","parameters":{...}} as write_file', () => {
    const c = parseJsonToolCall('{"name":"create_file","parameters":{"path":"a.css","content":"x"}}', tools)
    expect(c?.name).toBe('write_file')
    expect(c?.arguments).toEqual({ path: 'a.css', content: 'x' })
  })
})

import { parseLenient } from './client'
describe('small-model tool calls seen in the Snake test', () => {
  const tools = ['write_file', 'report_done'].map((name) => ({ name, description: '', parameters: {} }))
  it('maps invented write tool names like create_index_html', () => {
    expect(canonicalToolName('create_index_html', tools)).toBe('write_file')
  })
  it('parses tool JSON with raw newlines inside strings, after leading junk', () => {
    const text = '}  {   "name": "write_file",   "parameters": {     "file": "style.css",     "content": "body {\n  color: #fff;\n}"   } }'
    const c = parseJsonToolCall(text, tools)
    expect(c?.name).toBe('write_file')
    expect(c?.arguments).toEqual({ file: 'style.css', content: 'body {\n  color: #fff;\n}' })
    expect(parseLenient('{"a":"x\ny"}')).toEqual({ a: 'x\ny' })
  })
})

describe('parseProposals (files an AI reply proposes)', () => {
  const F = '```'
  it('path as the info string', () => {
    expect(parseProposals(F + 'src/app.js\nconst a = 1\n' + F)).toEqual([{ path: 'src/app.js', content: 'const a = 1\n' }])
  })
  it('language then path', () => {
    expect(parseProposals(F + 'html index.html\n<h1>x</h1>\n' + F)[0].path).toBe('index.html')
  })
  it('file name on the line before a language block', () => {
    const r = parseProposals('### index.html\n' + F + 'html\n<p>a</p>\n' + F + '\n\n**game.js**\n' + F + 'javascript\nlet x\n' + F)
    expect(r.map((p) => p.path)).toEqual(['index.html', 'game.js'])
  })
  it('a plain language block without a file name is not a proposal', () => {
    expect(parseProposals('Run this:\n' + F + 'bash\nnpm test\n' + F)).toEqual([])
  })
  it('later block for the same file wins; no paths outside the project', () => {
    const r = parseProposals(F + 'a.js\n1\n' + F + F + 'a.js\n2\n' + F + F + '../x.js\nbad\n' + F)
    expect(r).toEqual([{ path: 'a.js', content: '2\n' }])
  })
})

describe('local Ollama uses the native API with a real context window', () => {
  it('sends num_ctx and streams the reply', async () => {
    const { createServer } = await import('node:http')
    const { streamChat } = await import('./client')
    let seen: any = null
    const srv = createServer((req, res) => {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        seen = { url: req.url, body: JSON.parse(body) }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' })
        res.write(JSON.stringify({ message: { role: 'assistant', content: 'Hel' }, done: false }) + '\n')
        res.write(JSON.stringify({ message: { role: 'assistant', content: 'lo' }, done: false }) + '\n')
        res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n')
      })
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    let text = ''
    for await (const c of streamChat({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'm', ollamaContext: 16384 }, [{ role: 'user', content: 'hi' }])) if (c.text) text += c.text
    srv.close()
    expect(seen.url).toBe('/api/chat')
    expect(seen.body.options.num_ctx).toBe(16384)
    expect(text).toBe('Hello')
  })
})
