import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisionError, fetchVisionHealth, recognizeSheets } from './vision';

const HEALTH = {
  status: 'ok',
  service: 'ikguide-vision-api',
  version: '1.0.0',
  opencv: '5.1.0',
  ocr: 'rapidocr',
  ocrAvailable: true,
  maxPages: 8,
  confidenceThreshold: 0.95,
};

const CANDIDATE = {
  id: 'p0-c1',
  pageIndex: 0,
  rawText: 'Ø20 H7',
  normalizedText: 'Ø20 H7',
  xPercent: 40,
  yPercent: 30,
  bboxPercent: { x: 39, y: 29, w: 6, h: 3 },
  confidence: 0.98,
  ambiguousOptions: [],
  region: 'field',
  source: 'ocr',
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

const sheet = (name = 'list.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('клиент распознавания', () => {
  it('отправляет листы формой на /v1/recognize и возвращает кандидатов', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        requestId: 'req-1',
        pages: [],
        titleBlock: null,
        candidates: [CANDIDATE],
        warnings: ['Лист 1: рамка не найдена'],
      }),
    );

    const response = await recognizeSheets([sheet()]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/recognize');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(response.candidates[0]?.rawText).toBe('Ø20 H7');
    expect(response.warnings).toHaveLength(1);
  });

  it('пустой список файлов — ошибка без запроса к сервису', async () => {
    await expect(recognizeSheets([])).rejects.toBeInstanceOf(VisionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('недоступный сервис превращается в понятное «запустите npm run dev:all»', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(recognizeSheets([sheet()])).rejects.toMatchObject({
      kind: 'offline',
      message: expect.stringContaining('npm run dev:all'),
    });
  });

  it('слишком большой файл помечается как rejected и объясняется по-русски', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Файл больше 20 МБ.' }, 413));
    await expect(recognizeSheets([sheet()])).rejects.toMatchObject({
      kind: 'rejected',
      message: 'Файл больше 20 МБ.',
    });
  });

  it('непонятный ответ сервиса не роняет студию', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: [{ msg: 'files: слишком много' }] }, 422));
    await expect(recognizeSheets([sheet()])).rejects.toMatchObject({
      kind: 'rejected',
      message: 'files: слишком много',
    });

    fetchMock.mockResolvedValue(jsonResponse({ nope: true }));
    await expect(recognizeSheets([sheet()])).rejects.toMatchObject({ kind: 'server' });
  });

  it('health возвращает null вместо исключения, если сервис лежит', async () => {
    fetchMock.mockResolvedValue(jsonResponse(HEALTH));
    await expect(fetchVisionHealth()).resolves.toMatchObject({ ocrAvailable: true });

    fetchMock.mockRejectedValue(new Error('down'));
    await expect(fetchVisionHealth()).resolves.toBeNull();
  });
});
