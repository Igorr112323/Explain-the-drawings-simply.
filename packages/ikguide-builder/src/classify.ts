import type { AnnotationKind } from '@ikguide/schema';
import type { TranslationResult } from '@ikguide/gost-translator';

/**
 * Five production stages of any metal part. The order is fixed: preparation → markup → holes →
 * finishing → control. A stage without content is dropped, but the order never changes.
 */
export type StageId = 'preparation' | 'markup' | 'holes' | 'finishing' | 'control';

export interface StageMeta {
  readonly id: StageId;
  readonly title: string;
  readonly baseMinutes: number;
  readonly minutesPerItem: number;
  /** Shape id of `generic-step` art that this stage highlights. */
  readonly shapeId: 'plate' | 'hole';
}

export const STAGES: readonly StageMeta[] = [
  {
    id: 'preparation',
    title: 'Подготовка заготовки и проверка чертежа',
    baseMinutes: 8,
    minutesPerItem: 0,
    shapeId: 'plate',
  },
  {
    id: 'markup',
    title: 'Разметка и базовые размеры',
    baseMinutes: 10,
    minutesPerItem: 4,
    shapeId: 'plate',
  },
  {
    id: 'holes',
    title: 'Отверстия, зенковка и резьба',
    baseMinutes: 12,
    minutesPerItem: 6,
    shapeId: 'hole',
  },
  {
    id: 'finishing',
    title: 'Чистовая обработка, фаски и сварка',
    baseMinutes: 15,
    minutesPerItem: 7,
    shapeId: 'plate',
  },
  {
    id: 'control',
    title: 'Финальный контроль допусков и шероховатости',
    baseMinutes: 12,
    minutesPerItem: 0,
    shapeId: 'plate',
  },
];

export function stageMeta(id: StageId): StageMeta {
  const found = STAGES.find((stage) => stage.id === id);
  if (!found) {
    throw new Error(`Unknown production stage: ${id}`);
  }
  return found;
}

/** Which stage performs the work described by a GOST notation. */
export function stageForKind(kind: TranslationResult['kind']): StageId | null {
  switch (kind) {
    case 'thread':
    case 'holeGroup':
      return 'holes';
    case 'fit':
    case 'roughness':
    case 'weld':
    case 'chamfer':
      return 'finishing';
    case 'radius':
    case 'dimension':
      return 'markup';
    case 'unknown':
      return null;
    default:
      return null;
  }
}

/** Annotation kind stored in the `.ikguide` document for the «Рентген» screen. */
export function annotationKindFor(result: TranslationResult): AnnotationKind {
  switch (result.kind) {
    case 'thread':
      return 'thread';
    case 'fit':
      return 'fit';
    case 'roughness':
      return 'roughness';
    case 'weld':
      return 'weld';
    case 'chamfer':
      return 'chamfer';
    case 'radius':
      return 'radius';
    case 'holeGroup':
      return 'holeGroup';
    case 'dimension':
      return 'dimension';
    default:
      return 'other';
  }
}
