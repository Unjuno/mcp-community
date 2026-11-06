import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { conditions: ['development', 'node'] },
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
