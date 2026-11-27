/** Formats millimetres the way Russian drawings and workers expect: comma decimal separator, no trailing zeros. */
export function formatMm(valueMm: number, fractionDigits = 3): string {
  const fixed = valueMm.toFixed(fractionDigits).replace(/\.?0+$/, '');
  return fixed.replace('.', ',');
}

/** Formats micrometres as a signed millimetre value with 3 decimals: +0,021 / -0,007. */
export function formatSignedMm(um: number): string {
  const mm = um / 1000;
  const fixed = Math.abs(mm).toFixed(3).replace('.', ',');
  if (mm === 0) {
    return '0,000';
  }
  return `${mm > 0 ? '+' : '−'}${fixed}`;
}

/** Formats micrometres as whole micrometres with sign: +21 мкм / −7 мкм. */
export function formatSignedUm(um: number): string {
  if (um === 0) {
    return '0 мкм';
  }
  const value = Math.abs(um) % 1 === 0 ? `${Math.abs(um)}` : `${Math.abs(um).toFixed(1).replace('.', ',')}`;
  return `${um > 0 ? '+' : '−'}${value} мкм`;
}

/** Converts a string with either comma or dot decimal separator into a number. */
export function parseDecimal(value: string): number {
  return Number(value.replace(',', '.').replace(/\s/g, ''));
}

export function normalizeNotation(raw: string): string {
  return raw
    .replace(/[⌀∅]/g, 'Ø')
    .replace(/[×х]/g, '×')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keeps one Russian plural form helper for tool counters in explanations. */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}
