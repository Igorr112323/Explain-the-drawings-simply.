import type { IkGuideDocument } from '@ikguide/schema';
import { bracketDocument } from './bracket';
import { gearboxDocument } from './gearbox';

export const DEMO_DOCUMENTS: readonly IkGuideDocument[] = [bracketDocument, gearboxDocument];

export const DEMO_BY_ID: Readonly<Record<string, IkGuideDocument>> = Object.fromEntries(
  DEMO_DOCUMENTS.map((doc) => [doc.id, doc]),
);

export { bracketDocument, gearboxDocument };
