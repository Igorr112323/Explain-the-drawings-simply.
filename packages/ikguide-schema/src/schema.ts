import { z } from 'zod';

/**
 * Version of the on-disk `.ikguide.json` document format.
 * Bump only with a migration in `migrations.ts`.
 */
export const IKGuide_SCHEMA_VERSION = '1.0' as const;

export const toolCategorySchema = z.enum([
  'drill',
  'tap',
  'die',
  'reamer',
  'wrench',
  'gauge',
  'micrometer',
  'caliper',
  'welding',
  'deburr',
  'press',
  'consumable',
  'other',
]);

export const difficultySchema = z.enum(['easy', 'medium', 'hard', 'expert']);

export const bomItemKindSchema = z.enum(['fastener', 'bearing', 'seal', 'purchased', 'consumable', 'raw']);

export const bomIconSchema = z.enum([
  'bolt',
  'nut',
  'washer',
  'screw',
  'pin',
  'bearing',
  'seal',
  'plate',
  'servo',
  'bracket',
  'sensor',
  'cable',
]);

export const highlightToneSchema = z.enum(['accent', 'danger', 'done']);

export const annotationKindSchema = z.enum([
  'thread',
  'fit',
  'roughness',
  'weld',
  'chamfer',
  'holeGroup',
  'radius',
  'dimension',
  'other',
]);

export const metadataSchema = z.object({
  title: z.string().min(1, 'Укажите название детали или узла'),
  drawingCode: z.string().min(1, 'Укажите шифр чертежа'),
  assemblyUnit: z.string().min(1).optional(),
  material: z.string().min(1, 'Укажите материал'),
  blankDimensions: z.string().min(1, 'Укажите габариты заготовки'),
  massKg: z.number().positive().max(5000).optional(),
  difficulty: difficultySchema,
  author: z.string().min(1),
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Дата должна быть в формате ISO 8601'),
  revision: z.string().min(1),
});

export const bomItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.string().min(1),
  quantity: z.number().int().positive(),
  kind: bomItemKindSchema,
  icon: bomIconSchema,
  standard: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

export const toolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.string().min(1).optional(),
  category: toolCategorySchema,
  purpose: z.string().min(1),
  forSteps: z.array(z.number().int().positive()).default([]),
});

export const highlightSchema = z.object({
  shapeId: z.string().min(1),
  label: z.string().min(1),
  tone: highlightToneSchema,
  note: z.string().min(1).optional(),
});

export const arrowSchema = z.object({
  fromX: z.number().min(0).max(100),
  fromY: z.number().min(0).max(100),
  toX: z.number().min(0).max(100),
  toY: z.number().min(0).max(100),
  label: z.string().min(1).optional(),
});

export const illustrationSchema = z.object({
  illustrationId: z.string().min(1),
  highlight: z.array(highlightSchema).default([]),
  arrows: z.array(arrowSchema).default([]),
});

export const criticalCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  nominal: z.string().min(1, 'Номинал обязателен, например «Ø20 H7»'),
  acceptance: z.string().min(1, 'Опишите критерий приёмки'),
  instrument: z.string().min(1, 'Укажите средство измерения'),
});

export const antiErrorSchema = z.object({
  text: z.string().min(1),
  severity: z.enum(['warning', 'critical']),
});

/** Прямоугольник на листе (проценты 0…100): какую часть чертежа печатать на странице шага. */
export const cropPercentSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
});

export const stepSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  workerText: z.string().min(3),
  estimatedMinutes: z.number().positive().max(600),
  illustration: illustrationSchema,
  antiError: antiErrorSchema.nullable().default(null),
  criticalChecks: z.array(criticalCheckSchema).default([]),
  drawingRefs: z.array(z.string()).default([]),
  /** Зона листа под этот шаг: строка таблицы позиций, вид или размер с выноской. */
  cropPercent: cropPercentSchema.optional(),
  /** IKEA-2.0 vector diagram of this step; goes to the A4 print as well. */
  svgDiagram: z
    .string()
    .min(1)
    .refine((value) => value.trimStart().startsWith('<svg'), 'Диаграмма должна быть SVG-разметкой')
    .optional(),
});

