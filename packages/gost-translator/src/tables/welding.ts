export type WeldJointCode = 'С' | 'У' | 'Т' | 'Н';

export interface WeldJointDesign {
  designation: string;
  jointCode: WeldJointCode;
  jointVariant: number;
  jointName: string;
  edgePreparation: string;
  seamType: string;
  description: string;
}

export const WELD_JOINT_NAMES: Readonly<Record<WeldJointCode, string>> = {
  С: 'Стыковое соединение',
  У: 'Угловое соединение',
  Т: 'Тавровое соединение',
  Н: 'Нахлёсточное соединение',
};

export const WELD_JOINT_CODE_HINTS: Readonly<Record<WeldJointCode, string>> = {
  С: 'детали лежат в одной плоскости, кромки стыкуются торцами',
  У: 'детали расположены под углом и свариваются по кромке',
  Т: 'одна деталь примыкает торцом к поверхности другой (буква «Т»)',
  Н: 'детали наложены друг на друга с перекрытием',
};

/**
 * Standard welded joint designs of GOST 5264-80 (manual arc welding).
 * Only designs with unambiguous edge preparation are listed; unknown variants fall back to the joint code description.
 */
export const WELD_JOINT_DESIGNS: readonly WeldJointDesign[] = [
  { designation: 'С1', jointCode: 'С', jointVariant: 1, jointName: 'Стыковое соединение', edgePreparation: 'с отбортовкой кромок', seamType: 'односторонний', description: 'тонкий лист с отбортовкой, шов с одной стороны' },
  { designation: 'С2', jointCode: 'С', jointVariant: 2, jointName: 'Стыковое соединение', edgePreparation: 'без скоса кромок', seamType: 'односторонний', description: 'кромки стыкуются без разделки, провар с одной стороны' },
  { designation: 'С4', jointCode: 'С', jointVariant: 4, jointName: 'Стыковое соединение', edgePreparation: 'без скоса кромок', seamType: 'двусторонний', description: 'кромки стыкуются без разделки, провар с двух сторон' },
  { designation: 'С7', jointCode: 'С', jointVariant: 7, jointName: 'Стыковое соединение', edgePreparation: 'V-образный скос одной кромки', seamType: 'односторонний', description: 'одна кромка скошена под V, шов с одной стороны' },
  { designation: 'С8', jointCode: 'С', jointVariant: 8, jointName: 'Стыковое соединение', edgePreparation: 'V-образный скос двух кромок', seamType: 'односторонний', description: 'две кромки скошены под V, шов с одной стороны' },
  { designation: 'С17', jointCode: 'С', jointVariant: 17, jointName: 'Стыковое соединение', edgePreparation: 'X-образный скос двух кромок', seamType: 'двусторонний', description: 'две кромки скошены под X, провар с двух сторон' },
  { designation: 'У2', jointCode: 'У', jointVariant: 2, jointName: 'Угловое соединение', edgePreparation: 'без скоса кромок', seamType: 'односторонний', description: 'угловой шов с одной стороны' },
  { designation: 'У4', jointCode: 'У', jointVariant: 4, jointName: 'Угловое соединение', edgePreparation: 'без скоса кромок', seamType: 'односторонний', description: 'классический угловой шов с наружной стороны' },
  { designation: 'У5', jointCode: 'У', jointVariant: 5, jointName: 'Угловое соединение', edgePreparation: 'без скоса кромок', seamType: 'двусторонний', description: 'угловые швы с двух сторон' },
  { designation: 'У6', jointCode: 'У', jointVariant: 6, jointName: 'Угловое соединение', edgePreparation: 'со скосом одной кромки', seamType: 'односторонний', description: 'угловое соединение с разделкой одной кромки' },
  { designation: 'У8', jointCode: 'У', jointVariant: 8, jointName: 'Угловое соединение', edgePreparation: 'со скосом двух кромок', seamType: 'односторонний', description: 'угловое соединение с разделкой двух кромок' },
  { designation: 'Т1', jointCode: 'Т', jointVariant: 1, jointName: 'Тавровое соединение', edgePreparation: 'без скоса кромок', seamType: 'односторонний', description: 'шов с одной стороны примыкающей детали' },
  { designation: 'Т3', jointCode: 'Т', jointVariant: 3, jointName: 'Тавровое соединение', edgePreparation: 'без скоса кромок', seamType: 'двусторонний', description: 'швы с двух сторон примыкающей детали' },
  { designation: 'Т6', jointCode: 'Т', jointVariant: 6, jointName: 'Тавровое соединение', edgePreparation: 'со скосом одной кромки', seamType: 'односторонний', description: 'тавровое соединение с разделкой примыкающей кромки' },
  { designation: 'Н1', jointCode: 'Н', jointVariant: 1, jointName: 'Нахлёсточное соединение', edgePreparation: 'без скоса кромок', seamType: 'односторонний', description: 'нахлёст, шов с одной стороны' },
  { designation: 'Н2', jointCode: 'Н', jointVariant: 2, jointName: 'Нахлёсточное соединение', edgePreparation: 'без скоса кромок', seamType: 'двусторонний', description: 'нахлёст, швы с двух сторон' },
];

export function findWeldJointDesign(designation: string): WeldJointDesign | undefined {
  return WELD_JOINT_DESIGNS.find((row) => row.designation.toUpperCase() === designation.toUpperCase());
}

/** Recommended current range for manual arc welding, amperes, based on electrode diameter. */
export function recommendedCurrentA(electrodeDiameterMm: number): [number, number] {
  const base = Math.round(electrodeDiameterMm * 30);
  return [base - 10, base + 20];
}
