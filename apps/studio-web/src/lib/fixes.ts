/**
 * Правки документа из интерфейса — чистые функции без React.
 *
 * Главный сценарий: распознавание не уверено в размере (например, «12» или «18» на выноске).
 * Один клик по варианту должен исправить документ целиком — обозначение, текст шагов, критерии
 * приёмки и чек-лист, — поэтому замена идёт по всему документу, а не только по аннотации.
 */
import type { GuideStep, IkGuideDocument, XrayAnnotation } from '@ikguide/schema';

/** Порог, ниже которого размер считается «нечётким» и требует подтверждения. */
export const CONFIDENCE_THRESHOLD = 0.95;

export interface AmbiguousSize {
  annotationId: string;
  raw: string;
  options: string[];
  confidence: number;
}

function isAmbiguous(annotation: XrayAnnotation): boolean {
  return !annotation.confirmedByHuman && (annotation.ambiguousOptions?.length ?? 0) >= 2;
}

/** Все размеры, где распознавание колебалось: их показывает жёлтая плашка. */
export function ambiguousSizes(doc: IkGuideDocument): AmbiguousSize[] {
  return doc.xrayAnnotations
    .filter(isAmbiguous)
    .map((annotation) => ({
      annotationId: annotation.id,
      raw: annotation.raw,
      options: annotation.ambiguousOptions ?? [annotation.raw],
      confidence: annotation.confidence,
    }));
}

