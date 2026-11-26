import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLD,
  DocumentValidationError,
  createEmptyDocument,
  createStepDraft,
  documentStats,
  getEffectiveAnnotationValue,
  getUnconfirmedAnnotations,
  hasBlockingUncertainty,
  ikGuideDocumentSchema,
  isAnnotationTrusted,
  moveStep,
  parseDocument,
  parseDocumentJson,
  renumberSteps,
  serializeDocument,
  toggleAnnotationConfirmation,
  type IkGuideDocument,
} from './index';

function makeDocument(): IkGuideDocument {
  const base = createEmptyDocument('doc-test', '2026-11-26T09:00:00.000Z');
  return {
    ...base,
    steps: [
      createStepDraft({ id: 'step-1', number: 1, title: 'Разметка', workerText: 'Разметьте отверстия от базы.', illustrationId: 'demo-art' }),
      createStepDraft({ id: 'step-2', number: 2, title: 'Сверление', workerText: 'Просверлите четыре отверстия Ø6,8.', illustrationId: 'demo-art' }),
    ],
    xrayAnnotations: [
      {
        id: 'a-fit',
        raw: 'Ø20 H7',
        kind: 'fit',
        xPercent: 60,
        yPercent: 40,
        confidence: 0.98,
        confirmedByHuman: false,
      },
      {
        id: 'a-thread',
        raw: '4 отв. М8-7H глуб. 20',
        kind: 'thread',
        xPercent: 25,
        yPercent: 65,
        confidence: 0.72,
        confirmedByHuman: false,
        ambiguousOptions: ['12 мм', '18 мм'],
      },
      {
        id: 'a-rough',
        raw: 'Ra 1.6',
        kind: 'roughness',
        xPercent: 70,
        yPercent: 70,
        confidence: 0.6,
        confirmedByHuman: true,
      },
    ],
    qcChecklist: [
      { id: 'qc-1', text: 'Ø20 H7 в допуске', required: true, reference: 'Ø20 H7' },
      { id: 'qc-2', text: 'Заусенцы сняты', required: true },
    ],
  };
}

describe('IkGuide document schema', () => {
  it('accepts a fully valid document', () => {
    const result = ikGuideDocumentSchema.safeParse(makeDocument());
    if (!result.success) {
      throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
    }
    expect(result.success).toBe(true);
  });

  it('rejects confidence outside 0..1', () => {
    const doc = makeDocument();
    doc.xrayAnnotations[0] = { ...doc.xrayAnnotations[0]!, confidence: 1.2 };
    expect(ikGuideDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('rejects an empty BOM and an empty tool list', () => {
    const doc = makeDocument();
    expect(ikGuideDocumentSchema.safeParse({ ...doc, bom: [] }).success).toBe(false);
    expect(ikGuideDocumentSchema.safeParse({ ...doc, tools: [] }).success).toBe(false);
  });

  it('rejects duplicate step numbers and gaps in numbering', () => {
    const doc = makeDocument();
    const duplicated = { ...doc, steps: [doc.steps[0]!, { ...doc.steps[1]!, number: 1 }] };
    const duplicateResult = ikGuideDocumentSchema.safeParse(duplicated);
    expect(duplicateResult.success).toBe(false);

    const gap = { ...doc, steps: [doc.steps[0]!, { ...doc.steps[1]!, number: 3 }] };
    expect(ikGuideDocumentSchema.safeParse(gap).success).toBe(false);
  });

  it('rejects a step that references a missing annotation', () => {
    const doc = makeDocument();
    const broken = {
      ...doc,
      steps: [{ ...doc.steps[0]!, drawingRefs: ['does-not-exist'] }, doc.steps[1]!],
    };
    const result = ikGuideDocumentSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.message.includes('несуществующую аннотацию'))).toBe(true);
  });

  it('rejects ambiguous options with fewer than two values', () => {
    const doc = makeDocument();
    doc.xrayAnnotations[1] = { ...doc.xrayAnnotations[1]!, ambiguousOptions: ['12 мм'] };
    expect(ikGuideDocumentSchema.safeParse(doc).success).toBe(false);
  });
});

describe('anti-hallucination helpers', () => {
  it('uses 0.95 as the confidence threshold', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.95);
    expect(isAnnotationTrusted({ ...makeDocument().xrayAnnotations[0]!, confidence: 0.95 })).toBe(true);
    expect(isAnnotationTrusted({ ...makeDocument().xrayAnnotations[0]!, confidence: 0.949 })).toBe(false);
  });

  it('lists only unconfirmed low-confidence annotations', () => {
    const doc = makeDocument();
    const unconfirmed = getUnconfirmedAnnotations(doc);
    expect(unconfirmed.map((annotation) => annotation.id)).toEqual(['a-thread']);
    expect(hasBlockingUncertainty(doc)).toBe(true);
  });

  it('confirms an annotation and stores the human value', () => {
    const doc = makeDocument();
    const confirmed = toggleAnnotationConfirmation(doc, 'a-thread', '18 мм');
    const annotation = confirmed.xrayAnnotations.find((item) => item.id === 'a-thread');
    expect(annotation?.confirmedByHuman).toBe(true);
    expect(getEffectiveAnnotationValue(annotation!)).toBe('18 мм');
    expect(getUnconfirmedAnnotations(confirmed)).toEqual([]);
    expect(hasBlockingUncertainty(confirmed)).toBe(false);
  });

  it('toggles confirmation back off', () => {
    const doc = makeDocument();
    const confirmed = toggleAnnotationConfirmation(doc, 'a-rough');
    expect(confirmed.xrayAnnotations.find((item) => item.id === 'a-rough')?.confirmedByHuman).toBe(false);
  });

  it('reports document statistics', () => {
    const doc = makeDocument();
    const stats = documentStats(doc);
    expect(stats.stepCount).toBe(2);
    expect(stats.totalMinutes).toBe(6);
    expect(stats.qcItemCount).toBe(2);
    expect(stats.annotationCount).toBe(3);
    expect(stats.unconfirmedCount).toBe(1);
    expect(stats.confidenceAverage).toBeGreaterThan(0.7);
    expect(stats.difficulty).toBe('medium');
  });
});

