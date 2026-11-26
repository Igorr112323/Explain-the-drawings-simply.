import type { IkGuideDocument } from '@ikguide/schema';
import { bracketDocument } from './bracket';
import { gearboxDocument } from './gearbox';
import { up08Document } from '../lib/demo3d';

/**
 * Три встроенных проекта — по одному на каждый вход:
 *  1. «Кронштейн КС-04» — чертёж с размерами, резьбой и сваркой;
 *  2. «Редуктор РД-12» — обозначения ГОСТ, которые надо расшифровать;
 *  3. «Узел привода УП-08» — сборка, схемы шагов строятся из 3D-геометрии.
 *
 * Всё лежит в бандле, поэтому примеры открываются мгновенно и без сети — это и есть «демо»
 * на главном экране и запасной вариант, если локальный бэкенд не запущен.
 */
export type DemoId = 'demo-bracket' | 'demo-gearbox' | 'demo-up08-3d';

export interface DemoProject {
  id: DemoId;
  title: string;
  note: string;
  tag: '2D' | '3D';
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
  {
    id: 'demo-up08-3d',
    title: 'Узел привода УП-08',
    note: 'Сборка из 12 деталей, схемы строятся из 3D',
    tag: '3D',
    document: up08Document(),
  },
];

export const DEMO_BY_ID: Readonly<Record<string, DemoProject>> = Object.fromEntries(
  DEMO_PROJECTS.map((project) => [project.id, project]),
);

export const DEMO_DOCUMENTS: readonly IkGuideDocument[] = DEMO_PROJECTS.map((project) => project.document);

export { bracketDocument, gearboxDocument };
