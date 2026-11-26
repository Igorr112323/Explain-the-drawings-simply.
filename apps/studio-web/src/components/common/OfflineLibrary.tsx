import { useState } from 'react';
import { documentStats } from '@ikguide/schema';
import { removeGuide, setPinned, type StoredGuide } from '../../lib/offlineStore';
import { useStudio } from '../../state/studio';

interface OfflineLibraryProps {
  /** Compact list for the engineer sidebar; the worker home gets the full cards. */
  variant?: 'worker' | 'engineer';
  emptyHint?: string;
}

const SOURCE_LABEL: Record<StoredGuide['source'], string> = {
  engineer: 'из редактора',
  scan: 'со сканера',
  qr: 'по QR',
  published: 'с цехового сервера',
  import: 'из файла',
  demo: 'встроенная',
};

/**
 * «Доступно офлайн» — instructions that really live on this device.
 *
 * The worker sees them first: a pinned guide opens without Wi-Fi, which is the whole point of a
 * tablet in a workshop. The engineer sees the same list to pin, re-open or delete the drafts.
 */
export function OfflineLibrary({ variant = 'worker', emptyHint }: OfflineLibraryProps) {
  const { state, dispatch, adoptGuide, refreshOffline } = useStudio();
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = async (entry: StoredGuide) => {
    await adoptGuide(entry.doc, entry.source, 'prep');
  };

  const togglePin = async (entry: StoredGuide) => {
    setBusyId(entry.id);
    try {
      await setPinned(entry.id, !entry.pinned);
      await refreshOffline();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (entry: StoredGuide) => {
    setBusyId(entry.id);
    try {
      await removeGuide(entry.id);
      await refreshOffline();
      dispatch({ type: 'SHOW_TOAST', tone: 'info', text: `«${entry.doc.metadata.title}» удалена с устройства.` });
    } finally {
      setBusyId(null);
    }
  };

  if (state.offlineLoading && state.offline.length === 0) {
    return <p className="muted small">Читаю офлайн-хранилище…</p>;
  }

  if (state.offline.length === 0) {
    return (
      <p className="muted small">
        {emptyHint ??
          'Здесь появятся инструкции, которые вы создали, импортировали или получили по QR. Они открываются без интернета.'}
      </p>
    );
  }

  return (
    <ul className={`offline-list offline-${variant}`}>
      {state.offline.map((entry) => {
        const stats = documentStats(entry.doc);
        return (
          <li key={entry.id} className={entry.pinned ? 'offline-item is-pinned' : 'offline-item'}>
            <div className="offline-main">
              <div className="offline-title">
                <span className="doc-code">{entry.doc.metadata.drawingCode}</span>
                <strong>{entry.doc.metadata.title}</strong>
                {entry.pinned ? <span className="badge badge-success">Доступно офлайн</span> : null}
              </div>
              <div className="offline-meta">
                <span>{stats.stepCount} шагов</span>
                <span>≈ {stats.totalMinutes} мин</span>
                <span>{SOURCE_LABEL[entry.source]}</span>
                <span>{formatSavedAt(entry.savedAt)}</span>
              </div>
            </div>
            <div className="offline-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => void open(entry)}>
                Открыть
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={busyId === entry.id}
                aria-pressed={entry.pinned}
                onClick={() => void togglePin(entry)}
              >
                {entry.pinned ? 'Не офлайн' : 'Доступно офлайн'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-small text-danger"
                disabled={busyId === entry.id}
                onClick={() => void remove(entry)}
              >
                Удалить
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
