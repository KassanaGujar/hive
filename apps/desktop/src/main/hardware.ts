import os from 'node:os'
import { statfs } from 'node:fs/promises'
import si from 'systeminformation'
import type { Hardware } from '@hive/shared'

let cachedGpu: { name: string | null; vramGB: number } | null = null

async function gpu() {
  if (cachedGpu) return cachedGpu
  // Apple Silicon: the GPU shares system RAM (unified memory); Metal can use ~70% of it for models.
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const chip = os.cpus()[0]?.model?.trim() || 'Apple Silicon'
    cachedGpu = { name: `${chip} (unified memory)`, vramGB: Math.floor((os.totalmem() / 1024 ** 3) * 0.7) }
    return cachedGpu
  }
  try {
    const g = await si.graphics()
    // Pick the controller with the most VRAM (skips integrated GPUs on laptops with dGPUs).
    const best = [...g.controllers].sort((a, b) => (b.vram ?? 0) - (a.vram ?? 0))[0]
    const vramMB = best?.vram ?? 0
    // Integrated GPUs report shared memory; don't count them as VRAM for model fit.
    const integrated = /intel.*(uhd|iris|hd graphics)|radeon\(tm\) graphics|microsoft basic/i.test(best?.model ?? '')
    cachedGpu = { name: best?.model ?? null, vramGB: integrated ? 0 : Math.round((vramMB / 1024) * 10) / 10 }
  } catch {
    cachedGpu = { name: null, vramGB: 0 }
  }
  return cachedGpu
}

export async function scanHardware(): Promise<Hardware> {
  const g = await gpu()
  let freeDiskGB = 0
  try {
    const s = await statfs(os.homedir())
    freeDiskGB = Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10
  } catch {
    /* unknown */
  }
  return {
    totalRamGB: Math.round(os.totalmem() / 1024 ** 3),
    freeRamGB: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    gpuName: g.name,
    vramGB: g.vramGB,
    freeDiskGB,
    cpuCores: os.cpus().length,
    platform: process.platform
  }
}

/** Memory available for running local models at once (used by the agents' resource guard). */
export function memoryBudgetGB(): number {
  const free = os.freemem() / 1024 ** 3
  const vram = cachedGpu?.vramGB ?? 0
  return Math.max(vram, free * 0.8, 2)
}
