import { WELD_JOINT_NAMES, findWeldJointDesign, recommendedCurrentA } from '../tables/welding';
import { formatMm, parseDecimal } from '../format';
import type { RecommendedTool, WeldTranslation } from '../types';

const JOINT_PATTERN = /([СУТН])\s*(\d{1,2})(?:\s*-\s*[КK]\s*(\d+(?:[.,]\d+)?))?/;
// A bare number is a dimension, not a weld: a leg is only «К5», «K5» or «катет 5».
const STANDALONE_LEG_PATTERN = /^(?:катет\s*[КK]?\s*|[КK]\s*)(\d+(?:[.,]\d+)?)(?:\s*мм)?$/;
const LEG_AFTER_JOINT_PATTERN = /-\s*[КK]\s*(\d+(?:[.,]\d+)?)/;
const INTERMITTENT_PATTERN = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/;
const CLOSED_CONTOUR_PATTERN = /замкнут|по\s+контуру|[◯○⌀∅]/;
const FLUSH_PATTERN = /заподлицо|зачист\w*\s+вровень|снят\w*\s+вровень/;
const REMOVE_REINFORCEMENT_PATTERN = /снять\s+усиление|усиление\s+снят|снят\w*\s+усилие/;

interface WeldPatternMatch {
  jointCode: WeldTranslation['jointCode'];
  jointVariant: number;
  legMm: number | null;
  seamLengthMm: number | null;
  seamPitchMm: number | null;
  closedContour: boolean;
  flush: boolean;
  removeReinforcement: boolean;
}

export function matchWeld(normalized: string): WeldPatternMatch | null {
  const jointMatch = JOINT_PATTERN.exec(normalized);
  const legOnlyMatch = STANDALONE_LEG_PATTERN.exec(normalized);
  const legAfterJointMatch = LEG_AFTER_JOINT_PATTERN.exec(normalized);
  const intermittentMatch = INTERMITTENT_PATTERN.exec(normalized);
  const closedContour = CLOSED_CONTOUR_PATTERN.test(normalized);
  const flush = FLUSH_PATTERN.test(normalized);
  const removeReinforcement = REMOVE_REINFORCEMENT_PATTERN.test(normalized);

  const hasJointCode = jointMatch !== null;
  const hasLeg = legOnlyMatch !== null;
  const hasModifier = closedContour || flush || removeReinforcement;
  if (!hasJointCode && !hasLeg && !hasModifier) {
    return null;
  }

  const legFromJoint = jointMatch?.[3] ? parseDecimal(jointMatch[3]) : null;
  const legFromStandalone = legOnlyMatch?.[1] ? parseDecimal(legOnlyMatch[1]) : null;
  const legFromSuffix = legAfterJointMatch?.[1] ? parseDecimal(legAfterJointMatch[1]) : null;
  const legFromAnywhere = legFromJoint ?? legFromSuffix;
  const legMm = legFromAnywhere ?? (hasJointCode || hasModifier ? null : legFromStandalone);

  const rawCode = jointMatch?.[1] ?? null;
  const jointCode = rawCode ? normalizeJointCode(rawCode) : null;
  const variantRaw = jointMatch?.[2];
  const jointVariant = variantRaw ? Number(variantRaw) : null;

  return {
    jointCode,
    jointVariant: jointVariant ?? 0,
    legMm,
    seamLengthMm: intermittentMatch?.[1] ? parseDecimal(intermittentMatch[1]) : null,
    seamPitchMm: intermittentMatch?.[2] ? parseDecimal(intermittentMatch[2]) : null,
    closedContour,
    flush,
    removeReinforcement,
  };
}

function normalizeJointCode(code: string): WeldTranslation['jointCode'] {
  const map: Record<string, WeldTranslation['jointCode']> = {
    С: 'С',
    У: 'У',
    Т: 'Т',
    Н: 'Н',
  };
  return map[code] ?? null;
}

export function parseWeld(normalized: string): WeldTranslation | null {
  const matched = matchWeld(normalized);
  if (!matched) {
    return null;
  }

  const { jointCode, jointVariant } = matched;
  const designation = jointCode && jointVariant ? `${jointCode}${jointVariant}` : null;
  const design = designation ? findWeldJointDesign(designation) : undefined;
  const warnings: string[] = [];

  if (jointCode && jointVariant && !design) {
    warnings.push(
      `Тип соединения ${designation} отсутствует во встроенной таблице ГОСТ 5264-80. Описание дано по буквенному коду, геометрию кромок уточните по чертежу.`,
    );
  }

  if (matched.seamLengthMm !== null && matched.seamPitchMm !== null && matched.seamPitchMm <= matched.seamLengthMm) {
    warnings.push('Шаг прерывистого шва должен быть больше длины провариваемого участка — проверьте обозначение.');
  }

  if (matched.legMm !== null && matched.legMm <= 0) {
    warnings.push('Катет шва должен быть больше нуля — проверьте обозначение.');
  }

  const jointName = design?.jointName ?? (jointCode ? WELD_JOINT_NAMES[jointCode] : null);
  const electrodeDiameter = matched.legMm !== null ? pickElectrode(matched.legMm) : 3;
  const currentRange = recommendedCurrentA(electrodeDiameter);

  return {
    kind: 'weld',
    raw: normalized,
    normalized,
    standard: 'ГОСТ 5264-80 (типы соединений), ГОСТ 2.312-72 (обозначения швов)',
    jointCode,
    jointVariant: jointVariant && jointVariant > 0 ? jointVariant : null,
    jointName,
    legMm: matched.legMm,
    seamLengthMm: matched.seamLengthMm,
    seamPitchMm: matched.seamPitchMm,
    closedContour: matched.closedContour,
    flush: matched.flush,
    removeReinforcement: matched.removeReinforcement,
    explanation: buildExplanation(normalized, matched, design, jointName, designation),
    welderInstruction: buildInstruction(matched, design, electrodeDiameter, currentRange),
    workerAdvice:
      'Держите дугу короткой, кратер в конце шва выведите на основной металл и заварите. После остывания проверьте катет шаблоном УШС — «на глаз» катет занижают почти всегда.',
    tools: buildTools(electrodeDiameter),
    warnings,
  };
}

