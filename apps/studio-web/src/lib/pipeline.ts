/**
 * Конвейер «файл → документ инструкции». Только 2D: JPG / JPEG / PNG / WEBP / PDF.
 *
 *   • картинка/PDF → `/v1/recognize` (локальный движок) → `buildGuideFromVision`;
 *   • демо         → готовые документы из `data/demos.ts`, работают офлайн.
 *
 * Ошибки заворачиваются в `PipelineError` с человеческим заголовком и подсказкой, чтобы экран
 * мог показать не стектрейс, а «запустите npm run dev:vision» и кнопку «открыть пример».
 */
import { buildGuideFromVision, GuideBuildError } from '@ikguide/builder';
import type { VisionPage, VisionRecognizeResponse } from '@ikguide/builder';
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';
import { DEMO_BY_ID, type DemoId } from '../data/demos';
import { backendHint } from './runtimeConfig';
import { VisionError, recognizeSheets } from './vision';
import { cropSheet, stepFragment } from './sheetFragment';

export const DRAWING_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'] as const;
export const ACCEPTED_EXTENSIONS = [...DRAWING_EXTENSIONS] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');

/** Подпись под подсказкой на пустом холсте. */
export const ACCEPTED_FORMATS_LABEL = 'JPG · JPEG · PNG · WEBP · PDF';

export type PipelinePhase = 'reading' | 'recognizing' | 'building' | 'ready';
export type ProgressReporter = (phase: PipelinePhase, detail?: string) => void;
export type PipelineSource = 'vision' | 'demo';
export type { DemoId };

export interface PipelineResult {
  doc: IkGuideDocument;
  /** Растровые листы чертежа: нужны, чтобы кликом по значку править расшифровку. */
  pages: VisionPage[];
  /** Готовые фрагменты листа для шагов: печатаем настоящий чертёж, а не пиктограмму. */
  fragments: Record<string, string>;
  /** Общая схема для титула: весь лист, уменьшенный до печатного размера. */
  coverFragment: string | null;
  warnings: string[];
  source: PipelineSource;
  files: string[];
}

export class PipelineError extends Error {
  readonly hint: string;

  constructor(message: string, hint = backendHint()) {
    super(message);
    this.name = 'PipelineError';
    this.hint = hint;
  }
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index).toLowerCase() : '';
}

/** Принимаем только 2D-чертежи; всё остальное честно отклоняем. */
export function isDrawingFile(fileName: string): boolean {
  return (DRAWING_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.slice(0, fileName.length - extensionOf(fileName).length).replace(/[\s_]+/g, ' ').trim();
  return base.length > 0 ? base : 'Деталь по чертежу';
}

/** Демо открывается без сети: документы уже лежат в бандле. */
export async function openDemo(id: DemoId): Promise<PipelineResult> {
  const project = DEMO_BY_ID[id];
  if (!project) {
    throw new PipelineError('Такого примера нет в сборке.', 'Выберите один из примеров на главном экране.');
  }
  return {
    doc: ikGuideDocumentSchema.parse(JSON.parse(JSON.stringify(project.document))) as IkGuideDocument,
    pages: [],
    fragments: {},
    coverFragment: null,
    warnings: [],
    source: 'demo',
    files: [],
  };
}

async function fromDrawings(files: File[], report: ProgressReporter): Promise<PipelineResult> {
  report('recognizing', `Распознаём лист${files.length > 1 ? 'ы' : ''}: ${files.map((f) => f.name).join(', ')}`);
  let response: VisionRecognizeResponse;
  try {
    response = await recognizeSheets(files);
  } catch (error) {
    if (error instanceof VisionError) {
      const hint =
        error.kind === 'offline'
          ? backendHint()
          : 'Проверьте файл: поддерживаются JPG, JPEG, PNG, WEBP и PDF до 20 МБ, до 8 листов.';
      throw new PipelineError(error.message, hint);
    }
    throw new PipelineError('Не удалось распознать чертёж.', backendHint());
  }

  report('building', 'Собираем шаги, инструмент и чек-лист');
  try {
    const result = buildGuideFromVision(response, {
      title: titleFromFileName(files[0]?.name ?? ''),
      createdAt: new Date().toISOString(),
      keepLowConfidence: true,
    });
    const pages = response.pages ?? [];
    return {
      doc: result.document,
      pages,
      fragments: await fragmentsFor(result.document, pages),
      coverFragment: await coverFragmentFor(pages),
      warnings: result.warnings,
      source: 'vision',
      files: files.map((file) => file.name),
    };
  } catch (error) {
    if (error instanceof GuideBuildError) {
      throw new PipelineError(
        error.message || 'На листе не нашлось ни одного размера или обозначения.',
        'Попробуйте более чёткий скан или откройте пример — инструкция по нему соберётся сразу.',
      );
    }
    throw new PipelineError('Не удалось собрать инструкцию из распознанного листа.', backendHint());
  }
}

/**
 * По одной обрезке листа на шаг: именно эти фрагменты попадут на страницы PDF.
 *
 * Приоритет у зоны, которую посчитал движок/сборщик (`cropPercent`): для таблицы позиций это
 * строка спецификации, для вида — подпись вида. Без зоны режем по распознанным обозначениям шага.
 */
async function fragmentsFor(doc: IkGuideDocument, pages: readonly VisionPage[]): Promise<Record<string, string>> {
  const dataUrl = pages.find((page) => page.imageDataUrl)?.imageDataUrl;
  if (!dataUrl) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const step of doc.steps) {
    const zone = step.cropPercent;
    if (zone) {
      const fragment = await cropSheet(dataUrl, {
        x: zone.x / 100,
        y: zone.y / 100,
        width: zone.w / 100,
        height: zone.h / 100,
      });
      if (fragment) {
        result[step.id] = fragment;
        continue;
      }
    }
    const fragment = await stepFragment(dataUrl, doc.xrayAnnotations, step.drawingRefs ?? []);
    if (fragment) {
      result[step.id] = fragment;
    }
  }
  return result;
}

async function coverFragmentFor(pages: readonly VisionPage[]): Promise<string | null> {
  const dataUrl = pages.find((page) => page.imageDataUrl)?.imageDataUrl;
  if (!dataUrl) {
    return null;
  }
  return cropSheet(dataUrl, { x: 0.03, y: 0.02, width: 0.94, height: 0.94 }, 900);
}

/** Главная точка входа экрана загрузки. */
export async function importFiles(files: readonly File[], report: ProgressReporter = () => {}): Promise<PipelineResult> {
  if (files.length === 0) {
    throw new PipelineError('Файл не выбран.', 'Перетащите 2D-чертёж или PDF в окно.');
  }
  for (const file of files) {
    if (!isDrawingFile(file.name)) {
      throw new PipelineError(
        `Формат ${extensionOf(file.name) || 'без расширения'} не поддерживается.`,
        `Подойдут только 2D-чертежи: ${ACCEPTED_FORMATS_LABEL}.`,
      );
    }
  }

  report('reading', 'Читаем файл');
  return fromDrawings([...files], report);
}
