import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = resolve(__dirname, '../..')
const alias = {
  '@hive/agents/prompts': resolve(root, 'packages/agents/src/prompts.ts'),
  '@hive/shared': resolve(root, 'packages/shared/src/index.ts'),
  '@hive/models': resolve(root, 'packages/models/src/index.ts'),
  '@hive/agents': resolve(root, 'packages/agents/src/index.ts'),
  '@hive/collab': resolve(root, 'packages/collab/src/index.ts'),
  '@hive/editor': resolve(root, 'packages/editor/src/index.ts'),
  '@hive/relay': resolve(root, 'services/relay/src/relay.ts')
}

export default defineConfig({
  main: {
    resolve: { alias },
    // Only real `dependencies` (node-pty) stay external; everything else is bundled.
    build: { externalizeDeps: true, rollupOptions: { external: ['bufferutil', 'utf-8-validate'] } }
  },
  preload: {
    resolve: { alias },
    build: { externalizeDeps: true }
  },
  renderer: {
    resolve: {
      alias: {
        ...alias,
        '@': resolve(__dirname, 'src/renderer/src'),
        // y-monaco imports Monaco's pre-0.50 internal path; point it at the same module.
        'monaco-editor/esm/vs/editor/editor.api.js': resolve(root, 'node_modules/monaco-editor/esm/vs/editor/editor.api.js')
      }
    },
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' }
  }
})
