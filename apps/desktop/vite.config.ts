import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.join(desktopRoot, 'renderer/react');
const rendererOutput = path.join(desktopRoot, 'dist/renderer');

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [
    react(),
    {
      name: 'copy-upstream-license',
      closeBundle() {
        fs.copyFileSync(
          path.join(rendererRoot, 'LICENSE-AGPL-3.0-or-later.txt'),
          path.join(rendererOutput, 'LICENSE-AGPL-3.0-or-later.txt'),
        );
        fs.copyFileSync(
          path.join(rendererRoot, 'UPSTREAM.md'),
          path.join(rendererOutput, 'UPSTREAM.md'),
        );
      },
    },
  ],
  build: {
    outDir: rendererOutput,
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
