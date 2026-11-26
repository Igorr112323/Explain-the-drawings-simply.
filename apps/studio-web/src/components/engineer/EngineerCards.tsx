import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { pluralRu } from '@ikguide/gost-translator';
import { moveStep, type IkGuideDocument, type GuideStep } from '@ikguide/schema';
import { useStudio } from '../../state/studio';
import { StepArt } from '../common/StepArt';
import { BomGlyph, ToolGlyph } from '../common/Glyphs';

export interface CanvasPosition {
  x: number;
  y: number;
}

interface StepCanvasCardProps {
  step: GuideStep;
  index: number;
  position: CanvasPosition;
  total: number;
  isFocused: boolean;
  onDragStart: (event: ReactPointerEvent<HTMLElement>, stepId: string) => void;
  onFocus: () => void;
}

export function StepCanvasCard({ step, index, position, total, isFocused, onDragStart, onFocus }: StepCanvasCardProps) {
  const { dispatch } = useStudio();
  const [antiDraft, setAntiDraft] = useState('');
  const [editingAnti, setEditingAnti] = useState(false);
  const [severity, setSeverity] = useState<'warning' | 'critical'>('warning');

  const patch = (updater: (doc: IkGuideDocument) => IkGuideDocument) => dispatch({ type: 'PATCH_DOC', updater });

  const updateStep = (changes: Partial<GuideStep>) => {
    patch((doc) => ({
      ...doc,
      steps: doc.steps.map((item) => (item.id === step.id ? { ...item, ...changes } : item)),
    }));
  };

  const reorder = (direction: -1 | 1) => {
    patch((doc) => ({ ...doc, steps: moveStep(doc.steps, index, index + direction) }));
  };

  return (
    <article
      className={`canvas-card step-canvas-card ${isFocused ? 'is-focused' : ''}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      <header className="canvas-card-head" onPointerDown={(event) => onDragStart(event, step.id)}>
        <span className="step-chip">Шаг {step.number}</span>
        <span className="drag-handle" aria-hidden="true">
          ⠿
        </span>
        <span className="muted small">{step.estimatedMinutes} мин</span>
        <div className="card-reorder">
          <button
            type="button"
            className="icon-button"
            onClick={() => reorder(-1)}
            disabled={index === 0}
            aria-label="Поставить шаг раньше"
            title="Раньше"
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => reorder(1)}
            disabled={index === total - 1}
            aria-label="Поставить шаг позже"
            title="Позже"
          >
            ↓
          </button>
        </div>
      </header>

      <div className="canvas-card-body">
        <label className="field">
          <span className="field-label">Заголовок шага</span>
          <input
            className="inline-input inline-title"
            value={step.title}
            onChange={(event) => updateStep({ title: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </label>

        <label className="field">
          <span className="field-label">Текст для рабочего</span>
          <textarea
            className="inline-input inline-text"
            value={step.workerText}
            rows={4}
            onChange={(event) => updateStep({ workerText: event.target.value })}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </label>

        <div className="canvas-art">
          <StepArt illustration={step.illustration} compact />
        </div>

        {step.criticalChecks.length > 0 ? (
          <div className="canvas-checks">
            <span className="field-label">Контрольные размеры</span>
            <ul>
              {step.criticalChecks.map((check) => (
                <li key={check.id}>
                  <span className="check-nominal">{check.nominal}</span>
                  <span className="check-acceptance">{check.acceptance}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step.antiError ? (
          <div className={`canvas-anti anti-${step.antiError.severity}`}>
            <div className="canvas-anti-head">
              <span>Анти-ошибка · {step.antiError.severity === 'critical' ? 'критично' : 'важно'}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => updateStep({ antiError: null })}
                aria-label="Удалить анти-ошибку"
                title="Удалить"
              >
                ✕
              </button>
            </div>
            <textarea
              className="inline-input inline-anti"
              value={step.antiError.text}
              rows={2}
              onChange={(event) =>
                updateStep({ antiError: { text: event.target.value, severity: step.antiError?.severity ?? 'warning' } })
              }
              onPointerDown={(event) => event.stopPropagation()}
            />
          </div>
        ) : editingAnti ? (
          <div className="canvas-anti anti-warning">
            <textarea
              className="inline-input inline-anti"
              value={antiDraft}
              rows={2}
              placeholder="Что рабочий сделает не так и к чему это приведёт?"
              onChange={(event) => setAntiDraft(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
              autoFocus
            />
            <div className="row gap-8 anti-controls">
              <select
                value={severity}
                onChange={(event) => setSeverity(event.target.value === 'critical' ? 'critical' : 'warning')}
                aria-label="Важность анти-ошибки"
              >
                <option value="warning">важно</option>
                <option value="critical">критично</option>
              </select>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  if (antiDraft.trim().length === 0) {
                    return;
                  }
                  updateStep({ antiError: { text: antiDraft.trim(), severity } });
                  setAntiDraft('');
                  setEditingAnti(false);
                }}
              >
                Сохранить
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setEditingAnti(false);
                  setAntiDraft('');
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="add-anti-button" onClick={() => setEditingAnti(true)}>
            + Добавить анти-ошибку
          </button>
        )}

        {step.drawingRefs.length > 0 ? (
          <p className="muted small">Обозначений на чертеже: {step.drawingRefs.length}</p>
        ) : null}
      </div>
    </article>
  );
}

export function SummaryCard({ position }: { position: CanvasPosition }) {
  const { doc, stats, unconfirmed } = useStudio();
  return (
    <article className="canvas-card summary-card" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      <header className="canvas-card-head">
        <span className="step-chip chip-blue">Инструкция</span>
      </header>
      <div className="canvas-card-body">
        <h2 className="summary-title">{doc.metadata.title}</h2>
        <p className="muted">{doc.metadata.assemblyUnit ?? doc.metadata.material}</p>
        <dl className="summary-grid">
          <div>
            <dt>Чертёж</dt>
            <dd>{doc.metadata.drawingCode}</dd>
          </div>
          <div>
            <dt>Ревизия</dt>
            <dd>{doc.metadata.revision}</dd>
          </div>
          <div>
            <dt>Материал</dt>
            <dd>{doc.metadata.material}</dd>
          </div>
          <div>
            <dt>Заготовка</dt>
            <dd>{doc.metadata.blankDimensions}</dd>
          </div>
          <div>
            <dt>Шагов</dt>
            <dd>{stats.stepCount}</dd>
          </div>
          <div>
            <dt>Время</dt>
            <dd>≈ {stats.totalMinutes} мин</dd>
          </div>
        </dl>
        <div className={`summary-status ${unconfirmed.length === 0 ? 'is-ok' : 'is-warn'}`}>
          {unconfirmed.length === 0
            ? 'Все обозначения подтверждены'
            : `${unconfirmed.length} ${pluralRu(unconfirmed.length, 'обозначение требует', 'обозначения требуют', 'обозначений требуют')} подтверждения`}
        </div>
      </div>
    </article>
  );
}

export function BomCanvasCard({ position }: { position: CanvasPosition }) {
  const { doc, dispatch } = useStudio();
  return (
    <article className="canvas-card list-card" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      <header className="canvas-card-head">
        <span className="step-chip chip-green">Комплектация и крепёж</span>
        <span className="muted small">{doc.bom.length}</span>
      </header>
      <div className="canvas-card-body">
        <ul className="canvas-bom">
          {doc.bom.map((item) => (
            <li key={item.id}>
              <span className="bom-icon">
                <BomGlyph icon={item.icon} />
              </span>
              <span className="bom-main">
                <span className="bom-name">{item.name}</span>
                <span className="bom-size">{item.size}</span>
              </span>
              <span className="bom-qty">×{item.quantity}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="link-button"
          onClick={() => dispatch({ type: 'SET_MODE', mode: 'worker' })}
        >
          Проверить глазами рабочего →
        </button>
      </div>
    </article>
  );
}

export function ToolsCanvasCard({ position }: { position: CanvasPosition }) {
  const { doc } = useStudio();
  return (
    <article className="canvas-card list-card" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      <header className="canvas-card-head">
        <span className="step-chip chip-orange">Инструмент</span>
        <span className="muted small">{doc.tools.length}</span>
      </header>
      <div className="canvas-card-body">
        <ul className="canvas-tools">
          {doc.tools.map((tool) => (
            <li key={tool.id}>
              <span className="tool-icon">
                <ToolGlyph category={tool.category} />
              </span>
              <span className="tool-main">
                <span className="tool-title">{tool.name}</span>
                <span className="tool-sub">{tool.size ?? tool.purpose}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
