import { useEffect, useMemo, useRef, useState } from 'react';
import type { GuideStep, XrayAnnotation } from '@ikguide/schema';
import { translateEngineeringNotation } from '@ikguide/gost-translator';
import type { PipelineApi } from '../state/pipeline';
import { buildPlan } from '../lib/pdfExport';
import { saveLabel } from '../lib/nativeExport';
import { InlineEdit } from './InlineEdit';
import { PagePreview } from './PagePreview';
import { SheetCard } from './SheetCard';

const shortTitle = (title: string) => (title.length > 28 ? `${title.slice(0, 27)}…` : title);

/** Жёлтая плашка: распознавание не уверено в размере — исправляем одним кликом. */
function SizeBanner({ api }: { api: PipelineApi }) {
  const items = api.ambiguous;
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="banner banner-warn" role="status">
      <div className="banner-text">
        <strong>Проверьте размеры.</strong>{' '}
        {items.length === 1 ? 'Один размер распознан неуверенно' : `${items.length} размера распознаны неуверенно`} —
        выберите верное значение, и оно исправится в шагах и чек-листе.
      </div>
      <ul className="banner-options">
        {items.map((item) => (
          <li key={item.annotationId} className="banner-option">
            <span className="banner-raw">{item.raw}</span>
            <span className="banner-question">или</span>
            <span className="banner-choice-group">
              {item.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="chip chip-choice"
                  onClick={() => api.actions.resolveSize(item.annotationId, option)}
                >
                  {option}
                </button>
              ))}
            </span>
            <span className="banner-confidence">{Math.round(item.confidence * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Расшифровки ГОСТ: автоперевод можно переписать, правка уйдёт в PDF. */
function NotationPanel({
  annotations,
  selectedId,
  onNote,
  onConfirm,
}: {
  annotations: readonly XrayAnnotation[];
  selectedId: string | null;
  onNote: (id: string, note: string) => void;
  onConfirm: (id: string, value: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!selectedId || !listRef.current) {
      return;
    }
    const target = listRef.current.querySelector(`[data-annotation="${selectedId}"]`);
    target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  if (annotations.length === 0) {
    return (
      <section className="card">
        <h3>Обозначения</h3>
        <p className="card-note">В этом документе нет распознанных обозначений: все размеры уже в тексте шагов.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h3>Обозначения и допуски</h3>
      <p className="card-note">Автоперевод ГОСТ можно переписать — он попадёт в шпаргалку PDF.</p>
      <ul className="notation-list" ref={listRef}>
        {annotations.map((annotation) => (
          <li
            key={annotation.id}
            data-annotation={annotation.id}
            className={`notation ${selectedId === annotation.id ? 'notation-active' : ''}`}
          >
            <div className="notation-head">
              <code className="notation-raw">{annotation.resolvedValue ?? annotation.raw}</code>
              {!annotation.confirmedByHuman && (
                <button
                  type="button"
                  className="chip chip-confirm"
                  onClick={() => onConfirm(annotation.id, annotation.resolvedValue ?? annotation.raw)}
                  title="Подтвердить обозначение по чертежу"
                >
                  подтвердить
                </button>
              )}
            </div>
            <p className="notation-auto">
              {translateEngineeringNotation(annotation.resolvedValue ?? annotation.raw).explanation}
            </p>
            <InlineEdit
              value={annotation.note ?? ''}
              placeholder="Своя расшифровка (необязательно)"
              ariaLabel={`Расшифровка ${annotation.raw}`}
              className="notation-note"
              multiline
              onCommit={(next) => onNote(annotation.id, next)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ракурс 3D-схемы: два ползунка, схема в предпросмотре перерисовывается сразу. */
function CameraControls({ step, onChange }: { step: GuideStep; onChange: (az: number, el: number) => void }) {
  const azimuth = step.cameraView?.azimuth ?? 35;
  const elevation = step.cameraView?.elevation ?? 26;
  return (
    <div className="camera">
      <label>
        <span>Поворот</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={azimuth}
          onChange={(event) => onChange(Number(event.target.value), elevation)}
        />
        <output>{azimuth}°</output>
      </label>
      <label>
        <span>Наклон</span>
        <input
          type="range"
          min={-60}
          max={80}
          step={5}
          value={elevation}
          onChange={(event) => onChange(azimuth, Number(event.target.value))}
        />
        <output>{elevation}°</output>
      </label>
    </div>
  );
}

function StepCard({ step, api, is3d }: { step: GuideStep; api: PipelineApi; is3d: boolean }) {
  const [open, setOpen] = useState(step.number === 1);
  return (
    <li className={`step-card ${open ? 'step-card-open' : ''}`}>
      <button
        type="button"
        className="step-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="step-number">{String(step.number).padStart(2, '0')}</span>
        <span className="step-title">{step.title}</span>
        {step.antiError && <span className="step-badge" title="Есть предупреждение">!</span>}
        <span className="step-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="step-body">
          <p className="step-label">Что делать</p>
          <InlineEdit
            value={step.workerText}
            multiline
            ariaLabel={`Текст шага ${step.number}`}
            className="step-text"
            onCommit={(next) => api.actions.editStepText(step.id, next)}
          />
          <p className="step-label">Заголовок</p>
          <InlineEdit
            value={step.title}
            ariaLabel={`Заголовок шага ${step.number}`}
            className="step-title-edit"
            onCommit={(next) => api.actions.editStepTitle(step.id, next)}
          />

          <label className="step-toggle">
            <input
              type="checkbox"
              checked={Boolean(step.antiError)}
              onChange={(event) =>
                api.actions.editAntiError(step.id, event.target.checked ? 'Проверьте по чертежу перед сборкой.' : null)
              }
            />
            <span>Добавить «Осторожно!»</span>
          </label>
          {step.antiError && (
            <InlineEdit
              value={step.antiError.text}
              multiline
              ariaLabel={`Предупреждение шага ${step.number}`}
              className="step-anti"
              onCommit={(next) => api.actions.editAntiError(step.id, next)}
            />
          )}

          {is3d && (
            <CameraControls
              step={step}
              onChange={(azimuth, elevation) => api.actions.editCamera(step.id, azimuth, elevation)}
            />
          )}

          {step.criticalChecks.length > 0 && (
            <div className="step-checks">
              <p className="step-label">Контрольный замер</p>
              <ul>
                {step.criticalChecks.map((check) => (
                  <li key={check.id}>
                    <strong>{check.nominal}</strong> — {check.acceptance}
                    <span className="step-instrument"> · {check.instrument}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function StepPanel({ api }: { api: PipelineApi }) {
  const doc = api.doc!;
  const is3d = Boolean(doc.assembly3d);
  return (
    <section className="card">
      <h3>Шаги</h3>
      <p className="card-note">Текст, «Осторожно!» и {is3d ? 'ракурс схемы' : 'заголовок'} правятся на месте.</p>
      <ul className="step-list">
        {doc.steps.map((step) => (
          <StepCard key={step.id} step={step} api={api} is3d={is3d} />
        ))}
      </ul>
    </section>
  );
}

function ChecklistPanel({ api }: { api: PipelineApi }) {
  const doc = api.doc!;
  return (
    <section className="card">
      <h3>Чек-лист</h3>
      <p className="card-note">Последняя страница PDF. Снимите галочку — пункт станет необязательным.</p>
      <ul className="checklist">
        {doc.qcChecklist.map((item) => (
          <li key={item.id} className={item.required ? '' : 'checklist-optional'}>
            <label>
              <input
                type="checkbox"
                checked={item.required}
                onChange={() => api.actions.toggleChecklistItem(item.id)}
              />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Шаг 2: панель с названием и кнопкой PDF, живой предпросмотр и инспектор правок. */
export function ReviewScreen({ api }: { api: PipelineApi }) {
  const doc = api.doc!;
  const plan = useMemo(() => buildPlan(doc, api.illustrations), [doc, api.illustrations]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const stepCount = doc.steps.length;
  const antiErrors = doc.steps.filter((step) => step.antiError).length;

  return (
    <div className="review">
      <header className="review-bar">
        <div className="review-id">
          <InlineEdit
            value={doc.metadata.title}
            className="review-title"
            ariaLabel="Название детали"
            onCommit={api.actions.editTitle}
          />
          <div className="review-meta">
            <span>
              Шифр:{' '}
              <InlineEdit
                value={doc.metadata.drawingCode}
                ariaLabel="Шифр чертежа"
                onCommit={(next) => api.actions.editMeta({ drawingCode: next })}
              />
            </span>
            <span>
              Материал:{' '}
              <InlineEdit
                value={doc.metadata.material}
                ariaLabel="Материал"
                onCommit={(next) => api.actions.editMeta({ material: next })}
              />
            </span>
            <span className="review-stats">
              {stepCount} шаг{stepCount === 1 ? '' : stepCount < 5 ? 'а' : 'ов'} · {plan.pages.length} стр. A4
              {antiErrors > 0 ? ` · ${antiErrors} предупр.` : ''}
            </span>
          </div>
        </div>
        <div className="review-actions">
          <button type="button" className="btn btn-ghost" onClick={api.actions.reset}>
            Другой файл
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void api.actions.download()}
            disabled={api.pdfBusy}
          >
            {api.pdfBusy ? 'Собираем PDF…' : saveLabel()}
          </button>
        </div>
      </header>

      {api.error && (
        <div className="banner banner-danger" role="alert">
          <div className="banner-text">
            <strong>{api.error.message}</strong> {api.error.hint}
          </div>
        </div>
      )}

      <SizeBanner api={api} />

      {api.softNotes.length > 0 && api.ambiguous.length === 0 && (
        <div className="banner banner-warn" role="status">
          <div className="banner-text">
            <strong>Есть неуверенные обозначения.</strong> Проверьте их в панели «Обозначения и допуски» — в PDF они
            помечены «проверить по чертежу».
          </div>
        </div>
      )}

      {api.pdfJob && (
        <div className="banner banner-ok" role="status">
          <div className="banner-text">
            <strong>PDF готов.</strong> {api.pdfJob.fileName} · {api.pdfJob.plan.pages.length} стр. ·{' '}
            {(api.pdfJob.bytes.byteLength / 1024).toFixed(0)} КБ
          </div>
        </div>
      )}

      {api.warnings.length > 0 && (
        <details className="warnings">
          <summary>Замечания распознавания ({api.warnings.length})</summary>
          <ul>
            {api.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="workspace">
        <section className="pages" aria-label="Предпросмотр PDF">
          <div className="pages-head">
            <h2>Предпросмотр</h2>
            <span className="pages-hint">Так будет выглядеть файл · {plan.pages.length} страниц</span>
          </div>
          {plan.pages.map((page) => (
            <PagePreview key={page.index} page={page} total={plan.pages.length} title={shortTitle(doc.metadata.title)} />
          ))}
        </section>

        <aside className="inspector" aria-label="Правки">
          <StepPanel api={api} />
          <SheetCard
            pages={api.pages}
            annotations={doc.xrayAnnotations}
            selectedId={selectedAnnotation}
            onPick={setSelectedAnnotation}
          />
          <NotationPanel
            annotations={doc.xrayAnnotations}
            selectedId={selectedAnnotation}
            onNote={api.actions.editAnnotationNote}
            onConfirm={api.actions.resolveSize}
          />
          <ChecklistPanel api={api} />
        </aside>
      </div>
    </div>
  );
}
