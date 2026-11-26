import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  createStepDraft,
  parseDocumentJson,
  serializeDocument,
  type IkGuideDocument,
} from '@ikguide/schema';
import { useStudio } from '../../state/studio';
import { readTextFile, sanitizeFileName } from '../../lib/download';
import { persistGuide } from '../../lib/offlineStore';
import { guideFileName, isNativeShell, openTextFileNative, printNative, saveTextFile } from '../../lib/nativeExport';
import { buildStandaloneHtml } from '../../lib/qrBridge';
import { BomCanvasCard, StepCanvasCard, SummaryCard, ToolsCanvasCard, type CanvasPosition } from './EngineerCards';
import { CadCanvasCard } from './CadCanvasCard';
import { EngineerToolbar } from './EngineerToolbar';
import { QrDialog } from '../common/QrDialog';
import { OfflineLibrary } from '../common/OfflineLibrary';

interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 1.6;
const COLUMNS = 3;

function defaultStepPosition(index: number): CanvasPosition {
  return {
    x: 460 + (index % COLUMNS) * 420,
    y: 60 + Math.floor(index / COLUMNS) * 720,
  };
}

type DragState =
  | { kind: 'pan'; startX: number; startY: number; originX: number; originY: number }
  | { kind: 'card'; id: string; startX: number; startY: number; originX: number; originY: number };

