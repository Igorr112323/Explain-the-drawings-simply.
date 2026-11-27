/**
 * Где живёт локальный движок распознавания и в какой оболочке мы работаем.
 *
 * Браузер (`npm run dev`, preview, статический хостинг): запросы идут относительными путями
 * `/v1/...`, их перехватывает прокси Vite. Ничего настраивать не нужно.
 *
 * Windows `.exe` (Tauri): относительный `/v1/...` упёрся бы в сам бандл, поэтому адрес берётся из
 * локального движка по умолчанию — 127.0.0.1:8000.
 */
export type Runtime = 'web' | 'tauri-desktop';

export const NATIVE_VISION_URL = 'http://127.0.0.1:8000';

interface RuntimeScope {
  window?: unknown;
}

/** Определяет оболочку. Чистая функция — проверяется без браузера. */
export function detectRuntime(scope: RuntimeScope = globalThis as RuntimeScope): Runtime {
  const win = scope.window as Record<string, unknown> | undefined;
  if (!win) {
    return 'web';
  }
  return win.__TAURI_INTERNALS__ ?? win.__TAURI__ ? 'tauri-desktop' : 'web';
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

/** Пропускает только абсолютный `http(s)`-адрес без хвостового слэша; всё остальное → `''`. */
export function sanitizeBaseUrl(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw || !isAbsoluteUrl(raw)) {
    return '';
  }
  return raw.replace(/\/+$/, '');
}

/** `joinUrl('http://192.168.1.50:8000', '/v1/recognize')`; пустой базовый адрес даёт относительный путь. */
export function joinUrl(base: string, path: string): string {
  const cleanBase = base.trim().replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return cleanBase ? `${cleanBase}${cleanPath}` : cleanPath;
}

/** Ключи, под которыми меню «•••» запоминает адреса движка на этом компьютере. */
export const VISION_URL_KEY = 'ikguide:vision-url';

function readStored(key: string): string {
  try {
    return globalThis.localStorage?.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Сохраняет адрес движка; пустая строка возвращает значения по умолчанию. */
export function storeBaseUrl(key: string, value: string | null): void {
  try {
    const clean = sanitizeBaseUrl(value);
    if (clean) {
      globalThis.localStorage?.setItem(key, clean);
    } else {
      globalThis.localStorage?.removeItem(key);
    }
  } catch {
    // Приватный режим: настройка проживёт до перезапуска.
  }
}

/** Что сейчас выбрано в настройках подключения (для полей меню). */
export function storedBaseUrl(key: string): string {
  return sanitizeBaseUrl(readStored(key));
}

/**
 * Адрес сервиса распознавания: явный аргумент → настройка меню → относительный путь в браузере
 * или локальный порт в упакованном `.exe`.
 */
export function getVisionBaseUrl(runtime: Runtime = detectRuntime(), override?: string): string {
  return sanitizeBaseUrl(override) || storedBaseUrl(VISION_URL_KEY) || (runtime === 'web' ? '' : NATIVE_VISION_URL);
}

/** Готовая подсказка для экрана ошибки: что именно запустить, чтобы всё заработало. */
export function backendHint(): string {
  return 'Запустите локальный движок распознавания: npm run dev:vision — или откройте пример, он работает без движка.';
}
