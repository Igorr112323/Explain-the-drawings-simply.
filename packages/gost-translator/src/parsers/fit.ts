import { normalizeField, resolveZone, type RawZone } from '../tables/fits';
import { formatMm, formatSignedUm, parseDecimal } from '../format';
import type { FitKind, FitPair, FitTranslation, RecommendedTool, ToleranceZone } from '../types';

const FIT_PATTERN =
  /^(?:Ø\s*)?(\d+(?:[.,]\d+)?)\s*(JS|js|H|h|K|k|G|g|F|f|D|d)\s*(\d{1,2})(?:\s*\/\s*(JS|js|H|h|K|k|G|g|F|f|D|d)\s*(\d{1,2}))?$/;

const FIT_KIND_LABEL: Readonly<Record<FitKind, string>> = {
  clearance: 'посадка с зазором',
  transition: 'переходная посадка',
  interference: 'посадка с натягом',
};

interface FitPatternMatch {
  nominalMm: number;
  firstField: string;
  secondField: string | null;
}

export function matchFit(normalized: string): FitPatternMatch | null {
  const match = FIT_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }
  const nominalRaw = match[1];
  const fieldLetters = match[2];
  const fieldGrade = match[3];
  const secondLetters = match[4];
  const secondGrade = match[5];
  if (!nominalRaw || !fieldLetters || !fieldGrade) {
    return null;
  }

  return {
    nominalMm: parseDecimal(nominalRaw),
    firstField: normalizeField(`${fieldLetters}${fieldGrade}`),
    secondField: secondLetters && secondGrade ? normalizeField(`${secondLetters}${secondGrade}`) : null,
  };
}

function toToleranceZone(raw: RawZone): ToleranceZone {
  return {
    field: raw.field,
    zoneKind: raw.zoneKind,
    grade: raw.grade,
    lowerUm: raw.lowerUm,
    upperUm: raw.upperUm,
    toleranceUm: Number((raw.upperUm - raw.lowerUm).toFixed(1)),
    minSizeMm: Number((raw.nominalMm + raw.lowerUm / 1000).toFixed(4)),
    maxSizeMm: Number((raw.nominalMm + raw.upperUm / 1000).toFixed(4)),
  };
}

function buildPair(hole: RawZone, shaft: RawZone): FitPair {
  const maxClearanceUm = Number((hole.upperUm - shaft.lowerUm).toFixed(1));
  const minClearanceUm = Number((hole.lowerUm - shaft.upperUm).toFixed(1));

  let fitKind: FitKind;
  if (minClearanceUm >= 0) {
    fitKind = 'clearance';
  } else if (maxClearanceUm <= 0) {
    fitKind = 'interference';
  } else {
    fitKind = 'transition';
  }

  return {
    hole: toToleranceZone(hole),
    shaft: toToleranceZone(shaft),
    fitKind,
    maxClearanceUm,
    minClearanceUm,
  };
}

