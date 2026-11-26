import { findFinePitch, findMetricThread } from '../tables/metricThreads';
import { formatMm, parseDecimal } from '../format';
import type { RecommendedTool, ThreadTranslation } from '../types';

const THREAD_PATTERN =
  /^(?:(\d+)\s*(?:отв\.?|отверсти[йяе]|шт\.?)\s*)?[МM]\s*(\d+(?:[.,]\d+)?)(?:\s*[×x*]\s*(\d+(?:[.,]\d+)?))?(?:\s*-\s*(\d{1,2}\s*[A-Za-zА-Яа-я]{1,2}))?(?:\s*(?:глуб\.?|глубина|глубиной)\s*(\d+(?:[.,]\d+)?))?\s*(?:мм)?$/i;

export function parseThread(normalized: string): ThreadTranslation | null {
  const match = THREAD_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  const holeCountRaw = match[1];
  const diameterRaw = match[2];
  const pitchRaw = match[3];
  const toleranceRaw = match[4];
  const depthRaw = match[5];

  if (!diameterRaw) {
    return null;
  }

  const diameterMm = parseDecimal(diameterRaw);
  const row = findMetricThread(diameterMm);
  const explicitPitch = pitchRaw ? parseDecimal(pitchRaw) : null;
  const pitchMm = explicitPitch ?? row?.coarsePitchMm ?? null;
  const toleranceClass = toleranceRaw ? toleranceRaw.replace(/\s/g, '') : null;

  const warnings: string[] = [];
  let threadKind: ThreadTranslation['threadKind'] = 'unspecified';

  if (toleranceClass) {
    const letters = toleranceClass.replace(/[^A-Za-zА-Яа-я]/g, '');
    threadKind = letters === letters.toUpperCase() ? 'internal' : 'external';
  }

  if (threadKind === 'unspecified') {
    warnings.push(
      'Поле допуска резьбы не указано (например, 7H или 6g). Инструмент ниже показан для внутренней резьбы; для резьбы на валу нужна плашка и калибр-кольцо.',
    );
  }

  if (!row) {
    warnings.push(
      `Резьбы М${formatMm(diameterMm)} нет во встроенной таблице ГОСТ 24705 (поддерживаются М1–М30). Данные рассчитаны по формуле d − P, проверьте по чертежу.`,
    );
  }

  if (pitchMm === null) {
    return null;
  }

  const pitchKind: ThreadTranslation['pitchKind'] = explicitPitch && row && Math.abs(explicitPitch - row.coarsePitchMm) > 1e-9 ? 'fine' : 'coarse';
  const fineRow = explicitPitch ? findFinePitch(diameterMm, explicitPitch) : undefined;

  if (explicitPitch && !fineRow && row && Math.abs(explicitPitch - row.coarsePitchMm) > 1e-9) {
    warnings.push(
      `Шаг ${formatMm(explicitPitch)} мм не входит в таблицу стандартных мелких шагов ГОСТ 24705. Уточните размер по чертежу — возможно, это нестандартная резьба.`,
    );
  }

  const tapDrillMm =
    threadKind === 'external'
      ? null
      : fineRow
        ? fineRow.tapDrillMm
        : row && pitchKind === 'coarse'
          ? row.tapDrillMm
          : Number((diameterMm - pitchMm).toFixed(1));

  const tapDrillRangeMm = row && pitchKind === 'coarse' ? row.tapDrillRangeMm : null;
  const clearanceHoleMm = row ? row.clearanceHoleMm : Number((diameterMm + pitchMm).toFixed(1));
  const wrenchSizeMm = row ? row.wrenchSizeMm : null;
  const holeCount = holeCountRaw ? Number(holeCountRaw) : null;
  const threadDepthMm = depthRaw ? parseDecimal(depthRaw) : null;
  const recommendedEngagementMm = Number((diameterMm * 1.5).toFixed(1));
  const blankRodMm =
    threadKind === 'external' ? Number((diameterMm - 0.15 * pitchMm).toFixed(1)) : null;

  if (threadDepthMm !== null && threadDepthMm < recommendedEngagementMm * 0.8) {
    warnings.push(
      `Глубина резьбы ${formatMm(threadDepthMm)} мм меньше рекомендуемых ${formatMm(recommendedEngagementMm)} мм (1,5·d) — соединение может выдержать недостаточную нагрузку.`,
    );
  }

  const designationParts = [`М${formatMm(diameterMm)}`];
  if (pitchKind === 'fine') {
    designationParts.push(`×${formatMm(pitchMm)}`);
  }
  if (toleranceClass) {
    designationParts.push(`-${toleranceClass}`);
  }
  const designation = designationParts.join('');

  const tools = buildTools({
    threadKind,
    diameterMm,
    pitchMm,
    tapDrillMm,
    wrenchSizeMm,
  });

  return {
    kind: 'thread',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 24705-2004 (резьба), ГОСТ 19257-73 (сверло), ГОСТ 11284-75 (проходное отверстие)',
    designation,
    thread: 'metric',
    threadKind,
    diameterMm,
    pitchMm,
    pitchKind,
    toleranceClass,
    holeCount,
    threadDepthMm,
    tapDrillMm,
    tapDrillRangeMm,
    blankRodMm,
    clearanceHoleMm,
    wrenchSizeMm,
    recommendedEngagementMm,
    explanation: buildExplanation({
      designation,
      threadKind,
      diameterMm,
      pitchMm,
      pitchKind,
      tapDrillMm,
      tapDrillRangeMm,
      clearanceHoleMm,
      wrenchSizeMm,
      holeCount,
      threadDepthMm,
      toleranceClass,
    }),
    workerAdvice: buildWorkerAdvice({
      threadKind,
      diameterMm,
      pitchMm,
      tapDrillMm,
      tapDrillRangeMm,
      threadDepthMm,
      holeCount,
      recommendedEngagementMm,
      toleranceClass,
    }),
    tools,
    warnings,
  };
}

