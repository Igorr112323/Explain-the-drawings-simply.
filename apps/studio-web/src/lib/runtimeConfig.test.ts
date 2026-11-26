// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  NATIVE_DEFAULT_CAD,
  NATIVE_DEFAULT_VISION,
  SETTINGS_STORAGE_KEY,
  canSwitchToEngineer,
  defaultModeForRuntime,
  detectRuntime,
  getCadBaseUrl,
  getVisionBaseUrl,
  joinUrl,
  defaultWorkshopBaseUrl,
  loadSettings,
  probeConnection,
  readGuideIdFromLocation,
  readPayloadFromLocation,
  runtimeLabel,
  sanitizeBaseUrl,
  saveSettings,
  suggestLanAddresses,
} from './runtimeConfig';

beforeEach(() => {
  window.localStorage.clear();
});

describe('runtime detection', () => {
  it('defaults to the browser', () => {
    expect(detectRuntime({ window: {} })).toBe('web');
    expect(detectRuntime({})).toBe('web');
    expect(detectRuntime({ window: undefined })).toBe('web');
  });

  it('recognises the Tauri desktop shell', () => {
    expect(detectRuntime({ window: { __TAURI_INTERNALS__: { invoke: () => undefined } } })).toBe('tauri-desktop');
    expect(detectRuntime({ window: { __TAURI__: { core: {} } } })).toBe('tauri-desktop');
  });

  it('recognises the Capacitor Android shell and ignores its web mode', () => {
    const android = {
      window: { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } },
    };
    expect(detectRuntime(android)).toBe('capacitor-android');

    const webView = { window: { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } } };
    expect(detectRuntime(webView)).toBe('web');
  });

  it('starts the tablet as a worker and the desktop as an engineer', () => {
    expect(defaultModeForRuntime('capacitor-android')).toBe('worker');
    expect(defaultModeForRuntime('web')).toBe('worker');
    expect(defaultModeForRuntime('tauri-desktop')).toBe('engineer');
    expect(runtimeLabel('tauri-desktop')).toContain('.exe');
    expect(runtimeLabel('capacitor-android')).toContain('.apk');
    expect(runtimeLabel('web')).toContain('Браузер');
  });

  it('hides the engineer editor on the tablet in strict workshop mode', () => {
    const strict = { ...DEFAULT_SETTINGS, strictWorkshop: true };
    expect(canSwitchToEngineer('capacitor-android', strict)).toBe(false);
    expect(canSwitchToEngineer('capacitor-android', DEFAULT_SETTINGS)).toBe(true);
    expect(canSwitchToEngineer('web', strict)).toBe(true);
    expect(canSwitchToEngineer('tauri-desktop', strict)).toBe(true);
  });
});

describe('API base URLs', () => {
  it('keeps relative paths in the browser so the Vite proxy works', () => {
    expect(getVisionBaseUrl(DEFAULT_SETTINGS, 'web')).toBe('');
    expect(getCadBaseUrl(DEFAULT_SETTINGS, 'web')).toBe('');
    expect(joinUrl('', '/v1/recognize')).toBe('/v1/recognize');
  });

  it('uses absolute localhost defaults in native shells', () => {
    expect(getVisionBaseUrl(DEFAULT_SETTINGS, 'tauri-desktop')).toBe(NATIVE_DEFAULT_VISION);
    expect(getCadBaseUrl(DEFAULT_SETTINGS, 'capacitor-android')).toBe(NATIVE_DEFAULT_CAD);
    expect(joinUrl(NATIVE_DEFAULT_CAD, '/v1/cad/health')).toBe('http://127.0.0.1:8001/v1/cad/health');
  });

  it('prefers the address saved from the workshop settings', () => {
    const settings = { visionBaseUrl: 'http://192.168.1.50:8000', cadBaseUrl: 'http://10.0.0.7:8001/', strictWorkshop: false };
    expect(getVisionBaseUrl(settings, 'capacitor-android')).toBe('http://192.168.1.50:8000');
    expect(getCadBaseUrl(settings, 'capacitor-android')).toBe('http://10.0.0.7:8001');
    expect(joinUrl(getCadBaseUrl(settings, 'web'), '/v1/cad/import')).toBe('http://10.0.0.7:8001/v1/cad/import');
  });

  it('rejects half-written addresses instead of sending requests to nowhere', () => {
    expect(sanitizeBaseUrl('192.168.1.50:8000')).toBe('');
    expect(sanitizeBaseUrl('  http://192.168.1.50:8000///  ')).toBe('http://192.168.1.50:8000');
    expect(sanitizeBaseUrl('')).toBe('');
    expect(sanitizeBaseUrl(undefined)).toBe('');
  });

  it('suggests the LAN addresses of the machine that serves the app', () => {
    expect(suggestLanAddresses({ hostname: '192.168.1.50' })).toEqual({
      vision: 'http://192.168.1.50:8000',
      cad: 'http://192.168.1.50:8001',
    });
    expect(suggestLanAddresses({ hostname: 'localhost' })).toEqual({
      vision: NATIVE_DEFAULT_VISION,
      cad: NATIVE_DEFAULT_CAD,
    });
    expect(suggestLanAddresses(null)).toEqual({ vision: NATIVE_DEFAULT_VISION, cad: NATIVE_DEFAULT_CAD });
  });
});

