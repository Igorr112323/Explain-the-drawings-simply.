/**
 * Поповер «Править текст и название» — всё, что человек может переписать в инструкции.
 *
 * Никакого сайдбара: панель открывается по иконке `(A)` или кликом по тексту прямо на листе A4,
 * показывает ровно то поле, по которому кликнули, и закрывается по Esc или клику мимо.
 */
import { useEffect, useState } from 'react';
import type { GuideStep } from '@ikguide/schema';
import type { PipelineApi } from '../state/pipeline';
import { InlineEdit } from './InlineEdit';
import { IconChevron } from './icons';

function StepRow({
  step,
  api,
  open,
  onToggle,
  highlighted,
}: {
  step: GuideStep;
  api: PipelineApi;
  open: boolean;
  onToggle: () => void;
  highlighted: boolean;
}) {
  return (
    <li
      className={`step-row ${open ? 'step-row-open' : ''}`}
      data-step={step.id}
      data-highlight={highlighted ? 'true' : undefined}
    >
      <button type="button" className="step-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="step-row-number">{String(step.number).padStart(2, '0')}</span>
        <span className="step-row-title">{step.title}</span>
        {step.antiError && (
          <span className="step-row-badge" title="Есть «Осторожно!»">
            !
          </span>
        )}
        <span className={`step-row-caret ${open ? 'is-open' : ''}`} aria-hidden="true">
          <IconChevron size={18} />
        </span>
      </button>
      {open && (
        <div className="step-row-body">
          <p className="field-label">Текст шага</p>
          <InlineEdit
            value={step.workerText}
            multiline
            ariaLabel={`Текст шага ${step.number}`}
            className="step-text"
            onCommit={(next) => api.actions.editStepText(step.id, next)}
          />
          <p className="field-label">Заголовок</p>
          <InlineEdit
            value={step.title}
            ariaLabel={`Заголовок шага ${step.number}`}
            className="step-title-edit"
            onCommit={(next) => api.actions.editStepTitle(step.id, next)}
          />
          <label className="toggle">
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
        </div>
      )}
    </li>
  );
}

export function TextPanel({ api, focusStepId }: { api: PipelineApi; focusStepId: string | null }) {
  const doc = api.doc!;
  const [openIds, setOpenIds] = useState<string[]>(() => {
    const first = focusStepId ?? doc.steps[0]?.id;
    return first ? [first] : [];
  });
  useEffect(() => {
    if (focusStepId) {
      setOpenIds((prev) => (prev.includes(focusStepId) ? prev : [...prev, focusStepId]));
    }
  }, [focusStepId]);

  useEffect(() => {
    if (!focusStepId) {
      return;
    }
    const row = document.querySelector(`[data-step="${focusStepId}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [focusStepId, openIds]);

  const toggle = (id: string) =>
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  return (
    <div className="panel">
      <section className="panel-section">
        <label className="field">
          <span className="field-label">Название</span>
          <InlineEdit
            value={doc.metadata.title}
            className="field-value field-title"
            ariaLabel="Название детали"
            onCommit={api.actions.editTitle}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Шифр</span>
            <InlineEdit
              value={doc.metadata.drawingCode}
              className="field-value"
              ariaLabel="Шифр чертежа"
              onCommit={(next) => api.actions.editMeta({ drawingCode: next })}
            />
          </label>
          <label className="field">
            <span className="field-label">Материал</span>
            <InlineEdit
              value={doc.metadata.material}
              className="field-value"
              ariaLabel="Материал"
              onCommit={(next) => api.actions.editMeta({ material: next })}
            />
          </label>
        </div>
      </section>

      <h3 className="panel-h">Шаги · {doc.steps.length}</h3>
      <ul className="step-list">
        {doc.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            api={api}
            open={openIds.includes(step.id)}
            onToggle={() => toggle(step.id)}
            highlighted={step.id === focusStepId}
          />
        ))}
      </ul>

      <h3 className="panel-h">Чек-лист · {doc.qcChecklist.length}</h3>
      <ul className="checklist">
        {doc.qcChecklist.map((item) => (
          <li key={item.id} className={item.required ? '' : 'checklist-optional'}>
            <label className="toggle">
              <input type="checkbox" checked={item.required} onChange={() => api.actions.toggleChecklistItem(item.id)} />
              <span className="visually-hidden">Обязательный пункт</span>
            </label>
            <InlineEdit
              value={item.text}
              className="checklist-text"
              ariaLabel={`Пункт чек-листа: ${item.text}`}
              onCommit={(next) => api.actions.editChecklistText(item.id, next)}
            />
          </li>
        ))}
      </ul>
      <p className="panel-note">Снимите галочку — пункт станет необязательным и уйдёт из PDF серым.</p>
    </div>
  );
}
