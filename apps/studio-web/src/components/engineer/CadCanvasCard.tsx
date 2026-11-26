import { useEffect, useRef, useState } from 'react';
import { buildGuideFromCad, mergeCadUpdate, type CadImportResponse } from '@ikguide/builder';
import { useStudio } from '../../state/studio';
import { cadHealth, cadImport, cadRenderView, needsCadServer, type CadHealth } from '../../lib/cad';
import { downloadText, sanitizeFileName } from '../../lib/download';
import { serializeDocument, type GuideStep } from '@ikguide/schema';
import { sanitizeSvgMarkup } from '../../lib/ikeaSvg';

/**
 * Engineer card for the 3D pipeline:
 *  • «Загрузить 3D-сборку» — .glb/.gltf/.stl/.obj/.step; through cad-api when it is up,
 *    or fully in the browser for GLB/GLTF when it is not;
 *  • «Обновить 3D-модель» — re-imports the previous file and merges it into the current guide,
 *    keeping every manual text, anti-error and camera angle;
 *  • «Снять IKEA-ракурс» — re-renders the current step from the session at the chosen angles;
 *  • «Экспорт SVG» — saves the diagram for the A4 sheet / ERP.
 */

/** `OfflineImportError` comes from a lazily loaded chunk, so it is recognised by name. */
type OfflineError = Error & { hint?: string | null };

function isOfflineError(error: unknown): error is OfflineError {
  return error instanceof Error && error.name === 'OfflineImportError';
}

interface CadCanvasCardProps {
  position: { x: number; y: number };
}

