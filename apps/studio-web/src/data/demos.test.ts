import { describe, expect, it } from 'vitest';
import { getUnconfirmedAnnotations, ikGuideDocumentSchema } from '@ikguide/schema';
import { translateEngineeringNotation } from '@ikguide/gost-translator';
import { DEMO_DOCUMENTS, DEMO_PROJECTS, bracketDocument, gearboxDocument } from './demos';
import { isKnownIllustration } from '../art/ids';

describe('built-in demo projects', () => {
  it('contains three valid and different projects', () => {
    expect(DEMO_DOCUMENTS).toHaveLength(3);
    expect(DEMO_PROJECTS.map((project) => project.id)).toEqual([
      'demo-bracket',
      'demo-gearbox',
      'demo-up08-3d',
    ]);
    expect(new Set(DEMO_DOCUMENTS.map((doc) => doc.id)).size).toBe(3);
    for (const doc of DEMO_DOCUMENTS) {
      const result = ikGuideDocumentSchema.safeParse(doc);
      if (!result.success) {
        throw new Error(`${doc.id}: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
      }
    }
  });

  it('uses only illustrations known to the art registry', () => {
    for (const doc of DEMO_DOCUMENTS) {
      for (const step of doc.steps) {
        expect(isKnownIllustration(step.illustration.illustrationId), `${doc.id} / ${step.id}`).toBe(true);
      }
    }
  });

  it('keeps the old 2D projects free of 3D data', () => {
    for (const doc of [bracketDocument, gearboxDocument]) {
      expect(doc.assembly3d).toBeUndefined();
      expect(doc.steps.every((step) => step.svgDiagram === undefined)).toBe(true);
    }
  });

  it('keeps every x-ray annotation translatable by the GOST engine', () => {
    for (const doc of DEMO_DOCUMENTS) {
      for (const annotation of doc.xrayAnnotations) {
        const translation = translateEngineeringNotation(annotation.raw);
        expect(translation.kind, `${doc.id} / ${annotation.raw}`).not.toBe('unknown');
        expect(translation.explanation.length).toBeGreaterThan(30);
      }
    }
  });

  it('demonstrates the anti-hallucination flow with unconfirmed dimensions', () => {
    const bracketUnconfirmed = getUnconfirmedAnnotations(bracketDocument);
    expect(bracketUnconfirmed.length).toBeGreaterThanOrEqual(2);
    const ambiguous = bracketDocument.xrayAnnotations.find((annotation) => annotation.ambiguousOptions);
    expect(ambiguous?.ambiguousOptions).toEqual(['12 мм', '18 мм']);
    expect(ambiguous?.confidence).toBeLessThan(0.95);

    const gearboxUnconfirmed = getUnconfirmedAnnotations(gearboxDocument);
    expect(gearboxUnconfirmed.length).toBeGreaterThan(0);
  });

  it('contains the technical anchors required by the brief', () => {
    const bracketRaw = bracketDocument.xrayAnnotations.map((annotation) => annotation.raw);
    expect(bracketRaw).toEqual(expect.arrayContaining(['Ø20 H7', '4 отв. М8-7H глуб. 20', 'Ra 1.6', 'Т1-К5', '2×45°']));
    expect(bracketDocument.steps.some((step) => step.antiError?.severity === 'critical')).toBe(true);
    expect(bracketDocument.steps.every((step) => step.criticalChecks.length > 0)).toBe(true);

    const gearboxRaw = gearboxDocument.xrayAnnotations.map((annotation) => annotation.raw);
    expect(gearboxRaw).toEqual(expect.arrayContaining(['Ø32 H7/k6', '6 отв. М6-7H', 'Ra 0.8']));
    expect(gearboxDocument.bom.some((item) => item.icon === 'washer')).toBe(true);
    expect(gearboxDocument.steps.some((step) => step.title.toLowerCase().includes('крест-накрест'))).toBe(true);
  });

  it('references only existing annotations from steps', () => {
    for (const doc of DEMO_DOCUMENTS) {
      const ids = new Set(doc.xrayAnnotations.map((annotation) => annotation.id));
      for (const step of doc.steps) {
        for (const ref of step.drawingRefs) {
          expect(ids.has(ref), `${doc.id} / ${step.id} / ${ref}`).toBe(true);
        }
      }
    }
  });
});
