import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const monorepoRoot = fileURLToPath(new URL('../..', import.meta.url));
const appRoot = fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_VISION_API = 'http://127.0.0.1:8000';
const aliases = {
  '@ikguide/schema': `${monorepoRoot}packages/ikguide-schema/src/index.ts`,
  '@ikguide/gost-translator': `${monorepoRoot}packages/gost-translator/src/index.ts`,
  '@ikguide/builder': `${monorepoRoot}packages/ikguide-builder/src/index.ts`,
};

/**
 * The browser only ever calls relative `/v1/...` and `/health`. The host of the Python vision
 * service is a dev/preview concern and lives in the proxy, configured through VITE_VISION_API_URL.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, appRoot, '');
  const visionTarget = env.VITE_VISION_API_URL?.trim() || DEFAULT_VISION_API;
  const proxy = {
    '/v1': { target: visionTarget, changeOrigin: true },
    '/health': { target: visionTarget, changeOrigin: true },
  };

  return {
    plugins: [react()],
    // Relative base keeps the bundle usable from file:// inside Tauri and Capacitor.
    base: './',
    resolve: { alias: aliases },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
      proxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      proxy,
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
