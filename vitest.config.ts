import { defineConfig } from 'vitest/config';

// Vitest 4.1 in node environment per CONTEXT.md D-11 / RESEARCH.md template.
// Encoder is pure — no fake timers needed in Phase 1.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['test/fixtures/**', 'dist/**'],
    },
  },
});
