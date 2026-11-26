/**
 * «Мгновенный цеховой QR-мост»: an instruction is published to the workshop laptop once, gets a
 * short code, and any phone in the shop opens it by scanning one QR.
 *
 * Why this exists next to `qrBridge`:
 *   • `qrBridge` compresses the *whole* instruction into ~2.5 KB — perfect offline, but a 3D assembly
 *     simply never fits and rungs of the payload ladder have to be dropped;
 *   • here the instruction stays on the workshop server (full 3D, diagrams, translations), and the
 *     QR only says «where to look»: `http://192.168.1.50:8000/?guideId=<code>&api=http://192.168.1.50:8000`.
 *
 * The link carries the API address on purpose: the phone may be served the studio by the very same
 * workshop server, and then `api` is redundant — but a phone that opened the studio from a dev server
 * (or from a `.html` file) still knows which server to ask for the instruction.
 *
 * Everything here is a pure-ish function with an injectable `fetch`, so the workshop behaviour is
 * testable without a network.
 */
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';
import { detectRuntime, getVisionBaseUrl, joinUrl, loadSettings, sanitizeBaseUrl } from './runtimeConfig';

/** Path of the publication endpoint on the vision/workshop service. */
export const GUIDES_PATH = '/v1/guides';
export const NETWORK_INFO_PATH = '/v1/network-info';

/** Publishing a multi-megabyte 3D instruction over Wi-Fi takes a moment. */
export const PUBLISH_TIMEOUT_MS = 60_000;
export const LOAD_TIMEOUT_MS = 20_000;
export const LIST_TIMEOUT_MS = 8_000;

export type GuidePublishErrorKind = 'offline' | 'rejected' | 'too-large' | 'invalid' | 'not-found';

export class GuidePublishError extends Error {
  readonly kind: GuidePublishErrorKind;

  constructor(kind: GuidePublishErrorKind, message: string) {
    super(message);
    this.name = 'GuidePublishError';
    this.kind = kind;
  }
}

/** One row of `GET /v1/guides` — deliberately without the instruction body. */
export interface PublishedGuideSummary {
  id: string;
  title: string;
  drawingCode: string;
  revision: string | number;
  createdAt: string;
  sizeBytes: number;
  steps: number;
  has3d: boolean;
  url: string;
}

export interface PublishGuideResult extends PublishedGuideSummary {
  /** The same code as `id`, named the way the publish dialog speaks about it. */
  guideId: string;
  /** Absolute URL the server says it can be reached at (may be empty when it cannot guess). */
  absoluteUrl: string;
  /** The identical document was already on the server: no new file, same code. */
  deduplicated: boolean;
}

export interface WorkshopAddress {
  ip: string;
  kind: string;
  primary: boolean;
}

export interface WorkshopNetworkInfo {
  status: string;
  hostname: string;
  primary: string;
  /** The primary address is a real LAN address (not loopback / link-local). */
  primaryIsLan: boolean;
  addresses: WorkshopAddress[];
  guidePort: number;
  /** `http://192.168.1.50:8000` — what a phone should be told. */
  suggestedApiBase: string;
  studioAvailable: boolean;
}

export interface RequestOptions {
  /** Base of the workshop service; empty → relative URL (browser + dev proxy). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Address of the workshop service for the current shell: relative on the web, the saved address
 * inside the `.exe` / `.apk`.
 */
export function workshopApiBase(
  settings = loadSettings(),
  runtime = detectRuntime(),
): string {
  return getVisionBaseUrl(settings, runtime);
}

async function request(url: string, init: RequestInit, options: RequestOptions, offlineHint: string): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) {
    throw new GuidePublishError('offline', 'Сеть недоступна в этом окружении.');
  }
  const timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  const where = options.baseUrl ? ` по адресу ${options.baseUrl}` : '';
  try {
    return await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) });
  } catch {
    throw new GuidePublishError('offline', `${offlineHint}${where}.`);
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown; message?: unknown };
    for (const candidate of [payload.detail, payload.message]) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
      if (Array.isArray(candidate)) {
        const joined = candidate
          .map((item) => (typeof item === 'object' && item !== null && 'msg' in item ? String(item.msg) : ''))
          .filter((text) => text.length > 0)
          .join('; ');
        if (joined.length > 0) {
          return joined;
        }
      }
    }
  } catch {
    // Non-JSON body: the generic message below is enough.
  }
  return '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normaliseSummary(raw: Record<string, unknown>): PublishedGuideSummary {
  const id = text(raw.id) || text(raw.guideId);
  return {
    id,
    title: text(raw.title) || 'Без названия',
    drawingCode: text(raw.drawingCode),
    revision: typeof raw.revision === 'number' || typeof raw.revision === 'string' ? raw.revision : '',
    createdAt: text(raw.createdAt),
    sizeBytes: numberOf(raw.sizeBytes),
    steps: numberOf(raw.steps),
    has3d: raw.has3d === true,
    url: text(raw.url) || `${GUIDES_PATH}/${encodeURIComponent(id)}`,
  };
}

