import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const pkg = (name: string) => resolve(import.meta.dirname, `packages/${name}/src/index.ts`)

export default defineConfig({
  resolve: {
    alias: {
      '@hive/shared': pkg('shared'),
      '@hive/models': pkg('models'),
      '@hive/agents': pkg('agents'),
      '@hive/collab': pkg('collab'),
      '@hive/editor': pkg('editor')
    }
  },
  test: { include: ['packages/*/src/**/*.test.ts', 'services/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'] }
})
