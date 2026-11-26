export interface NominalRange {
  /** Lower bound, exclusive, millimetres. */
  fromMm: number;
  /** Upper bound, inclusive, millimetres. */
  toMm: number;
}

/** Nominal size ranges of GOST 25346 / ISO 286 for 1–500 mm. */
export const NOMINAL_RANGES: readonly NominalRange[] = [
  { fromMm: 0, toMm: 3 },
  { fromMm: 3, toMm: 6 },
  { fromMm: 6, toMm: 10 },
  { fromMm: 10, toMm: 18 },
  { fromMm: 18, toMm: 30 },
  { fromMm: 30, toMm: 50 },
  { fromMm: 50, toMm: 80 },
  { fromMm: 80, toMm: 120 },
  { fromMm: 120, toMm: 180 },
  { fromMm: 180, toMm: 250 },
  { fromMm: 250, toMm: 315 },
  { fromMm: 315, toMm: 400 },
  { fromMm: 400, toMm: 500 },
];

/** IT tolerance values in micrometres, index aligned with NOMINAL_RANGES. */
export const IT_GRADES: Readonly<Record<number, readonly number[]>> = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
  12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460, 520, 570, 630],
  14: [250, 300, 360, 430, 520, 620, 740, 870, 1000, 1150, 1300, 1400, 1550],
};

type ZonePair = readonly [upperUm: number, lowerUm: number];

/** Shaft k6 — transition zone, values from GOST 25346 table 7. */
const K6: readonly ZonePair[] = [
  [6, 0],
  [9, 1],
  [10, 1],
  [12, 1],
  [15, 2],
  [18, 2],
  [21, 2],
  [25, 3],
  [28, 3],
  [33, 4],
  [36, 4],
  [41, 5],
  [45, 5],
];

/** Shaft js7 — symmetrical zone, ±IT7/2. */
const JS7: readonly ZonePair[] = [
  [5, -5],
  [6, -6],
  [7.5, -7.5],
  [9, -9],
  [10.5, -10.5],
  [12.5, -12.5],
  [15, -15],
  [17.5, -17.5],
  [20, -20],
  [23, -23],
  [26, -26],
  [28.5, -28.5],
  [31.5, -31.5],
];

/** Shaft g6 — small clearance. */
const G6: readonly ZonePair[] = [
  [-2, -8],
  [-4, -12],
  [-5, -14],
  [-6, -17],
  [-7, -20],
  [-9, -25],
  [-10, -29],
  [-12, -34],
  [-14, -39],
  [-15, -44],
  [-17, -49],
  [-18, -54],
  [-20, -60],
];

/** Shaft f7 — running fit. */
const F7: readonly ZonePair[] = [
  [-6, -16],
  [-10, -22],
  [-13, -28],
  [-16, -34],
  [-20, -41],
  [-25, -50],
  [-30, -60],
  [-36, -71],
  [-43, -83],
  [-50, -96],
  [-56, -108],
  [-62, -119],
  [-68, -131],
];

/** Shaft d9 — wide running fit. */
const D9: readonly ZonePair[] = [
  [-20, -45],
  [-30, -60],
  [-40, -76],
  [-50, -93],
  [-65, -117],
  [-80, -142],
  [-100, -174],
  [-120, -207],
  [-145, -245],
  [-170, -285],
  [-190, -320],
  [-210, -350],
  [-230, -385],
];

export interface ZoneDefinition {
  field: string;
  zoneKind: 'hole' | 'shaft';
  grade: number;
  /** Upper/lower deviations per nominal range; may be computed for H/h zones. */
  deviations: readonly ZonePair[];
}

function buildHoleZone(grade: number): readonly ZonePair[] {
  const it = IT_GRADES[grade];
  if (!it) {
    throw new Error(`IT${grade} is not supported by the built-in GOST 25346 table`);
  }
  return it.map((value) => [value, 0] as ZonePair);
}

function buildShaftZone(grade: number): readonly ZonePair[] {
  const it = IT_GRADES[grade];
  if (!it) {
    throw new Error(`IT${grade} is not supported by the built-in GOST 25346 table`);
  }
  return it.map((value) => [0, -value] as ZonePair);
}