/**
 * Publishes the instruction on the workshop server. Idempotent by content: publishing the same
 * document twice returns the same code (`deduplicated: true`) instead of piling up copies.
 */
export async function publishGuide(doc: IkGuideDocument, options: RequestOptions = {}): Promise<PublishGuideResult> {
  const baseUrl = options.baseUrl ?? workshopApiBase();
  const body = JSON.stringify(doc);
  const response = await request(
    joinUrl(baseUrl, GUIDES_PATH),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    },
    { ...options, baseUrl, timeoutMs: options.timeoutMs ?? PUBLISH_TIMEOUT_MS },
    'Цеховой сервер не отвечает',
  );

  if (response.status === 413) {
    throw new GuidePublishError(
      'too-large',
      'Инструкция больше 64 МБ — сервер не примет такой файл. Уберите 3D-модель или передайте пакет .ikguide.json по сети.',
    );
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new GuidePublishError(
      response.status >= 500 ? 'offline' : 'rejected',
      detail || `Сервер отклонил публикацию (код ${response.status}).`,
    );
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    throw new GuidePublishError('invalid', 'Сервер принял инструкцию, но ответ не удалось прочитать.');
  }
  const summary = normaliseSummary(payload);
  if (!summary.id) {
    throw new GuidePublishError('invalid', 'Сервер не вернул код инструкции.');
  }
  return {
    ...summary,
    guideId: text(payload.guideId) || summary.id,
    absoluteUrl: text(payload.absoluteUrl),
    deduplicated: payload.deduplicated === true,
  };
}

/** Downloads a published instruction and validates it with the shared schema. */
export async function fetchPublishedGuide(guideId: string, options: RequestOptions = {}): Promise<IkGuideDocument> {
  const baseUrl = options.baseUrl ?? workshopApiBase();
  const code = guideId.trim();
  if (!code) {
    throw new GuidePublishError('invalid', 'В ссылке нет кода инструкции.');
  }
  const response = await request(
    joinUrl(baseUrl, `${GUIDES_PATH}/${encodeURIComponent(code)}`),
    { method: 'GET', headers: { accept: 'application/json' } },
    { ...options, baseUrl },
    'Цеховой сервер не отвечает',
  );
  if (response.status === 404) {
    throw new GuidePublishError('not-found', `На цеховом сервере нет инструкции с кодом «${code}».`);
  }
  if (!response.ok) {
    const detail = await errorDetail(response);
    throw new GuidePublishError(
      response.status >= 500 ? 'offline' : 'rejected',
      detail || `Сервер не отдал инструкцию (код ${response.status}).`,
    );
  }
  const raw = (await response.json().catch(() => null)) as unknown;
  const validation = ikGuideDocumentSchema.safeParse(raw);
  if (!validation.success) {
    const first = validation.error.issues[0];
    throw new GuidePublishError(
      'invalid',
      `Инструкция с сервера не прошла проверку схемы${first ? `: ${first.message}` : '.'}`,
    );
  }
  return validation.data;
}

/** Newest publications first; the dashboard shows a short list, not the whole shop archive. */
export async function fetchPublishedGuides(
  options: RequestOptions & { limit?: number } = {},
): Promise<PublishedGuideSummary[]> {
  const baseUrl = options.baseUrl ?? workshopApiBase();
  const limit = Math.max(1, Math.min(options.limit ?? 8, 50));
  const response = await request(
    joinUrl(baseUrl, `${GUIDES_PATH}?limit=${limit}`),
    { method: 'GET', headers: { accept: 'application/json' } },
    { ...options, baseUrl, timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS },
    'Список публикаций недоступен: цеховой сервер не отвечает',
  );
  if (!response.ok) {
    throw new GuidePublishError('rejected', `Сервер не отдал список публикаций (код ${response.status}).`);
  }
  const payload = (await response.json().catch(() => null)) as { guides?: unknown } | null;
  const guides = Array.isArray(payload?.guides) ? payload.guides : [];
  return guides
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(normaliseSummary)
    .filter((item) => item.id.length > 0);
}

/**
 * The workshop laptop's own idea of its LAN address. Needed because a browser that opened the studio
 * on `localhost` has no way to know the IP a phone must use.
 */
