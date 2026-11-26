/**
 * Поповер «Пометка» из правого нижнего угла: у шага появляется красная плашка «Осторожно!», а у
 * 3D-модели — новый ракурс схемы. И то и другое сразу видно на листе A4 за поповером.
 */
import { useEffect, useState } from 'react';
import type { GuideStep } from '@ikguide/schema';
import type { PipelineApi } from '../state/pipeline';
import { InlineEdit } from './InlineEdit';

function CameraControls({ step, onChange }: { step: GuideStep; onChange: (az: number, el: number) => void }) {
  const azimuth = step.cameraView?.azimuth ?? 35;
  const elevation = step.cameraView?.elevation ?? 26;
  return (
    <div className="camera">
      <label className="slider">
        <span className="field-label">Поворот</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={azimuth}
          aria-label="Поворот схемы"
          onChange={(event) => onChange(Number(event.target.value), elevation)}
        />
        <output>{azimuth}°</output>
      </label>
      <label className="slider">
        <span className="field-label">Наклон</span>
        <input
          type="range"
          min={-60}
          max={80}
          step={5}
          value={elevation}
          aria-label="Наклон схемы"
          onChange={(event) => onChange(azimuth, Number(event.target.value))}
        />
        <output>{elevation}°</output>
      </label>
    </div>
  );
}

export function NotePanel({ api, focusStepId }: { api: PipelineApi; focusStepId: string | null }) {
  const doc = api.doc!;
  const is3d = Boolean(doc.assembly3d);
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

      {is3d && (
        <section className="panel-section">
          <h3 className="panel-h">Ракурс 3D-схемы</h3>
          <CameraControls
            step={step}
            onChange={(azimuth, elevation) => api.actions.editCamera(step.id, azimuth, elevation)}
          />
          <p className="panel-note">Схема на листе A4 перерисовывается сразу — новый ракурс уйдёт в PDF.</p>
        </section>
      )}
    </div>
  );
}
