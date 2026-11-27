import { describe, expect, it } from 'vitest';
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';
import { gearboxDocument } from '../../../apps/studio-web/src/data/gearbox';
import {
  buildInstructionPlan,
  instructionFileName,
  PAGE,
  type PlanBlock,
  type PlanTarget,
  type PlanText,
} from './plan';
import { blockHeight } from './text';

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

  it('адресует блоки листа: клик на экране знает, какое поле документа править', () => {
    // Схема появляется только когда есть иллюстрация: у неё тоже должен быть адрес.
    const plan = buildInstructionPlan(bracketDocument, {
      steps: { s1: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' } },
    });
    const targets = new Map<PlanTarget['type'], PlanTarget>();
    for (const page of plan.pages) {
      for (const block of page.blocks) {
        const target = 'target' in block ? block.target : undefined;
        if (target && !targets.has(target.type)) {
          targets.set(target.type, target);
        }
      }
    }

    expect(targets.get('title')).toEqual({ type: 'title' });
    expect(targets.get('step-title')).toEqual({ type: 'step-title', stepId: 's1' });
    expect(targets.get('step-text')).toEqual({ type: 'step-text', stepId: 's1' });
    expect(targets.get('step-anti')).toEqual({ type: 'step-anti', stepId: 's1' });
    expect(targets.get('step-illustration')).toEqual({ type: 'step-illustration', stepId: 's1' });
    // В шпаргалке у строки-обозначения есть ссылка на аннотацию, у строки контроля — нет.
    expect(targets.get('notation')?.type).toBe('notation');
  });

  it('адреса не меняют сам файл: колонтитулы и контрольные замеры остаются без них', () => {
    const plan = buildInstructionPlan(bracketDocument);
    const footer = plan.pages[0]!.blocks.find(
      (block) => block.kind === 'text' && block.lines.join('').includes('Стр. 1 из'),
    );
    expect(footer && 'target' in footer ? footer.target : undefined).toBeUndefined();
    const targets = plan.pages.flatMap((page) =>
      page.blocks.map((block) => ('target' in block ? block.target?.type : undefined)).filter(Boolean),
    );
    expect(targets.every((type) => !String(type).includes('check'))).toBe(true);
  });

  it('делает имя файла пригодным для Windows', () => {
    expect(instructionFileName('Кронштейн КС-04', 'КС-04.100.000 СБ')).toBe(
      'Кронштейн_КС-04_КС-04.100.000_СБ_инструкция.pdf',
    );
    expect(instructionFileName('Втулка 3/4" <сборка>', 'АБВ:1')).toBe('Втулка_3_4_сборка_АБВ_1_инструкция.pdf');
    expect(instructionFileName('   ')).toBe('инструкция.pdf');
  });

  it('ни один блок не уходит ниже тела листа, даже если шаг распух от OCR', () => {
    // Найдено на 1 060-файловом прогоне: длинный шаг из распознанного листа печатался поверх
    // колонтитула и за край бумаги (58 документов из 1 036).
    const hugeText = Array.from({ length: 120 }, (_, index) => `Строка ${index + 1}: сверьте размер по чертежу.`).join(' ');
    const doc = {
      ...bracketDocument,
      steps: bracketDocument.steps.map((step, index) => ({
        ...step,
        workerText: index === 0 ? hugeText : step.workerText,
        criticalChecks: Array.from({ length: 6 }, (_, check) => ({
          id: `c${check}`,
          label: `Размер ${check}`,
          nominal: '45,002–45,018 мм',
          acceptance: 'ширина допуска 0,016 мм, контроль калибром',
          instrument: 'Калибр-пробка Ø20 H7',
        })),
      })),
    };
    const plan = buildInstructionPlan(ikGuideDocumentSchema.parse(doc));
    for (const page of plan.pages) {
      for (const block of page.blocks) {
        const top = block.kind === 'line' ? Math.min(block.y1, block.y2) : block.y;
        if (top >= PAGE.footerBaseline - 5) {
          continue; // сам колонтитул живёт ниже тела листа — это норма
        }
        const bottom =
          block.kind === 'line'
            ? Math.max(block.y1, block.y2)
            : block.kind === 'text'
              ? block.y + blockHeight(block.lines, block.size)
              : block.y + block.h;
        expect(bottom, `блок ${block.kind} на стр. ${page.index}`).toBeLessThanOrEqual(PAGE.bodyBottom + 0.01);
      }
    }
    const stepText = plan.pages
      .flatMap((page) => page.blocks)
      .filter((block): block is PlanText => block.kind === 'text' && 'target' in block && block.target?.type === 'step-text');
    expect(stepText.flatMap((block) => block.lines).join(' ')).toContain('Строка 120: сверьте размер по чертежу.');
    expect(stepText.flatMap((block) => block.lines).join(' ')).not.toContain('…');
  });

  it('таблица позиций с огромными строками не наезжает на колонтитул', () => {
    const doc = {
      ...bracketDocument,
      bom: Array.from({ length: 24 }, (_, index) => ({
        id: `b${index}`,
        name: `Болт с шестигранной головкой М${8 + index} длиной ${30 + index} мм, оцинкованный, повышенной прочности`,
        size: `М${8 + index} × ${30 + index}`,
        quantity: 1 + index,
        note: 'по ГОСТ 7798-70, затяжка динамометрическим ключом 24 Н·м, момент контролировать по паспорту',
        kind: 'fastener' as const,
        icon: 'bolt' as const,
      })),
      tools: bracketDocument.tools,
    };
    const plan = buildInstructionPlan(ikGuideDocumentSchema.parse(doc));
    for (const page of plan.pages) {
      for (const block of page.blocks) {
        if (block.kind !== 'text' || block.y >= PAGE.footerBaseline - 5) {
          continue; // колонтитул
        }
        const height = blockHeight(block.lines, block.size);
        expect(block.y + height, `стр. ${page.index}`).toBeLessThanOrEqual(PAGE.bodyBottom + 0.01);
      }
    }
  });
  it('переносит одну очень длинную позицию без потери начала и конца', () => {
    const words = Array.from({ length: 400 }, (_, i) => `деталь${i}`).join(' ');
    const doc = ikGuideDocumentSchema.parse({ ...bracketDocument,
      bom: [{ ...bracketDocument.bom[0], name: words, note: 'КОНЕЦ ПОЗИЦИИ' }] });
    const plan = buildInstructionPlan(doc);
    const all = plan.pages.flatMap((page) => page.blocks)
      .filter((block): block is PlanText => block.kind === 'text' && block.y < PAGE.footerBaseline - 5)
      .flatMap((block) => block.lines).join(' ');
    for (const word of words.split(' ')) expect(all.split(/\s+/)).toContain(word);
    expect(all).toContain('КОНЕЦ ПОЗИЦИИ');
    for (const page of plan.pages) for (const block of page.blocks) {
      if (block.kind === 'text' && block.y < PAGE.footerBaseline - 5)
        expect(block.y + blockHeight(block.lines, block.size)).toBeLessThanOrEqual(PAGE.bodyBottom + 0.01);
    }
  });

  it('длинная расшифровка не зацикливает разбиение и сохраняет конец', () => {
    const longNote = Array.from({ length: 500 }, (_, i) => `расшифровка${i}`).join(' ');
    const doc = ikGuideDocumentSchema.parse({ ...bracketDocument,
      xrayAnnotations: [{ ...bracketDocument.xrayAnnotations[0], note: longNote }] });
    const plan = buildInstructionPlan(doc);
    const all = plan.pages.flatMap((page) => page.blocks)
      .filter((block): block is PlanText => block.kind === 'text')
      .flatMap((block) => block.lines).join(' ');
    expect(all).toContain('расшифровка499');
  });

});
