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
  VisionBomRow,
  VisionCandidate,
  VisionRecognizeResponse,
  VisionSheetView,
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
  /** Область обозначения на листе: из неё считается зона кропа страницы шага. */
  bbox?: { x: number; y: number; w: number; h: number };
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

/** Прямоугольник на листе в процентах — как `cropPercent` в схеме документа. */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SheetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CROP_PADDING_PERCENT = 2.4;
const MAX_BOM_STEPS = 6;
const MAX_VIEW_STEPS = 3;

function roundPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function unionBoxes(boxes: readonly SheetBox[]): SheetBox | null {
  const usable = boxes.filter(
    (box) => Number.isFinite(box.x) && Number.isFinite(box.y) && box.w > 0 && box.h > 0,
  );
  if (usable.length === 0) {
    return null;
  }
  const x0 = Math.min(...usable.map((box) => box.x));
  const y0 = Math.min(...usable.map((box) => box.y));
  const x1 = Math.max(...usable.map((box) => box.x + box.w));
  const y1 = Math.max(...usable.map((box) => box.y + box.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Зона кропа вокруг области листа: небольшой запас, чтобы обрезка не резала текст. */
function cropAround(box: SheetBox | null, padding = CROP_PADDING_PERCENT): Crop | undefined {
  if (!box) {
    return undefined;
  }
  const x = roundPercent(box.x - padding);
  const y = roundPercent(box.y - padding);
  const w = roundPercent(Math.min(100 - x, Math.max(1, box.w + padding * 2)));
  const h = roundPercent(Math.min(100 - y, Math.max(1, box.h + padding * 2)));
  if (w < 1 || h < 1) {
    return undefined;
  }
  return { x, y, w, h };
}

/** Зона шага: свои обозначения, иначе ближайший вид листа, иначе ничего. */
function cropForEntries(
  group: readonly StageEntry[],
  views: readonly VisionSheetView[],
): Crop | undefined {
  const own = unionBoxes(group.map((entry) => entry.item.bbox).filter((box): box is SheetBox => Boolean(box)));
  if (own) {
    return cropAround(own, Math.max(CROP_PADDING_PERCENT, Math.min(own.w, own.h) * 0.25));
  }
  const view = unionBoxes(views.map((item) => item.bboxPercent));
  return view ? cropAround(view, 6) : undefined;
}

function sourceFromCandidate(candidate: VisionCandidate): SourceItem {
  const options = candidate.ambiguousOptions.filter((option) => option.trim().length > 0).slice(0, 4);
  return {
    id: `ann-${candidate.id}`,
    displayText: candidate.normalizedText.trim(),
    xPercent: clampPercent(candidate.xPercent),
    yPercent: clampPercent(candidate.yPercent),
    ...(candidate.bboxPercent && candidate.bboxPercent.w > 0 && candidate.bboxPercent.h > 0
      ? {
          bbox: {
            x: clampPercent(candidate.bboxPercent.x),
            y: clampPercent(candidate.bboxPercent.y),
            w: clampPercent(candidate.bboxPercent.w),
            h: clampPercent(candidate.bboxPercent.h),
          },
        }
      : {}),
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

function bomLookFor(row: VisionBomRow): Pick<BomItem, 'kind' | 'icon'> {
  const text = `${row.designation ?? ''} ${row.name}`.toLowerCase();
  if (/болт|винт|шпильк/.test(text)) {
    return { kind: 'fastener', icon: 'bolt' };
  }
  if (/гайк/.test(text)) {
    return { kind: 'fastener', icon: 'nut' };
  }
  if (/шайб/.test(text)) {
    return { kind: 'fastener', icon: 'washer' };
  }
  if (/подшип/.test(text)) {
    return { kind: 'bearing', icon: 'bearing' };
  }
  if (/манжет|сальник|уплотн/.test(text)) {
    return { kind: 'seal', icon: 'seal' };
  }
  if (/кронштейн|скоб|планк/.test(text)) {
    return { kind: 'purchased', icon: 'bracket' };
  }
  if (/датчик/.test(text)) {
    return { kind: 'purchased', icon: 'sensor' };
  }
  if (/провод|кабел/.test(text)) {
    return { kind: 'purchased', icon: 'cable' };
  }
  return { kind: 'purchased', icon: 'plate' };
}

function buildBom(
  metadata: IkGuideMetadata,
  entries: readonly StageEntry[],
  bomRows: readonly VisionBomRow[] = [],
): BomItem[] {
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

  bomRows.forEach((row, index) => {
    const designation = row.designation?.trim();
    const position = typeof row.position === 'number' && row.position > 0 ? row.position : index + 1;
    items.push({
      id: `bom-row-${position}`,
      name: row.name,
      size: designation ?? 'по таблице позиций',
      quantity: row.quantity && row.quantity > 0 ? Math.min(999, Math.round(row.quantity)) : 1,
      ...bomLookFor(row),
      note: `Позиция ${position}${designation && /гост/i.test(designation) ? `, ${designation}` : ''}: сверьте номер на поле чертежа`,
    });
  });

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

interface StepPiece {
  stageId: StageId | null;
  title: string;
  workerText: string;
  estimatedMinutes: number;
  highlights: Highlight[];
  antiError: GuideStep['antiError'];
  criticalChecks: CriticalCheck[];
  drawingRefs: string[];
  crop?: Crop;
}

/** Шаги комплектности: каждая прочитанная строка таблицы позиций — что взять и сколько. */
function bomPieces(bomRows: readonly VisionBomRow[]): StepPiece[] {
  return bomRows.slice(0, MAX_BOM_STEPS).map((row) => {
    const quantity = row.quantity && row.quantity > 0 ? row.quantity : null;
    const designation = row.designation?.trim();
    const position = typeof row.position === 'number' && row.position > 0 ? row.position : null;
    const parts = [
      position
        ? `Позиция ${position} по таблице позиций: возьмите «${row.name}»${designation ? ` (${designation})` : ''}${quantity ? ` — ${quantity} шт.` : ''}.`
        : `Возьмите по таблице позиций «${row.name}»${designation ? ` (${designation})` : ''}${quantity ? ` — ${quantity} шт.` : ''}.`,
      'Найдите этот номер позиции на поле чертежа и сверьте деталь с обозначением — похожие крепёж и кронштейны легко перепутать.',
      quantity && quantity > 1
        ? `Проверьте количество: в комплекте должно быть ${quantity} шт., недостача обнаруживается только на сборке.`
        : 'Проверьте, что деталь без заусенцев, трещин и следов коррозии.',
    ];
    return {
      stageId: null,
      title: position ? `Комплектность · позиция ${position}: ${row.name}` : `Комплектность · ${row.name}`,
      workerText: parts.join(' ').replace(/\s{2,}/g, ' ').trim(),
      estimatedMinutes: Math.max(2, Math.min(12, 2 + (quantity ?? 1))),
      highlights: [{ shapeId: 'plate', label: designation ?? row.name, tone: 'accent' as const }],
      antiError: null,
      criticalChecks: [],
      drawingRefs: [],
      crop: cropAround(row.bboxPercent, 2),
    };
  });
}

/** Ориентиры на листе: «Спереди», «Сбоку», «Сверху» — куда смотреть при работе. */
function viewPieces(views: readonly VisionSheetView[]): StepPiece[] {
  return views.slice(0, MAX_VIEW_STEPS).map((view) => ({
    stageId: null,
    title: `Ориентир на листе: вид ${view.name}`,
    workerText: [
      `На чертеже подписан вид «${view.name}» — сверяйтесь с ним, а не с объёмным представлением:`,
      'на виде видны только те кромки и отверстия, которые действительно есть на детали.',
      'Найдите подпись на листе и держите её перед глазами до конца этого перехода.',
    ]
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    estimatedMinutes: 2,
    highlights: [{ shapeId: 'plate', label: `Вид ${view.name}`, tone: 'accent' as const }],
    antiError: null,
    criticalChecks: [],
    drawingRefs: [],
    crop: cropAround(view.bboxPercent, 6),
  }));
}

function buildSteps(
  entriesByStage: ReadonlyMap<StageId, StageEntry[]>,
  qcDrafts: readonly QcDraft[],
  metadata: IkGuideMetadata,
  stamp: VisionTitleBlock | null,
  warnings: string[],
  sheet: { bomRows: readonly VisionBomRow[]; views: readonly VisionSheetView[]; stampBox?: SheetBox },
): { steps: GuideStep[]; stepNumberByStage: Map<StageId, number> } {
  const activeStages = STAGES.filter(
    (stage) => stage.id === 'preparation' || stage.id === 'control' || (entriesByStage.get(stage.id)?.length ?? 0) > 0,
  );

  const detectedBoxes = [...entriesByStage.values()].flatMap((entries) =>
    entries.map((entry) => entry.item.bbox).filter((box): box is SheetBox => Boolean(box)),
  );
  const stagePieces: StepPiece[] = activeStages.map((stage) => {
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
        id: `check-${stage.id}-visual`,
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
      stageId: stage.id,
      title: stage.title,
      workerText: workerText.length >= 3 ? workerText : `${stage.title}: следуйте указаниям мастера.`,
      estimatedMinutes,
      highlights,
      antiError,
      criticalChecks,
      drawingRefs: group.map((entry) => entry.annotationId),
      crop: stage.id === 'preparation'
        ? cropAround(sheet.stampBox ?? unionBoxes(sheet.bomRows.map((row) => row.bboxPercent)), 5)
          ?? (detectedBoxes.length ? { x: 0, y: 0, w: 100, h: 100 } : cropForEntries(group, sheet.views))
        : stage.id === 'control'
          ? cropAround(unionBoxes(sheet.views.map((view) => view.bboxPercent)) ?? unionBoxes(detectedBoxes), 12) ?? cropForEntries(group, sheet.views)
          : cropForEntries(group, sheet.views),
    };
  });

  // Порядок для цеха: подготовка → что взять (таблица позиций) → куда смотреть (виды) → работа.
  const ordered: StepPiece[] = [];
  stagePieces.forEach((piece) => {
    ordered.push(piece);
    if (piece.stageId === 'preparation') {
      ordered.push(...bomPieces(sheet.bomRows), ...viewPieces(sheet.views));
    }
  });

  const steps: GuideStep[] = ordered.map((piece, index) => {
    const number = index + 1;
    const step: GuideStep = {
      id: `step-${number}`,
      number,
      title: piece.title,
      workerText: piece.workerText,
      estimatedMinutes: piece.estimatedMinutes,
      illustration: { illustrationId: 'generic-step', highlight: piece.highlights, arrows: [] },
      antiError: piece.antiError,
      criticalChecks: piece.criticalChecks,
      drawingRefs: piece.drawingRefs,
    };
    if (piece.crop) {
      step.cropPercent = piece.crop;
    }
    return step;
  });

  const stepNumberByStage = new Map<StageId, number>();
  ordered.forEach((piece, index) => {
    if (piece.stageId && !stepNumberByStage.has(piece.stageId)) {
      stepNumberByStage.set(piece.stageId, index + 1);
    }
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
  sheet: { bomRows: readonly VisionBomRow[]; views: readonly VisionSheetView[]; stampBox?: SheetBox } = { bomRows: [], views: [] },
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

  const { steps, stepNumberByStage } = buildSteps(entriesByStage, qcSuggestions, metadata, stamp, warnings, sheet);

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

  const bom = buildBom(metadata, entries, sheet.bomRows);
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

  if (response.bomRows && response.bomRows.length > 0) {
    // Строки таблицы позиций превращаются в шаги комплектности — об этом стоит сказать вслух.
    const positions = response.bomRows
      .map((row) => (typeof row.position === 'number' && row.position > 0 ? row.position : null))
      .filter((position): position is number => position !== null);
    if (positions.length > 0) {
      skipped.push({
        text: `таблица позиций: ${positions.map((position) => `поз. ${position}`).join(', ')}`,
        reason: 'bom_row',
        confidence: 1,
      });
    }
  }

  return assemble(
    capItems(items, limit, skipped),
    options,
    response.titleBlock ?? null,
    response.pages?.[0]?.pageId ?? 'sheet-1',
    response.warnings ?? [],
    skipped,
    { bomRows: response.bomRows ?? [], views: response.views ?? [],
      stampBox: response.pages?.[0]?.zones?.find((zone) => zone.kind === 'title_block')?.bboxPercent },
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
