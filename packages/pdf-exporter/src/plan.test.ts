import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';
import { gearboxDocument } from '../../../apps/studio-web/src/data/gearbox';
import { buildInstructionPlan, instructionFileName, PAGE, type PlanBlock, type PlanText } from './plan';

const bracketDocument = ikGuideDocumentSchema.parse({
  schemaVersion: '1.0',
  id: 'plan-fixture-bracket',
  metadata: {
    title: 'Кронштейн крепления сервопривода КС-04',
    drawingCode: 'КС-04.100.000 СБ',
    material: 'Сталь 09Г2С, ГОСТ 19281-2014',
    blankDimensions: 'Полоса 120 × 80 × 12 мм',
    massKg: 1.85,
    difficulty: 'medium',
    author: 'Инженер ОТК Иванова А. П.',
    createdAt: '2026-11-12T08:30:00.000Z',
    revision: 'B',
  },
  drawing: { viewId: 'bracket-sheet', sheetFormat: 'A3', scale: '1:1' },
  bom: [
    { id: 'b1', name: 'Болт с шестигранной головкой', size: 'М8 × 30', quantity: 4, kind: 'fastener', icon: 'bolt' },
    { id: 'b2', name: 'Сервопривод SM-04', size: 'габарит 40 × 40 × 38 мм', quantity: 1, kind: 'purchased', icon: 'servo' },
  ],
  tools: [
    { id: 't1', name: 'Сверло', size: 'Ø6,8 мм', category: 'drill', purpose: 'Отверстия под резьбу М8' },
    { id: 't2', name: 'Калибр-пробка', size: 'Ø20 H7', category: 'gauge', purpose: 'Контроль отверстия' },
  ],
  steps: [
    {
      id: 's1',
      number: 1,
      title: 'Проверьте заготовку и разметьте базу А',
      workerText: 'Возьмите полосу 120 × 80 × 12 мм. Зачистите поверхность и проверьте деталь на плите.',
      estimatedMinutes: 8,
      illustration: { illustrationId: 'bracket-layout', highlight: [], arrows: [] },
      antiError: { text: 'Не размечайте от двух разных кромок: погрешности сложатся.', severity: 'warning' },
      criticalChecks: [
        {
          id: 'c1',
          label: 'Габарит заготовки',
          nominal: '120 × 80 × 12',
          acceptance: '±1,0 мм по общим допускам',
          instrument: 'Штангенциркуль',
        },
      ],
      drawingRefs: [],
    },
    {
      id: 's2',
      number: 2,
      title: 'Разверните отверстие Ø20 H7',
      workerText: 'Просверлите отверстие Ø19,8 мм, затем разверните развёрткой Ø20 H7.',
      estimatedMinutes: 12,
      illustration: { illustrationId: 'bracket-bore', highlight: [], arrows: [] },
      antiError: null,
      criticalChecks: [],
      drawingRefs: [],
    },
  ],
  xrayAnnotations: [
    {
      id: 'a1',
      raw: 'Ø20 H7',
      kind: 'fit',
      xPercent: 40,
      yPercent: 50,
      confidence: 0.99,
      confirmedByHuman: true,
    },
    {
      id: 'a2',
      raw: 'Ra 1.6',
      kind: 'roughness',
      xPercent: 60,
      yPercent: 30,
      confidence: 0.7,
      confirmedByHuman: false,
    },
  ],
  qcChecklist: [
    { id: 'q1', text: 'Ø20 H7 в допуске 20,000…20,021 мм', required: true },
    { id: 'q2', text: 'Заусенцы сняты, кромки притуплены', required: true },
  ],
}) as IkGuideDocument;

function plain(blocks: readonly PlanBlock[]): string {
  return blocks
    .filter((block): block is PlanText => block.kind === 'text')
    .map((block) => block.lines.join(' '))
    .join('\n');
}

