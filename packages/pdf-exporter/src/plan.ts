/**
 * План PDF-инструкции: что и где нарисовать на каждом листе A4.
 *
 * Зачем отдельный слой: один и тот же план рисует и `.pdf` (jsPDF + svg2pdf), и живой предпросмотр в
 * браузере (абсолютно позиционированные блоки). Поэтому «что видно на экране» и «что в файле» — это
 * буквально одни и те же координаты, строки и переносы, а не две параллельные вёрстки.
 *
 * Дизайн — IKEA 2.0: много воздуха, крупный номер шага, три цвета (чернила #1D1D1F, синий #007AFF,
 * красный #FF3B30), никаких декоративных рамок. Кегль задаётся в пунктах, координаты — в миллиметрах.
 */
import type { BomItem, GuideStep, GuideTool, IkGuideDocument, XrayAnnotation } from '@ikguide/schema';
import { translateEngineeringNotation } from '@ikguide/gost-translator';
import { blockHeight, ellipsize, lineHeight, wrapText, type FontWeight } from './text';

export const PAGE = {
  width: 210,
  height: 297,
  margin: 16,
  contentWidth: 178,
  bodyTop: 16,
  bodyBottom: 272,
  footerBaseline: 285,
} as const;

export const COLORS = {
  ink: '#1D1D1F',
  gray: '#6E6E73',
  faint: '#A1A1A6',
  line: '#D2D2D7',
  chip: '#F5F5F7',
  accent: '#007AFF',
  accentSoft: '#EAF3FF',
  danger: '#FF3B30',
  dangerSoft: '#FFF1F0',
  paper: '#FFFFFF',
} as const;

export type Align = 'left' | 'right' | 'center';

/**
 * Адрес «что именно тут написано» у блока плана.
 *
 * Нужен живому холсту: лист A4 на экране — это тот же план, что уходит в PDF, поэтому клик по
 * названию или абзацу шага прямо на листе открывает правку ровно того поля документа. В самом PDF
 * никаких адресов нет — jsPDF их просто не рисует.
 */
export type PlanTarget =
  | { type: 'title' }
  | { type: 'step-title'; stepId: string }
  | { type: 'step-text'; stepId: string }
  | { type: 'step-anti'; stepId: string }
  | { type: 'step-illustration'; stepId: string }
  | { type: 'notation'; annotationId: string };

export interface PlanText {
  kind: 'text';
  x: number;
  y: number;
  w: number;
  lines: string[];
  size: number;
  weight: FontWeight;
  color: string;
  align: Align;
  /** Поле документа, которое правится кликом по этому тексту на экране. */
  target?: PlanTarget;
}

export interface PlanRect {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  radius: number;
  lineWidth: number;
}

export interface PlanLine {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  lineWidth: number;
}

export interface PlanSvg {
  kind: 'svg';
  x: number;
  y: number;
  w: number;
  h: number;
  markup: string;
  target?: PlanTarget;
}

export interface PlanImage {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  dataUrl: string;
}

export type PlanBlock = PlanText | PlanRect | PlanLine | PlanSvg | PlanImage;

export interface PlanPage {
  index: number;
  blocks: PlanBlock[];
}

export interface InstructionPlan {
  title: string;
  fileName: string;
  pages: PlanPage[];
}

/** Иллюстрация шага: векторная схема, фрагмент чертежа или и то и другое. */
export interface IllustrationInput {
  svg?: string;
  imageDataUrl?: string;
  caption?: string;
}

export interface PlanOptions {
  /** Иллюстрации по id шага; всё, что не передано, будет нарисовано заглушкой. */
  steps?: Readonly<Record<string, IllustrationInput>>;
  /** Общая схема изделия для титульного листа. */
  cover?: IllustrationInput;
  /** Замена ГОСТ-переводчика (нужна тестам и предпросмотру правок). */
  explain?: (raw: string) => string;
}

const ILLUSTRATION_W = 92;
const ILLUSTRATION_H = 60;
const COLUMN_GAP = 6;
const STEP_GAP = 9;

/* ------------------------------------------------------------------ поток вёрстки */

class Flow {
  pages: PlanPage[] = [{ index: 1, blocks: [] }];
  page: PlanPage = this.pages[0]!;
  y: number = PAGE.bodyTop;

