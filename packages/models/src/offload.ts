/** One entry of Ollama's GET /api/ps: a loaded model, its total size and the part of it in GPU memory (bytes). */
export interface LoadedModel {
  name: string
  size: number
  size_vram: number
}

export interface SlowLocalModel {
  model: string
  cpuPercent: number
}

/** Below this share on the GPU, generation slows to a crawl (40% on GPU measured under 1 token a second). */
const MIN_GPU_SHARE = 0.6

/** The loaded model with the most of itself on the CPU, if that is enough to make it very slow. */
export function slowLocalModel(loaded: LoadedModel[]): SlowLocalModel | null {
  let worst: SlowLocalModel | null = null
  for (const m of loaded) {
    if (!(m.size > 0)) continue
    const gpu = Math.min(1, Math.max(0, m.size_vram / m.size))
    if (gpu >= MIN_GPU_SHARE) continue
    const cpuPercent = Math.round((1 - gpu) * 100)
    if (!worst || cpuPercent > worst.cpuPercent) worst = { model: m.name, cpuPercent }
  }
  return worst
}

export function offloadMessage(s: SlowLocalModel): string {
  return `${s.model} is running ${s.cpuPercent}% on the processor because the graphics card is short of memory, so the AI team will be very slow. Close games and other apps using the graphics card, then stop and restart the run.`
}
