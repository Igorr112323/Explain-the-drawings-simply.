/**
 * Поповер «•••»: тема цеха, состояние движка и адреса сервисов.
 *
 * Здесь нет настроек продукта — их не бывает. Только то, что нужно, когда «ничего не происходит»:
 * жив ли локальный движок, куда он смотрит, и светлая или тёмная тема удобнее в цеху.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  CAD_URL_KEY,
  VISION_URL_KEY,
  storeBaseUrl,
  storedBaseUrl,
} from '../lib/runtimeConfig';
import { checkEngines, displayEngineUrl, engineLabel, type EngineReport } from '../lib/engine';
import { isNativeShell } from '../lib/nativeExport';
import type { Theme } from '../lib/theme';
import { IconMoon, IconSun } from './icons';

function StatusRow({ title, state, url }: { title: string; state: EngineReport['vision']; url: string }) {
  return (
    <li className="engine-row">
      <span className={`engine-dot engine-${state}`} aria-hidden="true" />
      <span className="engine-text">
        <span className="engine-title">{title}</span>
        <span className="engine-url">{displayEngineUrl(url)}</span>
      </span>
      <span className={`engine-state engine-${state}`}>{engineLabel(state)}</span>
    </li>
  );
}

export function MoreMenu({ theme, onTheme }: { theme: Theme; onTheme: (theme: Theme) => void }) {
  const [report, setReport] = useState<EngineReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [visionUrl, setVisionUrl] = useState(() => storedBaseUrl(VISION_URL_KEY));
  const [cadUrl, setCadUrl] = useState(() => storedBaseUrl(CAD_URL_KEY));

  const probe = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await checkEngines());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const saveUrls = () => {
    storeBaseUrl(VISION_URL_KEY, visionUrl.trim() || null);
    storeBaseUrl(CAD_URL_KEY, cadUrl.trim() || null);
    setVisionUrl(storedBaseUrl(VISION_URL_KEY));
    setCadUrl(storedBaseUrl(CAD_URL_KEY));
    void probe();
  };

  return (
    <div className="panel">
      <section className="panel-section">
        <p className="field-label">Тема</p>
        <div className="segment" role="group" aria-label="Тема оформления">
          <button type="button" className="segment-btn" data-active={theme === 'light' ? 'true' : undefined} onClick={() => onTheme('light')}>
            <IconSun size={18} />
            <span>Светлая</span>
          </button>
          <button type="button" className="segment-btn" data-active={theme === 'dark' ? 'true' : undefined} onClick={() => onTheme('dark')}>
            <IconMoon size={18} />
            <span>Тёмная</span>
          </button>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-head-row">
          <p className="field-label">Движок</p>
          <button type="button" className="chip" onClick={() => void probe()} disabled={busy}>
            {busy ? 'проверяем…' : 'проверить /health'}
          </button>
        </div>
        <ul className="engine-list">
          <StatusRow title="Распознавание чертежа" state={report?.vision ?? 'unknown'} url={report?.visionUrl ?? ''} />
          <StatusRow title="3D-модели" state={report?.cad ?? 'unknown'} url={report?.cadUrl ?? ''} />
        </ul>
        <p className="panel-note">
          {isNativeShell()
            ? 'Движок лежит рядом с .exe: приложение запускает его само и молча, без чёрного окна консоли.'
            : 'В браузере движок поднимается командой npm run dev:all — файлы при этом остаются на компьютере.'}
        </p>
      </section>

      <details className="panel-details">
        <summary>Адреса сервисов</summary>
        <div className="field-row">
          <label className="field">
            <span className="field-label">Распознавание</span>
            <input
              type="text"
              className="lookup"
              value={visionUrl}
              placeholder="по умолчанию"
              aria-label="Адрес сервиса распознавания"
              onChange={(event) => setVisionUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">3D</span>
            <input
              type="text"
              className="lookup"
              value={cadUrl}
              placeholder="по умолчанию"
              aria-label="Адрес сервиса 3D"
              onChange={(event) => setCadUrl(event.target.value)}
            />
          </label>
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={saveUrls}>
          Сохранить и проверить
        </button>
        <p className="panel-note">Пусто — значения по умолчанию (127.0.0.1:8000 и :8001).</p>
      </details>
    </div>
  );
}
