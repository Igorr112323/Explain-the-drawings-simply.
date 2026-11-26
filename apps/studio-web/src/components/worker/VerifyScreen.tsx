import { CONFIDENCE_THRESHOLD, getEffectiveAnnotationValue, type XrayAnnotation } from '@ikguide/schema';
import { useStudio } from '../../state/studio';
import { WorkerHeader } from './WorkerChrome';
import { CheckIcon } from '../../art/kit';

export function VerifyScreen() {
  const { doc, dispatch, unconfirmed } = useStudio();
  const total = doc.xrayAnnotations.length;
  const confirmedCount = total - unconfirmed.length;
  const progress = total === 0 ? 100 : Math.round((confirmedCount / total) * 100);

  return (
    <div className="screen">
      <WorkerHeader
        title="Быстрая проверка"
        subtitle="Всё, что распознано с уверенностью ниже 95 %, подтверждает человек"
        onBack={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
      />

      <div className="verify-progress">
        <div className="progress-track">
          <div className={`progress-fill ${unconfirmed.length === 0 ? 'is-done' : ''}`} style={{ width: `${progress}%` }} />
        </div>
        <span className="verify-progress-label">
          {confirmedCount} из {total} подтверждено
        </span>
      </div>

      {unconfirmed.length === 0 ? (
        <div className="success-card">
          <span className="success-icon">
            <CheckIcon size={18} color="#FFFFFF" />
          </span>
          <div>
            <strong>Все размеры подтверждены</strong>
            <p>Можно начинать работу. Если чертёж изменится, проверка появится снова.</p>
          </div>
        </div>
      ) : (
        <p className="muted small">Нажимайте на значение — одно касание, и оно уйдёт в инструкцию как проверенное.</p>
      )}

      <ul className="verify-list">
        {doc.xrayAnnotations.map((annotation) => (
          <VerifyRow key={annotation.id} annotation={annotation} />
        ))}
      </ul>

      <p className="muted small verify-legend">
        Порог уверенности {Math.round(CONFIDENCE_THRESHOLD * 100)} %. Порог задан в ядре продукта: OCR-сервис этапа 2 не
        сможет «протащить» догадку мимо рабочего.
      </p>
    </div>
  );
}

function VerifyRow({ annotation }: { annotation: XrayAnnotation }) {
  const { dispatch } = useStudio();
  const trusted = annotation.confidence >= CONFIDENCE_THRESHOLD || annotation.confirmedByHuman;
  const percent = Math.round(annotation.confidence * 100);
  const options = annotation.ambiguousOptions;

  return (
    <li className={`verify-row ${trusted ? 'is-trusted' : 'is-unconfirmed'}`}>
      <div className="verify-row-head">
        <span className="verify-raw">{annotation.raw}</span>
        <span className={`verify-confidence ${trusted ? 'is-ok' : 'is-warn'}`}>{percent} %</span>
      </div>

      {annotation.confirmedByHuman && annotation.resolvedValue ? (
        <p className="verify-note">Подтверждено человеком: {annotation.resolvedValue}</p>
      ) : annotation.note ? (
        <p className="verify-note">{annotation.note}</p>
      ) : null}

      {!trusted && options ? (
        <div className="verify-question">
          <span>Плохо видно: что написано на чертеже?</span>
          <div className="row gap-8">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                className="btn btn-option"
                onClick={() => dispatch({ type: 'CONFIRM_ANNOTATION', annotationId: annotation.id, value: option })}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="verify-actions">
        {!trusted ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => dispatch({ type: 'CONFIRM_ANNOTATION', annotationId: annotation.id })}
            >
              Да, всё верно
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dispatch({ type: 'FOCUS_ANNOTATION', annotationId: annotation.id });
                dispatch({ type: 'SET_SCREEN', screen: 'xray' });
              }}
            >
              Смотреть на чертеже
            </button>
          </>
        ) : (
          <>
            <span className="verify-trusted-label">✓ {getEffectiveAnnotationValue(annotation)}</span>
            {annotation.confirmedByHuman ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => dispatch({ type: 'CONFIRM_ANNOTATION', annotationId: annotation.id })}
              >
                Снять подтверждение
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  dispatch({ type: 'FOCUS_ANNOTATION', annotationId: annotation.id });
                  dispatch({ type: 'SET_SCREEN', screen: 'xray' });
                }}
              >
                Разобрать по ГОСТ
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
