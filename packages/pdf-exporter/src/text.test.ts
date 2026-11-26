import { describe, expect, it } from 'vitest';
import { blockHeight, ellipsize, lineHeight, measureText, PT_MM, wrapText } from './text';

describe('измерние текста', () => {
  it('мерит кириллицу и латиницу в миллиметрах, а не в попугаях', () => {
    const cyrillic = measureText('Кронштейн', 10);
    const latin = measureText('Kronshtein', 10);
    expect(cyrillic).toBeGreaterThan(10);
    expect(cyrillic).toBeLessThan(40);
    expect(latin).toBeGreaterThan(10);
    // Кегль вдвое больше — строка вдвое шире.
    expect(measureText('Кронштейн', 20) / cyrillic).toBeCloseTo(2, 5);
  });

  it('знает, что жирное начертание шире обычного', () => {
    expect(measureText('Инструкция', 10, 'bold')).toBeGreaterThan(measureText('Инструкция', 10, 'normal'));
  });

  it('считает Ø, ±, °, × и №, а не выбрасывает их', () => {
    const withSymbols = measureText('Ø20 H7 ±0,5 ° × №', 10);
    expect(withSymbols).toBeGreaterThan(measureText('20 H7 05', 10));
  });

  it('переводит пункты в миллиметры честно', () => {
    expect(PT_MM).toBeCloseTo(0.3528, 4);
    expect(lineHeight(10)).toBeCloseTo(10 * PT_MM * 1.28, 6);
    expect(blockHeight(['a', 'b'], 10)).toBeCloseTo(lineHeight(10) * 2, 6);
  });
});

describe('перенос строк', () => {
  it('не выпускает строку за отведённую ширину', () => {
    const width = 60;
    const lines = wrapText(
      'Возьмите полосу 120 × 80 × 12 мм, зачистите поверхность и проверьте деталь на плите: коробление больше 0,5 мм — брак заготовки.',
      width,
      9,
    );
    expect(lines.length).toBeGreaterThan(2);
    lines.forEach((line) => expect(measureText(line, 9)).toBeLessThanOrEqual(width + 0.001));
  });

  it('режет слово без пробелов, чтобы оно не выехало в поля', () => {
    const lines = wrapText('Сверхдлинноесловобезпробеловвообще', 20, 10);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((line) => expect(measureText(line, 10)).toBeLessThanOrEqual(20.001));
  });

  it('сохраняет явные переносы строк', () => {
    expect(wrapText('первая\nвторая\n\nтретья', 100, 9)).toEqual(['первая', 'вторая', '', 'третья']);
  });

  it('не оставляет пустых хвостов', () => {
    expect(wrapText('одна строка\n\n\n', 100, 9)).toEqual(['одна строка']);
  });

  it('обрезает подпись по ширине и ставит многоточие', () => {
    const short = ellipsize('коротко', 40, 8);
    expect(short).toBe('коротко');
    const long = ellipsize('очень длинная подпись под схемой шага', 30, 8);
    expect(long.endsWith('…')).toBe(true);
    expect(measureText(long, 8)).toBeLessThanOrEqual(30.001);
  });
});
