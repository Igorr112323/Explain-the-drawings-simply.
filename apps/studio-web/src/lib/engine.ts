/**
 * Здоровье локального движка: два Python-сервиса отвечают на `/health`.
 *
 * В браузере запросы идут относительными путями (их проксирует Vite), в `.exe` — на 127.0.0.1.
 * Меню «•••» показывает эти статусы, чтобы «ничего не происходит» никогда не было загадкой: сразу
 * видно, жив ли движок, и что делать, если нет.
 */
import { getCadBaseUrl, getVisionBaseUrl, joinUrl } from './runtimeConfig';

export type EngineState = 'ok' | 'down' | 'unknown';

export interface EngineReport {
  vision: EngineState;
  cad: EngineState;
  visionUrl: string;
  cadUrl: string;
}

/**
 * Путь проверки. В браузере оба сервиса доступны через один прокси, и корневой `/health` уводит к
 * распознаванию — поэтому 3D спрашиваем по его собственному префиксу `/v1/cad/health`.
 */
export function healthPath(base: string, service: 'vision' | 'cad' = 'vision'): string {
  if (service === 'vision' || base.length > 0) {
    return '/health';
  }
  return '/v1/cad/health';
}

/** Один пинг `/health` с таймаутом: `ok` — ответил 2xx, `down` — не ответил вовсе. */
export async function pingHealth(base: string, timeoutMs = 2500, path = '/health'): Promise<EngineState> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(joinUrl(base, path), {
      signal: controller?.signal,
      headers: { accept: 'application/json' },
    });
    return response.ok ? 'ok' : 'down';
  } catch {
    return 'down';
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }
}

/** Проверяет оба сервиса параллельно; подпись адресов нужна для меню. */
export async function checkEngines(timeoutMs = 2500): Promise<EngineReport> {
  const visionBase = getVisionBaseUrl();
  const cadBase = getCadBaseUrl();
  const [vision, cad] = await Promise.all([
    pingHealth(visionBase, timeoutMs, healthPath(visionBase, 'vision')),
    pingHealth(cadBase, timeoutMs, healthPath(cadBase, 'cad')),
  ]);
  return { vision, cad, visionUrl: visionBase, cadUrl: cadBase };
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