  get remaining(): number {
    return PAGE.bodyBottom - this.y;
  }

  newPage(): void {
    this.page = { index: this.pages.length + 1, blocks: [] };
    this.pages.push(this.page);
    this.y = PAGE.bodyTop;
  }

  /** Начинает новый лист, если блок высотой `height` не влезает; возвращает актуальный `y`. */
  ensure(height: number): number {
    if (height > this.remaining && this.y > PAGE.bodyTop + 0.5) {
      this.newPage();
    }
    return this.y;
  }

  add(block: PlanBlock): void {
    this.page.blocks.push(block);
  }

  advance(height: number): void {
    this.y += height;
  }
}

interface TextStyle {
  size: number;
  weight?: FontWeight;
  color?: string;
  align?: Align;
  target?: PlanTarget;
}

function text(flow: Flow, x: number, y: number, width: number, value: string, style: TextStyle): number {
  const weight = style.weight ?? 'normal';
  const lines = wrapText(value, width, style.size, weight);
  flow.add({
    kind: 'text',
    x,
    y,
    w: width,
    lines,
    size: style.size,
    weight,
    color: style.color ?? COLORS.ink,
    align: style.align ?? 'left',
    ...(style.target ? { target: style.target } : {}),
  });
  return blockHeight(lines, style.size);
}

function rect(
  flow: Flow,
  x: number,
  y: number,
  w: number,
  h: number,
  options: { fill?: string | null; stroke?: string | null; radius?: number; lineWidth?: number } = {},
): void {
  flow.add({
    kind: 'rect',
    x,
    y,
    w,
    h,
    fill: options.fill ?? null,
    stroke: options.stroke ?? null,
    radius: options.radius ?? 0,
    lineWidth: options.lineWidth ?? 0.25,
  });
}

function hairline(flow: Flow, x: number, y: number, w: number, color: string = COLORS.line): void {
  flow.add({ kind: 'line', x1: x, y1: y, x2: x + w, y2: y, color, lineWidth: 0.2 });
}

function illustration(
  flow: Flow,
  x: number,
  y: number,
  w: number,
  h: number,
  input: IllustrationInput | undefined,
  fallbackLabel: string,
  target?: PlanTarget,
): void {
  rect(flow, x, y, w, h, { fill: COLORS.chip, radius: 3 });
  if (input?.imageDataUrl) {
    flow.add({ kind: 'image', x: x + 1.6, y: y + 1.6, w: w - 3.2, h: h - 3.2, dataUrl: input.imageDataUrl });
    return;
  }
  if (input?.svg) {
    flow.add({
      kind: 'svg',
      x: x + 2.5,
      y: y + 2.5,
      w: w - 5,
      h: h - 5,
      markup: input.svg,
      ...(target ? { target } : {}),
    });
    return;
  }
  text(flow, x + 6, y + h / 2 - 5, w - 12, fallbackLabel, {
    size: 8,
    color: COLORS.faint,
    align: 'center',
  });
}

/** Заголовок раздела: маленькая серая надпись капсом и тонкая линия под ней. */
function sectionTitle(flow: Flow, label: string): void {
  const height = text(flow, PAGE.margin, flow.y, PAGE.contentWidth, label.toUpperCase(), {
    size: 7.5,
    weight: 'bold',
    color: COLORS.gray,
  });
  flow.advance(height + 1.5);
  hairline(flow, PAGE.margin, flow.y, PAGE.contentWidth);
  flow.advance(4.5);
}

/* ------------------------------------------------------------------ строки списков */

interface RowLayout {
  height: number;
  draw: (flow: Flow, x: number, y: number, width: number) => void;
}

function layoutBomRow(item: BomItem, width: number): RowLayout {
  const nameLines = wrapText(`${item.name}${item.standard ? ` · ${item.standard}` : ''}`, width - 18, 8.6, 'bold');
  const metaParts = [item.size, `${item.quantity} шт.`];
  if (item.note) {
    metaParts.push(item.note);
  }
  const metaLines = wrapText(metaParts.join(' · '), width - 18, 8, 'normal');
  const height = blockHeight(nameLines, 8.6) + blockHeight(metaLines, 8) + 2.4;
  return {
    height,
    draw: (flow, x, y, rowWidth) => {
      rect(flow, x, y + 1.2, 2.6, 2.6, { fill: COLORS.accentSoft, radius: 0.8 });
      text(flow, x + 6, y, rowWidth - 6, `${item.name}${item.standard ? ` · ${item.standard}` : ''}`, {
        size: 8.6,
        weight: 'bold',
      });
      text(flow, x + 6, y + blockHeight(nameLines, 8.6), rowWidth - 6, metaParts.join(' · '), {
        size: 8,
        color: COLORS.gray,
      });
    },
  };
}

