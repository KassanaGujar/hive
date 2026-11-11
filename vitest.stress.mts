import { defineConfig } from 'vitest/config'
import base from './vitest.config.mts'

// Stress tests: `npm run stress` (local relay) or `RELAY_URL=wss://… npm run stress` (deployed relay).
export default defineConfig({
  resolve: base.resolve,
  test: { include: ['services/*/src/**/*.stress.ts', 'packages/*/src/**/*.stress.ts'], testTimeout: 300_000, hookTimeout: 60_000 }
})
