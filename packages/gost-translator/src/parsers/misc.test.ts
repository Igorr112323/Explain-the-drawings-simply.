import { describe, expect, it } from 'vitest';
import { translateEngineeringNotation } from '../translate';
import { parseChamfer, parseDimension, parseHoleGroup, parseRadius } from './misc';
import { parseRoughness } from './roughness';
import { parseWeld } from './weld';

describe('roughness (GOST 2789-73)', () => {
  it('maps Ra 1.6 to surface class 7 with finishing advice', () => {
    const result = parseRoughness('Ra 1.6');
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.parameter).toBe('Ra');
    expect(result.valueUm).toBe(1.6);
    expect(result.surfaceClass).toBe(7);
    expect(result.matchesSeries).toBe(true);
    expect(result.finishGroup).toBe('finish');
    expect(result.processing).toContain('развёртывание');
    expect(result.surfaceClassLabel).toContain('7-й класс');
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('maps Ra 0.8 to class 8 and Ra 3.2 to class 6', () => {
    expect(parseRoughness('Ra 0.8')?.surfaceClass).toBe(8);
    expect(parseRoughness('Ra 3.2')?.surfaceClass).toBe(6);
    expect(parseRoughness('Ra 12,5')?.surfaceClass).toBe(4);
    expect(parseRoughness('Ra 12,5')?.finishGroup).toBe('rough');
  });

  it('maps Rz values through the Rz series', () => {
    const result = parseRoughness('Rz 20');
    expect(result?.parameter).toBe('Rz');
    expect(result?.surfaceClass).toBe(5);
    expect(result?.raEquivalentUm).toBe(5);
  });

  it('warns about a non-standard value and picks the guaranteeing class', () => {
    const result = parseRoughness('Ra 0.9');
    expect(result?.matchesSeries).toBe(false);
    expect(result?.surfaceClass).toBe(8);
    expect(result?.warnings.join(' ')).toContain('нет в стандартном ряду');
  });

  it('requires an instrument for class 9 and finer', () => {
    const result = parseRoughness('Ra 0.2');
    expect(result?.surfaceClass).toBe(10);
    expect(result?.warnings.join(' ')).toContain('только прибором');
    expect(result?.tools.some((tool) => tool.name.includes('Профилометр'))).toBe(true);
  });

  it('returns null for impossible values and for other notations', () => {
    expect(parseRoughness('Ra 0')).toBeNull();
    expect(parseRoughness('Rz')).toBeNull();
    expect(parseRoughness('Ø20 H7')).toBeNull();
  });
});

describe('welds (GOST 5264 / GOST 2.312)', () => {
  it('translates Т1-К5 into a T-joint with 5 mm leg', () => {
    const result = parseWeld('Т1-К5');
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.jointCode).toBe('Т');
    expect(result.jointVariant).toBe(1);
    expect(result.jointName).toBe('Тавровое соединение');
    expect(result.legMm).toBe(5);
    expect(result.welderInstruction).toContain('5 мм');
    expect(result.tools.some((tool) => tool.category === 'welding')).toBe(true);
  });

  it('translates С2, У4 and Н1 through the GOST 5264 table', () => {
    expect(parseWeld('С2')?.jointName).toBe('Стыковое соединение');
    expect(parseWeld('С2')?.explanation).toContain('без скоса кромок');
    expect(parseWeld('У4')?.jointName).toBe('Угловое соединение');
    expect(parseWeld('Н1')?.jointName).toBe('Нахлёсточное соединение');
  });

  it('parses intermittent seams 50/100 and a closed contour', () => {
    const result = parseWeld('Т1-К6 50/100');
    expect(result?.legMm).toBe(6);
    expect(result?.seamLengthMm).toBe(50);
    expect(result?.seamPitchMm).toBe(100);
    expect(result?.explanation).toContain('прерывистый');

    const closed = parseWeld('Т1-К6 ◯');
    expect(closed?.closedContour).toBe(true);
    expect(closed?.explanation).toContain('замкнутому контуру');
  });

  it('parses flush grinding and warnings for a zero leg', () => {
    const flush = parseWeld('Т3-К4 заподлицо');
    expect(flush?.flush).toBe(true);
    expect(flush?.welderInstruction).toContain('заподлицо');

    const zeroLeg = parseWeld('Т1-К0');
    expect(zeroLeg?.warnings.join(' ')).toContain('Катет шва должен быть больше нуля');
  });

  it('accepts a bare leg designation К4 and warns about the unknown joint', () => {
    const result = parseWeld('К4');
    expect(result?.jointCode).toBeNull();
    expect(result?.legMm).toBe(4);
    expect(result?.explanation).toContain('сварного шва');
  });

  it('does not treat «50/100» as a weld without other weld symbols', () => {
    expect(parseWeld('50/100')).toBeNull();
    expect(translateEngineeringNotation('50/100').kind).toBe('unknown');
  });

  it('does not treat a fit callout as a weld', () => {
    expect(parseWeld('Ø20 H7')).toBeNull();
    expect(parseWeld('Ra 1.6')).toBeNull();
  });
});