function layoutToolRow(tool: GuideTool, width: number): RowLayout {
  const title = tool.size ? `${tool.name} · ${tool.size}` : tool.name;
  const titleLines = wrapText(title, width - 18, 8.6, 'bold');
  const purposeLines = wrapText(tool.purpose, width - 18, 7.8, 'normal');
  const height = blockHeight(titleLines, 8.6) + blockHeight(purposeLines, 7.8) + 2.4;
  return {
    height,
    draw: (flow, x, y, rowWidth) => {
      rect(flow, x, y + 1.2, 2.6, 2.6, { fill: COLORS.chip, stroke: COLORS.line, radius: 0.8 });
      text(flow, x + 6, y, rowWidth - 6, title, { size: 8.6, weight: 'bold' });
      text(flow, x + 6, y + blockHeight(titleLines, 8.6), rowWidth - 6, tool.purpose, {
        size: 7.8,
        color: COLORS.gray,
      });
    },
  };
}

/**
 * Две колонки на одном уровне: «Что понадобится» и «Возьми инструмент».
 * Длинные списки переносятся на следующий лист порциями — ничего не обрезается.
 */
function drawTwoColumns(
  flow: Flow,
  titles: [string, string],
  columns: [RowLayout[], RowLayout[]],
  columnWidth: number,
  x: [number, number],
): void {
  const headerHeight = 12;
  let [left, right] = columns;
  let first = true;
  while (left.length > 0 || right.length > 0) {
    const available = PAGE.bodyBottom - (first ? flow.y : PAGE.bodyTop + 1) - headerHeight;
    const take = (rows: RowLayout[]): RowLayout[] => {
      const chosen: RowLayout[] = [];
      let used = 0;
      for (const row of rows) {
        if (used + row.height > available && chosen.length > 0) {
          break;
        }
        chosen.push(row);
        used += row.height;
        if (used > available) {
          break;
        }
      }
      return chosen;
    };
    const leftPortion = take(left);
    const rightPortion = take(right);

    if (!first) {
      flow.newPage();
    }
    first = false;

    text(flow, x[0], flow.y, columnWidth, titles[0].toUpperCase(), {
      size: 7.5,
      weight: 'bold',
      color: COLORS.gray,
    });
    text(flow, x[1], flow.y, columnWidth, titles[1].toUpperCase(), {
      size: 7.5,
      weight: 'bold',
      color: COLORS.gray,
    });
    flow.advance(lineHeight(7.5) + 2);
    const top = flow.y;

    let yLeft = top;
    for (const row of leftPortion) {
      row.draw(flow, x[0], yLeft, columnWidth);
      yLeft += row.height;
    }
    let yRight = top;
    for (const row of rightPortion) {
      row.draw(flow, x[1], yRight, columnWidth);
      yRight += row.height;
    }

    flow.y = Math.max(yLeft, yRight) + 8;
    left = left.slice(leftPortion.length);
    right = right.slice(rightPortion.length);
  }
}

/* ------------------------------------------------------------------ титульный лист */

