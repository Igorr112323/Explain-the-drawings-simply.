import { describe, expect, it } from 'vitest';
import { CONFIDENCE_THRESHOLD, ikGuideDocumentSchema } from '@ikguide/schema';
import { buildGuideFromNotations, buildGuideFromVision } from './document';
import { mm, shortHash, slugify } from './format';
import type { VisionCandidate, VisionRecognizeResponse } from './types';

const STAMP = {
  name: 'Кронштейн',
  code: 'КС-04.100.000 СБ',
  material: '09Г2С',
  scale: '1:2',
  sheet: '1',
  confidence: 0.95,
  rawLines: ['КС-04.100.000 СБ', 'Кронштейн', '09Г2С', 'Масштаб 1:2', 'Масса 2,4 кг'],
};

const FIXED_OPTIONS = {
  author: 'Инженер ОТК Петров П. П.',
  createdAt: '2026-11-20T09:00:00.000Z',
  revision: '1',
} as const;

function candidate(partial: Partial<VisionCandidate> & { id: string; normalizedText: string }): VisionCandidate {
  return {
    pageIndex: 0,
    rawText: partial.normalizedText,
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

function payload(candidates: VisionCandidate[]): VisionRecognizeResponse {
  return {
    schemaVersion: '1.0',
    requestId: 'req-test',
    pages: [
      {
        pageIndex: 0,
        pageId: 'pg-test',
        source: 'pdf_vector',
        width: 1638,
        height: 1158,
        dpi: 140,
        perspectiveCorrected: false,
        warnings: [],
      },
    ],
    titleBlock: STAMP,
    candidates,
    warnings: [],
    engine: { ocr: 'rapidocr', ocrAvailable: true },
  };
}

const BRACKET_CANDIDATES: VisionCandidate[] = [
  candidate({ id: 'p0-c1', normalizedText: '36', xPercent: 22, yPercent: 30 }),
  candidate({ id: 'p0-c2', normalizedText: 'Ø20 H7', xPercent: 40, yPercent: 42, confidence: 0.97 }),
  candidate({ id: 'p0-c3', normalizedText: 'М8-7H', xPercent: 55, yPercent: 35, confidence: 0.92, ambiguousOptions: ['М8-7H', 'М6-7H'] }),
  candidate({ id: 'p0-c4', normalizedText: '4 отв. Ø6,5', xPercent: 62, yPercent: 60 }),
  candidate({ id: 'p0-c5', normalizedText: 'Ra 1,6', xPercent: 70, yPercent: 72 }),
  candidate({ id: 'p0-c6', normalizedText: 'Т1-К5', xPercent: 45, yPercent: 80 }),
  candidate({ id: 'p0-c7', normalizedText: '12', xPercent: 33, yPercent: 55, confidence: 0.88, ambiguousOptions: ['12', '18'] }),
  candidate({
    id: 'p0-c8',
    normalizedText: 'Неуказанные предельные отклонения ±0,5 мм',
    xPercent: 50,
    yPercent: 88,
    region: 'tech_req',
    source: 'ocr',
    confidence: 0.93,
  }),
  candidate({ id: 'p0-c9', normalizedText: 'КС-04.100.000 СБ', xPercent: 55, yPercent: 95, region: 'title_block' }),
  candidate({ id: 'p0-c10', normalizedText: 'Разраб. Иванов', xPercent: 40, yPercent: 96, region: 'tech_req', source: 'ocr' }),
];

describe('buildGuideFromVision', () => {
  it('produces a schema-valid document with 5 production stages', () => {
    const result = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    expect(ikGuideDocumentSchema.safeParse(result.document).success).toBe(true);

    const { document } = result;
    expect(document.metadata.drawingCode).toBe('КС-04.100.000 СБ');
    expect(document.metadata.title).toBe('Кронштейн');
    expect(document.metadata.material).toBe('09Г2С');
    expect(document.metadata.massKg).toBe(2.4);
    expect(document.drawing.scale).toBe('1:2');

    expect(document.steps.map((step) => step.title)).toEqual([
      'Подготовка заготовки и проверка чертежа',
      'Разметка и базовые размеры',
      'Отверстия, зенковка и резьба',
      'Чистовая обработка, фаски и сварка',
      'Финальный контроль допусков и шероховатости',
    ]);
    expect(document.steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]);
    expect(result.stats.steps).toBe(5);
  });

  it('links every step to existing xray annotations', () => {
    const { document } = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    const annotationIds = new Set(document.xrayAnnotations.map((annotation) => annotation.id));
    document.steps.forEach((step) => {
      step.drawingRefs.forEach((ref) => expect(annotationIds.has(ref)).toBe(true));
    });

    const holeStep = document.steps.find((step) => step.title.includes('Отверстия'));
    expect(holeStep?.drawingRefs.length).toBeGreaterThan(0);
  });

  it('derives the tool list from GOST translations without duplicates', () => {
    const candidates = [
      ...BRACKET_CANDIDATES,
      candidate({ id: 'p0-c11', normalizedText: 'М8-7H', xPercent: 12, yPercent: 20 }),
      candidate({ id: 'p0-c12', normalizedText: 'М8-7H', xPercent: 80, yPercent: 22 }),
    ];
    const { document, stats } = buildGuideFromVision(payload(candidates), FIXED_OPTIONS);
    const names = document.tools.map((tool) => tool.name);

    const taps = names.filter((name) => name.startsWith('Метчик М8'));
    expect(taps).toHaveLength(1);

    expect(names.some((name) => name.includes('Ø6,8'))).toBe(true);
    expect(names.some((name) => name.startsWith('Развёртка'))).toBe(true);
    expect(names.some((name) => name.includes('Калибр-пробка'))).toBe(true);
    expect(names.some((name) => name.includes('УШС-3'))).toBe(true);

    expect(new Set(names).size).toBe(names.length);
    expect(stats.tools).toBe(document.tools.length);
    document.tools.forEach((tool) => expect(tool.forSteps.length).toBeGreaterThan(0));
  });

  it('keeps uncertain notations unconfirmed with their alternatives', () => {
    const { document, translations, stats } = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);

    const ambiguous = document.xrayAnnotations.find((annotation) => annotation.raw === '12');
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.ambiguousOptions).toEqual(['12', '18']);
    expect(ambiguous!.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
    expect(ambiguous!.confirmedByHuman).toBe(false);

    const thread = document.xrayAnnotations.find((annotation) => annotation.raw === 'М8-7H');
    expect(thread?.ambiguousOptions).toEqual(['М8-7H', 'М6-7H']);

    expect(stats.uncertain).toBeGreaterThan(0);
    const criticalAntiError = document.steps.flatMap((step) => (step.antiError ? [step.antiError] : []));
    expect(criticalAntiError.some((error) => error.severity === 'critical')).toBe(true);

    expect(translations.some((entry) => entry.result.kind === 'thread')).toBe(true);
    expect(document.steps.find((step) => step.title.includes('Отверстия'))?.criticalChecks.length).toBeGreaterThan(0);
  });

  it('builds a QC checklist from critical tolerances', () => {
    const { document } = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    const texts = document.qcChecklist.map((item) => item.text).join(' | ');
    expect(texts).toContain('H7');
    expect(texts).toContain('резьбу');
    expect(texts).toContain('шероховатость');
    expect(texts).toContain('КС-04.100.000 СБ');
    expect(document.qcChecklist.every((item) => item.required)).toBe(true);
  });

  it('keeps tech-requirement prose as an annotation but out of the steps', () => {
    const { document } = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    const prose = document.xrayAnnotations.find((annotation) => annotation.raw.startsWith('Неуказанные'));
    expect(prose).toBeDefined();
    expect(prose!.kind).toBe('other');
    expect(document.steps.some((step) => step.workerText.includes('Неуказанные'))).toBe(false);
  });

  it('skips garbage lines and stamp duplicates', () => {
    const result = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    const skippedTexts = result.skipped.map((entry) => entry.text);
    expect(skippedTexts).toContain('Разраб. Иванов');
    expect(skippedTexts).toContain('КС-04.100.000 СБ');
    expect(result.skipped.find((entry) => entry.text === 'Разраб. Иванов')?.reason).toBe('not_a_notation');
    expect(result.skipped.find((entry) => entry.text === 'КС-04.100.000 СБ')?.reason).toBe('title_block');
  });

  it('drops empty stages but keeps contiguous numbering', () => {
    const dimensionsOnly = [
      candidate({ id: 'p0-c1', normalizedText: '120±0,5' }),
      candidate({ id: 'p0-c2', normalizedText: '36' }),
    ];
    const { document } = buildGuideFromVision(payload(dimensionsOnly), FIXED_OPTIONS);
    expect(document.steps.map((step) => step.number)).toEqual([1, 2, 3]);
    expect(document.steps.map((step) => step.title)).toEqual([
      'Подготовка заготовки и проверка чертежа',
      'Разметка и базовые размеры',
      'Финальный контроль допусков и шероховатости',
    ]);
    expect(document.metadata.blankDimensions).toContain('120');
  });

  it('still yields a valid draft when nothing was recognised', () => {
    const result = buildGuideFromVision(payload([]), FIXED_OPTIONS);
    expect(ikGuideDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(result.document.tools.length).toBeGreaterThan(0);
    expect(result.document.steps).toHaveLength(2);
    expect(result.warnings.some((warning) => warning.includes('Распознанных обозначений нет'))).toBe(true);
  });

  it('uses placeholders and warns when the stamp is missing', () => {
    const blind: VisionRecognizeResponse = {
      candidates: [candidate({ id: 'p0-c1', normalizedText: 'Ra 3,2' })],
      titleBlock: null,
      pages: [],
    };
    const result = buildGuideFromVision(blind, FIXED_OPTIONS);
    expect(result.document.metadata.drawingCode).toBe('Шифр уточняется');
    expect(result.document.metadata.material).toContain('уточнить');
    expect(result.warnings.join(' ')).toContain('Шифр чертежа не найден');
    expect(result.document.steps[0].antiError?.severity).toBe('warning');
  });

  it('merges hand-typed ciphers into a vision draft', () => {
    const result = buildGuideFromVision(payload([candidate({ id: 'p0-c1', normalizedText: 'Ra 3,2' })]), {
      ...FIXED_OPTIONS,
      manualNotations: [{ text: 'М12-6g' }, { text: '' }],
    });
    const manual = result.document.xrayAnnotations.find((annotation) => annotation.raw === 'М12-6g');
    expect(manual).toBeDefined();
    expect(manual!.confirmedByHuman).toBe(true);
    expect(manual!.confidence).toBe(1);
    expect(result.document.tools.some((tool) => tool.name.includes('Плашка М12'))).toBe(true);
  });

  it('can drop low-confidence candidates on request', () => {
    const strict = buildGuideFromVision(payload(BRACKET_CANDIDATES), { ...FIXED_OPTIONS, keepLowConfidence: false });
    expect(strict.document.xrayAnnotations.every((annotation) => annotation.confidence >= CONFIDENCE_THRESHOLD)).toBe(true);
    expect(strict.skipped.some((entry) => entry.reason === 'below_threshold')).toBe(true);
  });

  it('is deterministic for the same sheet and timestamp', () => {
    const first = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    const second = buildGuideFromVision(payload(BRACKET_CANDIDATES), FIXED_OPTIONS);
    expect(first.document.id).toBe(second.document.id);
    expect(first.document.id.startsWith('guide-ks-04-100-000')).toBe(true);

    const other = buildGuideFromVision(payload(BRACKET_CANDIDATES), { ...FIXED_OPTIONS, drawingCode: 'РД-12.200.000 СБ' });
    expect(other.document.id).not.toBe(first.document.id);
  });

  it('caps a noisy scan instead of producing hundreds of steps', () => {
    const noisy = Array.from({ length: 70 }, (_unused, index) =>
      candidate({ id: `p0-c${index + 1}`, normalizedText: `Ø${10 + index}`, confidence: 0.6 }),
    );
    const result = buildGuideFromVision(payload(noisy), { ...FIXED_OPTIONS, maxAnnotations: 20 });
    expect(result.document.xrayAnnotations).toHaveLength(20);
    expect(result.skipped.some((entry) => entry.reason === 'limit')).toBe(true);
  });
});

describe('buildGuideFromNotations', () => {
  it('accepts hand-typed ciphers as confirmed annotations', () => {
    const result = buildGuideFromNotations(['Ø20 H7', 'М8-7H', 'Ra 1,6'], {
      ...FIXED_OPTIONS,
      title: 'Кронштейн КС-04',
      drawingCode: 'КС-04.100.000 СБ',
      material: '09Г2С',
      blankDimensions: 'Полоса 120 × 80 × 12 мм',
    });

    expect(ikGuideDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(result.document.xrayAnnotations).toHaveLength(3);
    result.document.xrayAnnotations.forEach((annotation) => {
      expect(annotation.confirmedByHuman).toBe(true);
      expect(annotation.confidence).toBe(1);
    });
    expect(result.stats.translated).toBe(3);
    expect(result.document.tools.some((tool) => tool.name.startsWith('Метчик М8'))).toBe(true);
  });

  it('ignores empty manual entries', () => {
    const result = buildGuideFromNotations(['   ', ''], FIXED_OPTIONS);
    expect(result.document.xrayAnnotations).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe('format helpers', () => {
  it('formats millimetres the Russian way', () => {
    expect(mm(6.8)).toBe('6,8');
    expect(mm(20)).toBe('20');
    expect(mm(40, 0)).toBe('40');
    expect(mm(0)).toBe('0');
    expect(mm(1.25)).toBe('1,25');
  });

  it('slugs drawing codes and hashes deterministically', () => {
    expect(slugify('КС-04.100.000 СБ')).toBe('ks-04-100-000-sb');
    expect(shortHash('КС-04')).toBe(shortHash('КС-04'));
    expect(shortHash('КС-04')).not.toBe(shortHash('КС-05'));
  });
});
