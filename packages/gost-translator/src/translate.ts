import { normalizeNotation } from './format';
import { parseFit } from './parsers/fit';
import { parseChamfer, parseDimension, parseHoleGroup, parseRadius } from './parsers/misc';
import { parseRoughness } from './parsers/roughness';
import { parseThread } from './parsers/thread';
import { parseWeld } from './parsers/weld';
import type { TranslationResult } from './types';

export const TRANSLATOR_VERSION = '1.0.0';

type Parser = (normalized: string) => TranslationResult | null;

/**
 * Order matters: specific notations must be tried before generic ones.
 * Roughness (Ra/Rz) → welds (С/У/Т/Н, К) → threads (М) → fits (H7, h6, k6…)
 * → chamfers (2×45°) → radii (R3) → hole groups (4 отв. Ø6,5) → plain dimensions.
 */
const PARSERS: readonly Parser[] = [
  parseRoughness,
  parseWeld,
  parseThread,
  parseFit,
  parseChamfer,
  parseRadius,
  parseHoleGroup,
  parseDimension,
];

/**
 * Deterministic translation of a GOST/ESKD notation into plain Russian engineering language.
 * No LLM, no network calls: the same input always produces the same output.
 */
export function translateEngineeringNotation(raw: string): TranslationResult {
  const normalized = normalizeNotation(raw);
  if (normalized.length === 0) {
    return buildUnknown(raw, 'Пустое обозначение: введите текст с чертежа, например «Ø20 H7» или «М8-7H».');
  }

  for (const parse of PARSERS) {
    const result = parse(normalized);
    if (result) {
      return { ...result, raw };
    }
  }

  return buildUnknown(raw, buildHint(normalized));
}

export function translateMany(notations: readonly string[]): TranslationResult[] {
  return notations.map((notation) => translateEngineeringNotation(notation));
}

function buildHint(normalized: string): string {
  if (/^[Ø]?\s*\d+(?:[.,]\d+)?\s*[A-Za-zА-Яа-я]{1,2}\s*\d{1,2}$/.test(normalized)) {
    return 'Похоже на поле допуска, но его нет во встроенной таблице ГОСТ 25346. Поддерживаются: H6, H7, H8, H9, H11, H12, H14, h6, h7, h9, h11, k6, js7, g6, f7, d9 для номиналов 1–500 мм.';
  }
  if (/[МM]\s*\d/.test(normalized)) {
    return 'Похоже на обозначение резьбы. Поддерживаются форматы: М8, М8-7H, М10×1,25, М12-6g, «4 отв. М6-7H глуб. 15».';
  }
  if (/Ra|Rz/i.test(normalized)) {
    return 'Похоже на шероховатость. Поддерживаются форматы: Ra 0.8, Ra 1,6, Rz 20.';
  }
  return 'Формат не распознан. Примеры, которые понимает переводчик: «Ø20 H7», «Ø32 H7/k6», «4 отв. М8-7H глуб. 20», «Ra 1.6», «Т1-К5», «2×45°», «R3», «4 отв. Ø6,5», «120±0,5».';
}

function buildUnknown(raw: string, explanation: string): TranslationResult {
  return {
    kind: 'unknown',
    raw,
    normalized: normalizeNotation(raw),
    standard: null,
    explanation,
    workerAdvice: 'Уточните обозначение у инженера или введите его вручную в поле «Проверить любой шифр ГОСТ».',
    tools: [],
    warnings: [explanation],
  };
}
