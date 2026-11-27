/**
 * Рисование плана в настоящий бинарный `.pdf` — без диалога печати, без `window.print()`.
 *
 * jsPDF собирает документ в памяти и отдаёт байты; SVG-схемы шагов проходят через `svg2pdf.js`, то есть
 * остаются векторами (никаких скриншотов), а кириллица берётся из встроенного подмножества DejaVu Sans.
 * Всё это работает и в браузере, и в jsdom-тестах, и в упакованном `.exe` — сеть не нужна.
 */
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js/dist/svg2pdf.es.min.js';
import { DEJAVU_BOLD_BASE64, DEJAVU_REGULAR_BASE64 } from './fonts/dejavu';
import { COLORS, type InstructionPlan, type PlanBlock } from './plan';
import { PT_MM } from './text';

/** Имя семейства внутри PDF: одно, два начертания. */
export const PDF_FONT_FAMILY = 'IKGuideSans';

const FONT_FILES = [
  { name: 'IKGuideSans-Regular.ttf', base64: DEJAVU_REGULAR_BASE64, style: 'normal' },
  { name: 'IKGuideSans-Bold.ttf', base64: DEJAVU_BOLD_BASE64, style: 'bold' },
] as const;

type Pdf = jsPDF;

function registerFonts(doc: Pdf): void {
  for (const font of FONT_FILES) {
    doc.addFileToVFS(font.name, font.base64);
    doc.addFont(font.name, PDF_FONT_FAMILY, font.style);
  }
}

/**
 * Убирает из SVG всё, что нельзя пускать в PDF: скрипты, обработчики событий, внешние ссылки.
 * Схемы приходят из нашего же конвейера, но чертёж загружает пользователь — доверять на слово нельзя.
 */
