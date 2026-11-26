// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { StudioProvider, useStudio } from '../../state/studio';
import { ScanDialog } from './ScanDialog';
import type { VisionRecognizeResponse } from '../../lib/vision';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

function recognitionPayload(): VisionRecognizeResponse {
  return {
    requestId: 'req-ui',
    pages: [
      {
        pageIndex: 0,
        pageId: 'pg-ui',
        source: 'pdf_vector',
        width: 1600,
        height: 1131,
        dpi: 140,
        perspectiveCorrected: false,
        warnings: [],
        imageDataUrl: 'data:image/png;base64,AAAA',
      },
    ],
    titleBlock: {
      name: 'Кронштейн',
      code: 'ТЕСТ-01.200.000 СБ',
      material: '09Г2С',
      scale: '1:2',
      sheet: '1',
      confidence: 0.95,
      rawLines: [],
    },
    candidates: [
      {
        id: 'p0-c1',
        pageIndex: 0,
        rawText: 'Ø20 H7',
        normalizedText: 'Ø20 H7',
        xPercent: 41,
        yPercent: 37,
        bboxPercent: { x: 39, y: 36, w: 6, h: 3 },
        confidence: 0.99,
        ambiguousOptions: [],
        region: 'field',
        source: 'pdf',
      },
      {
        id: 'p0-c2',
        pageIndex: 0,
        rawText: 'M8-7H',
        normalizedText: 'М8-7H',
        xPercent: 47,
        yPercent: 46,
        bboxPercent: { x: 45, y: 45, w: 5, h: 3 },
        confidence: 0.92,
        ambiguousOptions: ['М8-7H', 'М6-7H'],
        region: 'field',
        source: 'ocr',
      },
      {
        id: 'p0-c3',
        pageIndex: 0,
        rawText: 'Ra 1,6',
        normalizedText: 'Ra 1,6',
        xPercent: 52,
        yPercent: 56,
        bboxPercent: { x: 50, y: 55, w: 5, h: 2 },
        confidence: 0.99,
        ambiguousOptions: [],
        region: 'field',
        source: 'pdf',
      },
    ],
    warnings: [],
  };
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

const realFetch = globalThis.fetch;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  globalThis.fetch = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

function byText(text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

describe('ScanDialog', () => {
  it('builds a draft instruction from a recognised sheet and exposes it to the studio', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/health')) {
        return response(HEALTH);
      }
      return response(recognitionPayload());
    });

    const sheet = new File([new Uint8Array([1, 2, 3])], 'sheet.pdf', { type: 'application/pdf' });

    function Harness() {
      const { state } = useStudio();
      return (
        <>
          <div data-testid="codes">{state.docs.map((doc) => doc.metadata.drawingCode).join('|')}</div>
          <ScanDialog mode="files" files={[sheet]} onClose={() => {}} />
        </>
      );
    }

    act(() => {
      root.render(
        <StudioProvider>
          <Harness />
        </StudioProvider>,
      );
    });
    await flush();
    await flush();

    expect(container.textContent).toContain('Черновик инструкции готов');
    expect(container.textContent).toContain('Распознано');
    expect(container.querySelectorAll('.scan-stats dd').length).toBeGreaterThanOrEqual(4);
    // The uncertain cipher is reported instead of being silently confirmed.
    expect(container.textContent).toContain('подсвечены в «Рентгене»');

    const codes = container.querySelector('[data-testid="codes"]')?.textContent ?? '';
    expect(codes).toContain('ТЕСТ-01.200.000 СБ');

    const open = byText('Открыть инструкцию');
    expect(open).toBeTruthy();

    // The draft lives in the reducer: a second run replaces it instead of piling up copies.
    const before = container.querySelector('[data-testid="codes"]')?.textContent ?? '';
    expect(before.split('|').filter((code) => code === 'ТЕСТ-01.200.000 СБ')).toHaveLength(1);
  });

  it('explains the offline mode instead of failing when the service is down', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    act(() => {
      root.render(<App />);
    });
    await flush();

    const capsule = byText('Чертёж → инструкция');
    expect(capsule).toBeTruthy();
    act(() => capsule?.click());
    await flush();

    expect(container.textContent).toContain('Сервис авто-распознавания офлайн');
    expect(container.textContent).toContain('npm run dev:vision');
    expect(container.textContent).toContain('Открыть лист вручную');

    // Demo projects are not affected: they are part of the initial state.
    act(() => byText('Закрыть')?.click());
    await flush();
    expect(container.querySelector('.modal-backdrop')).toBeNull();
    expect(container.textContent).toContain('КС-04.100.000 СБ');
  });

  it('shows the reason from the service when a sheet is rejected', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/health')) {
        return response(HEALTH);
      }
      return response({ detail: 'Слишком маленькое изображение: минимум 640×480 px' }, 422);
    });

    const sheet = new File([new Uint8Array([0])], 'thumb.png', { type: 'image/png' });

    act(() => {
      root.render(
        <StudioProvider>
          <ScanDialog mode="files" files={[sheet]} onClose={() => {}} />
        </StudioProvider>,
      );
    });
    await flush();
    await flush();

    expect(container.textContent).toContain('Не удалось распознать чертёж');
    expect(container.textContent).toContain('минимум 640×480 px');
  });
});
