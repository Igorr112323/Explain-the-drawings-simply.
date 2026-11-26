/**
 * «Загрузить 2D-чертёж или PDF» в `.exe`: системный проводник Windows с фильтром расширений.
 *
 * В браузере нативного диалога нет — там работает обычный `<input type="file">`. Поэтому функция
 * возвращает `null` в вебе, и вызывающий код просто кликает по скрытому полю. Плагины Tauri
 * импортируются динамически: веб-сборка их не тянет, а тесты не резолвят.
 */
import { isNativeShell } from './nativeExport';

/** Расширения, которые продукт понимает: только 2D-чертежи и PDF. */
export const DRAWING_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const;

/** Имя файла из пути Windows или POSIX. */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** Нативный выбор файла. `null` — либо веб, либо пользователь закрыл диалог. */
export async function pickDrawingFile(): Promise<File | null> {
  if (!isNativeShell()) {
    return null;
  }
  try {
    const [{ open }, { readFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const picked = await open({
      multiple: false,
      directory: false,
      title: 'Выберите 2D-чертёж или PDF',
      filters: [{ name: '2D-чертёж или PDF', extensions: [...DRAWING_EXTENSIONS] }],
    });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) {
      return null;
    }
    const bytes = await readFile(path);
    return new File([bytes as unknown as BlobPart], baseName(path));
  } catch {
    // Плагин недоступен — пусть сработает обычное поле выбора файла.
    return null;
  }
}
