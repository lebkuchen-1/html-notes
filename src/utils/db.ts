import type { Folder, Note } from '../types';

const DB_NAME = 'notizblock-db';
const DB_VERSION = 1;

const STORE_NOTES = 'notes';
const STORE_FOLDERS = 'folders';
const STORE_META = 'meta';

let cachedDbPromise: Promise<IDBDatabase> | null = null;

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'));
  }

  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // WebKit/iPadOS Safari may close idle connections when backgrounded
        db.onclose = () => {
          cachedDbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          cachedDbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        cachedDbPromise = null;
        reject(request.error ?? new Error('Failed to open IndexedDB'));
      };

      request.onblocked = () => {
        cachedDbPromise = null;
        reject(new Error('IndexedDB open blocked'));
      };
    } catch (err) {
      cachedDbPromise = null;
      reject(err);
    }
  });

  return cachedDbPromise;
}

/**
 * Executes an IndexedDB operation with automatic reconnect retry once
 * if WebKit/Safari closed the connection while backgrounded.
 */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    const db = await openDatabase();
    return await fn(db);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'InvalidStateError' || name === 'AbortError' || name === 'TransactionInactiveError') {
      cachedDbPromise = null;
      const db = await openDatabase();
      return await fn(db);
    }
    throw err;
  }
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export interface RawIndexedDbWorkspace {
  notes: unknown[];
  folders: unknown[];
  initialized: boolean;
}

export async function loadWorkspaceFromIndexedDb(): Promise<RawIndexedDbWorkspace> {
  return withDb(async (db) => {
    const tx = db.transaction([STORE_NOTES, STORE_FOLDERS, STORE_META], 'readonly');
    const notesStore = tx.objectStore(STORE_NOTES);
    const foldersStore = tx.objectStore(STORE_FOLDERS);
    const metaStore = tx.objectStore(STORE_META);

    const [notes, folders, initRecord] = await Promise.all([
      reqToPromise<unknown[]>(notesStore.getAll()),
      reqToPromise<unknown[]>(foldersStore.getAll()),
      reqToPromise<{ key: string; value: unknown } | undefined>(metaStore.get('initialized')),
    ]);

    const initialized =
      Boolean(initRecord?.value) ||
      (Array.isArray(notes) && notes.length > 0) ||
      (Array.isArray(folders) && folders.length > 0);

    return {
      notes: Array.isArray(notes) ? notes : [],
      folders: Array.isArray(folders) ? folders : [],
      initialized,
    };
  });
}

export async function saveFullWorkspaceToIndexedDb(
  notes: Note[],
  folders: Folder[]
): Promise<boolean> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction([STORE_NOTES, STORE_FOLDERS, STORE_META], 'readwrite');
      const notesStore = tx.objectStore(STORE_NOTES);
      const foldersStore = tx.objectStore(STORE_FOLDERS);
      const metaStore = tx.objectStore(STORE_META);

      notesStore.clear();
      for (const note of notes) {
        notesStore.put(note);
      }

      foldersStore.clear();
      for (const folder of folders) {
        foldersStore.put(folder);
      }

      metaStore.put({ key: 'initialized', value: true, updatedAt: Date.now() });
      await txDone(tx);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Incrementally writes ONLY modified notes and deletes removed note IDs.
 * Keeps pen-stroke autosaving ultra-fast even with large PDFs & images in other notes.
 */
export async function syncNotesDeltaToIndexedDb(
  changedNotes: Note[],
  deletedIds: string[]
): Promise<boolean> {
  if (changedNotes.length === 0 && deletedIds.length === 0) return true;
  try {
    await withDb(async (db) => {
      const tx = db.transaction([STORE_NOTES, STORE_META], 'readwrite');
      const notesStore = tx.objectStore(STORE_NOTES);
      const metaStore = tx.objectStore(STORE_META);

      for (const note of changedNotes) {
        notesStore.put(note);
      }
      for (const id of deletedIds) {
        notesStore.delete(id);
      }
      metaStore.put({ key: 'initialized', value: true, updatedAt: Date.now() });
      await txDone(tx);
    });
    return true;
  } catch {
    return false;
  }
}

export async function replaceFoldersInIndexedDb(folders: Folder[]): Promise<boolean> {
  try {
    await withDb(async (db) => {
      const tx = db.transaction([STORE_FOLDERS, STORE_META], 'readwrite');
      const foldersStore = tx.objectStore(STORE_FOLDERS);
      const metaStore = tx.objectStore(STORE_META);

      foldersStore.clear();
      for (const folder of folders) {
        foldersStore.put(folder);
      }
      metaStore.put({ key: 'initialized', value: true, updatedAt: Date.now() });
      await txDone(tx);
    });
    return true;
  } catch {
    return false;
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  return false;
}

export interface StorageEstimateInfo {
  usageBytes: number;
  quotaBytes: number | null;
  persisted: boolean | null;
}

export async function queryBrowserStorageEstimate(
  fallbackDataBytes: number
): Promise<StorageEstimateInfo> {
  let usageBytes = fallbackDataBytes;
  let quotaBytes: number | null = null;
  let persisted: boolean | null = null;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && est.usage > 0) {
        usageBytes = Math.max(est.usage, fallbackDataBytes);
      }
      if (typeof est.quota === 'number' && est.quota > 0) {
        quotaBytes = est.quota;
      }
    }
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
  } catch {
    // ignore
  }

  return { usageBytes, quotaBytes, persisted };
}
