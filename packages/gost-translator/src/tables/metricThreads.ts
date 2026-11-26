export interface MetricThreadRow {
  diameterMm: number;
  coarsePitchMm: number;
  /** Drill diameter for tapping according to GOST 19257-73 (steel, average values). */
  tapDrillMm: number;
  /** Some GOST 19257-73 cells give a range instead of a single value. */
  tapDrillRangeMm: [number, number] | null;
  /** Clearance hole, middle row of GOST 11284-75. */
  clearanceHoleMm: number;
  /** Wrench across-flats for hex heads/nuts of GOST 7798-70 / GOST 5915-70. */
  wrenchSizeMm: number;
}

/**
 * Metric threads M1–M30, coarse pitch.
 * Sources: GOST 24705-2004 (basic dimensions), GOST 19257-73 (tap drills), GOST 11284-75 (clearance holes),
 * GOST 7798-70 / GOST 5915-70 (hex head and nut across-flats).
 */
export const METRIC_THREADS: readonly MetricThreadRow[] = [
  { diameterMm: 1, coarsePitchMm: 0.25, tapDrillMm: 0.75, tapDrillRangeMm: null, clearanceHoleMm: 1.1, wrenchSizeMm: 3.2 },
  { diameterMm: 1.2, coarsePitchMm: 0.25, tapDrillMm: 0.95, tapDrillRangeMm: null, clearanceHoleMm: 1.3, wrenchSizeMm: 3.2 },
  { diameterMm: 1.4, coarsePitchMm: 0.3, tapDrillMm: 1.1, tapDrillRangeMm: null, clearanceHoleMm: 1.6, wrenchSizeMm: 3.2 },
  { diameterMm: 1.6, coarsePitchMm: 0.35, tapDrillMm: 1.25, tapDrillRangeMm: null, clearanceHoleMm: 1.8, wrenchSizeMm: 3.2 },
  { diameterMm: 1.8, coarsePitchMm: 0.35, tapDrillMm: 1.45, tapDrillRangeMm: null, clearanceHoleMm: 2, wrenchSizeMm: 3.2 },
  { diameterMm: 2, coarsePitchMm: 0.4, tapDrillMm: 1.6, tapDrillRangeMm: null, clearanceHoleMm: 2.2, wrenchSizeMm: 4 },
  { diameterMm: 2.2, coarsePitchMm: 0.45, tapDrillMm: 1.75, tapDrillRangeMm: null, clearanceHoleMm: 2.4, wrenchSizeMm: 4 },
  { diameterMm: 2.5, coarsePitchMm: 0.45, tapDrillMm: 2.05, tapDrillRangeMm: null, clearanceHoleMm: 2.7, wrenchSizeMm: 5 },
  { diameterMm: 3, coarsePitchMm: 0.5, tapDrillMm: 2.5, tapDrillRangeMm: null, clearanceHoleMm: 3.4, wrenchSizeMm: 5.5 },
  { diameterMm: 3.5, coarsePitchMm: 0.6, tapDrillMm: 2.9, tapDrillRangeMm: null, clearanceHoleMm: 3.9, wrenchSizeMm: 6 },
  { diameterMm: 4, coarsePitchMm: 0.7, tapDrillMm: 3.3, tapDrillRangeMm: null, clearanceHoleMm: 4.5, wrenchSizeMm: 7 },
  { diameterMm: 4.5, coarsePitchMm: 0.75, tapDrillMm: 3.7, tapDrillRangeMm: null, clearanceHoleMm: 5.1, wrenchSizeMm: 8 },
  { diameterMm: 5, coarsePitchMm: 0.8, tapDrillMm: 4.2, tapDrillRangeMm: null, clearanceHoleMm: 5.5, wrenchSizeMm: 8 },
  { diameterMm: 6, coarsePitchMm: 1, tapDrillMm: 5, tapDrillRangeMm: null, clearanceHoleMm: 6.6, wrenchSizeMm: 10 },
  { diameterMm: 7, coarsePitchMm: 1, tapDrillMm: 6, tapDrillRangeMm: null, clearanceHoleMm: 7.6, wrenchSizeMm: 11 },
  { diameterMm: 8, coarsePitchMm: 1.25, tapDrillMm: 6.8, tapDrillRangeMm: [6.7, 6.8], clearanceHoleMm: 9, wrenchSizeMm: 13 },
  { diameterMm: 9, coarsePitchMm: 1.25, tapDrillMm: 7.8, tapDrillRangeMm: null, clearanceHoleMm: 10, wrenchSizeMm: 14 },
  { diameterMm: 10, coarsePitchMm: 1.5, tapDrillMm: 8.5, tapDrillRangeMm: null, clearanceHoleMm: 11, wrenchSizeMm: 17 },
  { diameterMm: 11, coarsePitchMm: 1.5, tapDrillMm: 9.5, tapDrillRangeMm: null, clearanceHoleMm: 12, wrenchSizeMm: 17 },
  { diameterMm: 12, coarsePitchMm: 1.75, tapDrillMm: 10.2, tapDrillRangeMm: null, clearanceHoleMm: 13.5, wrenchSizeMm: 19 },
  { diameterMm: 14, coarsePitchMm: 2, tapDrillMm: 12, tapDrillRangeMm: null, clearanceHoleMm: 15.5, wrenchSizeMm: 22 },
  { diameterMm: 16, coarsePitchMm: 2, tapDrillMm: 14, tapDrillRangeMm: null, clearanceHoleMm: 17.5, wrenchSizeMm: 24 },
  { diameterMm: 18, coarsePitchMm: 2.5, tapDrillMm: 15.5, tapDrillRangeMm: null, clearanceHoleMm: 20, wrenchSizeMm: 27 },
  { diameterMm: 20, coarsePitchMm: 2.5, tapDrillMm: 17.5, tapDrillRangeMm: null, clearanceHoleMm: 22, wrenchSizeMm: 30 },
  { diameterMm: 22, coarsePitchMm: 2.5, tapDrillMm: 19.5, tapDrillRangeMm: null, clearanceHoleMm: 24, wrenchSizeMm: 32 },
  { diameterMm: 24, coarsePitchMm: 3, tapDrillMm: 21, tapDrillRangeMm: null, clearanceHoleMm: 26, wrenchSizeMm: 36 },
  { diameterMm: 27, coarsePitchMm: 3, tapDrillMm: 24, tapDrillRangeMm: null, clearanceHoleMm: 29, wrenchSizeMm: 41 },
  { diameterMm: 30, coarsePitchMm: 3.5, tapDrillMm: 26.5, tapDrillRangeMm: null, clearanceHoleMm: 33, wrenchSizeMm: 46 },
];

