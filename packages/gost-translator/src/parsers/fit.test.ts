import { describe, expect, it } from 'vitest';
import { translateEngineeringNotation } from '../translate';
import { parseFit } from './fit';

describe('tolerances and fits (GOST 25346 / ISO 286)', () => {
  it('resolves a hole H7 Ø20 with exact micrometre limits', () => {
    const result = parseFit('Ø20 H7');
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.kind).toBe('fit');
    expect(result.nominalMm).toBe(20);
    expect(result.zone.field).toBe('H7');
    expect(result.zone.zoneKind).toBe('hole');
    expect(result.zone.lowerUm).toBe(0);
    expect(result.zone.upperUm).toBe(21);
    expect(result.zone.toleranceUm).toBe(21);
    expect(result.zone.minSizeMm).toBe(20);
    expect(result.zone.maxSizeMm).toBe(20.021);
    expect(result.fitKind).toBeNull();
    expect(result.pair).toBeNull();
    expect(result.tools.some((tool) => tool.category === 'reamer')).toBe(true);
    expect(result.tools.some((tool) => tool.category === 'gauge')).toBe(true);
    expect(result.workerAdvice).toContain('развёрткой');
  });

  it('resolves a shaft h6 of 50 mm (upper deviation 0, lower −16 µm)', () => {
    const result = parseFit('50 h6');
    expect(result?.zone.field).toBe('h6');
    expect(result?.zone.zoneKind).toBe('shaft');
    expect(result?.zone.upperUm).toBe(0);
    expect(result?.zone.lowerUm).toBe(-16);
    expect(result?.zone.minSizeMm).toBe(49.984);
    expect(result?.zone.maxSizeMm).toBe(50);
    expect(result?.tools.some((tool) => tool.category === 'micrometer')).toBe(true);
  });

  it('builds a transition fit Ø32 H7/k6 with 23 µm max clearance and 18 µm max interference', () => {
    const result = parseFit('Ø32 H7/k6');
    expect(result?.pair).not.toBeNull();
    const pair = result?.pair;
    if (!pair) return;

    expect(pair.hole.field).toBe('H7');
    expect(pair.hole.lowerUm).toBe(0);
    expect(pair.hole.upperUm).toBe(25);
    expect(pair.shaft.field).toBe('k6');
    expect(pair.shaft.lowerUm).toBe(2);
    expect(pair.shaft.upperUm).toBe(18);
    expect(pair.fitKind).toBe('transition');
    expect(result?.fitKind).toBe('transition');
    expect(pair.maxClearanceUm).toBe(23);
    expect(pair.minClearanceUm).toBe(-18);
    expect(result?.explanation).toContain('переходная посадка');
  });

  it('detects a pure clearance pair Ø50 H7/g6', () => {
    const result = parseFit('Ø50 H7/g6');
    expect(result?.pair?.fitKind).toBe('clearance');
    expect(result?.pair?.maxClearanceUm).toBe(50);
    expect(result?.pair?.minClearanceUm).toBe(9);
  });

  it('resolves symmetric JS7 at Ø16', () => {
    const result = parseFit('Ø16 JS7');
    expect(result?.zone.zoneKind).toBe('hole');
    expect(result?.zone.lowerUm).toBe(-9);
    expect(result?.zone.upperUm).toBe(9);
    expect(result?.zone.minSizeMm).toBe(15.991);
    expect(result?.zone.maxSizeMm).toBe(16.009);
  });

  it('resolves a coarse hole H11 at 12 mm', () => {
    const result = parseFit('12 H11');
    expect(result?.zone.upperUm).toBe(110);
    expect(result?.zone.lowerUm).toBe(0);
    expect(result?.tools.some((tool) => tool.category === 'caliper')).toBe(true);
  });

  it('resolves running fits f7 and g6 with exact values', () => {
    const f7 = parseFit('Ø25 f7');
    expect(f7?.zone.upperUm).toBe(-20);
    expect(f7?.zone.lowerUm).toBe(-41);
    expect(f7?.zone.minSizeMm).toBe(24.959);
    expect(f7?.zone.maxSizeMm).toBe(24.98);

    const g6 = parseFit('Ø40 g6');
    expect(g6?.zone.upperUm).toBe(-9);
    expect(g6?.zone.lowerUm).toBe(-25);
  });

  it('resolves d9 at Ø20', () => {
    const result = parseFit('Ø20 d9');
    expect(result?.zone.upperUm).toBe(-65);
    expect(result?.zone.lowerUm).toBe(-117);
    expect(result?.zone.toleranceUm).toBe(52);
  });

  it('resolves H14 for a rough dimension at 100 mm', () => {
    const result = parseFit('100 H14');
    expect(result?.zone.upperUm).toBe(870);
  });

  it('switches nominal ranges at the boundary values 3 and 30', () => {
    expect(parseFit('3 H7')?.zone.upperUm).toBe(10);
    expect(parseFit('30 H7')?.zone.upperUm).toBe(21);
    expect(parseFit('30,5 H7')?.zone.upperUm).toBe(25);
  });

  it('supports a comma as the decimal separator', () => {
    const result = parseFit('Ø20,5 H7');
    expect(result?.nominalMm).toBe(20.5);
    expect(result?.zone.maxSizeMm).toBe(20.521);
  });

  it('reports unsupported fields as unknown instead of inventing numbers', () => {
    const result = translateEngineeringNotation('Ø20 K7');
    expect(result.kind).toBe('unknown');
    expect(result.explanation).toContain('ГОСТ 25346');
  });

  it('does not swallow plain roughness or threads', () => {
    expect(parseFit('Ra 1.6')).toBeNull();
    expect(parseFit('М8-7H')).toBeNull();
    expect(parseFit('20')).toBeNull();
  });
});
