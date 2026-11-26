// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../../App';
import { bracketDocument } from '../../data/demos';
import { listGuides, resetOfflineStoreForTests } from '../../lib/offlineStore';
import { SETTINGS_STORAGE_KEY } from '../../lib/runtimeConfig';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const LAN = 'http://192.168.1.50:8000';
const CODE = 'pub12345';
const documentPayload = JSON.parse(JSON.stringify(bracketDocument)) as unknown;

let container: HTMLDivElement;
let root: Root | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** The workshop server as the studio sees it: address book, publication list, publish, download. */
function stubWorkshopServer(overrides: { publishStatus?: number } = {}) {
  const mock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/v1/network-info')) {
      return jsonResponse({
        status: 'ok',
        hostname: 'shop-pc',
        primary: '192.168.1.50',
        primaryIsLan: true,
        addresses: [{ ip: '192.168.1.50', kind: 'lan', primary: true }],
        guidePort: 8000,
        suggestedApiBase: LAN,
        studioAvailable: true,
      });
    }
    if (url.includes('/v1/guides/')) {
      return jsonResponse(documentPayload);
    }
    if (url.includes('/v1/guides') && init?.method === 'POST') {
      if (overrides.publishStatus && overrides.publishStatus >= 400) {
        return jsonResponse({ detail: 'Сервер занят' }, overrides.publishStatus);
      }
      return jsonResponse(
        {
          id: CODE,
          guideId: CODE,
          title: bracketDocument.metadata.title,
          drawingCode: bracketDocument.metadata.drawingCode,
          revision: bracketDocument.metadata.revision,
          createdAt: '2026-11-26T09:00:00Z',
          sizeBytes: 4096,
          has3d: true,
          steps: bracketDocument.steps.length,
          url: `/v1/guides/${CODE}`,
          absoluteUrl: `${LAN}/v1/guides/${CODE}`,
          deduplicated: false,
        },
        201,
      );
    }
    if (url.includes('/v1/guides')) {
      return jsonResponse({ count: 1, guides: [{ id: CODE, title: bracketDocument.metadata.title, sizeBytes: 4096 }] });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function renderApp() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
  });
  await flush();
  return container;
}

async function flush(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function click(element: Element | null) {
  if (!element) {
    throw new Error('Элемент не найден');
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

function byText(text: string): Element | null {
  return (
    Array.from(container.querySelectorAll('button, label')).find((element) => element.textContent?.includes(text)) ?? null
  );
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  resetOfflineStoreForTests();
  window.history.replaceState({}, '', '/');
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

describe('stage 5 UI — мгновенный цеховой QR-мост', () => {
  it('opens a published-guide link: downloads it, remembers the address and keeps it offline', async () => {
    stubWorkshopServer();
    window.history.replaceState({}, '', `/?guideId=${CODE}&api=${encodeURIComponent(LAN)}`);

    await renderApp();

    const saved = await listGuides();
    expect(saved.map((entry) => entry.id)).toContain(bracketDocument.id);
    expect(saved.find((entry) => entry.id === bracketDocument.id)?.source).toBe('published');
    // The phone now knows which laptop serves its workshop.
    const settings = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(settings.visionBaseUrl).toBe(LAN);
    expect(container.textContent).toContain(bracketDocument.metadata.title);
  });

  it('falls back to the copy already on the device when the workshop server is down', async () => {
    window.history.replaceState({}, '', `/?guideId=${CODE}&api=${encodeURIComponent(LAN)}`);
    const offline = await import('../../lib/offlineStore');
    await offline.persistGuide(bracketDocument, {
      source: 'published',
      savedAt: '2026-11-26T08:00:00.000Z',
      publishedCode: CODE,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await renderApp();

    expect(container.textContent).toContain(bracketDocument.metadata.title);
    expect(container.textContent).toMatch(/сохранённая копия|скачана с цехового сервера/);
  });

  it('publishes from the QR dialog and shows the short link the phone will open', async () => {
    const fetchMock = stubWorkshopServer();
    await renderApp();
    await click(byText('QR-код'));

    // The publish tab is the default one and publishing starts as soon as it opens.
    expect(container.textContent).toContain('Опубликовать в цех');
    await flush(6);

    const publishCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/v1/guides') && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(publishCall).toBeTruthy();
    expect(container.textContent).toContain('Код инструкции');
    expect(container.textContent).toContain(CODE);
    expect(container.textContent).toContain(`?guideId=${CODE}&api=`);
    expect(container.textContent).toContain('3D-узел в комплекте');
  });

  it('keeps the autonomous QR as the honest fallback when the server refuses', async () => {
    stubWorkshopServer({ publishStatus: 500 });
    await renderApp();
    await click(byText('QR-код'));
    await flush(6);

    expect(container.textContent).toContain('Цеховой сервер не принял инструкцию');
    expect(container.textContent).toContain('Сервер занят');

    await click(byText('Автономный QR без сервера'));
    expect(container.textContent).toContain('Инструкция в QR');
    expect(container.textContent).toMatch(/Не помещается в один QR|Упакованы все шаги/);
  });

  it('resolves a scanned published link through the workshop server', async () => {
    stubWorkshopServer();
    await renderApp();
    await click(byText('Сканер QR'));

    const textarea = container.querySelector<HTMLTextAreaElement>('.scanner-side textarea');
    expect(textarea).toBeTruthy();
    await act(async () => {
      setNativeValue(textarea!, `${LAN}/?guideId=${CODE}&api=${encodeURIComponent(LAN)}`);
    });
    await click(byText('Открыть инструкцию'));
    await flush(6);

    const saved = await listGuides();
    expect(saved.find((entry) => entry.id === bracketDocument.id)?.source).toBe('published');
    expect(container.textContent).toContain(bracketDocument.metadata.title);
  });

  it('says plainly when a code is unknown everywhere', async () => {
    stubWorkshopServer();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/v1/network-info') || url.includes('/v1/guides?')) {
          return jsonResponse({ count: 0, guides: [], status: 'ok', addresses: [] });
        }
        return jsonResponse({ detail: 'not found' }, 404);
      }),
    );
    await renderApp();
    await click(byText('Сканер QR'));

    const textarea = container.querySelector<HTMLTextAreaElement>('.scanner-side textarea');
    await act(async () => {
      setNativeValue(textarea!, `/?guideId=zzzz9999&api=${encodeURIComponent(LAN)}`);
    });
    await click(byText('Открыть инструкцию'));
    await flush(6);

    expect(container.textContent).toContain('zzzz9999');
    expect(container.textContent).toMatch(/нет ни на устройстве, ни на цеховом сервере/);
  });
});
