import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const frontend = dirname(fileURLToPath(import.meta.url));

// Nest가 같은 origin에서 frontend/dist를 내려준다. dev 서버와 proxy는 두지 않는다.
export default defineConfig({
  root: frontend,
  plugins: [tailwindcss()],
  resolve: { alias: { '@': join(frontend, 'web') } },
  build: {
    outDir: join(frontend, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
});
