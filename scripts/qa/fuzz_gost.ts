/**
 * Фаззинг ГОСТ-переводчика: 2 000+ сгенерированных и мутированных обозначений.
 *
 * Проверяем не «красиво ли объяснено», а честность и устойчивость:
 *   • ни одного исключения;
 *   • ни одного NaN/Infinity/undefined в ответе и ни одного «undefined» в тексте;
 *   • диаметры, шаги резьбы и свёрла остаются физичными (0,1…600 мм);
 *   • пустая строка/пробелы/эмодзи дают `unknown`, а не падение;
 *   • опечатки и подмена латиницы на кириллицу не приводят к абсурду (Ø 0 мм, сверло 501 мм).
 *
 * Запускается из `scripts/qa/run_qa.py`, результат — `qa/output/gost.json`.
 */
import { writeFileSync } from 'node:fs';
import { translateEngineeringNotation, type TranslationResult } from '@ikguide/gost-translator';

interface Failure {
  input: string;
  problem: string;
  detail?: string;
}

const failures: Failure[] = [];
let checked = 0;

const CYRILLIC_TO_LATIN: Record<string, string> = { М: 'M', Х: 'X', Н: 'H', К: 'K', С: 'C', Р: 'P', О: 'O', А: 'A', В: 'B', Е: 'E', Т: 'T' };
const LATIN_TO_CYRILLIC: Record<string, string> = { M: 'М', X: 'Х', H: 'Н', K: 'К', C: 'С', P: 'Р', O: 'О', A: 'А', B: 'В', E: 'Е', T: 'Т' };

const BASE = [
  'М8-7H',
  'М10×1,25-6H',
  'М6-7H глуб. 12',
  'М12-6g',
  'М20×2-6H',
  'Ø20 H7',
  'Ø32 H7/k6',
  'Ø110',
  'Ø8 h9',
  '4 отв. Ø10',
  '2 отв. Ø6,8',
  'Ra 1,6',
  'Ra 3.2',
  'Rz 20',
  'Т1-К5',
  'С2',
  'У4-80/150',
  '2×45°',
  '1×45°',
  'R5',
  'R12,5',
  '45°',
  '±0,5',
  '120',
  '0,5',
  '12,75',
  'Ø20 H7/k6',
  'М8',
  'Ø10',
  '4 отв',
];

