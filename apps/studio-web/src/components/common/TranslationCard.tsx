import type { TranslationResult } from '@ikguide/gost-translator';
import { formatMm, formatSignedMm, formatSignedUm } from '@ikguide/gost-translator';

const KIND_LABEL: Readonly<Record<TranslationResult['kind'], string>> = {
  thread: 'Резьба',
  fit: 'Допуск / посадка',
  roughness: 'Шероховатость',
  weld: 'Сварной шов',
  chamfer: 'Фаска',
  radius: 'Радиус',
  holeGroup: 'Группа отверстий',
  dimension: 'Размер',
  unknown: 'Не распознано',
};

export function kindLabel(kind: TranslationResult['kind']): string {
  return KIND_LABEL[kind];
}

interface Fact {
  label: string;
  value: string;
}

function keyFacts(result: TranslationResult): Fact[] {
  switch (result.kind) {
    case 'thread': {
      const facts: Fact[] = [
        { label: 'Номинал', value: `М${formatMm(result.diameterMm)} × ${formatMm(result.pitchMm)}` },
        { label: 'Шаг', value: result.pitchKind === 'fine' ? 'мелкий' : 'основной' },
      ];
      if (result.tapDrillMm !== null) {
        const range = result.tapDrillRangeMm
          ? ` (${formatMm(result.tapDrillRangeMm[0])}–${formatMm(result.tapDrillRangeMm[1])})`
          : '';
        facts.push({ label: 'Сверло под резьбу', value: `Ø${formatMm(result.tapDrillMm)}${range} мм` });
      }
      if (result.blankRodMm !== null) {
        facts.push({ label: 'Заготовка под резьбу', value: `Ø${formatMm(result.blankRodMm)} мм` });
      }
      facts.push({ label: 'Проходное отверстие', value: `Ø${formatMm(result.clearanceHoleMm)} мм` });
      if (result.wrenchSizeMm !== null) {
        facts.push({ label: 'Ключ', value: `${formatMm(result.wrenchSizeMm)} мм` });
      }
      if (result.threadDepthMm !== null) {
        facts.push({ label: 'Глубина резьбы', value: `${formatMm(result.threadDepthMm)} мм` });
      }
      if (result.holeCount !== null) {
        facts.push({ label: 'Количество', value: `${result.holeCount} отв.` });
      }
      return facts;
    }
    case 'fit': {
      const facts: Fact[] = [
        { label: 'Номинал', value: `Ø${formatMm(result.nominalMm)} мм` },
        { label: 'Поле допуска', value: result.zone.field },
        { label: 'Годный размер', value: `${formatMm(result.zone.minSizeMm)}…${formatMm(result.zone.maxSizeMm)} мм` },
        { label: 'Допуск', value: `${formatMm(result.zone.toleranceUm / 1000)} мм (${result.zone.toleranceUm} мкм)` },
        { label: 'Отклонения', value: `${formatSignedUm(result.zone.lowerUm)} / ${formatSignedUm(result.zone.upperUm)}` },
      ];
      if (result.pair) {
        facts.push({
          label: 'Зазор / натяг',
          value: `${formatSignedUm(result.pair.minClearanceUm)} … ${formatSignedUm(result.pair.maxClearanceUm)}`,
        });
      }
      return facts;
    }
    case 'roughness':
      return [
        { label: 'Параметр', value: `${result.parameter} ${formatMm(result.valueUm)} мкм` },
        { label: 'Класс', value: `${result.surfaceClass}-й по ГОСТ 2789-73` },
        { label: 'Эквивалент Ra', value: `${formatMm(result.raEquivalentUm)} мкм` },
        { label: 'Обработка', value: result.processing },
      ];
    case 'weld': {
      const facts: Fact[] = [];
      if (result.jointName) {
        facts.push({ label: 'Соединение', value: result.jointName });
      }
      if (result.legMm !== null) {
        facts.push({ label: 'Катет шва', value: `К${formatMm(result.legMm)} = ${formatMm(result.legMm)} мм` });
      }
      if (result.seamLengthMm !== null && result.seamPitchMm !== null) {
        facts.push({ label: 'Прерывистый шов', value: `${formatMm(result.seamLengthMm)} / ${formatMm(result.seamPitchMm)} мм` });
      }
      if (result.closedContour) {
        facts.push({ label: 'Контур', value: 'замкнутый' });
      }
      if (result.flush) {
        facts.push({ label: 'Зачистка', value: 'заподлицо' });
      }
      return facts;
    }
    case 'chamfer':
      return [
        { label: 'Катет фаски', value: `${formatMm(result.legMm)} мм` },
        { label: 'Угол', value: `${formatMm(result.angleDeg, 1)}°` },
      ];
    case 'radius':
      return [{ label: 'Радиус', value: `R${formatMm(result.radiusMm)} мм` }];
    case 'holeGroup':
      return [
        { label: 'Количество', value: `${result.holeCount} отв.` },
        { label: 'Диаметр', value: `Ø${formatMm(result.diameterMm)} мм` },
        { label: 'Сверло', value: `Ø${formatMm(result.recommendedDrillMm)} мм` },
      ];
    case 'dimension': {
      const facts: Fact[] = [{ label: 'Номинал', value: `${formatMm(result.nominalMm)} мм` }];
      if (result.upperDeviationMm !== null && result.lowerDeviationMm !== null) {
        facts.push({
          label: 'Отклонения',
          value: `${formatSignedMm(result.upperDeviationMm * 1000)} / ${formatSignedMm(result.lowerDeviationMm * 1000)} мм`,
        });
        if (result.minSizeMm !== null && result.maxSizeMm !== null) {
          facts.push({ label: 'Годный размер', value: `${formatMm(result.minSizeMm)}…${formatMm(result.maxSizeMm)} мм` });
        }
      }
      return facts;
    }
    case 'unknown':
      return [];
    default:
      return [];
  }
}

export function TranslationCard({ result, compact = false }: { result: TranslationResult; compact?: boolean }) {
  const facts = keyFacts(result);
  return (
    <article className={`translation translation-${result.kind} ${compact ? 'translation-compact' : ''}`}>
      <header className="translation-head">
        <div>
          <div className="translation-raw">{result.raw.trim()}</div>
          <div className="translation-standard">{result.standard ?? 'ГОСТ/ЕСКД'}</div>
        </div>
        <span className={`chip chip-${result.kind}`}>{kindLabel(result.kind)}</span>
      </header>

      <p className="translation-explanation">{result.explanation}</p>

      {facts.length > 0 ? (
        <dl className="fact-grid">
          {facts.map((fact) => (
            <div key={fact.label} className="fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {result.tools.length > 0 ? (
        <div className="translation-block">
          <h4>Что понадобится</h4>
          <ul className="tool-list">
            {result.tools.map((tool) => (
              <li key={`${tool.category}-${tool.name}`}>
                <span className="tool-name">{tool.name}</span>
                <span className="tool-purpose">{tool.purpose}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="translation-advice">
        <h4>Совет рабочему</h4>
        <p>{result.workerAdvice}</p>
      </div>

      {result.warnings.length > 0 ? (
        <ul className="warning-list">
          {result.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
