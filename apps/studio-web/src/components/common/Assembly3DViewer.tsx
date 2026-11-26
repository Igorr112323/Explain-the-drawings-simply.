import { useEffect, useRef, useState } from 'react';
import type { AssemblyPart } from '@ikguide/schema';
import { AssemblyViewError, createAssemblyView, type AssemblyViewApi, type ViewerTheme } from '../../lib/assembly3d';

export interface Assembly3DViewerProps {
  glbDataUrl: string | null;
  parts: readonly AssemblyPart[];
  activePartIds?: readonly string[];
  installedPartIds?: readonly string[];
  theme: ViewerTheme;
  /** Shown under the canvas, usually «Установи втулку». */
  caption?: string;
  /** Auto-play the «part flies in» animation whenever the active part changes. */
  autoPlay?: boolean;
  compact?: boolean;
  onError?: (message: string) => void;
}

export function Assembly3DViewer({
  glbDataUrl,
  parts,
  activePartIds = [],
  installedPartIds = [],
  theme,
  caption,
  autoPlay = true,
  compact = false,
  onError,
}: Assembly3DViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AssemblyViewApi | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [explode, setExplode] = useState(55);
  const [ghost, setGhost] = useState(true);
  const [triangles, setTriangles] = useState(0);

  // Create (and recreate) the engine when the model changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !glbDataUrl) {
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);

    createAssemblyView(host, { glbDataUrl, parts, theme })
      .then((api) => {
        if (cancelled) {
          api.dispose();
          return;
        }
        apiRef.current = api;
        api.setGhostVisible(ghost);
        api.setExplode(explode / 100);
        api.setHighlight(activePartIds, installedPartIds);
        setTriangles(api.triangleCount());
        setStatus('ready');
        if (autoPlay) {
          api.playInstall();
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) {
          return;
        }
        const message =
          reason instanceof AssemblyViewError
            ? reason.message
            : `Не удалось показать 3D-модель: ${String((reason as Error)?.message ?? reason)}`;
        setStatus('failed');
        setError(message);
        onError?.(message);
      });

    return () => {
      cancelled = true;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
    // `parts`, `activePartIds` and `installedPartIds` are applied by the effects below; the engine is
    // rebuilt only when the actual model (or its GLB payload) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbDataUrl, theme]);

  useEffect(() => {
    apiRef.current?.setHighlight(activePartIds, installedPartIds);
    if (autoPlay && status === 'ready') {
      apiRef.current?.playInstall();
    }
  }, [activePartIds, installedPartIds, autoPlay, status]);

  useEffect(() => {
    apiRef.current?.setExplode(explode / 100);
  }, [explode]);

  useEffect(() => {
    apiRef.current?.setGhostVisible(ghost);
  }, [ghost]);

  useEffect(() => {
    apiRef.current?.setTheme(theme);
  }, [theme]);

  return (
    <div className={`viewer-3d ${compact ? 'viewer-3d-compact' : ''}`}>
      <div className="viewer-3d-frame" ref={hostRef} data-testid="assembly-3d-frame">
        {status === 'failed' ? (
          <div className="viewer-3d-fallback" role="status">
            <p>{error}</p>
            <p className="muted small">Схема IKEA остаётся доступной: переключите вид на «Схема IKEA».</p>
          </div>
        ) : null}
        {status === 'loading' ? <p className="viewer-3d-hint muted small">Загружаю 3D-модель…</p> : null}
      </div>

      <div className="viewer-3d-controls">
        <label className="viewer-3d-slider">
          <span>{explode > 0 ? 'Разнести' : 'Собрать'}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={explode}
            onChange={(event) => setExplode(Number(event.target.value))}
            aria-label="Разнести или собрать детали"
          />
        </label>
        <div className="viewer-3d-buttons">
          <button
            type="button"
            className="chip-button"
            onClick={() => apiRef.current?.playInstall()}
            disabled={status !== 'ready'}
          >
            ↻ Повторить анимацию установки
          </button>
          <button
            type="button"
            className="chip-button"
            aria-pressed={!ghost}
            onClick={() => setGhost((value) => !value)}
            disabled={status !== 'ready'}
          >
            {ghost ? 'Скрыть будущие детали' : 'Показать будущие детали'}
          </button>
          <button
            type="button"
            className="chip-button"
            onClick={() => apiRef.current?.resetCamera()}
            disabled={status !== 'ready'}
          >
            ⤢ Сброс ракурса
          </button>
        </div>
        <p className="viewer-3d-hint muted small">
          Вращение — один палец или мышь, масштаб — щипок или колесо.
          {triangles > 0 ? ` Полигонов: ${triangles.toLocaleString('ru-RU')}.` : ''}
        </p>
      </div>

      {caption ? <p className="viewer-3d-caption">{caption}</p> : null}
    </div>
  );
}
