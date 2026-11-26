// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
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

const CANDIDATES: VisionRecognizeResponse['candidates'] = [
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
    confidence: 0.6,
    ambiguousOptions: ['М8-7H', 'М8-6H'],
    region: 'field',
    source: 'ocr',
  },
];

const RECOGNITION: VisionRecognizeResponse = {
  requestId: 'req-xray',
  pages: [
    {
      pageIndex: 0,
      pageId: 'pg-xray',
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
    code: 'ТЕСТ-02.100.000 СБ',
    material: '09Г2С',
    scale: '1:2',
    sheet: '1',
    confidence: 0.95,
    rawLines: [],
  },
  candidates: CANDIDATES,
  warnings: [],
};

const ROI = {
  pageId: 'pg-xray',
  candidates: [
    {
      id: 'roi-1',
      pageIndex: 0,
      rawText: 'Ø32 H7',
      normalizedText: 'Ø32 H7',
      xPercent: 30,
      yPercent: 25,
      bboxPercent: { x: 25, y: 20, w: 10, h: 8 },
      confidence: 0.93,
      ambiguousOptions: [],
      region: 'field',
      source: 'image',
    },
  ],
  warnings: ['Область перечитана повторно: контраст низкий.'],
};

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
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.includes('/health')) {
      return response(HEALTH);
    }
    if (url.includes('/recognize/roi')) {
      return response(ROI);
    }
    return response(RECOGNITION);
  });
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

function button(text: string) {
  return Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(text),
  );
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Opens the scan dialog, recognises a sheet and lands on «Рентген». */
async function openXray() {
  act(() => {
    root.render(<App />);
  });
  await flush();

  const capsule = button('Чертёж → инструкция');
  expect(capsule).toBeTruthy();
  act(() => capsule?.click());
  await flush();

  // Feed the picker directly: the <input type="file"> cannot be filled in jsdom.
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]');
  expect(picker).toBeTruthy();
  const sheet = new File([new Uint8Array([1, 2, 3])], 'sheet.pdf', { type: 'application/pdf' });
  Object.defineProperty(picker!, 'files', { value: [sheet], configurable: true });
  act(() => {
    picker!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
  await flush();

  expect(container.textContent).toContain('Черновик инструкции готов');
  act(() => button('Проверить шифры')?.click());
  await flush();
  expect(container.querySelector('.screen-xray')).toBeTruthy();
}

describe('XrayScreen with a recognised sheet', () => {
  it('shows the service strip and the uncertain cipher', async () => {
    await openXray();
    expect(container.querySelector('.vision-strip')?.textContent).toContain('Лист распознан сервисом');
    expect(container.textContent).toContain('1 неподтверждённых обозначений');
  });

  it('adds a hand-typed cipher to the draft instruction', async () => {
    await openXray();
    const input = container.querySelector<HTMLInputElement>('.manual-row input');
    expect(input).toBeTruthy();

    act(() => type(input!, 'М10×1,25'));
    await flush();
    expect(container.querySelector('.manual-check')?.textContent).toContain('Резьба');

    act(() => button('Добавить «М10×1,25»')?.click());
    await flush();

    const list = container.querySelector('.annotation-list')?.textContent ?? '';
    expect(list).toContain('М10×1,25');
    expect(container.querySelector('.vision-strip')?.textContent).toContain('вручную: 1');
    expect(container.textContent).toContain('«М10×1,25» добавлено в черновик инструкции');
  });

  it('reads a hand-drawn region and merges it into the draft', async () => {
    await openXray();

    act(() => button('Выделить область')?.click());
    await flush();

    const layer = container.querySelector<HTMLElement>('.roi-layer');
    expect(layer).toBeTruthy();
    layer!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const pointer = (type_: string, x: number, y: number) => {
      const event = new MouseEvent(type_, { bubbles: true, clientX: x, clientY: y });
      act(() => {
        layer!.dispatchEvent(event);
      });
    };

    pointer('pointerdown', 200, 150);
    pointer('pointermove', 400, 300);
    pointer('pointerup', 400, 300);
    await flush();

    const result = container.querySelector('.roi-result');
    expect(result?.textContent).toContain('Ø32 H7');
    expect(result?.textContent).toContain('93 %');

    act(() => button('Добавить в черновик')?.click());
    await flush();

    expect(container.querySelector('.annotation-list')?.textContent).toContain('Ø32 H7');
    expect(container.textContent).toContain('В черновик добавлено обозначений: 1');
  });
});