describe('document io and step utilities', () => {
  it('round-trips through serialise and parse', () => {
    const doc = makeDocument();
    const json = serializeDocument(doc);
    const restored = parseDocumentJson(json);
    expect(restored).toEqual(doc);
    expect(json.endsWith('\n')).toBe(true);
  });

  it('throws a readable Russian error for broken JSON', () => {
    expect(() => parseDocumentJson('{broken')).toThrow(DocumentValidationError);
    try {
      parseDocumentJson('{broken');
    } catch (error) {
      expect((error as DocumentValidationError).issues[0]).toContain('JSON повреждён');
    }
  });

  it('lists human readable issues for an invalid document', () => {
    const doc = makeDocument();
    const broken = { ...doc, metadata: { ...doc.metadata, title: '' } };
    try {
      parseDocument(broken);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentValidationError);
      const issues = (error as DocumentValidationError).issues;
      expect(issues.some((issue) => issue.includes('metadata.title'))).toBe(true);
    }
  });

  it('renumbers steps after reordering', () => {
    const doc = makeDocument();
    const moved = moveStep(doc.steps, 1, 0);
    expect(moved.map((step) => step.id)).toEqual(['step-2', 'step-1']);
    expect(moved.map((step) => step.number)).toEqual([1, 2]);
  });

  it('ignores out-of-range step moves', () => {
    const doc = makeDocument();
    const unchanged = moveStep(doc.steps, 0, 5);
    expect(unchanged.map((step) => step.number)).toEqual([1, 2]);
    expect(unchanged).not.toBe(doc.steps);
  });

  it('renumbers arbitrary arrays', () => {
    const doc = makeDocument();
    const renumbered = renumberSteps([{ ...doc.steps[1]!, number: 7 }, { ...doc.steps[0]!, number: 9 }]);
    expect(renumbered.map((step) => step.number)).toEqual([1, 2]);
  });

  it('creates a valid draft step with sane defaults', () => {
    const step = createStepDraft({ id: 's', number: 1, title: 'Шаг', workerText: 'Сделайте что-то понятное.', illustrationId: 'art' });
    expect(step.antiError).toBeNull();
    expect(step.criticalChecks).toEqual([]);
    expect(step.estimatedMinutes).toBe(3);
    expect(step.illustration.highlight).toEqual([]);
  });
});