export const xrayAnnotationSchema = z.object({
  id: z.string().min(1),
  raw: z.string().min(1, 'Обозначение не может быть пустым'),
  kind: annotationKindSchema,
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  confirmedByHuman: z.boolean().default(false),
  resolvedValue: z.string().min(1).optional(),
  ambiguousOptions: z.array(z.string().min(1)).min(2).max(4).optional(),
  note: z.string().min(1).optional(),
});

export const qcItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(3),
  required: z.boolean().default(true),
  reference: z.string().min(1).optional(),
});

export const drawingSchema = z.object({
  viewId: z.string().min(1),
  sheetFormat: z.enum(['A4', 'A3', 'A2', 'A1']),
  scale: z.string().min(1),
});

export const ikGuideDocumentSchema = z
  .object({
    schemaVersion: z.literal(IKGuide_SCHEMA_VERSION),
    id: z.string().min(1),
    metadata: metadataSchema,
    drawing: drawingSchema,
    bom: z.array(bomItemSchema).min(1, 'Комплектация не может быть пустой'),
    tools: z.array(toolSchema).min(1, 'Список инструмента не может быть пустым'),
    steps: z.array(stepSchema).min(1, 'Инструкция должна содержать хотя бы один шаг'),
    xrayAnnotations: z.array(xrayAnnotationSchema),
    qcChecklist: z.array(qcItemSchema).min(1, 'Чек-лист не может быть пустым'),
  })
  .superRefine((doc, ctx) => {
    const annotationIds = new Set<string>();
    doc.xrayAnnotations.forEach((annotation, index) => {
      if (annotationIds.has(annotation.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['xrayAnnotations', index, 'id'],
          message: `Повторяющийся идентификатор аннотации: ${annotation.id}`,
        });
      }
      annotationIds.add(annotation.id);
    });

    const stepNumbers = new Map<number, number>();
    doc.steps.forEach((step, index) => {
      const previousIndex = stepNumbers.get(step.number);
      if (previousIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'number'],
          message: `Шаг №${step.number} уже занят шагом с индексом ${previousIndex}`,
        });
      }
      stepNumbers.set(step.number, index);

      step.drawingRefs.forEach((ref, refIndex) => {
        if (!annotationIds.has(ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', index, 'drawingRefs', refIndex],
            message: `Шаг ссылается на несуществующую аннотацию «${ref}»`,
          });
        }
      });
    });

    const sortedNumbers = doc.steps.map((step) => step.number).sort((a, b) => a - b);
    sortedNumbers.forEach((number, index) => {
      if (number !== index + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps'],
          message: 'Номера шагов должны идти подряд, начиная с 1',
        });
      }
    });

    const qcIds = new Set<string>();
    doc.qcChecklist.forEach((item, index) => {
      if (qcIds.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['qcChecklist', index, 'id'],
          message: `Повторяющийся идентификатор пункта чек-листа: ${item.id}`,
        });
      }
      qcIds.add(item.id);
    });

    const stepIds = new Set<string>();
    doc.steps.forEach((step, index) => {
      if (stepIds.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'id'],
          message: `Повторяющийся идентификатор шага: ${step.id}`,
        });
      }
      stepIds.add(step.id);
    });
  });

export type IkGuideDocument = z.infer<typeof ikGuideDocumentSchema>;
export type IkGuideMetadata = z.infer<typeof metadataSchema>;
export type BomItem = z.infer<typeof bomItemSchema>;
export type GuideTool = z.infer<typeof toolSchema>;
export type GuideStep = z.infer<typeof stepSchema>;
export type StepIllustration = z.infer<typeof illustrationSchema>;
export type Highlight = z.infer<typeof highlightSchema>;
export type ArtArrow = z.infer<typeof arrowSchema>;
export type CriticalCheck = z.infer<typeof criticalCheckSchema>;
export type AntiError = z.infer<typeof antiErrorSchema>;
export type XrayAnnotation = z.infer<typeof xrayAnnotationSchema>;
export type QcItem = z.infer<typeof qcItemSchema>;
export type DrawingView = z.infer<typeof drawingSchema>;
export type StepCrop = z.infer<typeof cropPercentSchema>;
export type ToolCategory = z.infer<typeof toolCategorySchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type BomIcon = z.infer<typeof bomIconSchema>;
export type AnnotationKind = z.infer<typeof annotationKindSchema>;
export type HighlightTone = z.infer<typeof highlightToneSchema>;
