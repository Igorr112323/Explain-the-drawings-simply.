// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { XrayAnnotation } from '@ikguide/schema';
import { bracketDocument } from '../data/bracket';
import { cropSheet, fragmentBox, stepFragment } from './sheetFragment';

const annotation = (id: string, xPercent: number, yPercent: number): XrayAnnotation => ({
  id,
  raw: 'Ø20 H7',
  kind: 'fit',
  xPercent,
  yPercent,
  confidence: 0.99,
  confirmedByHuman: true,
});

describe('фрагменты листа чертежа', () => {
  it('обрезает лист вокруг обозначений шага, оставляя воздух', () => {
    const box = fragmentBox([annotation('a', 50, 50)]);
    expect(box.width).toBeGreaterThanOrEqual(0.28);
    expect(box.height).toBeGreaterThan(0);
    // Центр фрагмента — рядом с обозначением, границы не выходят за лист.
    expect(box.x + box.width / 2).toBeCloseTo(0.5, 1);
    expect(box.y + box.height / 2).toBeCloseTo(0.5, 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1.0001);
    expect(box.y + box.height).toBeLessThanOrEqual(1.0001);
  });

  it('держит пропорции A4 и увеличивает область до читаемого размера', () => {
    const box = fragmentBox([annotation('a', 10, 10), annotation('b', 14, 13)]);
    expect(box.width / box.height).toBeCloseTo(1.414, 1);
    // Близкие обозначения не превращаются в точку: есть минимальный размер фрагмента.
    expect(box.width).toBeGreaterThanOrEqual(0.28);
  });

  it('без обозначений берёт весь лист', () => {
    expect(fragmentBox([])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('без canvas (jsdom) аккуратно отдаёт null вместо падения', async () => {
    await expect(cropSheet('data:image/png;base64,AAAA', { x: 0, y: 0, width: 1, height: 1 })).resolves.toBeNull();
    await expect(stepFragment('data:image/png;base64,AAAA', bracketDocument.xrayAnnotations, ['ann-dim-18'])).resolves.toBeNull();
  });

  it('битая картинка не роняет конвейер', async () => {
    const original = HTMLCanvasElement.prototype.getContext;
    // Имитируем браузер с canvas, но с картинкой, которую нельзя декодировать.
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof original;
    await expect(cropSheet('data:image/png;base64,broken', { x: 0, y: 0, width: 1, height: 1 })).resolves.toBeNull();
    HTMLCanvasElement.prototype.getContext = original;
  });
});