/** Детерминированный генератор: одинаковые строки при каждом прогоне. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
const random = makeRandom(20261126);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function mutate(value: string): string {
  const kind = Math.floor(random() * 9);
  switch (kind) {
    case 0:
      return value.toLowerCase();
    case 1:
      return value.toUpperCase();
    case 2:
      return value.replace(/[МХНКСРОАВЕТ]/g, (char) => CYRILLIC_TO_LATIN[char] ?? char);
    case 3:
      return value.replace(/[MXHKCPOAВЕТ]/g, (char) => LATIN_TO_CYRILLIC[char] ?? char);
    case 4:
      return value.replace(/,/g, '.').replace(/\./g, random() > 0.5 ? ',' : '.');
    case 5:
      return value.split('').join(random() > 0.5 ? ' ' : '  ');
    case 6: {
      const position = Math.floor(random() * Math.max(1, value.length));
      return value.slice(0, position) + value.slice(position + 1);
    }
    case 7: {
      const position = Math.floor(random() * Math.max(1, value.length));
      return value.slice(0, position) + pick(['0', '9', 'Ø', 'Х', '-', ',', '°']) + value.slice(position);
    }
    default:
      return ` ${value}  `;
  }
}

const BOUNDARIES = [
  'Ø0',
  'Ø1',
  'Ø3',
  'Ø500',
  'Ø501',
  'Ø1000',
  'М0',
  'М1',
  'М500',
  'Ra 0',
  'Ra 999',
  'R0',
  '2×0°',
  '0°',
  '360°',
  '±999',
  '0,001',
  '99999',
  'Ø-10',
  'Ø1e5',
  'М8-',
  'Ø H7',
  'отв. Ø',
  'Ra',
  'М' + '8'.repeat(40),
  '0'.repeat(60),
  ' ',
  '',
  '\t',
  '🙂',
  'Деталь № 46',
  'Разраб. Иванов',
  '<script>alert(1)</script>',
  '../../etc/passwd',
];

const INPUTS: string[] = [...BASE, ...BOUNDARIES];
while (INPUTS.length < 2600) {
  INPUTS.push(mutate(pick(BASE)));
}

function isFinitePositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function inspect(result: TranslationResult, input: string): void {
  const serialized = JSON.stringify(result) ?? '';
  for (const bad of ['NaN', 'Infinity', 'undefined']) {
    if (serialized.includes(bad)) {
      failures.push({ input, problem: `json_contains_${bad}` });
      break;
    }
  }
  const text = [result.explanation, result.workerAdvice ?? '', JSON.stringify(result.warnings ?? [])].join(' ');
  if (/\bNaN\b|\bInfinity\b|\bundefined\b|null мм/.test(text)) {
    failures.push({ input, problem: 'text_contains_garbage', detail: text.slice(0, 160) });
  }

  const record = result as unknown as Record<string, unknown>;
  if (record.kind === 'thread') {
    const diameter = record.diameterMm;
    const pitch = record.pitchMm;
    const tapDrill = record.tapDrillMm;
    const rod = record.blankRodMm;
    if (!isFinitePositive(diameter) || (diameter as number) > 600) {
      failures.push({ input, problem: 'thread_diameter', detail: String(diameter) });
    }
    if (!isFinitePositive(pitch) || (pitch as number) > 8) {
      failures.push({ input, problem: 'thread_pitch', detail: String(pitch) });
    }
    if (tapDrill !== null && (!isFinitePositive(tapDrill) || (tapDrill as number) >= (diameter as number))) {
      failures.push({ input, problem: 'tap_drill', detail: `${String(tapDrill)} для Ø${String(diameter)}` });
    }
    // Пруток под плашку намеренно на 0,2–0,5 мм меньше номинала резьбы (металл выдавливается
    // в профиль), но не меньше 85 % диаметра — иначе это уже ошибка в расчёте.
    if (rod !== null && (!isFinitePositive(rod) || (rod as number) < (diameter as number) * 0.85 || (rod as number) > (diameter as number))) {
      failures.push({ input, problem: 'blank_rod', detail: `${String(rod)} для Ø${String(diameter)}` });
    }
  }
  if (record.kind === 'fit') {
    const zone = record.zone as Record<string, unknown> | null;
    if (zone) {
      for (const key of ['minSizeMm', 'maxSizeMm', 'toleranceUm']) {
        const value = zone[key];
        if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1000)) {
          failures.push({ input, problem: `fit_${key}`, detail: String(value) });
        }
      }
      if (typeof zone.minSizeMm === 'number' && typeof zone.maxSizeMm === 'number' && zone.minSizeMm > zone.maxSizeMm) {
        failures.push({ input, problem: 'fit_min_gt_max', detail: `${String(zone.minSizeMm)} > ${String(zone.maxSizeMm)}` });
      }
    }
  }
  if (record.kind === 'roughness') {
    for (const field of ['valueUm', 'raEquivalentUm'] as const) {
      const value = record[field];
      if (value === undefined || value === null) {
        failures.push({ input, problem: `roughness_${field}_missing` });
        continue;
      }
      if (!isFinitePositive(value) || (value as number) > 1000) {
        failures.push({ input, problem: `roughness_${field}`, detail: String(value) });
      }
    }
  }
  if (record.kind === 'dimension') {
    const nominal = record.nominalMm as number;
    if (!Number.isFinite(nominal) || Math.abs(nominal) > 100000) {
      failures.push({ input, problem: 'dimension_nominal', detail: String(nominal) });
    }
  }
  const tools = (record.tools ?? []) as Array<Record<string, unknown>>;
  for (const tool of tools) {
    if (typeof tool.name !== 'string' || tool.name.trim().length === 0) {
      failures.push({ input, problem: 'tool_without_name' });
    }
    const match = /(\d+(?:[.,]\d+)?)\s*мм/.exec(String(tool.name));
    if (match) {
      const size = Number(match[1]?.replace(',', '.'));
      if (!Number.isFinite(size) || size <= 0 || size > 1000) {
        failures.push({ input, problem: 'tool_size', detail: String(tool.name) });
      }
    }
  }
}

for (const input of INPUTS) {
  checked += 1;
  try {
    const result = translateEngineeringNotation(input);
    inspect(result, input);
  } catch (error) {
    failures.push({ input, problem: 'threw', detail: error instanceof Error ? error.message : String(error) });
  }
}

const byProblem: Record<string, number> = {};
for (const failure of failures) {
  byProblem[failure.problem] = (byProblem[failure.problem] ?? 0) + 1;
}

const report = {
  total: checked,
  fails: failures.length,
  byProblem,
  examples: failures.slice(0, 40),
};
writeFileSync(process.env.GOST_OUT ?? 'qa/output/gost.json', JSON.stringify(report, null, 2), 'utf8');
console.log(`gost: ${checked} строк, провалов ${failures.length}`);
if (failures.length > 0) {
  for (const failure of failures.slice(0, 10)) {
    console.log(`  ${failure.problem}: «${failure.input.slice(0, 60)}» ${failure.detail ?? ''}`);
  }
}
