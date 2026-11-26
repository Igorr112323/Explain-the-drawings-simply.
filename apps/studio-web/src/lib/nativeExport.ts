/**
 * Native file access for the packaged shells.
 *
 * In the browser an instruction leaves the studio as a download. Inside the `.exe` (Tauri) the
 * engineer expects a real `Сохранить как…` dialog with `.ikguide.json`, PDF or a standalone HTML —
 * so this module talks to the Tauri dialog/fs plugins, and **falls back to the ordinary browser
 * download** everywhere else (including a Tauri build where a plugin is missing).
 *
 * Every import is dynamic: the web bundle never loads the native plugins, and Vitest/jsdom never
 * resolves them at all.
 */
import { detectRuntime } from './runtimeConfig';
import { downloadText, sanitizeFileName } from './download';

export function isNativeShell(): boolean {
  return detectRuntime() === 'tauri-desktop';
}

/** Optional Tauri-only extras used by the UI to relabel buttons: «Сохранить на диск» vs «Скачать». */
export function saveLabel(): string {
  return isNativeShell() ? 'Сохранить на диск' : 'Скачать';
}

export interface SaveTextResult {
  saved: boolean;
  /** Where the file went, for the toast. */
  path: string | null;
  /** True when the platform fell back to a browser download. */
  fallback: boolean;
}

async function tauriSave(defaultName: string, text: string, filters: { name: string; extensions: string[] }[]) {
  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const path = await save({ defaultPath: defaultName, filters });
  if (!path) {
    return { saved: false, path: null, fallback: false } satisfies SaveTextResult;
  }
  await writeTextFile(path, text);
  return { saved: true, path, fallback: false } satisfies SaveTextResult;
}

/** Saves a text payload (JSON/HTML) with a native dialog in the `.exe`, a download elsewhere. */
export async function saveTextFile(
  fileName: string,
  text: string,
  options: { mimeType?: string; kind?: 'json' | 'html' } = {},
): Promise<SaveTextResult> {
  const kind = options.kind ?? 'json';
  const filters =
    kind === 'html'
      ? [{ name: 'Автономная HTML-инструкция', extensions: ['html'] }]
      : [{ name: 'Инструкция IkGuide', extensions: ['json'] }];
  if (isNativeShell()) {
    try {
      return await tauriSave(fileName, text, filters);
    } catch {
      // Plugin unavailable or the user cancelled inside a failing window: fall through to download.
    }
  }
  downloadText(fileName, text, options.mimeType ?? (kind === 'html' ? 'text/html' : 'application/json'));
  return { saved: true, path: null, fallback: true };
}

/** Opens a text file through the native dialog in the `.exe`; returns null when the user cancels. */
export async function openTextFileNative(): Promise<{ name: string; path: string; text: string } | null> {
  if (!isNativeShell()) {
    return null;
  }
  const [{ open }, { readTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Инструкция IkGuide', extensions: ['json'] }],
  });
  if (!picked || Array.isArray(picked)) {
    return null;
  }
  const text = await readTextFile(picked);
  const name = picked.split(/[\\/]/).pop() ?? 'guide.json';
  return { name, path: picked, text };
}

/** Prints the current sheet through the Tauri window API, falling back to `window.print()`. */
export async function printNative(): Promise<void> {
  if (isNativeShell()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('print_sheet');
      return;
    } catch {
      // Command missing in an older build: use the browser path.
    }
  }
  if (typeof window !== 'undefined') {
    window.print();
  }
}

/** File name for a guide package, shared by the browser and the native shells. */
export function guideFileName(code: string): string {
  return `${sanitizeFileName(code)}.ikguide.json`;
}
