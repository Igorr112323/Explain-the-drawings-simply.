/**
 * Здоровье локального движка распознавания: отвечает ли он на `/health`.
 *
 * В браузере запрос идёт относительным путём (его проксирует Vite), в `.exe` — на 127.0.0.1:8000.
 * Меню «•••» показывает этот статус, чтобы «ничего не происходит» никогда не было загадкой: сразу
 * видно, жив ли движок, и что делать, если нет.
 */
import { getVisionBaseUrl, joinUrl } from './runtimeConfig';

export type EngineState = 'ok' | 'down' | 'unknown';

export interface EngineReport {
  vision: EngineState;
  visionUrl: string;
}

/**
 * Один пинг `/health` с таймаутом: `ok` — ответил 2xx и представился нашим сервисом,
 * `down` — не ответил вовсе.
 *
 * Мало кода 200: на 127.0.0.1:8000 у инженера может висеть чужой сервис (Jupyter, отладочный
 * сервер), и тогда меню бодро сообщало «на связи», а распознавание не работало.
 */
export async function pingHealth(base: string, timeoutMs = 2500, path = '/health'): Promise<EngineState> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(joinUrl(base, path), {
      signal: controller?.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      return 'down';
    }
    if (path !== '/health') {
      return 'ok';
    }
    try {
      const payload = (await response.json()) as { service?: string };
      return payload.service === 'ikguide-vision-api' ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  } catch {
    return 'down';
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }
}

/** Проверяет движок; подпись адреса нужна для меню. */
export async function checkEngines(timeoutMs = 2500): Promise<EngineReport> {
  const visionUrl = getVisionBaseUrl();
  return { vision: await pingHealth(visionUrl, timeoutMs), visionUrl };
}

/** Читаемая подпись статуса для меню. */
export function engineLabel(state: EngineState): string {
  if (state === 'ok') {
    return 'на связи';
  }
  return state === 'down' ? 'не отвечает' : 'не проверяли';
}

/** Где показывать движок: относительные адреса браузера выглядят пусто — показываем прокси. */
export function displayEngineUrl(base: string): string {
  return base || 'через локальный прокси';
}
