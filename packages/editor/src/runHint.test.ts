import { describe, expect, it } from 'vitest'
import { runFailureHint } from './runHint'

describe('what Run says when a program stops with an error', () => {
  it('names a missing npm package and how to get it', () => {
    const out = "node:internal/modules/cjs/loader:1228\n  throw err;\n  ^\n\nError: Cannot find module 'left-pad-ultra-9000'\nRequire stack:\n- C:\\p\\uses-lib.js"
    expect(runFailureHint(out)).toBe('This program needs the package "left-pad-ultra-9000", which isn\'t installed. Install it with: npm install left-pad-ultra-9000')
  })
  it('handles ES module imports and scoped packages', () => {
    expect(runFailureHint("Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@scope/thing' imported from C:\\p\\a.mjs")).toContain('npm install @scope/thing')
  })
  it('a missing file of the project is not a package', () => {
    expect(runFailureHint("Error: Cannot find module './helpers'\nRequire stack:")).toBe('This program loads the file "./helpers", which doesn\'t exist in the project.')
  })
  it('a missing Python module', () => {
    expect(runFailureHint("ModuleNotFoundError: No module named 'flask'")).toBe('This program needs the Python package "flask", which isn\'t installed. Install it with: pip install flask')
  })
  it('says nothing when it cannot tell', () => {
    expect(runFailureHint('TypeError: x is not a function')).toBeNull()
  })
})