describe('settings persistence', () => {
  it('round-trips through localStorage', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ visionBaseUrl: 'http://192.168.1.50:8000/', cadBaseUrl: 'http://192.168.1.50:8001', strictWorkshop: true });
    expect(window.localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeTruthy();
    expect(loadSettings()).toEqual({
      visionBaseUrl: 'http://192.168.1.50:8000',
      cadBaseUrl: 'http://192.168.1.50:8001',
      strictWorkshop: true,
    });
  });

  it('survives corrupted storage', () => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ visionBaseUrl: 'nonsense' }));
    expect(loadSettings().visionBaseUrl).toBe('');
  });
});

describe('QR payload in the address bar', () => {
  it('reads ?guide= links from the address bar', () => {
    expect(readGuideIdFromLocation({ search: '?guide=guide-ks04-bracket' })).toBe('guide-ks04-bracket');
    expect(readGuideIdFromLocation({ search: '', hash: '#/?guide=demo-up08-3d' })).toBe('demo-up08-3d');
    expect(readGuideIdFromLocation({ search: '?g=abc' })).toBeNull();
    expect(readGuideIdFromLocation(null)).toBeNull();
  });

  it('suggests the workshop address a phone should open', () => {
    expect(defaultWorkshopBaseUrl(DEFAULT_SETTINGS, 'web', { origin: 'http://192.168.1.50:5173', protocol: 'http:' })).toBe(
      'http://192.168.1.50:5173',
    );
    expect(
      defaultWorkshopBaseUrl({ ...DEFAULT_SETTINGS, visionBaseUrl: 'http://192.168.1.50:8000' }, 'tauri-desktop', {
        protocol: 'file:',
      }),
    ).toBe('http://192.168.1.50:5173');
    // Without any saved address the `.exe` points at its own machine — the workshop PC itself.
    expect(defaultWorkshopBaseUrl(DEFAULT_SETTINGS, 'tauri-desktop', { protocol: 'file:' })).toBe('http://127.0.0.1:5173');
  });

  it('reads ?g=, #?g= and no payload at all', () => {
    expect(readPayloadFromLocation({ search: '?g=ABC123' })).toBe('ABC123');
    expect(readPayloadFromLocation({ search: '', hash: '#/?g=XYZ' })).toBe('XYZ');
    expect(readPayloadFromLocation({ search: '?foo=1' })).toBeNull();
    expect(readPayloadFromLocation(null)).toBeNull();
  });
});

describe('«Проверить связь»', () => {
  const runtime = 'capacitor-android';
  const settings = { visionBaseUrl: 'http://192.168.1.50:8000', cadBaseUrl: 'http://192.168.1.50:8001', strictWorkshop: false };

  it('reports both services as healthy with OpenCV, OCR and STEP details', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === 'http://192.168.1.50:8000/health') {
        return new Response(
          JSON.stringify({ status: 'ok', opencv: '4.10.0', ocr: 'tesseract', ocrAvailable: true, version: '0.2.0' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ status: 'ok', trimesh: '5.2.2', stepEnabled: true, stepEngine: 'cascadio', formats: ['stl', 'obj', 'glb'] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const report = await probeConnection(settings, runtime, { fetchImpl, now: () => new Date('2026-11-26T09:00:00Z') });
    expect(report.ok).toBe(true);
    expect(calls).toEqual(['http://192.168.1.50:8000/health', 'http://192.168.1.50:8001/v1/cad/health']);
    expect(report.vision.lines).toEqual([
      { label: 'OpenCV', value: '4.10.0' },
      { label: 'OCR', value: 'tesseract · готов' },
      { label: 'Версия', value: '0.2.0' },
    ]);
    expect(report.cad.lines[1]).toEqual({ label: 'STEP', value: 'доступен · cascadio' });
    expect(report.vision.latencyMs).toBeGreaterThanOrEqual(0);
    expect(report.checkedAt.length).toBeGreaterThan(0);
  });

  it('marks each service separately when one of them is down', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).includes(':8001')) {
        throw new TypeError('Failed to fetch');
      }
      return new Response(JSON.stringify({ opencv: '4.9.0', ocr: 'none', ocrAvailable: false }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await probeConnection(settings, runtime, { fetchImpl });
    expect(report.ok).toBe(false);
    expect(report.vision.ok).toBe(true);
    expect(report.vision.lines[1]).toEqual({ label: 'OCR', value: 'не найден' });
    expect(report.cad.ok).toBe(false);
    expect(report.cad.error).toContain('не ответил');
  });

  it('turns an HTTP error into a readable Russian message', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const report = await probeConnection(settings, runtime, { fetchImpl });
    expect(report.vision.ok).toBe(false);
    expect(report.vision.error).toContain('503');
  });

  it('keeps the relative addresses of the browser shell', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await probeConnection(DEFAULT_SETTINGS, 'web', { fetchImpl });
    expect(calls).toEqual(['/health', '/v1/cad/health']);
  });
});
