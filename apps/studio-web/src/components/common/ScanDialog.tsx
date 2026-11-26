import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuildResult } from '@ikguide/builder';
import { Modal } from './Modal';
import { SmartCamera } from './SmartCamera';
import { useStudio } from '../../state/studio';
import { buildDraftFromSession, draftSummary } from '../../lib/draft';
import { readDataUrl } from '../../lib/download';
import {
  VisionError,
  fetchVisionHealth,
  newVisionSession,
  recognizeSheets,
  type VisionHealth,
  type VisionSession,
} from '../../lib/vision';

const STAGES = ['Выравниваем лист...', 'Снимаем тени...', 'Ищем штамп и размеры...', 'Переводим ГОСТ/ЕСКД...'] as const;

type Phase = 'checking' | 'pick' | 'working' | 'done' | 'offline' | 'error';
type PickMode = 'camera' | 'file';

interface ScanDialogProps {
  mode: 'files' | 'camera';
  files: File[];
  onClose: () => void;
}

export function ScanDialog({ mode, files, onClose }: ScanDialogProps) {
  const { dispatch } = useStudio();
  const [phase, setPhase] = useState<Phase>('checking');
  const [pickMode, setPickMode] = useState<PickMode>(mode === 'camera' ? 'camera' : 'file');
  const [stage, setStage] = useState(0);
  const [health, setHealth] = useState<VisionHealth | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [session, setSession] = useState<VisionSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetCount, setSheetCount] = useState(0);
  const startedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const run = useCallback(
    async (selected: readonly File[]) => {
      if (selected.length === 0) {
        return;
      }
      setSheetCount(selected.length);
      setPhase('working');
      setStage(0);
      setError(null);
      setResult(null);
      clearTimers();
      timersRef.current = [
        window.setTimeout(() => setStage(1), 1400),
        window.setTimeout(() => setStage(2), 3200),
      ];

      try {
        const response = await recognizeSheets(selected);
        clearTimers();
        setStage(3);
        const nextSession = newVisionSession(response);
        const draft = buildDraftFromSession(nextSession);
        dispatch({
          type: 'SET_VISION_SESSION',
          session: nextSession,
          image: response.pages?.[0]?.imageDataUrl ?? null,
        });
        dispatch({ type: 'SET_VISION_DRAFT', doc: draft.document });
        setSession(nextSession);
        setResult(draft);
        setPhase('done');
      } catch (caught) {
        clearTimers();
        if (caught instanceof VisionError && caught.kind === 'offline') {
          setPhase('offline');
          return;
        }
        setError(caught instanceof Error ? caught.message : 'Не удалось распознать чертёж.');
        setPhase('error');
      }
    },
    [clearTimers, dispatch],
  );

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    let alive = true;
    void fetchVisionHealth().then((nextHealth) => {
      if (!alive) {
        return;
      }
      setHealth(nextHealth);
      if (!nextHealth) {
        setPhase('offline');
        return;
      }
      setPhase('pick');
      if (mode === 'files' && files.length > 0 && !startedRef.current) {
        startedRef.current = true;
        void run(files);
      }
    });
    return () => {
      alive = false;
      clearTimers();
    };
  }, [clearTimers, files, mode, run]);

  const recheck = useCallback(async () => {
    setPhase('checking');
    const nextHealth = await fetchVisionHealth();
    setHealth(nextHealth);
    setPhase(nextHealth ? 'pick' : 'offline');
  }, []);

  const openSheetManually = useCallback(async () => {
    const first = files[0];
    if (!first) {
      onClose();
      return;
    }
    if (!first.type.startsWith('image/')) {
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'danger',
        text: 'PDF без сервиса не открыть: запустите `npm run dev:vision` и повторите.',
      });
      onClose();
      return;
    }
    try {
      const dataUrl = await readDataUrl(first);
      dispatch({ type: 'SET_UPLOADED_IMAGE', src: dataUrl });
      dispatch({ type: 'SET_SCREEN', screen: 'xray' });
      dispatch({
        type: 'SHOW_TOAST',
        tone: 'info',
        text: 'Лист открыт вручную. Шифры можно ввести на экране «Рентген» и добавить в инструкцию.',
      });
    } catch {
      dispatch({ type: 'SHOW_TOAST', tone: 'danger', text: 'Не удалось прочитать изображение.' });
    }
    onClose();
  }, [dispatch, files, onClose]);

  const onPicked = (list: FileList | null) => {
    const selected = Array.from(list ?? []);
    if (selected.length > 0) {
      void run(selected);
    }
  };

  const title =
    phase === 'done'
      ? 'Черновик инструкции готов'
      : phase === 'offline'
        ? 'Авто-распознавание офлайн'
        : pickMode === 'camera'
          ? 'Умная камера'
          : 'Загрузить чертёж';

  const subtitle =
    phase === 'offline'
      ? 'Демо и уже открытые инструкции работают без сервиса — он нужен только для новых листов.'
      : 'Фото, скан или PDF. Несколько листов можно выбрать сразу: чертёж и спецификация.';

  const footer = (
    <div className="row gap-8 scan-footer">
      {phase === 'offline' ? (
        <>
          <button type="button" className="btn btn-ghost" onClick={() => void recheck()}>
            Проверить снова
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void openSheetManually()}>
            Открыть лист вручную
          </button>
        </>
      ) : null}
      {phase === 'done' ? (
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              dispatch({ type: 'SET_SCREEN', screen: 'xray' });
              onClose();
            }}
          >
            Проверить шифры
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              dispatch({ type: 'SET_SCREEN', screen: 'prep' });
              onClose();
            }}
          >
            Открыть инструкцию
          </button>
        </>
      ) : null}
      {phase === 'error' ? (
        <button type="button" className="btn btn-ghost" onClick={() => setPhase('pick')}>
          Попробовать другой файл
        </button>
      ) : null}
      {phase !== 'done' ? (
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Закрыть
        </button>
      ) : null}
    </div>
  );

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} wide footer={footer}>
      {phase === 'checking' ? (
        <div className="scan-checking">
          <span className="spinner" aria-hidden="true" />
          <p>Проверяем сервис распознавания…</p>
        </div>
      ) : null}

      {phase === 'pick' ? (
        <div className="scan-pick">
          {pickMode === 'camera' ? (
            <>
              <SmartCamera onCapture={(file) => void run([file])} onFallback={() => setPickMode('file')} />
              <button type="button" className="link-button" onClick={() => setPickMode('file')}>
                Или загрузить готовый скан / PDF
              </button>
            </>
          ) : (
            <>
              <button type="button" className="dropzone" onClick={() => fileRef.current?.click()}>
                <span className="dropzone-icon" aria-hidden="true">📄</span>
                <strong>Выбрать чертежи</strong>
                <span className="muted small">JPG, PNG, WebP или PDF · до 25 МБ на файл · до 6 листов</span>
              </button>
              <div className="row gap-8 scan-pick-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setPickMode('camera')}>
                  Включить камеру
                </button>
                {health ? (
                  <span className="chip chip-neutral">
                    Сервис на связи · {health.ocr === 'none' ? 'без OCR' : health.ocr}
                  </span>
                ) : null}
              </div>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            hidden
            onChange={(event) => {
              onPicked(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      ) : null}

      {phase === 'working' ? (
        <div className="scan-progress" role="status" aria-live="polite">
          <p className="muted small">
            Сервис обрабатывает {sheetCount > 1 ? `${sheetCount} листа` : 'лист'} — обычно 3–8 секунд.
          </p>
          <ol className="stage-list">
            {STAGES.map((label, index) => {
              const state_ = index < stage ? 'done' : index === stage ? 'active' : 'idle';
              return (
                <li key={label} className={`stage-item stage-${state_}`}>
                  <span className="stage-marker" aria-hidden="true">
                    {state_ === 'done' ? '✓' : index + 1}
                  </span>
                  <span className="stage-label">{label}</span>
                  {state_ === 'active' ? <span className="spinner spinner-sm" aria-hidden="true" /> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {phase === 'done' && result ? (
        <div className="scan-done">
          <div className="notice notice-success">
            <strong>{draftSummary(result)}</strong>
            <p>
              {result.stats.uncertain > 0
                ? 'Неуверенные обозначения подсвечены в «Рентгене» — подтвердите их перед выдачей в цех.'
                : 'Все обозначения распознаны уверенно. Проверьте штамп и габарит заготовки.'}
            </p>
          </div>
          <dl className="scan-stats">
            <div>
              <dt>Листов</dt>
              <dd>{session?.pages.length ?? sheetCount}</dd>
            </div>
            <div>
              <dt>Распознано</dt>
              <dd>{result.stats.recognised}</dd>
            </div>
            <div>
              <dt>На проверку</dt>
              <dd>{result.stats.uncertain}</dd>
            </div>
            <div>
              <dt>Инструментов</dt>
              <dd>{result.stats.tools}</dd>
            </div>
            <div>
              <dt>Контрольных точек</dt>
              <dd>{result.stats.qcItems}</dd>
            </div>
          </dl>
          {result.warnings.length > 0 ? (
            <ul className="scan-warnings">
              {result.warnings.slice(0, 4).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {phase === 'offline' ? (
        <div className="scan-offline">
          <div className="notice notice-warning">
            <strong>Сервис авто-распознавания офлайн…</strong>
            <p>
              Это не ошибка приложения: демо-инструкции и уже открытые чертежи работают как обычно. Для новых
              листов запустите локальный сервис на компьютере инженера:
            </p>
            <code className="scan-command">npm run dev:vision</code>
            <p className="muted small">
              Первый запуск ставит Python-зависимости. Адрес сервиса по умолчанию —{' '}
              <code>http://127.0.0.1:8000</code>, его можно изменить в <code>VITE_VISION_API_URL</code>.
            </p>
          </div>
          <ul className="scan-offline-list">
            <li>Открыть лист вручную и ввести шифры на экране «Рентген».</li>
            <li>Загрузить готовый файл инструкции <code>.ikguide.json</code>.</li>
            <li>Продолжить работу с демо-проектами — они не зависят от сервиса.</li>
          </ul>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="notice notice-danger">
          <strong>Не удалось распознать чертёж</strong>
          <p>{error}</p>
        </div>
      ) : null}
    </Modal>
  );
}
