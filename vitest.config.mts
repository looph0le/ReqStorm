import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 90000,
    hookTimeout: 90000,
    // The soak/load tools can be slow against a local server; keep pool small.
    fileParallelism: false,
  },
});
