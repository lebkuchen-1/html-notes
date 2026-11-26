import type {
  CanvasImageItem,
  CanvasOcclusionItem,
  CanvasPage,
  CanvasTextItem,
  Folder,
  ManualFlashcard,
  Note,
  NoteImageAttachment,
  NoteLocalSettings,
  PageBackgroundImage,
  PaperConfig,
  Stroke,
} from '../types';
import { decodeStrokesBinary, encodeStrokesBinary } from './strokeCodec';

const V2_DB_PREFIX = 'notizblock-db-v2';
const V2_DB_VERSION = 1;
const ACTIVE_SLOT_STORAGE_KEY = 'solid-notes:v2:activeDbSlot';

const STORE_NOTES = 'notes';
const STORE_PAGES = 'pages';
const STORE_STROKE_CHUNKS = 'strokeChunks';
const STORE_BLOBS = 'blobs';
const STORE_FOLDERS = 'folders';
const STORE_META = 'meta';

const BLOB_REF_PREFIX = 'blob://';
const STROKE_CHUNK_SIZE = 64;
const IDLE_CLOSE_DELAY_MS = 25_000;

type DbSlot = 'a' | 'b';

function getDbNameForSlot(slot: DbSlot): string {
  return `${V2_DB_PREFIX}${slot}`;
}

function getAlternateSlot(slot: DbSlot): DbSlot {
  return slot === 'a' ? 'b' : 'a';
}

function readActiveSlot(): DbSlot {
  try {
    const val = localStorage.getItem(ACTIVE_SLOT_STORAGE_KEY);
    if (val === 'a' || val === 'b') return val;
  } catch {
    // ignore
  }
  return 'a';
}

function writeActiveSlot(slot: DbSlot): void {
  try {
    localStorage.setItem(ACTIVE_SLOT_STORAGE_KEY, slot);
  } catch {
    // ignore
  }
}

// ==================== Internal V2 Record Shapes ====================

interface DbNoteRecord {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  folderId: string | null;
  sortOrder?: number;
  attachments: NoteImageAttachment[];
  pageIds: string[];
  activePageId: string;
  flashcards?: ManualFlashcard[];
  settings?: Partial<NoteLocalSettings>;
  createdAt: number;
  updatedAt: number;
}

interface DbPageRecord {
  id: string;
  noteId: string;
  title: string;
  width: number;
  height: number;
  texts: CanvasTextItem[];
  images: CanvasImageItem[];
  occlusions?: CanvasOcclusionItem[];
  paperConfig: PaperConfig;
  backgroundImage?: PageBackgroundImage | null;
  chunkCount: number;
  strokeCount: number;
}

interface DbStrokeChunkRecord {
  id: string; // `${pageId}:${seq}`
  pageId: string;
  seq: number;
  count: number;
  data: Uint8Array;
}

interface DbBlobRecord {
  hash: string;
  mime: string;
  size: number;
  data: Uint8Array;
}

// ==================== In-Memory Delta & Blob Tracking ====================

interface SavedPageTracker {
  noteId: string;
  title: string;
  width: number;
  height: number;
  texts: CanvasTextItem[];
  images: CanvasImageItem[];
  occlusions: CanvasOcclusionItem[];
  paperConfig: PaperConfig;
  backgroundImage: PageBackgroundImage | null | undefined;
  chunks: Stroke[][];
  strokeCount: number;
}

let activeSlot: DbSlot = readActiveSlot();
let cachedDbPromise: Promise<IDBDatabase> | null = null;
let cachedDbInstance: IDBDatabase | null = null;
let inFlightOps = 0;
let idleCloseTimer: number | undefined;
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// Per-page tracking so drawing 1 stroke writes ONLY the tail <=64-stroke binary chunk (~2-8 KB)!
let savedPagesMap = new Map<string, SavedPageTracker>();
let savedNotePageIds = new Map<string, string[]>();
let knownDbBlobHashes = new Set<string>();

// Fast in-memory caches between data URLs and content-addressed binary hashes
const dataUrlToHashCache = new Map<string, { hash: string; mime: string; size: number }>();
const hashToDataUrlCache = new Map<string, string>();

