// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeShell, saveLabel, savePdfFile } from './nativeExport';

const PDF = new TextEncoder().encode('%PDF-1.7\n…\n%%EOF');

let clicked: HTMLAnchorElement[];

beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mock(this: HTMLAnchorElement) {
    clicked.push(this);
  });
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:pdf'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('сохранение PDF', () => {
  it('в браузере скачивает файл, а не открывает диалог печати', async () => {
    expect(isNativeShell()).toBe(false);
    expect(saveLabel()).toBe('Скачать PDF-инструкцию');

    const result = await savePdfFile('Кронштейн_инструкция.pdf', PDF);
    expect(result).toEqual({ saved: true, path: null, fallback: true });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('Кронштейн_инструкция.pdf');
    expect(clicked[0]?.href).toContain('blob:pdf');
    // Ссылка не остаётся в документе
    expect(document.querySelector('a[download]')).toBeNull();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('в упакованном .exe подпись кнопки другая', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isNativeShell()).toBe(true);
    expect(saveLabel()).toBe('Сохранить PDF');
  });

  it('если нативные плагины недоступны, всё равно скачивается файл', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const result = await savePdfFile('УП-08_инструкция.pdf', PDF);
    expect(result.fallback).toBe(true);
    expect(clicked).toHaveLength(1);
  });
});
