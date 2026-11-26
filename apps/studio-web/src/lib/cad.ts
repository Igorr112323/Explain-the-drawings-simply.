import type { CadImportResponse, CadStepPayload } from '@ikguide/builder';

/**
 * Client of the local Python CAD service (port 8001 by default, proxied by Vite).
 *
 * Requests are strictly relative (`/v1/cad/...`): the studio never learns the host of the service,
 * so the same bundle works on the shop floor laptop, in the preview sandbox and inside Tauri.
 * Everything here degrades gracefully: when the service is down the studio keeps working with the
 * built-in 3D demo and with the in-browser GLB loader.
 */
export type CadErrorKind = 'offline' | 'rejected' | 'server';

export class CadError extends Error {
  readonly kind: CadErrorKind;
  readonly code: string | null;

  constructor(kind: CadErrorKind, message: string, code: string | null = null) {
    super(message);
    this.name = 'CadError';
    this.kind = kind;
    this.code = code;
  }
}

export interface CadHealth {
  status: string;
  service: string;
  version: string;
  trimesh: string;
  stepEnabled: boolean;
  stepEngine: string;
  formats: string[];
  maxUploadMb: number;
  svgPalette: {
    ink: string;
    paper: string;
    activeFill: string;
    activeLine: string;
    attention: string;
  };
}

export interface CadRenderViewRequest {
  sessionId: string;
  azimuth: number;
  elevation: number;
  explode?: number;
  activePartIds?: string[];
  installedPartIds?: string[];
  ghostPartIds?: string[];
  attention?: string | null;
  caption?: string | null;
}

export interface CadRenderViewResponse {
  svg: string;
  azimuth: number;
  elevation: number;
  triangles: number;
}

export type { CadImportResponse, CadStepPayload };

const HEALTH_TIMEOUT_MS = 3000;
const IMPORT_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 20_000;

export const CAD_FORMATS = ['.glb', '.gltf', '.stl', '.obj', '.step', '.stp'] as const;
export const STEP_FORMATS = ['.step', '.stp'] as const;

export function cadFormatOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index).toLowerCase() : '';
}

/** STEP needs the Python service; meshes can also be shown straight in the browser. */
export function needsCadServer(fileName: string): boolean {
  const format = cadFormatOf(fileName);
  return format === '.step' || format === '.stp';
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new CadError('offline', 'Сервис 3D-моделей не ответил вовремя.');
    }
    throw new CadError('offline', 'Сервис 3D-моделей недоступен.');
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function readError(response: Response, fallback: string): Promise<CadError> {
  let message = fallback;
  let code: string | null = null;
  try {
    const payload = (await response.json()) as { detail?: unknown; code?: unknown };
    if (typeof payload.detail === 'string' && payload.detail.trim().length > 0) {
      message = payload.detail;
    }
    if (typeof payload.code === 'string') {
      code = payload.code;
    }
  } catch {
    // Non-JSON error body: keep the fallback text.
  }
  const kind: CadErrorKind = response.status === 415 || response.status === 413 || response.status === 422 ? 'rejected' : 'server';
  return new CadError(kind, message, code);
}

export async function cadHealth(): Promise<CadHealth> {
  const response = await request('/v1/cad/health', { method: 'GET' }, HEALTH_TIMEOUT_MS);
  if (!response.ok) {
    throw await readError(response, 'Сервис 3D-моделей ответил ошибкой.');
  }
  return (await response.json()) as CadHealth;
}

export async function cadImport(file: File): Promise<CadImportResponse> {
  const body = new FormData();
  body.append('file', file, file.name);
  const response = await request('/v1/cad/import', { method: 'POST', body }, IMPORT_TIMEOUT_MS);
  if (!response.ok) {
    throw await readError(response, 'Не удалось разобрать 3D-модель.');
  }
  return (await response.json()) as CadImportResponse;
}

export async function cadRenderView(payload: CadRenderViewRequest): Promise<CadRenderViewResponse> {
  const response = await request(
    '/v1/cad/render-view',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    RENDER_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw await readError(response, 'Не удалось построить IKEA-ракурс.');
  }
  return (await response.json()) as CadRenderViewResponse;
}

/**
 * Reads a mesh file fully in the browser, so that `.glb`/`.gltf`/`.stl`/`.obj` can be shown even
 * when the Python service is stopped. Returns a data URL plus the raw text of text-based formats.
 */
export async function readMeshFile(file: File): Promise<{ dataUrl: string; text: string | null }> {
  const buffer = await file.arrayBuffer();
  const format = cadFormatOf(file.name);
  const binary = new Uint8Array(buffer);
  let binaryString = '';
  const chunk = 0x8000;
  for (let index = 0; index < binary.length; index += chunk) {
    binaryString += String.fromCharCode(...binary.subarray(index, index + chunk));
  }
  const mime =
    format === '.glb'
      ? 'model/gltf-binary'
      : format === '.gltf'
        ? 'model/gltf+json'
        : format === '.obj'
          ? 'text/plain'
          : 'model/stl';
  const dataUrl = `data:${mime};base64,${globalThis.btoa(binaryString)}`;
  const text = format === '.gltf' || format === '.obj' ? new TextDecoder('utf-8').decode(binary) : null;
  return { dataUrl, text };
}
