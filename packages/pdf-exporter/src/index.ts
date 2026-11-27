/**
 * `@ikguide/pdf-exporter` — единственный результат работы студии: настоящий `.pdf`-файл инструкции.
 *
 *   план (`buildInstructionPlan`) → рисование (`renderInstructionPdf`) → байты файла
 *
 * План общий для PDF и для живого предпросмотра, поэтому экран показывает ровно то, что уедет в файл.
 */
export * from './plan';
export * from './render';
export * from './text';
export { PDF_FONT_FAMILY } from './render';
