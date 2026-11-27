import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema } from '@ikguide/schema';
import { buildGuideFromVision } from './document';
import type { VisionBomRow, VisionCandidate, VisionRecognizeResponse, VisionSheetView } from './types';

const STAMP = {
  name: 'Узел привода',
  code: 'АБВ.301.000 СБ',
  material: '09Г2С',
  scale: '1:2',
  sheet: '1',
  confidence: 0.96,
  rawLines: ['АБВ.301.000 СБ', 'Узел привода', '09Г2С', 'Масштаб 1:2'],
};

const OPTIONS = {
  author: 'Инженер ОТК Петров П. П.',
  createdAt: '2026-11-25T08:00:00.000Z',
  revision: '1',
} as const;

function candidate(id: string, normalizedText: string, partial: Partial<VisionCandidate> = {}): VisionCandidate {
  return {
    id,
    pageIndex: 0,
    rawText: normalizedText,
    normalizedText,
    xPercent: 30,
    yPercent: 40,
    bboxPercent: { x: 28, y: 38, w: 12, h: 4 },
    confidence: 0.99,
    ambiguousOptions: [],
    region: 'field',
    source: 'pdf',
    ...partial,
  };
}

function row(
  position: number,
  designation: string,
  name: string,
  quantity: number,
  y: number,
): VisionBomRow {
  return {
    pageIndex: 0,
    position,
    designation,
    name,
    quantity,
    xPercent: 40,
    yPercent: y + 1,
    bboxPercent: { x: 8, y, w: 70, h: 2 },
  };
}

function view(name: string, x: number, y: number): VisionSheetView {
  return { pageIndex: 0, name, xPercent: x, yPercent: y, bboxPercent: { x: x - 2, y: y - 1, w: 6, h: 3 } };
}

const BOM: VisionBomRow[] = [
  row(5, 'АБВ.301.12', 'Ручка жаровни', 2, 30),
  row(6, 'АБВ.301.13', 'Кронштейн', 1, 34),
  row(7, 'ГОСТ 7798-70', 'Болт М8', 4, 38),
];

const VIEWS: VisionSheetView[] = [view('Спереди', 30, 12), view('Сбоку', 55, 12), view('Сверху', 80, 12)];

function payload(overrides: Partial<VisionRecognizeResponse> = {}): VisionRecognizeResponse {
  return {
    schemaVersion: '1.0',
    requestId: 'req-bom',
    pages: [
      {
        pageIndex: 0,
        pageId: 'pg-bom',
        source: 'pdf_vector',
        width: 1638,
        height: 1158,
        dpi: 140,
        perspectiveCorrected: false,
        warnings: [],
        upscale: 1,
      },
    ],
    titleBlock: STAMP,
    candidates: [
      candidate('c1', 'Ø20 H7', { bboxPercent: { x: 40, y: 55, w: 8, h: 3 }, xPercent: 44, yPercent: 56 }),
      candidate('c2', 'М8-7H', { bboxPercent: { x: 55, y: 60, w: 7, h: 3 }, xPercent: 58, yPercent: 61 }),
      candidate('c3', 'Ra 1,6', { bboxPercent: { x: 68, y: 62, w: 6, h: 2 }, xPercent: 71, yPercent: 63 }),
    ],
    bomRows: BOM,
    views: VIEWS,
    warnings: [],
    ...overrides,
  };
}