function coverBlocks(flow: Flow, doc: IkGuideDocument, options: PlanOptions): void {
  const { metadata } = doc;

  text(flow, PAGE.margin, flow.y, PAGE.contentWidth, 'IKGUIDE · ИНСТРУКЦИЯ ПО СБОРКЕ', {
    size: 7.5,
    weight: 'bold',
    color: COLORS.accent,
  });
  flow.advance(lineHeight(7.5) + 2.5);

  const titleLines = wrapText(metadata.title, PAGE.contentWidth, 21, 'bold');
  text(flow, PAGE.margin, flow.y, PAGE.contentWidth, metadata.title, {
    size: 21,
    weight: 'bold',
    target: { type: 'title' },
  });
  flow.advance(blockHeight(titleLines, 21) + 1.5);

  const meta = [
    metadata.drawingCode,
    `ревизия ${metadata.revision}`,
    doc.drawing.sheetFormat,
    doc.drawing.scale,
    `${doc.steps.length} шагов`,
  ]
    .filter((part) => String(part ?? '').trim().length > 0)
    .join(' · ');
  const metaHeight = text(flow, PAGE.margin, flow.y, PAGE.contentWidth, meta, {
    size: 9,
    color: COLORS.gray,
  });
  flow.advance(metaHeight + 5);

  // Три «паспортных» плитки: что за деталь и с чем работать.
  const chips: Array<{ label: string; value: string }> = [
    { label: 'МАТЕРИАЛ', value: metadata.material },
    { label: 'ЗАГОТОВКА', value: metadata.blankDimensions },
    {
      label: 'МАССА',
      value: metadata.massKg ? `${metadata.massKg.toFixed(2).replace('.', ',')} кг` : 'не указана',
    },
  ];
  const chipWidth = (PAGE.contentWidth - 2 * COLUMN_GAP) / 3;
  const chipHeight =
    Math.max(...chips.map((chip) => 6 + blockHeight(wrapText(chip.value, chipWidth - 8, 10, 'bold'), 10) + 3), 20);
  chips.forEach((chip, index) => {
    const x = PAGE.margin + index * (chipWidth + COLUMN_GAP);
    rect(flow, x, flow.y, chipWidth, chipHeight, { fill: COLORS.chip, radius: 3 });
    text(flow, x + 4, flow.y + 3.5, chipWidth - 8, chip.label, {
      size: 6.5,
      weight: 'bold',
      color: COLORS.faint,
    });
    text(flow, x + 4, flow.y + 9, chipWidth - 8, chip.value, { size: 10, weight: 'bold' });
  });
  flow.advance(chipHeight + 9);

  if (options.cover) {
    illustration(flow, PAGE.margin, flow.y, PAGE.contentWidth, 60, options.cover, 'Общая схема изделия');
    flow.advance(60 + 2.5);
    if (options.cover.caption) {
      const captionHeight = text(flow, PAGE.margin, flow.y, PAGE.contentWidth, options.cover.caption, {
        size: 7.5,
        color: COLORS.gray,
      });
      flow.advance(captionHeight);
    }
    flow.advance(8);
  }

  const columnWidth = (PAGE.contentWidth - 10) / 2;
  const leftRows = doc.bom.map((item) => layoutBomRow(item, columnWidth));
  const rightRows = doc.tools.map((tool) => layoutToolRow(tool, columnWidth));
  drawTwoColumns(
    flow,
    ['Что понадобится', 'Возьми инструмент'],
    [leftRows, rightRows],
    columnWidth,
    [PAGE.margin, PAGE.margin + columnWidth + 10],
  );
}

/* ------------------------------------------------------------------ шпаргалка по значкам */

interface GlossaryRow {
  raw: string;
  annotationId: string | null;
  explanation: string;
  note: string | null;
  height: number;
  rawLines: string[];
  explanationLines: string[];
}

function buildGlossary(doc: IkGuideDocument, explain: (raw: string) => string): GlossaryRow[] {
  const rows: GlossaryRow[] = [];
  const seen = new Set<string>();
  const push = (annotation: XrayAnnotation) => {
    const raw = annotation.resolvedValue?.trim() || annotation.raw.trim();
    if (!raw || seen.has(raw)) {
      return;
    }
    seen.add(raw);
    // Человеческая расшифровка (правка в предпросмотре) важнее автоматического перевода ГОСТ.
    const explanation = annotation.note?.trim() || explain(raw);
    const rawLines = wrapText(raw, 40, 9, 'bold');
    const explanationLines = wrapText(explanation, 122, 8.4, 'normal');
    const note = annotation.confirmedByHuman ? null : 'проверить по чертежу';
    rows.push({
      raw,
      annotationId: annotation.id,
      explanation,
      note,
      rawLines,
      explanationLines,
      height: Math.max(blockHeight(rawLines, 9), blockHeight(explanationLines, 8.4)) + 3.4,
    });
  };
  doc.xrayAnnotations.forEach(push);
  doc.steps.forEach((step) =>
    step.criticalChecks.forEach((check) => {
      const raw = check.nominal.trim();
      if (!raw || seen.has(raw)) {
        return;
      }
      seen.add(raw);
      const explanation = `${check.acceptance} · контроль: ${check.instrument}`;
      const rawLines = wrapText(raw, 40, 9, 'bold');
      const explanationLines = wrapText(explanation, 122, 8.4, 'normal');
      rows.push({
        raw,
        annotationId: null,
        explanation,
        note: null,
        rawLines,
        explanationLines,
        height: Math.max(blockHeight(rawLines, 9), blockHeight(explanationLines, 8.4)) + 3.4,
      });
    }),
  );
  return rows;
}

