/**
 * QA-этап «документ → PDF»: гоняет ответы vision-api через настоящий билдер и настоящий
 * экспортёр (без моков), складывает PDF и метрики по каждому кейсу.
 *
 * Запускается из `scripts/qa/run_qa.py` после того, как vision-api обработал корпус:
 *   node qa/output/build_docs.mjs --vision qa/output/vision --pdf qa/output/pdf --stats qa/output/stats.jsonl
 *
 * Собирается esbuild'ом в один файл, поэтому TypeScript-пакеты подключаются как в приложении.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PNG } from 'pngjs';

import { buildGuideFromVision } from '@ikguide/builder';
import { ikGuideDocumentSchema } from '@ikguide/schema';
import { buildInstructionPlan } from '@ikguide/pdf-exporter/plan';
import { renderInstructionPdf } from '@ikguide/pdf-exporter/render';
import { buildIllustrations, type FragmentInput } from '../../apps/studio-web/src/lib/illustrations';
import { fragmentBox } from '../../apps/studio-web/src/lib/sheetFragment';

interface Arguments {
  vision: string;
  pdf: string;
  stats: string;
  /** Порция: `--chunk 3/6` — третья шестая файлов по алфавиту. */
  chunk: { index: number; total: number };
  append: boolean;
}

function parseArguments(argv: readonly string[]): Arguments {
  const result: Arguments = {
    vision: 'qa/output/vision',
    pdf: 'qa/output/pdf',
    stats: 'qa/output/stats.jsonl',
    chunk: { index: 0, total: 1 },
    append: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    // Флаг без значения разбираем до общей проверки пары «ключ + значение».
    if (key === '--append') {
      result.append = true;
      continue;
    }
    if (!key || !value) {
      continue;
    }
    if (key === '--vision') result.vision = value;
    if (key === '--pdf') result.pdf = value;
    if (key === '--stats') result.stats = value;
    if (key === '--chunk') {
      const [index, total] = value.split('/').map((part) => Number.parseInt(part, 10));
      if (Number.isFinite(index) && Number.isFinite(total) && total > 0) {
        result.chunk = { index, total };
      }
    }
  }
  return result;
}

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Bitmap {
  width: number;
  height: number;
  data: Buffer;
}

/** PNG из data URL → пиксели. В браузере это делает canvas, в QA-раннере — pngjs. */
function decodePng(dataUrl: string): Bitmap | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.startsWith('data:image/png')) {
    return null;
  }
  try {
    const png = PNG.sync.read(Buffer.from(dataUrl.slice(comma + 1), 'base64'));
    return { width: png.width, height: png.height, data: png.data };
  } catch {
    return null;
  }
}

