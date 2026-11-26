import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.{ts,tsx}', 'apps/**/src/**/*.test.{ts,tsx}'],
    reporters: ['default'],
    // Приблизительная SVG-геометрия для jsdom: без неё `svg2pdf` не может разложить подписи схем.
    setupFiles: ['apps/studio-web/src/test/jsdomSvg.ts'],
  },
});
