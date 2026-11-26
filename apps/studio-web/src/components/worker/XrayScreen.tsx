import { useMemo } from 'react';
import { CONFIDENCE_THRESHOLD, getEffectiveAnnotationValue, type XrayAnnotation } from '@ikguide/schema';
import { translateEngineeringNotation } from '@ikguide/gost-translator';
import { useStudio } from '../../state/studio';
import { WorkerHeader } from './WorkerChrome';
import { DrawingSheet } from '../../art/drawings';
import { TranslationCard } from '../common/TranslationCard';

const EXAMPLES = ['Ø32 H7/k6', 'М10×1,25', 'Ra 0.8', 'У4-К4', '4 отв. Ø6,5', '120±0,5'];

function pinLabel(annotation: XrayAnnotation): string {
  const compact = annotation.raw.replace(/^\d+\s*(отв\.?|отверсти\w*)\s*/i, '').trim();
  if (annotation.kind === 'thread') {
    const thread = /[МM]\s*\d+(?:[.,]\d+)?/.exec(compact);
    return thread ? thread[0].replace(/\s+/g, '') : compact.slice(0, 8);
  }
  if (annotation.kind === 'fit') {
    return compact.length > 10 ? `${compact.slice(0, 9).trim()}…` : compact;
  }
  return compact.length > 8 ? `${compact.slice(0, 8).trim()}…` : compact;
}

function pinState(annotation: XrayAnnotation): 'done' | 'warn' | 'ok' {
  if (annotation.confirmedByHuman) {
    return 'done';
  }
  if (annotation.confidence < CONFIDENCE_THRESHOLD) {
    return 'warn';
  }
  return 'ok';
}

export function XrayScreen() {
  const { state, doc, dispatch } = useStudio();
  const focused = doc.xrayAnnotations.find((annotation) => annotation.id === state.focusedAnnotationId) ?? null;
  const focusedTranslation = focused ? translateEngineeringNotation(getEffectiveAnnotationValue(focused)) : null;
  const manual = state.manualNotation.trim();
  const manualTranslation = useMemo(() => (manual.length > 0 ? translateEngineeringNotation(manual) : null), [manual]);
  const unconfirmedCount = doc.xrayAnnotations.filter((annotation) => annotation.confidence < CONFIDENCE_THRESHOLD && !annotation.confirmedByHuman).length;

  return (
    <div className="screen screen-xray">
      <WorkerHeader
        title="Рентген чертежа"
        subtitle={`${doc.metadata.drawingCode} · нажмите на точку, чтобы перевести по ГОСТ`}
        onBack={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
      />

      {unconfirmedCount > 0 ? (
        <div className="notice notice-warning small">
          {unconfirmedCount} неподтверждённых обозначений. Жёлтые точки — распознаны неуверенно.
        </div>
      ) : null}

      <div className="sheet-stage">
        <div className="sheet-scroll">
          <div className="sheet-inner">
            {state.uploadedImage ? (
              <img className="sheet-image" src={state.uploadedImage} alt="Загруженный чертёж" />
            ) : (
              <DrawingSheet viewId={doc.drawing.viewId} />
            )}
            {doc.xrayAnnotations.map((annotation) => {
              const pin = pinState(annotation);
              const isFocused = state.focusedAnnotationId === annotation.id;
              return (
                <button
                  key={annotation.id}
                  type="button"
                  className={`pin pin-${pin} ${isFocused ? 'is-focused' : ''}`}
                  style={{ left: `${annotation.xPercent}%`, top: `${annotation.yPercent}%` }}
                  onClick={() => dispatch({ type: 'FOCUS_ANNOTATION', annotationId: annotation.id })}
                  title={annotation.raw}
                  aria-label={`Перевести обозначение ${annotation.raw}`}
                >
                  <span className="pin-dot" aria-hidden="true" />
                  <span className="pin-label">{pinLabel(annotation)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="muted small sheet-caption">Лист прокручивается — точки привязаны к геометрии чертежа.</p>

      {focused && focusedTranslation ? (
        <section className="focused-block">
          <div className="focused-head">
            <span className="chip chip-neutral">Точка на чертеже</span>
            <button type="button" className="link-button" onClick={() => dispatch({ type: 'FOCUS_ANNOTATION', annotationId: null })}>
              Скрыть
            </button>
          </div>
          <TranslationCard result={focusedTranslation} compact />
          {focused.confidence < CONFIDENCE_THRESHOLD && !focused.confirmedByHuman ? (
            <div className="confirm-strip">
              <span>Подтвердите значение, чтобы оно попало в инструкцию.</span>
              {focused.ambiguousOptions ? (
                <div className="row gap-8">
                  {focused.ambiguousOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="btn btn-option btn-sm"
                      onClick={() => dispatch({ type: 'CONFIRM_ANNOTATION', annotationId: focused.id, value: option })}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => dispatch({ type: 'CONFIRM_ANNOTATION', annotationId: focused.id })}
                >
                  Подтвердить
                </button>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <div className="notice notice-info small">
          Нажмите на любую точку на листе: перевод покажет точные миллиметры, предельные размеры и нужный инструмент.
        </div>
      )}

      <section className="manual-check">
        <h3>Проверить любой шифр ГОСТ</h3>
        <div className="manual-row">
          <input
            type="text"
            value={state.manualNotation}
            placeholder="Например: Ø32 H7/k6 или М8-7H"
            onChange={(event) => dispatch({ type: 'SET_MANUAL_NOTATION', value: event.target.value })}
            aria-label="Введите обозначение с чертежа"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => dispatch({ type: 'SET_MANUAL_NOTATION', value: '' })}
            disabled={state.manualNotation.length === 0}
          >
            Очистить
          </button>
        </div>
        <div className="example-chips">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip-button"
              onClick={() => dispatch({ type: 'SET_MANUAL_NOTATION', value: example })}
            >
              {example}
            </button>
          ))}
        </div>
        {manualTranslation ? <TranslationCard result={manualTranslation} /> : null}
      </section>

      <section className="annotation-list">
        <h3>Все обозначения листа</h3>
        <ul>
          {doc.xrayAnnotations.map((annotation) => (
            <li key={annotation.id}>
              <button
                type="button"
                className={`annotation-row ${state.focusedAnnotationId === annotation.id ? 'is-focused' : ''}`}
                onClick={() => dispatch({ type: 'FOCUS_ANNOTATION', annotationId: annotation.id })}
              >
                <span className={`annotation-status annotation-${pinState(annotation)}`} aria-hidden="true" />
                <span className="annotation-raw">{annotation.raw}</span>
                <span className="annotation-confidence">{Math.round(annotation.confidence * 100)} %</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
