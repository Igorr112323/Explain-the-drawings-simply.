// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { DEMO_PROJECTS } from '../data/demos';
import { buildIllustrations } from './illustrations';
import { buildPlan, fileNameFor, renderPdf } from './pdfExport';

/** Белый PNG 1×1: минимальная настоящая картинка для проверки ветки PlanImage. */
const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const latin1 = (bytes: Uint8Array): string => {
  let result = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return result;
};

/** Разжимает все потоки PDF: jsPDF пишет CMap и содержимое страниц через FlateDecode. */
function streams(bytes: Uint8Array): string[] {
  const raw = latin1(bytes);
  const marker = /stream\r?\n/g;
  const result: string[] = [];
  let match = marker.exec(raw);
  while (match) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) {
      break;
    }
    const slice = raw.slice(start, end);
    let inflated: string | null = null;
    for (const trim of [0, 1, 2]) {
      const body = trim === 0 ? slice : slice.slice(0, slice.length - trim);
      const data = new Uint8Array(body.length);
      for (let index = 0; index < body.length; index += 1) {
        data[index] = body.charCodeAt(index) & 0xff;
      }
      try {
        inflated = latin1(inflateSync(data));
        break;
      } catch {
        // пробуем другую длину
      }
    }
    if (inflated) {
      result.push(inflated);
    }
    marker.lastIndex = end + 'endstream'.length;
    match = marker.exec(raw);
  }
  return result;
}

function cmapCharacters(chunks: readonly string[]): Set<string> {
  const chars = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.includes('bfchar')) {
      continue;
    }
    for (const pair of chunk.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const unicode = pair[2]!;
      if (unicode.length === 4) {
        chars.add(String.fromCharCode(parseInt(unicode, 16)));
      }
    }
  }
  return chars;
}

describe('настоящий PDF-файл', () => {
  it('на каждый пример собирает бинарный PDF с несколькими страницами', async () => {
    for (const project of DEMO_PROJECTS) {
      const illustrations = buildIllustrations(project.document);
      const job = await renderPdf(project.document, illustrations);

      expect(job.fileName.endsWith('_инструкция.pdf'), job.fileName).toBe(true);
      expect(job.bytes.byteLength).toBeGreaterThan(20000);
      const raw = latin1(job.bytes);
      expect(raw.startsWith('%PDF-')).toBe(true);
      expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
      const pages = raw.match(/\/Type\s*\/Page[^s]/g) ?? [];
      expect(pages.length, `${project.id}: страницы`).toBe(job.plan.pages.length);
      expect(job.plan.pages.length).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);

  it('пишет кириллицу настоящим вшитым шрифтом, а не картинкой', async () => {
    const project = DEMO_PROJECTS.find((item) => item.id === 'demo-bracket')!;
    const job = await renderPdf(project.document, buildIllustrations(project.document));
    const raw = latin1(job.bytes);

    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/ToUnicode');
    expect(raw).not.toMatch(/\/Subtype\s*\/Image/);

    // Все символы, которые реально есть в плане, обязаны иметь карту в ToUnicode-CMap:
    // иначе в PDF получились бы пустые квадраты вместо русского текста.
    const planText = job.plan.pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.kind === 'text')
      .flatMap((block) => (block.kind === 'text' ? block.lines : []))
      .join('');
    const used = new Set([...planText].filter((char) => /[А-Яа-яЁёØ±°×№]/.test(char)));
    expect(used.size).toBeGreaterThan(30);
    const chars = cmapCharacters(streams(job.bytes));
    for (const char of used) {
      expect(chars.has(char), `нет карты для «${char}»`).toBe(true);
    }
    for (const letter of 'Ø×°') {
      expect(chars.has(letter), `нет карты для «${letter}»`).toBe(true);
    }
  }, 60_000);

  it('вставляет схемы шагов векторами (синий акцент IKEA и контуры)', async () => {
    const project = DEMO_PROJECTS.find((item) => item.id === 'demo-up08-3d')!;
    const job = await renderPdf(project.document, buildIllustrations(project.document));
    const content = streams(job.bytes).filter((chunk) => chunk.includes(' Td')).join('\n');
    expect(content.length).toBeGreaterThan(5000);
    // Синий акцент #007AFF: 0 / 0.478 / 1 в цветовых операторах PDF.
    expect(content).toMatch(/0\.?\s*0\.478\d*\s+1\.?\s+(RG|rg)/i);
    // И другие цвета линий: чёрные контуры, серые размеры.
    expect(content.match(/\d+\.?\d*\s+\d+\.?\d*\s+\d+\.?\d*\s+(RG|rg)/gi)?.length ?? 0).toBeGreaterThan(2);
  }, 60_000);

  it('фрагмент листа печатается как картинка внутри страницы шага', async () => {
    const project = DEMO_PROJECTS.find((item) => item.id === 'demo-bracket')!;
    const step = project.document.steps[0]!;
    const job = await renderPdf(project.document, {
      ...buildIllustrations(project.document),
      steps: {
        ...buildIllustrations(project.document).steps,
        [step.id]: { imageDataUrl: ONE_PIXEL_PNG },
      },
    });
    const raw = latin1(job.bytes);
    expect(raw).toMatch(/\/Subtype\s*\/Image/);
    expect(job.plan.pages.length).toBeGreaterThan(2);
  }, 60_000);

  it('одинаковый документ даёт одинаковый файл', async () => {
    const project = DEMO_PROJECTS.find((item) => item.id === 'demo-gearbox')!;
    const illustrations = buildIllustrations(project.document);
    const first = await renderPdf(project.document, illustrations);
    const second = await renderPdf(project.document, illustrations);
    expect(second.bytes.byteLength).toBe(first.bytes.byteLength);
    expect(fileNameFor(project.document)).toBe(first.fileName);
  }, 60_000);

  it('план совпадает с тем, что рендерится: страницы, шаги и чек-лист', () => {
    const project = DEMO_PROJECTS.find((item) => item.id === 'demo-bracket')!;
    const plan = buildPlan(project.document, buildIllustrations(project.document));
    const text = plan.pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.kind === 'text')
      .map((block) => block.lines.join(' '))
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(text).toContain('ЧТО ПОНАДОБИТСЯ');
    expect(text).toContain('ВОЗЬМИ ИНСТРУМЕНТ');
    expect(text).toContain('ШПАРГАЛКА');
    expect(text).toContain('Стр. 1 из');
    expect(plan.pages.length).toBeGreaterThan(2);
  });
});
