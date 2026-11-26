import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadError, cadHealth, cadImport, cadFormatOf, needsCadServer, readMeshFile } from './cad';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('CAD service client', () => {
  it('talks to the service through relative URLs only', async () => {
    const spy = stubFetch(() =>
      jsonResponse({
        status: 'ok',
        service: 'ikguide-cad-api',
        version: '1.0.0',
        trimesh: '5.2.2',
        stepEnabled: true,
        stepEngine: 'cascadio 0.1.1',
        formats: ['glb', 'step'],
        maxUploadMb: 40,
        svgPalette: {
          ink: '#1D1D1F',
          paper: '#FFFFFF',
          activeFill: '#E8F2FF',
          activeLine: '#007AFF',
          attention: '#FF3B30',
        },
      }),
    );

    const health = await cadHealth();
    expect(health.service).toBe('ikguide-cad-api');
    expect(health.stepEnabled).toBe(true);
    expect(spy.mock.calls[0]?.[0]).toBe('/v1/cad/health');
  });

  it('reports an offline service without throwing a raw fetch error', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(cadHealth()).rejects.toMatchObject({ kind: 'offline' });
    await expect(cadHealth()).rejects.toBeInstanceOf(CadError);
  });

  it('surfaces the server error code and message on a rejected import', async () => {
    stubFetch(() =>
      jsonResponse({ detail: 'Формат .dwg не поддерживается.', code: 'unsupported_format' }, 415),
    );
    const file = new File([new Uint8Array([1, 2, 3])], 'drawing.dwg');
    await expect(cadImport(file)).rejects.toMatchObject({
      kind: 'rejected',
      code: 'unsupported_format',
      message: 'Формат .dwg не поддерживается.',
    });
  });

  it('knows which formats need the Python service', () => {
    expect(needsCadServer('assembly.step')).toBe(true);
    expect(needsCadServer('УЗЕЛ.STP')).toBe(true);
    expect(needsCadServer('model.glb')).toBe(false);
    expect(needsCadServer('part.stl')).toBe(false);
    expect(cadFormatOf('no-extension')).toBe('');
  });

  it('reads a mesh file as a data URL for the in-browser viewer', async () => {
    const file = new File([new Uint8Array([103, 108, 84, 70])], 'demo.glb');
    const { dataUrl, text } = await readMeshFile(file);
    expect(dataUrl.startsWith('data:model/gltf-binary;base64,')).toBe(true);
    expect(text).toBeNull();

    const gltf = new File(['{"asset":{"version":"2.0"}}'], 'demo.gltf');
    const read = await readMeshFile(gltf);
    expect(read.dataUrl.startsWith('data:model/gltf+json;base64,')).toBe(true);
    expect(read.text).toContain('"version"');
  });
});
