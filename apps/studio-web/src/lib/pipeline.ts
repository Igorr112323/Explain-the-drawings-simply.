/**
 * Конвейер «файл → документ инструкции».
 *
 * Один вход для всех форматов:
 *   • картинка/PDF  → `/v1/recognize` (локальный vision-api) → `buildGuideFromVision`;
 *   • `.glb`/`.gltf`→ разбор прямо в браузере (three.js), сервер не нужен;
 *   • `.step`/`.stp`/`.stl`/`.obj` → `/v1/cad/import` (локальный cad-api) → `buildGuideFromCad`;
 *   • демо          → готовые документы из `data/demos.ts`, работают офлайн.
 *
 * Ошибки заворачиваются в `PipelineError` с человеческим заголовком и подсказкой, чтобы экран
 * мог показать не стектрейс, а «запустите npm run dev:all» и кнопку «открыть пример».
 */
import { buildGuideFromCad, buildGuideFromVision, GuideBuildError } from '@ikguide/builder';
import type { CadImportResponse, VisionPage, VisionRecognizeResponse } from '@ikguide/builder';
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';
import { CadError, cadImport } from './cad';
import { OfflineImportError, importMeshOffline } from './cadOffline';
import { DEMO_BY_ID, type DemoId } from '../data/demos';
import { backendHint } from './runtimeConfig';
import { VisionError, recognizeSheets } from './vision';

export const DRAWING_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'] as const;
export const MODEL_EXTENSIONS = ['.step', '.stp', '.stl', '.obj', '.glb', '.gltf'] as const;
export const ACCEPTED_EXTENSIONS = [...DRAWING_EXTENSIONS, ...MODEL_EXTENSIONS] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(',');

export type InputKind = 'drawing' | 'model';
export type PipelinePhase = 'reading' | 'recognizing' | 'building' | 'ready';
export type ProgressReporter = (phase: PipelinePhase, detail?: string) => void;
export type PipelineSource = 'vision' | 'cad' | 'glb' | 'demo';
export type { DemoId };

export interface PipelineResult {
  doc: IkGuideDocument;
  /** Растровые листы чертежа: нужны, чтобы кликом по значку править расшифровку. */
  pages: VisionPage[];
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

export function classifyFile(fileName: string): InputKind | null {
  const extension = extensionOf(fileName);
  if ((DRAWING_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'drawing';
  }
  if ((MODEL_EXTENSIONS as readonly string[]).includes(extension)) {
    return 'model';
  }
  return null;
}

export function titleFromFileName(fileName: string): string {
  const base = fileName.slice(0, fileName.length - extensionOf(fileName).length).replace(/[\s_]+/g, ' ').trim();
  return base.length > 0 ? base : 'Деталь по чертежу';
}

/** Демо открывается без сети: документы уже лежат в бандле. */
export async function openDemo(id: DemoId): Promise<PipelineResult> {
  const project = DEMO_BY_ID[id];
  if (!project) {
    throw new PipelineError('Такого примера нет в сборке.', 'Выберите один из трёх примеров на главном экране.');
  }
  return {
    doc: ikGuideDocumentSchema.parse(JSON.parse(JSON.stringify(project.document))) as IkGuideDocument,
    pages: [],
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
          : 'Проверьте файл: поддерживаются JPG, PNG, WEBP и PDF до 20 МБ, до 8 листов.';
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
    return {
      doc: result.document,
      pages: response.pages ?? [],
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

async function cadResponseFor(file: File): Promise<{ response: CadImportResponse; source: PipelineSource }> {
  const extension = extensionOf(file.name);
  if (extension === '.glb' || extension === '.gltf') {
    try {
      return { response: await importMeshOffline(file, { fileName: file.name }), source: 'glb' };
    } catch {
      // Повреждённый или нестандартный GLB: пробуем серверный разбор, он терпимее.
    }
  }
  return { response: await cadImport(file), source: 'cad' };
}

async function fromModel(file: File, report: ProgressReporter): Promise<PipelineResult> {
  report('recognizing', `Разбираем 3D-модель: ${file.name}`);
  let payload: { response: CadImportResponse; source: PipelineSource };
  try {
    payload = await cadResponseFor(file);
  } catch (error) {
    if (error instanceof OfflineImportError) {
      throw new PipelineError(
        error.message,
        'Файл .glb/.gltf читается прямо в браузере. Для STEP/STL/OBJ нужен бэкенд: npm run dev:all.',
      );
    }
    if (error instanceof CadError) {
      const hint =
        error.kind === 'offline'
          ? backendHint()
          : 'Проверьте модель: STEP до 50 МБ, сборка должна содержать хотя бы две детали.';
      throw new PipelineError(error.message, hint);
    }
    throw new PipelineError('Не удалось прочитать 3D-модель.', backendHint());
  }

  report('building', 'Строим порядок сборки и схемы шагов');
  try {
    const result = buildGuideFromCad(payload.response, {
      title: titleFromFileName(file.name),
      createdAt: new Date().toISOString(),
    });
    return {
      doc: result.document,
      pages: [],
      warnings: result.warnings,
      source: payload.source,
      files: [file.name],
    };
  } catch (error) {
    if (error instanceof GuideBuildError) {
      throw new PipelineError(
        error.message || 'Из модели не получилось собрать шаги.',
        'Попробуйте другую модель или откройте пример «Узел привода УП-08».',
      );
    }
    throw new PipelineError('Не удалось собрать инструкцию из модели.', backendHint());
  }
}

/** Главная точка входа экрана загрузки. */
export async function importFiles(files: readonly File[], report: ProgressReporter = () => {}): Promise<PipelineResult> {
  if (files.length === 0) {
    throw new PipelineError('Файл не выбран.', 'Перетащите чертёж или 3D-модель в окно.');
  }
  const drawings: File[] = [];
  const models: File[] = [];
  for (const file of files) {
    const kind = classifyFile(file.name);
    if (kind === 'drawing') {
      drawings.push(file);
    } else if (kind === 'model') {
      models.push(file);
    } else {
      throw new PipelineError(
        `Формат ${extensionOf(file.name) || 'без расширения'} не поддерживается.`,
        'Подойдут JPG, PNG, WEBP, PDF и 3D: STEP, STP, STL, OBJ, GLB, GLTF.',
      );
    }
  }

  report('reading', 'Читаем файл');
  if (drawings.length > 0) {
    return fromDrawings(drawings, report);
  }
  const model = models[0]!;
  if (models.length > 1) {
    report('reading', 'Собираем несколько файлов в один узел');
  }
  return fromModel(model, report);
}