function makeDataUrlCacheKey(dataUrl: string): string {
  const len = dataUrl.length;
  if (len <= 160) return dataUrl;
  return `${len}:${dataUrl.slice(0, 80)}:${dataUrl.slice(len - 80)}`;
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const header = dataUrl.slice(5, commaIdx);
  if (!header.includes(';base64')) return null;
  const mime = header.split(';')[0] || 'application/octet-stream';
  return { mime, base64: dataUrl.slice(commaIdx + 1) };
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binStr = atob(clean);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

async function hashBytesHex(bytes: Uint8Array): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await crypto.subtle.digest('SHA-256', copy);
      const arr = new Uint8Array(digest);
      let hex = '';
      for (let i = 0; i < arr.length; i++) {
        hex += arr[i].toString(16).padStart(2, '0');
      }
      return hex;
    }
  } catch {
    // Fallback below on non-secure HTTP contexts
  }

  // Deterministic 128-bit fallback hash (2 independent 64-bit-ish mixes + byteLength)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((b + i) & 0xff), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (b ^ 0xa5), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ ((b * 17 + i) & 0xff), 0x27d4eb2d) >>> 0;
  }
  return `${bytes.length.toString(16)}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}${h3.toString(16).padStart(8, '0')}${h4.toString(16).padStart(8, '0')}`;
}

/**
 * Extracts a `data:...;base64,...` string into a content-addressed `blob://<hash>` ref.
 * Hits an O(1) in-memory cache when already seen, so stroke autosaves never touch image bytes!
 */
async function dehydrateMediaSrc(
  src: string,
  pendingBlobs: Map<string, DbBlobRecord>,
  knownHashes: Set<string>
): Promise<string> {
  if (!src || !src.startsWith('data:')) return src;

  const cacheKey = makeDataUrlCacheKey(src);
  const cached = dataUrlToHashCache.get(cacheKey);
  if (cached && (knownHashes.has(cached.hash) || pendingBlobs.has(cached.hash))) {
    return `${BLOB_REF_PREFIX}${cached.hash}`;
  }

  const parsed = parseDataUrl(src);
  if (!parsed) return src;

  const rawBytes = base64ToBytes(parsed.base64);
  const hash = cached?.hash ?? (await hashBytesHex(rawBytes));
  dataUrlToHashCache.set(cacheKey, { hash, mime: parsed.mime, size: rawBytes.byteLength });
  hashToDataUrlCache.set(hash, src);

  if (!knownHashes.has(hash) && !pendingBlobs.has(hash)) {
    pendingBlobs.set(hash, {
      hash,
      mime: parsed.mime,
      size: rawBytes.byteLength,
      data: rawBytes,
    });
  }
  return `${BLOB_REF_PREFIX}${hash}`;
}

function hydrateMediaSrc(src: string, blobMap: Map<string, DbBlobRecord>): string {
  if (!src || !src.startsWith(BLOB_REF_PREFIX)) return src;
  const hash = src.slice(BLOB_REF_PREFIX.length);
  const cached = hashToDataUrlCache.get(hash);
  if (cached) return cached;

  const rec = blobMap.get(hash);
  if (!rec) return '';
  const dataUrl = bytesToDataUrl(rec.data, rec.mime);
  hashToDataUrlCache.set(hash, dataUrl);
  dataUrlToHashCache.set(makeDataUrlCacheKey(dataUrl), {
    hash: rec.hash,
    mime: rec.mime,
    size: rec.size,
  });
  return dataUrl;
}

// ==================== IndexedDB Core Helpers ====================

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
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

function openV2DatabaseByName(dbName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(dbName, V2_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_PAGES)) {
          const pagesStore = db.createObjectStore(STORE_PAGES, { keyPath: 'id' });
          pagesStore.createIndex('noteId', 'noteId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_STROKE_CHUNKS)) {
          const chunkStore = db.createObjectStore(STORE_STROKE_CHUNKS, { keyPath: 'id' });
          chunkStore.createIndex('pageId', 'pageId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: 'hash' });
        }
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error(`Failed to open ${dbName}`));
      request.onblocked = () => reject(new Error(`IndexedDB open blocked (${dbName})`));
    } catch (err) {
      reject(err);
    }
  });
}

function deleteDatabaseByName(dbName: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!isIndexedDbAvailable()) {
      resolve(false);
      return;
    }
    try {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function clearIdleCloseTimer(): void {
  if (idleCloseTimer !== undefined && typeof window !== 'undefined') {
    window.clearTimeout(idleCloseTimer);
    idleCloseTimer = undefined;
  }
}

function scheduleIdleClose(): void {
  clearIdleCloseTimer();
  if (typeof window === 'undefined') return;
  idleCloseTimer = window.setTimeout(() => {
    idleCloseTimer = undefined;
    if (inFlightOps === 0 && cachedDbInstance) {
      try {
        cachedDbInstance.close();
      } catch {
        // ignore
      }
      cachedDbInstance = null;
      cachedDbPromise = null;
    }
  }, IDLE_CLOSE_DELAY_MS);
}

function closeActiveCachedDb(): void {
  clearIdleCloseTimer();
  if (cachedDbInstance) {
    try {
      cachedDbInstance.close();
    } catch {
      // ignore
    }
  }
  cachedDbInstance = null;
  cachedDbPromise = null;
}

function openActiveV2Database(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available'));
  }
  clearIdleCloseTimer();
  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  const dbName = getDbNameForSlot(activeSlot);
  cachedDbPromise = openV2DatabaseByName(dbName)
    .then((db) => {
      cachedDbInstance = db;
      db.onclose = () => {
        if (cachedDbInstance === db) {
          cachedDbInstance = null;
          cachedDbPromise = null;
        }
      };
      db.onversionchange = () => {
        db.close();
        if (cachedDbInstance === db) {
          cachedDbInstance = null;
          cachedDbPromise = null;
        }
      };
      return db;
    })
    .catch((err) => {
      cachedDbInstance = null;
      cachedDbPromise = null;
      throw err;
    });

  return cachedDbPromise;
}

