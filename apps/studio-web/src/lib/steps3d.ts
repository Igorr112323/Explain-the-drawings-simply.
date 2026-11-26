import type { GuideStep, IkGuideDocument } from '@ikguide/schema';
import { renderIkeaSvg, type IkeaSceneGeometry } from './ikeaSvg';

/**
 * Regrouping parts across 3D steps: merge a step into the previous one, or split one part off into
 * its own step. Both operations are pure document transformations:
 *
 *  • steps are renumbered 1…n and keep unique ids;
 *  • `installedPartIds` is recomputed from the actual order, so a part is never «installed» twice;
 *  • `assembly3d.parts[].stepNumber` follows the new order;
 *  • IKEA diagrams are re-rendered offline from the stored part centres (no service round-trip).
 */

export function sceneForDocument(doc: IkGuideDocument): IkeaSceneGeometry {
  const parts = doc.assembly3d?.parts ?? [];
  const converted = parts.map((part) => ({
    id: part.id,
    center: [part.centerMm?.x ?? 0, part.centerMm?.y ?? 0, part.centerMm?.z ?? 0] as [number, number, number],
    size: part.bboxMm
      ? ([part.bboxMm.x, part.bboxMm.y, part.bboxMm.z] as [number, number, number])
      : ([10, 10, 10] as [number, number, number]),
    explosionVector: part.explosionVector,
    role: part.role,
    displayName: part.displayName,
  }));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const part of converted) {
    for (let axis = 0; axis < 3; axis += 1) {
      const half = part.size[axis]! / 2;
      min[axis] = Math.min(min[axis]!, part.center[axis]! - half);
      max[axis] = Math.max(max[axis]!, part.center[axis]! + half);
    }
  }
  const diagonal =
    converted.length === 0
      ? 100
      : Math.max(
          1,
          Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
        );
  return { parts: converted, diagonal };
}

function installedBefore(steps: readonly GuideStep[], index: number): string[] {
  return steps.slice(0, index).flatMap((step) => step.activePartIds ?? []);
}

/** Renumbers steps and recomputes every 3D link + diagram from the new order. */
export function recomputeSteps(doc: IkGuideDocument): IkGuideDocument {
  const scene = doc.assembly3d ? sceneForDocument(doc) : null;
  const steps: GuideStep[] = doc.steps.map((step, index) => {
    const active = [...(step.activePartIds ?? [])];
    const installed = installedBefore(doc.steps, index);
    const hidden = doc.steps
      .slice(index + 1)
      .flatMap((later) => later.activePartIds ?? [])
      .filter((id) => !active.includes(id) && !installed.includes(id));
    const svgDiagram =
      scene && active.length > 0
        ? renderIkeaSvg(scene, {
            activePartIds: active,
            installedPartIds: installed,
            hiddenPartIds: hidden,
            azimuth: step.cameraView?.azimuth ?? 35,
            elevation: step.cameraView?.elevation ?? 26,
            caption: `Шаг ${index + 1}. ${step.title}`,
          })
        : step.svgDiagram;
    return {
      ...step,
      number: index + 1,
      activePartIds: step.activePartIds ? active : step.activePartIds,
      installedPartIds: step.activePartIds ? installed : step.installedPartIds,
      svgDiagram,
    };
  });

  const stepByPart = new Map<string, number>();
  steps.forEach((step) => (step.activePartIds ?? []).forEach((id) => stepByPart.set(id, step.number)));
  const assembly3d = doc.assembly3d
    ? {
        ...doc.assembly3d,
        parts: doc.assembly3d.parts.map((part) => ({
          ...part,
          stepNumber: stepByPart.get(part.id) ?? part.stepNumber,
        })),
      }
    : undefined;

  return { ...doc, steps, assembly3d };
}

/** Merges `stepId` into the previous step (parts move there, the step itself disappears). */
export function mergeStepWithPrevious(doc: IkGuideDocument, stepId: string): IkGuideDocument {
  const index = doc.steps.findIndex((step) => step.id === stepId);
  if (index <= 0) {
    return doc;
  }
  const previous = doc.steps[index - 1]!;
  const current = doc.steps[index]!;
  const merged: GuideStep = {
    ...previous,
    activePartIds: [...(previous.activePartIds ?? []), ...(current.activePartIds ?? [])],
    title: `${previous.title} и ${current.title.charAt(0).toLowerCase()}${current.title.slice(1)}`,
    workerText: `${previous.workerText} ${current.workerText}`.trim(),
    estimatedMinutes: previous.estimatedMinutes + current.estimatedMinutes,
    criticalChecks: [...previous.criticalChecks, ...current.criticalChecks],
    antiError: previous.antiError ?? current.antiError,
  };
  const steps = [...doc.steps.slice(0, index - 1), merged, ...doc.steps.slice(index + 1)];
  return recomputeSteps({ ...doc, steps });
}

/** Splits one part off into a new step that follows the original one. */
export function splitPartToStep(doc: IkGuideDocument, stepId: string, partId: string): IkGuideDocument {
  const index = doc.steps.findIndex((step) => step.id === stepId);
  if (index < 0) {
    return doc;
  }
  const step = doc.steps[index]!;
  const active = step.activePartIds ?? [];
  if (!active.includes(partId) || active.length < 2) {
    return doc;
  }
  const displayName = doc.assembly3d?.parts.find((part) => part.id === partId)?.displayName ?? 'деталь';
  const rest = active.filter((id) => id !== partId);
  const split: GuideStep = {
    id: `${step.id}-split-${partId}`,
    number: step.number + 1,
    title: `Установи ${displayName}`,
    workerText: `Установите ${displayName} на место по схеме и проверьте, что деталь села без перекоса.`,
    estimatedMinutes: Math.max(1, Math.round(step.estimatedMinutes / 2)),
    illustration: step.illustration,
    criticalChecks: [],
    antiError: null,
    drawingRefs: [],
    activePartIds: [partId],
    installedPartIds: [],
    cameraView: step.cameraView,
    svgDiagram: step.svgDiagram,
  };
  const steps = [
    ...doc.steps.slice(0, index),
    { ...step, activePartIds: rest, title: step.title },
    split,
    ...doc.steps.slice(index + 1),
  ];
  return recomputeSteps({ ...doc, steps });
}

export function canMergeWithPrevious(doc: IkGuideDocument, stepId: string): boolean {
  const index = doc.steps.findIndex((step) => step.id === stepId);
  return index > 0 && (doc.steps[index]?.activePartIds ?? []).length > 0;
}

export function canSplitStep(doc: IkGuideDocument, stepId: string): boolean {
  const step = doc.steps.find((item) => item.id === stepId);
  return (step?.activePartIds ?? []).length > 1;
}
