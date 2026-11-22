import { describe, expect, it } from 'vitest'
import { cliErrorKind, cliInvocation, cliTaskPrompt, flattenMessages, isCliSource, parseCliOutput } from './cliAgents'

describe('cli agents', () => {
  it('recognises CLI sources', () => {
    expect(isCliSource('claude-code')).toBe(true)
    expect(isCliSource('codex')).toBe(true)
    expect(isCliSource('ollama')).toBe(false)
  })

  it('runs Claude Code headless with edit tools only and no shell', () => {
    const inv = cliInvocation('claude-code', 'task', 'do it', 'sonnet')
    expect(inv.command).toBe('claude')
    expect(inv.input).toBe('do it')
    expect(inv.args).toContain('-p')
    expect(inv.args.join(' ')).toContain('--permission-mode acceptEdits')
    expect(inv.args.join(' ')).toContain('--disallowedTools Bash,WebFetch,WebSearch')
    expect(inv.args.join(' ')).toContain('--model sonnet')
    // never --bare: bare mode skips the user's login and needs an API key
    expect(inv.args).not.toContain('--bare')
    const ask = cliInvocation('claude-code', 'ask', 'plan it')
    expect(ask.args.join(' ')).not.toContain('acceptEdits')
    expect(ask.args.join(' ')).toMatch(/--disallowedTools .*Edit.*Write/)
  })

  it('picks the model: account default, a chosen one, or sized to the job', () => {
    const model = (mode: 'task' | 'ask' | 'look', m?: string) => {
      const a = cliInvocation('claude-code', mode, 'x', m).args
      return a.includes('--model') ? a[a.indexOf('--model') + 1] : undefined
    }
    expect(model('task')).toBeUndefined()
    expect(model('task', '')).toBeUndefined()
    expect(model('ask', 'opus')).toBe('opus')
    // automatic: quick questions on the light model, building and play-testing on Sonnet
    expect(model('ask', 'auto')).toBe('haiku')
    expect(model('task', 'auto')).toBe('sonnet')
    expect(model('look', 'auto')).toBe('sonnet')
    // codex has no size aliases: automatic means its own default
    expect(cliInvocation('codex', 'task', 'x', 'auto').args).not.toContain('--model')
  })

  it('looks at screenshots with Read only', () => {
    const a = cliInvocation('claude-code', 'look', 'x').args.join(' ')
    expect(a).toContain('--allowedTools Read')
    expect(a).toMatch(/--disallowedTools Bash,Edit,Write/)
    expect(a).not.toContain('acceptEdits')
  })

  it('runs codex exec sandboxed, prompt on stdin', () => {
    const inv = cliInvocation('codex', 'task', 'do it')
    expect(inv.command).toBe('codex')
    expect(inv.args.slice(0, 1)).toEqual(['exec'])
    expect(inv.args).toContain('workspace-write')
    expect(inv.args.at(-1)).toBe('-')
    expect(cliInvocation('codex', 'ask', 'x').args).toContain('read-only')
  })

  it('parses Claude Code results', () => {
    const ok = parseCliOutput('claude-code', 0, '{"type":"result","subtype":"success","is_error":false,"result":"Wrote game.js","total_cost_usd":0.01}\n', '')
    expect(ok).toEqual({ ok: true, text: 'Wrote game.js', costUsd: 0.01 })
    const limit = parseCliOutput('claude-code', 1, '{"type":"result","is_error":true,"result":"Claude AI usage limit reached"}', '')
    expect(limit.ok).toBe(false)
    expect(cliErrorKind(limit.error!)).toBe('quota')
    const crash = parseCliOutput('claude-code', 1, '', 'Invalid API key · Please run /login')
    expect(crash.ok).toBe(false)
    expect(cliErrorKind(crash.error!)).toBe('signed-out')
  })

  it('parses codex JSON lines, keeping the last agent message', () => {
    const out = [
      '{"type":"thread.started"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
      'not json',
      '{"type":"item.completed","item":{"type":"agent_message","text":"Wrote index.html"}}'
    ].join('\n')
    expect(parseCliOutput('codex', 0, out, '')).toEqual({ ok: true, text: 'Wrote index.html' })
    expect(parseCliOutput('codex', 1, '', 'boom').ok).toBe(false)
  })

  it('briefs the task with owned files and reviewer notes', () => {
    const p = cliTaskPrompt({ title: 'Game loop', description: 'Write the loop', files: ['game.js'] }, 'Ball never moves')
    expect(p).toContain('Files you own: game.js')
    expect(p).toContain('Ball never moves')
    expect(p).toContain('Do not run shell commands')
  })

  it('flattens a chat into one prompt', () => {
    expect(flattenMessages([{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Plan.' }])).toBe('Be brief.\n\nUSER:\nPlan.')
  })
})
