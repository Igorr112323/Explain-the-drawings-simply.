import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CONFIDENCE_THRESHOLD, getEffectiveAnnotationValue, type XrayAnnotation } from '@ikguide/schema';
import { translateEngineeringNotation } from '@ikguide/gost-translator';
import { useStudio } from '../../state/studio';
import { WorkerHeader } from './WorkerChrome';
import { DrawingSheet } from '../../art/drawings';
import { TranslationCard } from '../common/TranslationCard';
import { buildDraftFromSession } from '../../lib/draft';
import {
  VisionError,
  emptyVisionSession,
  recognizeRegion,
  type VisionCandidate,
  type VisionSession,
} from '../../lib/vision';

const EXAMPLES = ['Ø32 H7/k6', 'М10×1,25', 'Ra 0.8', 'У4-К4', '4 отв. Ø6,5', '120±0,5'];

interface RoiBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

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

function normalizeBox(start: { x: number; y: number }, current: { x: number; y: number }): RoiBox {
  return {
    x: clampPercent(Math.min(start.x, current.x)),
    y: clampPercent(Math.min(start.y, current.y)),
    w: clampPercent(Math.abs(current.x - start.x)),
    h: clampPercent(Math.abs(current.y - start.y)),
  };
}

export function XrayScreen() {
  const { state, doc, dispatch } = useStudio();
  const focused = doc.xrayAnnotations.find((annotation) => annotation.id === state.focusedAnnotationId) ?? null;
  const focusedTranslation = focused ? translateEngineeringNotation(getEffectiveAnnotationValue(focused)) : null;
  const manual = state.manualNotation.trim();
  const manualTranslation = useMemo(() => (manual.length > 0 ? translateEngineeringNotation(manual) : null), [manual]);

  const [roiMode, setRoiMode] = useState(false);
  const [roiBox, setRoiBox] = useState<RoiBox | null>(null);
  const [roiBusy, setRoiBusy] = useState(false);
  const [roiCandidates, setRoiCandidates] = useState<VisionCandidate[] | null>(null);
  const [roiWarnings, setRoiWarnings] = useState<string[]>([]);
  const [roiError, setRoiError] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const unconfirmedCount = doc.xrayAnnotations.filter(
    (annotation) => annotation.confidence < CONFIDENCE_THRESHOLD && !annotation.confirmedByHuman,
  ).length;
  const session: VisionSession | null = state.vision;
  const canSelectRegion = Boolean(session?.pageId);
  const sheetVisible = Boolean(state.uploadedImage);

  const pointFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
      y: clampPercent(((event.clientY - rect.top) / rect.height) * 100),
    };
  };

  const runRoi = useCallback(
    async (box: RoiBox) => {
      const pageId = state.vision?.pageId;
      if (!pageId) {
        dispatch({
          type: 'SHOW_TOAST',
          tone: 'info',
          text: 'Выделение области доступно для листа, распознанного сервисом. Сначала загрузите чертёж.',
        });
        return;
      }
      setRoiBusy(true);
      setRoiError(null);
      setRoiCandidates(null);
      setRoiWarnings([]);
      try {
        const result = await recognizeRegion(pageId, box);
        setRoiCandidates(result.candidates);
        setRoiWarnings(result.warnings);
        if (result.candidates.length === 0) {
          setRoiError('В этой области текст не найден. Выделите шире или введите шифр вручную.');
        }
      } catch (error) {
        setRoiError(error instanceof VisionError ? error.message : 'Сервис не ответил. Проверьте, что он запущен.');
      } finally {
        setRoiBusy(false);
      }
    },
    [dispatch, state.vision?.pageId],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!roiMode) {
      return;
    }
    const point = pointFrom(event);
    dragRef.current = point;
    setRoiBox({ x: point.x, y: point.y, w: 0, h: 0 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!roiMode || !dragRef.current) {
      return;
    }
    setRoiBox(normalizeBox(dragRef.current, pointFrom(event)));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!roiMode || !dragRef.current) {
      return;
    }
    const box = normalizeBox(dragRef.current, pointFrom(event));
    dragRef.current = null;
    setRoiBox(box);
    if (box.w < 1.5 || box.h < 1.5) {
      setRoiBox(null);
      setRoiError('Слишком маленькая область: обведите обозначение целиком.');
      return;
    }
    void runRoi(box);
  };

  const addRoiToDraft = () => {
    if (!roiCandidates || roiCandidates.length === 0) {
      return;
    }
    const base = state.vision ?? emptyVisionSession();
    const merged = [...base.candidates];
    roiCandidates.forEach((candidate) => {
      const exists = merged.some(
        (item) => item.id === candidate.id || (item.pageIndex === candidate.pageIndex && item.normalizedText === candidate.normalizedText),
      );
      if (!exists) {
        merged.push(candidate);
      }
    });
    const next: VisionSession = {
      ...base,
      candidates: merged,
      warnings: [...new Set([...base.warnings, ...roiWarnings])],
    };

    if (!state.vision) {
      dispatch({ type: 'SET_VISION_SESSION', session: next, image: state.uploadedImage });
    } else {
      dispatch({ type: 'ADD_VISION_CANDIDATES', candidates: roiCandidates, warnings: roiWarnings });
    }

    const draft = buildDraftFromSession(next);
    dispatch({ type: 'SET_VISION_DRAFT', doc: draft.document });
    dispatch({
      type: 'SHOW_TOAST',
      tone: 'success',
      text: `В черновик добавлено обозначений: ${roiCandidates.length}. Всего на проверку: ${draft.stats.uncertain}.`,
    });
    setRoiCandidates(null);
    setRoiBox(null);
    setRoiMode(false);
  };

  const addManualToDraft = () => {
    const value = state.manualNotation.trim();
    if (value.length === 0) {
      return;
    }
    const base = state.vision ?? emptyVisionSession();
    const next: VisionSession = {
      ...base,
      manualNotations: base.manualNotations.includes(value) ? base.manualNotations : [...base.manualNotations, value],
    };

    if (!state.vision) {
      dispatch({ type: 'SET_VISION_SESSION', session: next, image: state.uploadedImage });
    }
    dispatch({ type: 'ADD_MANUAL_NOTATION', value });

    const draft = buildDraftFromSession(next);
    dispatch({ type: 'SET_VISION_DRAFT', doc: draft.document });

    const translated = draft.translations.some((entry) => entry.candidateText === value && entry.result.kind !== 'unknown');
    dispatch({
      type: 'SHOW_TOAST',
      tone: translated ? 'success' : 'info',
      text: translated
        ? `«${value}» добавлено в черновик инструкции: ${draft.stats.steps} шагов, ${draft.stats.tools} инструментов.`
        : `«${value}» добавлено как примечание: переводчик не распознал формат, уточните запись.`,
    });
  };

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

      {session ? (
        <div className="vision-strip">
          <span className="chip chip-neutral">
            {session.pageId ? 'Лист распознан сервисом' : 'Черновик из ручных шифров'}
          </span>
          <span className="muted small">
            найдено {session.candidates.length} обознач. · штамп: {session.titleBlock?.code ?? 'не прочитан'}
            {session.manualNotations.length > 0 ? ` · вручную: ${session.manualNotations.length}` : ''}
          </span>
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
            {roiMode ? (
              <div
                className="roi-layer"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  dragRef.current = null;
                  setRoiBox(null);
                }}
                role="presentation"
              >
                <span className="roi-hint">Обведите размер или шифр пальцем</span>
              </div>
            ) : null}
            {roiBox && roiBox.w > 0 ? (
              <div
                className={`roi-box ${roiBusy ? 'is-busy' : ''}`}
                style={{ left: `${roiBox.x}%`, top: `${roiBox.y}%`, width: `${roiBox.w}%`, height: `${roiBox.h}%` }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="roi-toolbar">
        <button
          type="button"
          className={`btn btn-sm ${roiMode ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            setRoiMode((value) => !value);
            setRoiError(null);
            setRoiBox(null);
          }}
          disabled={!sheetVisible}
        >
          {roiMode ? 'Отменить выделение' : '⌖ Выделить область'}
        </button>
        {roiBusy ? (
          <span className="muted small roi-status">
            <span className="spinner spinner-sm" aria-hidden="true" /> Перечитываем область…
          </span>
        ) : (
          <span className="muted small">
            {canSelectRegion
              ? 'Сервис не увидел размер — обведите его, и он попадёт в черновик.'
              : 'Выделение работает для листа, распознанного сервисом.'}
          </span>
        )}
      </div>
      <p className="muted small sheet-caption">Лист прокручивается — точки привязаны к геометрии чертежа.</p>

      {roiError ? <div className="notice notice-warning small">{roiError}</div> : null}

      {roiCandidates && roiCandidates.length > 0 ? (
        <section className="roi-result">
          <div className="roi-result-head">
            <h3>Распознано в области</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={addRoiToDraft}>
              Добавить в черновик
            </button>
          </div>
          <ul className="roi-list">
            {roiCandidates.map((candidate) => (
              <li key={candidate.id} className="roi-item">
                <div className="roi-item-head">
                  <strong>{candidate.normalizedText}</strong>
                  <span className={`chip ${candidate.confidence < CONFIDENCE_THRESHOLD ? 'chip-warning' : 'chip-neutral'}`}>
                    {Math.round(candidate.confidence * 100)} %
                  </span>
                </div>
                <TranslationCard result={translateEngineeringNotation(candidate.normalizedText)} compact />
                {candidate.ambiguousOptions.length > 1 ? (
                  <p className="muted small">Варианты чтения: {candidate.ambiguousOptions.join(' · ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {roiWarnings.length > 0 ? <p className="muted small">{roiWarnings.join(' ')}</p> : null}
        </section>
      ) : null}

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
        <button
          type="button"
          className="btn btn-primary btn-sm manual-add"
          onClick={addManualToDraft}
          disabled={manual.length === 0}
        >
          Добавить «{manual.length > 0 ? manual : 'шифр'}» в черновик инструкции
        </button>
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
