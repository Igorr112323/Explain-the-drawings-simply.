/**
 * Имена и роли деталей, общие для серверного и браузерного разбора 3D.
 *
 * Вынесено из `cadOffline`, чтобы эти функции можно было использовать без three.js: их импортирует
 * и лёгкая часть конвейера, и тяжёлый упаковщик GLB.
 */
import type { CadPartPayload } from '@ikguide/builder';

export const FASTENER = /(болт|винт|гайк|шайб|шпильк|саморез|закл[её]пк|штифт|bolt|screw|nut|washer|stud|rivet)/i;

/** `kryshka_01` → «Kryshka 01»; русские имена не трогаем, только подчищаем разделители. */
export function humanize(name: string): string {
  const cleaned = name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'Деталь';
  }
  if (/^[a-z0-9\s.-]+$/.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/** `Bolt_M8x30` → `М8×30`, чтобы крепёж попал в спецификацию с обозначением. */
export function shapeNotation(name: string): string | null {
  const match = name.match(/[МM](\d{1,2})[x×х](\d{1,3})/);
  return match ? `М${match[1]}×${match[2]}` : null;
}

export function roleOf(name: string, volume: number, biggest: number): CadPartPayload['role'] {
  if (FASTENER.test(name) || volume < biggest * 0.004) {
    return 'fastener';
  }
  return 'part';
}
