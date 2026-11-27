/**
 * Светлая и тёмная тема цеха.
 *
 * Тема — это один атрибут на `<html>`: весь холст собран на CSS-переменных, поэтому переключение
 * мгновенное и ничего не перерисовывает через React. Выбор запоминается в localStorage.
 */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'ikguide:theme';

interface ThemeScope {
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  matchMedia?: (query: string) => { matches: boolean };
}

/** Сохранённая тема, иначе — системная, иначе светлая. */
export function initialTheme(scope: ThemeScope = globalThis as ThemeScope): Theme {
  try {
    const saved = scope.localStorage?.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Приватный режим: тема просто не запомнится.
  }
  return scope.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Ставит тему на документ и запоминает выбор. */
export function applyTheme(theme: Theme, scope: ThemeScope = globalThis as ThemeScope): void {
  const root = (globalThis as { document?: Document }).document?.documentElement;
  if (root) {
    root.dataset.theme = theme;
  }
  try {
    scope.localStorage?.setItem(THEME_KEY, theme);
  } catch {
    // Ничего страшного: тема проживёт до перезапуска.
  }
}
