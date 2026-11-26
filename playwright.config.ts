import { defineConfig, devices } from '@playwright/test';

/**
 * E2E в живом браузере: `npm run e2e`.
 *
 * Проверяем то, что jsdom подтвердить не может, — реальную вёрстку, масштаб листов, скачивание
 * файла браузером и отсутствие ошибок в консоли. Бэкенд не нужен: сценарии идут по встроенным
 * примерам чертежей, поэтому спек запускается и на машине без Python-движка.
 *
 * Браузеры ставятся один раз: `npx playwright install chromium`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -w @ikguide/studio-web -- --host 127.0.0.1 --port 5273 --strictPort',
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