describe('chamfers, radii, hole groups and dimensions', () => {
  it('translates 2×45° and 1,5×45°', () => {
    const chamfer = parseChamfer('2×45°');
    expect(chamfer?.legMm).toBe(2);
    expect(chamfer?.angleDeg).toBe(45);
    expect(chamfer?.notation).toBe('leg-by-angle');
    expect(chamfer?.tools.some((tool) => tool.category === 'deburr')).toBe(true);

    const small = parseChamfer('1,5×45°');
    expect(small?.legMm).toBe(1.5);
    expect(small?.explanation).toContain('1,5 мм');
  });

  it('accepts the short C-notation for a 45° chamfer', () => {
    const result = parseChamfer('C3');
    expect(result?.legMm).toBe(3);
    expect(result?.notation).toBe('C');
  });

  it('translates R3 as a fillet radius', () => {
    const result = parseRadius('R3');
    expect(result?.radiusMm).toBe(3);
    expect(result?.explanation).toContain('радиус скругления');
  });

  it('translates a group of holes with an exact standard drill', () => {
    const result = parseHoleGroup('4 отв. Ø6,5');
    expect(result?.holeCount).toBe(4);
    expect(result?.diameterMm).toBe(6.5);
    expect(result?.recommendedDrillMm).toBe(6.5);
    expect(result?.drillMatchesExactly).toBe(true);
    expect(result?.tools[0]?.name).toContain('Сверло Ø6,5 мм');
  });

  it('falls back to the nearest standard drill with a warning', () => {
    const result = parseHoleGroup('2 отв. Ø7,3');
    expect(result?.recommendedDrillMm).toBe(7.2);
    expect(result?.drillMatchesExactly).toBe(false);
    expect(result?.warnings.join(' ')).toContain('нет в стандартном наборе');
  });

  it('adds limits when a hole group has a tolerance field', () => {
    const result = parseHoleGroup('4 отв. Ø6,5 H12');
    expect(result?.explanation).toContain('6,5');
    expect(result?.explanation).toContain('H12');
  });

  it('translates a symmetric tolerance dimension', () => {
    const result = parseDimension('120±0,5');
    expect(result?.nominalMm).toBe(120);
    expect(result?.upperDeviationMm).toBe(0.5);
    expect(result?.lowerDeviationMm).toBe(-0.5);
    expect(result?.minSizeMm).toBe(119.5);
    expect(result?.maxSizeMm).toBe(120.5);
  });

  it('translates an asymmetric tolerance dimension', () => {
    const result = parseDimension('20 +0,1/-0,05');
    expect(result?.upperDeviationMm).toBe(0.1);
    expect(result?.lowerDeviationMm).toBe(-0.05);
    expect(result?.minSizeMm).toBe(19.95);
    expect(result?.maxSizeMm).toBe(20.1);
  });

  it('warns when a plain dimension has no tolerance fields', () => {
    const result = parseDimension('12');
    expect(result?.minSizeMm).toBeNull();
    expect(result?.warnings.length).toBe(1);
    expect(result?.warnings[0]).toContain('нет полей допуска');
  });

  it('keeps parsers from stealing each other inputs', () => {
    expect(parseChamfer('Ø20 H7')).toBeNull();
    expect(parseRadius('Ra 1.6')).toBeNull();
    expect(parseHoleGroup('R3')).toBeNull();
    expect(parseDimension('Т1-К5')).toBeNull();
  });
});