function drawGlossary(flow: Flow, rows: GlossaryRow[]): void {
  if (rows.length === 0) {
    return;
  }
  let index = 0;
  while (index < rows.length) {
    flow.ensure(24);
    sectionTitle(flow, 'Шпаргалка по значкам и допускам');
    while (index < rows.length) {
      const row = rows[index]!;
      if (row.height > flow.remaining && flow.y > PAGE.bodyTop + 12) {
        break;
      }
      text(flow, PAGE.margin, flow.y, 40, row.rawLines.join(' '), {
        size: 9,
        weight: 'bold',
        ...(row.annotationId ? { target: { type: 'notation' as const, annotationId: row.annotationId } } : {}),
      });
      const explanationHeight = text(flow, PAGE.margin + 46, flow.y, 122, row.explanationLines.join(' '), {
        size: 8.4,
        color: COLORS.ink,
      });
      if (row.note) {
        text(flow, PAGE.margin + 46, flow.y + explanationHeight, 122, row.note, {
          size: 7,
          color: COLORS.faint,
        });
      }
      flow.advance(row.height);
      hairline(flow, PAGE.margin, flow.y - 1.6, PAGE.contentWidth, COLORS.chip);
      index += 1;
    }
  }
}

/* ------------------------------------------------------------------ шаги */

interface StepLayout {
  step: GuideStep;
  number: string;
  titleLines: string[];
  textLines: string[];
  checks: GuideStep['criticalChecks'];
  antiLines: string[];
  height: number;
  caption: string | null;
}

function layoutStep(step: GuideStep, input: IllustrationInput | undefined): StepLayout {
  const titleWidth = PAGE.contentWidth - 20;
  const titleLines = wrapText(step.title, titleWidth, 12.5, 'bold');
  const textLines = wrapText(step.workerText, PAGE.contentWidth - ILLUSTRATION_W - 10, 8.6, 'normal');
  const antiLines = step.antiError
    ? wrapText(step.antiError.text, PAGE.contentWidth - 10, 8.4, 'normal')
    : [];

  const titleHeight = blockHeight(titleLines, 12.5);
  const bodyHeight = Math.max(
    ILLUSTRATION_H,
    blockHeight(textLines, 8.6) + (input?.caption ? lineHeight(7) + 1 : 0),
  );
  const checksHeight = step.criticalChecks.length > 0 ? 5 + checksTableHeight(step.criticalChecks) : 0;
  const antiHeight = step.antiError ? blockHeight(antiLines, 8.4) + 9 : 0;

  return {
    step,
    number: String(step.number).padStart(2, '0'),
    titleLines,
    textLines,
    checks: step.criticalChecks,
    antiLines,
    height: titleHeight + 2 + bodyHeight + checksHeight + antiHeight + STEP_GAP,
    caption: input?.caption ?? null,
  };
}

function checksTableHeight(checks: GuideStep['criticalChecks']): number {
  return checks.reduce((sum, check) => {
    const nominal = wrapText(check.nominal, 42, 8.4, 'bold');
    const acceptance = wrapText(check.acceptance, 82, 8.2, 'normal');
    const instrument = wrapText(check.instrument, 40, 7.6, 'normal');
    return (
      sum +
      Math.max(blockHeight(nominal, 8.4), blockHeight(acceptance, 8.2), blockHeight(instrument, 7.6)) +
      1.8
    );
  }, 0);
}

