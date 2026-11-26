import { useStudio } from '../../state/studio';
import { WorkerHeader, UncertaintyBanner } from './WorkerChrome';
import { CheckIcon } from '../../art/kit';

export function QcScreen() {
  const { doc, dispatch, qcCompleted, isQcComplete, unconfirmed } = useStudio();
  const checkedCount = doc.qcChecklist.filter((item) => qcCompleted.includes(item.id)).length;
  const total = doc.qcChecklist.length;
  const progress = total === 0 ? 100 : Math.round((checkedCount / total) * 100);

  return (
    <div className="screen">
      <WorkerHeader
        title="Проверьте перед сдачей"
        subtitle={`${doc.metadata.drawingCode} · финальный контроль`}
        onBack={() => dispatch({ type: 'SET_SCREEN', screen: 'steps' })}
      />

      <div className="verify-progress">
        <div className="progress-track">
          <div className={`progress-fill ${isQcComplete ? 'is-done' : ''}`} style={{ width: `${progress}%` }} />
        </div>
        <span className="verify-progress-label">
          {checkedCount} из {total} пунктов
        </span>
      </div>

      <UncertaintyBanner onOpen={() => dispatch({ type: 'SET_SCREEN', screen: 'verify' })} />

      <ul className="qc-list">
        {doc.qcChecklist.map((item) => {
          const checked = qcCompleted.includes(item.id);
          return (
            <li key={item.id}>
              <label className={`qc-row ${checked ? 'is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => dispatch({ type: 'TOGGLE_QC', itemId: item.id })}
                />
                <span className="qc-box" aria-hidden="true">
                  {checked ? <CheckIcon size={13} color="#FFFFFF" /> : null}
                </span>
                <span className="qc-body">
                  <span className="qc-text">{item.text}</span>
                  <span className="qc-meta">
                    {item.required ? 'обязательно' : 'по желанию'}
                    {item.reference ? ` · ${item.reference}` : ''}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {unconfirmed.length > 0 ? (
        <div className="notice notice-warning">
          <strong>Остались неподтверждённые размеры.</strong>
          <p>Сдавать деталь с непроверенными обозначениями нельзя: подтвердите их на экране проверки.</p>
        </div>
      ) : null}

      <div className="qc-actions">
        <button
          type="button"
          className="btn btn-primary btn-tall"
          disabled={!isQcComplete || unconfirmed.length > 0}
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'done' })}
        >
          {isQcComplete ? (unconfirmed.length > 0 ? 'Сначала подтвердите размеры' : 'Завершить инструкцию ✓') : 'Отметьте все пункты'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'RESET_QC' })}>
          Сбросить отметки
        </button>
      </div>
    </div>
  );
}
