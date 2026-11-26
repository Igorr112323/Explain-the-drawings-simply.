import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative base keeps the bundle usable from file:// inside Tauri and Capacitor.
  base: './',
  resolve: {
    alias: {
      '@ikguide/schema': `${monorepoRoot}packages/ikguide-schema/src/index.ts`,
      '@ikguide/gost-translator': `${monorepoRoot}packages/gost-translator/src/index.ts`,
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