interface ExplanationInput {
  designation: string;
  threadKind: ThreadTranslation['threadKind'];
  diameterMm: number;
  pitchMm: number;
  pitchKind: ThreadTranslation['pitchKind'];
  tapDrillMm: number | null;
  tapDrillRangeMm: [number, number] | null;
  clearanceHoleMm: number;
  wrenchSizeMm: number | null;
  holeCount: number | null;
  threadDepthMm: number | null;
  toleranceClass: string | null;
}

function buildExplanation(input: ExplanationInput): string {
  const parts: string[] = [];
  const pitchLabel = input.pitchKind === 'fine' ? 'мелкий' : 'основной';
  const sideLabel =
    input.threadKind === 'internal'
      ? 'внутренняя резьба (в отверстии)'
      : input.threadKind === 'external'
        ? 'наружная резьба (на валу или крепеже)'
        : 'сторона резьбы не указана в обозначении';

  parts.push(
    `${input.designation} — метрическая резьба Ø${formatMm(input.diameterMm)} мм с ${pitchLabel} шагом ${formatMm(input.pitchMm)} мм, ${sideLabel}.`,
  );

  if (input.holeCount !== null) {
    parts.push(`Отверстий в группе: ${input.holeCount}.`);
  }
  if (input.tapDrillMm !== null) {
    const range = input.tapDrillRangeMm
      ? ` (допускается ${formatMm(input.tapDrillRangeMm[0])}–${formatMm(input.tapDrillRangeMm[1])} мм)`
      : '';
    parts.push(`Сверло под резьбу: Ø${formatMm(input.tapDrillMm)} мм${range}.`);
  }
  parts.push(`Проходное отверстие под крепёж: Ø${formatMm(input.clearanceHoleMm)} мм (ГОСТ 11284-75).`);
  if (input.wrenchSizeMm !== null) {
    parts.push(`Размер ключа под стандартную гайку/болт: ${formatMm(input.wrenchSizeMm)} мм.`);
  }
  if (input.threadDepthMm !== null) {
    parts.push(`Глубина резьбы по чертежу: ${formatMm(input.threadDepthMm)} мм.`);
  }
  return parts.join(' ');
}