/** Нечёткие обозначения, оставшиеся без подтверждения (жёлтая плашка в шапке). */
export function lowConfidenceNotes(doc: IkGuideDocument): AmbiguousSize[] {
  return doc.xrayAnnotations
    .filter((annotation) => annotation.confidence < CONFIDENCE_THRESHOLD && !annotation.confirmedByHuman)
    .map((annotation) => ({
      annotationId: annotation.id,
      raw: annotation.raw,
      options: annotation.ambiguousOptions ?? [annotation.raw],
      confidence: annotation.confidence,
    }));
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Заменяет обозначение как отдельный токен: «12» не должно превращать «120» в «180»,
 * а «Ø20» — задевать «Ø200».
 */
export function replaceToken(text: string, from: string, to: string): string {
  if (!from || from === to) {
    return text;
  }
  const pattern = new RegExp(`(?<![\\wА-Яа-яЁё.,])${escapeForRegex(from)}(?![\\wА-Яа-яЁё.,])`, 'g');
  return text.replace(pattern, to);
}

function mapSteps(doc: IkGuideDocument, mapper: (step: GuideStep) => GuideStep): GuideStep[] {
  return doc.steps.map(mapper);
}

/** Подтверждает нечёткий размер выбранным вариантом и правит его во всех шагах и чек-листе. */
export function applyDimensionFix(doc: IkGuideDocument, annotationId: string, chosen: string): IkGuideDocument {
  const annotation = doc.xrayAnnotations.find((item) => item.id === annotationId);
  if (!annotation) {
    return doc;
  }
  const from = annotation.resolvedValue ?? annotation.raw;
  const to = chosen.trim();
  if (to.length === 0) {
    return doc;
  }

  const annotations = doc.xrayAnnotations.map((item) =>
    item.id === annotationId
      ? { ...item, raw: to, resolvedValue: to, confirmedByHuman: true, confidence: 1, ambiguousOptions: undefined }
      : { ...item, raw: replaceToken(item.raw, from, to) },
  );

  const steps = mapSteps(doc, (step) => ({
    ...step,
    title: replaceToken(step.title, from, to),
    workerText: replaceToken(step.workerText, from, to),
    antiError: step.antiError ? { ...step.antiError, text: replaceToken(step.antiError.text, from, to) } : null,
    criticalChecks: step.criticalChecks.map((check) => ({
      ...check,
      label: replaceToken(check.label, from, to),
      nominal: replaceToken(check.nominal, from, to),
      acceptance: replaceToken(check.acceptance, from, to),
    })),
  }));

  return {
    ...doc,
    xrayAnnotations: annotations,
    steps,
    bom: doc.bom.map((item) => ({ ...item, size: replaceToken(item.size, from, to) })),
    tools: doc.tools.map((tool) => ({ ...tool, size: tool.size ? replaceToken(tool.size, from, to) : tool.size })),
    qcChecklist: doc.qcChecklist.map((item) => ({ ...item, text: replaceToken(item.text, from, to) })),
  };
}

/** Ручная расшифровка переводчиком ГОСТ: сохраняется в аннотации как подтверждённая. */
export function setAnnotationValue(doc: IkGuideDocument, annotationId: string, value: string): IkGuideDocument {
  return {
    ...doc,
    xrayAnnotations: doc.xrayAnnotations.map((item) =>
      item.id === annotationId
        ? { ...item, resolvedValue: value.trim() || undefined, confirmedByHuman: true, confidence: 1 }
        : item,
    ),
  };
}

/** Правка расшифровки обозначения: попадает в «Шпаргалку по значкам и допускам» вместо автоперевода. */
export function setAnnotationNote(doc: IkGuideDocument, annotationId: string, note: string): IkGuideDocument {
  const clean = note.trim();
  return {
    ...doc,
    xrayAnnotations: doc.xrayAnnotations.map((item) =>
      item.id === annotationId ? { ...item, note: clean.length > 0 ? clean : undefined } : item,
    ),
  };
}

export function setTitle(doc: IkGuideDocument, title: string): IkGuideDocument {
  const clean = title.trim();
  return clean.length > 0 ? { ...doc, metadata: { ...doc.metadata, title: clean } } : doc;
}

export function setMeta(doc: IkGuideDocument, patch: { material?: string; drawingCode?: string }): IkGuideDocument {
  const metadata = { ...doc.metadata };
  if (patch.material !== undefined && patch.material.trim().length > 0) {
    metadata.material = patch.material.trim();
  }
  if (patch.drawingCode !== undefined && patch.drawingCode.trim().length > 0) {
    metadata.drawingCode = patch.drawingCode.trim();
  }
  return { ...doc, metadata };
}

/** Текст шага «человеческим языком»; пустую строку не применяем — иначе схема станет невалидной. */
export function setStepText(doc: IkGuideDocument, stepId: string, workerText: string): IkGuideDocument {
  const clean = workerText.trim();
  if (clean.length < 3) {
    return doc;
  }
  return { ...doc, steps: mapSteps(doc, (step) => (step.id === stepId ? { ...step, workerText: clean } : step)) };
}

export function setStepTitle(doc: IkGuideDocument, stepId: string, title: string): IkGuideDocument {
  const clean = title.trim();
  if (clean.length === 0) {
    return doc;
  }
  return { ...doc, steps: mapSteps(doc, (step) => (step.id === stepId ? { ...step, title: clean } : step)) };
}

/** «Осторожно!» можно добавить к любому шагу и так же легко убрать. */
export function setAntiError(doc: IkGuideDocument, stepId: string, text: string | null): IkGuideDocument {
  const clean = (text ?? '').trim();
  return {
    ...doc,
    steps: mapSteps(doc, (step) =>
      step.id === stepId
        ? { ...step, antiError: clean.length === 0 ? null : { text: clean, severity: 'warning' as const } }
        : step,
    ),
  };
}

/** Необязательный пункт чек-листа: галочка «требуется / по желанию». */
export function toggleChecklistRequired(doc: IkGuideDocument, itemId: string): IkGuideDocument {
  return {
    ...doc,
    qcChecklist: doc.qcChecklist.map((item) => (item.id === itemId ? { ...item, required: !item.required } : item)),
  };
}

export function setChecklistText(doc: IkGuideDocument, itemId: string, text: string): IkGuideDocument {
  const clean = text.trim();
  if (clean.length < 3) {
    return doc;
  }
  return { ...doc, qcChecklist: doc.qcChecklist.map((item) => (item.id === itemId ? { ...item, text: clean } : item)) };
}
