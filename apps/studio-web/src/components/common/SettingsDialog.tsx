import { useState } from 'react';
import { useStudio } from '../../state/studio';
import {
  DEFAULT_SETTINGS,
  NATIVE_DEFAULT_CAD,
  NATIVE_DEFAULT_VISION,
  canSwitchToEngineer,
  getCadBaseUrl,
  getVisionBaseUrl,
  joinUrl,
  probeConnection,
  runtimeLabel,
  sanitizeBaseUrl,
  suggestLanAddresses,
  type ConnectionReport,
  type ConnectionSettings,
} from '../../lib/runtimeConfig';
import { storeBackendName } from '../../lib/offlineStore';
import { Modal } from './Modal';

/**
 * «Настройки и подключение» — the only screen an engineer opens on the shop floor before work:
 * two addresses, a LAN hint, «Проверить связь» and the strict-workshop switch.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStudio();
  const [draft, setDraft] = useState<ConnectionSettings>(state.settings);
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [checking, setChecking] = useState(false);
  const suggestion = suggestLanAddresses();
  const visionEffective = getVisionBaseUrl(draft, state.runtime);
  const cadEffective = getCadBaseUrl(draft, state.runtime);
  const backend = storeBackendName();
  const lockedByStrictMode = !canSwitchToEngineer(state.runtime, draft);

  const update = (patch: Partial<ConnectionSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setReport(null);
  };

  const check = async () => {
    setChecking(true);
    setReport(null);
    try {
      setReport(await probeConnection(draft, state.runtime));
    } finally {
      setChecking(false);
    }
  };

  const save = () => {
    dispatch({ type: 'SET_SETTINGS', settings: { ...draft, visionBaseUrl: sanitizeBaseUrl(draft.visionBaseUrl), cadBaseUrl: sanitizeBaseUrl(draft.cadBaseUrl) } });
    dispatch({ type: 'SHOW_TOAST', tone: 'success', text: 'Адреса серверов сохранены на этом устройстве.' });
    onClose();
  };

  return (
    <Modal
      title="Настройки и подключение"
      subtitle="Где запущены сервисы распознавания и 3D. Адрес запоминается на этом устройстве."
      onClose={onClose}
      wide
      footer={
        <div className="row gap-8 settings-footer">
          <button type="button" className="btn btn-ghost" onClick={() => { setDraft(DEFAULT_SETTINGS); setReport(null); }}>
            Сбросить
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" disabled={checking} onClick={() => void check()}>
            {checking ? 'Проверяю…' : 'Проверить связь'}
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Сохранить
          </button>
        </div>
      }
    >
      <div className="settings-grid">
        <section className="settings-section">
          <h3>Сервисы</h3>
          <label className="field">
            <span className="field-label">Распознавание чертежей</span>
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder={visionEffective || NATIVE_DEFAULT_VISION}
              value={draft.visionBaseUrl}
              onChange={(event) => update({ visionBaseUrl: event.target.value })}
              aria-describedby="vision-hint"
            />
            <span className="field-hint" id="vision-hint">
              {visionEffective
                ? joinUrl(visionEffective, '/health')
                : joinUrl('', '/health') + ' — относительный адрес, работает через прокси dev-сервера'}
            </span>
          </label>

          <label className="field">
            <span className="field-label">3D-модели и схемы</span>
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              placeholder={cadEffective || NATIVE_DEFAULT_CAD}
              value={draft.cadBaseUrl}
              onChange={(event) => update({ cadBaseUrl: event.target.value })}
              aria-describedby="cad-hint"
            />
            <span className="field-hint" id="cad-hint">
              {cadEffective ? joinUrl(cadEffective, '/v1/cad/health') : '/v1/cad/health — относительный адрес'}
            </span>
          </label>

          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => update({ visionBaseUrl: suggestion.vision, cadBaseUrl: suggestion.cad })}
          >
            Подставить {suggestion.vision.replace('http://', '')} и {suggestion.cad.replace('http://', '')}
          </button>
          <p className="muted small">
            Цеховой ноутбук отдаёт сервисы на портах 8000 и 8001. На планшете впишите адрес ноутбука в локальной сети
            (например, <code>http://192.168.1.50:8000</code>), а не <code>127.0.0.1</code>: он указывает на сам планшет.
          </p>
        </section>

        <section className="settings-section">
          <h3>Связь</h3>
          {report ? (
            <div className="probe-report">
              {[report.vision, report.cad].map((service) => (
                <article key={service.id} className={`probe-card ${service.ok ? 'is-ok' : 'is-down'}`}>
                  <div className="probe-head">
                    <span className="probe-dot" aria-hidden="true" />
                    <strong>{service.title}</strong>
                    <span className="probe-latency">{service.ok ? `${service.latencyMs} мс` : 'нет связи'}</span>
                  </div>
                  <code className="probe-url">{service.url}</code>
                  {service.ok ? (
                    <ul className="probe-lines">
                      {service.lines.map((line) => (
                        <li key={line.label}>
                          <span>{line.label}</span>
                          <b>{line.value}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-danger small">{service.error}</p>
                  )}
                </article>
              ))}
              <p className={report.ok ? 'text-success small' : 'text-danger small'}>
                {report.ok ? `Оба сервиса на связи · проверено ${report.checkedAt}` : `Часть сервисов недоступна · проверено ${report.checkedAt}`}
              </p>
            </div>
          ) : (
            <p className="muted small">
              Нажмите «Проверить связь»: приложение запросит <code>/health</code> и <code>/v1/cad/health</code> и покажет
              версию OpenCV, движок OCR и доступность STEP.
            </p>
          )}
        </section>

        <section className="settings-section">
          <h3>Устройство</h3>
          <ul className="settings-facts">
            <li>
              <span>Оболочка</span>
              <b>{runtimeLabel(state.runtime)}</b>
            </li>
            <li>
              <span>Офлайн-хранилище</span>
              <b>{backendLabel(backend)}</b>
            </li>
            <li>
              <span>Инструкций офлайн</span>
              <b>{state.offline.length}</b>
            </li>
          </ul>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={draft.strictWorkshop}
              onChange={(event) => update({ strictWorkshop: event.target.checked })}
            />
            <span>
              <b>Строгий режим цеха</b>
              <small>Скрыть редактор инженера на планшете: остаётся только рабочий экран.</small>
            </span>
          </label>
          {lockedByStrictMode ? (
            <p className="muted small">
              Редактор скрыт на этом устройстве. Чтобы вернуть его, выключите строгий режим здесь же или очистите настройки
              приложения.
            </p>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}

function backendLabel(backend: ReturnType<typeof storeBackendName>): string {
  switch (backend) {
    case 'indexeddb':
      return 'IndexedDB';
    case 'localstorage':
      return 'localStorage (резерв)';
    default:
      return 'память сессии';
  }
}
