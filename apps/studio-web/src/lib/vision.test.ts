import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VisionError,
  fetchVisionHealth,
  newVisionSession,
  recognizeRegion,
  recognizeSheets,
  type VisionRecognizeResponse,
} from './vision';

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
  rawText: 'M8-7H',
  normalizedText: 'М8-7H',
  xPercent: 40,
  yPercent: 30,
  bboxPercent: { x: 39, y: 29, w: 6, h: 3 },
  confidence: 0.92,
  ambiguousOptions: ['М8-7H', 'М6-7H'],
  region: 'field' as const,
  source: 'ocr' as const,
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('vision client', () => {
  it('reports the service as offline instead of throwing', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchVisionHealth()).resolves.toBeNull();
  });

  it('reads the health payload', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(HEALTH));
    const health = await fetchVisionHealth();
    expect(health?.ocr).toBe('rapidocr');
    expect(health?.confidenceThreshold).toBe(0.95);
  });

  it('uploads sheets to the relative endpoint', async () => {
    const payload: VisionRecognizeResponse = {
      requestId: 'req-1',
      candidates: [CANDIDATE],
      titleBlock: null,
      pages: [],
      warnings: [],
    };
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(payload));

    const file = new File([new Uint8Array([1, 2, 3])], 'sheet.png', { type: 'image/png' });
    const result = await recognizeSheets([file]);

    expect(result.candidates).toHaveLength(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe('/v1/recognize');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).getAll('files')).toHaveLength(1);
  });

  it('surfaces a rejected sheet with the Russian reason from the service', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ detail: 'Файл не является изображением или повреждён' }, 422),
    );
    const file = new File([new Uint8Array([0])], 'notes.txt', { type: 'text/plain' });
    await expect(recognizeSheets([file])).rejects.toMatchObject({
      name: 'VisionError',
      kind: 'rejected',
      message: 'Файл не является изображением или повреждён',
    });
  });

  it('posts an ROI rectangle in percent', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      jsonResponse({ pageId: 'pg-1', candidates: [CANDIDATE], warnings: [] }),
    );

    const result = await recognizeRegion('pg-1', { x: 10, y: 20, w: 15, h: 8 });
    expect(result.candidates).toHaveLength(1);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe('/v1/recognize/roi');
    expect(JSON.parse(String(init?.body))).toEqual({ pageId: 'pg-1', x: 10, y: 20, w: 15, h: 8, rotation: 0 });
  });

  it('maps a 404 ROI answer to a human explanation', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ detail: 'Лист не найден' }, 404));
    await expect(recognizeRegion('pg-x', { x: 1, y: 1, w: 5, h: 5 })).rejects.toBeInstanceOf(VisionError);
  });

  it('builds a session from the recognition response', () => {
    const session = newVisionSession({
      requestId: 'req-9',
      candidates: [CANDIDATE],
      titleBlock: null,
      pages: [
        {
          pageIndex: 0,
          pageId: 'pg-9',
          source: 'image',
          width: 1200,
          height: 900,
          dpi: 150,
          perspectiveCorrected: true,
          warnings: [],
          imageDataUrl: 'data:image/png;base64,AAA',
        },
      ],
      warnings: ['Лист 1: перспектива выправлена автоматически.'],
    });

    expect(session.pageId).toBe('pg-9');
    expect(session.candidates).toHaveLength(1);
    expect(session.manualNotations).toEqual([]);
    expect(session.draftDocId).toBeNull();
    expect(session.warnings[0]).toContain('перспектива');
  });
});
