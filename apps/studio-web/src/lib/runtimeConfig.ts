/**
 * One place that knows *where the studio runs* and *where the two Python services live*.
 *
 * Browser (dev server, preview, GitHub Pages, a plain `.html` file on a phone):
 *   the app talks to relative `/v1/...`, Vite proxies them. Nothing to configure.
 *
 * Tauri `.exe` / Capacitor `.apk`:
 *   the bundle is loaded from `file://`/`http://localhost`, so relative `/v1/...` would hit the app
 *   itself. The engineer points the app at the workshop PC (127.0.0.1 on the same machine for the
 *   `.exe`, a LAN address like `http://192.168.1.50:8000` for the tablet) — and the address is
 *   remembered in `localStorage`.
 *
 * The defaults also define the *starting mode*: the tablet opens as «Рабочий», the desktop editor as
 * «Инженер».
 */
import type { StudioMode } from '../state/studio';

export type Runtime = 'web' | 'tauri-desktop' | 'capacitor-android';

export interface ConnectionSettings {
  /** Vision API (drawing recognition): coordinates, stamps, OCR. */
  visionBaseUrl: string;
  /** CAD API (3D import + IKEA rendering). */
  cadBaseUrl: string;
  /** Strict workshop mode hides the engineer editor from the tablet. */
  strictWorkshop: boolean;
}

export const SETTINGS_STORAGE_KEY = 'ikguide.connection.v1';

export const DEFAULT_SETTINGS: ConnectionSettings = {
  visionBaseUrl: '',
  cadBaseUrl: '',
  strictWorkshop: false,
};

/** Absolute defaults used by the native shells (empty string = «relative URL, browser mode»). */
export const NATIVE_DEFAULT_VISION = 'http://127.0.0.1:8000';
export const NATIVE_DEFAULT_CAD = 'http://127.0.0.1:8001';

interface RuntimeScope {
  window?: unknown;
  location?: { protocol?: string; hostname?: string; search?: string; hash?: string } | null;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/** Detects the shell the studio is currently running in. Pure function → trivially testable. */
export function detectRuntime(scope: RuntimeScope = globalThis as RuntimeScope): Runtime {
  const win = scope.window as Record<string, unknown> | undefined;
  if (!win) {
    return 'web';
  }
  const tauri = (win.__TAURI_INTERNALS__ ?? win.__TAURI__) as unknown;
  if (tauri) {
    return 'tauri-desktop';
  }
  const capacitor = win.Capacitor as CapacitorGlobal | undefined;
  if (capacitor) {
    const native = typeof capacitor.isNativePlatform === 'function' ? capacitor.isNativePlatform() : true;
    const platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : '';
    if (native && (platform === 'android' || platform === 'ios' || platform === '')) {
      return 'capacitor-android';
    }
  }
  return 'web';
}

/** The tablet opens straight into the workshop mode; the desktop editor into the canvas. */
export function defaultModeForRuntime(runtime: Runtime): StudioMode {
  if (runtime === 'tauri-desktop') {
    return 'engineer';
  }
  // Both the browser and the shop-floor tablet start on the worker screen: the first thing a
  // worker sees must be the big «Камера / Файл / QR» capsule, never an editor.
  return 'worker';
}

/** Engineer editor is hidden on the shop-floor tablet when strict mode is on. */
export function canSwitchToEngineer(runtime: Runtime, settings: ConnectionSettings): boolean {
  return !(settings.strictWorkshop && runtime === 'capacitor-android');
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

/** `joinUrl('http://192.168.1.50:8000', '/v1/recognize')` → absolute; `joinUrl('', '/v1/…')` → relative. */
export function joinUrl(base: string, path: string): string {
  const cleanBase = base.trim().replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!cleanBase) {
    return cleanPath;
  }
  return `${cleanBase}${cleanPath}`;
}

function readStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    // Private mode / disabled storage: settings simply do not survive a reload.
  }
}

export function sanitizeBaseUrl(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (!isAbsoluteUrl(raw)) {
    return '';
  }
  return raw.replace(/\/+$/, '');
}

