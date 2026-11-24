import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: import.meta.dirname,
  publicDir: false,
  build: {
    outDir: import.meta.dirname,
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'obsidian',
        'electron',
        'fs',
        'path',
        'child_process',
        'crypto',
        'os',
        'util',
        'events',
        'stream',
      ],
      output: {
        exports: 'default',
      },
    },
    minify: false,
  },
});
