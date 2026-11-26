/**
 * Документ на холсте: белые листы A4 «на столе», парящая пилюля нечёткого размера и уведомления.
 *
 * Никаких панелей вокруг: листы — это и есть интерфейс. Колесо мыши прокручивает стол, ⌘/Ctrl +
 * колесо — плавно масштабирует листы (двойной клик возвращает 100 %), клик по тексту листа
 * открывает правку ровно этого поля.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanTarget } from '@ikguide/pdf-exporter';
import type { PipelineApi } from '../state/pipeline';
import { buildPlan } from '../lib/pdfExport';
import { PagePreview } from './PagePreview';

const DEFAULT_ZOOM = 0.72;
const MIN_ZOOM = 0.42;
const MAX_ZOOM = 1.25;

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

/** Одна маленькая пилюля: нечёткий размер подтверждается одним кликом. */
function AmbiguousPill({ api, onOpenXray }: { api: PipelineApi; onOpenXray: () => void }) {
  const [first] = api.ambiguous;
  if (!first) {
    return null;
  }
  return (
    <div className="notice notice-ask" role="status">
      <span className="notice-text">
        <strong>Проверьте размер</strong> <code className="notice-code">{first.raw}</code> или
      </span>
      <span className="notice-choices">
        {first.options.map((option) => (
          <button
            key={option}
            type="button"
            className="chip chip-choice"
            onClick={() => api.actions.resolveSize(first.annotationId, option)}
          >
            {option}
          </button>
        ))}
      </span>
      {api.ambiguous.length > 1 ? (
        <button type="button" className="notice-more" onClick={onOpenXray}>
          ещё {api.ambiguous.length - 1}
        </button>
      ) : (
        <span className="notice-confidence">{Math.round(first.confidence * 100)}%</span>
      )}
    </div>
  );
}

export function ReviewStage({ api, onTarget, onOpenXray }: { api: PipelineApi; onTarget: (target: PlanTarget) => void; onOpenXray: () => void }) {
  const plan = useMemo(() => buildPlan(api.doc!, api.illustrations), [api.doc, api.illustrations]);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const desk = useRef<HTMLDivElement>(null);

  const onWheel = useCallback((event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    setZoom((value) => clampZoom(value - event.deltaY * 0.0022));
  }, []);

  useEffect(() => {
    const node = desk.current;
    if (!node) {
      return;
    }
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
    };
  }, [onWheel]);

  return (
    <>
      <div className="notices" aria-live="polite">
        {api.error && (
          <div className="notice notice-error" role="alert">
            <span className="notice-text">
              <strong>{api.error.message}</strong> {api.error.hint}
            </span>
          </div>
        )}
        <AmbiguousPill api={api} onOpenXray={onOpenXray} />
        {api.ambiguous.length === 0 && api.softNotes.length > 0 && (
          <div className="notice notice-warn" role="status">
            <span className="notice-text">
              <strong>Есть неуверенные обозначения.</strong> Проверьте их в «Рентгене ГОСТ» — в PDF они помечены «проверить по чертежу».
            </span>
            <button type="button" className="notice-more" onClick={onOpenXray}>
              открыть
            </button>
          </div>
        )}
        {api.pdfJob && (
          <div className="notice notice-ok">
            <span className="notice-text">
              <strong>PDF готов.</strong> {api.pdfJob.fileName} · {api.pdfJob.plan.pages.length} стр. ·{' '}
              {(api.pdfJob.bytes.byteLength / 1024).toFixed(0)} КБ
            </span>
          </div>
        )}
      </div>

      <div className="sheets" ref={desk} onDoubleClick={() => setZoom(DEFAULT_ZOOM)}>
        {plan.pages.map((page) => (
          <PagePreview key={page.index} page={page} total={plan.pages.length} scale={zoom} onTarget={onTarget} />
        ))}
      </div>
    </>
  );
}
