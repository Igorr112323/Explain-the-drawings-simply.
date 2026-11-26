import type { IkGuideDocument } from '@ikguide/schema';
import { bracketDocument } from './bracket';
import { gearboxDocument } from './gearbox';

/**
 * Два встроенных 2D-чертежа — оба документа лежат в бандле и открываются мгновенно, без сети:
 *  1. «Кронштейн КС-04» — чертёж с размерами, резьбой и сваркой;
 *  2. «Редуктор РД-12» — обозначения ГОСТ, которые надо расшифровать.
 *
 * Это и есть «демо» на главном экране и запасной вариант, если локальный движок не запущен.
 */
export type DemoId = 'demo-bracket' | 'demo-gearbox';

export interface DemoProject {
  id: DemoId;
  title: string;
  note: string;
  tag: '2D';
  document: IkGuideDocument;
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    id: 'demo-bracket',
    title: 'Кронштейн КС-04',
    note: 'Размеры, резьба и сварка — с нечёткой цифрой на выноске',
    tag: '2D',
    document: bracketDocument,
  },
  {
    id: 'demo-gearbox',
    title: 'Редуктор РД-12',
    note: 'Обозначения ГОСТ, которые надо расшифровать',
    tag: '2D',
    document: gearboxDocument,
  },
];

export const DEMO_BY_ID: Readonly<Record<string, DemoProject>> = Object.fromEntries(
  DEMO_PROJECTS.map((project) => [project.id, project]),
);

export const DEMO_DOCUMENTS: readonly IkGuideDocument[] = DEMO_PROJECTS.map((project) => project.document);

export { bracketDocument, gearboxDocument };
