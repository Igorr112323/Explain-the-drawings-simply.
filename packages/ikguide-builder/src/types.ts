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

/** Строка таблицы позиций с поля чертежа (`POST /v1/recognize` → `bomRows`). */
export interface VisionBomRow {
  pageIndex?: number;
  position?: number | null;
  designation?: string | null;
  name: string;
  quantity?: number | null;
  xPercent: number;
  yPercent: number;
  bboxPercent: { x: number; y: number; w: number; h: number };
}

/** Подпись вида на листе: «Спереди», «Сбоку», «Сверху», «Изометрия», «Разрез А-А». */
export interface VisionSheetView {
  pageIndex?: number;
  name: string;
  xPercent: number;
  yPercent: number;
  bboxPercent: { x: number; y: number; w: number; h: number };
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
  /** Во сколько раз лист увеличен перед OCR (мелкий скан). */
  upscale?: number;
  /** Области, найденные сервисом; координаты в процентах листа. */
  zones?: Array<{ kind: string; bboxPercent: { x: number; y: number; w: number; h: number } }>;
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
  /** Строки таблицы позиций: из них строятся шаги комплектности и зоны кропа. */
  bomRows?: VisionBomRow[];
  /** Подписи видов: ориентиры на листе и зоны кропа для шагов без своих обозначений. */
  views?: VisionSheetView[];
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
  reason: 'not_a_notation' | 'title_block' | 'empty' | 'limit' | 'below_threshold' | 'bom_row';
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
