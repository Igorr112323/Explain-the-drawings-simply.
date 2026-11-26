import { chooseStandardDrill } from '../tables/drills';
import { resolveZone } from '../tables/fits';
import { formatMm, formatSignedUm, parseDecimal } from '../format';
import type {
  ChamferTranslation,
  DimensionTranslation,
  HoleGroupTranslation,
  RadiusTranslation,
  RecommendedTool,
} from '../types';

const CHAMFER_PATTERN = /^(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)\s*°?$/;
const SHORT_CHAMFER_PATTERN = /^[CС]\s*(\d+(?:[.,]\d+)?)$/;
const RADIUS_PATTERN = /^R\s*(\d+(?:[.,]\d+)?)$/;
const HOLE_GROUP_PATTERN =
  /^(\d+)\s*(?:отв\.?|отверсти[йяе])\s*Ø?\s*(\d+(?:[.,]\d+)?)(?:\s*([Hh]\d{1,2}))?$/;
const DIMENSION_PATTERN = /^Ø?\s*(\d+(?:[.,]\d+)?)(?:\s*±\s*(\d+(?:[.,]\d+)?))?\s*(?:мм)?$/;
const ASYMMETRIC_DIMENSION_PATTERN =
  /^Ø?\s*(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)\s*\/\s*[-−]\s*(\d+(?:[.,]\d+)?)$/;

export function parseChamfer(normalized: string): ChamferTranslation | null {
  const full = CHAMFER_PATTERN.exec(normalized);
  const short = SHORT_CHAMFER_PATTERN.exec(normalized);
  if (!full && !short) {
    return null;
  }

  const legMm = full?.[1] ? parseDecimal(full[1]) : short?.[1] ? parseDecimal(short[1]) : null;
  const angleDeg = full?.[2] ? parseDecimal(full[2]) : 45;
  if (legMm === null) {
    return null;
  }

  const warnings: string[] = [];
  if (angleDeg <= 0 || angleDeg >= 90) {
    warnings.push('Угол фаски должен быть больше 0° и меньше 90° — проверьте чертёж.');
  }
  if (legMm <= 0 || legMm > 20) {
    warnings.push(`Фаска ${formatMm(legMm)} мм выглядит необычно для этой детали — уточните размер.`);
  }

  const faceWidthMm = angleDeg === 45 ? legMm : Number((legMm * Math.SQRT2).toFixed(2));

  return {
    kind: 'chamfer',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 2.307-2011 (нанесение размеров), ГОСТ 10948-64 (фаски)',
    legMm,
    angleDeg,
    notation: short ? 'C' : 'leg-by-angle',
    explanation: [
      `Фаска ${formatMm(legMm)}×${formatMm(angleDeg, 1)}° — снять кромку под углом ${formatMm(angleDeg, 1)}° так, чтобы катет фаски был ${formatMm(legMm)} мм.`,
      `На торце получится площадка шириной примерно ${formatMm(faceWidthMm)} мм.`,
      'Фаска снимает острую кромку, защищает резьбу и крепёж от закусывания, а рабочего — от порезов.',
    ].join(' '),
    workerAdvice:
      'Снимайте фаску за один проход острым резцом или фаскоснимателем, без «дребезга». Контролируйте штангенциркулем ширину фаски и визуально — равномерность по всему контуру. Острых кромок остаться не должно.',
    tools: [
      { name: `Фаскосниматель / резец 45°`, category: 'deburr', purpose: `Снятие фаски ${formatMm(legMm)} мм` },
      { name: 'Штангенциркуль 0–150 мм', category: 'caliper', purpose: 'Контроль размера фаски' },
      { name: 'Напильник драчёвый', category: 'deburr', purpose: 'Снятие заусенцев после обработки' },
    ],
    warnings,
  };
}

export function parseRadius(normalized: string): RadiusTranslation | null {
  const match = RADIUS_PATTERN.exec(normalized);
  const radiusRaw = match?.[1];
  if (!radiusRaw) {
    return null;
  }
  const radiusMm = parseDecimal(radiusRaw);
  if (!(radiusMm > 0)) {
    return null;
  }

  return {
    kind: 'radius',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 2.307-2011 (радиусы)',
    radiusMm,
    explanation: `R${formatMm(radiusMm)} — радиус скругления ${formatMm(radiusMm)} мм. Такой радиус снимает концентрацию напряжений в углу и не даёт трещине пойти от внутреннего угла.`,
    workerAdvice:
      'Обрабатывайте радиус плавно, без ступеньки в месте перехода. Проверьте радиус шаблоном или сравните с чертежом на просвет — «на глаз» здесь ошибаются часто.',
    tools: [
      { name: 'Радиусный резец / фреза', category: 'other', purpose: 'Формирование скругления' },
      { name: 'Радиусный шаблон', category: 'gauge', purpose: 'Контроль радиуса' },
      { name: 'Напильник / шлифовальная шкурка', category: 'deburr', purpose: 'Доводка поверхности' },
    ],
    warnings: radiusMm > 50 ? ['Радиус больше 50 мм — проверьте, не указан ли он для другой детали.'] : [],
  };
}

