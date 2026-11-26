// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkEngines, displayEngineUrl, engineLabel, pingHealth } from './engine';
import { VISION_URL_KEY } from './runtimeConfig';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ok = { ok: true, status: 200 } as Response;

describe('здоровье локального движка', () => {
  it('пингует /health и считает живым только 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal('fetch', fetchMock);

    await expect(pingHealth('http://127.0.0.1:8000')).resolves.toBe('ok');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8000/health');

    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(pingHealth('http://127.0.0.1:8000')).resolves.toBe('down');
  });

  it('сетевой отказ — это «не отвечает», а не исключение', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(pingHealth('http://127.0.0.1:8000')).resolves.toBe('down');
  });

  it('проверяет движок распознавания и подписывает адрес для меню', async () => {
    window.localStorage.setItem(VISION_URL_KEY, 'http://192.168.1.50:8000');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok));

    const report = await checkEngines();
    expect(report.vision).toBe('ok');
    expect(report.visionUrl).toBe('http://192.168.1.50:8000');
    const urls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((call) => call[0]);
    expect(urls).toEqual(['http://192.168.1.50:8000/health']);
  });

  it('без сохранённого адреса в браузере идёт через прокси', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok));
    const report = await checkEngines();
    expect(report.visionUrl).toBe('');
    expect(displayEngineUrl(report.visionUrl)).toBe('через локальный прокси');
  });

  it('переводит состояние в человеческие слова', () => {
    expect(engineLabel('ok')).toBe('на связи');
    expect(engineLabel('down')).toBe('не отвечает');
    expect(engineLabel('unknown')).toBe('не проверяли');
  });

  it('не зависает: таймаут обрывает запрос и даёт «не отвечает»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
    await expect(pingHealth('http://127.0.0.1:8000', 10)).resolves.toBe('down');
  });
});
