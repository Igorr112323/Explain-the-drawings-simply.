import { describe, expect, it } from 'vitest';
import { DRAWING_EXTENSIONS, baseName, pickDrawingFile } from './nativeOpen';

describe('нативный выбор файла', () => {
  it('фильтр расширений покрывает растры, PDF и 3D', () => {
    expect([...DRAWING_EXTENSIONS]).toEqual([
      'jpg',
      'jpeg',
      'png',
      'webp',
      'pdf',
      'step',
      'stp',
      'stl',
      'obj',
      'glb',
      'gltf',
    ]);
  });

  it('вытаскивает имя файла из пути Windows и POSIX', () => {
    expect(baseName('C:\\Чертежи\\Кронштейн КС-04.pdf')).toBe('Кронштейн КС-04.pdf');
    expect(baseName('/home/master/box.glb')).toBe('box.glb');
    expect(baseName('model.glb')).toBe('model.glb');
  });

  it('в браузере молчит: там работает обычное поле выбора файла', async () => {
    await expect(pickDrawingFile()).resolves.toBeNull();
  });
});