/** Текст листа одной строкой: так проверки не зависят от того, где вёрстка перенесла строку. */
function flat(blocks: readonly PlanBlock[]): string {
  return plain(blocks).replace(/\s+/g, ' ');
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="5" y="5" width="40" height="20" /></svg>';

describe('план PDF-инструкции', () => {
  it('начинается с титульного листа: название, шифр, материал, заготовка, масса', () => {
    const plan = buildInstructionPlan(bracketDocument, { cover: { svg: SVG } });
    const cover = flat(plan.pages[0]!.blocks);
    expect(cover).toContain('Кронштейн крепления сервопривода КС-04');
    expect(cover).toContain('КС-04.100.000 СБ');
    expect(cover).toContain('МАТЕРИАЛ');
    expect(cover).toContain('Сталь 09Г2С');
    expect(cover).toContain('ЗАГОТОВКА');
    expect(cover).toContain('Полоса 120 × 80 × 12 мм');
    expect(cover).toContain('1,85 кг');
    expect(cover).toContain('2 шагов');
  });

  it('печатает «что понадобится» и «возьми инструмент» из спецификации', () => {
    const plan = buildInstructionPlan(bracketDocument);
    const cover = flat(plan.pages[0]!.blocks);
    expect(cover).toContain('ЧТО ПОНАДОБИТСЯ');
    expect(cover).toContain('ВОЗЬМИ ИНСТРУМЕНТ');
    expect(cover).toContain('Болт с шестигранной головкой');
    expect(cover).toContain('4 шт.');
    expect(cover).toContain('Сверло · Ø6,8 мм');
    expect(cover).toContain('Отверстия под резьбу М8');
  });

  it('объясняет значки и допуски словами ГОСТ-переводчика, а не повторяет шифр', () => {
    const plan = buildInstructionPlan(bracketDocument);
    const all = plan.pages.map((page) => plain(page.blocks)).join('\n');
    expect(all).toContain('ШПАРГАЛКА ПО ЗНАЧКАМ И ДОПУСКАМ');
    expect(all).toContain('Ø6,8');
    // Ø20 H7 → точные миллиметры из таблиц ГОСТ 25346, а не «допуск по чертежу».
    expect(all).toMatch(/20,000[^\n]*20,021/);
    expect(all).toContain('шероховатост');
    // Низкая уверенность распознавания не спрятана от мастера.
    expect(all).toContain('проверить по чертежу');
  });

  it('начинает шаги с нового листа и нумерует их как 01, 02', () => {
    const plan = buildInstructionPlan(bracketDocument, {
      steps: { s1: { svg: SVG }, s2: { svg: SVG } },
    });
    const stepPages = plan.pages.slice(1);
    const first = flat(stepPages[0]!.blocks);
    expect(first).toContain('01');
    expect(first).toContain('Проверьте заготовку и разметьте базу А');
    expect(first).toContain('ОСТОРОЖНО!');
    expect(first).toContain('КОНТРОЛЬНЫЙ ЗАМЕР');
    expect(first).toContain('02');
    expect(first).toContain('Разверните отверстие Ø20 H7');
    // Титул и шпаргалка не соседствуют с первым шагом: шаги начинаются с нового листа.
    const coverText = flat(plan.pages[0]!.blocks);
    expect(coverText).not.toContain('Проверьте заготовку и разметьте базу А');
    expect(coverText).not.toContain('ОСТОРОЖНО!');
  });

  it('заканчивается листом самопроверки с пунктами чек-листа и местом под подпись', () => {
    const plan = buildInstructionPlan(bracketDocument);
    const last = flat(plan.pages[plan.pages.length - 1]!.blocks);
    expect(last).toContain('Проверь перед сдачей');
    bracketDocument.qcChecklist.forEach((item) => expect(last).toContain(item.text));
    expect(last).toContain('Мастер');
    expect(last).toContain('Дата');
  });

  it('подписывает каждый лист «Стр. N из M» и шифром детали', () => {
    const plan = buildInstructionPlan(bracketDocument);
    plan.pages.forEach((page, index) => {
      const text = flat(page.blocks);
      expect(text).toContain(`Стр. ${index + 1} из ${plan.pages.length}`);
      expect(text).toContain('КС-04.100.000 СБ');
    });
  });

  it('держит блоки внутри полей A4', () => {
    const plan = buildInstructionPlan(bracketDocument, { cover: { svg: SVG }, steps: { s1: { svg: SVG } } });
    for (const page of plan.pages) {
      for (const block of page.blocks) {
        if (block.kind === 'text' || block.kind === 'rect' || block.kind === 'svg' || block.kind === 'image') {
          expect(block.x).toBeGreaterThanOrEqual(PAGE.margin - 0.01);
          expect(block.x + block.w).toBeLessThanOrEqual(PAGE.width - PAGE.margin + 0.5);
          expect(block.y).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('отдаёт крупному шагу отдельный лист, а не режет его пополам', () => {
    const longText = `Длинный шаг. ${'Просверлите отверстие, проверьте глубину штангенциркулем и продуйте стружку. '.repeat(18)}`;
    const doc = ikGuideDocumentSchema.parse({
      ...bracketDocument,
      steps: [
        { ...bracketDocument.steps[0]!, workerText: longText },
        { ...bracketDocument.steps[1]!, id: 's2', number: 2 },
      ],
    });
    const plan = buildInstructionPlan(doc, { steps: { s1: { svg: SVG }, s2: { svg: SVG } } });
    const titles = [doc.steps[0]!.title.slice(0, 24), doc.steps[1]!.title.slice(0, 24)];
    const pagesWithFirst = plan.pages.filter((page) => flat(page.blocks).includes(titles[0]!));
    const pagesWithSecond = plan.pages.filter((page) => flat(page.blocks).includes(titles[1]!));
    expect(pagesWithFirst).toHaveLength(1);
    expect(pagesWithSecond).toHaveLength(1);
    expect(pagesWithFirst[0]).not.toBe(pagesWithSecond[0]);
  });

  it('работает на реальном документе демо «Редуктор» и остаётся детерминированным', () => {
    const first = buildInstructionPlan(gearboxDocument, { steps: {} });
    const second = buildInstructionPlan(gearboxDocument, { steps: {} });
    expect(first.pages.length).toBeGreaterThan(2);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.pages.some((page) => flat(page.blocks).includes('ШПАРГАЛКА'))).toBe(true);
  });

  it('не падает без иллюстраций: рисует честную заглушку вместо пустоты', () => {
    const plan = buildInstructionPlan(bracketDocument);
    const all = plan.pages.map((page) => flat(page.blocks)).join('\n');
    expect(all).toContain('Схема шага');
  });

  it('делает имя файла пригодным для Windows', () => {
    expect(instructionFileName('Кронштейн КС-04', 'КС-04.100.000 СБ')).toBe(
      'Кронштейн_КС-04_КС-04.100.000_СБ_инструкция.pdf',
    );
    expect(instructionFileName('Втулка 3/4" <сборка>', 'АБВ:1')).toBe('Втулка_3_4_сборка_АБВ_1_инструкция.pdf');
    expect(instructionFileName('   ')).toBe('инструкция.pdf');
  });
});
