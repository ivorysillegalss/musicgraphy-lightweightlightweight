import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// 仅做 TS 编译打包（ADR-003/004）：岛屿入口 → /static/[name].js
export default defineConfig({
  base: '/static/',
  build: {
    outDir: resolve(import.meta.dirname, 'dist/static'),
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'src/client/main.ts') },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
