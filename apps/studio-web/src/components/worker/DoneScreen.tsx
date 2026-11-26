import { useStudio } from '../../state/studio';
import { CheckIcon } from '../../art/kit';

export function DoneScreen() {
  const { doc, dispatch, stats } = useStudio();

  return (
    <div className="screen screen-done">
      <div className="done-hero">
        <span className="done-badge">
          <CheckIcon size={44} color="#FFFFFF" />
        </span>
        <h1>Инструкция выполнена</h1>
        <p>
          {doc.metadata.title} · {doc.metadata.drawingCode}
        </p>
      </div>

      <div className="done-stats">
        <div>
          <strong>{stats.stepCount}</strong>
          <span>шагов пройдено</span>
        </div>
        <div>
          <strong>{stats.qcItemCount}</strong>
          <span>пунктов контроля</span>
        </div>
        <div>
          <strong>{stats.annotationCount}</strong>
          <span>обозначений разобрано</span>
        </div>
      </div>

      <div className="notice notice-success">
        <strong>Что дальше</strong>
        <p>
          Передайте деталь на приёмку ОТК вместе с этой инструкцией. Все контрольные размеры и подтверждённые
          обозначения уже зафиксированы в документе.
        </p>
      </div>

      <div className="done-actions">
        <button type="button" className="btn btn-primary btn-tall" onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}>
          К списку инструкций
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            dispatch({ type: 'RESET_QC' });
            dispatch({ type: 'GO_STEP', index: 0 });
            dispatch({ type: 'SET_SCREEN', screen: 'steps' });
          }}
        >
          Пройти заново
        </button>
      </div>
    </div>
  );
}