describe('таблица позиций → шаги комплектности', () => {
  it('каждая строка спецификации становится отдельным шагом сразу после подготовки', () => {
    const { document } = buildGuideFromVision(payload(), OPTIONS);
    const titles = document.steps.map((step) => step.title);

    expect(document.steps.length).toBeGreaterThan(5);
    const bomIndexes = titles
      .map((title, index) => (title.startsWith('Комплектность') ? index : -1))
      .filter((index) => index >= 0);
    expect(bomIndexes).toHaveLength(3);

    // Шаг подготовки — первый, шаги комплектности идут сразу за ним.
    expect(titles[0]).toContain('Подготовка');
    expect(bomIndexes[0]).toBe(1);

    const first = document.steps[bomIndexes[0]!]!;
    expect(first.title).toBe('Комплектность · позиция 5: Ручка жаровни');
    expect(first.workerText).toContain('АБВ.301.12');
    expect(first.workerText).toContain('2 шт.');
    expect(first.drawingRefs).toEqual([]);
    expect(document.steps[bomIndexes[2]!]!.workerText).toContain('4 шт.');
  });

  it('номера шагов идут подряд, а шаги этапов остаются на месте', () => {
    const { document } = buildGuideFromVision(payload(), OPTIONS);
    expect(document.steps.map((step) => step.number)).toEqual(
      document.steps.map((_, index) => index + 1),
    );
    expect(new Set(document.steps.map((step) => step.id)).size).toBe(document.steps.length);
    const stages = document.steps.filter((step) => !step.title.startsWith('Комплектность') && !step.title.startsWith('Ориентир'));
    // Порядок этапов не изменился: подготовка первой, контроль последним.
    expect(stages[0]!.title).toBe('Подготовка заготовки и проверка чертежа');
    expect(stages.at(-1)!.title).toBe('Финальный контроль допусков и шероховатости');
    expect(stages.map((step) => step.title)).toEqual([
      'Подготовка заготовки и проверка чертежа',
      'Отверстия, зенковка и резьба',
      'Чистовая обработка, фаски и сварка',
      'Финальный контроль допусков и шероховатости',
    ]);
  });

  it('строки спецификации попадают в BOM с количеством и номером позиции', () => {
    const { document } = buildGuideFromVision(payload(), OPTIONS);
    const bom = document.bom;

    const handle = bom.find((item) => item.name === 'Ручка жаровни');
    expect(handle).toMatchObject({ quantity: 2, size: 'АБВ.301.12', kind: 'purchased' });
    expect(handle?.note).toContain('Позиция 5');

    const bolt = bom.find((item) => item.name === 'Болт М8');
    expect(bolt).toMatchObject({ quantity: 4, kind: 'fastener', icon: 'bolt' });
    expect(bolt?.note).toContain('ГОСТ 7798-70');

    expect(bom.filter((item) => item.id.startsWith('bom-row-'))).toHaveLength(3);
  });

  it('в каждом шаге есть зона кропа внутри листа', () => {
    const { document } = buildGuideFromVision(payload(), OPTIONS);
    for (const step of document.steps) {
      expect(step.cropPercent, step.title).toBeDefined();
      const crop = step.cropPercent!;
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.w).toBeGreaterThan(0);
      expect(crop.h).toBeGreaterThan(0);
      expect(crop.x + crop.w).toBeLessThanOrEqual(100.5);
      expect(crop.y + crop.h).toBeLessThanOrEqual(100.5);
    }

    const bomStep = document.steps.find((step) => step.title.includes('позиция 5'))!;
    // Кроп вокруг строки таблицы: начинается выше её верхней границы и покрывает всю ширину строки.
    expect(bomStep.cropPercent!.y).toBeLessThan(30);
    expect(bomStep.cropPercent!.w).toBeGreaterThanOrEqual(70);
  });

  it('документ проходит схему и допускает печать', () => {
    const { document } = buildGuideFromVision(payload(), OPTIONS);
    const parsed = ikGuideDocumentSchema.safeParse(document);
    expect(parsed.success).toBe(true);
  });
});

describe('подписи видов → ориентиры', () => {
  it('каждый вид становится шагом с зоной кропа вокруг подписи', () => {
    const { document } = buildGuideFromVision(payload(), OPTIONS);
    const views = document.steps.filter((step) => step.title.startsWith('Ориентир на листе: вид'));

    expect(views.map((step) => step.title)).toEqual([
      'Ориентир на листе: вид Спереди',
      'Ориентир на листе: вид Сбоку',
      'Ориентир на листе: вид Сверху',
    ]);
    expect(views[0]!.workerText).toContain('Спереди');
    const crop = views[1]!.cropPercent!;
    expect(crop.x).toBeLessThanOrEqual(53);
    expect(crop.x + crop.w).toBeGreaterThanOrEqual(59);
  });

  it('без своих обозначений шаг этапа берёт зону ближайшего вида', () => {
    const { document } = buildGuideFromVision(
      payload({
        candidates: [candidate('c1', 'Ø20 H7', { bboxPercent: { x: 0, y: 0, w: 0, h: 0 } })],
        bomRows: [],
        views: VIEWS,
      }),
      OPTIONS,
    );
    const control = document.steps.find((step) => step.title.includes('Финальный контроль'))!;
    expect(control.cropPercent).toBeDefined();
    expect(control.cropPercent!.y).toBeLessThan(20);
    expect(document.steps.some((step) => step.title.startsWith('Комплектность'))).toBe(false);
  });
});

describe('ограничения и честность', () => {
  it('больше шести строк спецификации не превращаются в шаги', () => {
    const many = Array.from({ length: 9 }, (_, index) => row(index + 1, `АБВ.301.1${index}`, `Деталь ${index + 1}`, 1, 30 + index * 3));
    const { document } = buildGuideFromVision(payload({ bomRows: many }), OPTIONS);
    expect(document.steps.filter((step) => step.title.startsWith('Комплектность'))).toHaveLength(6);
  });

  it('больше трёх видов не превращаются в ориентиры', () => {
    const many = Array.from({ length: 5 }, (_, index) => view(`Вид ${index + 1}`, 20 + index * 12, 12));
    const { document } = buildGuideFromVision(payload({ views: many }), OPTIONS);
    expect(document.steps.filter((step) => step.title.startsWith('Ориентир'))).toHaveLength(3);
  });

  it('без таблицы и видов сборка остаётся прежней', () => {
    const { document, warnings } = buildGuideFromVision(payload({ bomRows: [], views: [] }), OPTIONS);
    expect(document.steps.filter((step) => step.title.startsWith('Комплектность'))).toEqual([]);
    expect(document.steps.filter((step) => step.title.startsWith('Ориентир'))).toEqual([]);
    expect(document.steps).toHaveLength(4);
    expect(warnings.length).toBeGreaterThanOrEqual(0);
  });

  it('строки спецификации отмечаются в отчёте пропущенных как bom_row', () => {
    const result = buildGuideFromVision(payload(), OPTIONS);
    const bomNotes = result.skipped.filter((entry) => entry.reason === 'bom_row');
    expect(bomNotes).toHaveLength(1);
    expect(bomNotes[0]!.text).toContain('поз. 5');
  });
});
