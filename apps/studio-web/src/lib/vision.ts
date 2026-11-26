import type {
  VisionCandidate,
  VisionPage,
  VisionRecognizeResponse,
  VisionTitleBlock,
} from '@ikguide/builder';

export type { VisionCandidate, VisionPage, VisionRecognizeResponse, VisionTitleBlock };

/**
 * Client of the local Python vision service. Requests are strictly relative (`/v1/...`), because the
 * dev server, the preview server and a packaged Tauri shell all proxy them to the real service.
 */
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

export interface VisionSession {
  requestId: string | null;
  pageId: string | null;
  pages: VisionPage[];
  titleBlock: VisionTitleBlock | null;
  candidates: VisionCandidate[];
  manualNotations: string[];
  warnings: string[];
  /** Id of the auto-built draft, so a rebuild replaces it instead of piling up copies. */
  draftDocId: string | null;
}

export interface RegionResult {
  pageId: string;
  candidates: VisionCandidate[];
  warnings: string[];
}

export interface RegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

const HEALTH_TIMEOUT_MS = 4000;
const RECOGNIZE_TIMEOUT_MS = 120_000;

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VisionError('offline', 'Сервис распознавания не ответил вовремя.');
    }
    throw new VisionError('offline', 'Сервис распознавания недоступен.');
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
    // Non-JSON error body: fall through to the generic message.
  }
  return `Сервис вернул ошибку ${response.status}.`;
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

export async function recognizeSheets(files: readonly File[]): Promise<VisionRecognizeResponse> {
  if (files.length === 0) {
    throw new VisionError('rejected', 'Не выбран ни один файл чертежа.');
  }

  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name.length > 0 ? file.name : 'sheet.png'));

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

export async function recognizeRegion(pageId: string, rect: RegionRect): Promise<RegionResult> {
  const response = await request(
    '/v1/recognize/roi',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        rotation: rect.rotation ?? 0,
      }),
    },
    RECOGNIZE_TIMEOUT_MS,
  );

  if (!response.ok) {
    const detail = await readDetail(response);
    throw new VisionError(
      response.status === 404 ? 'rejected' : response.status >= 500 ? 'server' : 'rejected',
      detail,
    );
  }

  const payload = (await response.json()) as RegionResult;
  return { pageId: payload.pageId, candidates: payload.candidates ?? [], warnings: payload.warnings ?? [] };
}

export function newVisionSession(response: VisionRecognizeResponse): VisionSession {
  const firstPage = response.pages?.[0] ?? null;
  return {
    requestId: response.requestId ?? null,
    pageId: firstPage?.pageId ?? null,
    pages: response.pages ?? [],
    titleBlock: response.titleBlock ?? null,
    candidates: response.candidates,
    manualNotations: [],
    warnings: response.warnings ?? [],
    draftDocId: null,
  };
}

/** A session without a scanned sheet: the engineer starts from hand-typed ciphers. */
export function emptyVisionSession(): VisionSession {
  return {
    requestId: null,
    pageId: null,
    pages: [],
    titleBlock: null,
    candidates: [],
    manualNotations: [],
    warnings: [],
    draftDocId: null,
  };
}

export function mergeCandidate(existing: readonly VisionCandidate[], incoming: VisionCandidate): VisionCandidate[] {
  const already = existing.some(
    (candidate) =>
      candidate.pageIndex === incoming.pageIndex &&
      candidate.normalizedText === incoming.normalizedText &&
      Math.abs(candidate.xPercent - incoming.xPercent) < 0.6 &&
      Math.abs(candidate.yPercent - incoming.yPercent) < 0.6,
  );
  return already ? [...existing] : [...existing, incoming];
}
