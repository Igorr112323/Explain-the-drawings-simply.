import {
  IKGuide_SCHEMA_VERSION,
  ikGuideDocumentSchema,
  stepSchema,
  type GuideStep,
  type IkGuideDocument,
  type XrayAnnotation,
} from './schema';

/** Anything recognised with lower confidence must be confirmed by a human before it reaches the shop floor. */
export const CONFIDENCE_THRESHOLD = 0.95;

export function isAnnotationTrusted(annotation: XrayAnnotation): boolean {
  return annotation.confidence >= CONFIDENCE_THRESHOLD || annotation.confirmedByHuman;
}

/** Annotations that still need a one-tap confirmation from the worker or engineer. */
export function getUnconfirmedAnnotations(doc: IkGuideDocument): XrayAnnotation[] {
  return doc.xrayAnnotations.filter(
    (annotation) => annotation.confidence < CONFIDENCE_THRESHOLD && !annotation.confirmedByHuman,
  );
}

/** Value the worker should trust: the human-corrected value wins over the OCR guess. */
export function getEffectiveAnnotationValue(annotation: XrayAnnotation): string {
  return annotation.resolvedValue ?? annotation.raw;
}

export function hasBlockingUncertainty(doc: IkGuideDocument): boolean {
  return getUnconfirmedAnnotations(doc).length > 0;
}

export interface DocumentStats {
  stepCount: number;
  totalMinutes: number;
  bomLineCount: number;
  partQuantity: number;
  toolCount: number;
  qcItemCount: number;
  annotationCount: number;
  unconfirmedCount: number;
  confidenceAverage: number;
  difficulty: IkGuideDocument['metadata']['difficulty'];
}

export function documentStats(doc: IkGuideDocument): DocumentStats {
  const totalMinutes = doc.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const annotationCount = doc.xrayAnnotations.length;
  const confidenceSum = doc.xrayAnnotations.reduce((sum, annotation) => sum + annotation.confidence, 0);

  return {
    stepCount: doc.steps.length,
    totalMinutes,
    bomLineCount: doc.bom.length,
    partQuantity: doc.bom.reduce((sum, item) => sum + item.quantity, 0),
    toolCount: doc.tools.length,
    qcItemCount: doc.qcChecklist.length,
    annotationCount,
    unconfirmedCount: getUnconfirmedAnnotations(doc).length,
    confidenceAverage: annotationCount === 0 ? 1 : Number((confidenceSum / annotationCount).toFixed(3)),
    difficulty: doc.metadata.difficulty,
  };
}

export function serializeDocument(doc: IkGuideDocument): string {
  const parsed = ikGuideDocumentSchema.parse(doc);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export class DocumentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Файл инструкции не прошёл проверку:\n${issues.map((issue) => `• ${issue}`).join('\n')}`);
    this.name = 'DocumentValidationError';
    this.issues = issues;
  }
}

export function parseDocument(input: unknown): IkGuideDocument {
  const result = ikGuideDocumentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    });
    throw new DocumentValidationError(issues);
  }
  return result.data;
}

export function parseDocumentJson(json: string): IkGuideDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new DocumentValidationError(['JSON повреждён: файл не удалось прочитать']);
  }
  return parseDocument(raw);
}

/** Re-numbers steps 1..N and keeps them sorted; used after reordering or deletion. */
export function renumberSteps(steps: readonly GuideStep[]): GuideStep[] {
  return steps.map((step, index) => ({ ...step, number: index + 1 }));
}

export function moveStep(steps: readonly GuideStep[], fromIndex: number, toIndex: number): GuideStep[] {
  if (fromIndex < 0 || fromIndex >= steps.length || toIndex < 0 || toIndex >= steps.length || fromIndex === toIndex) {
    return steps.map((step) => ({ ...step }));
  }
  const next = steps.map((step) => ({ ...step }));
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return next;
  }
  next.splice(toIndex, 0, moved);
  return renumberSteps(next);
}

export interface StepDraftInput {
  id: string;
  title: string;
  workerText: string;
  illustrationId: string;
  number: number;
}

/** Creates a structurally valid step; used by the engineer studio when adding a step. */
export function createStepDraft(input: StepDraftInput): GuideStep {
  return stepSchema.parse({
    id: input.id,
    number: input.number,
    title: input.title,
    workerText: input.workerText,
    estimatedMinutes: 3,
    illustration: { illustrationId: input.illustrationId, highlight: [], arrows: [] },
    antiError: null,
    criticalChecks: [],
    drawingRefs: [],
  });
}

export function createEmptyDocument(id: string, now: string = new Date().toISOString()): IkGuideDocument {
  return ikGuideDocumentSchema.parse({
    schemaVersion: IKGuide_SCHEMA_VERSION,
    id,
    metadata: {
      title: 'Новая инструкция',
      drawingCode: 'БЕЗ-ШИФРА',
      material: 'Не указан',
      blankDimensions: 'Не указаны',
      difficulty: 'medium',
      author: 'Инженер',
      createdAt: now,
      revision: 'A',
    },
    drawing: { viewId: 'generic-sheet', sheetFormat: 'A4', scale: '1:1' },
    bom: [
      {
        id: 'bom-blank',
        name: 'Заготовка',
        size: 'по чертежу',
        quantity: 1,
        kind: 'raw',
        icon: 'plate',
      },
    ],
    tools: [
      {
        id: 'tool-caliper',
        name: 'Штангенциркуль',
        size: '0–150 мм, 0,05 мм',
        category: 'caliper',
        purpose: 'Контроль размеров на каждом шаге',
        forSteps: [1],
      },
    ],
    steps: [createStepDraft({ id: 'step-1', number: 1, title: 'Осмотрите заготовку', workerText: 'Проверьте заготовку на забоины, трещины и следы коррозии. Отложите деталь в сторону, если есть повреждения.', illustrationId: 'generic-step' })],
    xrayAnnotations: [],
    qcChecklist: [
      {
        id: 'qc-1',
        text: 'Все размеры соответствуют чертежу',
        required: true,
      },
    ],
  });
}

export function toggleAnnotationConfirmation(doc: IkGuideDocument, annotationId: string, resolvedValue?: string): IkGuideDocument {
  return {
    ...doc,
    xrayAnnotations: doc.xrayAnnotations.map((annotation) => {
      if (annotation.id !== annotationId) {
        return annotation;
      }
      return {
        ...annotation,
        confirmedByHuman: !annotation.confirmedByHuman,
        ...(resolvedValue !== undefined && resolvedValue.length > 0 ? { resolvedValue } : {}),
      };
    }),
  };
}
