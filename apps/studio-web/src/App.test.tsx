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

const flush = async (times = 8) => {
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
  await flush();
  return container;
}

const text = () => container.textContent ?? '';
const all = (selector: string) => Array.from(container.querySelectorAll(selector));

function buttonsIn(scope: ParentNode) {
  return Array.from(scope.querySelectorAll('button'));
}

function byLabel(label: string, scope: ParentNode = container) {
  const element = scope.querySelector(`[aria-label="${label}"]`);
  if (!element) {
    throw new Error(`Элемент «${label}» не найден. Подписи: ${all('[aria-label]').map((node) => node.getAttribute('aria-label')).join(' | ')}`);
  }
  return element;
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

async function clickText(label: string, scope: ParentNode = container) {
  const button = buttonsIn(scope).find((element) => (element.textContent ?? '').includes(label));
  if (!button) {
    throw new Error(
      `Кнопка «${label}» не найдена. Есть: ${buttonsIn(scope).map((b) => (b.textContent ?? '').trim()).join(' | ')}`,
    );
  }
  await click(button);
}

/** Открывает пример из поповера «Примеры чертежей» (нижний левый угол). */
async function openDemo(title = 'Кронштейн КС-04') {
  await render();
  await click(byLabel('Примеры чертежей'));
  await clickText(title);
  await flush(12);
}

async function type(input: Element, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Правит поле InlineEdit: клик по кнопке → новый текст → blur. */
async function editInline(button: Element | undefined, value: string) {
  await click(button);
  const field = container.querySelector('.inline-input');
  expect(field, 'поле правки').not.toBeNull();
  await type(field as Element, value);
  // React 18 слушает blur через делегированный focusout.
  await act(async () => {
    field!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await flush();
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

describe('холст с парящими капсулами', () => {
  it('пустой экран: точечный холст, пять капсул и тихая подсказка по центру', async () => {
    await render();

    expect(container.querySelector('.canvas')).not.toBeNull();
    expect(container.querySelector('.hint-title')?.textContent).toBe('Перетащите 2D-чертёж или PDF сюда');
    expect(buttonsIn(container.querySelector('.hint')!).map((b) => b.textContent).join()).toContain('выберите пример');

    // 2 овальные капсулы + 3 круглые кнопки по углам = 5 парящих элементов.
    expect(all('.pill')).toHaveLength(2);
    expect(all('.round')).toHaveLength(3);
    expect(container.querySelector('.topbar')).toBeNull();
    expect(container.querySelector('.inspector')).toBeNull();
  });

  it('капсулы на месте: назад неактивна, экспорт ждёт документ, тема и движок — в «•••»', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok', service: 'ikguide-vision-api' }));
    vi.stubGlobal('fetch', fetchMock);
    await render();

    expect((byLabel('Назад — пока некуда: файл ещё не открыт') as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel('Скачать PDF-инструкцию') as HTMLButtonElement).disabled).toBe(true);

    await click(byLabel('Ещё: тема, движок, адреса сервисов'));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog, 'поповер «Ещё»').not.toBeNull();
    expect(dialog!.textContent).toContain('Тема');
    expect(dialog!.textContent).toContain('Движок');
    // Проверка /health ушла в локальный движок распознавания и статус подписан словами.
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain('/health');
    expect(dialog!.textContent).toContain('на связи');

    await click(buttonsIn(dialog!).find((b) => (b.textContent ?? '').includes('Тёмная')));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('ikguide:theme')).toBe('dark');
  });

  it('подписи под листами идут строго по порядку: «Стр. 1 из N» … «Стр. N из N»', async () => {
    await openDemo();
    const captions = all('.page-caption').map((node) => (node.textContent ?? '').trim());
    expect(captions.length).toBeGreaterThan(2);
    const total = captions.length;
    expect(captions).toEqual(Array.from({ length: total }, (_, index) => `Стр. ${index + 1} из ${total}`));
    // Ни одной подписи за пределами «N из N» — именно этот сдвиг был багом.
    expect(captions.some((caption) => caption.includes(`Стр. ${total + 1} из`))).toBe(false);
    expect(all('.page-figure').every((node) => (node.getAttribute('aria-label') ?? '').includes(`из ${total}`))).toBe(true);
  }, 30_000);

  it('пилюля масштаба: проценты, «+», «−» и сброс к 100 %', async () => {
    await openDemo();
    const pill = container.querySelector('.zoom-pill');
    expect(pill, 'пилюля масштаба').not.toBeNull();
    expect(pill!.textContent).toContain('72%');

    await click(byLabel('Увеличить масштаб'));
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('75%');
    expect(container.querySelector('.sheets')!.getAttribute('data-zoomable')).toBe('false');

    await click(byLabel('Увеличить масштаб'));
    await click(byLabel('Увеличить масштаб'));
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('125%');
    // Крупнее 100 % — фон холста можно тянуть.
    expect(container.querySelector('.sheets')!.getAttribute('data-zoomable')).toBe('true');

    await click(byLabel('Уменьшить масштаб'));
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('100%');

    // Клик по процентам возвращает ровно 100 % и центрирует листы.
    await click(
      Array.from(container.querySelectorAll('.zoom-value')).find((node) => node.textContent?.includes('%')) as Element,
    );
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('100%');
  }, 30_000);

  it('колесо мыши и Ctrl+«+» меняют масштаб, а поле правки колесо не перехватывает', async () => {
    await openDemo();
    const sheets = container.querySelector('.sheets')!;
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('72%');

    await act(async () => {
      sheets.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
    });
    await flush();
    expect(container.querySelector('.zoom-pill')!.textContent).not.toContain('72%');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }));
    });
    await flush();
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('100%');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, bubbles: true }));
    });
    await flush();
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('75%');

    // Правка текста: колесо в поле ввода не должно менять масштаб листов.
    await click(byLabel('Править текст и название'));
    const field = container.querySelector('.inline-edit, .inline-input');
    const before = container.querySelector('.zoom-pill')!.textContent;
    if (field) {
      await act(async () => {
        field.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
      });
      await flush();
      expect(container.querySelector('.zoom-pill')!.textContent).toBe(before);
    }
  }, 30_000);

  it('пример открывается из поповера и ложится листами A4 прямо на холст', async () => {
    await openDemo();

    const pages = all('.page');
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0]?.textContent).toContain('Кронштейн крепления сервопривода КС-04');
    expect(container.querySelector('.sheets')).not.toBeNull();
    expect((byLabel('Скачать PDF-инструкцию') as HTMLButtonElement).disabled).toBe(false);
  });

  it('клик по названию на листе A4 открывает правку именно этого поля', async () => {
    await openDemo();

    const editable = all('.pv-editable').find((node) =>
      (node.getAttribute('aria-label') ?? '').includes('Изменить: Кронштейн'),
    );
    expect(editable, 'название на титульном листе кликабельно').toBeDefined();
    await click(editable);

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Текст и название');
    expect(dialog.querySelector('.field-title')?.textContent).toContain('Кронштейн');
  });

  it('правка шага на листе и кнопка «Отменить» возвращают прежний текст', async () => {
    await openDemo();
    await click(byLabel('Рентген ГОСТ и допуски'));
    await click(byLabel('Закрыть'));

    await click(byLabel('Править текст и название'));
    const dialog = container.querySelector('[role="dialog"]')!;
    const original = dialog.querySelector('.step-text')?.textContent ?? '';
    expect(original.length).toBeGreaterThan(20);

    await editInline(dialog.querySelector('.step-text') as Element, 'Сверлите отверстия строго по маркеру мастера.');
    const sheetsText = all('.page')
      .map((page) => page.textContent ?? '')
      .join(' ');
    // Строки листа — отдельные <span>, поэтому пробелы на стыке переносов не гарантированы.
    expect(sheetsText).toMatch(/строго\s*по\s*маркеру/);

    await click(byLabel('Отменить последнее действие'));
    const afterUndo = all('.page')
      .map((page) => page.textContent ?? '')
      .join(' ');
    expect(afterUndo).not.toContain('маркеру');
    expect(afterUndo).toContain(original.split(' ')[0] ?? '');
  }, 30_000);

  it('рентген ГОСТ: пины на листе, быстрый шифр и жёлтая точка у иконки', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VISION_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    await render();
    await typeFile('kronshteyn.png');
    await flush(14);

    // 64 % — на иконке «Рентген» горит точка: есть неподтверждённый размер.
    const xrayButton = byLabel('Рентген ГОСТ и допуски');
    expect(xrayButton.querySelector('.pill-dot'), 'жёлтая точка-индикатор').not.toBeNull();
    await click(xrayButton);

    const dialog = container.querySelector('[role="dialog"]')!;
    const pins = dialog.querySelectorAll('.sheet-pin');
    expect(pins).toHaveLength(VISION_RESPONSE.candidates.length);
    await click(pins[0] ?? undefined);
    expect(container.querySelectorAll('.notation-active')).toHaveLength(1);

    // Быстрая проверка любого шифра из той же шпаргалки.
    await type(dialog.querySelector('.lookup') as Element, 'Ø20 H7');
    await flush();
    const explanation = dialog.querySelector('.lookup-explanation')?.textContent ?? '';
    expect(explanation).toContain('квалитет');
    expect(explanation).toContain('20,021');
  }, 30_000);

  it('нечёткий размер подтверждается одной парящей пилюлей над листами', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VISION_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    await render();
    await typeFile('kronshteyn.png');
    await flush(14);

    const ask = container.querySelector('.notice-ask');
    expect(ask, 'пилюля подтверждения размера').not.toBeNull();
    expect(ask!.textContent).toContain('Проверьте размер');
    expect(ask!.textContent).toContain('12');

    const choice = buttonsIn(ask!).find((element) => element.textContent?.trim() === '18');
    expect(choice, 'вариант «18»').toBeDefined();
    await click(choice);
    expect(container.querySelector('.notice-ask')).toBeNull();
  }, 30_000);

  it('кнопка ↑ собирает настоящий PDF и сообщает о готовом файле', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(VISION_RESPONSE)));
    const createObjectURL = vi.fn(() => 'blob:mock');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });

    await render();
    await typeFile('kronshteyn.png');
    await flush(14);

    await click(byLabel('Скачать PDF-инструкцию'));
    await flush(20);

    expect(createObjectURL).toHaveBeenCalled();
    if (clicked.length === 0) {
      throw new Error(`Скачивание не произошло. Экран: ${text().slice(0, 600)}`);
    }
    expect(clicked.some((entry) => entry.endsWith('_инструкция.pdf|blob:mock'))).toBe(true);
    expect(text()).toContain('PDF готов');
  }, 60_000);

  it('пометка «Осторожно!» правится из поповера и уходит на лист', async () => {
    await openDemo();
    await click(byLabel('Добавить пометку «Осторожно!»'));

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Добавить «Осторожно!»');

    // Второй шаг демо уже несёт предупреждение — правим именно его.
    await click(dialog.querySelectorAll('.chip-step')[1] as HTMLButtonElement);
    const fresh = container.querySelector('[role="dialog"]')!;
    const field = Array.from(fresh.querySelectorAll('[aria-label]')).find((node) =>
      (node.getAttribute('aria-label') ?? '').startsWith('Предупреждение шага'),
    )!;
    expect(field.textContent?.trim().length).toBeGreaterThan(5);

    await editInline(field, 'Не сверлить насквозь.');
    expect(text()).toContain('Не сверлить насквозь.');
  }, 30_000);

  it('масштаб упирается в 40 % и 250 %, а не уходит в бесконечность', async () => {
    await openDemo();
    for (let step = 0; step < 8; step += 1) {
      await click(byLabel('Уменьшить масштаб'));
    }
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('40%');
    for (let step = 0; step < 16; step += 1) {
      await click(byLabel('Увеличить масштаб'));
    }
    expect(container.querySelector('.zoom-pill')!.textContent).toContain('250%');
    // Листы не должны терять подписи на крайних значениях.
    expect(all('.page-caption')[0]?.textContent).toContain('Стр. 1 из');
  }, 30_000);

  it('тема переключается из «•••» и запоминается в localStorage', async () => {
    await openDemo();
    await click(byLabel('Ещё: тема, движок, адреса сервисов'));
    const group = container.querySelector('[aria-label="Тема оформления"]');
    expect(group, 'переключатель темы').not.toBeNull();
    const dark = Array.from(group!.querySelectorAll('button')).find((button) => button.textContent?.includes('Тёмная'));
    expect(dark, 'кнопка «Тёмная»').toBeDefined();
    await click(dark);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('ikguide:theme')).toBe('dark');
    expect(all('.page').length).toBeGreaterThan(0);

    const light = Array.from(group!.querySelectorAll('button')).find((button) => button.textContent?.includes('Светлая'));
    await click(light);
    expect(document.documentElement.dataset.theme).toBe('light');
  }, 30_000);

  it('после скачивания PDF ссылка на blob освобождается', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(VISION_RESPONSE)));
    const revoked: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn((url: string) => revoked.push(url)),
      configurable: true,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    await render();
    await typeFile('kronshteyn.png');
    await flush(14);
    await click(byLabel('Скачать PDF-инструкцию'));
    await flush(20);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    vi.useRealTimers();

    expect(clicked.length).toBeGreaterThan(0);
    expect(revoked, 'revokeObjectURL не вызывается — вкладка будет течь').toContain('blob:mock');
  }, 60_000);

  it('без бэкенда показывает подсказку про npm run dev:all и предлагает пример', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await render();
    await typeFile('scan.png');
    await flush(12);

    expect(text()).toContain('Не получилось');
    expect(text()).toContain('npm run dev:all');
    await clickText('Открыть пример');
    expect(all('.page').length).toBeGreaterThan(2);
  }, 30_000);
});

function typeFile(name: string) {
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
