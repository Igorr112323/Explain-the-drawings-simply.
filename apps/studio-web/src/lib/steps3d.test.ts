import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema } from '@ikguide/schema';
import { up08Document } from './demo3d';
import {
  canMergeWithPrevious,
  canSplitStep,
  mergeStepWithPrevious,
  recomputeSteps,
  sceneForDocument,
  splitPartToStep,
} from './steps3d';

describe('3D step regrouping', () => {
  it('stores every part centre so diagrams can be re-rendered offline', () => {
    const doc = up08Document();
    expect(doc.assembly3d?.parts.every((part) => part.centerMm !== undefined)).toBe(true);
    const scene = sceneForDocument(doc);
    expect(scene.parts).toHaveLength(12);
    expect(scene.diagonal).toBeGreaterThan(100);
  });

  it('renumbers steps and recomputes installed/active links', () => {
    const doc = up08Document();
    const recomputed = recomputeSteps(doc);
    expect(recomputed.steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(recomputed.steps[0]?.installedPartIds).toEqual([]);
    expect(recomputed.steps[1]?.installedPartIds).toEqual(['part-1']);
    // The first four parts are installed exactly once.
    const installed = recomputed.steps[3]?.installedPartIds ?? [];
    expect(new Set(installed).size).toBe(installed.length);
    expect(ikGuideDocumentSchema.safeParse(recomputed).success).toBe(true);
  });

  it('merges the four washers and the four bolts into one step', () => {
    const doc = up08Document();
    const bolts = doc.steps[5]!;
    expect(canMergeWithPrevious(doc, bolts.id)).toBe(true);

    const merged = mergeStepWithPrevious(doc, bolts.id);
    expect(merged.steps).toHaveLength(5);
    const combined = merged.steps[4]!;
    expect(combined.activePartIds).toEqual([...(doc.steps[4]!.activePartIds ?? []), ...(bolts.activePartIds ?? [])]);
    expect(combined.activePartIds).toHaveLength(8);
    expect(combined.title).toContain('шайбы');
    expect(combined.workerText).toContain('болта');
    expect(combined.criticalChecks.length).toBeGreaterThan(0);
    expect(merged.steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5]);
    expect(merged.assembly3d?.parts.find((part) => part.id === 'part-5')?.stepNumber).toBe(5);
    expect(ikGuideDocumentSchema.safeParse(merged).success).toBe(true);
  });

  it('splits one part off into its own step with a fresh diagram', () => {
    const doc = up08Document();
    const washers = doc.steps[4]!;
    expect(canSplitStep(doc, washers.id)).toBe(true);

    const lastPart = (washers.activePartIds ?? []).at(-1)!;
    const split = splitPartToStep(doc, washers.id, lastPart);

    expect(split.steps).toHaveLength(7);
    expect(split.steps.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(split.steps[4]?.activePartIds).toEqual((washers.activePartIds ?? []).filter((id) => id !== lastPart));
    expect(split.steps[5]?.activePartIds).toEqual([lastPart]);
    expect(split.steps[5]?.title).toBe('Установи Шайба 6');
    expect(split.steps[5]?.svgDiagram?.startsWith('<svg')).toBe(true);
    expect(split.steps[5]?.svgDiagram).not.toBe(split.steps[4]?.svgDiagram);
    expect(split.steps[6]?.number).toBe(7);
    expect(ikGuideDocumentSchema.safeParse(split).success).toBe(true);
  });

  it('refuses nonsensical regroupings instead of corrupting the document', () => {
    const doc = up08Document();
    expect(mergeStepWithPrevious(doc, doc.steps[0]!.id)).toBe(doc);
    expect(splitPartToStep(doc, doc.steps[0]!.id, 'part-1')).toBe(doc);
    expect(splitPartToStep(doc, doc.steps[4]!.id, 'unknown')).toBe(doc);
    expect(canMergeWithPrevious(doc, doc.steps[0]!.id)).toBe(false);
  });

  it('keeps 2D documents untouched', () => {
    const doc = up08Document();
    const twoD = { ...doc, assembly3d: undefined, steps: doc.steps.map((step) => ({ ...step, svgDiagram: undefined })) };
    const recomputed = recomputeSteps(twoD);
    expect(recomputed.steps.every((step) => step.svgDiagram === undefined)).toBe(true);
    expect(recomputed.assembly3d).toBeUndefined();
  });
});
