import type { GuideTool, ToolCategory } from '@ikguide/schema';
import type { RecommendedTool, TranslationKind } from '@ikguide/gost-translator';
import type { StageId } from './classify';
import { slugify } from './format';

export interface ToolDraft {
  name: string;
  category: ToolCategory;
  purposes: string[];
  stages: StageId[];
}

interface ToolPolicy {
  categories: readonly ToolCategory[];
  max: number;
}

/**
 * A notation comes with every auxiliary the translator can think of. The worker needs the working
 * tools, not a catalogue: М8 → drill + tap + thread gauge; Ø20 H7 → reamer + plug gauge.
 * Dropped tools are still listed inside the notation card in «Рентгене».
 */
const TOOL_POLICY: Readonly<Record<TranslationKind, ToolPolicy>> = {
  thread: { categories: ['drill', 'tap', 'die', 'gauge', 'micrometer'], max: 3 },
  fit: { categories: ['reamer', 'gauge', 'micrometer', 'drill', 'press'], max: 3 },
  holeGroup: { categories: ['drill', 'deburr', 'caliper'], max: 3 },
  roughness: { categories: ['other', 'gauge', 'consumable'], max: 2 },
  weld: { categories: ['welding', 'gauge', 'consumable'], max: 3 },
  chamfer: { categories: ['deburr', 'caliper'], max: 2 },
  radius: { categories: ['other', 'gauge'], max: 2 },
  dimension: { categories: ['caliper', 'micrometer'], max: 1 },
  unknown: { categories: [], max: 0 },
};

export function selectTools(kind: TranslationKind, tools: readonly RecommendedTool[]): RecommendedTool[] {
  const policy = TOOL_POLICY[kind];
  if (!policy || policy.max === 0) {
    return [];
  }
  const filtered = tools.filter((tool) => policy.categories.includes(tool.category));
  return filtered.slice(0, policy.max);
}

/** Tools that are used for the final measurement as well as for the machining itself. */
const MEASURING_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>(['gauge', 'micrometer', 'caliper']);

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toolDraft(tool: RecommendedTool, stage: StageId): ToolDraft {
  return {
    name: tool.name.trim(),
    category: tool.category,
    purposes: [tool.purpose.trim()],
    stages: [stage],
  };
}

/**
 * М8 and «4 отв. М8-7H» both ask for the same tap — the worker takes one tool, not two.
 * Deduplication is by normalised name; purposes are merged so nothing is lost.
 */
export function mergeToolDrafts(drafts: readonly ToolDraft[]): ToolDraft[] {
  const byKey = new Map<string, ToolDraft>();

  drafts.forEach((draft) => {
    if (draft.name.length === 0) {
      return;
    }
    const key = normalizeName(draft.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: draft.name,
        category: draft.category,
        purposes: [...new Set(draft.purposes.filter((purpose) => purpose.length > 0))],
        stages: [...new Set(draft.stages)],
      });
      return;
    }
    draft.purposes.forEach((purpose) => {
      if (purpose.length > 0 && !existing.purposes.includes(purpose)) {
        existing.purposes.push(purpose);
      }
    });
    draft.stages.forEach((stage) => {
      if (!existing.stages.includes(stage)) {
        existing.stages.push(stage);
      }
    });
  });

  return [...byKey.values()];
}

/** Converts drafts into schema tools, wiring `forSteps` to the final step numbers. */
export function toGuideTools(
  drafts: readonly ToolDraft[],
  stepNumberByStage: ReadonlyMap<StageId, number>,
  controlStageNumber: number,
): GuideTool[] {
  const usedIds = new Set<string>();

  return drafts.map((draft, index) => {
    const stages = new Set<StageId>(draft.stages);
    if (MEASURING_CATEGORIES.has(draft.category) && controlStageNumber > 0) {
      stages.add('control');
    }

    const forSteps = [...stages]
      .map((stage) => stepNumberByStage.get(stage))
      .filter((number): number is number => typeof number === 'number' && number > 0)
      .sort((a, b) => a - b);

    let id = `tool-${slugify(draft.name).slice(0, 28) || draft.category}`;
    if (usedIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    usedIds.add(id);

    return {
      id,
      name: draft.name,
      category: draft.category,
      purpose: draft.purposes.join('; ') || 'Работа по чертежу',
      forSteps: forSteps.length > 0 ? forSteps : [1],
    };
  });
}
