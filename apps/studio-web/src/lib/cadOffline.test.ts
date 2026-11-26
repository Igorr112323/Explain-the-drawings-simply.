// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importMeshOffline, OfflineImportError } from './cadOffline';
import { UP08_GLB_DATA_URL } from '../data/up08-assembly';
import { buildGuideFromCad } from '@ikguide/builder';
import { ikGuideDocumentSchema } from '@ikguide/schema';

/** Turns the embedded demo GLB into a File, exactly as a drag-and-drop upload would. */
function demoFile(name = 'up08-assembly.glb'): File {
  const base64 = UP08_GLB_DATA_URL.slice(UP08_GLB_DATA_URL.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], name, { type: 'model/gltf-binary' });
}

describe('offline 3D import (no CAD service)', () => {
  it('splits a GLB into parts without any network call', async () => {
    const response = await importMeshOffline(demoFile());
    expect(response.parts).toHaveLength(12);
    expect(response.assembly.sourceFormat).toBe('glb');
    expect(response.glbDataUrl.startsWith('data:model/gltf-binary;base64,')).toBe(true);
    expect(response.warnings?.[0]).toContain('без сервера');
    expect(response.steps.length).toBeGreaterThanOrEqual(4);

    const names = response.parts.map((part) => part.name);
    expect(names).toEqual(expect.arrayContaining(['Корпус', 'Крышка', 'Фланец', 'Вал']));
    expect(response.parts.filter((part) => part.role === 'fastener').length).toBe(8);
  });

  it('produces a schema-valid draft instruction with IKEA diagrams', async () => {
    const response = await importMeshOffline(demoFile());
    const built = buildGuideFromCad(response, {
      createdAt: '2026-04-01T08:00:00.000Z',
      drawingCode: 'УП-08.000 СБ',
      material: 'Сплав АК7ч',
    });

    expect(ikGuideDocumentSchema.safeParse(built.document).success).toBe(true);
    expect(built.document.steps.every((step) => step.svgDiagram?.startsWith('<svg'))).toBe(true);
    expect(built.document.assembly3d?.parts).toHaveLength(12);
    expect(built.document.bom.some((item) => item.name.startsWith('Болт'))).toBe(true);
  });

  it('asks for the service when STEP tree parsing is required', async () => {
    const file = new File(['ISO-10303-21;'], 'assembly.step');
    await expect(importMeshOffline(file)).rejects.toBeInstanceOf(OfflineImportError);
    await expect(importMeshOffline(file)).rejects.toMatchObject({ hint: 'step' });
  });

  it('rejects a broken GLB with a readable message', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'broken.glb');
    await expect(importMeshOffline(file)).rejects.toMatchObject({ hint: 'corrupt' });
  });
});