function drawStep(flow: Flow, layout: StepLayout, input: IllustrationInput | undefined): void {
  const top = flow.y;
  const { step } = layout;

  text(flow, PAGE.margin, top, 20, layout.number, { size: 22, weight: 'bold', color: COLORS.accent });
  text(flow, PAGE.margin + 20, top + 1.5, PAGE.contentWidth - 20, step.title, {
    size: 12.5,
    weight: 'bold',
    target: { type: 'step-title', stepId: step.id },
  });
  text(flow, PAGE.margin + 20, top + 1.5 + blockHeight(layout.titleLines, 12.5) + 0.6, 60, minutesLabel(step), {
    size: 7.5,
    color: COLORS.faint,
  });

  let y = top + blockHeight(layout.titleLines, 12.5) + 4;
  illustration(flow, PAGE.margin, y, ILLUSTRATION_W, ILLUSTRATION_H, input, 'Схема шага', {
    type: 'step-illustration',
    stepId: step.id,
  });
  const textX = PAGE.margin + ILLUSTRATION_W + 8;
  const textWidth = PAGE.contentWidth - ILLUSTRATION_W - 8;
  const textHeight = text(flow, textX, y, textWidth, step.workerText, {
    size: 8.6,
    target: { type: 'step-text', stepId: step.id },
  });
  if (layout.caption) {
    text(flow, textX, y + textHeight + 1, textWidth, layout.caption, { size: 7, color: COLORS.gray });
  }
  y += Math.max(ILLUSTRATION_H, textHeight) + 3;

  if (layout.checks.length > 0) {
    text(flow, PAGE.margin, y, PAGE.contentWidth, 'КОНТРОЛЬНЫЙ ЗАМЕР', {
      size: 7,
      weight: 'bold',
      color: COLORS.gray,
    });
    y += 4.5;
    layout.checks.forEach((check) => {
      text(flow, PAGE.margin, y, 42, check.nominal, { size: 8.4, weight: 'bold' });
      text(flow, PAGE.margin + 44, y, 82, check.acceptance, { size: 8.2 });
      text(flow, PAGE.margin + 130, y, 40, check.instrument, { size: 7.6, color: COLORS.gray });
      const nominal = wrapText(check.nominal, 42, 8.4, 'bold');
      const acceptance = wrapText(check.acceptance, 82, 8.2, 'normal');
      const instrument = wrapText(check.instrument, 40, 7.6, 'normal');
      y += Math.max(blockHeight(nominal, 8.4), blockHeight(acceptance, 8.2), blockHeight(instrument, 7.6)) + 1.8;
    });
    y += 1;
  }

  if (step.antiError) {
    const height = blockHeight(layout.antiLines, 8.4) + 9;
    rect(flow, PAGE.margin, y, PAGE.contentWidth, height, { fill: COLORS.dangerSoft, radius: 2 });
    text(flow, PAGE.margin + 4, y + 3, PAGE.contentWidth - 8, 'ОСТОРОЖНО!', {
      size: 7.5,
      weight: 'bold',
      color: COLORS.danger,
      target: { type: 'step-anti', stepId: step.id },
    });
    text(flow, PAGE.margin + 4, y + 7.5, PAGE.contentWidth - 8, step.antiError.text, {
      size: 8.4,
      target: { type: 'step-anti', stepId: step.id },
    });
    y += height + 2;
  }

  flow.y = y + STEP_GAP - 2;
}

function minutesLabel(step: GuideStep): string {
  const minutes = Math.round(step.estimatedMinutes);
  return `≈ ${minutes} мин`;
}

/* ------------------------------------------------------------------ финальная страница */

function drawChecklist(flow: Flow, doc: IkGuideDocument): void {
  flow.newPage();
  text(flow, PAGE.margin, flow.y, PAGE.contentWidth, 'Проверь перед сдачей', { size: 19, weight: 'bold' });
  flow.advance(lineHeight(19) + 2);
  text(
    flow,
    PAGE.margin,
    flow.y,
    PAGE.contentWidth,
    'Пройди по списку и поставь галочку ручкой — так мастер увидит, что контроль выполнен.',
    { size: 9, color: COLORS.gray },
  );
  flow.advance(lineHeight(9) + 6);

  doc.qcChecklist.forEach((item) => {
    const lines = wrapText(item.text, PAGE.contentWidth - 14, 9.5, 'normal');
    const height = blockHeight(lines, 9.5) + (item.reference ? lineHeight(7.5) : 0);
    flow.ensure(height + 5);
    rect(flow, PAGE.margin, flow.y + 0.8, 4.4, 4.4, { stroke: COLORS.ink, radius: 0.6, lineWidth: 0.35 });
    text(flow, PAGE.margin + 8, flow.y, PAGE.contentWidth - 8, item.text, { size: 9.5 });
    if (item.reference) {
      text(flow, PAGE.margin + 8, flow.y + blockHeight(lines, 9.5), PAGE.contentWidth - 8, item.reference, {
        size: 7.5,
        color: COLORS.gray,
      });
    }
    flow.advance(height + 5);
  });

  flow.advance(6);
  flow.ensure(22);
  hairline(flow, PAGE.margin, flow.y, 74);
  hairline(flow, PAGE.margin + 104, flow.y, 74);
  text(flow, PAGE.margin, flow.y + 1.5, 74, 'Мастер', { size: 7.5, color: COLORS.gray });
  text(flow, PAGE.margin + 104, flow.y + 1.5, 74, 'Дата', { size: 7.5, color: COLORS.gray });
}

