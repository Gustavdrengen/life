import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
      $engine: path.resolve(__dirname, 'src/engine'),
      $ui: path.resolve(__dirname, 'src/ui'),
      $specs: path.resolve(__dirname, 'specs')
    }
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    coverage: {
      reporter: ['text', 'html']
    }
  }
});