export function CadCanvasCard({ position }: CadCanvasCardProps) {
  const { doc, dispatch } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<CadHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [lastResponse, setLastResponse] = useState<CadImportResponse | null>(null);
  const [azimuth, setAzimuth] = useState(35);
  const [elevation, setElevation] = useState(26);
  const [hint, setHint] = useState<string | null>(null);
  const [lastSvg, setLastSvg] = useState<string | null>(null);
  const [stepNumber, setStepNumber] = useState(1);

  const assembly = doc.assembly3d ?? null;

  useEffect(() => {
    let alive = true;
    cadHealth()
      .then((result) => {
        if (alive) {
          setHealth(result);
        }
      })
      .catch(() => {
        if (alive) {
          setHealth(null);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const toast = (tone: 'info' | 'success' | 'danger', text: string) => dispatch({ type: 'SHOW_TOAST', tone, text });

  const applyImport = async (file: File, mode: 'fresh' | 'update') => {
    setBusy(true);
    setHint(null);
    try {
      let response: CadImportResponse | null = null;
      if (needsCadServer(file.name)) {
        response = await cadImport(file);
      } else {
        // Meshes work offline; the service adds real volumes and a proper disassembly order.
        try {
          response = await cadImport(file);
        } catch (error) {
          if (isOfflineError(error)) {
            throw error;
          }
          // three.js lives in a separate chunk: it is downloaded only on this offline path.
          const { importMeshOffline } = await import('../../lib/cadOffline');
          response = await importMeshOffline(file);
          setHint('Сервис 3D-моделей недоступен: сборка разобрана в браузере, порядок шагов черновой.');
        }
      }

      if (!response) {
        throw new Error('Пустой ответ сервиса 3D-моделей.');
      }

      setLastFile(file);
      setLastResponse(response);

      if (mode === 'update' && doc.assembly3d) {
        const merged = mergeCadUpdate(doc, response, { drawingCode: doc.metadata.drawingCode });
        dispatch({ type: 'IMPORT_DOC', doc: merged.document });
        toast('success', merged.summary);
        merged.warnings.forEach((warning) => toast('info', warning));
      } else {
        const built = buildGuideFromCad(response, {
          drawingCode: doc.metadata.drawingCode !== '—' ? doc.metadata.drawingCode : undefined,
          material: doc.metadata.material,
        });
        dispatch({ type: 'IMPORT_DOC', doc: built.document });
        toast(
          'success',
          `3D-сборка «${built.document.metadata.title}»: ${built.stats.steps} шагов, ${built.stats.parts} деталей.`,
        );
      }
    } catch (error) {
      if (isOfflineError(error)) {
        const text =
          error.hint === 'step'
            ? 'STEP требует сервер 3D-моделей: запустите npm run dev:cad и повторите импорт.'
            : error.hint === 'server'
              ? 'Этот формат читает только сервер 3D-моделей: запустите npm run dev:cad.'
              : error.message;
        setHint(text);
        toast('danger', text);
      } else {
        const message = error instanceof Error ? error.message : 'Не удалось загрузить 3D-модель.';
        setHint(message);
        toast('danger', message);
      }
    } finally {
      setBusy(false);
    }
  };

  const captureView = async () => {
    setBusy(true);
    try {
      const step = doc.steps.find((item) => item.number === stepNumber) ?? doc.steps[0];
      const activeIds = step?.activePartIds ?? [];
      const installedIds = step?.installedPartIds ?? [];
      if (!lastResponse) {
        throw new Error('Ракурс снимается с сессии 3D-модели: сначала загрузите сборку в этой вкладке.');
      }
      const rendered = await cadRenderView({
        sessionId: lastResponse.sessionId,
        azimuth,
        elevation,
        activePartIds: activeIds,
        installedPartIds: installedIds,
        attention: step?.antiError?.text ?? null,
        caption: step ? `Шаг ${step.number}. ${step.title}` : null,
      });
      const markup = sanitizeSvgMarkup(rendered.svg);
      if (!markup) {
        throw new Error('Сервис вернул пустую схему.');
      }
      setLastSvg(markup);
      dispatch({
        type: 'PATCH_DOC',
        updater: (current) => ({
          ...current,
          steps: current.steps.map((item): GuideStep =>
            item.number === stepNumber
              ? { ...item, svgDiagram: markup, cameraView: { azimuth, elevation } }
              : item,
          ),
        }),
      });
      toast('success', `IKEA-ракурс шага ${stepNumber} снят: ${Math.round(azimuth)}° / ${Math.round(elevation)}°.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось снять ракурс.';
      setHint(message);
      toast('danger', message);
    } finally {
      setBusy(false);
    }
  };

  const exportSvg = () => {
    const svg = lastSvg ?? sanitizeSvgMarkup(doc.steps.find((step) => step.number === stepNumber)?.svgDiagram);
    if (!svg) {
      toast('danger', 'Для этого шага ещё нет IKEA-схемы.');
      return;
    }
    downloadText(
      `${sanitizeFileName(doc.metadata.drawingCode)}-шаг-${stepNumber}.svg`,
      svg,
      'image/svg+xml',
    );
    toast('success', 'SVG сохранён — его можно вставить в А4 и в ERP.');
  };

  return (
    <article className="canvas-card cad-card" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      <header className="canvas-card-head">
        <span className="step-chip">3D</span>
        <h3>3D-сборка</h3>
        <span className={`cad-health ${health ? 'is-online' : 'is-offline'}`}>
          {health ? 'сервис доступен' : 'сервис выключен'}
        </span>
      </header>

      <div className="cad-card-body">
        <p className="muted small">
          {assembly
            ? `Модель: ${assembly.sourceFormat.toUpperCase()} · ${assembly.parts.length} деталей · ${assembly.sizeMm.x}×${assembly.sizeMm.y}×${assembly.sizeMm.z} мм`
            : 'Приложите .glb, .gltf, .stl, .obj или .step — сервис разберёт сборку на детали и предложит порядок шагов.'}
        </p>

        <div className="cad-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {assembly ? '⤒ Заменить 3D-сборку' : '⤒ Загрузить 3D-сборку'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !lastFile || !assembly}
            onClick={() => lastFile && void applyImport(lastFile, 'update')}
          >
            ↻ Обновить 3D-модель
          </button>
        </div>

        {assembly ? (
          <>
            <div className="cad-view-params">
              <label>
                Шаг
                <select value={stepNumber} onChange={(event) => setStepNumber(Number(event.target.value))}>
                  {doc.steps.map((step) => (
                    <option key={step.id} value={step.number}>
                      {step.number}. {step.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Азимут {Math.round(azimuth)}°
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={azimuth}
                  onChange={(event) => setAzimuth(Number(event.target.value))}
                />
              </label>
              <label>
                Наклон {Math.round(elevation)}°
                <input
                  type="range"
                  min={-80}
                  max={80}
                  value={elevation}
                  onChange={(event) => setElevation(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="cad-actions">
              <button type="button" className="btn btn-ghost" disabled={busy || !lastResponse} onClick={() => void captureView()}>
                📐 Снять IKEA-ракурс
              </button>
              <button type="button" className="btn btn-ghost" onClick={exportSvg}>
                ⤓ Экспорт SVG
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  downloadText(
                    `${sanitizeFileName(doc.metadata.drawingCode)}-${doc.metadata.revision}.ikguide.json`,
                    serializeDocument(doc),
                  )
                }
              >
                ⤓ Инструкция
              </button>
            </div>
            <p className="muted small">
              Ревизия документа: {doc.metadata.revision}. Ручные пометки, анти-ошибки и ракурсы сохраняются при обновлении.
            </p>
          </>
        ) : null}

        {hint ? <p className="inline-warning">{hint}</p> : null}
        {busy ? <p className="muted small">Обрабатываю модель…</p> : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf,.stl,.obj,.step,.stp,model/gltf-binary,model/gltf+json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void applyImport(file, assembly ? 'update' : 'fresh');
          }
          event.target.value = '';
        }}
      />

      {health ? (
        <p className="cad-footnote muted small">
          Движок: {health.stepEnabled ? health.stepEngine : 'только меши'} · форматы: {health.formats.join(', ')} · до{' '}
          {health.maxUploadMb} МБ
        </p>
      ) : null}
    </article>
  );
}