async function withActiveDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  inFlightOps++;
  clearIdleCloseTimer();
  try {
    try {
      const db = await openActiveV2Database();
      return await fn(db);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'InvalidStateError' || name === 'AbortError' || name === 'TransactionInactiveError') {
        closeActiveCachedDb();
        const db = await openActiveV2Database();
        return await fn(db);
      }
      throw err;
    }
  } finally {
    inFlightOps = Math.max(0, inFlightOps - 1);
    if (inFlightOps === 0) {
      scheduleIdleClose();
    }
  }
}

// ==================== Chunking & Tracker Helpers ====================

function sliceStrokeChunks(strokes: Stroke[]): Stroke[][] {
  const chunks: Stroke[][] = [];
  for (let i = 0; i < strokes.length; i += STROKE_CHUNK_SIZE) {
    chunks.push(strokes.slice(i, i + STROKE_CHUNK_SIZE));
  }
  return chunks;
}

function sameStrokeSlice(a: Stroke[] | undefined, b: Stroke[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function pageMetaUnchanged(
  prev: SavedPageTracker | undefined,
  noteId: string,
  page: CanvasPage
): boolean {
  if (!prev) return false;
  return (
    prev.noteId === noteId &&
    prev.title === page.title &&
    prev.width === page.width &&
    prev.height === page.height &&
    prev.texts === page.texts &&
    prev.images === page.images &&
    prev.occlusions === page.occlusions &&
    prev.paperConfig === page.paperConfig &&
    prev.backgroundImage === page.backgroundImage
  );
}

function buildPageTracker(noteId: string, page: CanvasPage, chunks: Stroke[][]): SavedPageTracker {
  return {
    noteId,
    title: page.title,
    width: page.width,
    height: page.height,
    texts: page.texts,
    images: page.images,
    occlusions: page.occlusions,
    paperConfig: page.paperConfig,
    backgroundImage: page.backgroundImage,
    chunks,
    strokeCount: page.strokes.length,
  };
}

function rebuildTrackersFromNotes(notes: Note[]): void {
  const nextPages = new Map<string, SavedPageTracker>();
  const nextNotePages = new Map<string, string[]>();
  for (const note of notes) {
    nextNotePages.set(
      note.id,
      note.pages.map((p) => p.id)
    );
    for (const page of note.pages) {
      nextPages.set(page.id, buildPageTracker(note.id, page, sliceStrokeChunks(page.strokes)));
    }
  }
  savedPagesMap = nextPages;
  savedNotePageIds = nextNotePages;
}

// ==================== Loading V2 & Legacy V1 ====================

async function readWorkspaceFromV2Db(db: IDBDatabase): Promise<{
  notes: Note[];
  folders: Folder[];
  blobHashes: Set<string>;
  initialized: boolean;
}> {
  const tx = db.transaction(
    [STORE_NOTES, STORE_PAGES, STORE_STROKE_CHUNKS, STORE_BLOBS, STORE_FOLDERS, STORE_META],
    'readonly'
  );

  const [rawNotes, rawPages, rawChunks, rawBlobs, rawFolders, initRecord] = await Promise.all([
    reqToPromise<DbNoteRecord[]>(tx.objectStore(STORE_NOTES).getAll()),
    reqToPromise<DbPageRecord[]>(tx.objectStore(STORE_PAGES).getAll()),
    reqToPromise<DbStrokeChunkRecord[]>(tx.objectStore(STORE_STROKE_CHUNKS).getAll()),
    reqToPromise<DbBlobRecord[]>(tx.objectStore(STORE_BLOBS).getAll()),
    reqToPromise<Folder[]>(tx.objectStore(STORE_FOLDERS).getAll()),
    reqToPromise<{ key: string; value: unknown } | undefined>(
      tx.objectStore(STORE_META).get('initialized')
    ),
  ]);

  const initialized =
    Boolean(initRecord?.value) ||
    (Array.isArray(rawNotes) && rawNotes.length > 0) ||
    (Array.isArray(rawFolders) && rawFolders.length > 0);

  if (!initialized) {
    return { notes: [], folders: [], blobHashes: new Set(), initialized: false };
  }

  const blobMap = new Map<string, DbBlobRecord>();
  const blobHashes = new Set<string>();
  for (const b of rawBlobs) {
    if (b && typeof b.hash === 'string') {
      blobMap.set(b.hash, b);
      blobHashes.add(b.hash);
    }
  }

  // Group binary stroke chunks by pageId and sort by seq
  const chunksByPage = new Map<string, DbStrokeChunkRecord[]>();
  for (const ch of rawChunks) {
    if (!ch || typeof ch.pageId !== 'string') continue;
    let list = chunksByPage.get(ch.pageId);
    if (!list) {
      list = [];
      chunksByPage.set(ch.pageId, list);
    }
    list.push(ch);
  }

  const pagesById = new Map<string, CanvasPage>();
  for (const rawPage of rawPages) {
    if (!rawPage || typeof rawPage.id !== 'string') continue;

    const pageChunks = chunksByPage.get(rawPage.id);
    const strokes: Stroke[] = [];
    if (pageChunks && pageChunks.length > 0) {
      pageChunks.sort((a, b) => a.seq - b.seq);
      for (const ch of pageChunks) {
        if (ch.data instanceof Uint8Array) {
          const decoded = decodeStrokesBinary(ch.data);
          for (let i = 0; i < decoded.length; i++) {
            strokes.push(decoded[i]);
          }
        }
      }
    }

    const images: CanvasImageItem[] = Array.isArray(rawPage.images)
      ? rawPage.images
          .map((img) => ({
            ...img,
            src: hydrateMediaSrc(img.src, blobMap),
          }))
          .filter((img) => img.src.length > 0)
      : [];

    const backgroundImage: PageBackgroundImage | null = rawPage.backgroundImage
      ? (() => {
          const hydratedSrc = hydrateMediaSrc(rawPage.backgroundImage!.src, blobMap);
          return hydratedSrc.length > 0
            ? { ...rawPage.backgroundImage!, src: hydratedSrc }
            : null;
        })()
      : null;

    pagesById.set(rawPage.id, {
      id: rawPage.id,
      title: rawPage.title,
      width: rawPage.width,
      height: rawPage.height,
      strokes,
      texts: Array.isArray(rawPage.texts) ? rawPage.texts : [],
      images,
      occlusions: Array.isArray(rawPage.occlusions) ? rawPage.occlusions : [],
      paperConfig: rawPage.paperConfig,
      backgroundImage,
    });
  }

  const notes: Note[] = [];
  for (const rawNote of rawNotes) {
    if (!rawNote || typeof rawNote.id !== 'string') continue;
    const pages: CanvasPage[] = [];
    const ids = Array.isArray(rawNote.pageIds) ? rawNote.pageIds : [];
    for (const pid of ids) {
      const p = pagesById.get(pid);
      if (p) pages.push(p);
    }
    // Fallback: collect any orphan page pointing at this noteId
    if (pages.length === 0) {
      for (const rawPage of rawPages) {
        if (rawPage.noteId === rawNote.id) {
          const p = pagesById.get(rawPage.id);
          if (p) pages.push(p);
        }
      }
    }

    const attachments: NoteImageAttachment[] = Array.isArray(rawNote.attachments)
      ? rawNote.attachments
          .map((att) => ({
            ...att,
            src: hydrateMediaSrc(att.src, blobMap),
          }))
          .filter((att) => att.src.length > 0)
      : [];

    notes.push({
      id: rawNote.id,
      title: rawNote.title,
      content: rawNote.content,
      tags: Array.isArray(rawNote.tags) ? rawNote.tags : [],
      pinned: Boolean(rawNote.pinned),
      folderId: rawNote.folderId ?? null,
      ...(typeof rawNote.sortOrder === 'number' && Number.isFinite(rawNote.sortOrder)
        ? { sortOrder: rawNote.sortOrder }
        : {}),
      attachments,
      pages,
      activePageId: rawNote.activePageId,
      ...(Array.isArray(rawNote.flashcards) && rawNote.flashcards.length > 0
        ? { flashcards: rawNote.flashcards }
        : {}),
      ...(rawNote.settings ? { settings: rawNote.settings } : {}),
      createdAt: rawNote.createdAt,
      updatedAt: rawNote.updatedAt,
    });
  }

  return {
    notes,
    folders: Array.isArray(rawFolders) ? rawFolders : [],
    blobHashes,
    initialized: true,
  };
}

export interface RawIndexedDbWorkspace {
  notes: unknown[];
  folders: unknown[];
  initialized: boolean;
}

export async function loadWorkspaceFromIndexedDb(): Promise<RawIndexedDbWorkspace> {
  // 1. Try currently active v2 slot
  const primaryResult = await withActiveDb((db) => readWorkspaceFromV2Db(db));
  if (primaryResult.initialized) {
    knownDbBlobHashes = primaryResult.blobHashes;
    rebuildTrackersFromNotes(primaryResult.notes);
    return {
      notes: primaryResult.notes,
      folders: primaryResult.folders,
      initialized: true,
    };
  }

  // 2. Check alternate v2 slot (protects against cleared localStorage slot pointer)
  const altSlot = getAlternateSlot(activeSlot);
  try {
    const altDb = await openV2DatabaseByName(getDbNameForSlot(altSlot));
    const altResult = await readWorkspaceFromV2Db(altDb);
    altDb.close();
    if (altResult.initialized) {
      closeActiveCachedDb();
      activeSlot = altSlot;
      writeActiveSlot(altSlot);
      knownDbBlobHashes = altResult.blobHashes;
      rebuildTrackersFromNotes(altResult.notes);
      return {
        notes: altResult.notes,
        folders: altResult.folders,
        initialized: true,
      };
    }
  } catch {
    // ignore
  }

  return {
    notes: [],
    folders: [],
    initialized: false,
  };
}

// ==================== Writing Full Workspace (Migration / Compaction / Initial Seed) ====================

async function writeFullWorkspaceIntoDb(
  db: IDBDatabase,
  notes: Note[],
  folders: Folder[]
): Promise<{ ok: boolean; blobHashes: Set<string> }> {
  const writtenBlobHashes = new Set<string>();

  try {
    // Write folders + clear any stale records first
    {
      const tx = db.transaction(
        [STORE_NOTES, STORE_PAGES, STORE_STROKE_CHUNKS, STORE_BLOBS, STORE_FOLDERS, STORE_META],
        'readwrite'
      );
      tx.objectStore(STORE_NOTES).clear();
      tx.objectStore(STORE_PAGES).clear();
      tx.objectStore(STORE_STROKE_CHUNKS).clear();
      tx.objectStore(STORE_BLOBS).clear();
      tx.objectStore(STORE_FOLDERS).clear();
      for (const folder of folders) {
        tx.objectStore(STORE_FOLDERS).put(folder);
      }
      // Explicitly keep initialized=false until ALL notes succeed (crash-safe atomic commit!)
      tx.objectStore(STORE_META).put({ key: 'initialized', value: false, updatedAt: Date.now() });
      await txDone(tx);
    }

    // Write notes in individual transactions to keep peak iPad Safari RAM low
    for (const note of notes) {
      const pendingBlobs = new Map<string, DbBlobRecord>();

      const dehydratedAttachments: NoteImageAttachment[] = [];
      for (const att of note.attachments) {
        dehydratedAttachments.push({
          ...att,
          src: await dehydrateMediaSrc(att.src, pendingBlobs, writtenBlobHashes),
        });
      }

      const pageRecords: DbPageRecord[] = [];
      const chunkRecords: DbStrokeChunkRecord[] = [];

      for (const page of note.pages) {
        const dehydratedImages: CanvasImageItem[] = [];
        for (const img of page.images) {
          dehydratedImages.push({
            ...img,
            src: await dehydrateMediaSrc(img.src, pendingBlobs, writtenBlobHashes),
          });
        }

        const dehydratedBg: PageBackgroundImage | null = page.backgroundImage
          ? {
              ...page.backgroundImage,
              src: await dehydrateMediaSrc(
                page.backgroundImage.src,
                pendingBlobs,
                writtenBlobHashes
              ),
            }
          : null;

        const chunks = sliceStrokeChunks(page.strokes);
        for (let seq = 0; seq < chunks.length; seq++) {
          const slice = chunks[seq];
          chunkRecords.push({
            id: `${page.id}:${seq}`,
            pageId: page.id,
            seq,
            count: slice.length,
            data: encodeStrokesBinary(slice),
          });
        }

        pageRecords.push({
          id: page.id,
          noteId: note.id,
          title: page.title,
          width: page.width,
          height: page.height,
          texts: page.texts,
          images: dehydratedImages,
          occlusions: page.occlusions,
          paperConfig: page.paperConfig,
          backgroundImage: dehydratedBg,
          chunkCount: chunks.length,
          strokeCount: page.strokes.length,
        });
      }

      const noteRecord: DbNoteRecord = {
        id: note.id,
        title: note.title,
        content: note.content,
        tags: note.tags,
        pinned: note.pinned,
        folderId: note.folderId,
        ...(note.sortOrder !== undefined ? { sortOrder: note.sortOrder } : {}),
        attachments: dehydratedAttachments,
        pageIds: note.pages.map((p) => p.id),
        activePageId: note.activePageId,
        ...(note.flashcards && note.flashcards.length > 0
          ? { flashcards: note.flashcards }
          : {}),
        ...(note.settings ? { settings: note.settings } : {}),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };

      const tx = db.transaction(
        [STORE_NOTES, STORE_PAGES, STORE_STROKE_CHUNKS, STORE_BLOBS],
        'readwrite'
      );
      const blobStore = tx.objectStore(STORE_BLOBS);
      for (const [hash, blobRec] of pendingBlobs) {
        blobStore.put(blobRec);
        writtenBlobHashes.add(hash);
      }
      const chunkStore = tx.objectStore(STORE_STROKE_CHUNKS);
      for (const ch of chunkRecords) {
        chunkStore.put(ch);
      }
      const pageStore = tx.objectStore(STORE_PAGES);
      for (const pRec of pageRecords) {
        pageStore.put(pRec);
      }
      tx.objectStore(STORE_NOTES).put(noteRecord);
      await txDone(tx);
    }

    // Verify record counts before marking initialized=true
    const verifyTx = db.transaction([STORE_NOTES, STORE_FOLDERS], 'readonly');
    const [noteCount, folderCount] = await Promise.all([
      reqToPromise<number>(verifyTx.objectStore(STORE_NOTES).count()),
      reqToPromise<number>(verifyTx.objectStore(STORE_FOLDERS).count()),
    ]);
    if (noteCount !== notes.length || folderCount !== folders.length) {
      return { ok: false, blobHashes: writtenBlobHashes };
    }

    // Atomic commit flag
    const commitTx = db.transaction([STORE_META], 'readwrite');
    commitTx.objectStore(STORE_META).put({
      key: 'initialized',
      value: true,
      schemaVersion: 2,
      updatedAt: Date.now(),
    });
    await txDone(commitTx);

    return { ok: true, blobHashes: writtenBlobHashes };
  } catch {
    return { ok: false, blobHashes: writtenBlobHashes };
  }
}

export function saveFullWorkspaceToIndexedDb(
  notes: Note[],
  folders: Folder[]
): Promise<boolean> {
  return enqueueWrite(async () => {
    try {
      const result = await withActiveDb((db) => writeFullWorkspaceIntoDb(db, notes, folders));
      if (result.ok) {
        knownDbBlobHashes = result.blobHashes;
        rebuildTrackersFromNotes(notes);
      }
      return result.ok;
    } catch {
      return false;
    }
  });
}

/**
 * True disk-space compaction (`VACUUM` equivalent for WebKit/iPadOS Safari IndexedDB):
 * Writes the entire clean workspace (only live blobs & packed binary stroke chunks) into
 * the alternate fresh IndexedDB slot, verifies counts, switches active slot, and deletes
 * the old database so iPadOS immediately reclaims all SQLite WAL/freelist space!
 */
export function compactIndexedDbWorkspace(
  notes: Note[],
  folders: Folder[]
): Promise<boolean> {
  return enqueueWrite(async () => {
    if (!isIndexedDbAvailable()) return false;

    const prevSlot = activeSlot;
    const nextSlot = getAlternateSlot(prevSlot);
    const prevDbName = getDbNameForSlot(prevSlot);
    const nextDbName = getDbNameForSlot(nextSlot);

    // Start from a completely fresh database file on the alternate slot
    await deleteDatabaseByName(nextDbName);

    let targetDb: IDBDatabase | null = null;
    try {
      targetDb = await openV2DatabaseByName(nextDbName);
      const result = await writeFullWorkspaceIntoDb(targetDb, notes, folders);
      targetDb.close();
      targetDb = null;

      if (!result.ok) {
        await deleteDatabaseByName(nextDbName);
        return false;
      }

      // Atomically switch active slot BEFORE deleting old DB
      closeActiveCachedDb();
      activeSlot = nextSlot;
      writeActiveSlot(nextSlot);
      knownDbBlobHashes = result.blobHashes;
      rebuildTrackersFromNotes(notes);

      // Delete old v2 DB so Safari frees disk space immediately
      await deleteDatabaseByName(prevDbName);

      return true;
    } catch {
      if (targetDb) {
        try {
          targetDb.close();
        } catch {
          // ignore
        }
      }
      return false;
    }
  });
}

// ==================== Ultra-Low Write Amplification Incremental Delta Sync ====================

/**
 * Incrementally writes ONLY:
 * - Modified/appended binary stroke chunks (<=64 strokes, ~1–10 KB per stroke!)
 * - Modified lightweight page/note metadata records (~0.5 KB)
 * - Newly added binary media blobs (written ONCE, never rewritten when drawing!)
 * - Deleted notes, pages, and emptied tail chunks
 */
export function syncNotesDeltaToIndexedDb(
  changedNotes: Note[],
  deletedNoteIds: string[]
): Promise<boolean> {
  if (changedNotes.length === 0 && deletedNoteIds.length === 0) return Promise.resolve(true);

  return enqueueWrite(async () => {
    try {
      // Track which pageIds are still referenced by the changed notes (handles movePageToNote cleanly!)
      const activePageIdsInChanged = new Set<string>();
      for (const note of changedNotes) {
        for (const p of note.pages) {
          activePageIdsInChanged.add(p.id);
        }
      }

      const pendingBlobs = new Map<string, DbBlobRecord>();
      const notesToPut: DbNoteRecord[] = [];
      const pagesToPut: DbPageRecord[] = [];
      const chunksToPut: DbStrokeChunkRecord[] = [];
      const chunkIdsToDelete: string[] = [];
      const pageIdsToDelete = new Set<string>();

      // Track updated tracker entries so we only commit them to memory if the IDB tx succeeds
      const nextPageTrackers = new Map<string, SavedPageTracker>();
      const nextNotePageEntries = new Map<string, string[]>();

      // Collect pages from deleted notes (unless moved into one of changedNotes in the same batch)
      for (const delNoteId of deletedNoteIds) {
        const prevPages = savedNotePageIds.get(delNoteId) ?? [];
        for (const pid of prevPages) {
          if (!activePageIdsInChanged.has(pid)) {
            pageIdsToDelete.add(pid);
          }
        }
      }

      for (const note of changedNotes) {
        const prevPageIds = savedNotePageIds.get(note.id) ?? [];
        const currPageIds = note.pages.map((p) => p.id);
        nextNotePageEntries.set(note.id, currPageIds);

        for (const oldPid of prevPageIds) {
          if (!activePageIdsInChanged.has(oldPid)) {
            pageIdsToDelete.add(oldPid);
          }
        }

        const dehydratedAttachments: NoteImageAttachment[] = [];
        for (const att of note.attachments) {
          dehydratedAttachments.push({
            ...att,
            src: await dehydrateMediaSrc(att.src, pendingBlobs, knownDbBlobHashes),
          });
        }

        for (const page of note.pages) {
          const prevTracker = savedPagesMap.get(page.id);
          const nextChunks = sliceStrokeChunks(page.strokes);

          // Diff stroke chunks individually: untouched sealed chunks are NEVER re-encoded or written!
          for (let seq = 0; seq < nextChunks.length; seq++) {
            const prevSlice = prevTracker?.chunks[seq];
            if (!sameStrokeSlice(prevSlice, nextChunks[seq])) {
              chunksToPut.push({
                id: `${page.id}:${seq}`,
                pageId: page.id,
                seq,
                count: nextChunks[seq].length,
                data: encodeStrokesBinary(nextChunks[seq]),
              });
            }
          }

          // Delete any trailing chunks that were emptied (e.g. Undo / Clear / Eraser)
          const prevChunkCount = prevTracker?.chunks.length ?? 0;
          for (let seq = nextChunks.length; seq < prevChunkCount; seq++) {
            chunkIdsToDelete.push(`${page.id}:${seq}`);
          }

          // Only rewrite the lightweight page metadata record if non-stroke fields changed
          if (!pageMetaUnchanged(prevTracker, note.id, page)) {
            const dehydratedImages: CanvasImageItem[] = [];
            for (const img of page.images) {
              dehydratedImages.push({
                ...img,
                src: await dehydrateMediaSrc(img.src, pendingBlobs, knownDbBlobHashes),
              });
            }
            const dehydratedBg: PageBackgroundImage | null = page.backgroundImage
              ? {
                  ...page.backgroundImage,
                  src: await dehydrateMediaSrc(
                    page.backgroundImage.src,
                    pendingBlobs,
                    knownDbBlobHashes
                  ),
                }
              : null;

            pagesToPut.push({
              id: page.id,
              noteId: note.id,
              title: page.title,
              width: page.width,
              height: page.height,
              texts: page.texts,
              images: dehydratedImages,
              occlusions: page.occlusions,
              paperConfig: page.paperConfig,
              backgroundImage: dehydratedBg,
              chunkCount: nextChunks.length,
              strokeCount: page.strokes.length,
            });
          }

          nextPageTrackers.set(page.id, buildPageTracker(note.id, page, nextChunks));
        }

        notesToPut.push({
          id: note.id,
          title: note.title,
          content: note.content,
          tags: note.tags,
          pinned: note.pinned,
          folderId: note.folderId,
          ...(note.sortOrder !== undefined ? { sortOrder: note.sortOrder } : {}),
          attachments: dehydratedAttachments,
          pageIds: currPageIds,
          activePageId: note.activePageId,
          ...(note.flashcards && note.flashcards.length > 0
            ? { flashcards: note.flashcards }
            : {}),
          ...(note.settings ? { settings: note.settings } : {}),
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });
      }

      await withActiveDb(async (db) => {
        const storeList =
          pendingBlobs.size > 0
            ? [STORE_NOTES, STORE_PAGES, STORE_STROKE_CHUNKS, STORE_BLOBS, STORE_META]
            : [STORE_NOTES, STORE_PAGES, STORE_STROKE_CHUNKS, STORE_META];

        const tx = db.transaction(storeList, 'readwrite');
        const notesStore = tx.objectStore(STORE_NOTES);
        const pagesStore = tx.objectStore(STORE_PAGES);
        const chunksStore = tx.objectStore(STORE_STROKE_CHUNKS);
        const metaStore = tx.objectStore(STORE_META);

        if (pendingBlobs.size > 0) {
          const blobsStore = tx.objectStore(STORE_BLOBS);
          for (const blobRec of pendingBlobs.values()) {
            blobsStore.put(blobRec);
          }
        }

        for (const ch of chunksToPut) {
          chunksStore.put(ch);
        }
        for (const chId of chunkIdsToDelete) {
          chunksStore.delete(chId);
        }

        for (const pRec of pagesToPut) {
          pagesStore.put(pRec);
        }

        // Delete removed pages & all their stroke chunks (via pageId index so nothing is orphaned)
        if (pageIdsToDelete.size > 0) {
          const byPageIdx = chunksStore.index('pageId');
          for (const pid of pageIdsToDelete) {
            pagesStore.delete(pid);
            const keysReq = byPageIdx.getAllKeys(pid);
            keysReq.onsuccess = () => {
              const keys = keysReq.result;
              for (let i = 0; i < keys.length; i++) {
                chunksStore.delete(keys[i]);
              }
            };
          }
        }

        for (const nRec of notesToPut) {
          notesStore.put(nRec);
        }
        for (const delId of deletedNoteIds) {
          notesStore.delete(delId);
        }

        metaStore.put({ key: 'initialized', value: true, schemaVersion: 2, updatedAt: Date.now() });
        await txDone(tx);
      });

      // Commit in-memory trackers ONLY after transaction succeeded
      for (const hash of pendingBlobs.keys()) {
        knownDbBlobHashes.add(hash);
      }
      for (const [pid, tracker] of nextPageTrackers) {
        savedPagesMap.set(pid, tracker);
      }
      for (const pid of pageIdsToDelete) {
        savedPagesMap.delete(pid);
      }
      for (const [nid, pids] of nextNotePageEntries) {
        savedNotePageIds.set(nid, pids);
      }
      for (const delId of deletedNoteIds) {
        savedNotePageIds.delete(delId);
      }

      return true;
    } catch {
      return false;
    }
  });
}

export function replaceFoldersInIndexedDb(folders: Folder[]): Promise<boolean> {
  return enqueueWrite(async () => {
    try {
      await withActiveDb(async (db) => {
        const tx = db.transaction([STORE_FOLDERS, STORE_META], 'readwrite');
        const foldersStore = tx.objectStore(STORE_FOLDERS);
        const metaStore = tx.objectStore(STORE_META);

        foldersStore.clear();
        for (const folder of folders) {
          foldersStore.put(folder);
        }
        metaStore.put({ key: 'initialized', value: true, schemaVersion: 2, updatedAt: Date.now() });
        await txDone(tx);
      });
      return true;
    } catch {
      return false;
    }
  });
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
  /** Actual browser/origin storage reported by navigator.storage.estimate().usage (includes SQLite WAL/freelist) */
  browserUsageBytes: number | null;
  /** Effective displayed usage (max of browser report and logical payload) */
  usageBytes: number;
  quotaBytes: number | null;
  persisted: boolean | null;
}

export async function queryBrowserStorageEstimate(
  fallbackDataBytes: number
): Promise<StorageEstimateInfo> {
  let browserUsageBytes: number | null = null;
  let usageBytes = fallbackDataBytes;
  let quotaBytes: number | null = null;
  let persisted: boolean | null = null;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === 'number' && est.usage >= 0) {
        browserUsageBytes = est.usage;
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

  return { browserUsageBytes, usageBytes, quotaBytes, persisted };
}
