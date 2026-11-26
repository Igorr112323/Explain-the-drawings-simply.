import {
  CONFIDENCE_THRESHOLD,
  ikGuideDocumentSchema,
  type BomItem,
  type CriticalCheck,
  type Difficulty,
  type GuideStep,
  type Highlight,
  type IkGuideMetadata,
  type QcItem,
  type XrayAnnotation,
} from '@ikguide/schema';
import { translateEngineeringNotation, type TranslationResult } from '@ikguide/gost-translator';
import { annotationKindFor, STAGES, stageForKind, type StageId } from './classify';
import { mm, percent, shortHash, slugify } from './format';
import { criticalCheckFor, qcForTranslation, type QcDraft } from './qc';
import { mergeToolDrafts, selectTools, toGuideTools, toolDraft, type ToolDraft } from './tools';
import type {
  AnnotationTranslation,
  BuildOptions,
  BuildResult,
  BuildStats,
  ManualNotation,
  SkippedCandidate,
  VisionCandidate,
  VisionRecognizeResponse,
  VisionRegion,
  VisionTitleBlock,
} from './types';

const MAX_ANNOTATIONS_DEFAULT = 48;
const MAX_HIGHLIGHTS = 3;
const MAX_CRITICAL_CHECKS = 3;

const PLACEHOLDER_CODE = 'Шифр уточняется';
const PLACEHOLDER_MATERIAL = 'Материал уточнить по штампу';
const PLACEHOLDER_BLANK = 'Габарит заготовки уточнить у инженера';