function pickElectrode(legMm: number): number {
  if (legMm <= 3) {
    return 2.5;
  }
  if (legMm <= 5) {
    return 3;
  }
  if (legMm <= 8) {
    return 4;
  }
  return 5;
}

type DesignLike =
  | {
      edgePreparation: string;
      seamType: string;
      description: string;
      designation: string;
      jointName: string;
    }
  | undefined;

function buildExplanation(
  normalized: string,
  matched: WeldPatternMatch,
  design: DesignLike,
  jointName: string | null,
  designation: string | null,
): string {
  const parts: string[] = [];
  if (design) {
    parts.push(
      `${designation} — ${design.jointName.toLowerCase()} ${design.edgePreparation}, ${design.seamType} шов по ГОСТ 5264-80.`,
    );
    parts.push(`По-простому: ${design.description}.`);
  } else if (jointName) {
    parts.push(`${normalized} — ${jointName.toLowerCase()} по ГОСТ 5264-80.`);
  } else {
    parts.push(`${normalized} — обозначение сварного шва по ГОСТ 2.312-72.`);
  }

  if (matched.legMm !== null) {
    parts.push(
      `Катет шва К${formatMm(matched.legMm)} — это катет равнобедренного треугольника шва; ножка валика должна быть не меньше ${formatMm(matched.legMm)} мм.`,
    );
  }
  if (matched.seamLengthMm !== null && matched.seamPitchMm !== null) {
    parts.push(
      `Шов прерывистый: провариваем ${formatMm(matched.seamLengthMm)} мм, пропускаем ${formatMm(matched.seamPitchMm)} мм (шаг ${formatMm(matched.seamPitchMm)} мм).`,
    );
  }
  if (matched.closedContour) {
    parts.push('Шов по замкнутому контуру: варить без разрыва, кольцом.');
  }
  if (matched.flush) {
    parts.push('Заподлицо: после сварки снять усиление шва и зачистить поверхность вровень с основным металлом.');
  } else if (matched.removeReinforcement) {
    parts.push('Знак снятия усиления: валик срезать/зачистить до плоскости детали.');
  }
  return parts.join(' ');
}

function buildInstruction(
  matched: WeldPatternMatch,
  design: DesignLike,
  electrodeDiameter: number,
  currentRange: [number, number],
): string {
  const steps: string[] = [];
  steps.push('Зачистите кромки и прилегающую зону 20–30 мм до чистого металла, обезжирьте.');
  steps.push('Соберите детали без зазора и прихватите в 3–4 точках, проверьте геометрию.');
  if (design) {
    steps.push(`Варите ${design.edgePreparation} с ${design.seamType} стороны.`);
  }
  if (matched.legMm !== null) {
    steps.push(
      `Катет ${formatMm(matched.legMm)} мм: электрод Ø${formatMm(electrodeDiameter)} мм, ток ${currentRange[0]}–${currentRange[1]} А, угол наклона держателя 30–45°.`,
    );
  } else {
    steps.push(`Электрод Ø${formatMm(electrodeDiameter)} мм, ток ${currentRange[0]}–${currentRange[1]} А.`);
  }
  if (matched.seamLengthMm !== null && matched.seamPitchMm !== null) {
    steps.push(
      `На каждом участке проваривайте ровно ${formatMm(matched.seamLengthMm)} мм, затем отступите ${formatMm(matched.seamPitchMm)} мм.`,
    );
  }
  if (matched.closedContour) {
    steps.push('Замкните контур полностью, перекрыв начало шва на 10–15 мм.');
  }
  steps.push('После остывания удалите шлак, проверьте катет шаблоном сварщика УШС и зачистите брызги.');
  if (matched.flush) {
    steps.push('Снимите усиление шва заподлицо шлифмашиной, не прорезая основной металл.');
  }
  return steps.join(' ');
}

function buildTools(electrodeDiameter: number): RecommendedTool[] {
  return [
    {
      name: `Электроды Ø${formatMm(electrodeDiameter)} мм (например, УОНИ-13/55)`,
      category: 'welding',
      purpose: 'Ручная дуговая сварка',
    },
    {
      name: 'Сварочный инвертор',
      category: 'welding',
      purpose: 'Источник тока с регулировкой',
    },
    {
      name: 'Шаблон сварщика УШС-3',
      category: 'gauge',
      purpose: 'Контроль катета и усиления шва',
    },
    {
      name: 'Щётка по металлу, молоток-шлакоотделитель, маска-хамелеон',
      category: 'consumable',
      purpose: 'Зачистка, удаление шлака, защита глаз',
    },
  ];
}
