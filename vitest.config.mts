import { defineConfig } from 'vitest/config'

// Each test file runs in its own module graph with its own temporary DATA_DIR
// (set in tests/env.ts before the worker's modules are imported).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20_000,
  },
})