export class GuideBuildError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Черновик инструкции не прошёл проверку схемы:\n${issues.map((issue) => `• ${issue}`).join('\n')}`);
    this.name = 'GuideBuildError';
    this.issues = issues;
  }
}

interface SourceItem {
  id: string;
  displayText: string;
  xPercent: number;
  yPercent: number;
  confidence: number;
  confirmedByHuman: boolean;
  ambiguousOptions: string[];
  region: VisionRegion;
  pageIndex: number;
  note?: string;
}

interface StageEntry {
  item: SourceItem;
  annotationId: string;
  result: TranslationResult;
}

// Only notations, not prose: «Разраб. Иванов» must not become an annotation.
const NOTATION_HINT = /\d|[Ø∅]|Ra\s*\d|Rz\s*\d|[МM]\s*\d|отв|фаск|шов|свар/i;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function sourceFromCandidate(candidate: VisionCandidate): SourceItem {
  const options = candidate.ambiguousOptions.filter((option) => option.trim().length > 0).slice(0, 4);
  return {
    id: `ann-${candidate.id}`,
    displayText: candidate.normalizedText.trim(),
    xPercent: clampPercent(candidate.xPercent),
    yPercent: clampPercent(candidate.yPercent),
    confidence: Math.min(1, Math.max(0, candidate.confidence)),
    confirmedByHuman: false,
    ambiguousOptions: options.length >= 2 ? options : [],
    region: candidate.region,
    pageIndex: candidate.pageIndex,
  };
}

/** A text block that the translator does not understand, but a human should still see. */
function isUsefulUnknown(item: SourceItem): boolean {
  if (item.displayText.length > 100) {
    return false;
  }
  return NOTATION_HINT.test(item.displayText);
}

function buildMetadata(
  options: BuildOptions,
  stamp: VisionTitleBlock | null,
  entries: readonly StageEntry[],
  warnings: string[],
): IkGuideMetadata {
  const inferredCode = stamp?.code?.trim() ?? '';
  const drawingCode = options.drawingCode?.trim() || inferredCode || PLACEHOLDER_CODE;

  const title =
    options.title?.trim() ||
    stamp?.name?.trim() ||
    (inferredCode ? `Деталь по чертежу ${inferredCode}` : 'Деталь по чертежу');

  const material = options.material?.trim() || stamp?.material?.trim() || PLACEHOLDER_MATERIAL;
  const blankDimensions = options.blankDimensions?.trim() || inferBlankDimensions(entries) || PLACEHOLDER_BLANK;

  if (!inferredCode && !options.drawingCode) {
    warnings.push('Шифр чертежа не найден в штампе: заполните его вручную, иначе инструкцию нельзя выпустить в цех.');
  }
  if (!stamp?.material && !options.material) {
    warnings.push('Материал не распознан по штампу: уточните марку стали перед выдачей инструкции.');
  }
  if (!options.blankDimensions && blankDimensions === PLACEHOLDER_BLANK) {
    warnings.push('Габарит заготовки не определён: укажите размеры полосы или отливки вручную.');
  }

  const kinds = new Set(entries.map((entry) => entry.result.kind));
  const inferredDifficulty: Difficulty =
    (kinds.has('fit') && kinds.has('weld') && kinds.has('thread')) || (kinds.has('fit') && kinds.has('roughness') && kinds.has('weld'))
      ? 'expert'
      : kinds.has('fit') || kinds.has('weld') || kinds.size >= 2
        ? 'hard'
        : kinds.size === 1
          ? 'medium'
          : 'easy';

  const metadata: IkGuideMetadata = {
    title,
    drawingCode,
    material,
    blankDimensions,
    difficulty: options.difficulty ?? inferredDifficulty,
    author: options.author?.trim() || 'Инженер (автоподготовка по чертежу)',
    createdAt: options.createdAt ?? new Date().toISOString(),
    revision: options.revision?.trim() || '1',
  };

  if (options.assemblyUnit) {
    metadata.assemblyUnit = options.assemblyUnit;
  }

  const massKg = options.massKg ?? inferMass(stamp);
  if (massKg !== null && massKg > 0 && massKg < 5000) {
    metadata.massKg = massKg;
  }

  return metadata;
}

function inferBlankDimensions(entries: readonly StageEntry[]): string | null {
  const values = entries
    .filter((entry) => entry.result.kind === 'dimension')
    .map((entry) => (entry.result.kind === 'dimension' ? entry.result.nominalMm : 0))
    .filter((value) => value >= 1)
    .sort((a, b) => b - a);

  const unique = [...new Set(values.map((value) => Number(value.toFixed(2))))];
  if (unique.length >= 3) {
    return `${mm(unique[0])} × ${mm(unique[1])} × ${mm(unique[2])} мм (по наибольшим размерам)`;
  }
  if (unique.length === 2) {
    return `${mm(unique[0])} × ${mm(unique[1])} мм (по наибольшим размерам)`;
  }
  if (unique.length === 1) {
    return `${mm(unique[0])} мм (по наибольшему размеру)`;
  }
  return null;
}

function inferMass(stamp: VisionTitleBlock | null): number | null {
  if (!stamp) {
    return null;
  }
  for (const line of stamp.rawLines) {
    const match = /масса\s*([\d]+(?:[.,]\d+)?)\s*кг/i.exec(line);
    if (match?.[1]) {
      const value = Number(match[1].replace(',', '.'));
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }
  return null;
}

function buildBom(metadata: IkGuideMetadata, entries: readonly StageEntry[]): BomItem[] {
  const items: BomItem[] = [
    {
      id: 'bom-stock',
      name: 'Заготовка',
      size: `${metadata.blankDimensions}; ${metadata.material}`,
      quantity: 1,
      kind: 'raw',
      icon: 'plate',
      note: 'Припуск на обработку 2–3 мм на сторону, кромки без трещин',
    },
  ];

  if (entries.some((entry) => entry.result.kind === 'weld')) {
    items.push({
      id: 'bom-electrodes',
      name: 'Электроды сварочные',
      size: 'Ø3 мм, УОНИ-13/55',
      quantity: 1,
      kind: 'consumable',
      icon: 'cable',
      standard: 'ГОСТ 9467-75',
      note: 'Просушить по паспорту перед сваркой',
    });
  }

  return items;
}

function translationText(result: TranslationResult): string {
  if (result.kind === 'weld') {
    return `${result.explanation} ${result.welderInstruction}`;
  }
  return result.explanation;
}

function stageIntro(stage: StageId, metadata: IkGuideMetadata, stamp: VisionTitleBlock | null): string {
  switch (stage) {
    case 'preparation':
      return `Возьмите заготовку: ${metadata.blankDimensions}. Материал — ${metadata.material}. Сверьте штамп: ${metadata.drawingCode}, масштаб ${stamp?.scale ?? 'по чертежу'}. Проверьте плоскость и кромки: трещины, заусенцы и коробление больше 0,5 мм — не допускаются.`;
    case 'markup':
      return 'Выберите базу — длинную обработанную кромку — и откладывайте все размеры только от неё. После разметки проверьте каждый размер штангенциркулем, кернение — до сверления.';
    case 'holes':
      return 'Керните центры отверстий от базы и сверлите последовательно, от меньшего диаметра к большему. Охлаждайте инструмент и выводите стружку после каждого прохода.';
    case 'finishing':
      return 'Доведите поверхности и кромки, снимите фаски и выполните сварные швы в порядке, указанном на чертеже.';
    case 'control':
      return 'Предъявите деталь контролёру ОТК: проверьте размеры, резьбы, шероховатость и отсутствие заусенцев.';
    default:
      return '';
  }
}

function buildSteps(
  entriesByStage: ReadonlyMap<StageId, StageEntry[]>,
  qcDrafts: readonly QcDraft[],
  metadata: IkGuideMetadata,
  stamp: VisionTitleBlock | null,
  warnings: string[],
): { steps: GuideStep[]; stepNumberByStage: Map<StageId, number> } {
  const activeStages = STAGES.filter(
    (stage) => stage.id === 'preparation' || stage.id === 'control' || (entriesByStage.get(stage.id)?.length ?? 0) > 0,
  );

  const stepNumberByStage = new Map<StageId, number>();
  const steps: GuideStep[] = activeStages.map((stage, index) => {
    const number = index + 1;
    stepNumberByStage.set(stage.id, number);

    const group = entriesByStage.get(stage.id) ?? [];
    const parts: string[] = [stageIntro(stage.id, metadata, stamp)];

    if (stage.id === 'control') {
      parts.push(
        qcDrafts.length > 0
          ? `Чек-лист: ${qcDrafts.map((draft) => draft.text).join(' ')}`
          : 'Сверьте деталь с чертежом по всем размерам и шероховатости.',
      );
    } else {
      group.forEach((entry) => {
        parts.push(translationText(entry.result));
        if (entry.result.workerAdvice) {
          parts.push(entry.result.workerAdvice);
        }
      });
    }

    const uncertain = group.filter((entry) => entry.item.confidence < CONFIDENCE_THRESHOLD && !entry.item.confirmedByHuman);
    const highlights: Highlight[] = group.slice(0, MAX_HIGHLIGHTS).map((entry) => ({
      shapeId: stage.shapeId,
      label: entry.item.displayText,
      tone: entry.item.confidence < CONFIDENCE_THRESHOLD ? 'danger' : 'accent',
    }));

    if (highlights.length === 0) {
      highlights.push({
        shapeId: 'plate',
        label: stage.id === 'control' ? 'Готовая деталь на контроле' : 'Заготовка по чертежу',
        tone: stage.id === 'control' ? 'done' : 'accent',
      });
    }

    const firstWarning = group.find((entry) => entry.result.warnings.length > 0)?.result.warnings[0];

    let antiError: GuideStep['antiError'] = null;
    if (uncertain.length > 0) {
      const worst = uncertain.reduce((lowest, entry) => (entry.item.confidence < lowest.item.confidence ? entry : lowest));
      antiError = {
        text: `Обозначение «${worst.item.displayText}» распознано с уверенностью ${percent(worst.item.confidence)} %. Перед обработкой сверьте его с бумажным чертежом и подтвердите в «Рентгене».`,
        severity: 'critical',
      };
    } else if (stage.id === 'preparation' && (!stamp?.code || !stamp?.material)) {
      antiError = {
        text: 'Штамп прочитан не полностью: уточните шифр, материал и масштаб у инженера до начала работы.',
        severity: 'warning',
      };
      warnings.push('Штамп прочитан не полностью — часть данных заполнена заглушками.');
    } else if (stage.id === 'holes' && firstWarning) {
      antiError = { text: firstWarning, severity: 'warning' };
    }

    const criticalChecks: CriticalCheck[] = group
      .map((entry) => criticalCheckFor(entry.result, entry.annotationId))
      .filter((check): check is CriticalCheck => check !== null)
      .slice(0, MAX_CRITICAL_CHECKS);

    if (stage.id === 'control' && criticalChecks.length === 0) {
      criticalChecks.push({
        id: `check-${number}-visual`,
        label: 'Внешний вид и заусенцы',
        nominal: 'Поверхность по чертежу',
        acceptance: 'Заусенцы сняты, острые кромки притуплены, следов коррозии нет',
        instrument: 'Визуальный контроль, лупа 4×',
      });
    }

    const estimatedMinutes = Math.max(
      1,
      Math.min(600, Math.round(stage.baseMinutes + stage.minutesPerItem * group.length + (stage.id === 'control' ? qcDrafts.length : 0))),
    );

    const workerText = `${parts.filter((part) => part.trim().length > 0).join(' ')}`.replace(/\s{2,}/g, ' ').trim();

    return {
      id: `step-${number}`,
      number,
      title: stage.title,
      workerText: workerText.length >= 3 ? workerText : `${stage.title}: следуйте указаниям мастера.`,
      estimatedMinutes,
      illustration: { illustrationId: 'generic-step', highlight: highlights, arrows: [] },
      antiError,
      criticalChecks,
      drawingRefs: group.map((entry) => entry.annotationId),
    };
  });

  return { steps, stepNumberByStage };
}

function buildQc(suggestions: readonly QcDraft[], metadata: IkGuideMetadata): QcItem[] {
  const items: QcItem[] = [];
  const seen = new Set<string>();

  suggestions.forEach((suggestion) => {
    if (seen.has(suggestion.text)) {
      return;
    }
    seen.add(suggestion.text);
    items.push({
      id: `qc-${items.length + 1}`,
      text: suggestion.text,
      required: true,
      ...(suggestion.reference ? { reference: suggestion.reference } : {}),
    });
  });

  items.push({
    id: `qc-${items.length + 1}`,
    text: `Сверить деталь с чертежом ${metadata.drawingCode}: все размеры, шероховатость и комплектность.`,
    required: true,
  });

  return items;
}

function assemble(
  items: readonly SourceItem[],
  options: BuildOptions,
  stamp: VisionTitleBlock | null,
  viewId: string,
  incomingWarnings: readonly string[],
  skipped: SkippedCandidate[],
): BuildResult {
  const warnings = [...incomingWarnings];
  const annotations: XrayAnnotation[] = [];
  const translations: AnnotationTranslation[] = [];
  const entries: StageEntry[] = [];
  const usedAnnotationIds = new Set<string>();
  let notRecognised = 0;

  items.forEach((item) => {
    if (item.displayText.length === 0) {
      skipped.push({ text: item.displayText, reason: 'empty', confidence: item.confidence });
      return;
    }

    const result = translateEngineeringNotation(item.displayText);
    if (result.kind === 'unknown' && !isUsefulUnknown(item)) {
      skipped.push({ text: item.displayText, reason: 'not_a_notation', confidence: item.confidence });
      return;
    }

    const annotationId = uniqueId(item.id, usedAnnotationIds);
    const annotation: XrayAnnotation = {
      id: annotationId,
      raw: item.displayText,
      kind: annotationKindFor(result),
      xPercent: item.xPercent,
      yPercent: item.yPercent,
      confidence: item.confidence,
      confirmedByHuman: item.confirmedByHuman,
    };
    if (item.ambiguousOptions.length >= 2) {
      annotation.ambiguousOptions = item.ambiguousOptions;
    }
    if (item.note) {
      annotation.note = item.note;
    }
    if (result.kind === 'unknown') {
      notRecognised += 1;
      annotation.note = result.explanation.slice(0, 240);
    } else {
      entries.push({ item, annotationId, result });
    }

    annotations.push(annotation);
    translations.push({
      annotationId,
      candidateText: item.displayText,
      region: item.region,
      confidence: item.confidence,
      confirmedByHuman: item.confirmedByHuman,
      result,
    });
  });

  const metadata = buildMetadata(options, stamp, entries, warnings);

  const entriesByStage = new Map<StageId, StageEntry[]>();
  entries.forEach((entry) => {
    const stage = stageForKind(entry.result.kind);
    if (!stage) {
      return;
    }
    const bucket = entriesByStage.get(stage) ?? [];
    bucket.push(entry);
    entriesByStage.set(stage, bucket);
  });

  const qcSuggestions = entries
    .map((entry) => qcForTranslation(entry.result))
    .filter((draft): draft is QcDraft => draft !== null);
  const qcChecklist = buildQc(qcSuggestions, metadata);

  const { steps, stepNumberByStage } = buildSteps(entriesByStage, qcSuggestions, metadata, stamp, warnings);

  const toolDrafts: ToolDraft[] = entries.flatMap((entry) => {
    const stage = stageForKind(entry.result.kind);
    if (!stage) {
      return [];
    }
    return selectTools(entry.result.kind, entry.result.tools).map((tool) => toolDraft(tool, stage));
  });
  const controlStageNumber = stepNumberByStage.get('control') ?? steps.length;
  let mergedTools = mergeToolDrafts(toolDrafts);
  if (mergedTools.length === 0) {
    mergedTools = [
      {
        name: 'Штангенциркуль 0–150 мм',
        category: 'caliper',
        purposes: ['Контроль размеров по чертежу'],
        stages: ['control'],
      },
    ];
    warnings.push('Распознанных обозначений нет: в инструмент добавлен только штангенциркуль для контроля.');
  }
  const tools = toGuideTools(mergedTools, stepNumberByStage, controlStageNumber);

  const bom = buildBom(metadata, entries);
  const uncertainCount = annotations.filter(
    (annotation) => annotation.confidence < CONFIDENCE_THRESHOLD && !annotation.confirmedByHuman,
  ).length;

  if (uncertainCount > 0) {
    warnings.push(
      `${uncertainCount} обознач. распознаны с уверенностью ниже 95 % — их нужно подтвердить в «Рентгене» перед выдачей в цех.`,
    );
  }
  if (skipped.length > 0) {
    warnings.push(`Пропущено строк, не похожих на обозначения ГОСТ: ${skipped.length}.`);
  }

  const documentInput = {
    schemaVersion: '1.0' as const,
    id: `guide-${slugify(metadata.drawingCode)}-${shortHash(`${metadata.drawingCode}|${metadata.revision}|${annotations.length}|${steps.length}`)}`,
    metadata,
    drawing: {
      viewId,
      sheetFormat: options.sheetFormat ?? 'A4',
      scale: options.scale ?? stamp?.scale ?? '1:1',
    },
    bom,
    tools,
    steps,
    xrayAnnotations: annotations,
    qcChecklist,
  };

  const parsed = ikGuideDocumentSchema.safeParse(documentInput);
  if (!parsed.success) {
    throw new GuideBuildError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`),
    );
  }

  const stats: BuildStats = {
    recognised: items.length,
    translated: entries.length,
    notRecognised,
    uncertain: uncertainCount,
    skipped: skipped.length,
    steps: steps.length,
    tools: tools.length,
    qcItems: qcChecklist.length,
  };

  return { document: parsed.data, warnings: [...new Set(warnings)], skipped, translations, stats };
}

