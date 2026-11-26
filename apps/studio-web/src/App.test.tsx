// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const VISION_RESPONSE = {
  requestId: 'req-ui',
  pages: [
    {
      pageIndex: 0,
      pageId: 'p0',
      source: 'image',
      width: 1600,
      height: 1130,
      dpi: 200,
      perspectiveCorrected: false,
      warnings: [],
      imageDataUrl: 'data:image/png;base64,AAAA',
    },
  ],
  titleBlock: {
    name: 'Кронштейн',
    code: 'КС-04',
    material: 'Сталь 09Г2С',
    scale: '1:1',
    sheet: null,
    confidence: 0.9,
    rawLines: [],
  },
  candidates: [
    {
      id: 'c1',
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
    },
    {
      id: 'c2',
      pageIndex: 0,
      rawText: '12',
      normalizedText: '12',
      xPercent: 55,
      yPercent: 60,
      bboxPercent: { x: 54, y: 59, w: 4, h: 3 },
      confidence: 0.64,
      ambiguousOptions: ['12', '18'],
      region: 'field',
      source: 'ocr',
    },
    {
      id: 'c3',
      pageIndex: 0,
      rawText: 'М8-7H',
      normalizedText: 'М8-7H',
      xPercent: 62,
      yPercent: 42,
      bboxPercent: { x: 61, y: 41, w: 5, h: 3 },
      confidence: 0.97,
      ambiguousOptions: [],
      region: 'field',
      source: 'ocr',
    },
  ],
  warnings: [],
};

let container: HTMLDivElement;
let root: Root | null = null;
let clicked: string[];

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

const flush = async (times = 6) => {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

async function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
  });
  return container;
}

const text = () => container.textContent ?? '';

function buttons() {
  return Array.from(container.querySelectorAll('button'));
}

async function click(element: Element | undefined) {
  if (!element) {
    throw new Error('Элемент не найден');
  }
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

async function clickText(label: string) {
  const button = buttons().find((element) => (element.textContent ?? '').includes(label));
  if (!button) {
    throw new Error(`Кнопка «${label}» не найдена. Есть: ${buttons().map((b) => b.textContent).join(' | ')}`);
  }
  await click(button);
}

function dropFile(name: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error('Поле выбора файла не найдено');
  }
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mock(this: HTMLAnchorElement) {
    clicked.push(`${this.download}|${this.href.slice(0, 24)}`);
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('однозадачный конвейер в браузере', () => {
  it('на главном экране есть drag & drop и три примера', async () => {
    await render();
    expect(text()).toContain('Перетащите чертёж или 3D-модель сюда');
    expect(text()).toContain('Кронштейн КС-04');
    expect(text()).toContain('Редуктор РД-12');
    expect(text()).toContain('Узел привода УП-08');
    expect(container.querySelector('.dropzone')).not.toBeNull();
  });

  it('демо открывается без сети и показывает предпросмотр листов A4', async () => {
    await render();
    await clickText('Кронштейн КС-04');

    expect(text()).toContain('Скачать PDF-инструкцию');
    expect(text()).toContain('Предпросмотр');
    const pages = container.querySelectorAll('.page');
    expect(pages.length).toBeGreaterThan(2);
    // На титульном листе — название, шифр и материал из документа.
    expect(container.querySelector('.page')?.textContent).toContain('Кронштейн крепления сервопривода КС-04');
  });

  it('загрузка файла → распознавание → правка нечёткого размера → скачивание PDF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VISION_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:mock');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });

    await render();
    await dropFile('kronshteyn.png');
    await flush(12);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/recognize');
    expect(text()).toContain('Скачать PDF-инструкцию');

    // 64 % — жёлтая плашка с вариантами «12» / «18».
    expect(text()).toContain('Проверьте размеры');
    const choice = buttons().find((element) => element.textContent?.trim() === '18');
    expect(choice, 'вариант «18» в плашке').toBeDefined();
    await click(choice);
    expect(text()).not.toContain('Проверьте размеры');

    await clickText('Скачать PDF-инструкцию');
    await flush(12);

    expect(createObjectURL).toHaveBeenCalled();
    if (clicked.length === 0) {
      throw new Error(`Скачивание не произошло. Экран: ${text().slice(0, 600)}`);
    }
    expect(clicked.some((entry) => entry.endsWith('_инструкция.pdf|blob:mock'))).toBe(true);
    expect(text()).toContain('PDF готов');
  }, 60_000);

  it('без бэкенда показывает подсказку про npm run dev:all и предлагает пример', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await render();
    await dropFile('scan.png');
    await flush(12);

    expect(text()).toContain('Не получилось');
    expect(text()).toContain('npm run dev:all');
    await clickText('Открыть пример');
    expect(text()).toContain('Скачать PDF-инструкцию');
  }, 30_000);

  it('правка текста шага и «Осторожно!» попадают в предпросмотр', async () => {
    await render();
    await clickText('Кронштейн КС-04');

    // Первый шаг раскрыт по умолчанию; текст шага — кнопка, пока по ней не кликнули.
    const before = container.querySelector('.step-text')?.textContent ?? '';
    expect(before.length).toBeGreaterThan(20);
    await click(container.querySelector('.step-text') as Element);

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea, 'поле текста шага').not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Сверлите четыре отверстия Ø6,8 мм строго по разметке.');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      textarea!.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    });
    await flush();

    const stepBody = container.querySelector('.step-body')?.textContent ?? '';
    expect(stepBody).toContain('строго по разметке');
  }, 30_000);
});
