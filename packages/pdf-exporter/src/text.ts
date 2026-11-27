/**
 * Измерение и перенос строк для PDF-инструкции.
 *
 * Перенос считается **до** рисования, по таблице ширин того самого шрифта, который встроен в `.pdf`
 * (`fonts/metrics.ts`, сгенерирован из DejaVu Sans). Поэтому предпросмотр в браузере и готовый файл
 * ломают строки одинаково: jsPDF получает уже разбитые строки и не пересчитывает их по-своему.
 */
import { FONT_UNITS_PER_EM, GLYPH_WIDTHS_BOLD, GLYPH_WIDTHS_REGULAR } from './fonts/metrics';

export type FontWeight = 'normal' | 'bold';

/** 1 пункт в миллиметрах: кегль задаётся в пунктах (как в типографике), геометрия — в миллиметрах. */
export const PT_MM = 25.4 / 72;

/** Ширина символа, которого нет в таблице (например, редкий иероглиф): средняя по шрифту. */
const FALLBACK_WIDTH = 1300; // ≈ 0.63 em — средняя ширина символа DejaVu Sans

function table(weight: FontWeight): Readonly<Record<string, number>> {
  return weight === 'bold' ? GLYPH_WIDTHS_BOLD : GLYPH_WIDTHS_REGULAR;
}

/** Ширина одного символа в единицах шрифта (unitsPerEm на em). */
export function glyphWidth(character: string, weight: FontWeight = 'normal'): number {
  return table(weight)[character] ?? FALLBACK_WIDTH;
}

/** Ширина строки в миллиметрах для кегля `sizePt` (в пунктах). */
export function measureText(text: string, sizePt: number, weight: FontWeight = 'normal'): number {
  const widths = table(weight);
  let units = 0;
  for (const character of text) {
    units += widths[character] ?? FALLBACK_WIDTH;
  }
  return (units / FONT_UNITS_PER_EM) * sizePt * PT_MM;
}

/**
 * Разбивает текст на строки, которые точно влезают в `maxWidthMm`.
 *
 * Переносы — по словам (как в типографике), длинное слово без пробелов режется по символам, явный
 * `\n` начинает новую строку. Пустые строки сохраняются: они нужны для отбивки абзацев.
 */
export function wrapText(
  text: string,
  maxWidthMm: number,
  sizePt: number,
  weight: FontWeight = 'normal',
): string[] {
  const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, sizePt, weight) <= maxWidthMm) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = '';
      }
      if (measureText(word, sizePt, weight) <= maxWidthMm) {
        current = word;
        continue;
      }
      // Слово длиннее строки: режем по символам, чтобы оно не выехало за поля.
      let chunk = '';
      for (const character of word) {
        const next = chunk + character;
        if (measureText(next, sizePt, weight) > maxWidthMm && chunk) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk = next;
        }
      }
      current = chunk;
    }
    if (current) {
      lines.push(current);
    }
  }
  // Хвостовые пустые строки не нужны: высоту блока считает вызывающий код.
  while (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/** Высота одной строки в миллиметрах: 1.28 × кегль даёт воздух между строками IKEA-вёрстки. */
export function lineHeight(sizePt: number): number {
  return sizePt * PT_MM * 1.28;
}

/** Высота блока текста: строки × межстрочный интервал. */
export function blockHeight(lines: readonly string[], sizePt: number): number {
  return Math.max(lineHeight(sizePt), lines.length * lineHeight(sizePt));
}

/** Обрезает текст по ширине, добавляя многоточие: нужно для подписей под схемами. */
export function ellipsize(
  text: string,
  maxWidthMm: number,
  sizePt: number,
  weight: FontWeight = 'normal',
): string {
  if (measureText(text, sizePt, weight) <= maxWidthMm) {
    return text;
  }
  const ellipsis = '…';
  let result = '';
  for (const character of text) {
    if (measureText(result + character + ellipsis, sizePt, weight) > maxWidthMm) {
      break;
    }
    result += character;
  }
  return `${result.trimEnd()}${ellipsis}`;
}
