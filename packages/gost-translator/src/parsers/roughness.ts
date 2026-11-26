import { finishGroupOf, resolveRoughness } from '../tables/roughness';
import { formatMm, parseDecimal } from '../format';
import type { RecommendedTool, RoughnessTranslation } from '../types';

const ROUGHNESS_PATTERN = /^(?:√\s*)?(Ra|Rz)\s*(\d+(?:[.,]\d+)?)\s*(?:мкм|µm|um)?$/;

const FINISH_GROUP_LABEL: Readonly<Record<RoughnessTranslation['finishGroup'], string>> = {
  rough: 'черновая обработка',
  'semi-finish': 'получистовая обработка',
  finish: 'чистовая обработка',
  precision: 'финишная обработка',
};

export function parseRoughness(normalized: string): RoughnessTranslation | null {
  const match = ROUGHNESS_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  const parameter = match[1] as 'Ra' | 'Rz';
  const valueRaw = match[2];
  if (!valueRaw) {
    return null;
  }

  const valueUm = parseDecimal(valueRaw);
  const resolution = resolveRoughness(parameter, valueUm);
  if (!resolution) {
    return null;
  }

  const warnings: string[] = [];
  if (!resolution.matchesSeries) {
    warnings.push(
      `${parameter} ${formatMm(valueUm)} мкм нет в стандартном ряду ГОСТ 2789-73. Ближайшее нормируемое значение — ${parameter} ${formatMm(resolution.row[parameter === 'Ra' ? 'raUm' : 'rzUm'])} мкм (${resolution.requiredClass}-й класс).`,
    );
  }
  if (resolution.requiredClass >= 9) {
    warnings.push('Такая шероховатость контролируется только прибором, образец сравнения здесь не подходит.');
  }

  const finishGroup = finishGroupOf(resolution.requiredClass);
  const parameterLimitUm = resolution.row[parameter === 'Ra' ? 'raUm' : 'rzUm'];

  return {
    kind: 'roughness',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 2789-73 (параметры шероховатости), ГОСТ 9378-93 (образцы сравнения)',
    parameter,
    valueUm,
    surfaceClass: resolution.requiredClass,
    surfaceClassLabel: `${resolution.requiredClass}-й класс шероховатости`,
    matchesSeries: resolution.matchesSeries,
    raEquivalentUm: Number((parameter === 'Ra' ? valueUm : valueUm / 4).toFixed(3)),
    processing: resolution.row.processing,
    finishGroup,
    explanation: [
      `${parameter} ${formatMm(valueUm)} — требование к шероховатости поверхности: средняя высота неровностей не более ${formatMm(valueUm)} мкм.`,
      `Это ${resolution.requiredClass}-й класс по ГОСТ 2789-73 (предел ${parameter} ${formatMm(parameterLimitUm)} мкм), группа «${FINISH_GROUP_LABEL[finishGroup]}».`,
      `Как получить: ${resolution.row.processing}.`,
      `На ощупь: ${resolution.row.handFeel}.`,
    ].join(' '),
    workerAdvice:
      finishGroup === 'precision'
        ? 'Работайте только на финишном оборудовании, с малыми подачами и без спешки. Проверяйте поверхность профилометром, а не «на глаз».'
        : finishGroup === 'finish'
          ? 'Не оставляйте поперечных рисок от чернового прохода: последний проход — с малой подачей и острой кромкой инструмента. Сравните деталь с образцом шероховатости при одинаковом освещении.'
          : 'Доведите поверхность чистовым проходом и сравните с образцом шероховатости. Если риски грубее образца — деталь не принята.',
    tools: buildTools(resolution.requiredClass, finishGroup),
    warnings,
  };
}

function buildTools(
  surfaceClass: number,
  finishGroup: RoughnessTranslation['finishGroup'],
): RecommendedTool[] {
  const tools: RecommendedTool[] = [
    {
      name: 'Набор образцов шероховатости ГОСТ 9378-93',
      category: 'gauge',
      purpose: 'Сравнение поверхности с эталоном',
    },
  ];

  if (surfaceClass >= 9) {
    tools.push({
      name: 'Профилометр',
      category: 'gauge',
      purpose: 'Инструментальный контроль Ra/Rz',
    });
  }

  if (finishGroup === 'precision' || finishGroup === 'finish') {
    tools.push({
      name: 'Чистовой резец / шлифовальный круг',
      category: 'other',
      purpose: 'Получение чистовой поверхности',
    });
  } else {
    tools.push({
      name: 'Чистовая фреза / резец с радиусом',
      category: 'other',
      purpose: 'Снижение высоты неровностей',
    });
  }

  tools.push({
    name: 'Лупа 4×–10×',
    category: 'other',
    purpose: 'Визуальный контроль рисок и задиров',
  });

  return tools;
}
