import { useStudio } from '../state/studio';

export function TopBar() {
  const { state, dispatch, doc } = useStudio();

  return (
    <header className="top-bar">
      <div className="capsule brand-capsule">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <path d="M4 18L11 6M13 18L20 6" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <span className="brand-text">
          <strong>IkGuide</strong>
          <small>ГОСТ → цех</small>
        </span>
      </div>

      <nav className="capsule mode-switch" aria-label="Режим интерфейса">
        <button
          type="button"
          className={state.mode === 'worker' ? 'mode-button is-active' : 'mode-button'}
          aria-pressed={state.mode === 'worker'}
          onClick={() => dispatch({ type: 'SET_MODE', mode: 'worker' })}
        >
          Рабочий
          <span className="mode-hint">.apk</span>
        </button>
        <button
          type="button"
          className={state.mode === 'engineer' ? 'mode-button is-active' : 'mode-button'}
          aria-pressed={state.mode === 'engineer'}
          onClick={() => dispatch({ type: 'SET_MODE', mode: 'engineer' })}
        >
          Инженер
          <span className="mode-hint">.exe</span>
        </button>
      </nav>

      <div className="top-actions">
        <button
          type="button"
          className="capsule scan-capsule"
          onClick={() => dispatch({ type: 'OPEN_SCAN', mode: 'files' })}
          title="Сфотографировать или загрузить чертёж и получить черновик инструкции"
        >
          <span aria-hidden="true">📷</span> Чертёж → инструкция
        </button>
        <label className="capsule doc-capsule">
          <span className="visually-hidden">Выбор инструкции</span>
          <select
            value={doc.id}
            onChange={(event) => dispatch({ type: 'SELECT_DOC', docId: event.target.value })}
            aria-label="Выбор инструкции"
          >
            {state.docs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.metadata.drawingCode} — {item.metadata.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="capsule theme-toggle"
          aria-label={state.theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему цеха'}
          title={state.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема цеха'}
          onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}
        >
          {state.theme === 'dark' ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
