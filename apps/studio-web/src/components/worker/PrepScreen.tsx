import { pluralRu } from '@ikguide/gost-translator';
import { useStudio } from '../../state/studio';
import { WorkerHeader, UncertaintyBanner } from './WorkerChrome';
import { BomGlyph, ToolGlyph } from '../common/Glyphs';

export function PrepScreen() {
  const { doc, dispatch, stats } = useStudio();

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
