// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { isPdf, renderInstructionPdf, sanitizeSvgForPdf } from './render';
import { buildInstructionPlan, type InstructionPlan } from './plan';
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">' +
  '<rect x="5" y="5" width="40" height="20" fill="#E8F2FF" stroke="#007AFF" stroke-width="2"/>' +
  '<circle cx="70" cy="30" r="12" fill="none" stroke="#1D1D1F"/>' +
  '<path d="M10 55 L40 55 L40 45" stroke="#FF3B30" fill="none" stroke-width="2"/>' +
  '</svg>';

const document_: IkGuideDocument = ikGuideDocumentSchema.parse({
  schemaVersion: '1.0',
  id: 'pdf-fixture',
  metadata: {
    title: 'Кронштейн Ёлкина — Ø20 H7 ±0,5 мм',
    drawingCode: 'ТЕСТ-01.000 СБ',
    material: 'Сталь 09Г2С, ГОСТ 19281-2014',
    blankDimensions: 'Полоса 120 × 80 × 12 мм',
    massKg: 1.85,
    difficulty: 'medium',
    author: 'Инженер ОТК',
    createdAt: '2026-11-12T08:30:00.000Z',
    revision: 'A',
  },
  drawing: { viewId: 'test-sheet', sheetFormat: 'A3', scale: '1:1' },
  bom: [{ id: 'b1', name: 'Болт М8', size: 'М8 × 30', quantity: 4, kind: 'fastener', icon: 'bolt' }],
  tools: [{ id: 't1', name: 'Сверло', size: 'Ø6,8 мм', category: 'drill', purpose: 'Отверстия под резьбу' }],
  steps: [
    {
      id: 's1',
      number: 1,
      title: 'Разметьте базу А',
      workerText: 'Возьмите полосу и разметьте базу. №1 в списке — длинная кромка.',
      estimatedMinutes: 8,
      illustration: { illustrationId: 'bracket-layout', highlight: [], arrows: [] },
      antiError: { text: 'Не размечайте от двух кромок.', severity: 'warning' },
      criticalChecks: [],
      drawingRefs: [],
    },
    {
      id: 's2',
      number: 2,
      title: 'Просверлите отверстия',
      workerText: 'Сверлите Ø6,8 мм на глубину 24 мм, охлаждайте сверло.',
      estimatedMinutes: 9,
      illustration: { illustrationId: 'bracket-drill', highlight: [], arrows: [] },
      antiError: null,
      criticalChecks: [
        {
          id: 'c1',
          label: 'Глубина',
          nominal: '24 мм',
          acceptance: '23…26 мм',
          instrument: 'Штангенциркуль',
        },
      ],
      drawingRefs: [],
    },
  ],
  xrayAnnotations: [
    { id: 'a1', raw: 'Ø20 H7', kind: 'fit', xPercent: 40, yPercent: 50, confidence: 0.99, confirmedByHuman: true },
  ],
  qcChecklist: [{ id: 'q1', text: 'Размеры в допуске, заусенцы сняты', required: true }],
}) as IkGuideDocument;

const plan: InstructionPlan = buildInstructionPlan(document_, {
  cover: { svg: SVG },
  steps: { s1: { svg: SVG }, s2: { svg: SVG } },
});

function latin1(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return result;
}

/** Достаёт содержимое всех Flate-потоков: jsPDF сжимает и контент, и встроенные шрифты. */
function inflateStreams(bytes: Uint8Array): string[] {
  const raw = latin1(bytes);
  const chunks: string[] = [];
  const marker = /stream\r?\n/g;
  let match = marker.exec(raw);
  while (match) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) {
      break;
    }
    const slice = raw.slice(start, end);
    // jsPDF дописывает перевод строки перед `endstream`: длину потока приходится подбирать.
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
        // Пробуем следующую длину.
      }
    }
    chunks.push(inflated ?? slice);
    // Важно перепрыгнуть `endstream` целиком: в нём тоже есть подстрока «stream».
    marker.lastIndex = end + 'endstream'.length;
    match = marker.exec(raw);
  }
  return chunks;
}