export function sanitizeSvgForPdf(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(?!#)([^"']*)\2/gi, '$1=$2#$2');
}

function color(value: string | null | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function drawText(doc: Pdf, block: Extract<PlanBlock, { kind: 'text' }>): void {
  doc.setFont(PDF_FONT_FAMILY, block.weight);
  doc.setFontSize(block.size);
  doc.setTextColor(color(block.color, COLORS.ink));
  const lineStep = block.size * PT_MM * 1.28;
  block.lines.forEach((line, index) => {
    if (!line) {
      return;
    }
    const baseline = block.y + lineStep * index + block.size * PT_MM * 0.92;
    const x = block.align === 'center' ? block.x + block.w / 2 : block.align === 'right' ? block.x + block.w : block.x;
    doc.text(line, x, baseline, { align: block.align, baseline: 'alphabetic' });
  });
}

function drawRect(doc: Pdf, block: Extract<PlanBlock, { kind: 'rect' }>): void {
  const hasFill = Boolean(block.fill);
  const hasStroke = Boolean(block.stroke);
  if (!hasFill && !hasStroke) {
    return;
  }
  const style = hasFill && hasStroke ? 'FD' : hasFill ? 'F' : 'S';
  if (hasFill) {
    doc.setFillColor(color(block.fill, COLORS.paper));
  }
  if (hasStroke) {
    doc.setDrawColor(color(block.stroke, COLORS.line));
    doc.setLineWidth(block.lineWidth);
  }
  if (block.radius > 0) {
    doc.roundedRect(block.x, block.y, block.w, block.h, block.radius, block.radius, style);
  } else {
    doc.rect(block.x, block.y, block.w, block.h, style);
  }
}

function drawLine(doc: Pdf, block: Extract<PlanBlock, { kind: 'line' }>): void {
  doc.setDrawColor(color(block.color, COLORS.line));
  doc.setLineWidth(block.lineWidth);
  doc.line(block.x1, block.y1, block.x2, block.y2);
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' | 'WEBP' {
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
    return 'JPEG';
  }
  if (dataUrl.startsWith('data:image/webp')) {
    return 'WEBP';
  }
  return 'PNG';
}

async function drawSvg(doc: Pdf, block: Extract<PlanBlock, { kind: 'svg' }>): Promise<void> {
  if (typeof document === 'undefined') {
    // Без DOM вектор не нарисовать: рисуем честную рамку вместо пустого места.
    drawFallback(doc, block, 'Схема доступна только в браузере');
    return;
  }
  const host = document.createElement('div');
  host.setAttribute('data-ikguide-pdf', '');
  host.style.position = 'absolute';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = `${block.w}mm`;
  host.innerHTML = sanitizeSvgForPdf(block.markup);
  const svg = host.querySelector('svg');
  if (!svg) {
    drawFallback(doc, block, 'Схема не распознана');
    return;
  }
  // Кириллица в подписях схемы должна идти тем же шрифтом, что и весь PDF.
  svg.setAttribute('style', `${svg.getAttribute('style') ?? ''};font-family:${PDF_FONT_FAMILY}`);
  svg.setAttribute('width', `${block.w}`);
  svg.setAttribute('height', `${block.h}`);
  if (!svg.getAttribute('viewBox')) {
    const width = Number(svg.getAttribute('width')) || 100;
    const height = Number(svg.getAttribute('height')) || 100;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  svg.querySelectorAll('text').forEach((node) => {
    const element = node as SVGTextElement;
    element.style.fontFamily = PDF_FONT_FAMILY;
    const weight = Number(element.getAttribute('font-weight') ?? '400');
    element.style.fontWeight = Number.isFinite(weight) && weight >= 600 ? 'bold' : 'normal';
    if (!element.style.fill && !element.getAttribute('fill')) {
      element.style.fill = COLORS.ink;
    }
  });
  document.body.appendChild(host);
  try {
    await svg2pdf(svg as SVGSVGElement, doc as unknown as Parameters<typeof svg2pdf>[1], {
      x: block.x,
      y: block.y,
      width: block.w,
      height: block.h,
    });
  } catch {
    drawFallback(doc, block, 'Схема не поместилась в PDF');
  } finally {
    host.remove();
  }
}

function drawFallback(doc: Pdf, block: Extract<PlanBlock, { kind: 'svg' }>, label: string): void {
  doc.setFillColor(COLORS.chip);
  doc.roundedRect(block.x, block.y, block.w, block.h, 2, 2, 'F');
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(COLORS.faint);
  doc.text(label, block.x + block.w / 2, block.y + block.h / 2, { align: 'center' });
}

function drawImage(doc: Pdf, block: Extract<PlanBlock, { kind: 'image' }>): void {
  try {
    doc.addImage(block.dataUrl, imageFormat(block.dataUrl), block.x, block.y, block.w, block.h);
  } catch {
    doc.setDrawColor(COLORS.line);
    doc.rect(block.x, block.y, block.w, block.h, 'S');
  }
}

/** Рисует весь план и отдаёт готовые байты файла. Повторные вызовы не переиспользуют документ. */
export async function renderInstructionPdf(plan: InstructionPlan): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  registerFonts(doc);
  doc.setProperties({
    title: plan.title,
    subject: 'Инструкция по сборке IkGuide',
    creator: 'IkGuide',
    author: 'IkGuide',
  });

  for (const page of plan.pages) {
    if (page.index > 1) {
      doc.addPage('a4', 'portrait');
    }
    for (const block of page.blocks) {
      switch (block.kind) {
        case 'text':
          drawText(doc, block);
          break;
        case 'rect':
          drawRect(doc, block);
          break;
        case 'line':
          drawLine(doc, block);
          break;
        case 'svg':
          await drawSvg(doc, block);
          break;
        case 'image':
          drawImage(doc, block);
          break;
      }
    }
  }

  return new Uint8Array(doc.output('arraybuffer'));
}

/** Заголовок файла — пригодится и тестам, и проверке «это точно PDF, а не HTML с печатью». */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
}

/** Быстрый предпросмотр: `.pdf`-байты в `blob:`-ссылку для новой вкладки. */
export function pdfBlobUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
}
