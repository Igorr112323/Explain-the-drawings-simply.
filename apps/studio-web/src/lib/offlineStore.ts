/**
 * Offline library of instructions.
 *
 * Everything the engineer creates, imports, scans or receives over the QR bridge is stored locally,
 * so the tablet keeps working in a workshop without Wi-Fi. Storage is layered on purpose:
 *
 *   1. **IndexedDB** — the real shop-floor storage (hundreds of instructions, no 5 MB quota drama);
 *   2. **localStorage** — fallback for jsdom/Vitest and for browsers with IndexedDB disabled;
 *   3. **in-memory** — last resort, so the UI never crashes on a locked-down browser.
 */
import { ikGuideDocumentSchema, type IkGuideDocument } from '@ikguide/schema';

export type GuideSource = 'engineer' | 'scan' | 'qr' | 'import' | 'demo';

export interface StoredGuide {
  id: string;
  /** The document itself (already validated when it was saved). */
  doc: IkGuideDocument;
  savedAt: string;
  source: GuideSource;
  /** «Доступно офлайн»: the worker sees it in the pinned block of the home screen. */
  pinned: boolean;
}

export interface SaveGuideOptions {
  source?: GuideSource;
  pinned?: boolean;
  savedAt?: string;
}

export type StoreBackend = 'indexeddb' | 'localstorage' | 'memory';

const DB_NAME = 'ikguide-offline';
const DB_VERSION = 1;
const STORE_NAME = 'guides';
const FALLBACK_KEY = 'ikguide.offline.v1';

const memory = new Map<string, StoredGuide>();

let backend: StoreBackend | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      return false;
    }
    const probe = '__ikguide_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function resolveBackend(): StoreBackend {
  if (backend) {
    return backend;
  }
  if (hasIndexedDb()) {
    backend = 'indexeddb';
  } else if (hasLocalStorage()) {
    backend = 'localstorage';
  } else {
    backend = 'memory';
  }
  return backend;
}

/** Which backend is actually in use — shown in the settings dialog and asserted in tests. */
export function storeBackendName(): StoreBackend {
  return resolveBackend();
}

/** Test hook: forget the detected backend (and any cached connection). */
export function resetOfflineStoreForTests(): void {
  backend = null;
  dbPromise = null;
  memory.clear();
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function readFallback(): StoredGuide[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(FALLBACK_KEY);
    if (!raw) {
      return [...memory.values()];
    }
    const parsed = JSON.parse(raw) as StoredGuide[];
    return Array.isArray(parsed) ? parsed : [...memory.values()];
  } catch {
    return [...memory.values()];
  }
}

function writeFallback(guides: StoredGuide[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(guides));
      return;
    }
  } catch {
    // Quota exceeded or storage disabled — keep the data in memory for this session.
  }
  memory.clear();
  guides.forEach((guide) => memory.set(guide.id, guide));
}

function normalize(entry: StoredGuide): StoredGuide | null {
  const validation = ikGuideDocumentSchema.safeParse(entry.doc);
  if (!validation.success) {
    return null;
  }
  return {
    id: entry.id,
    doc: validation.data,
    savedAt: entry.savedAt,
    source: entry.source,
    pinned: Boolean(entry.pinned),
  };
}

function sortGuides(guides: StoredGuide[]): StoredGuide[] {
  return [...guides].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return b.savedAt.localeCompare(a.savedAt);
  });
}

export async function listGuides(): Promise<StoredGuide[]> {
  if (resolveBackend() !== 'indexeddb') {
    return sortGuides(readFallback().flatMap((entry) => normalize(entry) ?? []));
  }
  const db = await openDatabase();
  if (!db) {
    backend = hasLocalStorage() ? 'localstorage' : 'memory';
    return sortGuides(readFallback().flatMap((entry) => normalize(entry) ?? []));
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const rows = (request.result ?? []) as StoredGuide[];
        resolve(sortGuides(rows.flatMap((entry) => normalize(entry) ?? [])));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function saveGuide(doc: IkGuideDocument, options: SaveGuideOptions = {}): Promise<StoredGuide> {
  const validation = ikGuideDocumentSchema.safeParse(doc);
  if (!validation.success) {
    throw new Error('Документ не прошёл проверку схемы и не сохранён офлайн.');
  }
  const entry: StoredGuide = {
    id: validation.data.id,
    doc: validation.data,
    savedAt: options.savedAt ?? new Date().toISOString(),
    source: options.source ?? 'engineer',
    pinned: options.pinned ?? false,
  };

  if (resolveBackend() !== 'indexeddb') {
    const guides = readFallback().filter((item) => item.id !== entry.id);
    // Keep the «pinned» flag of an existing entry unless the caller explicitly changes it.
    const previous = readFallback().find((item) => item.id === entry.id);
    if (previous && options.pinned === undefined) {
      entry.pinned = previous.pinned;
    }
    writeFallback([...guides, entry]);
    return entry;
  }

  const db = await openDatabase();
  if (!db) {
    backend = hasLocalStorage() ? 'localstorage' : 'memory';
    return saveGuide(doc, options);
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const read = store.get(entry.id);
      read.onsuccess = () => {
        const previous = read.result as StoredGuide | undefined;
        if (previous && options.pinned === undefined) {
          entry.pinned = previous.pinned;
        }
        store.put(entry);
      };
      tx.oncomplete = () => resolve(entry);
      tx.onerror = () => resolve(entry);
    } catch {
      resolve(entry);
    }
  });
}

export async function getGuide(id: string): Promise<StoredGuide | null> {
  const guides = await listGuides();
  return guides.find((guide) => guide.id === id) ?? null;
}

export async function removeGuide(id: string): Promise<void> {
  if (resolveBackend() !== 'indexeddb') {
    writeFallback(readFallback().filter((entry) => entry.id !== id));
    return;
  }
  const db = await openDatabase();
  if (!db) {
    backend = hasLocalStorage() ? 'localstorage' : 'memory';
    return removeGuide(id);
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const guide = await getGuide(id);
  if (!guide) {
    return;
  }
  await saveGuide(guide.doc, { source: guide.source, pinned, savedAt: guide.savedAt });
}

export async function clearAllGuides(): Promise<void> {
  const guides = await listGuides();
  await Promise.all(guides.map((guide) => removeGuide(guide.id)));
}

/** Fire-and-forget helper used by the UI: never blocks the click, never throws. */
export function persistGuide(doc: IkGuideDocument, options: SaveGuideOptions = {}): Promise<StoredGuide | null> {
  return saveGuide(doc, options).catch(() => null);
}
