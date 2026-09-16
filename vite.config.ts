import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'apps/desktop/electron/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron']
            }
          },
        },
      },
      {
        entry: 'apps/desktop/electron/preload/index.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            lib: {
              entry: 'apps/desktop/electron/preload/index.ts',
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rollupOptions: {
              external: ['electron']
            }
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './apps/desktop/src'),
      '@cleaner/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@cleaner/safety-engine': path.resolve(__dirname, './packages/safety-engine/src/index.ts'),
      '@cleaner/cleanup-rules': path.resolve(__dirname, './packages/cleanup-rules/src/index.ts'),
    },
  },
  server: {
    port: 5173
  }
});
