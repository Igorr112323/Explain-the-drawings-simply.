// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bracketDocument, gearboxDocument } from '../data/demos';
import {
  clearAllGuides,
  getGuide,
  listGuides,
  persistGuide,
  removeGuide,
  resetOfflineStoreForTests,
  saveGuide,
  setPinned,
  storeBackendName,
} from './offlineStore';

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  resetOfflineStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('offline library', () => {
  it('falls back to localStorage in jsdom, where there is no IndexedDB', async () => {
    expect(storeBackendName()).toBe('localstorage');
  });

  it('stores an instruction and reads it back with all its steps', async () => {
    const saved = await saveGuide(bracketDocument, { source: 'engineer', savedAt: '2026-01-01T10:00:00.000Z' });
    expect(saved.id).toBe(bracketDocument.id);
    expect(saved.doc.steps).toHaveLength(bracketDocument.steps.length);

    const guides = await listGuides();
    expect(guides).toHaveLength(1);
    expect(guides[0]!.doc.metadata.title).toBe(bracketDocument.metadata.title);

    const single = await getGuide(bracketDocument.id);
    expect(single?.doc.id).toBe(bracketDocument.id);
    expect(await getGuide('nope')).toBeNull();
  });

  it('keeps the newest first and pinned instructions above them', async () => {
    await saveGuide(bracketDocument, { savedAt: '2026-01-01T10:00:00.000Z' });
    await saveGuide(gearboxDocument, { savedAt: '2026-02-01T10:00:00.000Z' });
    let guides = await listGuides();
    expect(guides.map((entry) => entry.id)).toEqual([gearboxDocument.id, bracketDocument.id]);

    await setPinned(bracketDocument.id, true);
    guides = await listGuides();
    expect(guides.map((entry) => entry.id)).toEqual([bracketDocument.id, gearboxDocument.id]);
    expect(guides[0]!.pinned).toBe(true);
    expect(guides[0]!.savedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(guides[1]!.pinned).toBe(false);
  });

  it('does not lose the «Доступно офлайн» pin when the same instruction is re-saved', async () => {
    await saveGuide(bracketDocument, { pinned: true, savedAt: '2026-01-01T10:00:00.000Z' });
    await saveGuide(bracketDocument, { source: 'import', savedAt: '2026-03-01T10:00:00.000Z' });
    const guides = await listGuides();
    expect(guides).toHaveLength(1);
    expect(guides[0]!.pinned).toBe(true);
    expect(guides[0]!.savedAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('removes one instruction and can be emptied', async () => {
    await saveGuide(bracketDocument, { savedAt: '2026-01-01T10:00:00.000Z' });
    await saveGuide(gearboxDocument, { savedAt: '2026-02-01T10:00:00.000Z' });
    await removeGuide(bracketDocument.id);
    expect((await listGuides()).map((entry) => entry.id)).toEqual([gearboxDocument.id]);
    await clearAllGuides();
    expect(await listGuides()).toEqual([]);
  });

  it('refuses a broken document instead of storing garbage', async () => {
    const broken = { ...bracketDocument, steps: [] } as unknown as typeof bracketDocument;
    await expect(saveGuide(broken)).rejects.toThrow(/схем/);
    expect(await listGuides()).toEqual([]);
  });

  it('ignores corrupted entries already lying in storage', async () => {
    window.localStorage.setItem('ikguide.offline.v1', JSON.stringify([{ id: 'x' }, { id: 'y', doc: { nope: true } }]));
    expect(await listGuides()).toEqual([]);
    window.localStorage.setItem('ikguide.offline.v1', 'not json');
    expect(await listGuides()).toEqual([]);
  });

  it('never throws from persistGuide — it is called from click handlers', async () => {
    const broken = { ...bracketDocument, id: 'no steps', steps: [] } as unknown as typeof bracketDocument;
    await expect(persistGuide(broken)).resolves.toBeNull();
    await expect(persistGuide(gearboxDocument, { source: 'qr' })).resolves.toMatchObject({ source: 'qr' });
  });

  it('keeps working in memory when the browser blocks both storages', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    resetOfflineStoreForTests();
    expect(storeBackendName()).toBe('memory');

    await saveGuide(gearboxDocument, { savedAt: '2026-01-01T10:00:00.000Z' });
    const guides = await listGuides();
    expect(guides).toHaveLength(1);
    expect(guides[0]!.id).toBe(gearboxDocument.id);
  });
});
