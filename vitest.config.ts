import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the web workspace's alias so its pure modules are testable here
    // without pulling in a second test runner.
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
  },
});
