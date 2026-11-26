/**
 * Документ на холсте: белые листы A4 «на столе», парящая пилюля нечёткого размера и уведомления.
 *
 * Никаких панелей вокруг: листы — это и есть интерфейс. Масштаб и сдвиг стола:
 *   • колесо мыши и пинч трекпада (`Ctrl + колесо`) — плавный зум 40…250 % вокруг курсора;
 *   • перетаскивание фона (при масштабе > 100 %), правая/средняя кнопка или `Пробел` + тяга — сдвиг;
 *   • `Ctrl/Cmd +`, `Ctrl/Cmd −`, `Ctrl/Cmd 0` — шаг и сброс к 100 %;
 *   • мини-пилюля `− 100 % +` в правом нижнем углу: процент возвращает масштаб и центрирует листы.
 *
 * Колёсико и клавиши не перехватываются, когда фокус в поле ввода или в поповере: правка текста и
 * прокрутка длинных списков продолжают работать как обычно.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlanTarget } from '@ikguide/pdf-exporter';
import type { PipelineApi } from '../state/pipeline';
import { buildPlan } from '../lib/pdfExport';
import {
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  RESET_ZOOM,
  clampZoom,
  scrollAfterZoom,
  zoomHint,
  zoomIn,
  zoomLabel,
  zoomOut,
} from '../lib/zoom';
import { PagePreview } from './PagePreview';

/** Внутри этих элементов колесо и клавиши принадлежат им, а не холсту. */
const TYPING_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
/** По этим элементам клик — действие, а не начало перетаскивания стола. */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, label, [role="button"]';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_SELECTOR) !== null;
}

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

/** Пилюля масштаба: `− 100 % +`, без панелей и подписей. */
function ZoomPill({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="zoom-pill" role="group" aria-label="Масштаб листов" title={zoomHint()}>
      <button
        type="button"
        className="zoom-btn"
        onClick={onZoomOut}
        disabled={zoom <= MIN_ZOOM}
        aria-label="Уменьшить масштаб"
      >
        −
      </button>
      <button
        type="button"
        className="zoom-value"
        onClick={onReset}
        aria-label={`Сбросить масштаб до 100 процентов (сейчас ${zoomLabel(zoom)})`}
        title="Сбросить к 100 % и центрировать листы"
      >
        {zoomLabel(zoom)}
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={onZoomIn}
        disabled={zoom >= MAX_ZOOM}
        aria-label="Увеличить масштаб"
      >
        +
      </button>
    </div>
  );
}

export function ReviewStage({
  api,
  onTarget,
  onOpenXray,
}: {
  api: PipelineApi;
  onTarget: (target: PlanTarget) => void;
  onOpenXray: () => void;
}) {
  const plan = useMemo(() => buildPlan(api.doc!, api.illustrations), [api.doc, api.illustrations]);
  const [zoom, setZoom] = useState(FIT_ZOOM);
  const [panning, setPanning] = useState(false);
  const desk = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  /** Меняет масштаб, удерживая точку под курсором на месте. */
  const zoomAround = useCallback((next: number, clientX?: number, clientY?: number) => {
    const deskNode = desk.current;
    const previous = zoomRef.current;
    const target = clampZoom(next);
    if (Math.abs(target - previous) < 1e-4) {
      return;
    }
    if (deskNode) {
      const rect = deskNode.getBoundingClientRect();
      const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;
      const left = scrollAfterZoom(deskNode.scrollLeft, px, previous, target);
      const top = scrollAfterZoom(deskNode.scrollTop, py, previous, target);
      zoomRef.current = target;
      setZoom(target);
      // Прокрутка возможна только после перерисовки листов в новом размере.
      requestAnimationFrame(() => {
        deskNode.scrollLeft = left;
        deskNode.scrollTop = top;
      });
      return;
    }
    zoomRef.current = target;
    setZoom(target);
  }, []);

  const resetZoom = useCallback(() => {
    zoomAround(RESET_ZOOM);
    const deskNode = desk.current;
    if (deskNode) {
      requestAnimationFrame(() => {
        deskNode.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
      });
    }
  }, [zoomAround]);

  /* Колесо: обычное и пинч трекпада (Ctrl+колесо). Пассивный слушатель не годится — нужен preventDefault. */
  useEffect(() => {
    const node = desk.current;
    if (!node) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (isTyping(event.target)) {
        return;
      }
      event.preventDefault();
      const pinch = event.ctrlKey || event.metaKey;
      const factor = Math.exp(-event.deltaY * (pinch ? 0.01 : 0.0016));
      const bounded = Math.min(1.35, Math.max(1 / 1.35, factor));
      zoomAround(zoomRef.current * bounded, event.clientX, event.clientY);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  /* Клавиатура: Ctrl/Cmd +, −, 0; пробел включает режим сдвига. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) {
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier) {
        if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
          event.preventDefault();
          zoomAround(zoomIn(zoomRef.current));
        } else if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
          event.preventDefault();
          zoomAround(zoomOut(zoomRef.current));
        } else if (event.key === '0' || event.code === 'Numpad0') {
          event.preventDefault();
          resetZoom();
        }
        return;
      }
      if (event.code === 'Space' && !event.repeat) {
        spaceRef.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [resetZoom, zoomAround]);

  const canStartPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || event.button === 2 || spaceRef.current) {
      return true;
    }
    if (event.button !== 0) {
      return false;
    }
    // Левая кнопка по фону — только когда листы крупнее 100 %: иначе это просто клик/скролл.
    const target = event.target as Element | null;
    return zoomRef.current > RESET_ZOOM && !target?.closest(INTERACTIVE_SELECTOR);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canStartPan(event)) {
      return;
    }
    const node = desk.current;
    if (!node) {
      return;
    }
    event.preventDefault();
    node.setPointerCapture?.(event.pointerId);
    panRef.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
    setPanning(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = desk.current;
    const start = panRef.current;
    if (!node || !start) {
      return;
    }
    node.scrollLeft = start.left - (event.clientX - start.x);
    node.scrollTop = start.top - (event.clientY - start.y);
  };

  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };

  /* Двухпальцевый пинч на сенсорных экранах: тот же диапазон 40…250 %. */
  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) {
      return;
    }
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    pinchRef.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom: zoomRef.current };
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = pinchRef.current;
    if (!start || event.touches.length !== 2) {
      return;
    }
    const [a, b] = [event.touches[0]!, event.touches[1]!];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (distance <= 0 || start.distance <= 0) {
      return;
    }
    const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    zoomAround((start.zoom * distance) / start.distance, center.x, center.y);
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

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

      <div
        className="sheets"
        ref={desk}
        data-panning={panning ? 'true' : 'false'}
        data-zoomable={zoom > RESET_ZOOM ? 'true' : 'false'}
        onDoubleClick={(event) => {
          if (isTyping(event.target)) {
            return;
          }
          resetZoom();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={endPan}
        onContextMenu={(event) => event.preventDefault()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {plan.pages.map((page) => (
          <PagePreview key={page.index} page={page} total={plan.pages.length} scale={zoom} onTarget={onTarget} />
        ))}
      </div>

      <div className="zoom-slot">
        <ZoomPill zoom={zoom} onZoomIn={() => zoomAround(zoomIn(zoomRef.current))} onZoomOut={() => zoomAround(zoomOut(zoomRef.current))} onReset={resetZoom} />
      </div>
    </>
  );
}
