const TRANSLITERATION: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** Stable ASCII slug for document and tool ids: «КС-04.100.000» → «ks-04-100-000». */
export function slugify(input: string): string {
  const lower = input.toLowerCase();
  const latin = Array.from(lower)
    .map((char) => TRANSLITERATION[char] ?? char)
    .join('');
  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'drawing';
}

/** FNV-1a 32-bit hash, the same one the studio uses for deep links. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Millimetres with a Russian decimal comma and no trailing zeros: 6.8 → «6,8», 20 → «20». */
export function mm(value: number, fractionDigits = 3): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  let text = value.toFixed(fractionDigits);
  if (text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (text === '-0') {
    text = '0';
  }
  return text.replace('.', ',');
}

/** Tolerances are always shown with three decimals: 20,000 … 20,021 мм. */
export function mmFixed(value: number, fractionDigits = 3): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(fractionDigits).replace('.', ',');
}

export function percent(confidence: number): number {
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}
