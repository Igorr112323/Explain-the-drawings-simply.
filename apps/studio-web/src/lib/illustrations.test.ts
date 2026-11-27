import { describe, expect, it } from 'vitest';
import { bracketDocument, DEMO_PROJECTS } from '../data/demos';
import { buildIllustrations, coverSvg } from './illustrations';

describe('схемы для PDF', () => {
  it('у каждого шага всех примеров есть векторная схема', () => {
    for (const project of DEMO_PROJECTS) {
      const illustrations = buildIllustrations(project.document);
      expect(illustrations.cover?.svg, `${project.id}: титул`).toMatch(/^<svg/);
      for (const step of project.document.steps) {
        const svg = illustrations.steps[step.id]?.svg;
        expect(svg, `${project.id} / ${step.title}`).toMatch(/^<svg/);
        expect(svg).toContain('viewBox');
        // Схема — реальная векторная графика, а не заглушка-картинка.
        expect(svg).not.toContain('<image');
      }
    }
  });

  it('схему шага рисует арт-реестр, подпись берётся из шага', () => {
    const illustrations = buildIllustrations(bracketDocument);
    const first = bracketDocument.steps[0]!;
    expect(illustrations.steps[first.id]?.svg).toContain('svg');
    expect(illustrations.steps[first.id]?.caption).toContain(first.title);
  });

  it('фрагмент настоящего листа важнее нарисованной схемы', () => {
    const step = bracketDocument.steps[0]!;
    const illustrations = buildIllustrations(bracketDocument, {
      steps: { [step.id]: 'data:image/jpeg;base64,AAAA' },
      cover: 'data:image/jpeg;base64,BBBB',
    });
    expect(illustrations.steps[step.id]).toEqual({
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
      caption: expect.any(String),
    });
    expect(illustrations.cover?.imageDataUrl).toBe('data:image/jpeg;base64,BBBB');
    // Остальные шаги по-прежнему векторные.
    const other = bracketDocument.steps[1]!;
    expect(illustrations.steps[other.id]?.svg).toMatch(/^<svg/);
  });

  it('титул 2D-документа — лист чертежа', () => {
    expect(coverSvg(bracketDocument)).toMatch(/^<svg/);
    expect(buildIllustrations(bracketDocument).cover?.caption).toBe('Общий вид по чертежу');
  });
});
