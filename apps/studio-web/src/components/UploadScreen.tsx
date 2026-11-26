import { useRef, useState } from 'react';
import type { DemoId } from '../lib/pipeline';
import { ACCEPT_ATTRIBUTE } from '../lib/pipeline';
import { DEMO_PROJECTS } from '../data/demos';

/** Шаг 1: большая зона «перетащите файл» и три примера, которые открываются без сети. */
export function UploadScreen({
  onFiles,
  onDemo,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  onDemo: (id: DemoId) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) {
      return;
    }
    onFiles(Array.from(list));
  };

  return (
    <div className="upload">
      <h1 className="upload-title">
        Чертёж или 3D-модель
        <br />
        <span className="upload-title-accent">в понятную инструкцию</span>
      </h1>
      <p className="upload-lede">
        Перетащите файл — получите готовый PDF: крупные схемы, «что понадобится», расшифровка допусков
        и чек-лист контроля. Без облака и без настроек.
      </p>

      <div
        className={`dropzone ${hover ? 'dropzone-hover' : ''} ${disabled ? 'dropzone-disabled' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={(event) => {
          event.preventDefault();
          setHover(false);
          if (!disabled) {
            pick(event.dataTransfer?.files ?? null);
          }
        }}
        onClick={() => {
          if (!disabled) {
            inputRef.current?.click();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Перетащите чертёж или 3D-модель или нажмите, чтобы выбрать файл"
      >
        <div className="dropzone-icon" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="44" height="44">
            <rect x="4" y="8" width="28" height="34" rx="4" fill="#EAF3FF" stroke="#007AFF" strokeWidth="2" />
            <path d="M11 32l7-8 5 6 4-4 4 6" fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
            <path d="M36 18v16m0 0l-5-5m5 5l5-5" fill="none" stroke="#1D1D1F" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <p className="dropzone-title">Перетащите чертёж или 3D-модель сюда</p>
        <p className="dropzone-sub">или нажмите, чтобы выбрать файл</p>
        <p className="dropzone-formats">JPG · PNG · WEBP · PDF · STEP · STP · STL · OBJ · GLB · GLTF</p>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = '';
          }}
          aria-label="Файл чертежа или 3D-модели"
        />
      </div>

      <div className="demos" aria-label="Примеры">
        <p className="demos-label">Или посмотрите готовый пример — он открывается сразу:</p>
        <div className="demos-row">
          {DEMO_PROJECTS.map((demo) => (
            <button
              key={demo.id}
              type="button"
              className="demo-card"
              onClick={() => onDemo(demo.id)}
              disabled={disabled}
            >
              <span className="demo-tag">{demo.tag}</span>
              <span className="demo-title">{demo.title}</span>
              <span className="demo-note">{demo.note}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="upload-hint">
        Файлы остаются на вашем компьютере: распознавание и сборка PDF идут локально. Если сервисы не
        запущены, примеры всё равно работают.
      </p>
    </div>
  );
}

/** Экран ожидания: этапы конвейера и полоса прогресса. */
export function ProcessingScreen({ label, percent, files }: { label: string; percent: number; files: string[] }) {
  return (
    <div className="processing" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2 className="processing-title">{label || 'Работаем…'}</h2>
      <div className="progress" aria-hidden="true">
        <span style={{ width: `${Math.round(Math.min(1, Math.max(0.04, percent)) * 100)}%` }} />
      </div>
      {files.length > 0 && <p className="processing-files">{files.join(' · ')}</p>}
      <p className="processing-note">Первый запуск сервисов занимает несколько секунд.</p>
    </div>
  );
}

/** Экран ошибки: что случилось, что сделать и как посмотреть пример. */
export function ErrorScreen({
  message,
  hint,
  onRetry,
  onDemo,
}: {
  message: string;
  hint: string;
  onRetry: () => void;
  onDemo: (id: DemoId) => void;
}) {
  return (
    <div className="error-card" role="alert">
      <h2>Не получилось</h2>
      <p className="error-message">{message}</p>
      <p className="error-hint">{hint}</p>
      <div className="error-actions">
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Выбрать другой файл
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onDemo('demo-bracket')}>
          Открыть пример «Кронштейн КС-04»
        </button>
      </div>
    </div>
  );
}
