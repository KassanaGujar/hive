// Adds a broad set of free Ollama models to catalog/catalog.json (idempotent).
// Sizes are approximate 4-bit download sizes; RAM/VRAM needs are derived from them.
// Before a release, re-check sizes against https://ollama.com/library (PRD release checklist).
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../catalog/catalog.json', import.meta.url)
const catalog = JSON.parse(readFileSync(file, 'utf8'))

// [family, pullName, display name, sizeGB, contextTokens, codingScore, description?]
const M = [
  ['Qwen Coder', 'qwen2.5-coder:0.5b', 'Qwen2.5 Coder 0.5B', 0.4, 32768, 22, 'Smallest coder; runs on anything.'],
  ['Qwen Coder', 'qwen2.5-coder:3b', 'Qwen2.5 Coder 3B', 1.9, 32768, 45, 'Good coder for 8 GB laptops.'],
  ['Qwen 3', 'qwen3:0.6b', 'Qwen3 0.6B', 0.5, 40960, 20],
  ['Qwen 3', 'qwen3:1.7b', 'Qwen3 1.7B', 1.4, 40960, 32],
  ['Qwen 3', 'qwen3:4b', 'Qwen3 4B', 2.6, 262144, 46],
  ['Qwen 3', 'qwen3:8b', 'Qwen3 8B', 5.2, 40960, 56],
  ['Qwen 3', 'qwen3:14b', 'Qwen3 14B', 9.3, 40960, 64],
  ['Qwen 3', 'qwen3:30b', 'Qwen3 30B (A3B)', 19, 262144, 70],
  ['Qwen 3', 'qwen3:32b', 'Qwen3 32B', 20, 40960, 72],
  ['Qwen 2.5', 'qwen2.5:3b', 'Qwen2.5 3B', 1.9, 32768, 40],
  ['Qwen 2.5', 'qwen2.5:7b', 'Qwen2.5 7B', 4.7, 32768, 52],
  ['Qwen 2.5', 'qwen2.5:14b', 'Qwen2.5 14B', 9.0, 32768, 60],
  ['Qwen 2.5', 'qwen2.5:32b', 'Qwen2.5 32B', 20, 32768, 68],
  ['Qwen 2.5', 'qwen2.5:72b', 'Qwen2.5 72B', 47, 32768, 74],
  ['QwQ', 'qwq:32b', 'QwQ 32B (reasoning)', 20, 131072, 70, 'Thinks step by step; slow but careful.'],
  ['DeepSeek', 'deepseek-r1:1.5b', 'DeepSeek R1 1.5B (distill)', 1.1, 131072, 28],
  ['DeepSeek', 'deepseek-r1:8b', 'DeepSeek R1 8B (distill)', 5.2, 131072, 48],
  ['DeepSeek', 'deepseek-r1:70b', 'DeepSeek R1 70B (distill)', 43, 131072, 72],
  ['DeepSeek', 'deepseek-coder:1.3b', 'DeepSeek Coder 1.3B', 0.8, 16384, 30],
  ['DeepSeek', 'deepseek-coder:6.7b', 'DeepSeek Coder 6.7B', 3.8, 16384, 50],
  ['DeepSeek', 'deepseek-coder:33b', 'DeepSeek Coder 33B', 19, 16384, 64],
  ['Code Llama', 'codellama:7b', 'Code Llama 7B', 3.8, 16384, 44],
  ['Code Llama', 'codellama:13b', 'Code Llama 13B', 7.4, 16384, 50],
  ['Code Llama', 'codellama:34b', 'Code Llama 34B', 19, 16384, 58],
  ['CodeGemma', 'codegemma:2b', 'CodeGemma 2B', 1.6, 8192, 34],
  ['CodeGemma', 'codegemma:7b', 'CodeGemma 7B', 5.0, 8192, 48],
  ['StarCoder2', 'starcoder2:3b', 'StarCoder2 3B', 1.7, 16384, 36],
  ['StarCoder2', 'starcoder2:7b', 'StarCoder2 7B', 4.0, 16384, 44],
  ['StarCoder2', 'starcoder2:15b', 'StarCoder2 15B', 9.1, 16384, 52],
  ['Granite Code', 'granite-code:3b', 'Granite Code 3B', 2.0, 131072, 38],
  ['Granite Code', 'granite-code:8b', 'Granite Code 8B', 4.6, 131072, 48],
  ['Granite Code', 'granite-code:20b', 'Granite Code 20B', 12, 8192, 56],
  ['Granite Code', 'granite-code:34b', 'Granite Code 34B', 19, 8192, 60],
  ['Granite', 'granite3.3:2b', 'Granite 3.3 2B', 1.5, 131072, 34],
  ['Granite', 'granite3.3:8b', 'Granite 3.3 8B', 4.9, 131072, 50],
  ['Mistral', 'mistral:7b', 'Mistral 7B', 4.4, 32768, 42],
  ['Mistral', 'mistral-nemo:12b', 'Mistral Nemo 12B', 7.1, 131072, 52],
  ['Mistral', 'mistral-small:24b', 'Mistral Small 24B', 14, 32768, 62],
  ['Mistral', 'codestral:22b', 'Codestral 22B', 13, 32768, 68, 'Mistral’s code model.'],
  ['Mistral', 'magistral:24b', 'Magistral 24B (reasoning)', 14, 40960, 64],
  ['Mistral', 'mixtral:8x7b', 'Mixtral 8x7B', 26, 32768, 56],
  ['Llama 3.x', 'llama3.2:1b', 'Llama 3.2 1B', 1.3, 131072, 18],
  ['Llama 3.x', 'llama3.1:70b', 'Llama 3.1 70B', 43, 131072, 66],
  ['Llama 3.x', 'llama3.2-vision:11b', 'Llama 3.2 Vision 11B', 7.8, 131072, 40, 'Can look at images.'],
  ['Gemma 3', 'gemma3:1b', 'Gemma 3 1B', 0.8, 32768, 18],
  ['Gemma 3', 'gemma3n:e2b', 'Gemma 3n E2B', 5.6, 32768, 36],
  ['Gemma 3', 'gemma3n:e4b', 'Gemma 3n E4B', 7.5, 32768, 44],
  ['Gemma 2', 'gemma2:2b', 'Gemma 2 2B', 1.6, 8192, 28],
  ['Gemma 2', 'gemma2:9b', 'Gemma 2 9B', 5.4, 8192, 46],
  ['Gemma 2', 'gemma2:27b', 'Gemma 2 27B', 16, 8192, 56],
  ['Phi', 'phi3:3.8b', 'Phi-3 Mini 3.8B', 2.2, 131072, 38],
  ['Phi', 'phi3:14b', 'Phi-3 Medium 14B', 7.9, 131072, 48],
  ['Phi', 'phi4-mini:3.8b', 'Phi-4 Mini 3.8B', 2.5, 131072, 44],
  ['Phi', 'phi4-reasoning:14b', 'Phi-4 Reasoning 14B', 11, 32768, 56],
  ['Small & fast', 'smollm2:360m', 'SmolLM2 360M', 0.7, 8192, 10, 'Tiny; for quick tests only.'],
  ['Small & fast', 'smollm2:1.7b', 'SmolLM2 1.7B', 1.8, 8192, 22],
  ['Small & fast', 'tinyllama:1.1b', 'TinyLlama 1.1B', 0.6, 2048, 10],
  ['Yi Coder', 'yi-coder:1.5b', 'Yi Coder 1.5B', 0.9, 131072, 32],
  ['Yi Coder', 'yi-coder:9b', 'Yi Coder 9B', 5.0, 131072, 54],
  ['OpenCoder', 'opencoder:1.5b', 'OpenCoder 1.5B', 1.4, 4096, 30],
  ['OpenCoder', 'opencoder:8b', 'OpenCoder 8B', 4.7, 8192, 50],
  ['Cogito', 'cogito:8b', 'Cogito 8B', 4.9, 131072, 52],
  ['Cogito', 'cogito:14b', 'Cogito 14B', 9.0, 131072, 60],
  ['Cogito', 'cogito:32b', 'Cogito 32B', 20, 131072, 68],
  ['Community', 'dolphin3:8b', 'Dolphin 3 8B', 4.9, 131072, 44],
  ['Community', 'hermes3:8b', 'Hermes 3 8B', 4.7, 131072, 46],
  ['Community', 'wizardlm2:7b', 'WizardLM2 7B', 4.1, 32768, 42],
  ['Community', 'command-r:35b', 'Command R 35B', 19, 131072, 54],
  ['Community', 'llava:7b', 'LLaVA 7B (vision)', 4.7, 32768, 30, 'Can look at images.'],
  ['Devstral', 'devstral-small-2:24b', 'Devstral Small 2 24B', 15, 262144, 76, 'Built for coding agents.']
]

