import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema } from '@ikguide/schema';
import { buildGuideFromCad, mergeCadUpdate } from './cad';
import { cadUnitResponse, cadUnitRevision } from './cad.fixture';

const OPTIONS = { createdAt: '2026-11-26T10:00:00.000Z' } as const;

describe('buildGuideFromCad', () => {
  it('produces a schema-valid 3D instruction', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const parsed = ikGuideDocumentSchema.safeParse(result.document);
    expect(parsed.success).toBe(true);
    expect(result.document.metadata.title).toBe('Узел привода УП-08');
    expect(result.document.metadata.difficulty).toBe('hard');
    expect(result.document.metadata.blankDimensions).toBe('120 × 68 × 80 мм');
    expect(result.document.metadata.massKg).toBeCloseTo(3.4, 3);
    expect(result.document.assembly3d?.glbDataUrl).toContain('data:model/gltf-binary');
    expect(result.document.assembly3d?.parts).toHaveLength(12);
  });

  it('keeps old 2D documents untouched: the new fields are optional', () => {
    const { document } = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const withoutAssembly = { ...document, assembly3d: undefined };
    expect(ikGuideDocumentSchema.safeParse(withoutAssembly).success).toBe(true);
  });

  it('groups identical fasteners in the bill of materials', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const bolts = result.document.bom.find((item) => item.name === 'Болт М6x20');
    expect(bolts?.quantity).toBe(4);
    expect(bolts?.kind).toBe('fastener');
    expect(bolts?.icon).toBe('bolt');
    expect(bolts?.size).toBe('М6×20');

    const washers = result.document.bom.find((item) => item.name === 'Шайба 6');
    expect(washers?.quantity).toBe(4);
    expect(washers?.icon).toBe('washer');
    expect(result.document.bom).toHaveLength(6);
  });

  it('adds a 10 mm spanner and a torque wrench for M6 fasteners', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const spanner = result.document.tools.find((tool) => tool.name === 'Ключ 10 мм');
    expect(spanner).toBeTruthy();
    expect(spanner?.forSteps).toContain(6);

    const torque = result.document.tools.find((tool) => tool.name === 'Динамометрический ключ');
    expect(torque?.purpose).toContain('8');
    expect(torque?.purpose).toContain('Н·м');
  });

  it('writes a tightening instruction with the cross pattern and the torque', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const bolts = result.document.steps.find((step) => step.title.includes('болт'));
    expect(bolts?.title).toMatch(/^Закрути 4 болта/);
    expect(bolts?.workerText).toContain('крест-накрест');
    expect(bolts?.workerText).toContain('8 Н·м');
    expect(bolts?.antiError?.severity).toBe('warning');
    expect(bolts?.criticalChecks[0]?.instrument).toBe('Динамометрический ключ');
    expect(bolts?.activePartIds).toHaveLength(4);
  });

  it('links steps to 3D parts and keeps the IKEA diagram', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const steps = result.document.steps;
    expect(steps[0]?.activePartIds).toEqual(['part-1']);
    expect(steps[1]?.installedPartIds).toEqual(['part-1']);
    expect(steps.every((step) => (step.svgDiagram ?? '').startsWith('<svg'))).toBe(true);
    expect(steps.every((step) => step.cameraView !== undefined)).toBe(true);

    const parts = result.document.assembly3d?.parts ?? [];
    const housing = parts.find((item) => item.displayName === 'Корпус');
    expect(housing?.role).toBe('base');
    expect(housing?.stepNumber).toBe(1);
    const bolt = parts.find((item) => item.displayName === 'Болт М6x20');
    expect(bolt?.stepNumber).toBe(6);
    // Centres are stored so the studio can re-render diagrams after regrouping, without the service.
    expect(housing?.centerMm).toBeDefined();
    expect(Number.isFinite(housing?.centerMm?.x ?? NaN)).toBe(true);
  });

  it('builds a control checklist for the assembly', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const texts = result.document.qcChecklist.map((item) => item.text);
    expect(texts.some((text) => text.includes('8 Н·м'))).toBe(true);
    expect(texts.some((text) => text.includes('Вал вращается'))).toBe(true);
    expect(texts.some((text) => text.includes('12 деталей'))).toBe(true);
  });

  it('warns about placeholders when the engineer did not fill them in', () => {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    expect(result.warnings.some((warning) => warning.includes('Шифр'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('Материал'))).toBe(true);
    expect(result.document.metadata.drawingCode.startsWith('3D-')).toBe(true);

    const filled = buildGuideFromCad(cadUnitResponse(), {
      ...OPTIONS,
      drawingCode: 'УП-08.000 СБ',
      material: 'Алюминий АД31',
    });
    expect(filled.document.metadata.drawingCode).toBe('УП-08.000 СБ');
    expect(filled.warnings.some((warning) => warning.includes('Материал'))).toBe(false);
  });

  it('refuses an empty model', () => {
    const empty = cadUnitResponse();
    expect(() =>
      buildGuideFromCad({ ...empty, parts: [] }, OPTIONS),
    ).toThrow(/ни одной детали/);
    expect(() =>
      buildGuideFromCad({ ...empty, steps: [] }, OPTIONS),
    ).toThrow(/порядок сборки/);
  });
});