const HOLE_FIELDS: Readonly<Record<string, ZoneDefinition>> = {
  H6: { field: 'H6', zoneKind: 'hole', grade: 6, deviations: buildHoleZone(6) },
  H7: { field: 'H7', zoneKind: 'hole', grade: 7, deviations: buildHoleZone(7) },
  H8: { field: 'H8', zoneKind: 'hole', grade: 8, deviations: buildHoleZone(8) },
  H9: { field: 'H9', zoneKind: 'hole', grade: 9, deviations: buildHoleZone(9) },
  H11: { field: 'H11', zoneKind: 'hole', grade: 11, deviations: buildHoleZone(11) },
  H12: { field: 'H12', zoneKind: 'hole', grade: 12, deviations: buildHoleZone(12) },
  H14: { field: 'H14', zoneKind: 'hole', grade: 14, deviations: buildHoleZone(14) },
  JS7: { field: 'JS7', zoneKind: 'hole', grade: 7, deviations: JS7 },
};

const SHAFT_FIELDS: Readonly<Record<string, ZoneDefinition>> = {
  h6: { field: 'h6', zoneKind: 'shaft', grade: 6, deviations: buildShaftZone(6) },
  h7: { field: 'h7', zoneKind: 'shaft', grade: 7, deviations: buildShaftZone(7) },
  h9: { field: 'h9', zoneKind: 'shaft', grade: 9, deviations: buildShaftZone(9) },
  h11: { field: 'h11', zoneKind: 'shaft', grade: 11, deviations: buildShaftZone(11) },
  k6: { field: 'k6', zoneKind: 'shaft', grade: 6, deviations: K6 },
  js7: { field: 'js7', zoneKind: 'shaft', grade: 7, deviations: JS7 },
  g6: { field: 'g6', zoneKind: 'shaft', grade: 6, deviations: G6 },
  f7: { field: 'f7', zoneKind: 'shaft', grade: 7, deviations: F7 },
  d9: { field: 'd9', zoneKind: 'shaft', grade: 9, deviations: D9 },
};

export function getSupportedZoneFields(): { holes: string[]; shafts: string[] } {
  return {
    holes: Object.keys(HOLE_FIELDS),
    shafts: Object.keys(SHAFT_FIELDS),
  };
}

export function findNominalRange(nominalMm: number): { range: NominalRange; index: number } | null {
  for (let index = 0; index < NOMINAL_RANGES.length; index += 1) {
    const range = NOMINAL_RANGES[index];
    if (!range) {
      continue;
    }
    if (nominalMm > range.fromMm && nominalMm <= range.toMm) {
      return { range, index };
    }
  }
  return null;
}

export interface RawZone {
  field: string;
  zoneKind: 'hole' | 'shaft';
  grade: number;
  lowerUm: number;
  upperUm: number;
  nominalMm: number;
}

/**
 * Resolves a tolerance field (H7, h6, JS7, k6, …) against a nominal size.
 * Returns null when the nominal size or the field is outside the built-in GOST 25346 table.
 */
export function resolveZone(fieldInput: string, nominalMm: number): RawZone | null {
  if (!(nominalMm > 0 && nominalMm <= 500)) {
    return null;
  }
  const rangeHit = findNominalRange(nominalMm);
  if (!rangeHit) {
    return null;
  }

  const normalized = normalizeField(fieldInput);
  const letters = normalized.replace(/[^A-Za-z]/g, '');
  const grade = Number(normalized.replace(/[^0-9]/g, ''));
  if (letters.length === 0 || !Number.isFinite(grade)) {
    return null;
  }

  // GOST 25346: upper-case letters are holes, lower-case letters are shafts.
  const isHole = letters === letters.toUpperCase();
  const key = `${letters}${grade}`;
  const definition = isHole ? HOLE_FIELDS[key.toUpperCase()] : SHAFT_FIELDS[key.toLowerCase()];
  if (!definition) {
    return null;
  }

  const zoneKind: 'hole' | 'shaft' = definition.zoneKind;

  const pair = definition.deviations[rangeHit.index];
  if (!pair) {
    return null;
  }

  return {
    field: definition.field,
    zoneKind,
    grade,
    lowerUm: pair[1],
    upperUm: pair[0],
    nominalMm,
  };
}

/** Normalises «7H» thread-style spelling into «H7», and lower/upper case according to the side. */
export function normalizeField(raw: string): string {
  const trimmed = raw.trim();
  const reversed = /^(\d{1,2})\s*([A-Za-z]{1,2})$/.exec(trimmed);
  if (reversed) {
    const grade = reversed[1];
    const letters = reversed[2];
    if (grade && letters) {
      return `${letters}${grade}`;
    }
  }
  return trimmed;
}