function capItems(items: SourceItem[], limit: number, skipped: SkippedCandidate[]): SourceItem[] {
  if (items.length <= limit) {
    return items;
  }
  items.slice(limit).forEach((item) => {
    skipped.push({ text: item.displayText, reason: 'limit', confidence: item.confidence });
  });
  return items.slice(0, limit);
}

/**
 * Main entry point: a `/v1/recognize` payload becomes a ready-to-edit `.ikguide` draft.
 * Everything GOST-specific comes from `@ikguide/gost-translator`; this package only orders the work.
 */
export function buildGuideFromVision(response: VisionRecognizeResponse, options: BuildOptions = {}): BuildResult {
  const skipped: SkippedCandidate[] = [];
  const items: SourceItem[] = [];
  const keepLowConfidence = options.keepLowConfidence ?? true;
  const limit = options.maxAnnotations ?? MAX_ANNOTATIONS_DEFAULT;

  for (const candidate of response.candidates) {
    const item = sourceFromCandidate(candidate);
    if (item.displayText.length === 0) {
      skipped.push({ text: candidate.rawText, reason: 'empty', confidence: item.confidence });
      continue;
    }
    if (item.region === 'title_block') {
      // Stamp values are metadata, not production notations — they are read in `parseTitleBlock`.
      skipped.push({ text: item.displayText, reason: 'title_block', confidence: item.confidence });
      continue;
    }
    if (item.confidence < CONFIDENCE_THRESHOLD && !keepLowConfidence) {
      skipped.push({ text: item.displayText, reason: 'below_threshold', confidence: item.confidence });
      continue;
    }
    items.push(item);
  }

  (options.manualNotations ?? []).forEach((notation, index) => {
    const text = notation.text.trim();
    if (text.length === 0) {
      return;
    }
    items.push({
      id: `ann-manual-${index + 1}`,
      displayText: text,
      xPercent: clampPercent(notation.xPercent ?? 50),
      yPercent: clampPercent(notation.yPercent ?? 50),
      confidence: 1,
      confirmedByHuman: true,
      ambiguousOptions: [],
      region: 'field',
      pageIndex: 0,
      ...(notation.note ? { note: notation.note } : {}),
    });
  });

  return assemble(
    capItems(items, limit, skipped),
    options,
    response.titleBlock ?? null,
    response.pages?.[0]?.pageId ?? 'sheet-1',
    response.warnings ?? [],
    skipped,
  );
}

/** Path for the engineer who types a cipher by hand when the scanner missed it. */
export function buildGuideFromNotations(
  notations: readonly (string | ManualNotation)[],
  options: BuildOptions = {},
): BuildResult {
  const skipped: SkippedCandidate[] = [];
  const items: SourceItem[] = notations.map((notation, index) => {
    const entry: ManualNotation = typeof notation === 'string' ? { text: notation } : notation;
    return {
      id: `ann-manual-${index + 1}`,
      displayText: entry.text.trim(),
      xPercent: clampPercent(entry.xPercent ?? 50),
      yPercent: clampPercent(entry.yPercent ?? 50),
      confidence: 1,
      confirmedByHuman: true,
      ambiguousOptions: [],
      region: 'field',
      pageIndex: 0,
      ...(entry.note ? { note: entry.note } : {}),
    };
  });

  return assemble(
    capItems(
      items.filter((item) => item.displayText.length > 0),
      options.maxAnnotations ?? MAX_ANNOTATIONS_DEFAULT,
      skipped,
    ),
    options,
    null,
    'sheet-manual',
    [],
    skipped,
  );
}
