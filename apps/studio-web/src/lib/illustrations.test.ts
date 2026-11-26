import { describe, expect, it } from 'vitest';
import { bracketDocument, DEMO_PROJECTS } from '../data/demos';
import { buildIllustrations, coverSvg, step3dSvg } from './illustrations';
import { setCamera } from './fixes';

describe('схемы для PDF', () => {
  it('у каждого шага всех трёх примеров есть векторная схема', () => {
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

  it('2D-схемы рисует арт-реестр, 3D-схемы — геометрия сборки', () => {
    const twoD = buildIllustrations(bracketDocument);
    const first = bracketDocument.steps[0]!;
    expect(twoD.steps[first.id]?.svg).toContain('svg');
    expect(twoD.steps[first.id]?.caption).toContain(first.title);

    const threeD = DEMO_PROJECTS.find((project) => project.id === 'demo-up08-3d')!.document;
    expect(threeD.assembly3d).toBeDefined();
    const step = threeD.steps[0]!;
    const svg = step3dSvg(threeD, step);
    expect(svg).toMatch(/^<svg/);
    // активные детали подписаны синим акцентом IKEA
    expect(svg?.toLowerCase()).toContain('#007aff');
  });

  it('смена ракурса действительно меняет картинку', () => {
    const doc = DEMO_PROJECTS.find((project) => project.id === 'demo-up08-3d')!.document;
    const step = doc.steps[0]!;
    const before = step3dSvg(doc, step)!;
    const turned = setCamera(doc, step.id, -60, 10);
    const after = step3dSvg(turned, turned.steps[0]!)!;
    expect(after).not.toBe(before);
    expect(buildIllustrations(turned).steps[step.id]?.svg).toBe(after);
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

  it('титул 3D-документа — сборка, 2D — лист чертежа', () => {
    const twoD = coverSvg(bracketDocument);
    expect(twoD).toMatch(/^<svg/);
    const threeD = DEMO_PROJECTS.find((project) => project.id === 'demo-up08-3d')!;
    expect(coverSvg(threeD.document)).toMatch(/^<svg/);
  });
});