const snap = (n, steps) => steps.find((s) => s >= n) ?? steps[steps.length - 1]
const have = new Set(catalog.models.map((m) => m.pullName).filter(Boolean))
let added = 0
for (const [family, pullName, name, sizeGB, contextTokens, codingScore, description] of M) {
  if (have.has(pullName)) continue
  catalog.models.push({
    id: pullName.replace(/[^a-z0-9.]+/gi, '-'),
    name,
    family,
    source: 'ollama',
    pullName,
    sizeGB,
    minRamGB: snap(sizeGB * 1.2 + 2, [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]),
    minVramGB: sizeGB < 1.2 ? 0 : Math.ceil(sizeGB + 1.5),
    contextTokens,
    tier: codingScore >= 72 ? 'top' : codingScore >= 58 ? 'lead' : 'worker',
    codingScore,
    free: true,
    ...(description ? { description } : {})
  })
  added++
}
catalog.version = Math.max(catalog.version, 2)
catalog.updated = new Date().toISOString().slice(0, 10)
writeFileSync(file, JSON.stringify(catalog, null, 1).replace(/\n  {2,}/g, ' ').replace(/\n \}/g, ' }') + '\n')
console.log(`added ${added}; catalog now has ${catalog.models.length} models (v${catalog.version})`)
