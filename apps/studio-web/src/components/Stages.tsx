/**
 * Что лежит на белом холсте, кроме капсул.
 *
 * До файла — почти ничего: тихая пунктирная рамка по центру и одна строка текста. Пока идёт
 * распознавание — компактная белая пилюля со спиннером и стадией. Если движок недоступен —
 * такая же воздушная карточка с честной подсказкой и кнопкой «открыть пример».
 */
import type { DemoId } from '../lib/pipeline';

export function HintStage({ onDemos, dragging }: { onDemos: () => void; dragging: boolean }) {
  return (
    <div className="hint" data-dragging={dragging ? 'true' : 'false'}>
      <div className="hint-ring" aria-hidden="true" />
      <p className="hint-title">Перетащите 2D-чертёж или PDF сюда</p>
      <p className="hint-sub">
        <button type="button" className="hint-link" onClick={onDemos} data-popover-trigger="">
          или выберите пример
        </button>
      </p>
      <p className="hint-formats">JPG · JPEG · PNG · WEBP · PDF</p>
    </div>
  );
}

export function WorkingStage({ label, percent, files }: { label: string; percent: number; files: string[] }) {
  const clamped = Math.min(1, Math.max(0.04, percent));
  return (
    <div className="working" role="status" aria-live="polite">
      <span className="working-spinner" aria-hidden="true" />
      <span className="working-text">
        <span className="working-label">{label || 'Работаем…'}</span>
        {files.length > 0 && <span className="working-files">{files.join(' · ')}</span>}
      </span>
      <span className="working-progress" aria-hidden="true">
        <span style={{ width: `${Math.round(clamped * 100)}%` }} />
      </span>
    </div>
  );
}

export function ErrorStage({
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
