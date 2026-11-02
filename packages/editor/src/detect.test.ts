import { describe, expect, it } from 'vitest'
import { detectProject, languageFor, type ProjectProbe } from './index'

const probe = (files: string[], json: Record<string, any> = {}, tools = ['node', 'python', 'go']): ProjectProbe => ({
  files,
  readJson: (n) => json[n] ?? null,
  hasTool: (t) => tools.includes(t),
  platform: 'win32'
})

describe('project detection', () => {
  it('runs npm dev and installs first when node_modules is missing', () => {
    const r = detectProject(probe(['package.json'], { 'package.json': { scripts: { dev: 'vite' } } }), '/p')
    expect(r?.command).toBe('npm install && npm run dev')
    expect(r?.port).toBe(5173)
  })
  it('prefers start when no dev script', () => {
    const r = detectProject(probe(['package.json', 'node_modules'], { 'package.json': { scripts: { start: 'node s.js' } } }), '/p')
    expect(r?.command).toBe('npm run start')
  })
  it('detects python', () => {
    expect(detectProject(probe(['main.py']), '/p')?.command).toBe('python main.py')
  })
  it('detects static html', () => {
    const r = detectProject(probe(['index.html', 'style.css']), '/p')
    expect(r?.kind).toBe('static')
  })
  it('reports missing runtimes', () => {
    const r = detectProject(probe(['Cargo.toml']), '/p')
    expect(r?.requires?.tool).toBe('cargo')
  })
  it('hive.json overrides the command and env', () => {
    const r = detectProject(
      probe(['package.json', 'hive.json'], { 'package.json': { scripts: { dev: 'vite' } }, 'hive.json': { command: 'npm run serve', env: { A: '1' }, port: 9000 } }),
      '/p'
    )
    expect(r?.command).toBe('npm run serve')
    expect(r?.env).toEqual({ A: '1' })
    expect(r?.port).toBe(9000)
  })
  it('returns null for empty folders', () => {
    expect(detectProject(probe([]), '/p')).toBeNull()
  })
})

describe('languageFor', () => {
  it('maps extensions', () => {
    expect(languageFor('src/a.tsx')).toBe('typescript')
    expect(languageFor('Dockerfile')).toBe('dockerfile')
    expect(languageFor('x.unknown')).toBe('plaintext')
  })
})
