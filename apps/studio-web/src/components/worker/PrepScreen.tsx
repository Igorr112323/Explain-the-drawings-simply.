import { pluralRu } from '@ikguide/gost-translator';
import { useStudio } from '../../state/studio';
import { WorkerHeader, UncertaintyBanner } from './WorkerChrome';
import { BomGlyph, ToolGlyph } from '../common/Glyphs';

interface SpecRow {
  name: string;
  size: string;
  quantity: number;
  stepNumbers: number[];
  role: string;
}

/** Groups the 3D parts into a human-readable specification: «Болт М6x20 — 4 шт, шаг 6». */
function buildSpec(parts: NonNullable<ReturnType<typeof useStudio>['doc']['assembly3d']>['parts']): SpecRow[] {
  const rows = new Map<string, SpecRow>();
  for (const part of parts) {
    const size = part.bboxMm
      ? `${Math.round(part.bboxMm.x)}×${Math.round(part.bboxMm.y)}×${Math.round(part.bboxMm.z)} мм`
      : '—';
    const key = part.displayName;
    const row = rows.get(key);
    if (row) {
      row.quantity += 1;
      if (!row.stepNumbers.includes(part.stepNumber)) {
        row.stepNumbers.push(part.stepNumber);
      }
    } else {
      rows.set(key, {
        name: part.displayName,
        size,
        quantity: 1,
        stepNumbers: [part.stepNumber],
        role: part.role,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.stepNumbers[0]! - b.stepNumbers[0]!);
}

export function PrepScreen() {
  const { doc, dispatch, stats } = useStudio();
  const assembly = doc.assembly3d ?? null;
  const spec = assembly ? buildSpec(assembly.parts) : [];

  return (
    <div className="screen">
      <WorkerHeader
        title="Перед началом работы"
        subtitle={`${doc.metadata.drawingCode} · ревизия ${doc.metadata.revision}`}
        onBack={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
      />

      <UncertaintyBanner onOpen={() => dispatch({ type: 'SET_SCREEN', screen: 'verify' })} />

      <section className="card prep-blank">
        <h2>{doc.metadata.title}</h2>
        {doc.metadata.assemblyUnit ? <p className="muted">{doc.metadata.assemblyUnit}</p> : null}
        <dl className="prep-facts">
          <div>
            <dt>Материал</dt>
            <dd>{doc.metadata.material}</dd>
          </div>
          <div>
            <dt>Заготовка</dt>
            <dd>{doc.metadata.blankDimensions}</dd>
          </div>
          {doc.metadata.massKg ? (
            <div>
              <dt>Масса</dt>
              <dd>{doc.metadata.massKg} кг</dd>
            </div>
          ) : null}
          <div>
            <dt>Чертёж</dt>
            <dd>
              {doc.metadata.drawingCode} · {doc.drawing.sheetFormat} · {doc.drawing.scale}
            </dd>
          </div>
        </dl>
        <div className="prep-meta">
          <span>{stats.stepCount} шагов</span>
          <span>≈ {stats.totalMinutes} мин</span>
          <span>{doc.metadata.author}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Комплектующие и крепёж</h3>
          <span className="chip chip-neutral">
            {stats.bomLineCount} {pluralRu(stats.bomLineCount, 'позиция', 'позиции', 'позиций')}
          </span>
        </div>
        <ul className="bom-list">
          {doc.bom.map((item) => (
            <li key={item.id}>
              <span className="bom-icon">
                <BomGlyph icon={item.icon} />
              </span>
              <span className="bom-main">
                <span className="bom-name">{item.name}</span>
                <span className="bom-size">
                  {item.size}
                  {item.standard ? ` · ${item.standard}` : ''}
                </span>
                {item.note ? <span className="bom-note">{item.note}</span> : null}
              </span>
              <span className="bom-qty">×{item.quantity}</span>
            </li>
          ))}
        </ul>
      </section>

      {assembly ? (
        <section className="card spec-card">
          <div className="card-head">
            <h3>Спецификация 3D-сборки</h3>
            <span className="chip chip-neutral">
              {assembly.parts.length} {pluralRu(assembly.parts.length, 'деталь', 'детали', 'деталей')}
            </span>
          </div>
          <p className="muted small">
            Габарит сборки {assembly.sizeMm.x} × {assembly.sizeMm.y} × {assembly.sizeMm.z} мм
            {assembly.massKg ? ` · масса ${assembly.massKg} кг` : ''} · формат {assembly.sourceFormat.toUpperCase()}
          </p>
          <ul className="spec-list">
            {spec.map((row) => (
              <li key={row.name} className={`spec-row spec-${row.role}`}>
                <span className="spec-name">{row.name}</span>
                <span className="spec-size">{row.size}</span>
                <span className="spec-step">шаг {row.stepNumbers.join(', ')}</span>
                <span className="spec-qty">×{row.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h3>Инструмент</h3>
          <span className="chip chip-neutral">{doc.tools.length}</span>
        </div>
        <ul className="tool-cards">
          {doc.tools.map((tool) => (
            <li key={tool.id}>
              <span className="tool-icon">
                <ToolGlyph category={tool.category} />
              </span>
              <span className="tool-main">
                <span className="tool-title">
                  {tool.name}
                  {tool.size ? <em> {tool.size}</em> : null}
                </span>
                <span className="tool-sub">{tool.purpose}</span>
              </span>
              <span className="tool-steps">
                {tool.forSteps.length > 0 ? `шаг ${tool.forSteps.join(', ')}` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="notice notice-info">
        <strong>Проверьте стол перед работой.</strong>
        <p>
          Если чего-то из списка нет — не начинайте и не заменяйте инструмент «похожим». Подмена сверла или развёртки
          почти всегда заканчивается браком детали.
        </p>
      </div>

      <button type="button" className="btn btn-primary btn-tall" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'steps' })}>
        Начать по шагам →
      </button>
    </div>
  );
}