export function parseHoleGroup(normalized: string): HoleGroupTranslation | null {
  const match = HOLE_GROUP_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }
  const countRaw = match[1];
  const diameterRaw = match[2];
  const toleranceRaw = match[3];
  if (!countRaw || !diameterRaw) {
    return null;
  }

  const holeCount = Number(countRaw);
  const diameterMm = parseDecimal(diameterRaw);
  const drill = chooseStandardDrill(diameterMm);
  const warnings: string[] = [];

  if (!drill.exact) {
    warnings.push(
      `Сверла Ø${formatMm(diameterMm)} мм нет в стандартном наборе: ближайшее — Ø${formatMm(drill.drillMm)} мм. Для точного диаметра потребуется развёртывание.`,
    );
  }

  let toleranceText = '';
  const zone = toleranceRaw ? resolveZone(toleranceRaw, diameterMm) : null;
  if (toleranceRaw && zone) {
    toleranceText = ` Поле ${zone.field}: годный размер ${formatMm(diameterMm + zone.lowerUm / 1000)}–${formatMm(diameterMm + zone.upperUm / 1000)} мм.`;
  } else if (toleranceRaw) {
    warnings.push(`Поле допуска ${toleranceRaw} отсутствует во встроенной таблице ГОСТ 25346 — уточните предельные размеры.`);
  }

  return {
    kind: 'holeGroup',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 11284-75 (проходные отверстия), ГОСТ 25346 (допуски)',
    holeCount,
    diameterMm,
    recommendedDrillMm: drill.drillMm,
    drillMatchesExactly: drill.exact,
    withChamfer: false,
    explanation: `${holeCount} отв. Ø${formatMm(diameterMm)} — группа из ${holeCount} одинаковых отверстий диаметром ${formatMm(diameterMm)} мм. Сверлить сверлом Ø${formatMm(drill.drillMm)} мм.${toleranceText}`,
    workerAdvice: `Разметьте отверстия от одной базы, а не цепочкой от каждого предыдущего: погрешность не накопится. После сверления снимите заусенцы с двух сторон и проверьте межцентровые расстояния.`,
    tools: [
      { name: `Сверло Ø${formatMm(drill.drillMm)} мм`, category: 'drill', purpose: `Сверление ${holeCount} отверстий` },
      { name: 'Кернер и молоток', category: 'other', purpose: 'Центровка перед сверлением' },
      { name: 'Штангенциркуль 0–150 мм', category: 'caliper', purpose: 'Контроль диаметра и межцентровых расстояний' },
      { name: 'Зенковка 90°', category: 'deburr', purpose: 'Снятие заусенцев и фаска под крепёж' },
    ],
    warnings,
  };
}

export function parseDimension(normalized: string): DimensionTranslation | null {
  const asymmetric = ASYMMETRIC_DIMENSION_PATTERN.exec(normalized);
  if (asymmetric) {
    const nominalRaw = asymmetric[1];
    const plusRaw = asymmetric[2];
    const minusRaw = asymmetric[3];
    if (!nominalRaw || !plusRaw || !minusRaw) {
      return null;
    }
    const nominalMm = parseDecimal(nominalRaw);
    const upperDeviationMm = parseDecimal(plusRaw);
    const lowerDeviationMm = -parseDecimal(minusRaw);
    return buildDimension(normalized, nominalMm, upperDeviationMm, lowerDeviationMm);
  }

  const match = DIMENSION_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }
  const nominalRaw = match[1];
  if (!nominalRaw) {
    return null;
  }
  const nominalMm = parseDecimal(nominalRaw);
  const toleranceRaw = match[2];
  if (toleranceRaw) {
    const deviation = parseDecimal(toleranceRaw);
    return buildDimension(normalized, nominalMm, deviation, -deviation);
  }
  return buildDimension(normalized, nominalMm, null, null);
}

function buildDimension(
  normalized: string,
  nominalMm: number,
  upperDeviationMm: number | null,
  lowerDeviationMm: number | null,
): DimensionTranslation {
  const hasTolerance = upperDeviationMm !== null && lowerDeviationMm !== null;
  const minSizeMm = hasTolerance ? Number((nominalMm + (lowerDeviationMm ?? 0)).toFixed(4)) : null;
  const maxSizeMm = hasTolerance ? Number((nominalMm + (upperDeviationMm ?? 0)).toFixed(4)) : null;

  return {
    kind: 'dimension',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 2.307-2011 (нанесение размеров и предельных отклонений)',
    nominalMm,
    upperDeviationMm,
    lowerDeviationMm,
    minSizeMm,
    maxSizeMm,
    explanation: hasTolerance
      ? `Размер ${formatMm(nominalMm)} с отклонениями ${formatSignedUm((upperDeviationMm ?? 0) * 1000)} / ${formatSignedUm((lowerDeviationMm ?? 0) * 1000)}: годный размер ${formatMm(minSizeMm ?? nominalMm)}–${formatMm(maxSizeMm ?? nominalMm)} мм.`
      : `Размер ${formatMm(nominalMm)} мм без указанных отклонений. По ГОСТ 2.307-2011 свободные размеры подчиняются общим допускам, указанным в технических требованиях чертежа (обычно ±0,5 мм или по H12/h12).`,
    workerAdvice: hasTolerance
      ? 'Измеряйте готовую деталь в том же месте, где указан размер, и при температуре цеха. Не подгоняйте «в плюс» на всякий случай: выход за предельный размер — брак.'
      : 'Уточните общий допуск в технических требованиях чертежа. Если он не указан — согласуйте с инженером, а не угадывайте.',
    tools: [
      { name: 'Штангенциркуль 0–150 мм', category: 'caliper', purpose: 'Контроль свободных размеров' },
    ],
    warnings: hasTolerance ? [] : ['У размера нет полей допуска — проверьте технические требования чертежа.'],
  };
}

export function buildDimensionTools(): RecommendedTool[] {
  return [
    { name: 'Штангенциркуль 0–150 мм', category: 'caliper', purpose: 'Контроль свободных размеров' },
    { name: 'Микрометр', category: 'micrometer', purpose: 'Контроль точных размеров' },
  ];
}
