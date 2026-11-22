import { describe, expect, it } from 'vitest'
import { safeCommand } from './safeRun'

describe('safe mode for Run', () => {
  const root = 'C:\\Users\\me\\My Projects\\snake'
  it('locks a plain node program to the project folder, with no child processes or network', () => {
    const r = safeCommand('node server.js --port 3000', root, { allowNetwork: false })
    expect(r.command).toBe('node --permission --allow-fs-read="C:\\Users\\me\\My Projects\\snake" --allow-fs-write="C:\\Users\\me\\My Projects\\snake" server.js --port 3000')
    expect(r.limits).toEqual(['files', 'processes', 'network', 'time'])
  })
  it('lets the network through when asked', () => {
    const r = safeCommand('node index.js', root, { allowNetwork: true })
    expect(r.command).toContain('--allow-net')
    expect(r.limits).toEqual(['files', 'processes', 'time'])
  })
  it('wraps the node step after an install, and only the time limit applies to anything else', () => {
    expect(safeCommand('npm install && node index.js', root, { allowNetwork: false }).command).toBe(
      'npm install && node --permission --allow-fs-read="C:\\Users\\me\\My Projects\\snake" --allow-fs-write="C:\\Users\\me\\My Projects\\snake" index.js'
    )
    for (const cmd of ['python main.py', 'npm run dev', 'go run .', 'nodemon app.js']) {
      const r = safeCommand(cmd, root, { allowNetwork: false })
      expect(r.command).toBe(cmd)
      expect(r.limits).toEqual(['time'])
    }
  })
  it('leaves a node command that already sets permissions alone', () => {
    expect(safeCommand('node --permission --allow-fs-read=* x.js', root, { allowNetwork: false }).command).toBe('node --permission --allow-fs-read=* x.js')
  })
})
