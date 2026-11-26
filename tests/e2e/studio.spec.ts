import { expect, test, type Page } from '@playwright/test';

/**
 * Приёмочные сценарии IKGuide Studio в настоящем Chromium.
 *
 * Всё идёт на встроенных примерах: движок распознавания не нужен, файлы никуда не уходят.
 * Отдельный тест следит, что за весь сценарий в консоли не появилось ошибок и что после
 * скачивания PDF объектная ссылка освобождается (`revokeObjectURL`), иначе вкладка течёт.
 */

const CONSOLE_ERRORS: string[] = [];

test.beforeEach(async ({ page }) => {
  CONSOLE_ERRORS.length = 0;
  page.on('console', (message) => {
    if (message.type() === 'error') {
      CONSOLE_ERRORS.push(message.text());
    }
  });
  page.on('pageerror', (error) => CONSOLE_ERRORS.push(`pageerror: ${error.message}`));
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (window as unknown as { __revoked: string[] }).__revoked = [];
    URL.revokeObjectURL = (url: string) => {
      (window as unknown as { __revoked: string[] }).__revoked.push(url);
      original(url);
    };
  });
  await page.goto('/');
});

async function openDemo(page: Page, title = 'Кронштейн КС-04') {
  await page.getByLabel('Примеры чертежей').click();
  await page.getByText(title, { exact: false }).first().click();
  await expect(page.locator('.page-caption').first()).toBeVisible();
}

async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator('.zoom-pill').innerText()).trim();
}

test('пример открывается, подписи листов идут «Стр. 1 из N» без пропусков', async ({ page }) => {
  await openDemo(page);
  const captions = await page.locator('.page-caption').allInnerTexts();
  expect(captions.length).toBeGreaterThan(2);
  expect(captions.map((text) => text.trim())).toEqual(
    captions.map((_, index) => `Стр. ${index + 1} из ${captions.length}`),
  );
});

test('масштаб держится в границах 40…250 % и возвращается к 100 %', async ({ page }) => {
  await openDemo(page);
  expect(await zoomLabel(page)).toContain('72%');

  for (let step = 0; step < 6; step += 1) {
    await page.getByLabel('Уменьшить масштаб').click();
  }
  expect(await zoomLabel(page)).toContain('40%');

  for (let step = 0; step < 12; step += 1) {
    await page.getByLabel('Увеличить масштаб').click();
  }
  expect(await zoomLabel(page)).toContain('250%');

  await page.locator('.zoom-value').click();
  expect(await zoomLabel(page)).toContain('100%');

  // Верхний предел не должен ломать прокрутку холста.
  const sheets = page.locator('.sheets');
  await expect(sheets).toHaveAttribute('data-zoomable', /true|false/);
});

test('«Рентген» ставит пины на лист и объясняет обозначение по ГОСТ', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Рентген ГОСТ и допуски').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const pins = dialog.locator('.sheet-pin');
  expect(await pins.count()).toBeGreaterThan(0);
  await pins.first().click();
  await expect(page.locator('.notation-active')).toHaveCount(1);
});

test('правка шага на листе отменяется кнопкой «Отменить»', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Править текст и название').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const step = dialog.locator('.step-text').first();
  const original = (await step.innerText()).trim();
  expect(original.length).toBeGreaterThan(20);

  await step.click();
  const editor = page.locator('[aria-label$=": изменить"]').first();
  await editor.fill('Сверлите отверстия строго по маркеру мастера.');
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('.page').first()).toContainText('маркеру');
  await page.getByLabel('Отменить последнее действие').click();
  await expect(page.locator('.page').first()).not.toContainText('маркеру');
});

test('пометка «Осторожно!» ставится и уходит на лист', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Добавить пометку «Осторожно!»').click();
  await expect(page.getByLabel('Плашка «Осторожно!» у шага')).toBeVisible();
  const sheets = await page.locator('.page').allInnerTexts();
  expect(sheets.join(' ')).toContain('Осторожно');
});

test('тема переключается и переживает перезагрузку страницы', async ({ page }) => {
  await openDemo(page);
  const html = page.locator('html');
  await page.getByLabel(/^Ещё:/).click();
  await page.getByRole('button', { name: 'Тёмная' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel(/^Ещё:/).click();
  await page.getByRole('button', { name: 'Светлая' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('PDF скачивается браузером, ссылка на blob освобождается', async ({ page }) => {
  await openDemo(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByLabel('Скачать PDF-инструкцию').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/_инструкция\.pdf$/);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked.length), {
    timeout: 15_000,
  }).toBeGreaterThan(0);
  await expect(page.getByText('PDF готов')).toBeVisible();
});

test.afterEach(async () => {
  expect(CONSOLE_ERRORS, `ошибки в консоли:\n${CONSOLE_ERRORS.join('\n')}`).toEqual([]);
});
