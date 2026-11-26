import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema } from '@ikguide/schema';
import { buildGuideFromCad } from '@ikguide/builder';
import { stepPartStates, up08CadPayload, up08Document, up08StepSvg } from './demo3d';
import { UP08_PARTS, UP08_STEPS } from '../data/up08-assembly';
import { IKEA_PALETTE } from './ikeaSvg';

describe('3D demo «Узел привода УП-08»', () => {
  it('ships a self-contained GLB and a real part list', () => {
    const doc = up08Document();
    expect(doc.assembly3d?.glbDataUrl?.startsWith('data:model/gltf-binary;base64,')).toBe(true);
    expect(doc.assembly3d?.parts).toHaveLength(12);
    expect(doc.assembly3d?.sourceFormat).toBe('glb');
    expect(doc.assembly3d?.sizeMm).toEqual({ x: 120, y: 80, z: 67 });
    expect(UP08_PARTS.every((part) => part.explosionVector.length === 3)).toBe(true);
  });

  it('builds six schema-valid steps with an IKEA diagram and a camera angle', () => {
    const doc = up08Document();
    const parsed = ikGuideDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    expect(doc.steps).toHaveLength(6);
    expect(doc.steps.map((step) => step.title)).toEqual([
      'Уложи корпус базой вверх',
      'Установи вал',
      'Установи фланец',
      'Установи крышку',
      'Надень 4 шайбы 6',
      'Закрути 4 болта М6x20',
    ]);
    for (const step of doc.steps) {
      expect(step.svgDiagram?.startsWith('<svg')).toBe(true);
      expect(step.cameraView).toBeDefined();
      expect(step.activePartIds?.length).toBeGreaterThan(0);
    }
  });

  it('draws every step with the four semantic colours and no raster image', () => {
    const allowed = new Set(Object.values(IKEA_PALETTE).map((value) => value.toLowerCase()));
    for (let index = 0; index < UP08_STEPS.length; index += 1) {
      const svg = up08StepSvg(index);
      expect(svg).toContain('viewBox="0 0 720 520"');
      expect(svg).not.toContain('<image');
      for (const match of svg.matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)) {
        expect(allowed.has(match[1]!.toLowerCase()), `${match[1]} в шаге ${index + 1}`).toBe(true);
      }
      expect(svg).toContain(`fill="${IKEA_PALETTE.activeFill}"`);
    }
  });

  it('groups the four bolts and the four washers in the bill of materials', () => {
    const doc = up08Document();
    const bolts = doc.bom.find((item) => item.name === 'Болт М6x20');
    const washers = doc.bom.find((item) => item.name === 'Шайба 6');
    expect(bolts?.quantity).toBe(4);
    expect(bolts?.icon).toBe('bolt');
    expect(washers?.quantity).toBe(4);
    expect(washers?.icon).toBe('washer');
    expect(doc.bom).toHaveLength(6);
  });

  it('gives the worker a full specification and a torque wrench', () => {
    const doc = up08Document();
    expect(doc.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['Ключ 10 мм', 'Динамометрический ключ']),
    );
    expect(doc.steps[5]?.workerText).toContain('8 Н·м');
    expect(doc.steps[5]?.workerText).toContain('крест-накрест');
    expect(doc.qcChecklist.some((item) => item.text.includes('8 Н·м'))).toBe(true);
  });

  it('knows what is installed, active and still ahead on every step', () => {
    expect(stepPartStates(0)).toEqual({
      active: ['part-1'],
      installed: [],
      hidden: [...UP08_STEPS.slice(1).flatMap((step) => step.partIds)],
    });
    const last = stepPartStates(5);
    expect(last.active).toHaveLength(4);
    expect(last.installed).toHaveLength(8);
    expect(last.hidden).toHaveLength(0);

    // Every part appears exactly once across the steps.
    const allIds = UP08_STEPS.flatMap((step) => step.partIds).sort();
    expect(allIds).toEqual(UP08_PARTS.map((part) => part.id).sort());
  });

  it('is deterministic: the same payload always yields the same document', () => {
    const first = up08Document();
    const second = up08Document();
    expect(second).toEqual(first);
    const rebuilt = buildGuideFromCad(up08CadPayload(), {
      id: first.id,
      drawingCode: first.metadata.drawingCode,
      material: first.metadata.material,
      createdAt: first.metadata.createdAt,
    });
    expect(rebuilt.document.steps.map((step) => step.svgDiagram)).toEqual(
      first.steps.map((step) => step.svgDiagram),
    );
  });
});
