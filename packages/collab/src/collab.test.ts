import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { applyPlannerEdits, humanEdit, planToMarkdown, undoEdit, type PlanItem } from './plan'
import { diffPreview, makeFeedEvent, shouldCoalesce } from './feed'
import { decrypt, encrypt, importKey, newRoomKey } from './crypto'
import { newInviteCode, parseInvite, inviteLink } from './invite'
import { setText, applyChangeOnto, redoPrompt } from './doc'

describe('planner edits', () => {
  it('adds items traced to their messages and dedupes', () => {
    const r = applyPlannerEdits(
      [],
      [
        { section: 'features', op: 'add', text: 'Dark mode', sources: ['m1'] },
        { section: 'features', op: 'add', text: 'dark mode!', sources: ['m2'] },
        { section: 'questions', op: 'add', text: 'Which DB?', sources: ['nope'] }
      ],
      ['m1', 'm2', 'm3']
    )
    expect(r.items).toHaveLength(2)
    expect(r.items[0].sources).toEqual(['m1', 'm2'])
    expect(r.items[1].sources).toEqual(['m1', 'm2', 'm3']) // invalid source → batch ids
  })
  it('never overwrites a human edit; proposes instead', () => {
    const base = applyPlannerEdits([], [{ section: 'features', op: 'add', text: 'A', sources: ['m1'] }], ['m1']).items
    const edited: PlanItem[] = [humanEdit(base[0], { text: 'A (human)' }, 'sam')]
    const r = applyPlannerEdits(edited, [{ op: 'update', itemId: edited[0].id, text: 'B', sources: ['m2'] }], ['m2'])
    expect(r.items[0].text).toBe('A (human)')
    expect(r.proposals).toHaveLength(1)
  })
  it('undoes an AI edit', () => {
    const r = applyPlannerEdits([], [{ section: 'tasks', op: 'add', text: 'Build UI', sources: ['m1'] }], ['m1'])
    expect(undoEdit(r.items, r.applied[0])).toEqual([])
  })
  it('exports markdown', () => {
    const r = applyPlannerEdits([], [{ section: 'tasks', op: 'add', text: 'Build UI', owner: 'sam', sources: ['m1'] }], ['m1'])
    expect(planToMarkdown(r.items)).toContain('- [ ] Build UI — @sam')
  })
})

describe('feed', () => {
  it('builds diff previews and coalesces typing', () => {
    const d = diffPreview('a.txt', 'one\ntwo\n', 'one\nthree\n')
    expect(d).toContain('-two')
    expect(d).toContain('+three')
    const a = makeFeedEvent({ actor: 'sam', kind: 'file.edited', files: ['a.txt'] })
    const b = makeFeedEvent({ actor: 'sam', kind: 'file.edited', files: ['a.txt'] })
    expect(shouldCoalesce(a, b)).toBe(true)
    expect(shouldCoalesce(a, { ...b, actor: 'kim' })).toBe(false)
    expect(makeFeedEvent({ actor: 'x', kind: 'file.renamed', files: ['a', 'b'] }).summary).toBe('renamed a → b')
  })
})

describe('crypto + invites', () => {
  it('round-trips encryption', async () => {
    const k = await importKey(newRoomKey())
    const ct = await encrypt(k, new TextEncoder().encode('secret'))
    expect(new TextDecoder().decode(await decrypt(k, ct))).toBe('secret')
    await expect(decrypt(await importKey(newRoomKey()), ct)).rejects.toThrow()
  })
  it('makes readable codes and parses links', () => {
    const c = newInviteCode()
    expect(c).toMatch(/^[A-Z2-9]{6}$/)
    const link = inviteLink({ relayUrl: 'wss://r.example', roomId: 'abcd1234', roomKey: 'KEY_-x', projectName: 'todo', role: 'viewer' }, c)
    const p = parseInvite(link)
    expect(p).toMatchObject({ relayUrl: 'wss://r.example', roomId: 'abcd1234', roomKey: 'KEY_-x', role: 'viewer', code: c })
    expect(parseInvite(c.toLowerCase())).toEqual({ code: c })
  })
})

