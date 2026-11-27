export interface RoughnessClassRow {
  surfaceClass: number;
  raUm: number;
  rzUm: number;
  processing: string;
  handFeel: string;
}

/**
 * Surface roughness classes of GOST 2789-73.
 * For each class Ra = Rz / 4, both limits are given in micrometres.
 */
export const ROUGHNESS_CLASSES: readonly RoughnessClassRow[] = [
  { surfaceClass: 1, raUm: 100, rzUm: 320, processing: 'литьё, ковка, газовая резка без зачистки', handFeel: 'следы реза видны и чувствуются пальцем' },
  { surfaceClass: 2, raUm: 50, rzUm: 160, processing: 'обдирочное точение, грубая резка', handFeel: 'риски глубокие, ноготь цепляется' },
  { surfaceClass: 3, raUm: 25, rzUm: 80, processing: 'черновое точение или фрезерование', handFeel: 'заметные риски, ноготь чувствует неровности' },
  { surfaceClass: 4, raUm: 12.5, rzUm: 40, processing: 'получистовое точение, черновое фрезерование', handFeel: 'риски видны, на ощупь поверхность шероховатая' },
  { surfaceClass: 5, raUm: 6.3, rzUm: 20, processing: 'получистовая обработка концевой фрезой', handFeel: 'мелкие риски, поверхность матовая' },
  { surfaceClass: 6, raUm: 3.2, rzUm: 10, processing: 'чистовое точение, зенкерование', handFeel: 'риски едва заметны, ноготь не чувствует ступенек' },
  { surfaceClass: 7, raUm: 1.6, rzUm: 6.3, processing: 'чистовое точение, развёртывание, тонкое фрезерование', handFeel: 'поверхность гладкая, риски видны только на свет' },
  { surfaceClass: 8, raUm: 0.8, rzUm: 3.2, processing: 'шлифование, чистовое развёртывание', handFeel: 'гладкая поверхность, палец скользит без зацепов' },
  { surfaceClass: 9, raUm: 0.4, rzUm: 1.6, processing: 'тонкое шлифование, притирка', handFeel: 'зеркальный блеск, следов обработки нет' },
  { surfaceClass: 10, raUm: 0.2, rzUm: 0.8, processing: 'хонингование, суперфиниш, тонкая притирка', handFeel: 'ровный блеск, поверхность «мыльная» на ощупь' },
  { surfaceClass: 11, raUm: 0.1, rzUm: 0.4, processing: 'доводка, полирование', handFeel: 'зеркало без видимых дефектов' },
  { surfaceClass: 12, raUm: 0.05, rzUm: 0.2, processing: 'тонкая доводка, полирование', handFeel: 'оптический блеск' },
  { surfaceClass: 13, raUm: 0.025, rzUm: 0.1, processing: 'прецизионная доводка', handFeel: 'оптическая поверхность, контролируется прибором' },
  { surfaceClass: 14, raUm: 0.0125, rzUm: 0.05, processing: 'прецизионная доводка, алмазное точение', handFeel: 'контроль только прибором' },
];

export interface RoughnessResolution {
  row: RoughnessClassRow;
  matchesSeries: boolean;
  raEquivalentUm: number;
  requiredClass: number;
}

/**
 * Finds the roughness class that guarantees the requested value:
 * the class limit must be equal to or finer than the requested value.
 */
export function resolveRoughness(parameter: 'Ra' | 'Rz', valueUm: number): RoughnessResolution | null {
  if (!(valueUm > 0)) {
    return null;
  }

  const sortedFinestLast = [...ROUGHNESS_CLASSES].sort((a, b) => a.surfaceClass - b.surfaceClass);
  const limitOf = (row: RoughnessClassRow): number => (parameter === 'Ra' ? row.raUm : row.rzUm);

  const exact = sortedFinestLast.find((row) => Math.abs(limitOf(row) - valueUm) < 1e-9);
  const candidate = exact ?? sortedFinestLast.find((row) => limitOf(row) <= valueUm + 1e-9);

  if (!candidate) {
    return null;
  }

  return {
    row: candidate,
    matchesSeries: exact !== undefined,
    raEquivalentUm: parameter === 'Ra' ? valueUm : valueUm / 4,
    requiredClass: candidate.surfaceClass,
  };
}

export function finishGroupOf(surfaceClass: number): 'rough' | 'semi-finish' | 'finish' | 'precision' {
  if (surfaceClass <= 4) {
    return 'rough';
  }
  if (surfaceClass <= 6) {
    return 'semi-finish';
  }
  if (surfaceClass <= 8) {
    return 'finish';
  }
  return 'precision';
}
