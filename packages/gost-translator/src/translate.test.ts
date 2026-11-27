import { describe, expect, it } from 'vitest';
import { TRANSLATOR_VERSION, translateEngineeringNotation, translateMany } from './translate';
import { getSupportedZoneFields } from './tables/fits';

describe('translateEngineeringNotation dispatcher', () => {
  it('routes every supported notation family to its own kind', () => {
    expect(translateEngineeringNotation('М8-7H').kind).toBe('thread');
    expect(translateEngineeringNotation('Ø20 H7').kind).toBe('fit');
    expect(translateEngineeringNotation('Ra 1.6').kind).toBe('roughness');
    expect(translateEngineeringNotation('Т1-К5').kind).toBe('weld');
    expect(translateEngineeringNotation('36').kind).toBe('dimension');
    expect(translateEngineeringNotation('12').kind).toBe('dimension');
    expect(translateEngineeringNotation('К5').kind).toBe('weld');
    expect(translateEngineeringNotation('катет 6').kind).toBe('weld');
    expect(translateEngineeringNotation('2×45°').kind).toBe('chamfer');
    expect(translateEngineeringNotation('R3').kind).toBe('radius');
    expect(translateEngineeringNotation('4 отв. Ø6,5').kind).toBe('holeGroup');
    expect(translateEngineeringNotation('120±0,5').kind).toBe('dimension');
  });

  it('keeps the original raw string and normalises the separators', () => {
    const result = translateEngineeringNotation('  ⌀20   H7 ');
    expect(result.raw).toBe('  ⌀20   H7 ');
    expect(result.normalized).toBe('Ø20 H7');
    expect(result.kind).toBe('fit');
  });

  it('returns a helpful unknown result for empty input', () => {
    const result = translateEngineeringNotation('   ');
    expect(result.kind).toBe('unknown');
    expect(result.standard).toBeNull();
    expect(result.explanation).toContain('Пустое обозначение');
    expect(result.tools).toEqual([]);
  });

  it('returns a helpful unknown result for garbage', () => {
    const result = translateEngineeringNotation('смотри сюда');
    expect(result.kind).toBe('unknown');
    expect(result.explanation).toContain('Формат не распознан');
    expect(result.explanation).toContain('Ø20 H7');
  });

  it('is deterministic: the same input always gives the same output', () => {
    const first = JSON.stringify(translateEngineeringNotation('4 отв. М8-7H глуб. 20'));
    const second = JSON.stringify(translateEngineeringNotation('4 отв. М8-7H глуб. 20'));
    expect(first).toBe(second);
  });

  it('collects several translations at once', () => {
    const results = translateMany(['Ø20 H7', 'Ra 1.6', 'Т1-К5']);
    expect(results.map((result) => result.kind)).toEqual(['fit', 'roughness', 'weld']);
  });

  it('exposes the translator version and the supported fields', () => {
    expect(TRANSLATOR_VERSION).toBe('1.0.0');
    const fields = getSupportedZoneFields();
    expect(fields.holes).toEqual(expect.arrayContaining(['H6', 'H7', 'H11', 'JS7']));
    expect(fields.shafts).toEqual(expect.arrayContaining(['h6', 'k6', 'js7', 'g6', 'f7', 'd9']));
  });

  it('produces a non-empty explanation and worker advice for every known kind', () => {
    const samples = ['М8-7H', 'Ø32 H7/k6', 'Ra 0.8', 'У4-К4', '2×45°', 'R3', '4 отв. Ø6,5', '120±0,5'];
    for (const sample of samples) {
      const result = translateEngineeringNotation(sample);
      expect(result.kind, sample).not.toBe('unknown');
      expect(result.explanation.length, sample).toBeGreaterThan(40);
      expect(result.workerAdvice.length, sample).toBeGreaterThan(20);
      expect(result.standard, sample).not.toBeNull();
    }
  });
});
