/**
 * Сохранение готового PDF.
 *
 * В браузере файл уходит обычным скачиванием (никакого диалога печати). В упакованном `.exe`
 * (Tauri) пользователь ждёт нативное «Сохранить как…» — поэтому там вызываются плагины
 * dialog/fs, а при любой их отсутствии мы молча откатываемся к скачиванию.
 *
 * Все импорты нативных плагинов динамические: веб-сборка их не тянет, тесты не резолвят.
 */
import { detectRuntime } from './runtimeConfig';

export const PDF_MIME = 'application/pdf';

export function isNativeShell(): boolean {
  return detectRuntime() === 'tauri-desktop';
}

/** Подпись кнопки: в `.exe` — «Сохранить PDF», в браузере — «Скачать PDF-инструкцию». */
export function saveLabel(): string {
  return isNativeShell() ? 'Сохранить PDF' : 'Скачать PDF-инструкцию';
}

export interface SaveFileResult {
  saved: boolean;
  /** Куда сохранили (только в нативном диалоге). */
  path: string | null;
  /** `true`, если сработало обычное скачивание вместо нативного диалога. */
  fallback: boolean;
}

function downloadBlob(fileName: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function tauriSaveBinary(fileName: string, bytes: Uint8Array): Promise<SaveFileResult> {
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: 'PDF-инструкция', extensions: ['pdf'] }],
  });
  if (!path) {
    return { saved: false, path: null, fallback: false };
  }
  await writeFile(path, bytes);
  return { saved: true, path, fallback: false };
}

/** Сохраняет PDF: нативный диалог в `.exe`, скачивание в браузере. */
export async function savePdfFile(fileName: string, bytes: Uint8Array): Promise<SaveFileResult> {
  if (isNativeShell()) {
    try {
      return await tauriSaveBinary(fileName, bytes);
    } catch {
      // Плагин недоступен или окно закрылось — обычное скачивание всё равно сработает.
    }
  }
  downloadBlob(fileName, bytes, PDF_MIME);
  return { saved: true, path: null, fallback: true };
}