export interface FinePitchRow {
  diameterMm: number;
  pitchMm: number;
  tapDrillMm: number;
}

/** Commonly used fine pitches (GOST 24705) with their tap drills (GOST 19257-73). */
export const FINE_PITCHES: readonly FinePitchRow[] = [
  { diameterMm: 4, pitchMm: 0.5, tapDrillMm: 3.5 },
  { diameterMm: 5, pitchMm: 0.5, tapDrillMm: 4.5 },
  { diameterMm: 6, pitchMm: 0.5, tapDrillMm: 5.5 },
  { diameterMm: 6, pitchMm: 0.75, tapDrillMm: 5.2 },
  { diameterMm: 8, pitchMm: 0.5, tapDrillMm: 7.5 },
  { diameterMm: 8, pitchMm: 0.75, tapDrillMm: 7.2 },
  { diameterMm: 8, pitchMm: 1, tapDrillMm: 7 },
  { diameterMm: 10, pitchMm: 0.75, tapDrillMm: 9.2 },
  { diameterMm: 10, pitchMm: 1, tapDrillMm: 9 },
  { diameterMm: 10, pitchMm: 1.25, tapDrillMm: 8.8 },
  { diameterMm: 12, pitchMm: 1, tapDrillMm: 11 },
  { diameterMm: 12, pitchMm: 1.25, tapDrillMm: 10.8 },
  { diameterMm: 12, pitchMm: 1.5, tapDrillMm: 10.5 },
  { diameterMm: 14, pitchMm: 1, tapDrillMm: 13 },
  { diameterMm: 14, pitchMm: 1.25, tapDrillMm: 12.8 },
  { diameterMm: 14, pitchMm: 1.5, tapDrillMm: 12.5 },
  { diameterMm: 16, pitchMm: 1, tapDrillMm: 15 },
  { diameterMm: 16, pitchMm: 1.5, tapDrillMm: 14.5 },
  { diameterMm: 18, pitchMm: 1.5, tapDrillMm: 16.5 },
  { diameterMm: 20, pitchMm: 1, tapDrillMm: 19 },
  { diameterMm: 20, pitchMm: 1.5, tapDrillMm: 18.5 },
  { diameterMm: 20, pitchMm: 2, tapDrillMm: 18 },
  { diameterMm: 22, pitchMm: 1.5, tapDrillMm: 20.5 },
  { diameterMm: 24, pitchMm: 1.5, tapDrillMm: 22.5 },
  { diameterMm: 24, pitchMm: 2, tapDrillMm: 22 },
  { diameterMm: 27, pitchMm: 1.5, tapDrillMm: 25.5 },
  { diameterMm: 27, pitchMm: 2, tapDrillMm: 25 },
  { diameterMm: 30, pitchMm: 1.5, tapDrillMm: 28.5 },
  { diameterMm: 30, pitchMm: 2, tapDrillMm: 28 },
];

export function findMetricThread(diameterMm: number): MetricThreadRow | undefined {
  return METRIC_THREADS.find((row) => row.diameterMm === diameterMm);
}

export function findFinePitch(diameterMm: number, pitchMm: number): FinePitchRow | undefined {
  return FINE_PITCHES.find((row) => row.diameterMm === diameterMm && row.pitchMm === pitchMm);
}
