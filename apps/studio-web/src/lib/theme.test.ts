// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, initialTheme, THEME_KEY } from './theme';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const storage = (value: string | null) => ({
  localStorage: { getItem: () => value, setItem: () => {} },
});

describe('тема цеха', () => {
  it('берёт сохранённый выбор', () => {
    expect(initialTheme(storage('dark'))).toBe('dark');
    expect(initialTheme(storage('light'))).toBe('light');
  });

  it('без сохранения слушает системную тему, иначе светлая', () => {
    expect(initialTheme({ localStorage: undefined, matchMedia: () => ({ matches: true }) })).toBe('dark');
    expect(initialTheme({ localStorage: undefined, matchMedia: () => ({ matches: false }) })).toBe('light');
    expect(initialTheme({})).toBe('light');
  });

  it('ставит атрибут на <html> и запоминает выбор', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');

    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('битое хранилище не ломает запуск', () => {
    const broken = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
    };
    expect(initialTheme({ localStorage: broken as never })).toBe('light');
    expect(() => applyTheme('dark', { localStorage: broken as never })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
