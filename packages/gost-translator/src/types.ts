export type ToolCategory =
  | 'drill'
  | 'tap'
  | 'die'
  | 'reamer'
  | 'wrench'
  | 'gauge'
  | 'micrometer'
  | 'caliper'
  | 'welding'
  | 'deburr'
  | 'press'
  | 'consumable'
  | 'other';

export interface RecommendedTool {
  /** Human readable tool name exactly as it should appear on the tool table, e.g. «Сверло Ø6,8 мм». */
  name: string;
  category: ToolCategory;
  /** Why this tool is needed for this particular notation. */
  purpose: string;
}

export type FitKind = 'clearance' | 'transition' | 'interference';

export interface ThreadTranslation {
  kind: 'thread';
  raw: string;
  normalized: string;
  standard: string;
  designation: string;
  thread: 'metric';
  threadKind: 'internal' | 'external' | 'unspecified';
  diameterMm: number;
  pitchMm: number;
  pitchKind: 'coarse' | 'fine';
  toleranceClass: string | null;
  holeCount: number | null;
  threadDepthMm: number | null;
  tapDrillMm: number | null;
  tapDrillRangeMm: [number, number] | null;
  blankRodMm: number | null;
  clearanceHoleMm: number;
  wrenchSizeMm: number | null;
  recommendedEngagementMm: number;
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface ToleranceZone {
  field: string;
  zoneKind: 'hole' | 'shaft';
  grade: number;
  lowerUm: number;
  upperUm: number;
  toleranceUm: number;
  minSizeMm: number;
  maxSizeMm: number;
}

export interface FitPair {
  hole: ToleranceZone;
  shaft: ToleranceZone;
  fitKind: FitKind;
  maxClearanceUm: number;
  minClearanceUm: number;
}

export interface FitTranslation {
  kind: 'fit';
  raw: string;
  normalized: string;
  standard: string;
  nominalMm: number;
  zone: ToleranceZone;
  pair: FitPair | null;
  fitKind: FitKind | null;
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface RoughnessTranslation {
  kind: 'roughness';
  raw: string;
  normalized: string;
  standard: string;
  parameter: 'Ra' | 'Rz';
  valueUm: number;
  surfaceClass: number;
  surfaceClassLabel: string;
  matchesSeries: boolean;
  raEquivalentUm: number;
  processing: string;
  finishGroup: 'rough' | 'semi-finish' | 'finish' | 'precision';
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface WeldTranslation {
  kind: 'weld';
  raw: string;
  normalized: string;
  standard: string;
  jointCode: 'С' | 'У' | 'Т' | 'Н' | null;
  jointVariant: number | null;
  jointName: string | null;
  legMm: number | null;
  seamLengthMm: number | null;
  seamPitchMm: number | null;
  closedContour: boolean;
  flush: boolean;
  removeReinforcement: boolean;
  explanation: string;
  welderInstruction: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface ChamferTranslation {
  kind: 'chamfer';
  raw: string;
  normalized: string;
  standard: string;
  legMm: number;
  angleDeg: number;
  notation: 'C' | 'leg-by-angle';
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface RadiusTranslation {
  kind: 'radius';
  raw: string;
  normalized: string;
  standard: string;
  radiusMm: number;
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface HoleGroupTranslation {
  kind: 'holeGroup';
  raw: string;
  normalized: string;
  standard: string;
  holeCount: number;
  diameterMm: number;
  recommendedDrillMm: number;
  drillMatchesExactly: boolean;
  withChamfer: boolean;
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface DimensionTranslation {
  kind: 'dimension';
  raw: string;
  normalized: string;
  standard: string;
  nominalMm: number;
  upperDeviationMm: number | null;
  lowerDeviationMm: number | null;
  minSizeMm: number | null;
  maxSizeMm: number | null;
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export interface UnknownTranslation {
  kind: 'unknown';
  raw: string;
  normalized: string;
  standard: null;
  explanation: string;
  workerAdvice: string;
  tools: RecommendedTool[];
  warnings: string[];
}

export type TranslationResult =
  | ThreadTranslation
  | FitTranslation
  | RoughnessTranslation
  | WeldTranslation
  | ChamferTranslation
  | RadiusTranslation
  | HoleGroupTranslation
  | DimensionTranslation
  | UnknownTranslation;

export type TranslationKind = TranslationResult['kind'];