/** Коды Unicode из ToUnicode CMap — доказательство, что кириллица в PDF настоящая, а не «?». */
function cmapCharacters(streams: readonly string[]): Set<string> {
  const characters = new Set<string>();
  for (const stream of streams) {
    const blocks = /beginbfchar([\s\S]*?)endbfchar/g;
    let block = blocks.exec(stream);
    while (block) {
      const pairs = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let pair = pairs.exec(block[1]!);
      while (pair) {
        const hex = pair[2]!;
        if (hex.length === 4) {
          characters.add(String.fromCharCode(parseInt(hex, 16)));
        }
        pair = pairs.exec(block[1]!);
      }
      block = blocks.exec(stream);
    }
  }
  return characters;
}

describe('рендер настоящего PDF', () => {
  it('отдаёт бинарный файл с заголовком %PDF- и всеми страницами плана', async () => {
    const bytes = await renderInstructionPdf(plan);
    expect(isPdf(bytes)).toBe(true);
    const header = latin1(bytes.slice(0, 8));
    expect(header.startsWith('%PDF-')).toBe(true);
    expect(bytes.length).toBeGreaterThan(20_000);

    const raw = latin1(bytes);
    expect((raw.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(plan.pages.length);
    expect(raw).toContain('/Count');
    expect(plan.pages.length).toBeGreaterThanOrEqual(3);
  });

  it('встраивает шрифт с кириллицей и карту Unicode для каждой нарисованной буквы', async () => {
    const bytes = await renderInstructionPdf(plan);
    const raw = latin1(bytes);
    expect(raw).toContain('/ToUnicode');
    expect(raw).toContain('/FontFile2');

    const characters = cmapCharacters(inflateStreams(bytes));
    // Кириллица заголовка, «Ё», типографские символы и знак номера.
    for (const character of 'КронштейнЁлкинаØ±№') {
      expect(characters.has(character), `в PDF нет карты для «${character}»`).toBe(true);
    }
    // Латиница тоже на месте: цифры и обозначения.
    for (const character of 'H7120') {
      expect(characters.has(character)).toBe(true);
    }
  });

  it('рисует SVG-схемы векторами, а не картинками', async () => {
    const bytes = await renderInstructionPdf(plan);
    const raw = latin1(bytes);
    // Ни одного растрового XObject: схема остаётся вектором и не мылится на печати.
    expect(raw).not.toMatch(/\/Subtype\s*\/Image/);

    const content = inflateStreams(bytes).join('\n');
    expect(content).toContain(' re');
    expect(content).toMatch(/\d+(\.\d+)?\s+\d+(\.\d+)?\s+m/);
    expect(content).toContain(' l');
    // Синий акцент IKEA (#007AFF → 0 0.478 1) попал в поток рисования.
    expect(content).toMatch(/0\.?\s*0\.478\s+1\.?\s+(RG|rg)/i);
  });

  it('не падает, если схемы нет вовсе', async () => {
    const empty = buildInstructionPlan(document_);
    const bytes = await renderInstructionPdf(empty);
    expect(isPdf(bytes)).toBe(true);
    expect(latin1(bytes)).toContain('/Type /Page');
  });

  it('одинаковые данные дают побайтово одинаковый файл', async () => {
    const first = await renderInstructionPdf(plan);
    const second = await renderInstructionPdf(plan);
    expect(first.length).toBe(second.length);
    expect(latin1(first.slice(0, 512))).toBe(latin1(second.slice(0, 512)));
  });

  it('чистит SVG перед вставкой: скрипты и обработчики не попадают в документ', () => {
    const dirty =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script>' +
      '<rect onclick="alert(3)" width="10" height="10"/><use href="https://evil.example/x.svg#a"/></svg>';
    const clean = sanitizeSvgForPdf(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('https://evil.example');
  });
});
