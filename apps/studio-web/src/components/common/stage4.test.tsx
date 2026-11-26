// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../../App';
import { bracketDocument } from '../../data/demos';
import { encodeGuidePayload } from '../../lib/qrBridge';
import { listGuides, resetOfflineStoreForTests } from '../../lib/offlineStore';
import { SETTINGS_STORAGE_KEY, canSwitchToEngineer } from '../../lib/runtimeConfig';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root | null = null;

async function renderApp() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

async function click(element: Element | null) {
  if (!element) {
    throw new Error('Элемент не найден');
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function byText(text: string): Element | null {
  return (
    Array.from(container.querySelectorAll('button, label')).find((element) => element.textContent?.includes(text)) ?? null
  );
}

function byAria(label: string): Element | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  resetOfflineStoreForTests();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
});

describe('stage 4 UI', () => {
  it('opens «Настройки и подключение» from the gear in the top capsule', async () => {
    await renderApp();
    await click(byAria('Настройки и подключение'));
    const dialog = container.querySelector('[aria-label="Настройки и подключение"][role="dialog"], .modal');
    expect(dialog?.textContent).toContain('Строгий режим цеха');
    expect(container.textContent).toContain('Распознавание чертежей');
    expect(container.textContent).toContain('Проверить связь');
    expect(container.textContent).toContain('Браузер / dev-сервер');
    // jsdom has no IndexedDB: the store falls back to localStorage and says so.
    expect(container.textContent).toMatch(/Офлайн-хранилище(ID|localStorage|память)/);
  });

  it('remembers the typed addresses after «Сохранить»', async () => {
    await renderApp();
    await click(byAria('Настройки и подключение'));
    const visionInput = container.querySelector<HTMLInputElement>('input[placeholder^="http"], input[type="url"]');
    expect(visionInput).toBeTruthy();
    const inputs = container.querySelectorAll<HTMLInputElement>('.settings-section input[type="url"]');
    expect(inputs.length).toBe(2);
    await act(async () => {
      setNativeValue(inputs[0]!, 'http://192.168.1.50:8000');
      setNativeValue(inputs[1]!, 'http://192.168.1.50:8001/');
    });
    await click(byText('Сохранить'));
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored).toMatchObject({ visionBaseUrl: 'http://192.168.1.50:8000', cadBaseUrl: 'http://192.168.1.50:8001' });
  });

  it('opens the QR scanner and accepts a pasted payload', async () => {
    const payload = encodeGuidePayload(bracketDocument, { baseUrl: 'http://192.168.1.50:5173' });
    await renderApp();
    await click(byText('Сканер QR'));
    expect(container.textContent).toContain('Сканер QR-кода');
    expect(container.textContent).toContain('Выбрать фото QR-кода из галереи');

    const textarea = container.querySelector<HTMLTextAreaElement>('.scanner-side textarea');
    expect(textarea).toBeTruthy();
    await act(async () => {
      setNativeValue(textarea!, payload.payload);
    });
    await click(byText('Открыть инструкцию'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The instruction is now on the device and open on «Перед началом работы».
    const saved = await listGuides();
    expect(saved.map((entry) => entry.id)).toContain(bracketDocument.id);
    expect(container.textContent).toContain(bracketDocument.metadata.title);
  });

  it('opens the QR dialog and honestly refuses a code that cannot hold the guide', async () => {
    await renderApp();
    await click(byText('QR-код'));
    // Stage 5 adds the default «publish to the shop» tab; jsdom has no workshop server, and the dialog
    // says so instead of showing a link that would not work.
    expect(container.textContent).toContain('Опубликовать в цех');
    expect(container.textContent).toContain('Инструкция в QR');
    expect(container.textContent).toContain('QR по цеховой ссылке');
    expect(container.textContent).toContain('Скачать автономный офлайн-пакет');
    expect(container.textContent).toContain('Экспорт автономного HTML-файла');
    await click(byText('Инструкция в QR'));
    // The 6-step demo is ~4–5 KB: it cannot be a QR, and the dialog says so instead of pretending.
    expect(container.textContent).toMatch(/Не помещается в один QR|Упакованы все шаги/);
    await click(byText('QR по цеховой ссылке'));
    // Без адреса сервера ссылка деградирует до deep-link приложения — это и должно быть видно.
    expect(container.textContent).toMatch(/\?guide=|ikguide:\/\/guide\//);
  });

  it('saves «Строгий режим цеха», which hides the editor on a tablet (not in the browser)', async () => {
    await renderApp();
    expect(byText('Инженер')).toBeTruthy();
    await click(byAria('Настройки и подключение'));
    const toggle = container.querySelector<HTMLInputElement>('.switch-row input[type="checkbox"]');
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.click();
    });
    await click(byText('Сохранить'));
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(stored.strictWorkshop).toBe(true);
    // The browser preview is a developer shell: the editor stays reachable, the `.apk` locks it.
    expect(byText('Инженер')).toBeTruthy();
    expect(canSwitchToEngineer('capacitor-android', { visionBaseUrl: '', cadBaseUrl: '', strictWorkshop: true })).toBe(false);
  });
});

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
