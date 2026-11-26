import {
  ikGuideDocumentSchema,
  type Assembly3d,
  type AssemblyPart,
  type BomIcon,
  type BomItem,
  type CriticalCheck,
  type GuideStep,
  type GuideTool,
  type IkGuideDocument,
  type QcItem,
} from '@ikguide/schema';
import { GuideBuildError } from './document';
import { mm, shortHash, slugify } from './format';
import type {
  CadBuildOptions,
  CadBuildResult,
  CadChangeSummary,
  CadImportResponse,
  CadMergeOptions,
  CadMergeResult,
  CadPartPayload,
  CadStepPayload,
} from './types';

const PLACEHOLDER_MATERIAL = 'Материал уточнить по спецификации';

/** Metric coarse thread: wrench across flats (mm) and a sane tightening torque (N·m). */
const FASTENER_TABLE: Readonly<Record<number, { key: number; torque: number }>> = {
  5: { key: 8, torque: 4 },
  6: { key: 10, torque: 8 },
  8: { key: 13, torque: 20 },
  10: { key: 17, torque: 40 },
  12: { key: 19, torque: 70 },
  14: { key: 22, torque: 110 },
  16: { key: 24, torque: 160 },
};

const SHAFT_HINT = /(вал|ось|шпиндел|shaft|spindle|axle)/i;
const BEARING_HINT = /(подшипник|bearing)/i;
const SEAL_HINT = /(сальник|манжет|уплотнен|seal|gasket)/i;
const WASHER_HINT = /(шайб|washer)/i;
const NUT_HINT = /(гайк|nut)/i;
const SCREW_HINT = /(винт|саморез|screw)/i;
const BOLT_HINT = /(болт|шпильк|bolt|stud)/i;

function metricSize(part: CadPartPayload): number | null {
  const source = `${part.notation ?? ''} ${part.displayName ?? part.name ?? ''}`;
  const match = /[МM]\s?(\d{1,2})/.exec(source);
  if (!match) {
    return null;
  }
  const size = Number.parseInt(match[1]!, 10);
  return Number.isFinite(size) ? size : null;
}

