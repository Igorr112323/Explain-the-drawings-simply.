import { describe, expect, it } from 'vitest';
import {
  FIT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  RESET_ZOOM,
  ZOOM_STEP,
  clampZoom,
  scrollAfterZoom,
  wheelFactor,
  zoomFromWheel,
  zoomHint,
  zoomIn,
  zoomLabel,
  zoomOut,
} from './zoom';

describe('масштаб холста', () => {
  it('держит диапазон 40…250 %', () => {
    expect(MIN_ZOOM).toBe(0.4);
    expect(MAX_ZOOM).toBe(2.5);
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(RESET_ZOOM);
    expect(clampZoom(1.23456)).toBe(1.235);
  });

  it('пилюля показывает целые проценты', () => {
    expect(zoomLabel(FIT_ZOOM)).toBe('72%');
    expect(zoomLabel(RESET_ZOOM)).toBe('100%');
    expect(zoomLabel(0.4)).toBe('40%');
    expect(zoomLabel(2.5)).toBe('250%');
    expect(zoomLabel(9)).toBe('250%');
  });

  it('кнопки «+» и «−» идут шагами 25 % и не выходят за границы', () => {
    expect(zoomIn(1)).toBeCloseTo(1 + ZOOM_STEP, 5);
    expect(zoomIn(0.72)).toBe(0.75);
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(1)).toBeCloseTo(1 - ZOOM_STEP, 5);
    expect(zoomOut(0.72)).toBe(0.5);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
    // Из 0,75 шаг вверх — ровно 100 %, обратно — снова 0,75: никаких «застрявших» значений.
    expect(zoomIn(0.75)).toBe(1);
    expect(zoomOut(zoomIn(0.75))).toBe(0.75);
  });

  it('колесо: вверх — крупнее, вниз — мельче, пинч резче', () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100, true)).toBeGreaterThan(wheelFactor(-100));
    // Множитель не «улетает» на тачпадах с большим deltaY.
    expect(wheelFactor(-5000)).toBeLessThanOrEqual(1.35);
    expect(wheelFactor(5000)).toBeGreaterThanOrEqual(1 / 1.35);

    const zoomedIn = zoomFromWheel(1, -100);
    const zoomedOut = zoomFromWheel(1, 100);
    expect(zoomedIn).toBeGreaterThan(1);
    expect(zoomedOut).toBeLessThan(1);
    expect(zoomFromWheel(MAX_ZOOM, -10000)).toBe(MAX_ZOOM);
    expect(zoomFromWheel(MIN_ZOOM, 10000)).toBe(MIN_ZOOM);
  });

  it('прокрутка сохраняет точку под курсором', () => {
    // Курсор на 300 px от левого края, сдвиг уже 200: точка «200 + 300».
    const next = scrollAfterZoom(200, 300, 1, 2);
    expect(next).toBe(2 * (200 + 300) - 300);
    // Масштаб не изменился — прокрутка тоже.
    expect(scrollAfterZoom(0, 100, 1, 1)).toBe(0);
    expect(scrollAfterZoom(50, 100, 0, 1)).toBe(50);
    expect(scrollAfterZoom(50, 100, 1, 0)).toBe(50);
    // Уменьшение масштаба не уводит стол в отрицательную прокрутку.
    expect(scrollAfterZoom(0, 10, 2, 0.5)).toBe(0);
  });

  it('подсказка короткая и говорит про способы зума', () => {
    expect(zoomHint()).toContain('Колесо');
    expect(zoomHint()).toContain('Ctrl 0');
  });
});
