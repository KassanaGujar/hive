// Ad-hoc sign the macOS app after packaging. Without any signature, Apple Silicon Macs report a
// downloaded app as "damaged"; an ad-hoc signature (no Apple account needed) lets users open it via
// System Settings → Privacy & Security → "Open Anyway". Replace with a real Developer ID later.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${app}`)
}
