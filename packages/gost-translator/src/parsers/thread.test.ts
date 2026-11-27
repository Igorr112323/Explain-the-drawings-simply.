import { describe, expect, it } from 'vitest';
import { translateEngineeringNotation } from '../translate';
import { parseThread } from './thread';

describe('metric thread parser (GOST 24705 / GOST 19257)', () => {
  it('translates a plain M8 callout with coarse pitch and tap drill 6,8', () => {
    const result = parseThread('М8');
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.kind).toBe('thread');
    expect(result.diameterMm).toBe(8);
    expect(result.pitchMm).toBe(1.25);
    expect(result.pitchKind).toBe('coarse');
    expect(result.tapDrillMm).toBe(6.8);
    expect(result.tapDrillRangeMm).toEqual([6.7, 6.8]);
    expect(result.clearanceHoleMm).toBe(9);
    expect(result.wrenchSizeMm).toBe(13);
    expect(result.threadKind).toBe('unspecified');
    expect(result.recommendedEngagementMm).toBe(12);
    expect(result.explanation).toContain('метрическая резьба');
    expect(result.tools.some((tool) => tool.category === 'tap')).toBe(true);
    expect(result.warnings.join(' ')).toContain('Поле допуска');
  });

  it('detects internal thread 7H and keeps the tap drill', () => {
    const result = parseThread('М8-7H');
    expect(result?.threadKind).toBe('internal');
    expect(result?.toleranceClass).toBe('7H');
    expect(result?.tapDrillMm).toBe(6.8);
    expect(result?.designation).toBe('М8-7H');
  });

  it('parses a fine pitch M10×1,25 with its own tap drill', () => {
    const result = parseThread('М10×1,25');
    expect(result?.pitchMm).toBe(1.25);
    expect(result?.pitchKind).toBe('fine');
    expect(result?.tapDrillMm).toBe(8.8);
    expect(result?.designation).toBe('М10×1,25');
    expect(result?.warnings.join(' ')).not.toContain('не входит в таблицу');
  });

  it('handles a hole group with depth: «4 отв. М6-7H глуб. 15»', () => {
    const result = parseThread('4 отв. М6-7H глуб. 15');
    expect(result?.holeCount).toBe(4);
    expect(result?.threadDepthMm).toBe(15);
    expect(result?.threadKind).toBe('internal');
    expect(result?.tapDrillMm).toBe(5);
    expect(result?.clearanceHoleMm).toBe(6.6);
    expect(result?.wrenchSizeMm).toBe(10);
    expect(result?.explanation).toContain('Отверстий в группе: 4');
  });

  it('warns when the thread depth is shorter than the recommended engagement', () => {
    const result = parseThread('М8-7H глуб. 6');
    expect(result?.warnings.join(' ')).toContain('меньше рекомендуемых');
  });

  it('recognises external thread 6g and does not offer a tap drill', () => {
    const result = parseThread('М12-6g');
    expect(result?.threadKind).toBe('external');
    expect(result?.tapDrillMm).toBeNull();
    expect(result?.blankRodMm).toBe(11.7);
    expect(result?.wrenchSizeMm).toBe(19);
    expect(result?.tools.some((tool) => tool.category === 'die')).toBe(true);
  });

  it('treats an explicit pitch equal to the coarse one as coarse', () => {
    const result = parseThread('М5×0,8');
    expect(result?.pitchKind).toBe('coarse');
    expect(result?.tapDrillMm).toBe(4.2);
  });

  it('flags a non-standard pitch but still computes the drill', () => {
    const result = parseThread('М8×0,6');
    expect(result?.pitchKind).toBe('fine');
    expect(result?.tapDrillMm).toBe(7.4);
    expect(result?.warnings.join(' ')).toContain('не входит в таблицу стандартных мелких шагов');
  });

  it('falls back to an honest unknown result for M35 (outside the built-in table)', () => {
    const result = translateEngineeringNotation('М35');
    expect(result.kind).toBe('unknown');
    expect(result.explanation).toContain('резьбы');
  });

  it('accepts Latin M and a dot as the decimal separator', () => {
    const result = parseThread('M10x1.5');
    expect(result?.pitchMm).toBe(1.5);
    expect(result?.pitchKind).toBe('coarse');
  });

  it('returns null for text without a metric thread prefix', () => {
    expect(parseThread('Ø20 H7')).toBeNull();
    expect(parseThread('Ra 1.6')).toBeNull();
  });

  it('rejects threads that cannot exist and never emits a negative tap drill', () => {
    // Найдено фаззингом 2 600 строк ГОСТ: «М0×1,25-6H» давало сверло Ø−1,3 мм,
    // «М20×29-6H» — шаг 29 мм, «М920×2-6H» — резьбу на 920 мм.
    for (const input of ['М0', 'М0×1,25-6H', 'М1×1,25-6H', 'М20×29-6H', 'М920×2-6H', 'М601']) {
      const parsed = parseThread(input);
      expect(parsed, input).toBeNull();
      const translated = translateEngineeringNotation(input);
      expect(translated.kind, input).not.toBe('thread');
    }
  });

  it('keeps the tap drill strictly inside the thread diameter', () => {
    for (const input of ['М1', 'М3×0,35-6H', 'М6-7H', 'М12-6H', 'М30×2-6H', 'М64×4-6H']) {
      const parsed = parseThread(input);
      expect(parsed, input).not.toBeNull();
      if (!parsed) continue;
      expect(parsed.tapDrillMm, input).toBeGreaterThan(0);
      expect(parsed.tapDrillMm, input).toBeLessThan(parsed.diameterMm);
      for (const tool of parsed.tools) {
        const match = /(\d+(?:[.,]\d+)?)\s*мм/.exec(tool.name);
        if (match) {
          expect(Number(match[1]?.replace(',', '.')), `${input} → ${tool.name}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
