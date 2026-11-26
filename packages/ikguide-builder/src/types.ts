import type { Difficulty, IkGuideDocument, AnnotationKind } from '@ikguide/schema';
import type { TranslationResult } from '@ikguide/gost-translator';

/** Region of the ESKD sheet a candidate was read from. */
export type VisionRegion = 'field' | 'title_block' | 'tech_req';

/** One recognised text block, exactly as `POST /v1/recognize` returns it. */
export interface VisionCandidate {
  id: string;
  pageIndex: number;
  rawText: string;
  normalizedText: string;
  xPercent: number;
  yPercent: number;
  bboxPercent: { x: number; y: number; w: number; h: number };
  confidence: number;
  ambiguousOptions: string[];
  region: VisionRegion;
  source: 'pdf' | 'ocr';
  rotation?: number;
}

export interface VisionTitleBlock {
  name: string | null;
  code: string | null;
  material: string | null;
  scale: string | null;
  sheet: string | null;
  confidence: number;
  rawLines: string[];
}

export interface VisionPage {
  pageIndex: number;
  pageId: string;
  source: 'pdf_vector' | 'pdf_raster' | 'image';
  width: number;
  height: number;
  dpi: number;
  perspectiveCorrected: boolean;
  warnings: string[];
  /** Cleaned sheet as a PNG data URL (used by the «Рентген» screen). */
  imageDataUrl?: string;
}

/** The subset of the vision API response the builder needs. Extra fields are ignored. */
export interface VisionRecognizeResponse {
  schemaVersion?: string;
  requestId?: string;
  pages?: VisionPage[];
  titleBlock?: VisionTitleBlock | null;
  candidates: VisionCandidate[];
  warnings?: string[];
  engine?: { ocr?: string; ocrAvailable?: boolean };
}

export interface BuildOptions {
  /** Overrides for the stamp data; a human value always wins over the OCR guess. */
  title?: string;
  drawingCode?: string;
  material?: string;
  blankDimensions?: string;
  massKg?: number;
  difficulty?: Difficulty;
  sheetFormat?: 'A4' | 'A3' | 'A2' | 'A1';
  /** Overrides the stamp scale, e.g. when the engineer knows the real one. */
  scale?: string;
  assemblyUnit?: string;
  author?: string;
  revision?: string;
  /** ISO timestamp; pass a fixed value in tests to get a deterministic document. */
  createdAt?: string;
  /** Keep candidates below the 0.95 threshold as unconfirmed annotations (default: true). */
  keepLowConfidence?: boolean;
  /** Ciphers the engineer typed by hand; they enter the draft as confirmed annotations. */
  manualNotations?: readonly ManualNotation[];
  /** Hard cap on annotations in the draft, so a noisy scan cannot produce a 300-step guide. */
  maxAnnotations?: number;
}

export interface SkippedCandidate {
  text: string;
  reason: 'not_a_notation' | 'title_block' | 'empty' | 'limit' | 'below_threshold';
  confidence: number;
}

export interface AnnotationTranslation {
  annotationId: string;
  candidateText: string;
  region: VisionRegion;
  confidence: number;
  confirmedByHuman: boolean;
  result: TranslationResult;
}

export interface BuildStats {
  recognised: number;
  translated: number;
  notRecognised: number;
  uncertain: number;
  skipped: number;
  steps: number;
  tools: number;
  qcItems: number;
}

export interface BuildResult {
  document: IkGuideDocument;
  warnings: string[];
  skipped: SkippedCandidate[];
  translations: AnnotationTranslation[];
  stats: BuildStats;
}

/** A cipher typed by the engineer when the scanner missed it. */
export interface ManualNotation {
  text: string;
  xPercent?: number;
  yPercent?: number;
  note?: string;
}

export type AnnotationKindOf = AnnotationKind;

/* ------------------------------------------------------------- 3D CAD (stage 3) */

/** One part of `POST /v1/cad/import`. */
export interface CadPartPayload {
  id: string;
  name: string;
  displayName?: string;
  nodeName: string;
  role: 'base' | 'part' | 'fastener';
  bbox?: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] };
  volumeMm3: number;
  centroid: [number, number, number];
  triangleCount: number;
  explosionVector: [number, number, number];
  groupKey: string;
  notation: string | null;
}

/** One assembly step produced by the disassembly sequencer. */
export interface CadStepPayload {
  number: number;
  kind: 'base' | 'cover' | 'fastener' | 'part';
  title: string;
  workerText?: string;
  partIds: string[];
  count: number;
  explosionVector: [number, number, number];
  azimuth: number;
  elevation: number;
  fastenerKey: string | null;
  notation: string | null;
  attention: string | null;
  /** IKEA 2.0 SVG of the step (already rendered by the service). */
  svg: string;
}

/** The subset of the CAD API response the builder needs. */
export interface CadImportResponse {
  schemaVersion?: string;
  sessionId: string;
  assembly: {
    name: string;
    filename?: string;
    sourceFormat: string;
    unitScale?: number;
    sizeMm: [number, number, number];
    massKg?: number;
  };
  parts: CadPartPayload[];
  steps: CadStepPayload[];
  overviewSvg?: string;
  glbDataUrl: string;
  warnings?: string[];
  stats?: { parts: number; fasteners: number; steps: number; triangles: number };
}

export interface CadBuildOptions {
  id?: string;
  title?: string;
  drawingCode?: string;
  material?: string;
  author?: string;
  revision?: string;
  assemblyUnit?: string;
  difficulty?: Difficulty;
  sheetFormat?: 'A4' | 'A3' | 'A2' | 'A1';
  /** ISO timestamp; pass a fixed value in tests to get a deterministic document. */
  createdAt?: string;
}

export interface CadBuildStats {
  parts: number;
  fasteners: number;
  steps: number;
  tools: number;
  bom: number;
  uncertain: number;
  triangleCount: number;
}

export interface CadBuildResult {
  document: IkGuideDocument;
  warnings: string[];
  stats: CadBuildStats;
}

export type CadMergeOptions = CadBuildOptions;

export interface CadChangeSummary {
  added: string[];
  removed: string[];
  changed: string[];
  /** Numbers of the steps whose manual edits survived the update. */
  keptEdits: number[];
  partsBefore: number;
  partsAfter: number;
  stepsBefore: number;
  stepsAfter: number;
}

export interface CadMergeResult {
  document: IkGuideDocument;
  changes: CadChangeSummary;
  warnings: string[];
  /** «Модель обновлена: +1 деталь, ручные пометки сохранены». */
  summary: string;
}
