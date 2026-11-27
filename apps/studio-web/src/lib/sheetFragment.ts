/**
 * Фрагменты настоящего чертежа для шагов после распознавания.
 *
 * Когда инструкция собрана из скана, абстрактная пиктограмма вместо схемы — обман: человеку нужен
 * его собственный лист. Поэтому каждая страница шага получает обрезанный до нужных обозначений
 * фрагмент листа, уменьшенный до печатного размера (иначе PDF распухал бы в разы).
 *
 * Всё считается в браузере через canvas. Если canvas недоступен (jsdom, тесты) или картинка не
 * читается, функции возвращают `null` — вызывающая сторона рисует векторную схему из арт-реестра.
 */
import type { XrayAnnotation } from '@ikguide/schema';

export interface FragmentBox {
  /** Доли листа, 0…1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

const PADDING = 0.1;
const MIN_SIDE = 0.28;
const PDF_WIDTH = 720;

/** Границы фрагмента: объединение обозначений шага плюс воздух; без обозначений — весь лист. */
export function fragmentBox(annotations: readonly XrayAnnotation[], fallback = 1): FragmentBox {
  if (annotations.length === 0) {
    return { x: 0, y: 0, width: fallback, height: fallback };
  }
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const annotation of annotations) {
    const halfW = 0.04;
    const halfH = 0.03;
    left = Math.min(left, annotation.xPercent / 100 - halfW);
    right = Math.max(right, annotation.xPercent / 100 + halfW);
    top = Math.min(top, annotation.yPercent / 100 - halfH);
    bottom = Math.max(bottom, annotation.yPercent / 100 + halfH);
  }
  const padX = Math.max(PADDING, (right - left) * 0.4);
  const padY = Math.max(PADDING, (bottom - top) * 0.4);
  left = Math.max(0, left - padX);
  right = Math.min(1, right + padX);
  top = Math.max(0, top - padY);
  bottom = Math.min(1, bottom + padY);

  let width = Math.max(MIN_SIDE, right - left);
  let height = Math.max(MIN_SIDE * 0.7, bottom - top);
  width = Math.min(width, 1);
  height = Math.min(height, 1);
  // Держим пропорции листа: фрагмент не должен выглядеть сплющенным.
  const aspect = 1.414;
  if (width / height < aspect) {
    width = Math.min(1, height * aspect);
  } else {
    height = Math.min(1, width / aspect);
  }
  const x = Math.min(Math.max(0, (left + right) / 2 - width / 2), 1 - width);
  const y = Math.min(Math.max(0, (top + bottom) / 2 - height / 2), 1 - height);
  return { x, y, width, height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось прочитать лист чертежа.'));
    image.src = src;
  });
}

function canvasAvailable(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const canvas = document.createElement('canvas');
  return typeof canvas.getContext === 'function' && canvas.getContext('2d') !== null;
}

/**
 * Обрезает лист до `box` и отдаёт JPEG нужной ширины — компактный фрагмент для печати.
 * `null` означает «делай векторную схему»: тихо, без исключений.
 */
export async function cropSheet(dataUrl: string, box: FragmentBox, width = PDF_WIDTH): Promise<string | null> {
  if (!canvasAvailable()) {
    return null;
  }
  try {
    const image = await loadImage(dataUrl);
    const sourceW = image.naturalWidth || image.width;
    const sourceH = image.naturalHeight || image.height;
    if (sourceW === 0 || sourceH === 0) {
      return null;
    }
    const sx = Math.round(box.x * sourceW);
    const sy = Math.round(box.y * sourceH);
    const sw = Math.max(16, Math.round(box.width * sourceW));
    const sh = Math.max(16, Math.round(box.height * sourceH));
    const targetW = Math.min(width, sw);
    const targetH = Math.max(1, Math.round((sh / sw) * targetW));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetW, targetH);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, targetW, targetH);
    const result = canvas.toDataURL('image/jpeg', 0.82);
    return result.startsWith('data:image/jpeg') ? result : null;
  } catch {
    return null;
  }
}

/** Фрагмент шага по его `drawingRefs`; без ссылок — весь лист (обрезанный по рамке). */
export async function stepFragment(
  pageDataUrl: string,
  annotations: readonly XrayAnnotation[],
  refs: readonly string[],
): Promise<string | null> {
  const selected = annotations.filter((annotation) => refs.includes(annotation.id));
  const box = fragmentBox(selected.length > 0 ? selected : annotations);
  return cropSheet(pageDataUrl, selected.length > 0 ? box : { x: 0.04, y: 0.03, width: 0.92, height: 0.9 });
}
