import { describe, expect, it } from 'vitest';
import { bracketDocument } from '../data/bracket';
import {
  ambiguousSizes,
  applyDimensionFix,
  lowConfidenceNotes,
  replaceToken,
  setAntiError,
  setAnnotationNote,
  setCamera,
  setChecklistText,
  setStepText,
  setTitle,
  toggleChecklistRequired,
} from './fixes';

describe('правки документа', () => {
  it('находит нечёткий размер кронштейна и предлагает варианты', () => {
    const items = ambiguousSizes(bracketDocument);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      annotationId: 'ann-dim-18',
      raw: '18',
      options: ['12 мм', '18 мм'],
    });
    expect(lowConfidenceNotes(bracketDocument).map((item) => item.annotationId)).toContain('ann-dim-18');
  });

  it('исправление размера распространяется на обозначение, шаги и чек-лист', () => {
    const fixed = applyDimensionFix(bracketDocument, 'ann-dim-18', '12 мм');
    const annotation = fixed.xrayAnnotations.find((item) => item.id === 'ann-dim-18');
    expect(annotation).toMatchObject({ raw: '12 мм', confirmedByHuman: true, confidence: 1 });
    expect(annotation?.ambiguousOptions).toBeUndefined();
    expect(ambiguousSizes(fixed)).toHaveLength(0);

    const allText = fixed.steps.map((step) => `${step.title} ${step.workerText}`).join(' ');
    expect(allText).not.toMatch(/(?<![\w.,])18(?![\w.,])/);
    expect(fixed.qcChecklist.map((item) => item.text).join(' ')).not.toContain(' 18 ');
  });

  it('не задевает числа, где «18» — часть другого размера', () => {
    expect(replaceToken('Отверстие Ø18 и полоса 180 × 18,5 мм', '18', '12')).toBe(
      'Отверстие Ø12 и полоса 180 × 18,5 мм',
    );
    // Обозначение резьбы «М18» — самостоятельный размер, а не «18» из выноски.
    expect(replaceToken('М18-6H', '18', '12')).toBe('М18-6H');
  });

  it('подтверждение вторым вариантом оставляет значение как есть', () => {
    const fixed = applyDimensionFix(bracketDocument, 'ann-dim-18', '18 мм');
    expect(fixed.xrayAnnotations.find((item) => item.id === 'ann-dim-18')?.resolvedValue).toBe('18 мм');
    expect(ambiguousSizes(fixed)).toHaveLength(0);
  });

  it('текст шага меняется, а пустой текст не ломает документ', () => {
    const step = bracketDocument.steps[0]!;
    const fixed = setStepText(bracketDocument, step.id, 'Новый понятный текст шага');
    expect(fixed.steps[0]?.workerText).toBe('Новый понятный текст шага');
    expect(setStepText(bracketDocument, step.id, '  ')).toBe(bracketDocument);
  });

  it('«Осторожно!» добавляется и снимается', () => {
    const step = bracketDocument.steps[1]!;
    const added = setAntiError(bracketDocument, step.id, 'Не прижимайте пальцы под сверлом.');
    expect(added.steps[1]?.antiError).toEqual({ text: 'Не прижимайте пальцы под сверлом.', severity: 'warning' });
    const removed = setAntiError(added, step.id, null);
    expect(removed.steps[1]?.antiError).toBeNull();
  });

  it('ракурс 3D-схемы клампится в допустимый диапазон', () => {
    const step = bracketDocument.steps[0]!;
    const turned = setCamera(bracketDocument, step.id, 400, 120);
    expect(turned.steps[0]?.cameraView).toEqual({ azimuth: 360, elevation: 89 });
  });

  it('название, расшифровка и чек-лист правятся точечно', () => {
    expect(setTitle(bracketDocument, '  Новое имя  ').metadata.title).toBe('Новое имя');
    expect(setTitle(bracketDocument, '   ').metadata.title).toBe(bracketDocument.metadata.title);

    const annotationId = bracketDocument.xrayAnnotations[0]!.id;
    const noted = setAnnotationNote(bracketDocument, annotationId, 'Отверстие под палец, развёртка 20,02');
    expect(noted.xrayAnnotations[0]?.note).toBe('Отверстие под палец, развёртка 20,02');

    const itemId = bracketDocument.qcChecklist[0]!.id;
    const edited = setChecklistText(bracketDocument, itemId, 'Проверить калибром-пробкой');
    expect(edited.qcChecklist[0]?.text).toBe('Проверить калибром-пробкой');
    const toggled = toggleChecklistRequired(bracketDocument, itemId);
    expect(toggled.qcChecklist[0]?.required).toBe(!bracketDocument.qcChecklist[0]!.required);
  });
});
