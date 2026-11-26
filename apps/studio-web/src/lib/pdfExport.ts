/**
 * «Скачать PDF-инструкцию» — вся цепочка от документа до файла на диске.
 *
 * Вёрстка (`@ikguide/pdf-exporter/plan`) нужна сразу: из неё рисуется живой предпросмотр. А сам
 * рендер (jsPDF + svg2pdf, ~0,5 МБ) подгружается только в момент нажатия кнопки — поэтому экран
 * загрузки открывается мгновенно даже на слабом ноутбуке.
 */
import type { IkGuideDocument } from '@ikguide/schema';
import {
  buildInstructionPlan,
  instructionFileName,
  type IllustrationInput,
  type InstructionPlan,
} from '@ikguide/pdf-exporter/plan';
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
  const { renderInstructionPdf } = await import('@ikguide/pdf-exporter/render');
  const bytes = await renderInstructionPdf(plan);
  return { plan, bytes, fileName: fileNameFor(doc) };
}

/** Сохраняет готовый PDF: нативный «Сохранить как…» в `.exe`, скачивание в браузере. */
export async function downloadPdf(job: PdfJob): Promise<SaveFileResult> {
  return savePdfFile(job.fileName, job.bytes);
}
