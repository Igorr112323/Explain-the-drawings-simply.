import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_EXTENSIONS,
  ACCEPTED_FORMATS_LABEL,
  importFiles,
  isDrawingFile,
  openDemo,
  PipelineError,
  titleFromFileName,
} from './pipeline';

const CANDIDATES = [
  {
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
  },
  {
    id: 'p0-c2',
    pageIndex: 0,
    rawText: '12',
    normalizedText: '12',
    xPercent: 55,
    yPercent: 60,
    bboxPercent: { x: 54, y: 59, w: 4, h: 3 },
    confidence: 0.7,
    ambiguousOptions: ['12', '18'],
    region: 'field',
    source: 'ocr',
  },
  {
    id: 'p0-c3',
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
  {
    id: 'p0-c4',
    pageIndex: 0,
    rawText: 'Ø6,8',
    normalizedText: 'Ø6,8',
    xPercent: 30,
    yPercent: 20,
    bboxPercent: { x: 29, y: 19, w: 5, h: 3 },
    confidence: 0.99,
    ambiguousOptions: [],
    region: 'field',
    source: 'ocr',
  },
];

const VISION_RESPONSE = {
  requestId: 'req-1',
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
  candidates: CANDIDATES,
  warnings: [],
};

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const image = (name = 'bracket.png') =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });

describe('конвейер «файл → документ»', () => {
  it('принимает только 2D-форматы чертежей', () => {
    for (const name of ['Вал.PDF', 'photo.webp', 'scan.jpg', 'scan.jpeg', 'sheet.png']) {
      expect(isDrawingFile(name), name).toBe(true);
    }
    for (const name of ['assembly.STEP', 'model.glb', 'part.stl', 'notes.docx']) {
      expect(isDrawingFile(name), name).toBe(false);
    }
    expect([...ACCEPTED_EXTENSIONS]).toEqual(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
    expect(ACCEPT_ATTRIBUTE).toBe('.jpg,.jpeg,.png,.webp,.pdf');
    expect(ACCEPTED_FORMATS_LABEL).toBe('JPG · JPEG · PNG · WEBP · PDF');
  });

  it('делает читаемое название из имени файла', () => {
    expect(titleFromFileName('kronshteyn_KS-04.png')).toBe('kronshteyn KS-04');
    expect(titleFromFileName('.png')).toBe('Деталь по чертежу');
  });

  it('отправляет картинку в /v1/recognize и собирает документ', async () => {
    fetchMock.mockResolvedValue(jsonResponse(VISION_RESPONSE));
    const phases: string[] = [];
    const result = await importFiles([image()], (phase) => phases.push(phase));

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/recognize');
    expect(phases).toContain('recognizing');
    expect(phases).toContain('building');
    expect(result.source).toBe('vision');
    expect(result.pages).toHaveLength(1);
    expect(result.doc.steps.length).toBeGreaterThan(0);
    expect(result.doc.xrayAnnotations.map((item) => item.raw)).toContain('Ø20 H7');
    // нечёткий размер сохраняется как вопрос к человеку
    expect(result.doc.xrayAnnotations.find((item) => item.raw === '12')?.confirmedByHuman).toBe(false);
  });

  it('без движка подсказывает запустить npm run dev:vision', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(importFiles([image()])).rejects.toBeInstanceOf(PipelineError);
    await expect(importFiles([image()])).rejects.toMatchObject({
      hint: expect.stringContaining('npm run dev:vision'),
    });
  });

  it('объясняет, что формат не поддерживается, и не зовёт движок', async () => {
    const docx = new File([new Uint8Array([1])], 'notes.docx');
    await expect(importFiles([docx])).rejects.toMatchObject({
      message: expect.stringContaining('.docx'),
      hint: expect.stringContaining('2D-чертежи'),
    });
    const step = new File([new Uint8Array([0x49, 0x53, 0x4f])], 'bracket.step');
    await expect(importFiles([step])).rejects.toMatchObject({ message: expect.stringContaining('.step') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('оба 2D-демо открываются без сети', async () => {
    for (const id of ['demo-bracket', 'demo-gearbox'] as const) {
      const result = await openDemo(id);
      expect(result.source).toBe('demo');
      expect(result.doc.steps.length).toBeGreaterThan(1);
      expect(result.doc.metadata.title.length).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('возвращает копию демо: правки не портят следующий запуск', async () => {
    const first = await openDemo('demo-bracket');
    first.doc.metadata.title = 'Испорчено';
    const second = await openDemo('demo-bracket');
    expect(second.doc.metadata.title).not.toBe('Испорчено');
  });
});