interface AdviceInput {
  threadKind: ThreadTranslation['threadKind'];
  diameterMm: number;
  pitchMm: number;
  tapDrillMm: number | null;
  tapDrillRangeMm: [number, number] | null;
  threadDepthMm: number | null;
  holeCount: number | null;
  recommendedEngagementMm: number;
  toleranceClass: string | null;
}

function buildWorkerAdvice(input: AdviceInput): string {
  if (input.threadKind === 'external') {
    return [
      `Проточите заготовку под резьбу М${formatMm(input.diameterMm)} и нарежьте плашкой или резьбовым резцом.`,
      'Контролируйте диаметр гладкой части микрометром до нарезания: резьба не прощает «на глаз».',
      'Смазывайте резьбу СОЖ и не нарезайте за один проход на глубину больше 0,5 мм.',
    ].join(' ');
  }

  const depth = input.threadDepthMm;
  const drillDepth = depth !== null ? Math.ceil(depth + 0.5 * input.diameterMm + 2) : null;

  const steps: string[] = [];
  steps.push(
    `Просверлите отверстие Ø${formatMm(input.tapDrillMm ?? input.diameterMm - input.pitchMm)} мм`,
  );
  if (drillDepth !== null) {
    steps.push(`на глубину ${drillDepth} мм (резьба ${formatMm(depth ?? 0)} мм + запас на заборную часть метчика)`);
  }
  steps.push('снимите фаску 1×45° и продуйте отверстие от стружки.');
  const second =
    'Нарезайте метчиками по порядку: №1 — черновой, №2 — чистовой. Один оборот вперёд, пол-оборота назад, чтобы ломать стружку.';
  const third =
    input.toleranceClass !== null
      ? `Готовую резьбу ${input.toleranceClass} проверьте резьбовым калибром-пробкой: он должен входить от руки.`
      : 'Готовую резьбу проверьте калибром-пробкой или контрольным болтом — он должен входить от руки до конца резьбы.';
  return `${steps.join(' ')} ${second} ${third}`;
}

interface ToolInput {
  threadKind: ThreadTranslation['threadKind'];
  diameterMm: number;
  pitchMm: number;
  tapDrillMm: number | null;
  wrenchSizeMm: number | null;
}

function buildTools(input: ToolInput): RecommendedTool[] {
  const tools: RecommendedTool[] = [];

  if (input.threadKind === 'external') {
    tools.push({
      name: `Плашка М${formatMm(input.diameterMm)}×${formatMm(input.pitchMm)}`,
      category: 'die',
      purpose: 'Нарезание наружной резьбы',
    });
    tools.push({
      name: 'Микрометр 0–25 мм',
      category: 'micrometer',
      purpose: 'Контроль диаметра под резьбу до нарезания',
    });
    tools.push({
      name: `Калибр-кольцо М${formatMm(input.diameterMm)}`,
      category: 'gauge',
      purpose: 'Проверка наружной резьбы',
    });
    return tools;
  }

  if (input.tapDrillMm !== null) {
    tools.push({
      name: `Сверло Ø${formatMm(input.tapDrillMm)} мм`,
      category: 'drill',
      purpose: 'Отверстие под нарезание резьбы',
    });
  }
  tools.push({
    name: `Метчик М${formatMm(input.diameterMm)}×${formatMm(input.pitchMm)} (комплект №1 и №2)`,
    category: 'tap',
    purpose: 'Нарезание внутренней резьбы',
  });
  tools.push({
    name: 'Вороток для метчика',
    category: 'other',
    purpose: 'Удержание метчика и контроль усилия',
  });
  tools.push({
    name: `Калибр-пробка резьбовой М${formatMm(input.diameterMm)}`,
    category: 'gauge',
    purpose: 'Проверка резьбы после нарезания',
  });
  if (input.wrenchSizeMm !== null) {
    tools.push({
      name: `Ключ ${formatMm(input.wrenchSizeMm)} мм`,
      category: 'wrench',
      purpose: 'Затяжка стандартного крепежа',
    });
  }
  return tools;
}
