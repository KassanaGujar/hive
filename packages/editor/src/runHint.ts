/**
 * A plain sentence for the Run bar when a program stops because something it loads is missing. Before, Run only said
 * "Exited with code 1" and the reason was buried in the terminal. Null when the output doesn't say.
 */
export function runFailureHint(output: string): string | null {
  const node = /Cannot find (?:module|package) '([^']+)'/.exec(output)
  if (node) {
    const name = node[1]
    if (/^(\.|\/|[A-Za-z]:[\\/])/.test(name)) return `This program loads the file "${name}", which doesn't exist in the project.`
    // "lodash/fp" → the package is "lodash"; "@scope/pkg/x" → "@scope/pkg"
    const pkg = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]
    return `This program needs the package "${pkg}", which isn't installed. Install it with: npm install ${pkg}`
  }
  const py = /ModuleNotFoundError: No module named '([^'.]+)/.exec(output)
  if (py) return `This program needs the Python package "${py[1]}", which isn't installed. Install it with: pip install ${py[1]}`
  return null
}