function fastenerSpec(part: CadPartPayload): { key: number; torque: number; label: string } | null {
  if (part.role !== 'fastener') {
    return null;
  }
  const size = metricSize(part);
  if (size === null) {
    return null;
  }
  const row = FASTENER_TABLE[size];
  if (!row) {
    return { key: Math.round(size * 1.8), torque: Math.round(size * 1.35), label: `М${size}` };
  }
  return { ...row, label: `М${size}` };
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function sentenceCase(value: string): string {
  return value.length > 0 ? value[0]!.toLowerCase() + value.slice(1) : value;
}

function accusative(name: string): string {
  const [head, ...rest] = name.split(' ');
  if (!head) {
    return name;
  }
  const tail = rest.length > 0 ? ` ${rest.join(' ')}` : '';
  const lower = head.toLowerCase();
  const exceptions: Record<string, string> = {
    крышка: 'крышку',
    планка: 'планку',
    втулка: 'втулку',
    пружина: 'пружину',
    плита: 'плиту',
    пластина: 'пластину',
    прокладка: 'прокладку',
    муфта: 'муфту',
  };
  let replacement = exceptions[lower] ?? head;
  if (!exceptions[lower] && lower.endsWith('а')) {
    replacement = `${head.slice(0, -1)}у`;
  } else if (!exceptions[lower] && lower.endsWith('я')) {
    replacement = `${head.slice(0, -1)}ю`;
  }
  if (head[0] === head[0]?.toUpperCase()) {
    replacement = capitalize(replacement);
  }
  return `${replacement}${tail}`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function displayNameOf(part: CadPartPayload): string {
  return (part.displayName ?? part.name ?? 'Деталь').trim();
}

function bomIcon(part: CadPartPayload): BomIcon {
  const name = displayNameOf(part);
  if (WASHER_HINT.test(name)) {
    return 'washer';
  }
  if (NUT_HINT.test(name)) {
    return 'nut';
  }
  if (SCREW_HINT.test(name)) {
    return 'screw';
  }
  if (BOLT_HINT.test(name)) {
    return 'bolt';
  }
  if (BEARING_HINT.test(name)) {
    return 'bearing';
  }
  if (SEAL_HINT.test(name)) {
    return 'seal';
  }
  if (/кронштейн|bracket/i.test(name)) {
    return 'bracket';
  }
  return 'plate';
}

function bomKind(part: CadPartPayload): BomItem['kind'] {
  if (part.role === 'fastener') {
    return 'fastener';
  }
  const name = displayNameOf(part);
  if (BEARING_HINT.test(name)) {
    return 'bearing';
  }
  if (SEAL_HINT.test(name)) {
    return 'seal';
  }
  return 'raw';
}

function partSize(part: CadPartPayload): string {
  if (part.notation) {
    return part.notation;
  }
  const size = part.bbox?.size;
  if (!size) {
    return 'по модели';
  }
  return `${mm(size[0])} × ${mm(size[1])} × ${mm(size[2])} мм`;
}

function buildBom(response: CadImportResponse): BomItem[] {
  const groups = new Map<string, { part: CadPartPayload; count: number }>();
  for (const part of response.parts) {
    const key = `${part.groupKey || part.nodeName}|${part.notation ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { part, count: 1 });
    }
  }
  const items: BomItem[] = [];
  let index = 0;
  for (const { part, count } of groups.values()) {
    index += 1;
    items.push({
      id: `bom-cad-${index}`,
      name: displayNameOf(part),
      size: partSize(part),
      quantity: count,
      kind: bomKind(part),
      icon: bomIcon(part),
      note: part.role === 'fastener' ? 'Крепёж: затягивайте крест-накрест' : undefined,
    });
  }
  return items;
}

function buildTools(response: CadImportResponse, steps: readonly CadStepPayload[]): GuideTool[] {
  const tools: GuideTool[] = [];
  const used = new Set<string>();
  const push = (tool: GuideTool) => {
    if (used.has(tool.id)) {
      return;
    }
    used.add(tool.id);
    tools.push(tool);
  };

  const stepsFor = (predicate: (step: CadStepPayload) => boolean): number[] =>
    steps.filter(predicate).map((step) => step.number);

  for (const part of response.parts) {
    const spec = fastenerSpec(part);
    if (!spec) {
      continue;
    }
    const stepsWithFastener = stepsFor((step) => step.partIds.includes(part.id));
    push({
      id: `tool-key-${spec.key}`,
      name: `Ключ ${spec.key} мм`,
      size: `${spec.key} мм`,
      category: 'wrench',
      purpose: `Крепёж ${spec.label}: затяжка без срыва граней.`,
      forSteps: stepsWithFastener,
    });
    push({
      id: 'tool-torque-wrench',
      name: 'Динамометрический ключ',
      size: '2–24 Н·м',
      category: 'wrench',
      purpose: `Затяжка ${spec.label} с моментом ${spec.torque} ± ${Math.max(1, Math.round(spec.torque * 0.1))} Н·м.`,
      forSteps: stepsWithFastener,
    });
  }

  push({
    id: 'tool-caliper',
    name: 'Штангенциркуль',
    size: '0–150 мм',
    category: 'caliper',
    purpose: 'Проверить зазоры и посадку деталей до затяжки.',
    forSteps: stepsFor((step) => step.kind !== 'fastener').slice(0, 3),
  });

  if (response.parts.some((part) => !/шайб|washer/i.test(displayNameOf(part)) && part.role !== 'fastener')) {
    push({
      id: 'tool-mallet',
      name: 'Киянка',
      size: 'мягкая',
      category: 'other',
      purpose: 'Осадить деталь на место без задиров, если она идёт туго.',
      forSteps: stepsFor((step) => step.kind === 'part' || step.kind === 'cover'),
    });
  }

  if (tools.length === 0) {
    push({
      id: 'tool-hands',
      name: 'Сборочный верстак',
      category: 'other',
      purpose: 'Ровная чистая поверхность для сборки.',
      forSteps: steps.slice(0, 2).map((step) => step.number),
    });
  }
  return tools;
}

function torqueFor(activeParts: readonly CadPartPayload[]): { torque: number; label: string } | null {
  const specs = activeParts
    .map((part) => fastenerSpec(part))
    .filter((spec): spec is { key: number; torque: number; label: string } => spec !== null);
  if (specs.length === 0) {
    return null;
  }
  const strongest = specs.reduce((best, item) => (item.torque > best.torque ? item : best), specs[0]!);
  return { torque: strongest.torque, label: strongest.label };
}

function workerTextFor(
  step: CadStepPayload,
  activeParts: readonly CadPartPayload[],
  installedParts: readonly CadPartPayload[],
): string {
  const names = activeParts.map(displayNameOf);

  if (step.kind === 'base') {
    const first = names[0] ?? 'основание';
    return `Уложите ${sentenceCase(accusative(first))} на ровную чистую поверхность. Протрите посадочные места от стружки и проверьте, что отверстия совпадают с моделью.`;
  }

  if (step.kind === 'fastener') {
    const torque = torqueFor(activeParts);
    const moment = torque ? ` с моментом ${torque.torque} Н·м` : '';
    const count = activeParts.length;
    const head = count > 1 ? `Наживите ${count} ${sentenceCase(names[0] ?? 'крепления')} от руки` : `Наживите ${sentenceCase(names[0] ?? 'крепление')} от руки`;
    return `${head}. Затягивайте крест-накрест в два прохода${moment}: сначала 30 % момента, затем полный. ${step.attention ?? 'Не перетяните: резьбу легко сорвать.'}`;
  }

  const base = installedParts.find((part) => part.role === 'base');
  const baseName = base ? sentenceCase(displayNameOf(base)) : 'основание';
  const first = names[0] ?? 'деталь';
  const target = baseName ? ` на ${accusative(baseName)}` : '';
  const verb = step.kind === 'cover' ? 'Опустите' : 'Установите';
  return `${verb} ${sentenceCase(accusative(first))}${target} по стрелке на схеме. Деталь должна сесть без перекоса; зазор по контуру — не больше 0,2 мм. ${step.attention ?? ''}`.trim();
}

function minutesFor(step: CadStepPayload): number {
  if (step.kind === 'base') {
    return 2;
  }
  if (step.kind === 'fastener') {
    return Math.round((1 + activeCountGuess(step)) * 10) / 10;
  }
  return 1.5;
}

function activeCountGuess(step: CadStepPayload): number {
  return Math.max(1, step.count ?? step.partIds.length);
}

function criticalChecksFor(
  step: CadStepPayload,
  activeParts: readonly CadPartPayload[],
): CriticalCheck[] {
  if (step.kind === 'fastener') {
    const torque = torqueFor(activeParts);
    if (!torque) {
      return [];
    }
    return [
      {
        id: `check-torque-${step.number}`,
        label: 'Момент затяжки',
        nominal: `${torque.torque} Н·м`,
        acceptance: `±${Math.max(1, Math.round(torque.torque * 0.1))} Н·м, все крепления одинаково`,
        instrument: 'Динамометрический ключ',
      },
    ];
  }
  if (step.kind === 'cover' || step.kind === 'part') {
    return [
      {
        id: `check-gap-${step.number}`,
        label: 'Зазор по контуру',
        nominal: '≤ 0,2 мм',
        acceptance: 'без перекоса, щуп 0,2 мм не проходит',
        instrument: 'Набор щупов',
      },
    ];
  }
  return [
    {
      id: `check-seat-${step.number}`,
      label: 'Посадочная поверхность',
      nominal: 'чистая, без стружки',
      acceptance: 'деталь лежит без качания',
      instrument: 'Визуальный контроль',
    },
  ];
}

function antiErrorFor(step: CadStepPayload, activeParts: readonly CadPartPayload[]): GuideStep['antiError'] {
  if (step.attention) {
    return { text: step.attention, severity: 'warning' };
  }
  if (step.kind === 'fastener' && activeParts.length > 1) {
    return {
      text: 'Не затягивайте крепёж по кругу: перекосит крышку. Только крест-накрест, в два прохода.',
      severity: 'warning',
    };
  }
  return null;
}

function qcFor(response: CadImportResponse): QcItem[] {
  const items: QcItem[] = [];
  const fasteners = response.parts.filter((part) => part.role === 'fastener');
  const torques = [
    ...new Set(
      fasteners
        .map((part) => fastenerSpec(part)?.torque)
        .filter((value): value is number => typeof value === 'number'),
    ),
  ];
  if (fasteners.length > 0) {
    items.push({
      id: 'qc-torque',
      text:
        torques.length > 0
          ? `Все крепления затянуты: ${torques.map((value) => `${value} Н·м`).join(', ')} (проверить выборочно динамометрическим ключом).`
          : 'Все крепления затянуты, стопорные элементы установлены.',
      required: true,
      reference: 'Спецификация крепежа',
    });
  }
  if (response.parts.some((part) => SHAFT_HINT.test(displayNameOf(part)))) {
    items.push({
      id: 'qc-rotation',
      text: 'Вал вращается от руки без заеданий и люфта больше 0,1 мм.',
      required: true,
      reference: 'Вал',
    });
  }
  items.push({
    id: 'qc-complete',
    text: `Узел собран по схеме: все ${response.stats?.parts ?? response.parts.length} деталей на своих местах, лишних нет.`,
    required: true,
    reference: '3D-модель',
  });
  return items;
}

function assemblyBlock(
  response: CadImportResponse,
  steps: readonly GuideStep[],
): Assembly3d {
  const stepByPart = new Map<string, number>();
  steps.forEach((step) => {
    (step.activePartIds ?? []).forEach((partId) => stepByPart.set(partId, step.number));
  });

  const parts: AssemblyPart[] = response.parts.map((part) => ({
    id: part.id,
    nodeName: part.nodeName,
    displayName: displayNameOf(part),
    role: part.role,
    stepNumber: stepByPart.get(part.id) ?? 1,
    explosionVector: part.explosionVector,
    volumeMm3: part.volumeMm3 > 0 ? part.volumeMm3 : undefined,
    bboxMm: part.bbox?.size
      ? {
          x: Math.max(0.01, part.bbox.size[0]),
          y: Math.max(0.01, part.bbox.size[1]),
          z: Math.max(0.01, part.bbox.size[2]),
        }
      : undefined,
    centerMm: part.centroid
      ? {
          x: round3(part.centroid[0]),
          y: round3(part.centroid[1]),
          z: round3(part.centroid[2]),
        }
      : undefined,
    notation: part.notation ?? undefined,
  }));

  return {
    glbDataUrl: response.glbDataUrl,
    sourceFormat: (response.assembly?.sourceFormat ?? 'glb') as Assembly3d['sourceFormat'],
    units: 'mm',
    sizeMm: {
      x: Math.max(0.01, response.assembly?.sizeMm?.[0] ?? 1),
      y: Math.max(0.01, response.assembly?.sizeMm?.[1] ?? 1),
      z: Math.max(0.01, response.assembly?.sizeMm?.[2] ?? 1),
    },
    massKg: response.assembly?.massKg && response.assembly.massKg > 0 ? response.assembly.massKg : undefined,
    sessionId: response.sessionId,
    generator: 'ikguide-cad-api',
    revision: 'A',
    parts,
  };
}

export function buildGuideFromCad(
  response: CadImportResponse,
  options: CadBuildOptions = {},
): CadBuildResult {
  const warnings: string[] = [...(response.warnings ?? [])];
  if (!response.parts || response.parts.length === 0) {
    throw new GuideBuildError(['В модели нет ни одной детали — проверьте файл.']);
  }
  if (!response.steps || response.steps.length === 0) {
    throw new GuideBuildError(['Не удалось построить порядок сборки — проверьте геометрию модели.']);
  }

  const byId = new Map(response.parts.map((part) => [part.id, part]));
  const assemblyName = response.assembly?.name?.trim() || 'Сборка';
  const size = response.assembly?.sizeMm ?? [0, 0, 0];
  const createdAt = options.createdAt ?? new Date().toISOString();
  const drawingCode =
    options.drawingCode?.trim() ||
    `3D-${slugify(assemblyName).toUpperCase().slice(0, 20)}-${shortHash(`${assemblyName}|${response.parts.length}`)}`;
  if (!options.drawingCode) {
    warnings.push('Шифр сборки не задан: подставлен автоматический, уточните его в спецификации.');
  }
  const material = options.material?.trim() || PLACEHOLDER_MATERIAL;
  if (!options.material) {
    warnings.push('Материал не задан: укажите его по спецификации перед выдачей в цех.');
  }

  const partCount = response.parts.length;
  const difficulty =
    options.difficulty ?? (partCount <= 3 ? 'easy' : partCount <= 8 ? 'medium' : partCount <= 20 ? 'hard' : 'expert');

  let installedSoFar: string[] = [];
  const steps: GuideStep[] = response.steps.map((cadStep, index) => {
    const activeParts = cadStep.partIds.map((id) => byId.get(id)).filter((part): part is CadPartPayload => Boolean(part));
    const installedIds = index === 0 ? [] : [...installedSoFar];
    const installedParts = installedIds.map((id) => byId.get(id)).filter((part): part is CadPartPayload => Boolean(part));
    installedSoFar = [...installedSoFar, ...cadStep.partIds];

    return {
      id: `step-cad-${cadStep.number}`,
      number: cadStep.number,
      title: capitalize(cadStep.title || `Шаг ${cadStep.number}`),
      workerText: workerTextFor(cadStep, activeParts, installedParts),
      estimatedMinutes: minutesFor(cadStep),
      illustration: { illustrationId: 'cad-assembly', highlight: [], arrows: [] },
      antiError: antiErrorFor(cadStep, activeParts),
      criticalChecks: criticalChecksFor(cadStep, activeParts),
      drawingRefs: [],
      activePartIds: cadStep.partIds,
      installedPartIds: installedIds,
      cameraView: { azimuth: cadStep.azimuth, elevation: cadStep.elevation },
      svgDiagram: cadStep.svg?.trimStart().startsWith('<svg') ? cadStep.svg : undefined,
    };
  });

  const document: IkGuideDocument = {
    schemaVersion: '1.0',
    id: options.id ?? `guide-3d-${slugify(drawingCode)}-${shortHash(`${drawingCode}|${createdAt}|${partCount}`)}`,
    metadata: {
      title: options.title?.trim() || assemblyName,
      drawingCode,
      assemblyUnit: options.assemblyUnit ?? assemblyName,
      material,
      blankDimensions: `${mm(size[0])} × ${mm(size[1])} × ${mm(size[2])} мм`,
      massKg: response.assembly?.massKg && response.assembly.massKg > 0 ? Number(response.assembly.massKg.toFixed(3)) : undefined,
      difficulty,
      author: options.author?.trim() || 'Инженер-технолог',
      createdAt,
      revision: options.revision?.trim() || 'A',
    },
    drawing: {
      viewId: 'cad-assembly',
      sheetFormat: options.sheetFormat ?? 'A4',
      scale: '1:1',
    },
    bom: buildBom(response),
    tools: buildTools(response, response.steps),
    steps,
    xrayAnnotations: [],
    qcChecklist: qcFor(response),
    assembly3d: assemblyBlock(response, steps),
  };

  const parsed = ikGuideDocumentSchema.safeParse(document);
  if (!parsed.success) {
    throw new GuideBuildError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }

  const uncertain = 0;
  return {
    document: parsed.data,
    warnings,
    stats: {
      parts: parsed.data.assembly3d?.parts.length ?? 0,
      fasteners: response.parts.filter((part) => part.role === 'fastener').length,
      steps: parsed.data.steps.length,
      tools: parsed.data.tools.length,
      bom: parsed.data.bom.length,
      uncertain,
      triangleCount: response.stats?.triangles ?? 0,
    },
  };
}

function bumpRevision(revision: string | undefined): string {
  if (!revision) {
    return 'B';
  }
  const trimmed = revision.trim();
  if (/^[A-Za-z]$/.test(trimmed)) {
    return String.fromCharCode(trimmed.charCodeAt(0) + 1);
  }
  const numeric = Number.parseInt(trimmed, 10);
  if (Number.isFinite(numeric)) {
    return String(numeric + 1);
  }
  return `${trimmed}.1`;
}

function stepActiveNodes(
  step: GuideStep,
  parts: readonly AssemblyPart[],
): string[] {
  const nodeById = new Map(parts.map((part) => [part.id, part.nodeName]));
  return (step.activePartIds ?? [])
    .map((id) => nodeById.get(id) ?? id)
    .filter((value): value is string => Boolean(value))
    .sort();
}

/**
 * «Одно обновление = новая инструкция»: matches parts by node name, rebuilds the guide from the new
 * model and keeps everything the engineer edited by hand — step texts, anti-errors, camera views
 * and QC items — for the steps whose parts survived.
 */
export function mergeCadUpdate(
  previous: IkGuideDocument,
  response: CadImportResponse,
  options: CadMergeOptions = {},
): CadMergeResult {
  const previousParts = previous.assembly3d?.parts ?? [];
  const built = buildGuideFromCad(response, {
    title: options.title ?? previous.metadata.title,
    drawingCode: options.drawingCode ?? previous.metadata.drawingCode,
    material: options.material ?? (previous.metadata.material === PLACEHOLDER_MATERIAL ? undefined : previous.metadata.material),
    author: options.author ?? previous.metadata.author,
    revision: options.revision ?? bumpRevision(previous.metadata.revision),
    createdAt: options.createdAt ?? new Date().toISOString(),
    difficulty: options.difficulty ?? previous.metadata.difficulty,
    sheetFormat: options.sheetFormat ?? previous.drawing.sheetFormat,
    assemblyUnit: previous.metadata.assemblyUnit,
    id: options.id ?? previous.id,
  });

  const document = built.document;
  const nextParts = document.assembly3d?.parts ?? [];
  const nextByNode = new Map(nextParts.map((part) => [part.nodeName, part]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const keptEdits: number[] = [];

  for (const part of nextParts) {
    const before = previousParts.find((item) => item.nodeName === part.nodeName);
    if (!before) {
      added.push(part.displayName);
      continue;
    }
    const volumeDelta =
      before.volumeMm3 && part.volumeMm3 ? Math.abs(part.volumeMm3 - before.volumeMm3) / Math.max(before.volumeMm3, 1) : 0;
    if (volumeDelta > 0.02 || before.role !== part.role || before.stepNumber !== part.stepNumber) {
      changed.push(part.displayName);
    }
  }
  for (const part of previousParts) {
    if (!nextByNode.has(part.nodeName)) {
      removed.push(part.displayName);
    }
  }

  // Match steps by the set of part node names; fall back to the step number when unambiguous.
  const usedPrevious = new Set<string>();
  const preservedSteps = document.steps.map((step) => {
    const nodes = stepActiveNodes(step, nextParts);
    const exact =
      nodes.length > 0
        ? previous.steps.find(
            (candidate) =>
              !usedPrevious.has(candidate.id) &&
              (candidate.activePartIds ?? []).length > 0 &&
              stepActiveNodes(candidate, previousParts).join('|') === nodes.join('|'),
          )
        : undefined;
    // Number matching is only a fallback for steps that have no 3D parts (old 2D pages).
    const byNumber =
      exact ??
      (nodes.length === 0 || previousParts.length === 0
        ? previous.steps.find((candidate) => candidate.number === step.number && !usedPrevious.has(candidate.id))
        : undefined);
    if (!byNumber) {
      return step;
    }
    usedPrevious.add(byNumber.id);

    // Any difference from the freshly generated step is a human edit and wins over the model.
    const titleEdited = byNumber.title !== step.title;
    const textEdited = byNumber.workerText !== step.workerText;
    const checksEdited = JSON.stringify(byNumber.criticalChecks) !== JSON.stringify(step.criticalChecks);
    const antiErrorEdited = JSON.stringify(byNumber.antiError ?? null) !== JSON.stringify(step.antiError ?? null);
    const cameraEdited = JSON.stringify(byNumber.cameraView ?? null) !== JSON.stringify(step.cameraView ?? null);
    if (titleEdited || textEdited || checksEdited || antiErrorEdited || cameraEdited) {
      keptEdits.push(step.number);
    }

    return {
      ...step,
      title: titleEdited ? byNumber.title : step.title,
      workerText: textEdited ? byNumber.workerText : step.workerText,
      estimatedMinutes: byNumber.estimatedMinutes || step.estimatedMinutes,
      antiError: antiErrorEdited ? byNumber.antiError : step.antiError,
      criticalChecks: checksEdited ? byNumber.criticalChecks : step.criticalChecks,
      cameraView: cameraEdited ? byNumber.cameraView : step.cameraView,
      drawingRefs: byNumber.drawingRefs.filter((ref) =>
        previous.xrayAnnotations.some((annotation) => annotation.id === ref),
      ),
    };
  });

  // QC: keep the engineer's own items (and their edits), then add what the new model requires.
  const manualQc = previous.qcChecklist.filter(
    (item) => !document.qcChecklist.some((fresh) => fresh.id === item.id) && !document.qcChecklist.some((fresh) => fresh.text === item.text),
  );
  const qcChecklist = [...document.qcChecklist, ...manualQc];

  const merged: IkGuideDocument = {
    ...document,
    steps: preservedSteps,
    qcChecklist,
  };

  const parsed = ikGuideDocumentSchema.safeParse(merged);
  if (!parsed.success) {
    throw new GuideBuildError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }

  const changes: CadChangeSummary = {
    added,
    removed,
    changed,
    keptEdits,
    partsBefore: previousParts.length,
    partsAfter: parsed.data.assembly3d?.parts.length ?? 0,
    stepsBefore: previous.steps.length,
    stepsAfter: parsed.data.steps.length,
  };

  const summary = [
    `+${added.length}`,
    `−${removed.length}`,
    `${changed.length} изм.`,
    keptEdits.length > 0 ? `правки сохранены в ${keptEdits.length} шаг.` : 'ручных правок не было',
  ].join(', ');

  const warnings = [...built.warnings];
  if (removed.length > 0) {
    warnings.push(`Из модели убраны детали: ${removed.join(', ')}. Проверьте шаги, где они упоминались.`);
  }
  if (added.length > 0) {
    warnings.push(`В модели новые детали: ${added.join(', ')}.`);
  }
  return { document: parsed.data, changes, warnings, summary };
}