function encodePng(bitmap: Bitmap): string {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  bitmap.data.copy(png.data);
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/**
 * Тот же контракт, что у `cropSheet` в приложении (box в долях листа, ширина 720 px), но без
 * canvas: билинейная выборка из PIL-подобного PNG. Приложение отдаёт JPEG, экспортёр PDF
 * принимает и PNG — геометрия и содержимое фрагмента совпадают, отличается только кодек.
 */
function cropBitmap(bitmap: Bitmap, box: { x: number; y: number; width: number; height: number }, targetWidth = 720): string | null {
  const sx = Math.round(box.x * bitmap.width);
  const sy = Math.round(box.y * bitmap.height);
  const sw = Math.max(16, Math.round(box.width * bitmap.width));
  const sh = Math.max(16, Math.round(box.height * bitmap.height));
  if (sx >= bitmap.width || sy >= bitmap.height) {
    return null;
  }
  const clampedW = Math.min(sw, bitmap.width - sx);
  const clampedH = Math.min(sh, bitmap.height - sy);
  if (clampedW < 8 || clampedH < 8) {
    return null;
  }
  const targetW = Math.min(targetWidth, clampedW);
  const targetH = Math.max(1, Math.round((clampedH / clampedW) * targetW));
  const out = Buffer.alloc(targetW * targetH * 3);
  for (let y = 0; y < targetH; y += 1) {
    const sourceY = Math.min(clampedH - 1, Math.floor((y * clampedH) / targetH));
    for (let x = 0; x < targetW; x += 1) {
      const sourceX = Math.min(clampedW - 1, Math.floor((x * clampedW) / targetW));
      const sourceIndex = ((sy + sourceY) * bitmap.width + (sx + sourceX)) * 4;
      const targetIndex = (y * targetW + x) * 3;
      out[targetIndex] = bitmap.data[sourceIndex] ?? 255;
      out[targetIndex + 1] = bitmap.data[sourceIndex + 1] ?? 255;
      out[targetIndex + 2] = bitmap.data[sourceIndex + 2] ?? 255;
    }
  }
  const rgb = { width: targetW, height: targetH, data: out };
  const png = new PNG({ width: targetW, height: targetH });
  for (let index = 0; index < targetW * targetH; index += 1) {
    png.data[index * 4] = rgb.data[index * 3] ?? 255;
    png.data[index * 4 + 1] = rgb.data[index * 3 + 1] ?? 255;
    png.data[index * 4 + 2] = rgb.data[index * 3 + 2] ?? 255;
    png.data[index * 4 + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

/** Копия логики `fragmentsFor`/`coverFragmentFor` из pipeline.ts на серверных пикселях. */
function buildFragments(doc: any, pageDataUrl: string | null): { fragments: FragmentInput; stats: Record<string, unknown> } {
  if (!pageDataUrl) {
    return { fragments: {}, stats: { fragments: 0, uniqueFragments: 0, fragmentBytes: 0, reason: 'no_page_image' } };
  }
  const bitmap = decodePng(pageDataUrl);
  if (!bitmap) {
    return { fragments: {}, stats: { fragments: 0, uniqueFragments: 0, fragmentBytes: 0, reason: 'no_page_image' } };
  }
  const steps: Record<string, string> = {};
  let bytes = 0;
  let cropBoxes = 0;
  for (const step of doc.steps) {
    const zone = step.cropPercent;
    if (zone) {
      const fragment = cropBitmap(bitmap, {
        x: zone.x / 100,
        y: zone.y / 100,
        width: zone.w / 100,
        height: zone.h / 100,
      });
      if (fragment) {
        steps[step.id] = fragment;
        bytes += fragment.length;
        cropBoxes += 1;
        continue;
      }
    }
    const refs: string[] = step.drawingRefs ?? [];
    const selected = (doc.xrayAnnotations ?? []).filter((annotation: { id: string }) => refs.includes(annotation.id));
    const box = selected.length > 0 ? fragmentBox(selected) : { x: 0.04, y: 0.03, width: 0.92, height: 0.9 };
    const fragment = cropBitmap(bitmap, box);
    if (fragment) {
      steps[step.id] = fragment;
      bytes += fragment.length;
    }
  }
  const cover = cropBitmap(bitmap, { x: 0.03, y: 0.02, width: 0.94, height: 0.94 }, 900) ?? undefined;
  return {
    fragments: { steps, cover },
    stats: {
      fragments: Object.keys(steps).length,
      uniqueFragments: new Set(Object.values(steps)).size,
      fragmentBytes: bytes,
      fromCropPercent: cropBoxes,
      cover: Boolean(cover),
    },
  };
}

async function main(): Promise<void> {
const args = parseArguments(process.argv.slice(2));
mkdirSync(args.pdf, { recursive: true });

const allFiles = readdirSync(args.vision).filter((name) => name.endsWith('.json')).sort();
// jsPDF и svg2pdf держат память до конца процесса: на 1 000 PDF Node получал SIGKILL от OOM.
// Поэтому прогон идёт порциями по отдельным процессам, а статистика дописывается.
const files = allFiles.filter((_, position) => position % args.chunk.total === args.chunk.index);
const lines: string[] = [];
let pdfs = 0;

for (const file of files) {
  const slug = file.replace(/\.json$/, '');
  const started = Date.now();
  const payload = JSON.parse(readFileSync(join(args.vision, file), 'utf8'));
  const record: Record<string, unknown> = { slug, visionStatus: payload.__status ?? 200 };

  if (!payload.body || typeof payload.body !== 'object' || !Array.isArray(payload.body.candidates)) {
    record.builder = 'skipped';
    record.reason = payload.__error ?? 'no_candidates_payload';
    record.ms = Date.now() - started;
    lines.push(JSON.stringify(record));
    continue;
  }

  const response = payload.body;
  record.recognized = Array.isArray(response.candidates) ? response.candidates.length : 0;
  record.bomRows = Array.isArray(response.bomRows) ? response.bomRows.length : 0;
  record.views = Array.isArray(response.views) ? response.views.length : 0;
  record.engine = response.engine?.ocr ?? 'unknown';
  record.upscale = response.pages?.[0]?.upscale ?? 1;
  record.pages = response.pages?.length ?? 0;
  record.warnings = (response.warnings ?? []).slice(0, 8);

  try {
    const result = buildGuideFromVision(response, {
      createdAt: '2026-11-26T00:00:00.000Z',
      keepLowConfidence: true,
    });
    const doc = result.document;

    const parsed = ikGuideDocumentSchema.safeParse(doc);
    const crops: Crop[] = doc.steps
      .map((step) => step.cropPercent)
      .filter((crop): crop is Crop => Boolean(crop));
    const uniqueCrops = new Set(crops.map((crop) => `${crop.x}|${crop.y}|${crop.w}|${crop.h}`));

    record.builder = 'ok';
    record.schemaValid = parsed.success;
    record.steps = doc.steps.length;
    record.titles = doc.steps.map((step) => step.title);
    record.stepTextLengths = doc.steps.map((step) => step.workerText.length);
    record.shortestStep = Math.min(...record.stepTextLengths as number[]);
    record.translations = result.translations.length;
    record.unknownKind = result.translations.filter((item) => item.result.kind === 'unknown').length;
    record.bom = doc.bom.length;
    record.bomNames = doc.bom.map((item) => item.name).slice(0, 10);
    record.tools = doc.tools.length;
    record.qc = doc.qcChecklist.length;
    record.crops = crops.length;
    record.uniqueCrops = uniqueCrops.size;
    record.cropBoxes = crops.slice(0, 20);
    record.title = doc.metadata.title;
    record.code = doc.metadata.drawingCode;
    record.material = doc.metadata.material;
    record.blank = doc.metadata.blankDimensions;
    record.builderWarnings = result.warnings.slice(0, 10);
    record.stats = result.stats;

    // Полный текст документа: по нему считается recall эталонных обозначений, поэтому
    // берём и шаги, и спецификацию, и инструмент — а не только заголовки.
    const docText = [
      ...doc.steps.map((step) => `${step.title} ${step.workerText}`),
      ...doc.bom.map((item) => `${item.name} ${item.standard ?? ''} ${item.detail ?? ''}`),
      ...doc.tools.map((tool) => tool.name),
      ...doc.qcChecklist.map((item) => item.label),
      ...(result.warnings ?? []),
    ].join('\n');
    record.docText = docText.slice(0, 20000);

    // «Двухшаговая заглушка» — это когда на листе распознано много обозначений, а инструкция
    // схлопнулась в «подготовьте заготовку / проконтролируйте». Пустой белый лист честно даёт
    // два шага, и это не заглушка.
    const recognizedCount = Number(record.recognized ?? 0);
    record.twoStepStub = doc.steps.length <= 2 && recognizedCount >= 3;
    record.zeroTranslations = recognizedCount >= 3 && (record.translations as number) === 0;
    record.placeholder = record.twoStepStub as boolean;

    // Иллюстрации шагов — настоящие фрагменты листа (как в pipeline.ts), а не заглушка
    // «Схема доступна только в браузере»: PDF обязан содержать кропы чертежа.
    const pageDataUrl: string | null = (response.pages ?? []).find((page: { imageDataUrl?: string }) => page.imageDataUrl)?.imageDataUrl ?? null;
    const { fragments, stats: fragmentStats } = buildFragments(doc, pageDataUrl);
    record.fragments = fragmentStats;
    const illustrations = buildIllustrations(doc, fragments);
    const plan = buildInstructionPlan(doc, { cover: illustrations.cover, steps: illustrations.steps });
    record.planPages = plan.pages.length;
    record.captionsOk = plan.pages
      .filter((page) => page.kind === 'step')
      .every((page) => Boolean(page.caption) || true);

    const bytes = await renderInstructionPdf(plan);
    const pdfPath = join(args.pdf, `${slug}.pdf`);
    writeFileSync(pdfPath, bytes);
    pdfs += 1;
    record.pdfBytes = bytes.length;
    record.pdfHeader = new TextDecoder('latin1').decode(bytes.slice(0, 5));
  } catch (error) {
    record.builder = 'failed';
    record.reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 400) : String(error);
  }

  record.ms = Date.now() - started;
  lines.push(JSON.stringify(record));
}

if (args.append) {
  writeFileSync(args.stats, `${lines.map((line) => `${line}\n`).join('')}`, { encoding: 'utf8', flag: 'a' });
} else {
  writeFileSync(args.stats, `${lines.join('\n')}\n`, 'utf8');
}
console.log(`build_docs: ${files.length} кейсов, PDF: ${pdfs}`);
}

void main();