export function parseFit(normalized: string): FitTranslation | null {
  const matched = matchFit(normalized);
  if (!matched) {
    return null;
  }

  const firstZoneRaw = resolveZone(matched.firstField, matched.nominalMm);
  if (!firstZoneRaw) {
    return null;
  }

  const secondZoneRaw = matched.secondField ? resolveZone(matched.secondField, matched.nominalMm) : null;
  const warnings: string[] = [];

  let holeRaw: RawZone | null = null;
  let shaftRaw: RawZone | null = null;

  if (firstZoneRaw.zoneKind === 'hole') {
    holeRaw = firstZoneRaw;
    shaftRaw = secondZoneRaw && secondZoneRaw.zoneKind === 'shaft' ? secondZoneRaw : null;
  } else {
    shaftRaw = firstZoneRaw;
    holeRaw = secondZoneRaw && secondZoneRaw.zoneKind === 'hole' ? secondZoneRaw : null;
  }

  if (matched.secondField && !secondZoneRaw) {
    warnings.push(
      `Поле ${matched.secondField} отсутствует во встроенной таблице ГОСТ 25346 (1–500 мм). Поддерживаются: H6, H7, H8, H9, H11, H12, H14, h6, h7, h9, h11, k6, js7, g6, f7, d9.`,
    );
  }

  if (firstZoneRaw.zoneKind === 'hole' && secondZoneRaw && secondZoneRaw.zoneKind === 'hole') {
    warnings.push('Оба поля относятся к отверстиям — посадка задана некорректно, уточните чертёж.');
  }
  if (firstZoneRaw.zoneKind === 'shaft' && secondZoneRaw && secondZoneRaw.zoneKind === 'shaft') {
    warnings.push('Оба поля относятся к валам — посадка задана некорректно, уточните чертёж.');
  }

  const pair = holeRaw && shaftRaw ? buildPair(holeRaw, shaftRaw) : null;
  const primaryZone = toToleranceZone(firstZoneRaw);
  const fitKind = pair ? pair.fitKind : null;

  return {
    kind: 'fit',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 25346-2013 / ГОСТ 25347-2013 (ISO 286)',
    nominalMm: matched.nominalMm,
    zone: primaryZone,
    pair,
    fitKind,
    explanation: buildExplanation(matched.nominalMm, primaryZone, pair),
    workerAdvice: buildAdvice(matched.nominalMm, firstZoneRaw, pair),
    tools: buildTools(matched.nominalMm, primaryZone, pair),
    warnings,
  };
}

function buildExplanation(nominalMm: number, primary: ToleranceZone, pair: FitPair | null): string {
  const zoneLabel = primary.zoneKind === 'hole' ? 'отверстие' : 'вал';

  if (pair) {
    const { hole, shaft } = pair;
    return [
      `Ø${formatMm(nominalMm)} ${hole.field}/${shaft.field} — посадка в системе отверстия.`,
      `Отверстие: Ø${formatMm(nominalMm)} ${hole.field}, отклонения ${formatSignedUm(hole.lowerUm)} / ${formatSignedUm(hole.upperUm)}, годный размер ${formatMm(hole.minSizeMm)}–${formatMm(hole.maxSizeMm)} мм.`,
      `Вал: Ø${formatMm(nominalMm)} ${shaft.field}, отклонения ${formatSignedUm(shaft.lowerUm)} / ${formatSignedUm(shaft.upperUm)}, годный размер ${formatMm(shaft.minSizeMm)}–${formatMm(shaft.maxSizeMm)} мм.`,
      `Тип посадки: ${FIT_KIND_LABEL[pair.fitKind]}: зазор от ${formatSignedUm(pair.minClearanceUm)} до ${formatSignedUm(pair.maxClearanceUm)} (отрицательный зазор — натяг).`,
    ].join(' ');
  }

  return [
    `Ø${formatMm(nominalMm)} ${primary.field} — ${zoneLabel} Ø${formatMm(nominalMm)} мм, ${primary.grade}-й квалитет.`,
    `Отклонения: нижнее ${formatSignedUm(primary.lowerUm)}, верхнее ${formatSignedUm(primary.upperUm)}.`,
    `Годный размер: ${formatMm(primary.minSizeMm)}–${formatMm(primary.maxSizeMm)} мм, ширина допуска ${formatMm(primary.toleranceUm / 1000)} мм (${primary.toleranceUm} мкм).`,
    'Второе поле посадки не указано: тип посадки определяется сопрягаемой деталью.',
  ].join(' ');
}

