import type { CadImportResponse } from '@ikguide/builder';

/**
 * Офлайн-импорт 3D: `.glb`/`.gltf` разбирается прямо в браузере, без Python-сервиса, и превращается
 * в черновик ответа cad-api — дальше документ собирает тот же `buildGuideFromCad`.
 *
 * Здесь живёт только «обвязка»: проверка формата, чтение файла и человеческие ошибки. Сам разборщик
 * (`glbPacker`, вместе с three.js) подгружается динамически — главный экран студии не тянет 600 КБ
 * графической библиотеки, пока человек не перетащил модель.
 *
 * STEP и STL честно отклоняются: их иерархия и тесселяция требуют сервиса.
 */

export class OfflineImportError extends Error {
  readonly hint: string | null;

  constructor(message: string, hint: string | null = null) {
    super(message);
    this.name = 'OfflineImportError';
    this.hint = hint;
  }
}

export interface OfflineImportOptions {
  fileName?: string;
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new OfflineImportError('Не удалось прочитать файл модели.'));
    reader.readAsDataURL(file);
  });
}

export async function importMeshOffline(file: File, options: OfflineImportOptions = {}): Promise<CadImportResponse> {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (extension === '.step' || extension === '.stp') {
    throw new OfflineImportError('STEP без сервера не разобрать: нужна тесселяция и дерево сборки.', 'step');
  }
  if (extension !== '.glb' && extension !== '.gltf') {
    throw new OfflineImportError(
      `Формат ${extension || 'файла'} поддерживается только через сервер 3D-моделей.`,
      'server',
    );
  }

  const dataUrl = await readDataUrl(file);
  const { packGlb, GlbReadError } = await import('./glbPacker');
  try {
    return await packGlb(dataUrl, options.fileName ?? file.name);
  } catch (error) {
    if (error instanceof GlbReadError) {
      throw new OfflineImportError(error.message, 'corrupt');
    }
    throw error;
  }
}