export function loadSettings(storageKey: string = SETTINGS_STORAGE_KEY): ConnectionSettings {
  const raw = readStorage(storageKey);
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionSettings>;
    return {
      visionBaseUrl: sanitizeBaseUrl(parsed.visionBaseUrl),
      cadBaseUrl: sanitizeBaseUrl(parsed.cadBaseUrl),
      strictWorkshop: Boolean(parsed.strictWorkshop),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: ConnectionSettings, storageKey: string = SETTINGS_STORAGE_KEY): void {
  writeStorage(
    storageKey,
    JSON.stringify({
      visionBaseUrl: sanitizeBaseUrl(settings.visionBaseUrl),
      cadBaseUrl: sanitizeBaseUrl(settings.cadBaseUrl),
      strictWorkshop: Boolean(settings.strictWorkshop),
    }),
  );
}

/**
 * Base URL for the recognition service. In the browser it stays empty (relative + Vite proxy); in
 * native shells the saved address wins, otherwise the local default.
 */
export function getVisionBaseUrl(settings: ConnectionSettings = loadSettings(), runtime: Runtime = detectRuntime()): string {
  const saved = sanitizeBaseUrl(settings.visionBaseUrl);
  if (saved) {
    return saved;
  }
  return runtime === 'web' ? '' : NATIVE_DEFAULT_VISION;
}

export function getCadBaseUrl(settings: ConnectionSettings = loadSettings(), runtime: Runtime = detectRuntime()): string {
  const saved = sanitizeBaseUrl(settings.cadBaseUrl);
  if (saved) {
    return saved;
  }
  return runtime === 'web' ? '' : NATIVE_DEFAULT_CAD;
}

/**
 * Suggests the addresses a tablet in the workshop most likely needs:
 * the very same host that serves the app, with the two service ports.
 */
export function suggestLanAddresses(
  loc: { hostname?: string; protocol?: string } | null = currentLocation(),
): { vision: string; cad: string } {
  const hostname = loc?.hostname && loc.hostname !== 'localhost' ? loc.hostname : null;
  if (!hostname || /^127\.|^0\.0\.0\.0$/.test(hostname)) {
    return { vision: NATIVE_DEFAULT_VISION, cad: NATIVE_DEFAULT_CAD };
  }
  return { vision: `http://${hostname}:8000`, cad: `http://${hostname}:8001` };
}

/** Reads `?g=…` (or `#g=…`) — the shop-floor QR bridge opens instructions this way. */
export function readPayloadFromLocation(
  loc: { search?: string; hash?: string } | null = currentLocation(),
): string | null {
  if (!loc) {
    return null;
  }
  const fromSearch = new URLSearchParams(loc.search ?? '').get('g');
  if (fromSearch) {
    return fromSearch;
  }
  const hash = loc.hash ?? '';
  const questionMark = hash.indexOf('?');
  if (questionMark >= 0) {
    const fromHash = new URLSearchParams(hash.slice(questionMark + 1)).get('g');
    if (fromHash) {
      return fromHash;
    }
  }
  const hashMatch = /(?:^#|&)g=([^&]+)/.exec(hash);
  return hashMatch ? decodeURIComponent(hashMatch[1]!) : null;
}

/** `window.location` when available (never throws in Node/jsdom-like environments). */
export function currentLocation(): { hostname?: string; protocol?: string; search?: string; hash?: string } | null {
  try {
    if (typeof globalThis.location === 'undefined' || !globalThis.location) {
      return null;
    }
    const { hostname, protocol, search, hash } = globalThis.location;
    return { hostname, protocol, search, hash };
  } catch {
    return null;
  }
}

/** Human-readable name of the shell, shown in the settings dialog. */
export function runtimeLabel(runtime: Runtime): string {
  switch (runtime) {
    case 'tauri-desktop':
      return 'Windows .exe (Tauri)';
    case 'capacitor-android':
      return 'Android .apk (Capacitor)';
    default:
      return 'Браузер / dev-сервер';
  }
}

/* ------------------------------------------------------------------ «Проверить связь» */

export interface HealthLine {
  label: string;
  value: string;
}

export interface ServiceProbe {
  id: 'vision' | 'cad';
  title: string;
  /** The exact URL that was called — the engineer can retype it in a browser. */
  url: string;
  ok: boolean;
  latencyMs: number;
  lines: HealthLine[];
  error: string | null;
}

export interface ConnectionReport {
  vision: ServiceProbe;
  cad: ServiceProbe;
  /** Both services answered. */
  ok: boolean;
  /** «Проверено 26.11.2026, 14:03» */
  checkedAt: string;
}

const PROBE_TIMEOUT_MS = 5000;

function text(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

async function probe(
  id: ServiceProbe['id'],
  title: string,
  baseUrl: string,
  path: string,
  fetchImpl: typeof fetch | undefined,
  timeoutMs: number,
): Promise<ServiceProbe> {
  const url = joinUrl(baseUrl, path);
  const started = Date.now();
  const failure = (error: string): ServiceProbe => ({
    id,
    title,
    url,
    ok: false,
    latencyMs: Date.now() - started,
    lines: [],
    error,
  });

  if (!fetchImpl) {
    return failure('Проверка связи недоступна в этом окружении.');
  }

  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? globalThis.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      ...(controller ? { signal: controller.signal } : {}),
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { ...failure(`Сервис ответил ошибкой ${response.status}.`), latencyMs };
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const lines: HealthLine[] = [];
    if (id === 'vision') {
      lines.push({ label: 'OpenCV', value: text(payload.opencv) || 'неизвестно' });
      const ocr = text(payload.ocr);
      const available = payload.ocrAvailable === true;
      lines.push({ label: 'OCR', value: ocr && ocr !== 'none' ? `${ocr} · ${available ? 'готов' : 'выключен'}` : 'не найден' });
      if (text(payload.version)) {
        lines.push({ label: 'Версия', value: text(payload.version) });
      }
    } else {
      lines.push({ label: 'trimesh', value: text(payload.trimesh) || 'неизвестно' });
      const step = payload.stepEnabled === true;
      const engine = text(payload.stepEngine);
      lines.push({ label: 'STEP', value: step ? `доступен${engine ? ` · ${engine}` : ''}` : 'выключен (только STL/OBJ/GLB)' });
      if (Array.isArray(payload.formats)) {
        lines.push({ label: 'Форматы', value: payload.formats.map((item) => String(item)).join(', ') });
      }
    }
    return { id, title, url, ok: true, latencyMs, lines, error: null };
  } catch {
    return failure('Сервис не ответил. Проверьте адрес, порт и что сервер запущен.');
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }
}

/** Probes both services with the settings currently typed in the dialog (not the saved ones). */
export async function probeConnection(
  settings: ConnectionSettings,
  runtime: Runtime = detectRuntime(),
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date } = {},
): Promise<ConnectionReport> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const [vision, cad] = await Promise.all([
    probe('vision', 'Распознавание чертежей', getVisionBaseUrl(settings, runtime), '/health', fetchImpl, timeoutMs),
    probe('cad', '3D-модели и схемы', getCadBaseUrl(settings, runtime), '/v1/cad/health', fetchImpl, timeoutMs),
  ]);
  return {
    vision,
    cad,
    ok: vision.ok && cad.ok,
    checkedAt: (options.now?.() ?? new Date()).toLocaleString('ru-RU'),
  };
}

