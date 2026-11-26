import type { IkGuideDocument } from '@ikguide/schema';
import { bracketDocument } from './bracket';
import { gearboxDocument } from './gearbox';
import { up08Document } from '../lib/demo3d';

/**
 * Three built-in projects:
 *  1. «Кронштейн» — 2D drawings, drill/tap/weld, quarrels about sizes;
 *  2. «Редуктор» — a drawing whose labels need GOST translation;
 *  3. «Узел привода УП-08» — a real 3D assembly: GLB viewer, IKEA diagrams built from geometry.
 *
 * The 3D demo is generated at build time (`scripts/build-demo-3d.py` runs the real cad-api pipeline
 * over a procedural assembly) and embedded as a data URL, so it opens without any network.
 */
export const DEMO_DOCUMENTS: readonly IkGuideDocument[] = [bracketDocument, gearboxDocument, up08Document()];

export const DEMO_BY_ID: Readonly<Record<string, IkGuideDocument>> = Object.fromEntries(
  DEMO_DOCUMENTS.map((doc) => [doc.id, doc]),
);

export { bracketDocument, gearboxDocument };