export function EngineerCanvas() {
  const { doc, dispatch, refreshOffline } = useStudio();
  const [view, setView] = useState<ViewportState>({ x: 0, y: 0, scale: 0.85 });
  const [positions, setPositions] = useState<Record<string, CanvasPosition>>({});
  const [dragging, setDragging] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPositions({});
    setView({ x: 0, y: 0, scale: 0.85 });
  }, [doc.id]);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      if (drag.kind === 'pan') {
        setView((current) => ({
          ...current,
          x: drag.originX + (event.clientX - drag.startX),
          y: drag.originY + (event.clientY - drag.startY),
        }));
        return;
      }
      const dx = (event.clientX - drag.startX) / view.scale;
      const dy = (event.clientY - drag.startY) / view.scale;
      setPositions((current) => ({
        ...current,
        [drag.id]: { x: drag.originX + dx, y: drag.originY + dy },
      }));
    };
    const handleUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [dragging, view.scale]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        setView((current) => {
          const nextScale = clamp(current.scale * (event.deltaY > 0 ? 0.92 : 1.08), MIN_SCALE, MAX_SCALE);
          const worldX = (pointerX - current.x) / current.scale;
          const worldY = (pointerY - current.y) / current.scale;
          return {
            scale: nextScale,
            x: pointerX - worldX * nextScale,
            y: pointerY - worldY * nextScale,
          };
        });
        return;
      }
      setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    setDragging(true);
  };

  const beginCardDrag = (event: ReactPointerEvent<HTMLElement>, stepId: string) => {
    event.stopPropagation();
    const origin = positionFor(stepId, doc.steps.findIndex((step) => step.id === stepId));
    dragRef.current = { kind: 'card', id: stepId, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y };
    setDragging(true);
  };

  const positionFor = (stepId: string, index: number): CanvasPosition => positions[stepId] ?? defaultStepPosition(Math.max(index, 0));

  const zoomBy = (factor: number) => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const pointerX = rect.width / 2;
    const pointerY = rect.height / 2;
    setView((current) => {
      const nextScale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const worldX = (pointerX - current.x) / current.scale;
      const worldY = (pointerY - current.y) / current.scale;
      return { scale: nextScale, x: pointerX - worldX * nextScale, y: pointerY - worldY * nextScale };
    });
  };

  const resetView = () => {
    setView({ x: 0, y: 0, scale: 0.85 });
    setPositions({});
  };

  const addStep = () => {
    const nextNumber = doc.steps.length + 1;
    const draft = createStepDraft({
      id: `step-${Date.now()}`,
      number: nextNumber,
      title: 'Новый шаг',
      workerText: 'Опишите действие рабочего простыми словами: что взять, что сделать и как проверить результат.',
      illustrationId: 'generic-step',
    });
    dispatch({
      type: 'PATCH_DOC',
      updater: (current) => ({ ...current, steps: [...current.steps, draft] }),
    });
    setPositions((current) => ({ ...current, [draft.id]: defaultStepPosition(nextNumber - 1) }));
    dispatch({ type: 'SHOW_TOAST', tone: 'success', text: `Добавлен шаг ${nextNumber}. Отредактируйте текст прямо на карточке.` });
  };

  const exportDocument = async () => {
    try {
      const json = serializeDocument(doc);
      const fileName = guideFileName(`${doc.metadata.drawingCode}-${doc.metadata.revision}`);
      const result = await saveTextFile(fileName, json, { kind: 'json' });
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'success',
        text: result.path ? `Файл сохранён: ${result.path}` : 'Файл .ikguide.json скачан.',
      });
    } catch (error) {
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Документ не прошёл проверку схемы',
      });
    }
  };

  const exportHtml = async () => {
    try {
      await saveTextFile(`${sanitizeFileName(doc.metadata.drawingCode)}-инструкция.html`, buildStandaloneHtml(doc), {
        kind: 'html',
        mimeType: 'text/html',
      });
      dispatch({ type: 'SHOW_TOAST', tone: 'success', text: 'Автономный HTML-файл инструкции готов.' });
    } catch {
      dispatch({ type: 'SHOW_TOAST', tone: 'danger', text: 'Не удалось собрать автономный HTML-файл.' });
    }
  };

  const importDocument = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    try {
      const text = await readTextFile(file);
      const imported: IkGuideDocument = parseDocumentJson(text);
      dispatch({ type: 'IMPORT_DOC', doc: imported });
      await persistGuide(imported, { source: 'import' });
      await refreshOffline();
      dispatch({ type: 'SHOW_TOAST', tone: 'success', text: `Импортирована инструкция «${imported.metadata.title}».` });
    } catch (error) {
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Не удалось импортировать файл',
      });
    }
  };

  return (
    <div className="engineer-stage">
      <EngineerToolbar
        scale={view.scale}
        onZoomIn={() => zoomBy(1.12)}
        onZoomOut={() => zoomBy(0.9)}
        onResetView={resetView}
        onImport={() => {
          if (isNativeShell()) {
            // Windows: a real «Открыть файл» dialog instead of the browser picker.
            void openTextFileNative()
              .then((picked) => (picked ? importDocument(new File([picked.text], picked.name)) : undefined))
              .catch(() => undefined);
            return;
          }
          importInput.current?.click();
        }}
        onExport={exportDocument}
        onExportHtml={exportHtml}
        onQr={() => setQrOpen(true)}
        onPrint={() => void printNative()}
        onAddStep={addStep}
        onPreviewWorker={() => {
          dispatch({ type: 'SET_MODE', mode: 'worker' });
          dispatch({ type: 'SET_SCREEN', screen: 'prep' });
        }}
      />

      <div
        ref={viewportRef}
        className={`canvas-viewport ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={beginPan}
        role="application"
        aria-label="Холст инженера"
      >
        <div className="canvas-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <SummaryCard position={{ x: 24, y: 40 }} />
          <BomCanvasCard position={{ x: 24, y: 470 }} />
          <ToolsCanvasCard position={{ x: 24, y: 880 }} />
          <CadCanvasCard position={{ x: 24, y: 1290 }} />

          {doc.steps.map((step, index) => (
            <StepCanvasCard
              key={step.id}
              step={step}
              index={index}
              total={doc.steps.length}
              position={positionFor(step.id, index)}
              isFocused={focusedId === step.id}
              onDragStart={beginCardDrag}
              onFocus={() => setFocusedId(step.id)}
            />
          ))}
        </div>
      </div>

      <aside className="engineer-library" aria-label="Инструкции на этом устройстве">
        <div className="engineer-library-head">
          <strong>На устройстве</strong>
          <span className="muted small">открываются без сети</span>
        </div>
        <OfflineLibrary variant="engineer" emptyHint="Импортируйте .ikguide.json или получите инструкцию по QR — она сохранится здесь." />
      </aside>

      <div className="engineer-hint">
        <strong>Свободный холст</strong>
        <p>Тяните карточки за шапку, правьте текст прямо в карточке. Колесо — панорама, Ctrl + колесо — зум.</p>
      </div>

      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          void importDocument(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {qrOpen ? <QrDialog doc={doc} onClose={() => setQrOpen(false)} /> : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
