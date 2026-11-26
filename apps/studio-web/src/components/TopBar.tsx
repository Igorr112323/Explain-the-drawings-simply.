import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ikguide:theme';

function initialTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const saved = window.localStorage?.getItem(STORAGE_KEY);
  if (saved === 'dark' || saved === 'light') {
    return saved;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Лёгкая шапка: бренд, честная подпись «локально» и переключатель темы. */
export function TopBar({ onHome, inReview }: { onHome: () => void; inReview: boolean }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage?.setItem(STORAGE_KEY, theme);
    } catch {
      // Приватный режим: тема просто не запомнится.
    }
  }, [theme]);

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={onHome} aria-label="На главный экран">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <rect x="2" y="2" width="20" height="20" rx="6" fill="#007AFF" />
            <path d="M9 7h2.2v10H9zM12.6 7h2.2v6h-2.2z" fill="#fff" />
          </svg>
        </span>
        <span className="brand-text">
          <span className="brand-name">IkGuide</span>
          <span className="brand-tag">чертёж → инструкция</span>
        </span>
      </button>
      <div className="topbar-actions">
        {inReview && <span className="topbar-pill">PDF собирается на этом устройстве</span>}
        <button
          type="button"
          className="icon-button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
