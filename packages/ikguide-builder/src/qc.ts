import type { CriticalCheck } from '@ikguide/schema';
import type { TranslationResult } from '@ikguide/gost-translator';
import { mm, mmFixed } from './format';

export interface QcDraft {
  text: string;
  reference?: string;
}

const GOST_THREAD = 'ГОСТ 24705-2004';
const GOST_FITS = 'ГОСТ 25346-2013';
const GOST_ROUGHNESS = 'ГОСТ 2789-73';
const GOST_WELD = 'ГОСТ 14771-76';

/** One control point per critical notation. Ordinary free dimensions do not need a QC line. */
export function qcForTranslation(result: TranslationResult): QcDraft | null {
  switch (result.kind) {
    case 'thread':
      return {
        text: `Проверить резьбу ${result.designation} калибром-пробкой; отверстие под резьбу — Ø${mm(result.tapDrillMm ?? 0)} мм.`,
        reference: GOST_THREAD,
      };
    case 'fit': {
      const range = `${mmFixed(result.zone.minSizeMm)}…${mmFixed(result.zone.maxSizeMm)} мм`;
      return {
        text: `Проверить Ø${mm(result.nominalMm)} ${result.zone.field}: размер ${range}, поле допуска ${result.zone.field}.`,
        reference: GOST_FITS,
      };
    }
    case 'holeGroup':
      return {
        text: `Проверить ${result.holeCount} отв. Ø${mm(result.diameterMm)}: сверло Ø${mm(result.recommendedDrillMm)} мм, допуск по чертежу.`,
      };
    case 'roughness':
      return {
        text: `Проверить шероховатость ${result.parameter} ${mm(result.valueUm, 2)} мкм (${result.surfaceClassLabel}) по образцам сравнения.`,
        reference: GOST_ROUGHNESS,
      };
    case 'weld':
      return {
        text: `Проверить шов ${result.raw}: катет ${result.legMm === null ? 'по чертежу' : `${mm(result.legMm)} мм`}, шаблон сварщика УШС-3.`,
        reference: GOST_WELD,
      };
    case 'chamfer':
      return {
        text: `Проверить фаску ${mm(result.legMm)}×${mm(result.angleDeg, 0)}° по всему контуру.`,
      };
    case 'radius':
      return { text: `Проверить радиус R${mm(result.radiusMm)} радиусным шаблоном.` };
    case 'dimension':
      if (result.minSizeMm !== null && result.maxSizeMm !== null) {
        return {
          text: `Проверить размер ${result.raw}: допустимо ${mm(result.minSizeMm)}…${mm(result.maxSizeMm)} мм.`,
        };
      }
      return null;
    case 'unknown':
      return null;
    default:
      return null;
  }
}

/** Critical checks shown inside a step card; only toleranced holes, threads and surfaces qualify. */
export function criticalCheckFor(result: TranslationResult, idSeed: string): CriticalCheck | null {
  switch (result.kind) {
    case 'thread':
      return {
        id: `check-${idSeed}-thread`,
        label: `Резьба ${result.designation}`,
        nominal: result.designation,
        acceptance: result.toleranceClass
          ? `Резьба ${result.toleranceClass} проходит калибр-пробку`
          : 'Резьба проходит калибр-пробку по чертежу',
        instrument: `Калибр-пробка резьбовой ${result.designation}`,
      };
    case 'fit':
      return {
        id: `check-${idSeed}-fit`,
        label: `Отверстие Ø${mm(result.nominalMm)} ${result.zone.field}`,
        nominal: result.raw,
        acceptance: `${mmFixed(result.zone.minSizeMm)}…${mmFixed(result.zone.maxSizeMm)} мм`,
        instrument:
          result.zone.field === result.zone.field.toUpperCase()
            ? `Калибр-пробка Ø${mm(result.nominalMm)} ${result.zone.field}`
            : `Микрометр / скоба ${result.zone.field}`,
      };
    case 'holeGroup':
      return {
        id: `check-${idSeed}-holes`,
        label: `${result.holeCount} отверстий Ø${mm(result.diameterMm)}`,
        nominal: `Ø${mm(result.diameterMm)} × ${result.holeCount}`,
        acceptance: `Ø${mm(result.diameterMm)} по чертежу, межцентровые размеры ±0,2 мм`,
        instrument: 'Штангенциркуль 0–150 мм',
      };
    case 'roughness':
      return {
        id: `check-${idSeed}-roughness`,
        label: `Шероховатость ${result.parameter} ${mm(result.valueUm, 2)}`,
        nominal: `${result.parameter} ${mm(result.valueUm, 2)} мкм`,
        acceptance: `Не грубее ${result.parameter} ${mm(result.valueUm, 2)} мкм`,
        instrument: 'Профилометр или образцы шероховатости ГОСТ 9378-93',
      };
    case 'weld':
      return {
        id: `check-${idSeed}-weld`,
        label: `Шов ${result.raw}`,
        nominal: result.legMm === null ? result.raw : `Катет ${mm(result.legMm)} мм`,
        acceptance: 'Без подрезов, пор и незаваренных кратеров',
        instrument: 'Шаблон сварщика УШС-3, визуальный контроль',
      };
    case 'chamfer':
      return {
        id: `check-${idSeed}-chamfer`,
        label: `Фаска ${mm(result.legMm)}×${mm(result.angleDeg, 0)}°`,
        nominal: `${mm(result.legMm)} мм`,
        acceptance: `Фаска ${mm(result.legMm)} ±0,3 мм, угол ${mm(result.angleDeg, 0)}°`,
        instrument: 'Штангенциркуль, угломер',
      };
    case 'dimension':
    case 'radius':
    case 'unknown':
      return null;
    default:
      return null;
  }
}