export async function fetchWorkshopNetworkInfo(options: RequestOptions = {}): Promise<WorkshopNetworkInfo | null> {
  try {
    const baseUrl = options.baseUrl ?? workshopApiBase();
    const response = await request(
      joinUrl(baseUrl, NETWORK_INFO_PATH),
      { method: 'GET', headers: { accept: 'application/json' } },
      { ...options, baseUrl, timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS },
      'Сетевые адреса недоступны',
    );
    if (!response.ok) {
      return null;
    }
    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) {
      return null;
    }
    const addresses = Array.isArray(raw.addresses)
      ? raw.addresses
          .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
          .map((item) => ({
            ip: text(item.ip),
            kind: text(item.kind),
            primary: item.primary === true,
          }))
          .filter((item) => item.ip.length > 0)
      : [];
    return {
      status: text(raw.status) || 'ok',
      hostname: text(raw.hostname),
      primary: text(raw.primary),
      primaryIsLan: raw.primaryIsLan === true,
      addresses,
      guidePort: numberOf(raw.guidePort) || 8000,
      suggestedApiBase: sanitizeBaseUrl(text(raw.suggestedApiBase)),
      studioAvailable: raw.studioAvailable === true,
    };
  } catch {
    return null;
  }
}

/** The address a phone in the shop should use, best first: LAN, then whatever the server suggests. */
export function pickLanApiBase(info: WorkshopNetworkInfo | null): string | null {
  if (!info) {
    return null;
  }
  const port = info.guidePort > 0 ? info.guidePort : 8000;
  const lan = info.addresses.find((address) => address.primary && address.kind === 'lan') ??
    info.addresses.find((address) => address.kind === 'lan');
  const ip = lan?.ip || (info.primaryIsLan ? info.primary : '');
  if (ip) {
    return `http://${ip}:${port}`;
  }
  return info.suggestedApiBase || null;
}

/**
 * `http://192.168.1.50:8000/?guideId=pay88sbx&api=http%3A%2F%2F192.168.1.50%3A8000`
 *
 * Short enough for the smallest QR code and for reading aloud over the phone.
 */
export function buildPublishedLink(apiBase: string, guideId: string): string {
  const base = sanitizeBaseUrl(apiBase);
  const code = guideId.trim();
  if (!base) {
    return `ikguide://guide/${encodeURIComponent(code)}`;
  }
  return `${base}/?guideId=${encodeURIComponent(code)}&api=${encodeURIComponent(base)}`;
}

export interface PublishedLink {
  guideId: string;
  /** Absolute API address carried by the link, or `null` when it only names the code. */
  api: string | null;
}

/** Accepts both a location-like object and raw scanner text (link, `?guideId=…`, `ikguide://…`). */
export function readPublishedLink(
  input: { search?: string; hash?: string } | string | null = typeof globalThis.location === 'undefined' ? null : globalThis.location,
): PublishedLink | null {
  if (!input) {
    return null;
  }
  if (typeof input === 'string') {
    return parseLinkText(input);
  }
  const fromSearch = fromQuery(new URLSearchParams(input.search ?? ''));
  if (fromSearch) {
    return fromSearch;
  }
  const hash = input.hash ?? '';
  const questionMark = hash.indexOf('?');
  if (questionMark >= 0) {
    const fromHash = fromQuery(new URLSearchParams(hash.slice(questionMark + 1)));
    if (fromHash) {
      return fromHash;
    }
  }
  return null;
}

function fromQuery(params: URLSearchParams): PublishedLink | null {
  const code = params.get('guideId') ?? params.get('guide');
  if (!code || !/^[\w.:-]{1,64}$/.test(code.trim())) {
    return null;
  }
  return { guideId: code.trim(), api: sanitizeBaseUrl(params.get('api')) || null };
}

function parseLinkText(value: string): PublishedLink | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const deep = /^ikguide:\/\/guide\/([\w.:-]{1,64})$/.exec(raw);
  if (deep) {
    return { guideId: deep[1]!, api: null };
  }
  try {
    const parsed = new URL(raw, 'https://ikguide.local/');
    const fromUrl = fromQuery(parsed.searchParams);
    if (fromUrl) {
      return fromUrl;
    }
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    if ((parsed.pathname.endsWith('/guide') || parsed.pathname.includes('/guide/')) && lastSegment) {
      return { guideId: lastSegment, api: null };
    }
  } catch {
    // Not a URL — fall through to the bare code check.
  }
  if (/^[\w.:-]{4,64}$/.test(raw) && !raw.includes(' ')) {
    return { guideId: raw, api: null };
  }
  return null;
}

/** Human-readable size for the publish panel: «2,4 МБ». */
export function formatGuideSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} Б`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
