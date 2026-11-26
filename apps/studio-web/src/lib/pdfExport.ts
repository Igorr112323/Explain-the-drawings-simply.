/**
 * «Скачать PDF-инструкцию» — вся цепочка от документа до файла на диске.
 *
 * Вёрстка живёт в `@ikguide/pdf-exporter` (общая с тестами и предпросмотром), рендер — jsPDF +
 * svg2pdf с вшитым кириллическим шрифтом, поэтому в браузере нет ни сервера, ни диалога печати.
 */
import type { IkGuideDocument } from '@ikguide/schema';
import {
  buildInstructionPlan,
  instructionFileName,
  renderInstructionPdf,
  type IllustrationInput,
  type InstructionPlan,
} from '@ikguide/pdf-exporter';
import { savePdfFile, type SaveFileResult } from './nativeExport';

export interface PdfJob {
  plan: InstructionPlan;
  bytes: Uint8Array;
  fileName: string;
}

export interface PdfIllustrations {
  cover?: IllustrationInput;
  steps: Readonly<Record<string, IllustrationInput>>;
}

/** План листов A4 — тот же, что видит пользователь в предпросмотре. */
export function buildPlan(doc: IkGuideDocument, illustrations: PdfIllustrations): InstructionPlan {
  return buildInstructionPlan(doc, { cover: illustrations.cover, steps: illustrations.steps });
}

export function fileNameFor(doc: IkGuideDocument): string {
  return instructionFileName(doc.metadata.title, doc.metadata.drawingCode);
}

/** Рендерит настоящий бинарный PDF в памяти — файл появится только после явного сохранения. */
export async function renderPdf(doc: IkGuideDocument, illustrations: PdfIllustrations): Promise<PdfJob> {
  const plan = buildPlan(doc, illustrations);
  const bytes = await renderInstructionPdf(plan);
  return { plan, bytes, fileName: fileNameFor(doc) };
}

/** Сохраняет готовый PDF: нативный «Сохранить как…» в `.exe`, скачивание в браузере. */
export async function downloadPdf(job: PdfJob): Promise<SaveFileResult> {
  return savePdfFile(job.fileName, job.bytes);
}