describe('mergeCadUpdate', () => {
  function editedDocument() {
    const result = buildGuideFromCad(cadUnitResponse(), OPTIONS);
    const document = result.document;
    const shaftStep = document.steps.find((step) => step.title.includes('вал'))!;
    const steps = document.steps.map((step) =>
      step.id === shaftStep.id
        ? {
            ...step,
            title: 'Установи вал аккуратно',
            workerText: 'Смажьте шейку вала Литолом-24 и вставьте его до упора, не ударяя.',
            antiError: { text: 'Не забивайте вал молотком — только киянкой через оправку.', severity: 'critical' as const },
            cameraView: { azimuth: 77, elevation: 12 },
            estimatedMinutes: 5,
            criticalChecks: [
              { id: 'check-shaft', label: 'Люфт вала', nominal: '≤ 0,1 мм', acceptance: 'по индикатору', instrument: 'Индикатор ИЧ-10' },
            ],
          }
        : step,
    );
    const qcChecklist = [
      ...document.qcChecklist,
      { id: 'qc-manual-shaft', text: 'Вал смазан Литолом-24.', required: true },
    ];
    return { ...document, steps, qcChecklist };
  }

  it('rebuilds the guide and reports what changed in the model', () => {
    const previous = editedDocument();
    const result = mergeCadUpdate(previous, cadUnitRevision(), OPTIONS);

    expect(result.changes.added).toEqual(['Втулка']);
    expect(result.changes.removed).toEqual(['Фланец']);
    expect(result.changes.changed).toEqual(['Болт М6x20']);
    expect(result.changes.partsBefore).toBe(12);
    expect(result.changes.partsAfter).toBe(12);
    expect(result.summary).toContain('+1');
    expect(result.summary).toContain('−1');
    expect(result.document.assembly3d?.parts.some((part) => part.displayName === 'Втулка')).toBe(true);
    expect(result.document.assembly3d?.parts.some((part) => part.displayName === 'Фланец')).toBe(false);
  });

  it('keeps manual texts, anti-errors, camera views and QC items', () => {
    const previous = editedDocument();
    const result = mergeCadUpdate(previous, cadUnitRevision(), OPTIONS);

    const shaft = result.document.steps.find((step) => (step.title ?? '').includes('вал'));
    expect(shaft?.title).toBe('Установи вал аккуратно');
    expect(shaft?.workerText).toContain('Литол');
    expect(shaft?.antiError?.severity).toBe('critical');
    expect(shaft?.cameraView).toEqual({ azimuth: 77, elevation: 12 });
    expect(shaft?.estimatedMinutes).toBe(5);
    expect(shaft?.criticalChecks[0]?.instrument).toBe('Индикатор ИЧ-10');

    expect(result.document.qcChecklist.some((item) => item.id === 'qc-manual-shaft')).toBe(true);
    expect(result.changes.keptEdits.length).toBeGreaterThan(0);
  });

  it('keeps regenerated texts for untouched steps and bumps the revision', () => {
    const previous = buildGuideFromCad(cadUnitResponse(), OPTIONS).document;
    const result = mergeCadUpdate(previous, cadUnitRevision(), OPTIONS);

    expect(previous.metadata.revision).toBe('A');
    expect(result.document.metadata.revision).toBe('B');
    expect(result.document.id).toBe(previous.id);
    expect(result.changes.keptEdits).toHaveLength(0);
    const fresh = buildGuideFromCad(cadUnitRevision(), OPTIONS).document;
    expect(result.document.steps[0]?.title).toBe(fresh.steps[0]?.title);
    expect(result.document.steps[0]?.workerText).toBe(fresh.steps[0]?.workerText);
  });

  it('adds the new part to the bill of materials', () => {
    const previous = buildGuideFromCad(cadUnitResponse(), OPTIONS).document;
    const result = mergeCadUpdate(previous, cadUnitRevision(), OPTIONS);
    const bushing = result.document.bom.find((item) => item.name === 'Втулка');
    expect(bushing?.quantity).toBe(1);
    expect(result.document.bom.some((item) => item.name === 'Фланец')).toBe(false);
  });

  it('rejects an empty revision instead of wiping the guide', () => {
    const previous = buildGuideFromCad(cadUnitResponse(), OPTIONS).document;
    const empty = cadUnitResponse();
    expect(() => mergeCadUpdate(previous, { ...empty, parts: [] }, OPTIONS)).toThrow(/ни одной детали/);
  });
});