function buildAdvice(nominalMm: number, zone: RawZone, pair: FitPair | null): string {
  if (pair) {
    if (pair.fitKind === 'interference') {
      return 'Только пресс или нагрев охватывающей детали до 80–120 °C. Молоток запрещён: забоины и перекос съедают натяг, соединение ослабнет. Перед запрессовкой снимите заусенцы и смажьте поверхности.';
    }
    if (pair.fitKind === 'transition') {
      return 'Собирайте через оправку и лёгкий пресс, без ударов. Перед сборкой проверьте оба размера калибрами: у переходной посадки зазор и натяг соседствуют, ошибка в 5 мкм решает всё.';
    }
    return 'Детали должны собираться от руки или лёгким нажатием. Если вал не входит — не стучите: проверьте заусенцы, фаску и фактический размер микрометром.';
  }

  if (zone.zoneKind === 'hole') {
    if (zone.grade <= 8) {
      return `Отверстие Ø${formatMm(nominalMm)} ${zone.field} обычным сверлом не получить. Сверлите на 0,2–0,3 мм меньше, затем разверните развёрткой ${zone.field} и проверьте калибром-пробкой: он должен входить от руки с лёгким сопротивлением, без люфта.`;
    }
    if (zone.grade === 9) {
      return `Отверстие Ø${formatMm(nominalMm)} ${zone.field} получают зенкерованием или развёртыванием. Контроль — калибр-пробка; штангенциркуль для 9-го квалитета слишком грубый.`;
    }
    return `Отверстие Ø${formatMm(nominalMm)} ${zone.field} — свободный допуск: достаточно сверла/зенкера и штангенциркуля. Снимите заусенцы с обеих сторон.`;
  }

  if (zone.grade <= 7) {
    return `Вал Ø${formatMm(nominalMm)} ${zone.field} — точная посадка. Точите с припуском 0,2–0,3 мм, затем шлифуйте и контролируйте микрометром в трёх сечениях. Наждачная бумага «на глаз» здесь недопустима.`;
  }
  return `Вал Ø${formatMm(nominalMm)} ${zone.field}: чистовое точение и контроль скобой или микрометром. Не измеряйте горячую деталь — размер «уйдёт» после остывания.`;
}

function buildTools(nominalMm: number, zone: ToleranceZone, pair: FitPair | null): RecommendedTool[] {
  const tools: RecommendedTool[] = [];
  const sizeLabel = `Ø${formatMm(nominalMm)}`;
  const holeZone = pair ? pair.hole : zone.zoneKind === 'hole' ? zone : null;
  const shaftZone = pair ? pair.shaft : zone.zoneKind === 'shaft' ? zone : null;

  if (holeZone) {
    if (holeZone.grade <= 8) {
      tools.push({
        name: `Развёртка ${sizeLabel} ${holeZone.field}`,
        category: 'reamer',
        purpose: 'Получение точного отверстия после сверления',
      });
      tools.push({
        name: `Калибр-пробка ${sizeLabel} ${holeZone.field}`,
        category: 'gauge',
        purpose: 'Проверка предельных размеров отверстия',
      });
    } else {
      tools.push({
        name: `Сверло / зенкер ${sizeLabel}`,
        category: 'drill',
        purpose: 'Черновое получение отверстия',
      });
      tools.push({
        name: 'Штангенциркуль 0–150 мм',
        category: 'caliper',
        purpose: 'Контроль свободного допуска',
      });
    }
  }

  if (shaftZone) {
    tools.push({
      name: shaftZone.grade <= 7 ? 'Микрометр 0–25 / 25–50 мм' : 'Скоба рычажная',
      category: shaftZone.grade <= 7 ? 'micrometer' : 'gauge',
      purpose: 'Контроль диаметра вала в нескольких сечениях',
    });
  }

  if (pair && pair.fitKind !== 'clearance') {
    tools.push({
      name: 'Пресс или оправка для запрессовки',
      category: 'press',
      purpose: 'Сборка без ударов и перекосов',
    });
  }

  tools.push({
    name: 'Напильник / шабер (снятие заусенцев)',
    category: 'deburr',
    purpose: 'Подготовка кромок перед контролем и сборкой',
  });

  return tools;
}