describe('setText', () => {
  it('applies a minimal splice', () => {
    const doc = new Y.Doc()
    const t = doc.getText('t')
    t.insert(0, 'hello world')
    setText(t, 'hello brave world')
    expect(t.toString()).toBe('hello brave world')
  })
})

describe('applyChangeOnto (accepting an AI proposal made against an older copy)', () => {
  const base = ['function alpha() { return 1 }', '', 'function beta() { return 2 }', '', 'function gamma() { return 3 }', ''].join('\n')
  it('keeps a teammate edit made elsewhere in the file', () => {
    const ai = base.replace('return 1', "return 'A'")
    const teammate = base.replace('return 3', 'return 33')
    expect(applyChangeOnto(base, ai, teammate)).toBe(base.replace('return 1', "return 'A'").replace('return 3', 'return 33'))
  })
  it('two AI proposals from the same base both land', () => {
    const p1 = base.replace('return 2', "return 'B'")
    const p2 = base.replace('return 3', "return 'C'")
    const after1 = applyChangeOnto(base, p1, base) as string
    expect(applyChangeOnto(base, p2, after1)).toBe(base.replace('return 2', "return 'B'").replace('return 3', "return 'C'"))
  })
  it('refuses when both changed the same line', () => {
    expect(applyChangeOnto(base, base.replace('return 1', 'return 10'), base.replace('return 1', 'return 11'))).toBe(false)
  })
  it('is a plain replace when nothing changed meanwhile', () => {
    expect(applyChangeOnto(base, 'x', base)).toBe('x')
  })
  it('two AI replies that each add a blank line at the end still both land (Claude Code did this; the second Accept was refused)', () => {
    const p1 = base.replace('return 2', "return 'B'") + '\n'
    const p2 = base.replace('return 3', "return 'C'") + '\n\n'
    const after1 = applyChangeOnto(base, p1, base) as string
    expect(after1).toBe(base.replace('return 2', "return 'B'")) // the file keeps its own ending
    expect(applyChangeOnto(base, p2, after1)).toBe(base.replace('return 2', "return 'B'").replace('return 3', "return 'C'"))
  })
  it('the same change made on both sides is applied once, not refused', () => {
    const both = base.replace('return 1', 'return 10')
    expect(applyChangeOnto(base, both, both)).toBe(both)
    const ai = base.replace('return 1', 'return 10').replace('return 3', 'return 30')
    expect(applyChangeOnto(base, ai, both)).toBe(ai)
  })
})

describe('redoPrompt (Accept refused because someone changed the same lines)', () => {
  it('gives the AI the three versions and asks for the whole current file with its change on top', () => {
    const p = redoPrompt('game.js', 'move(x)\n', 'move(x + 1)\n', 'move(min(x, 100))\n')
    expect(p).toContain('```game.js\nmove(x)\n```') // what it saw
    expect(p).toContain('```game.js\nmove(x + 1)\n```') // what it proposed
    expect(p).toContain('```game.js\nmove(min(x, 100))\n```') // the file now
    expect(p).toMatch(/keep.*(teammate|other).*change/i)
    expect(p).toMatch(/complete/i)
  })
})

describe('invite links', () => {
  it('editor links carry the edit token; viewer links do not', () => {
    const info = { relayUrl: 'wss://r', roomId: 'abcdef12', roomKey: 'KEY', projectName: 'p', role: 'editor' as const, editToken: 'TOK' }
    const ed = parseInvite(inviteLink(info, 'ABCDEF'))
    expect(ed.roomKey).toBe('KEY')
    expect(ed.editToken).toBe('TOK')
    const vw = parseInvite(inviteLink({ ...info, role: 'viewer', editToken: undefined }, 'ABCDEF'))
    expect(vw.roomKey).toBe('KEY')
    expect(vw.editToken).toBeUndefined()
  })
})
