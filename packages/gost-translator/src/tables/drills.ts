/** Standard drill diameters of a shop drill set, millimetres. */
export const STANDARD_DRILL_DIAMETERS: readonly number[] = [
  1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
  3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4, 4.1, 4.2, 4.3, 4.5, 4.6, 4.8, 5, 5.1, 5.2, 5.5,
  5.7, 5.8, 6, 6.1, 6.3, 6.5, 6.6, 6.7, 6.8, 7, 7.2, 7.4, 7.5, 7.6, 7.8, 8, 8.2, 8.4, 8.5, 8.6, 8.8,
  9, 9.2, 9.5, 9.6, 9.8, 10, 10.2, 10.5, 10.8, 11, 11.2, 11.5, 11.8, 12, 12.5, 13, 13.5, 14, 14.5, 15,
  15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23, 23.5, 24, 24.5, 25,
  25.5, 26, 26.5, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
];

export interface DrillChoice {
  drillMm: number;
  exact: boolean;
}

/** Finds the closest standard drill not larger than the requested diameter (a hole can always be reamed bigger). */
export function chooseStandardDrill(requestedMm: number): DrillChoice {
  if (requestedMm <= 0) {
    return { drillMm: STANDARD_DRILL_DIAMETERS[0] ?? 1, exact: false };
  }
  let best = STANDARD_DRILL_DIAMETERS[0] ?? 1;
  for (const diameter of STANDARD_DRILL_DIAMETERS) {
    if (diameter <= requestedMm + 1e-9) {
      best = diameter;
    }
  }
  return { drillMm: best, exact: Math.abs(best - requestedMm) < 1e-9 };
}