/* ------------------------------------------------------------------ колонтитулы */

function drawFooters(flow: Flow, doc: IkGuideDocument): void {
  const total = flow.pages.length;
  flow.pages.forEach((page, index) => {
    hairline(flow, PAGE.margin, PAGE.footerBaseline - 4, PAGE.contentWidth, COLORS.chip);
    // Колонтитул пишем напрямую в страницу: `flow.y` к этому моменту уже не важен.
    const left = ellipsize(
      `${doc.metadata.drawingCode} · ${doc.metadata.title}`,
      PAGE.contentWidth - 40,
      7.5,
      'normal',
    );
    page.blocks.push({
      kind: 'text',
      x: PAGE.margin,
      y: PAGE.footerBaseline,
      w: PAGE.contentWidth - 40,
      lines: [left],
      size: 7.5,
      weight: 'normal',
      color: COLORS.faint,
      align: 'left',
    });
    page.blocks.push({
      kind: 'text',
      x: PAGE.margin,
      y: PAGE.footerBaseline,
      w: PAGE.contentWidth,
      lines: [`Стр. ${index + 1} из ${total}`],
      size: 7.5,
      weight: 'normal',
      color: COLORS.faint,
      align: 'right',
    });
  });
}

/* ------------------------------------------------------------------ файл */

/** `КС-04.100.000 СБ` → `КС-04.100.000_СБ_инструкция.pdf` (без запрещённых в Windows символов). */
export function instructionFileName(title: string, drawingCode?: string): string {
  const base = `${title}${drawingCode ? ` ${drawingCode}` : ''}`
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (base.length === 0) {
    return 'инструкция.pdf';
  }
  return `${base.replace(/ /g, '_').slice(0, 96)}_инструкция.pdf`;
}

function defaultExplain(raw: string): string {
  return translateEngineeringNotation(raw).explanation;
}

/**
 * Собирает план листов. Функция детерминированная: одни и те же данные и иллюстрации дают один и тот же
 * план — на этом построены и тесты, и предпросмотр.
 */
export function buildInstructionPlan(doc: IkGuideDocument, options: PlanOptions = {}): InstructionPlan {
  const flow = new Flow();
  const explain = options.explain ?? defaultExplain;

  coverBlocks(flow, doc, options);
  drawGlossary(flow, buildGlossary(doc, explain));

  // Пошаговая часть всегда начинается с нового листа: титул и шпаргалка — «предисловие», а не место,
  // где обрезается первый шаг.
  if (flow.y > PAGE.bodyTop + 1) {
    flow.newPage();
  }

  doc.steps.forEach((step) => {
    const input = options.steps?.[step.id];
    const layout = layoutStep(step, input);
    const halfPage = (PAGE.bodyBottom - PAGE.bodyTop - 4) / 2;
    if (layout.height > halfPage && flow.y > PAGE.bodyTop + 0.5) {
      // Крупный шаг занимает свой лист целиком: половинка A4 его не удержит.
      flow.newPage();
    }
    flow.ensure(layout.height);
    drawStep(flow, layout, input);
  });

  drawChecklist(flow, doc);
  drawFooters(flow, doc);

  return {
    title: doc.metadata.title,
    fileName: instructionFileName(doc.metadata.title, doc.metadata.drawingCode),
    pages: flow.pages,
  };
}

/** Сколько страниц займёт инструкция — для кнопки «Скачать» и подсказки в интерфейсе. */
export function planPageCount(plan: InstructionPlan): number {
  return plan.pages.length;
}
