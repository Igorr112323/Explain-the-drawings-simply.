/**
 * Масштаб холста с листами A4: чистые функции, чтобы поведение зума проверялось без DOM.
 *
 * Ограничения продуктовые: 40 % — «обзор всех листов», 250 % — «читаю мелкий размер на выноске».
 * Всё остальное (колесо, жесты, клавиши, пилюля) — только тонкая обвязка над этими функциями.
 */

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.5;
/** Стартовый масштаб: листы ложатся на стол так же, как раньше, — без сюрпризов при открытии. */
export const FIT_ZOOM = 0.72;
/** Кнопка «100 %» и Ctrl+0 возвращают именно этот масштаб. */
export const RESET_ZOOM = 1;

/** Шаг кнопок «−» и «+» и клавиш Ctrl+«+»/«−». */
export const ZOOM_STEP = 0.25;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Масштаб всегда внутри 40…250 %: иначе лист либо исчезает, либо перестаёт быть листом. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return RESET_ZOOM;
  }
  return round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)));
}

/** «72 %» для пилюли: целые проценты, без хвостов. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

/** Кнопка «+»: следующий аккуратный шаг, не выходя за границы. */
export function zoomIn(zoom: number): number {
  const step = Math.floor(clampZoom(zoom) / ZOOM_STEP + 1e-9);
  return clampZoom((step + 1) * ZOOM_STEP);
}

/** Кнопка «−»: предыдущий шаг, не выходя за границы. */
export function zoomOut(zoom: number): number {
  const step = Math.ceil(clampZoom(zoom) / ZOOM_STEP - 1e-9);
  return clampZoom((step - 1) * ZOOM_STEP);
}

/**
 * Множитель для колеса: обычное колесо и пинч трекпада (он приходит как wheel + ctrlKey) дают
 * плавное, но предсказуемое изменение. Один «клик» колеса ≈ 5–8 %.
 */
export function wheelFactor(deltaY: number, pinch = false): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return 1;
  }
  const raw = Math.exp(-deltaY * (pinch ? 0.01 : 0.0016));
  return Math.min(1.35, Math.max(1 / 1.35, raw));
}

/** Новый масштаб после колеса: один вызов = один шаг, без накопления ошибок. */
export function zoomFromWheel(zoom: number, deltaY: number, pinch = false): number {
  return clampZoom(zoom * wheelFactor(deltaY, pinch));
}

/**
 * Куда прокрутить стол после смены масштаба, чтобы точка под курсором осталась на месте.
 * Листы лежат в обычном потоке, поэтому смещение масштабируется вместе с ними.
 */
export function scrollAfterZoom(
  scroll: number,
  pointer: number,
  previous: number,
  next: number,
): number {
  if (previous <= 0 || next <= 0) {
    return scroll;
  }
  const ratio = next / previous;
  return Math.max(0, (scroll + pointer) * ratio - pointer);
}

/** Человеческая подсказка под пилюлей — одна строка, без панелей. */
export function zoomHint(): string {
  return 'Колесо — масштаб · пробел + перетаскивание — сдвиг · Ctrl 0 — 100 %';
}
