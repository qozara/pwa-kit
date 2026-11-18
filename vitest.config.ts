import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@qozara/pwa-update': path.resolve(__dirname, 'packages/pwa-update/src/index.ts'),
      '@qozara/pwa-vite': path.resolve(__dirname, 'packages/pwa-vite/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
  },
});
