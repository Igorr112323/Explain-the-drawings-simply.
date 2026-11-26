import { useEffect, useRef, useState } from 'react';
import { pluralRu } from '@ikguide/gost-translator';
import { getEffectiveAnnotationValue, type GuideStep } from '@ikguide/schema';
import { useStudio } from '../../state/studio';
import { WorkerHeader, UncertaintyBanner } from './WorkerChrome';
import { HighlightLegend, StepArt } from '../common/StepArt';
import { SpeakerGlyph, WarnGlyph } from '../common/Glyphs';
import { isSpeechSupported, speakRussian, stopSpeech } from '../../lib/speech';

function buildSpeechText(step: GuideStep): string {
  const parts = [`Шаг ${step.number}. ${step.title}.`, step.workerText];
  if (step.criticalChecks.length > 0) {
    parts.push('Контрольные размеры.');
    step.criticalChecks.forEach((check) => {
      parts.push(`${check.label}: ${check.nominal}. Допустимо: ${check.acceptance}. Проверить: ${check.instrument}.`);
    });
  }
  if (step.antiError) {
    parts.push(`Внимание, анти-ошибка: ${step.antiError.text}`);
  }
  return parts.join(' ');
}

export function StepsScreen() {
  const { state, doc, dispatch, unconfirmed } = useStudio();
  const step = doc.steps[state.stepIndex] ?? doc.steps[0];
  const [speaking, setSpeaking] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const total = doc.steps.length;
  const isLast = state.stepIndex >= total - 1;

  useEffect(() => {
    setSpeaking(false);
    stopSpeech();
  }, [step?.id]);

  useEffect(() => {
    return () => stopSpeech();
  }, []);

  const goNext = () => {
    if (isLast) {
      dispatch({ type: 'SET_SCREEN', screen: 'qc' });
      return;
    }
    dispatch({ type: 'GO_STEP', index: state.stepIndex + 1 });
  };

  const goPrev = () => {
    dispatch({ type: 'GO_STEP', index: state.stepIndex - 1 });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (state.mode !== 'worker' || state.screen !== 'steps') {
        return;
      }
      if (event.key === 'ArrowRight') {
        goNext();
      }
      if (event.key === 'ArrowLeft') {
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!step) {
    return (
      <div className="screen">
        <WorkerHeader title="Шагов нет" onBack={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })} />
        <p className="muted">В этой инструкции пока нет шагов. Добавьте их в режиме инженера.</p>
      </div>
    );
  }

  const readAloud = () => {
    if (speaking) {
      stopSpeech();
      setSpeaking(false);
      return;
    }
    if (!isSpeechSupported()) {
      dispatch({ type: 'SHOW_TOAST', tone: 'danger', text: 'Браузер не поддерживает озвучку. Откройте в Chrome или Edge.' });
      return;
    }
    const started = speakRussian(buildSpeechText(step), {
      onEnd: () => setSpeaking(false),
      onError: (message) => {
        setSpeaking(false);
        dispatch({ type: 'SHOW_TOAST', tone: 'danger', text: message });
      },
    });
    setSpeaking(started);
  };

  const relatedAnnotations = doc.xrayAnnotations.filter((annotation) => step.drawingRefs.includes(annotation.id));

  return (
    <div className="screen screen-steps">
      <WorkerHeader
        title={`Шаг ${state.stepIndex + 1} из ${total}`}
        subtitle={doc.metadata.drawingCode}
        onBack={() => dispatch({ type: 'SET_SCREEN', screen: 'prep' })}
        trailing={
          <button
            type="button"
            className="tap-button tap-ghost"
            onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'xray' })}
            aria-label="Рентген чертежа"
            title="Рентген чертежа"
          >
            🔍
          </button>
        }
      />

      <div className="progress-track step-progress">
        <div className="progress-fill" style={{ width: `${((state.stepIndex + 1) / total) * 100}%` }} />
      </div>

      <UncertaintyBanner onOpen={() => dispatch({ type: 'SET_SCREEN', screen: 'verify' })} />

      <div
        className="step-stage"
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY, time: Date.now() };
        }}
        onPointerUp={(event) => {
          const start = pointerStart.current;
          pointerStart.current = null;
          if (!start) {
            return;
          }
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) {
              goNext();
            } else {
              goPrev();
            }
          }
        }}
      >
        <div className="art-card">
          <StepArt illustration={step.illustration} />
        </div>

        <h2 className="step-title">{step.title}</h2>
        <p className="step-text">{step.workerText}</p>

        <HighlightLegend highlight={step.illustration.highlight} />

        {step.criticalChecks.length > 0 ? (
          <section className="card critical-card">
            <h3>Контрольные размеры</h3>
            <ul>
              {step.criticalChecks.map((check) => (
                <li key={check.id}>
                  <div className="critical-main">
                    <span className="critical-label">{check.label}</span>
                    <span className="critical-nominal">{check.nominal}</span>
                  </div>
                  <div className="critical-sub">
                    {check.acceptance} · {check.instrument}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step.antiError ? (
          <section className={`anti-error anti-${step.antiError.severity}`}>
            <span className="anti-icon">
              <WarnGlyph />
            </span>
            <div>
              <strong>Анти-ошибка</strong>
              <p>{step.antiError.text}</p>
            </div>
          </section>
        ) : null}

        {relatedAnnotations.length > 0 ? (
          <div className="ref-chips">
            <span className="muted small">Обозначения шага:</span>
            {relatedAnnotations.map((annotation) => (
              <button
                key={annotation.id}
                type="button"
                className="chip-button"
                onClick={() => {
                  dispatch({ type: 'FOCUS_ANNOTATION', annotationId: annotation.id });
                  dispatch({ type: 'SET_SCREEN', screen: 'xray' });
                }}
              >
                {getEffectiveAnnotationValue(annotation)}
              </button>
            ))}
          </div>
        ) : null}

        {unconfirmed.length > 0 && step.drawingRefs.some((ref) => unconfirmed.some((item) => item.id === ref)) ? (
          <p className="inline-warning">
            В этом шаге есть неподтверждённые обозначения ({unconfirmed.length}{' '}
            {pluralRu(unconfirmed.length, 'штука', 'штуки', 'штук')}). Сверьте их с оригиналом чертежа.
          </p>
        ) : null}
      </div>

      <div className="step-controls">
        <button type="button" className="speak-button" onClick={readAloud} aria-pressed={speaking}>
          <SpeakerGlyph />
          <span>{speaking ? 'Остановить' : 'Озвучить шаг'}</span>
        </button>

        <div className="step-nav">
          <button type="button" className="btn btn-nav" onClick={goPrev} disabled={state.stepIndex === 0}>
            ← Назад
          </button>
          <button type="button" className="btn btn-nav btn-primary" onClick={goNext}>
            {isLast ? 'К чек-листу →' : 'Дальше →'}
          </button>
        </div>
        <p className="swipe-hint">Свайп влево/вправо или стрелки клавиатуры</p>
      </div>
    </div>
  );
}
