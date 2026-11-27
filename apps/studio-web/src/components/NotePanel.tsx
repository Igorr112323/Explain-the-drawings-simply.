/**
 * Поповер «Пометка» из правого нижнего угла: у шага появляется красная плашка «Осторожно!».
 * Плашка сразу видна на листе A4 за поповером.
 */
import { useEffect, useState } from 'react';
import type { PipelineApi } from '../state/pipeline';
import { InlineEdit } from './InlineEdit';

export function NotePanel({ api, focusStepId }: { api: PipelineApi; focusStepId: string | null }) {
  const doc = api.doc!;
  const [stepId, setStepId] = useState(focusStepId ?? doc.steps[0]?.id ?? '');

  useEffect(() => {
    if (focusStepId) {
      setStepId(focusStepId);
    }
  }, [focusStepId]);

  const step = doc.steps.find((item) => item.id === stepId) ?? doc.steps[0];
  if (!step) {
    return <p className="panel-note">В инструкции пока нет шагов.</p>;
  }

  return (
    <div className="panel">
      <div className="step-chips" role="group" aria-label="Шаг">
        {doc.steps.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip chip-step"
            data-active={item.id === step.id ? 'true' : undefined}
            onClick={() => setStepId(item.id)}
            title={item.title}
          >
            {String(item.number).padStart(2, '0')}
          </button>
        ))}
      </div>

      <h3 className="panel-h">
        {String(step.number).padStart(2, '0')} · {step.title}
      </h3>

      <section className="panel-section">
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(step.antiError)}
            aria-label="Плашка «Осторожно!» у шага"
            onChange={(event) =>
              api.actions.editAntiError(step.id, event.target.checked ? 'Проверьте по чертежу перед сборкой.' : null)
            }
          />
          <span>Добавить «Осторожно!»</span>
        </label>
        {step.antiError ? (
          <InlineEdit
            value={step.antiError.text}
            multiline
            ariaLabel={`Предупреждение шага ${step.number}`}
            className="step-anti"
            onCommit={(next) => api.actions.editAntiError(step.id, next)}
          />
        ) : (
          <p className="panel-note">Красная плашка появится на листе шага и в списке предупреждений.</p>
        )}
      </section>

    </div>
  );
}