/**
 * Address of the workshop web app that a worker's phone should open.
 *
 * On the web the app knows its own URL. Inside the `.exe` there is no LAN address at all, so the
 * engineer types it (default: the same host that runs the vision service, on the studio port) — and
 * the QR simply says «откройте цеховой сервер».
 */
export function defaultWorkshopBaseUrl(
  settings: ConnectionSettings = loadSettings(),
  runtime: Runtime = detectRuntime(),
  loc: { origin?: string; pathname?: string; protocol?: string } | null = currentLocation(),
): string {
  if (loc?.protocol === 'http:' || loc?.protocol === 'https:') {
    const origin = (loc.origin ?? '').replace(/\/+$/, '');
    if (origin) {
      return origin;
    }
  }
  const host = sanitizeBaseUrl(getVisionBaseUrl(settings, runtime)).replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  if (!host) {
    return '';
  }
  return `http://${host}:5173`;
}

/** Reads `?guide=<id>` — the «QR по цеховой ссылке» route to an instruction stored on the server. */
export function readGuideIdFromLocation(
  loc: { search?: string; hash?: string } | null = currentLocation(),
): string | null {
  if (!loc) {
    return null;
  }
  const fromSearch = new URLSearchParams(loc.search ?? '').get('guide');
  if (fromSearch) {
    return fromSearch;
  }
  const hash = loc.hash ?? '';
  const questionMark = hash.indexOf('?');
  if (questionMark >= 0) {
    const fromHash = new URLSearchParams(hash.slice(questionMark + 1)).get('guide');
    if (fromHash) {
      return fromHash;
    }
  }
  return null;
}
