/**
 * Клиент локального сервиса распознавания чертежей.
 *
 * В браузере путь остаётся относительным (`/v1/recognize`) — его проксирует Vite; в упакованном `.exe`
 * адрес берётся из `runtimeConfig` (127.0.0.1:8000). Наружу не уходит ни один байт.
 */
import type { VisionRecognizeResponse } from '@ikguide/builder';
import { joinUrl, getVisionBaseUrl } from './runtimeConfig';

export type { VisionCandidate, VisionPage, VisionRecognizeResponse, VisionTitleBlock } from '@ikguide/builder';

export type VisionErrorKind = 'offline' | 'rejected' | 'server';

export class VisionError extends Error {
  readonly kind: VisionErrorKind;

  constructor(kind: VisionErrorKind, message: string) {
    super(message);
    this.name = 'VisionError';
    this.kind = kind;
  }
}

export interface VisionHealth {
  status: string;
  service: string;
  version: string;
  opencv: string;
  ocr: string;
  ocrAvailable: boolean;
  maxPages: number;
  confidenceThreshold: number;
}

const HEALTH_TIMEOUT_MS = 4000;
const RECOGNIZE_TIMEOUT_MS = 120_000;

export function visionBaseUrl(): string {
  return getVisionBaseUrl();
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const base = visionBaseUrl();
  const target = joinUrl(base, url);
  try {
    return await fetch(target, { ...init, signal: controller.signal });
  } catch {
    throw new VisionError(
      'offline',
      'Сервис распознавания не отвечает. Запустите npm run dev:all и перетащите файл ещё раз.',
    );
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === 'string') {
      return payload.detail;
    }
    if (Array.isArray(payload.detail)) {
      const joined = payload.detail
        .map((item) => (typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : ''))
        .filter((text) => text.length > 0)
        .join('; ');
      if (joined.length > 0) {
        return joined;
      }
    }
  } catch {
    // Не-JSON ответ: ниже будет общее сообщение.
  }
  return `Сервис распознавания вернул ошибку ${response.status}.`;
}

export async function fetchVisionHealth(): Promise<VisionHealth | null> {
  try {
    const response = await request('/health', { method: 'GET' }, HEALTH_TIMEOUT_MS);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as VisionHealth;
  } catch {
    return null;
  }
}

/** Отправляет лист чертежа в `/v1/recognize` и возвращает штамп + обозначения с координатами. */
export async function recognizeSheets(files: readonly File[]): Promise<VisionRecognizeResponse> {
  const drawings = files.filter((file) => file.size > 0);
  if (drawings.length === 0) {
    throw new VisionError('rejected', 'Не выбрано ни одного файла чертежа.');
  }

  const form = new FormData();
  drawings.forEach((file) => form.append('files', file, file.name.length > 0 ? file.name : 'sheet.png'));

  const response = await request('/v1/recognize', { method: 'POST', body: form }, RECOGNIZE_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await readDetail(response);
    throw new VisionError(response.status === 413 || response.status === 422 ? 'rejected' : 'server', detail);
  }

  const payload = (await response.json()) as VisionRecognizeResponse;
  if (!Array.isArray(payload.candidates)) {
    throw new VisionError('server', 'Сервис вернул ответ неизвестного формата.');
  }
  return payload;
}
