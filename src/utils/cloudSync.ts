import type { AppSettings, Folder, Note } from '../types';
import {
  getCloudBucketFingerprint,
  s3DeleteObject,
  s3GetObject,
  s3ListRelativeKeys,
  s3PutObject,
  sha256Hex,
  type CloudSyncConfig,
} from './s3Client';
import { generateId, normalizeAppSettings, normalizeFolder, normalizeNote } from './storage';

export const CLOUD_MANIFEST_VERSION = 1;
const BLOB_REF_PREFIX = 'blob://';
const BASELINE_STORAGE_PREFIX = 'solid-notes:v1:cloudBaseline:';
const LOCAL_DELETIONS_STORAGE_KEY = 'solid-notes:v1:localDeletions';
const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

export interface CloudBlobMeta {
  mime: string;
  size: number;
}

export interface CloudManifestNoteEntry {
  id: string;
  title: string;
  folderId: string | null;
  updatedAt: number;
  createdAt: number;
  pageCount: number;
  contentHash: string;
  /** Size of dehydrated gzipped note payload in bytes */
  noteBytes: number;
  /** SHA-256 hashes of all referenced binary blobs */
  blobHashes: string[];
  /** Sum of unique binary blob sizes referenced by this note */
  totalBlobBytes: number;
}

export interface CloudManifestFolderEntry {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  createdAt: number;
  folderHash: string;
}

export interface CloudTombstone {
  deletedAt: number;
  label?: string;
}

export interface CloudManifest {
  version: number;
  updatedAt: number;
  folders: Record<string, CloudManifestFolderEntry>;
  notes: Record<string, CloudManifestNoteEntry>;
  blobs: Record<string, CloudBlobMeta>;
  deletedNotes?: Record<string, CloudTombstone>;
  deletedFolders?: Record<string, CloudTombstone>;
  settings?: AppSettings;
}

export interface CloudSyncBaseline {
  notes: Record<string, { contentHash: string; syncedAt: number }>;
  folders: Record<string, { folderHash: string; syncedAt: number }>;
  lastBackupAt?: number;
  lastImportAt?: number;
  lastSyncAt?: number;
}

export interface LocalNoteFingerprint {
  id: string;
  title: string;
  folderId: string | null;
  updatedAt: number;
  createdAt: number;
  pageCount: number;
  contentHash: string;
  estimatedNoteBytes: number;
  blobHashes: string[];
  blobMeta: Record<string, CloudBlobMeta>;
  totalBlobBytes: number;
}

export type NoteDiffStatus =
  | 'synced'
  | 'local-only'
  | 'remote-only'
  | 'local-ahead'
  | 'remote-ahead'
  | 'deleted-local'
  | 'deleted-remote'
  | 'conflict';

export type FolderDiffStatus = NoteDiffStatus;

export type BackupConflictResolution = 'skip' | 'overwrite-remote';
export type ImportConflictResolution = 'keep-local' | 'use-remote' | 'keep-both';
export type FolderConflictResolution = 'keep-target' | 'overwrite-target';
export type SyncConflictResolution = 'skip' | 'use-local' | 'use-remote' | 'keep-both';
export type SyncFolderConflictResolution = 'skip' | 'use-local' | 'use-remote';
export type SyncSettingsMode = 'none' | 'upload' | 'download';

export interface NoteComparison {
  id: string;
  local?: LocalNoteFingerprint;
  remote?: CloudManifestNoteEntry;
  baselineHash?: string;
  status: NoteDiffStatus;
}

export interface FolderComparison {
  id: string;
  local?: Folder & { folderHash: string };
  remote?: CloudManifestFolderEntry;
  baselineHash?: string;
  status: FolderDiffStatus;
}

export interface CloudWorkspaceComparison {
  manifest: CloudManifest | null;
  remoteBlobKeys: Set<string>;
  notesById: Map<string, NoteComparison>;
  foldersById: Map<string, FolderComparison>;
  baseline: CloudSyncBaseline;
  analyzedAt: number;
}

export interface CloudTransferProgress {
  phase: 'analyzing' | 'uploading' | 'downloading' | 'finalizing';
  label: string;
  detail?: string;
  current: number;
  total: number;
  bytesTransferred: number;
}

// ==================== Baseline Persistence ====================

function baselineKey(config: CloudSyncConfig): string {
  return `${BASELINE_STORAGE_PREFIX}${getCloudBucketFingerprint(config)}`;
}

export function loadCloudBaseline(config: CloudSyncConfig): CloudSyncBaseline {
  try {
    const raw = localStorage.getItem(baselineKey(config));
    if (!raw) return { notes: {}, folders: {} };
    const parsed = JSON.parse(raw) as Partial<CloudSyncBaseline>;
    return {
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      folders: parsed.folders && typeof parsed.folders === 'object' ? parsed.folders : {},
      lastBackupAt: typeof parsed.lastBackupAt === 'number' ? parsed.lastBackupAt : undefined,
      lastImportAt: typeof parsed.lastImportAt === 'number' ? parsed.lastImportAt : undefined,
      lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : undefined,
    };
  } catch {
    return { notes: {}, folders: {} };
  }
}

export function saveCloudBaseline(config: CloudSyncConfig, baseline: CloudSyncBaseline): void {
  try {
    localStorage.setItem(baselineKey(config), JSON.stringify(baseline));
  } catch {
    // ignore quota issues
  }
}

// ==================== Local Deletion Tombstones ====================

export interface LocalDeletionLog {
  notes: Record<string, number>;
  folders: Record<string, number>;
}

export function loadLocalDeletions(): LocalDeletionLog {
  try {
    const raw = localStorage.getItem(LOCAL_DELETIONS_STORAGE_KEY);
    if (!raw) return { notes: {}, folders: {} };
    const parsed = JSON.parse(raw) as Partial<LocalDeletionLog>;
    return {
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      folders: parsed.folders && typeof parsed.folders === 'object' ? parsed.folders : {},
    };
  } catch {
    return { notes: {}, folders: {} };
  }
}

function saveLocalDeletions(log: LocalDeletionLog): void {
  try {
    localStorage.setItem(LOCAL_DELETIONS_STORAGE_KEY, JSON.stringify(log));
  } catch {
    // ignore quota issues
  }
}

export function recordLocalNoteDeletion(noteId: string): void {
  const log = loadLocalDeletions();
  log.notes[noteId] = Date.now();
  saveLocalDeletions(log);
}

export function recordLocalFolderDeletion(folderId: string): void {
  const log = loadLocalDeletions();
  log.folders[folderId] = Date.now();
  saveLocalDeletions(log);
}

export function clearLocalDeletions(noteIds: Iterable<string>, folderIds: Iterable<string>): void {
  const log = loadLocalDeletions();
  let changed = false;
  for (const id of noteIds) {
    if (id in log.notes) {
      delete log.notes[id];
      changed = true;
    }
  }
  for (const id of folderIds) {
    if (id in log.folders) {
      delete log.folders[id];
      changed = true;
    }
  }
  if (changed) saveLocalDeletions(log);
}

function pruneTombstones(
  tombstones: Record<string, CloudTombstone> | undefined
): Record<string, CloudTombstone> {
  if (!tombstones) return {};
  const cutoff = Date.now() - TOMBSTONE_RETENTION_MS;
  const entries = Object.entries(tombstones).filter(
    ([, v]) => v && typeof v.deletedAt === 'number' && v.deletedAt >= cutoff
  );
  if (entries.length > 500) {
    entries.sort((a, b) => b[1].deletedAt - a[1].deletedAt);
    entries.length = 500;
  }
  return Object.fromEntries(entries);
}

// ==================== Data URL <-> Binary Helpers ====================

const dataUrlHashCache = new Map<string, { hash: string; mime: string; size: number }>();

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

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binStr = atob(clean);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32 KB chunks (avoids Safari call-stack overflow)
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(''));
}

export function uint8ArrayToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${uint8ArrayToBase64(bytes)}`;
}

// ==================== Gzip Helpers (with graceful fallback) ====================

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const STREAM_CHUNK_SIZE = 64 * 1024;

/**
 * Pipes bytes through a Web TransformStream (CompressionStream / DecompressionStream)
 * while CONCURRENTLY draining its readable side.
 * IMPORTANT: Awaiting `writer.write()` before reading `stream.readable` deadlocks on any
 * payload larger than the stream's internal highWaterMark (~16–64 KB) in Safari & Chromium!
 */
async function runTransformStream(
  transform: CompressionStream | DecompressionStream,
  input: Uint8Array
): Promise<Uint8Array> {
  const readPromise = new Response(transform.readable).arrayBuffer();
  const writer = transform.writable.getWriter();

  const writePromise = (async () => {
    try {
      for (let offset = 0; offset < input.byteLength; offset += STREAM_CHUNK_SIZE) {
        const end = Math.min(offset + STREAM_CHUNK_SIZE, input.byteLength);
        const chunk = new Uint8Array(end - offset);
        chunk.set(input.subarray(offset, end));
        await writer.write(chunk);
      }
      await writer.close();
    } catch (err) {
      try {
        await writer.abort(err);
      } catch {
        // ignore secondary abort errors
      }
      throw err;
    }
  })();

  const [outBuf] = await Promise.all([readPromise, writePromise]);
  return new Uint8Array(outBuf);
}

export async function compressJsonPayload(obj: unknown): Promise<{
  bytes: Uint8Array;
  compressed: boolean;
}> {
  const rawBytes = textEncoder.encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') {
    return { bytes: rawBytes, compressed: false };
  }
  try {
    const compressedBytes = await runTransformStream(new CompressionStream('gzip'), rawBytes);
    return { bytes: compressedBytes, compressed: true };
  } catch {
    return { bytes: rawBytes, compressed: false };
  }
}

export async function decompressJsonPayload<T>(bytes: Uint8Array): Promise<T> {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const plainBytes = await runTransformStream(new DecompressionStream('gzip'), bytes);
    return JSON.parse(textDecoder.decode(plainBytes)) as T;
  }
  return JSON.parse(textDecoder.decode(bytes)) as T;
}

// ==================== Note Dehydration, Hydration & Hashing ====================

interface DehydratedNoteBundle {
  note: Note;
  blobMeta: Record<string, CloudBlobMeta>;
  blobs?: Map<string, { bytes: Uint8Array; mime: string }>;
}

/**
 * Replaces embedded `data:...;base64,...` strings with content-addressed `blob://<sha256>` refs.
 * When `collectBytes` is false, decoded binary buffers are immediately released (low RAM on iPad!).
 */
async function dehydrateNote(
  note: Note,
  collectBytes: boolean
): Promise<DehydratedNoteBundle> {
  const blobMeta: Record<string, CloudBlobMeta> = {};
  const blobs = collectBytes ? new Map<string, { bytes: Uint8Array; mime: string }>() : undefined;

  const processSrc = async (src: string): Promise<string> => {
    const parsed = parseDataUrl(src);
    if (!parsed) return src;

    if (!collectBytes) {
      const cacheKey = makeDataUrlCacheKey(src);
      const cached = dataUrlHashCache.get(cacheKey);
      if (cached) {
        blobMeta[cached.hash] = { mime: cached.mime, size: cached.size };
        return `${BLOB_REF_PREFIX}${cached.hash}`;
      }
    }

    const rawBytes = base64ToUint8Array(parsed.base64);
    const hash = await sha256Hex(rawBytes);
    const info = { hash, mime: parsed.mime, size: rawBytes.byteLength };
    dataUrlHashCache.set(makeDataUrlCacheKey(src), info);
    blobMeta[hash] = { mime: parsed.mime, size: rawBytes.byteLength };
    if (blobs && !blobs.has(hash)) {
      blobs.set(hash, { bytes: rawBytes, mime: parsed.mime });
    }
    return `${BLOB_REF_PREFIX}${hash}`;
  };

  const attachments = [];
  for (const att of note.attachments) {
    attachments.push({
      ...att,
      src: await processSrc(att.src),
    });
  }

  const pages = [];
  for (const page of note.pages) {
    const images = [];
    for (const img of page.images) {
      images.push({
        ...img,
        src: await processSrc(img.src),
      });
    }
    const backgroundImage = page.backgroundImage
      ? {
          ...page.backgroundImage,
          src: await processSrc(page.backgroundImage.src),
        }
      : null;

    pages.push({
      ...page,
      images,
      backgroundImage,
    });
  }

  return {
    note: {
      ...note,
      attachments,
      pages,
    },
    blobMeta,
    blobs,
  };
}

/** Deterministic content hash (excludes transient `updatedAt` so identical content never triggers false conflicts) */
async function computeDehydratedNoteHash(dehydrated: Note): Promise<string> {
  const canonical = {
    title: dehydrated.title,
    content: dehydrated.content,
    tags: dehydrated.tags,
    pinned: dehydrated.pinned,
    folderId: dehydrated.folderId,
    attachments: dehydrated.attachments,
    pages: dehydrated.pages,
    activePageId: dehydrated.activePageId,
    flashcards: dehydrated.flashcards ?? [],
    settings: dehydrated.settings ?? null,
  };
  return sha256Hex(JSON.stringify(canonical));
}

export async function computeFolderHash(folder: Pick<Folder, 'name' | 'color' | 'parentId'>): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      name: folder.name,
      color: folder.color,
      parentId: folder.parentId,
    })
  );
}

// In-memory cache of note fingerprints keyed by `${note.id}:${note.updatedAt}:${note.pages.length}`
const noteFingerprintCache = new Map<string, LocalNoteFingerprint>();

export async function fingerprintLocalNote(note: Note): Promise<LocalNoteFingerprint> {
  const cacheKey = `${note.id}:${note.updatedAt}:${note.folderId ?? ''}:${note.pages.length}`;
  const cached = noteFingerprintCache.get(cacheKey);
  if (cached) return cached;

  const { note: dehydrated, blobMeta } = await dehydrateNote(note, false);
  const contentHash = await computeDehydratedNoteHash(dehydrated);
  const blobHashes = Object.keys(blobMeta).sort();
  const totalBlobBytes = blobHashes.reduce((sum, h) => sum + (blobMeta[h]?.size ?? 0), 0);
  const estimatedNoteBytes = Math.max(
    256,
    Math.round(JSON.stringify(dehydrated).length * 0.35)
  );

  const fp: LocalNoteFingerprint = {
    id: note.id,
    title: note.title,
    folderId: note.folderId,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
    pageCount: note.pages.length,
    contentHash,
    estimatedNoteBytes,
    blobHashes,
    blobMeta,
    totalBlobBytes,
  };
  noteFingerprintCache.set(cacheKey, fp);
  return fp;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ==================== Remote Manifest Fetch & 3-Way Comparison ====================

export async function fetchRemoteManifest(
  config: CloudSyncConfig,
  signal?: AbortSignal
): Promise<CloudManifest | null> {
  const raw = await s3GetObject(config, 'manifest.json', signal);
  if (!raw) return null;
  const parsed = await decompressJsonPayload<Partial<CloudManifest>>(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    version: typeof parsed.version === 'number' ? parsed.version : CLOUD_MANIFEST_VERSION,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    folders: parsed.folders && typeof parsed.folders === 'object' ? parsed.folders : {},
    notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
    blobs: parsed.blobs && typeof parsed.blobs === 'object' ? parsed.blobs : {},
    deletedNotes:
      parsed.deletedNotes && typeof parsed.deletedNotes === 'object' ? parsed.deletedNotes : {},
    deletedFolders:
      parsed.deletedFolders && typeof parsed.deletedFolders === 'object'
        ? parsed.deletedFolders
        : {},
    ...(parsed.settings ? { settings: normalizeAppSettings(parsed.settings) } : {}),
  };
}

function classify3Way(
  localHash: string | undefined,
  remoteHash: string | undefined,
  baseHash: string | undefined,
  options?: {
    localDeletedAt?: number;
    remoteDeletedAt?: number;
    remoteUpdatedAt?: number;
  }
): NoteDiffStatus {
  if (!localHash && !remoteHash) return 'synced';

  if (localHash && remoteHash) {
    if (localHash === remoteHash) return 'synced';
    if (baseHash) {
      if (remoteHash === baseHash && localHash !== baseHash) return 'local-ahead';
      if (localHash === baseHash && remoteHash !== baseHash) return 'remote-ahead';
    }
    return 'conflict';
  }

  // Only exists remotely (!localHash && remoteHash)
  if (!localHash && remoteHash) {
    if (baseHash) {
      // Previously synced on this device, now gone locally
      return remoteHash === baseHash ? 'deleted-local' : 'conflict';
    }
    if (options?.localDeletedAt !== undefined) {
      // Explicitly deleted locally even without prior baseline
      if (
        options.remoteUpdatedAt !== undefined &&
        options.remoteUpdatedAt > options.localDeletedAt
      ) {
        return 'conflict';
      }
      return 'deleted-local';
    }
    return 'remote-only';
  }

  // Only exists locally (localHash && !remoteHash)
  if (baseHash) {
    // Previously synced on this device, now gone from cloud
    return localHash === baseHash ? 'deleted-remote' : 'conflict';
  }
  if (options?.remoteDeletedAt !== undefined) {
    // Cloud recorded a tombstone, but this device has no baseline -> safe conflict
    return 'conflict';
  }
  return 'local-only';
}

export async function compareWithCloud(
  config: CloudSyncConfig,
  localNotes: Note[],
  localFolders: Folder[],
  onProgress?: (p: CloudTransferProgress) => void,
  signal?: AbortSignal
): Promise<CloudWorkspaceComparison> {
  onProgress?.({
    phase: 'analyzing',
    label: 'Lade Online-Index…',
    current: 0,
    total: Math.max(1, localNotes.length + 2),
    bytesTransferred: 0,
  });

  const [manifest, blobKeysRaw] = await Promise.all([
    fetchRemoteManifest(config, signal),
    s3ListRelativeKeys(config, 'blobs/', signal),
  ]);

  const remoteBlobKeys = new Set<string>();
  for (const key of blobKeysRaw) {
    if (key.startsWith('blobs/')) {
      remoteBlobKeys.add(key.slice('blobs/'.length));
    }
  }
  // Also trust manifest blob table in case list prefix had trailing differences
  if (manifest) {
    for (const hash of Object.keys(manifest.blobs)) {
      if (remoteBlobKeys.size === 0) {
        // Only if list returned empty despite manifest entries
        remoteBlobKeys.add(hash);
      }
    }
  }

  const baseline = loadCloudBaseline(config);
  const localDeletions = loadLocalDeletions();

  // Fingerprint local notes incrementally (low RAM, responsive UI)
  const localNoteMap = new Map<string, LocalNoteFingerprint>();
  for (let i = 0; i < localNotes.length; i++) {
    if (signal?.aborted) throw new Error('Vorgang abgebrochen.');
    const note = localNotes[i];
    onProgress?.({
      phase: 'analyzing',
      label: `Prüfe lokale Notizen (${i + 1}/${localNotes.length})…`,
      detail: note.title.trim() || 'Unbenannte Notiz',
      current: i + 1,
      total: localNotes.length + 2,
      bytesTransferred: 0,
    });
    const fp = await fingerprintLocalNote(note);
    localNoteMap.set(note.id, fp);
    if (i % 3 === 2) await yieldToMain();
  }

  // Fingerprint local folders
  const localFolderMap = new Map<string, Folder & { folderHash: string }>();
  for (const f of localFolders) {
    const folderHash = await computeFolderHash(f);
    localFolderMap.set(f.id, { ...f, folderHash });
  }

  const notesById = new Map<string, NoteComparison>();
  const allNoteIds = new Set<string>([
    ...localNoteMap.keys(),
    ...Object.keys(manifest?.notes ?? {}),
  ]);
  for (const id of allNoteIds) {
    const local = localNoteMap.get(id);
    const remote = manifest?.notes[id];
    const baseHash = baseline.notes[id]?.contentHash;
    notesById.set(id, {
      id,
      local,
      remote,
      baselineHash: baseHash,
      status: classify3Way(local?.contentHash, remote?.contentHash, baseHash, {
        localDeletedAt: localDeletions.notes[id],
        remoteDeletedAt: manifest?.deletedNotes?.[id]?.deletedAt,
        remoteUpdatedAt: remote?.updatedAt,
      }),
    });
  }

  const foldersById = new Map<string, FolderComparison>();
  const allFolderIds = new Set<string>([
    ...localFolderMap.keys(),
    ...Object.keys(manifest?.folders ?? {}),
  ]);
  for (const id of allFolderIds) {
    const local = localFolderMap.get(id);
    const remote = manifest?.folders[id];
    const baseHash = baseline.folders[id]?.folderHash;
    foldersById.set(id, {
      id,
      local,
      remote,
      baselineHash: baseHash,
      status: classify3Way(local?.folderHash, remote?.folderHash, baseHash, {
        localDeletedAt: localDeletions.folders[id],
        remoteDeletedAt: manifest?.deletedFolders?.[id]?.deletedAt,
      }),
    });
  }

  onProgress?.({
    phase: 'analyzing',
    label: 'Abgleich abgeschlossen',
    current: localNotes.length + 2,
    total: localNotes.length + 2,
    bytesTransferred: 0,
  });

  return {
    manifest,
    remoteBlobKeys,
    notesById,
    foldersById,
    baseline,
    analyzedAt: Date.now(),
  };
}

// ==================== Ancestor Folder Expansion ====================

export function collectAncestorFolderIds(
  startFolderIds: Iterable<string | null | undefined>,
  folderParentLookup: (id: string) => string | null | undefined
): Set<string> {
  const result = new Set<string>();
  for (const rawId of startFolderIds) {
    let curr = rawId ?? null;
    let guard = 0;
    while (curr && guard < 32) {
      if (result.has(curr)) break;
      result.add(curr);
      curr = folderParentLookup(curr) ?? null;
      guard++;
    }
  }
  return result;
}

// ==================== Backup (Lokal -> Online) Plan & Execution ====================

export interface BackupExecutionPlan {
  newNoteIds: string[];
  updateNoteIds: string[];
  overwriteRemoteNoteIds: string[];
  skippedConflictNoteIds: string[];
  unchangedNoteIds: string[];
  newFolderIds: string[];
  updateFolderIds: string[];
  overwriteRemoteFolderIds: string[];
  skippedConflictFolderIds: string[];
  estimatedUploadBytes: number;
  newBlobCount: number;
  reusedBlobCount: number;
}

export function buildBackupPlan(
  comparison: CloudWorkspaceComparison,
  selectedNoteIds: Set<string>,
  selectedFolderIds: Set<string>,
  noteConflictResolutions: Record<string, BackupConflictResolution>,
  folderConflictResolutions: Record<string, FolderConflictResolution>
): BackupExecutionPlan {
  const newNoteIds: string[] = [];
  const updateNoteIds: string[] = [];
  const overwriteRemoteNoteIds: string[] = [];
  const skippedConflictNoteIds: string[] = [];
  const unchangedNoteIds: string[] = [];

  const uploadBlobHashes = new Set<string>();
  const reusedBlobHashes = new Set<string>();
  const blobSizes = new Map<string, number>();
  let noteJsonBytes = 0;

  const activeNoteFolderIds: (string | null)[] = [];

  for (const id of selectedNoteIds) {
    const cmp = comparison.notesById.get(id);
    if (!cmp?.local) continue;

    let willUpload = false;
    if (cmp.status === 'synced') {
      unchangedNoteIds.push(id);
    } else if (cmp.status === 'local-only') {
      newNoteIds.push(id);
      willUpload = true;
    } else if (cmp.status === 'local-ahead') {
      updateNoteIds.push(id);
      willUpload = true;
    } else {
      // 'conflict' or 'remote-ahead'
      const decision = noteConflictResolutions[id] ?? 'skip';
      if (decision === 'overwrite-remote') {
        overwriteRemoteNoteIds.push(id);
        willUpload = true;
      } else {
        skippedConflictNoteIds.push(id);
      }
    }

    if (willUpload) {
      activeNoteFolderIds.push(cmp.local.folderId);
      noteJsonBytes += cmp.local.estimatedNoteBytes;
      for (const h of cmp.local.blobHashes) {
        const size = cmp.local.blobMeta[h]?.size ?? 0;
        blobSizes.set(h, size);
        if (comparison.remoteBlobKeys.has(h)) {
          reusedBlobHashes.add(h);
        } else {
          uploadBlobHashes.add(h);
        }
      }
    }
  }

  // Always include ancestor folders of any uploaded note (plus explicitly selected local folders)
  const requiredFolders = collectAncestorFolderIds(
    [...selectedFolderIds, ...activeNoteFolderIds],
    (fid) => comparison.foldersById.get(fid)?.local?.parentId ?? null
  );

  const newFolderIds: string[] = [];
  const updateFolderIds: string[] = [];
  const overwriteRemoteFolderIds: string[] = [];
  const skippedConflictFolderIds: string[] = [];

  for (const fid of requiredFolders) {
    const cmp = comparison.foldersById.get(fid);
    if (!cmp?.local) continue;
    if (cmp.status === 'synced') continue;
    if (cmp.status === 'local-only') {
      newFolderIds.push(fid);
    } else if (cmp.status === 'local-ahead') {
      updateFolderIds.push(fid);
    } else {
      const decision = folderConflictResolutions[fid] ?? 'keep-target';
      if (decision === 'overwrite-target') {
        overwriteRemoteFolderIds.push(fid);
      } else {
        skippedConflictFolderIds.push(fid);
      }
    }
  }

  let newBlobBytes = 0;
  for (const h of uploadBlobHashes) {
    newBlobBytes += blobSizes.get(h) ?? 0;
  }

  return {
    newNoteIds,
    updateNoteIds,
    overwriteRemoteNoteIds,
    skippedConflictNoteIds,
    unchangedNoteIds,
    newFolderIds,
    updateFolderIds,
    overwriteRemoteFolderIds,
    skippedConflictFolderIds,
    estimatedUploadBytes: noteJsonBytes + newBlobBytes,
    newBlobCount: uploadBlobHashes.size,
    reusedBlobCount: reusedBlobHashes.size,
  };
}

export interface BackupExecutionResult {
  uploadedNotes: number;
  uploadedBlobs: number;
  reusedBlobs: number;
  updatedFolders: number;
  deletedNotes: number;
  deletedFolders: number;
  bytesUploaded: number;
  cancelled: boolean;
}

export async function executeCloudBackup(
  config: CloudSyncConfig,
  comparison: CloudWorkspaceComparison,
  plan: BackupExecutionPlan,
  localNotes: Note[],
  localFolders: Folder[],
  options: {
    includeSettings?: boolean;
    settings?: AppSettings;
    deleteRemoteNoteIds?: string[];
    deleteRemoteFolderIds?: string[];
    onProgress?: (p: CloudTransferProgress) => void;
    signal?: AbortSignal;
  }
): Promise<BackupExecutionResult> {
  const noteById = new Map(localNotes.map((n) => [n.id, n]));
  const folderById = new Map(localFolders.map((f) => [f.id, f]));

  const noteIdsToUpload = [
    ...plan.newNoteIds,
    ...plan.updateNoteIds,
    ...plan.overwriteRemoteNoteIds,
  ];
  const folderIdsToUpload = [
    ...plan.newFolderIds,
    ...plan.updateFolderIds,
    ...plan.overwriteRemoteFolderIds,
  ];
  const noteIdsToDelete = options.deleteRemoteNoteIds ?? [];
  const folderIdsToDelete = options.deleteRemoteFolderIds ?? [];

  const totalSteps = Math.max(1, noteIdsToUpload.length + noteIdsToDelete.length + 1);

  options.onProgress?.({
    phase: 'uploading',
    label: 'Bereite Online-Backup vor…',
    detail: 'Prüfe aktuellen Online-Index',
    current: 0,
    total: totalSteps,
    bytesTransferred: 0,
  });

  // Fetch freshest remote manifest right before writing so concurrent devices don't lose entries
  const latestRemote = (await fetchRemoteManifest(config, options.signal)) ?? comparison.manifest;
  const mergedManifest: CloudManifest = {
    version: CLOUD_MANIFEST_VERSION,
    updatedAt: Date.now(),
    folders: { ...(latestRemote?.folders ?? {}) },
    notes: { ...(latestRemote?.notes ?? {}) },
    blobs: { ...(latestRemote?.blobs ?? {}) },
    deletedNotes: pruneTombstones(latestRemote?.deletedNotes),
    deletedFolders: pruneTombstones(latestRemote?.deletedFolders),
    ...(latestRemote?.settings ? { settings: latestRemote.settings } : {}),
  };

  const baseline = loadCloudBaseline(config);
  const knownRemoteBlobs = new Set(comparison.remoteBlobKeys);

  let uploadedNotes = 0;
  let uploadedBlobs = 0;
  let reusedBlobs = 0;
  let deletedNotes = 0;
  let deletedFolders = 0;
  let bytesUploaded = 0;
  let cancelled = false;
  let notesSinceCheckpoint = 0;

  // Apply folder updates into manifest
  let updatedFolders = 0;
  for (const fid of folderIdsToUpload) {
    const f = folderById.get(fid);
    if (!f) continue;
    const folderHash = await computeFolderHash(f);
    mergedManifest.folders[fid] = {
      id: f.id,
      name: f.name,
      color: f.color,
      parentId: f.parentId,
      createdAt: f.createdAt,
      folderHash,
    };
    if (mergedManifest.deletedFolders) delete mergedManifest.deletedFolders[fid];
    baseline.folders[fid] = { folderHash, syncedAt: Date.now() };
    updatedFolders++;
  }

  // Apply remote folder deletions into manifest (with tombstones)
  for (const fid of folderIdsToDelete) {
    const existing = mergedManifest.folders[fid];
    if (mergedManifest.deletedFolders) {
      mergedManifest.deletedFolders[fid] = {
        deletedAt: Date.now(),
        label: existing?.name,
      };
    }
    delete mergedManifest.folders[fid];
    delete baseline.folders[fid];
    deletedFolders++;
  }

  // Also ensure synced folders have their baseline recorded
  for (const [fid, cmp] of comparison.foldersById) {
    if (cmp.status === 'synced' && cmp.local) {
      baseline.folders[fid] = { folderHash: cmp.local.folderHash, syncedAt: Date.now() };
    }
  }

  const flushManifestCheckpoint = async () => {
    mergedManifest.updatedAt = Date.now();
    const manifestBytes = textEncoder.encode(JSON.stringify(mergedManifest));
    await s3PutObject(config, 'manifest.json', manifestBytes, 'application/json');
    baseline.lastBackupAt = Date.now();
    saveCloudBaseline(config, baseline);
  };

  for (let i = 0; i < noteIdsToUpload.length; i++) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }

    const noteId = noteIdsToUpload[i];
    const note = noteById.get(noteId);
    if (!note) continue;

    const noteLabel = note.title.trim() || 'Unbenannte Notiz';
    options.onProgress?.({
      phase: 'uploading',
      label: `Sichere Notiz ${i + 1} von ${noteIdsToUpload.length}`,
      detail: noteLabel,
      current: i,
      total: totalSteps,
      bytesTransferred: bytesUploaded,
    });

    const { note: dehydrated, blobMeta, blobs } = await dehydrateNote(note, true);
    const contentHash = await computeDehydratedNoteHash(dehydrated);

    // 1. Upload only missing binary blobs (one by one for low iPad RAM)
    if (blobs) {
      const entries = [...blobs.entries()];
      for (let bIdx = 0; bIdx < entries.length; bIdx++) {
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        const [hash, blobData] = entries[bIdx];
        mergedManifest.blobs[hash] = {
          mime: blobData.mime,
          size: blobData.bytes.byteLength,
        };
        if (knownRemoteBlobs.has(hash)) {
          reusedBlobs++;
          continue;
        }
        options.onProgress?.({
          phase: 'uploading',
          label: `Lade Medium ${bIdx + 1}/${entries.length} für „${noteLabel}“`,
          detail: `${(blobData.bytes.byteLength / 1024).toFixed(0)} KB`,
          current: i,
          total: totalSteps,
          bytesTransferred: bytesUploaded,
        });
        await s3PutObject(
          config,
          `blobs/${hash}`,
          blobData.bytes,
          blobData.mime,
          options.signal
        );
        knownRemoteBlobs.add(hash);
        uploadedBlobs++;
        bytesUploaded += blobData.bytes.byteLength;
        options.onProgress?.({
          phase: 'uploading',
          label: `Medium ${bIdx + 1}/${entries.length} für „${noteLabel}“ hochgeladen`,
          detail: `${(blobData.bytes.byteLength / 1024).toFixed(0)} KB`,
          current: i,
          total: totalSteps,
          bytesTransferred: bytesUploaded,
        });
      }
    }

    if (cancelled) break;

    // 2. Gzip & upload dehydrated note JSON (usually just a few KB!)
    const { bytes: notePayload, compressed } = await compressJsonPayload({
      note: dehydrated,
      blobMeta,
    });
    await s3PutObject(
      config,
      `notes/${note.id}.json.gz`,
      notePayload,
      compressed ? 'application/gzip' : 'application/json',
      options.signal
    );
    bytesUploaded += notePayload.byteLength;
    options.onProgress?.({
      phase: 'uploading',
      label: `Notiz ${i + 1} von ${noteIdsToUpload.length} gesichert`,
      detail: noteLabel,
      current: i + 1,
      total: totalSteps,
      bytesTransferred: bytesUploaded,
    });

    const blobHashes = Object.keys(blobMeta).sort();
    const totalBlobBytes = blobHashes.reduce((s, h) => s + (blobMeta[h]?.size ?? 0), 0);
    mergedManifest.notes[note.id] = {
      id: note.id,
      title: note.title,
      folderId: note.folderId,
      updatedAt: note.updatedAt,
      createdAt: note.createdAt,
      pageCount: note.pages.length,
      contentHash,
      noteBytes: notePayload.byteLength,
      blobHashes,
      totalBlobBytes,
    };
    if (mergedManifest.deletedNotes) delete mergedManifest.deletedNotes[note.id];

    baseline.notes[note.id] = { contentHash, syncedAt: Date.now() };
    uploadedNotes++;
    notesSinceCheckpoint++;

    // Periodic manifest checkpoint so partial progress survives Safari backgrounding / drops
    if (notesSinceCheckpoint >= 5) {
      await flushManifestCheckpoint();
      notesSinceCheckpoint = 0;
    }
    await yieldToMain();
  }

  // Apply remote note deletions (tombstone + best-effort S3 DELETE of notes/<id>.json.gz)
  if (!cancelled && noteIdsToDelete.length > 0) {
    for (let i = 0; i < noteIdsToDelete.length; i++) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      const id = noteIdsToDelete[i];
      const existing = mergedManifest.notes[id];
      const noteLabel = existing?.title?.trim() || 'Notiz';
      options.onProgress?.({
        phase: 'uploading',
        label: `Entferne Online-Notiz ${i + 1} von ${noteIdsToDelete.length}`,
        detail: noteLabel,
        current: noteIdsToUpload.length + i,
        total: totalSteps,
        bytesTransferred: bytesUploaded,
      });

      if (mergedManifest.deletedNotes) {
        mergedManifest.deletedNotes[id] = {
          deletedAt: Date.now(),
          label: existing?.title,
        };
      }
      delete mergedManifest.notes[id];
      delete baseline.notes[id];
      deletedNotes++;

      try {
        await s3DeleteObject(config, `notes/${id}.json.gz`, options.signal);
      } catch {
        // Manifest removal + tombstone is authoritative even if bucket key disallows DELETE
      }
      await yieldToMain();
    }
  }

  // Clear local deletion tombstones for items now processed
  clearLocalDeletions(
    [...noteIdsToUpload, ...noteIdsToDelete],
    [...folderIdsToUpload, ...folderIdsToDelete]
  );

  // Record baseline for already-synced selected notes too
  for (const id of plan.unchangedNoteIds) {
    const cmp = comparison.notesById.get(id);
    if (cmp?.local) {
      baseline.notes[id] = { contentHash: cmp.local.contentHash, syncedAt: Date.now() };
    }
  }

  if (!cancelled && options.includeSettings && options.settings) {
    mergedManifest.settings = options.settings;
  }

  if (
    uploadedNotes > 0 ||
    updatedFolders > 0 ||
    deletedNotes > 0 ||
    deletedFolders > 0 ||
    (!cancelled && options.includeSettings)
  ) {
    options.onProgress?.({
      phase: 'finalizing',
      label: 'Aktualisiere Online-Index (manifest.json)…',
      current: totalSteps - 1,
      total: totalSteps,
      bytesTransferred: bytesUploaded,
    });
    await flushManifestCheckpoint();
  }

  options.onProgress?.({
    phase: 'finalizing',
    label: cancelled ? 'Backup pausiert (Fortschritt gesichert)' : 'Backup abgeschlossen',
    current: totalSteps,
    total: totalSteps,
    bytesTransferred: bytesUploaded,
  });

  return {
    uploadedNotes,
    uploadedBlobs,
    reusedBlobs,
    updatedFolders,
    deletedNotes,
    deletedFolders,
    bytesUploaded,
    cancelled,
  };
}

// ==================== Import (Online -> Lokal) Plan & Execution ====================

export interface ImportExecutionPlan {
  newNoteIds: string[];
  updateNoteIds: string[];
  replaceLocalNoteIds: string[];
  copyNoteIds: string[];
  skippedConflictNoteIds: string[];
  unchangedNoteIds: string[];
  newFolderIds: string[];
  updateFolderIds: string[];
  replaceLocalFolderIds: string[];
  skippedConflictFolderIds: string[];
  estimatedDownloadBytes: number;
  downloadBlobCount: number;
  reusedLocalBlobCount: number;
}

export function buildImportPlan(
  comparison: CloudWorkspaceComparison,
  selectedNoteIds: Set<string>,
  selectedFolderIds: Set<string>,
  noteConflictResolutions: Record<string, ImportConflictResolution>,
  folderConflictResolutions: Record<string, FolderConflictResolution>
): ImportExecutionPlan {
  const newNoteIds: string[] = [];
  const updateNoteIds: string[] = [];
  const replaceLocalNoteIds: string[] = [];
  const copyNoteIds: string[] = [];
  const skippedConflictNoteIds: string[] = [];
  const unchangedNoteIds: string[] = [];

  // Collect all blob hashes already present in local notes so we don't re-download them!
  const localAvailableBlobs = new Set<string>();
  for (const cmp of comparison.notesById.values()) {
    if (cmp.local) {
      for (const h of cmp.local.blobHashes) localAvailableBlobs.add(h);
    }
  }

  const neededRemoteBlobs = new Set<string>();
  const reusedLocalBlobs = new Set<string>();
  let noteJsonBytes = 0;
  const activeNoteFolderIds: (string | null)[] = [];

  for (const id of selectedNoteIds) {
    const cmp = comparison.notesById.get(id);
    if (!cmp?.remote) continue;

    let willImport = false;
    if (cmp.status === 'synced') {
      unchangedNoteIds.push(id);
    } else if (cmp.status === 'remote-only' || cmp.status === 'deleted-local') {
      newNoteIds.push(id);
      willImport = true;
    } else if (cmp.status === 'remote-ahead') {
      updateNoteIds.push(id);
      willImport = true;
    } else {
      // 'conflict' or 'local-ahead'
      const decision = noteConflictResolutions[id] ?? 'keep-local';
      if (decision === 'use-remote') {
        replaceLocalNoteIds.push(id);
        willImport = true;
      } else if (decision === 'keep-both') {
        copyNoteIds.push(id);
        willImport = true;
      } else {
        skippedConflictNoteIds.push(id);
      }
    }

    if (willImport) {
      activeNoteFolderIds.push(cmp.remote.folderId);
      noteJsonBytes += cmp.remote.noteBytes;
      for (const h of cmp.remote.blobHashes) {
        if (localAvailableBlobs.has(h)) {
          reusedLocalBlobs.add(h);
        } else {
          neededRemoteBlobs.add(h);
        }
      }
    }
  }

  // Always include remote ancestor folders for imported notes
  const requiredFolders = collectAncestorFolderIds(
    [...selectedFolderIds, ...activeNoteFolderIds],
    (fid) => comparison.foldersById.get(fid)?.remote?.parentId ?? null
  );

  const newFolderIds: string[] = [];
  const updateFolderIds: string[] = [];
  const replaceLocalFolderIds: string[] = [];
  const skippedConflictFolderIds: string[] = [];

  for (const fid of requiredFolders) {
    const cmp = comparison.foldersById.get(fid);
    if (!cmp?.remote) continue;
    if (cmp.status === 'synced') continue;
    if (cmp.status === 'remote-only' || cmp.status === 'deleted-local') {
      newFolderIds.push(fid);
    } else if (cmp.status === 'remote-ahead') {
      updateFolderIds.push(fid);
    } else {
      const decision = folderConflictResolutions[fid] ?? 'keep-target';
      if (decision === 'overwrite-target') {
        replaceLocalFolderIds.push(fid);
      } else {
        skippedConflictFolderIds.push(fid);
      }
    }
  }

  let neededBlobBytes = 0;
  for (const h of neededRemoteBlobs) {
    neededBlobBytes += comparison.manifest?.blobs[h]?.size ?? 0;
  }

  return {
    newNoteIds,
    updateNoteIds,
    replaceLocalNoteIds,
    copyNoteIds,
    skippedConflictNoteIds,
    unchangedNoteIds,
    newFolderIds,
    updateFolderIds,
    replaceLocalFolderIds,
    skippedConflictFolderIds,
    estimatedDownloadBytes: noteJsonBytes + neededBlobBytes,
    downloadBlobCount: neededRemoteBlobs.size,
    reusedLocalBlobCount: reusedLocalBlobs.size,
  };
}

export interface ImportExecutionResult {
  upsertNotes: Note[];
  upsertFolders: Folder[];
  settings: AppSettings | null;
  importedCount: number;
  copiedCount: number;
  downloadedBlobs: number;
  reusedLocalBlobs: number;
  bytesDownloaded: number;
  cancelled: boolean;
}

/** Build a lookup map of hash -> existing local dataUrl so we skip downloading blobs already on this iPad */
async function buildLocalBlobDataUrlLookup(
  localNotes: Note[],
  neededHashes: Set<string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (neededHashes.size === 0) return map;

  const inspect = async (src: string) => {
    if (!src.startsWith('data:')) return;
    const cacheKey = makeDataUrlCacheKey(src);
    const cached = dataUrlHashCache.get(cacheKey);
    if (cached) {
      if (neededHashes.has(cached.hash) && !map.has(cached.hash)) {
        map.set(cached.hash, src);
      }
      return;
    }
    const parsed = parseDataUrl(src);
    if (!parsed) return;
    const raw = base64ToUint8Array(parsed.base64);
    const hash = await sha256Hex(raw);
    dataUrlHashCache.set(cacheKey, { hash, mime: parsed.mime, size: raw.byteLength });
    if (neededHashes.has(hash) && !map.has(hash)) {
      map.set(hash, src);
    }
  };

  for (const note of localNotes) {
    for (const att of note.attachments) await inspect(att.src);
    for (const page of note.pages) {
      if (page.backgroundImage?.src) await inspect(page.backgroundImage.src);
      for (const img of page.images) await inspect(img.src);
    }
    if (map.size >= neededHashes.size) break;
  }
  return map;
}

function cloneNoteAsCloudCopy(note: Note): Note {
  const now = Date.now();
  const clonedPages = note.pages.map((p) => ({
    ...p,
    id: generateId(),
    paperConfig: { ...p.paperConfig },
    backgroundImage: p.backgroundImage ? { ...p.backgroundImage } : null,
    strokes: p.strokes.map((s) => ({
      ...s,
      id: generateId(),
      points: s.points.map((pt) => ({ ...pt })),
    })),
    texts: p.texts.map((t) => ({ ...t, id: generateId() })),
    images: p.images.map((img) => ({ ...img, id: generateId() })),
  }));
  const baseTitle = note.title.trim() || 'Unbenannte Notiz';
  return {
    ...note,
    id: generateId(),
    title: `${baseTitle} (Online-Kopie)`,
    pinned: false,
    pages: clonedPages,
    activePageId: clonedPages[0]?.id ?? note.activePageId,
    updatedAt: now,
  };
}

export async function executeCloudImport(
  config: CloudSyncConfig,
  comparison: CloudWorkspaceComparison,
  plan: ImportExecutionPlan,
  localNotes: Note[],
  options: {
    importSettings?: boolean;
    onProgress?: (p: CloudTransferProgress) => void;
    signal?: AbortSignal;
  }
): Promise<ImportExecutionResult> {
  const manifest = comparison.manifest;
  if (!manifest) {
    return {
      upsertNotes: [],
      upsertFolders: [],
      settings: null,
      importedCount: 0,
      copiedCount: 0,
      downloadedBlobs: 0,
      reusedLocalBlobs: 0,
      bytesDownloaded: 0,
      cancelled: false,
    };
  }

  const directNoteIds = [
    ...plan.newNoteIds,
    ...plan.updateNoteIds,
    ...plan.replaceLocalNoteIds,
  ];
  const copyNoteIdSet = new Set(plan.copyNoteIds);
  const allToFetch = [...directNoteIds, ...plan.copyNoteIds];

  // Collect all blob hashes needed across the selected notes
  const allNeededHashes = new Set<string>();
  for (const id of allToFetch) {
    const entry = manifest.notes[id];
    if (entry) {
      for (const h of entry.blobHashes) allNeededHashes.add(h);
    }
  }

  const localBlobLookup = await buildLocalBlobDataUrlLookup(localNotes, allNeededHashes);
  const downloadedBlobCache = new Map<string, string>();

  const upsertFolders: Folder[] = [];
  const folderIdsToApply = [
    ...plan.newFolderIds,
    ...plan.updateFolderIds,
    ...plan.replaceLocalFolderIds,
  ];
  const baseline = loadCloudBaseline(config);

  for (const fid of folderIdsToApply) {
    const remoteF = manifest.folders[fid];
    if (!remoteF) continue;
    upsertFolders.push(
      normalizeFolder({
        id: remoteF.id,
        name: remoteF.name,
        color: remoteF.color,
        parentId: remoteF.parentId,
        createdAt: remoteF.createdAt,
      })
    );
    baseline.folders[fid] = { folderHash: remoteF.folderHash, syncedAt: Date.now() };
  }

  const upsertNotes: Note[] = [];
  let importedCount = 0;
  let copiedCount = 0;
  let downloadedBlobs = 0;
  let reusedLocalBlobs = 0;
  let bytesDownloaded = 0;
  let cancelled = false;

  const totalSteps = Math.max(1, allToFetch.length);

  for (let i = 0; i < allToFetch.length; i++) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }

    const noteId = allToFetch[i];
    const remoteEntry = manifest.notes[noteId];
    const noteLabel = remoteEntry?.title?.trim() || 'Unbenannte Notiz';

    options.onProgress?.({
      phase: 'downloading',
      label: `Lade Notiz ${i + 1} von ${allToFetch.length}`,
      detail: noteLabel,
      current: i,
      total: totalSteps,
      bytesTransferred: bytesDownloaded,
    });

    const rawNoteBytes = await s3GetObject(config, `notes/${noteId}.json.gz`, options.signal);
    if (!rawNoteBytes) continue;
    bytesDownloaded += rawNoteBytes.byteLength;

    const payload = await decompressJsonPayload<{
      note?: Record<string, unknown>;
      blobMeta?: Record<string, CloudBlobMeta>;
    }>(rawNoteBytes);

    const rawNoteObj = payload?.note ?? (payload as unknown as Record<string, unknown>);
    const noteBlobMeta = payload?.blobMeta ?? {};
    const hydratedNote = normalizeNote(rawNoteObj);

    const resolveSrc = async (src: string): Promise<string> => {
      if (!src.startsWith(BLOB_REF_PREFIX)) return src;
      const hash = src.slice(BLOB_REF_PREFIX.length);
      const localExisting = localBlobLookup.get(hash);
      if (localExisting) {
        reusedLocalBlobs++;
        return localExisting;
      }
      const cached = downloadedBlobCache.get(hash);
      if (cached) return cached;

      const meta = noteBlobMeta[hash] ?? manifest.blobs[hash];
      options.onProgress?.({
        phase: 'downloading',
        label: `Lade Medium für „${noteLabel}“`,
        detail: meta ? `${(meta.size / 1024).toFixed(0)} KB` : undefined,
        current: i,
        total: totalSteps,
        bytesTransferred: bytesDownloaded,
      });

      const blobBytes = await s3GetObject(config, `blobs/${hash}`, options.signal);
      if (!blobBytes) return src;
      bytesDownloaded += blobBytes.byteLength;
      downloadedBlobs++;

      const mime = meta?.mime ?? 'image/jpeg';
      const dataUrl = uint8ArrayToDataUrl(blobBytes, mime);
      downloadedBlobCache.set(hash, dataUrl);
      dataUrlHashCache.set(makeDataUrlCacheKey(dataUrl), {
        hash,
        mime,
        size: blobBytes.byteLength,
      });
      return dataUrl;
    };

    for (const att of hydratedNote.attachments) {
      att.src = await resolveSrc(att.src);
    }
    for (const page of hydratedNote.pages) {
      if (page.backgroundImage?.src) {
        page.backgroundImage.src = await resolveSrc(page.backgroundImage.src);
      }
      for (const img of page.images) {
        img.src = await resolveSrc(img.src);
      }
    }

    if (copyNoteIdSet.has(noteId)) {
      upsertNotes.push(cloneNoteAsCloudCopy(hydratedNote));
      copiedCount++;
    } else {
      upsertNotes.push(hydratedNote);
      importedCount++;
      if (remoteEntry) {
        baseline.notes[hydratedNote.id] = {
          contentHash: remoteEntry.contentHash,
          syncedAt: Date.now(),
        };
      }
    }

    await yieldToMain();
  }

  for (const id of plan.unchangedNoteIds) {
    const cmp = comparison.notesById.get(id);
    if (cmp?.remote) {
      baseline.notes[id] = { contentHash: cmp.remote.contentHash, syncedAt: Date.now() };
    }
  }

  if (upsertNotes.length > 0 || upsertFolders.length > 0) {
    baseline.lastImportAt = Date.now();
    saveCloudBaseline(config, baseline);
  }

  options.onProgress?.({
    phase: 'finalizing',
    label: cancelled ? 'Import abgebrochen' : 'Import abgeschlossen',
    current: totalSteps,
    total: totalSteps,
    bytesTransferred: bytesDownloaded,
  });

  return {
    upsertNotes,
    upsertFolders,
    settings:
      !cancelled && options.importSettings && manifest.settings ? manifest.settings : null,
    importedCount,
    copiedCount,
    downloadedBlobs,
    reusedLocalBlobs,
    bytesDownloaded,
    cancelled,
  };
}

// ==================== 2-Way Sync (Lokal <-> Online) Plan & Execution ====================

export interface SyncExecutionPlan {
  // Download (Online -> Lokal)
  downloadNewNoteIds: string[];
  downloadUpdateNoteIds: string[];
  downloadConflictRemoteNoteIds: string[];
  downloadNewFolderIds: string[];
  downloadUpdateFolderIds: string[];
  downloadConflictRemoteFolderIds: string[];
  estimatedDownloadBytes: number;
  downloadNewBlobCount: number;
  downloadReusedLocalBlobCount: number;

  // Upload (Lokal -> Online)
  uploadNewNoteIds: string[];
  uploadUpdateNoteIds: string[];
  uploadConflictLocalNoteIds: string[];
  uploadNewFolderIds: string[];
  uploadUpdateFolderIds: string[];
  uploadConflictLocalFolderIds: string[];
  estimatedUploadBytes: number;
  uploadNewBlobCount: number;
  uploadReusedRemoteBlobCount: number;

  // Deletions (propagated in 2-way Sync)
  deleteLocalNoteIds: string[];
  deleteLocalConflictNoteIds: string[];
  deleteLocalFolderIds: string[];
  deleteLocalConflictFolderIds: string[];
  deleteRemoteNoteIds: string[];
  deleteRemoteConflictNoteIds: string[];
  deleteRemoteFolderIds: string[];
  deleteRemoteConflictFolderIds: string[];

  // Conflict keep-both (downloads remote as copy, uploads copy + local original)
  keepBothConflictNoteIds: string[];

  // Unchanged / skipped
  skippedConflictNoteIds: string[];
  skippedConflictFolderIds: string[];
  unchangedNoteIds: string[];
}

export function buildSyncPlan(
  comparison: CloudWorkspaceComparison,
  selectedNoteIds: Set<string>,
  selectedFolderIds: Set<string>,
  noteConflictResolutions: Record<string, SyncConflictResolution>,
  folderConflictResolutions: Record<string, SyncFolderConflictResolution>
): SyncExecutionPlan {
  const downloadNewNoteIds: string[] = [];
  const downloadUpdateNoteIds: string[] = [];
  const downloadConflictRemoteNoteIds: string[] = [];

  const uploadNewNoteIds: string[] = [];
  const uploadUpdateNoteIds: string[] = [];
  const uploadConflictLocalNoteIds: string[] = [];

  const deleteLocalNoteIds: string[] = [];
  const deleteLocalConflictNoteIds: string[] = [];
  const deleteRemoteNoteIds: string[] = [];
  const deleteRemoteConflictNoteIds: string[] = [];

  const keepBothConflictNoteIds: string[] = [];
  const skippedConflictNoteIds: string[] = [];
  const unchangedNoteIds: string[] = [];

  const localAvailableBlobs = new Set<string>();
  for (const cmp of comparison.notesById.values()) {
    if (cmp.local) {
      for (const h of cmp.local.blobHashes) localAvailableBlobs.add(h);
    }
  }

  const downloadBlobHashes = new Set<string>();
  const downloadReusedBlobs = new Set<string>();
  const uploadBlobHashes = new Set<string>();
  const uploadReusedBlobs = new Set<string>();
  const localBlobSizes = new Map<string, number>();

  let downloadJsonBytes = 0;
  let uploadJsonBytes = 0;

  const downloadNoteFolderIds: (string | null)[] = [];
  const uploadNoteFolderIds: (string | null)[] = [];

  const recordUploadCost = (local: LocalNoteFingerprint) => {
    uploadNoteFolderIds.push(local.folderId);
    uploadJsonBytes += local.estimatedNoteBytes;
    for (const h of local.blobHashes) {
      localBlobSizes.set(h, local.blobMeta[h]?.size ?? 0);
      if (comparison.remoteBlobKeys.has(h)) {
        uploadReusedBlobs.add(h);
      } else {
        uploadBlobHashes.add(h);
      }
    }
  };

  const recordDownloadCost = (remote: CloudManifestNoteEntry) => {
    downloadNoteFolderIds.push(remote.folderId);
    downloadJsonBytes += remote.noteBytes;
    for (const h of remote.blobHashes) {
      if (localAvailableBlobs.has(h)) {
        downloadReusedBlobs.add(h);
      } else {
        downloadBlobHashes.add(h);
      }
    }
  };

  for (const id of selectedNoteIds) {
    const cmp = comparison.notesById.get(id);
    if (!cmp) continue;

    if (cmp.status === 'synced') {
      unchangedNoteIds.push(id);
    } else if (cmp.status === 'local-only' && cmp.local) {
      uploadNewNoteIds.push(id);
      recordUploadCost(cmp.local);
    } else if (cmp.status === 'local-ahead' && cmp.local) {
      uploadUpdateNoteIds.push(id);
      recordUploadCost(cmp.local);
    } else if (cmp.status === 'remote-only' && cmp.remote) {
      downloadNewNoteIds.push(id);
      recordDownloadCost(cmp.remote);
    } else if (cmp.status === 'remote-ahead' && cmp.remote) {
      downloadUpdateNoteIds.push(id);
      recordDownloadCost(cmp.remote);
    } else if (cmp.status === 'deleted-local' && cmp.remote) {
      deleteRemoteNoteIds.push(id);
    } else if (cmp.status === 'deleted-remote' && cmp.local) {
      deleteLocalNoteIds.push(id);
    } else if (cmp.status === 'conflict') {
      const decision = noteConflictResolutions[id] ?? 'skip';
      if (decision === 'use-local') {
        if (cmp.local) {
          uploadConflictLocalNoteIds.push(id);
          recordUploadCost(cmp.local);
        } else if (cmp.remote) {
          // Local was deleted, user chose local -> delete remote
          deleteRemoteConflictNoteIds.push(id);
        }
      } else if (decision === 'use-remote') {
        if (cmp.remote) {
          downloadConflictRemoteNoteIds.push(id);
          recordDownloadCost(cmp.remote);
        } else if (cmp.local) {
          // Remote was deleted, user chose remote -> delete local
          deleteLocalConflictNoteIds.push(id);
        }
      } else if (decision === 'keep-both' && cmp.local && cmp.remote) {
        keepBothConflictNoteIds.push(id);
        recordDownloadCost(cmp.remote);
        recordUploadCost(cmp.local);
        // Copy JSON will also be uploaded (its blobs already exist remotely)
        uploadJsonBytes += cmp.remote.noteBytes;
      } else {
        skippedConflictNoteIds.push(id);
      }
    }
  }

  // Ancestor folders for upload & download directions (plus explicitly selected folders)
  const selectedLocalFolders: string[] = [];
  const selectedRemoteFolders: string[] = [];
  for (const fid of selectedFolderIds) {
    const fCmp = comparison.foldersById.get(fid);
    if (fCmp?.local) selectedLocalFolders.push(fid);
    if (fCmp?.remote) selectedRemoteFolders.push(fid);
  }

  const requiredUploadFolders = collectAncestorFolderIds(
    [...selectedLocalFolders, ...uploadNoteFolderIds],
    (fid) => comparison.foldersById.get(fid)?.local?.parentId ?? null
  );
  const requiredDownloadFolders = collectAncestorFolderIds(
    [...selectedRemoteFolders, ...downloadNoteFolderIds],
    (fid) => comparison.foldersById.get(fid)?.remote?.parentId ?? null
  );
  const allRequiredFolders = new Set<string>([
    ...requiredUploadFolders,
    ...requiredDownloadFolders,
  ]);

  const downloadNewFolderIds: string[] = [];
  const downloadUpdateFolderIds: string[] = [];
  const downloadConflictRemoteFolderIds: string[] = [];
  const uploadNewFolderIds: string[] = [];
  const uploadUpdateFolderIds: string[] = [];
  const uploadConflictLocalFolderIds: string[] = [];
  const deleteLocalFolderIds: string[] = [];
  const deleteLocalConflictFolderIds: string[] = [];
  const deleteRemoteFolderIds: string[] = [];
  const deleteRemoteConflictFolderIds: string[] = [];
  const skippedConflictFolderIds: string[] = [];

  for (const fid of allRequiredFolders) {
    const cmp = comparison.foldersById.get(fid);
    if (!cmp || cmp.status === 'synced') continue;

    if (cmp.status === 'local-only' && cmp.local) {
      uploadNewFolderIds.push(fid);
    } else if (cmp.status === 'local-ahead' && cmp.local) {
      uploadUpdateFolderIds.push(fid);
    } else if (cmp.status === 'remote-only' && cmp.remote) {
      downloadNewFolderIds.push(fid);
    } else if (cmp.status === 'remote-ahead' && cmp.remote) {
      downloadUpdateFolderIds.push(fid);
    } else if (cmp.status === 'deleted-local' && cmp.remote) {
      if (selectedFolderIds.has(fid)) {
        deleteRemoteFolderIds.push(fid);
      }
    } else if (cmp.status === 'deleted-remote' && cmp.local) {
      if (selectedFolderIds.has(fid)) {
        deleteLocalFolderIds.push(fid);
      }
    } else if (cmp.status === 'conflict') {
      const decision = folderConflictResolutions[fid] ?? 'skip';
      if (decision === 'use-local') {
        if (cmp.local) uploadConflictLocalFolderIds.push(fid);
        else if (cmp.remote) deleteRemoteConflictFolderIds.push(fid);
      } else if (decision === 'use-remote') {
        if (cmp.remote) downloadConflictRemoteFolderIds.push(fid);
        else if (cmp.local) deleteLocalConflictFolderIds.push(fid);
      } else {
        skippedConflictFolderIds.push(fid);
      }
    }
  }

  let downloadBlobBytes = 0;
  for (const h of downloadBlobHashes) {
    downloadBlobBytes += comparison.manifest?.blobs[h]?.size ?? 0;
  }

  let uploadBlobBytes = 0;
  for (const h of uploadBlobHashes) {
    uploadBlobBytes += localBlobSizes.get(h) ?? 0;
  }

  return {
    downloadNewNoteIds,
    downloadUpdateNoteIds,
    downloadConflictRemoteNoteIds,
    downloadNewFolderIds,
    downloadUpdateFolderIds,
    downloadConflictRemoteFolderIds,
    estimatedDownloadBytes: downloadJsonBytes + downloadBlobBytes,
    downloadNewBlobCount: downloadBlobHashes.size,
    downloadReusedLocalBlobCount: downloadReusedBlobs.size,

    uploadNewNoteIds,
    uploadUpdateNoteIds,
    uploadConflictLocalNoteIds,
    uploadNewFolderIds,
    uploadUpdateFolderIds,
    uploadConflictLocalFolderIds,
    estimatedUploadBytes: uploadJsonBytes + uploadBlobBytes,
    uploadNewBlobCount: uploadBlobHashes.size,
    uploadReusedRemoteBlobCount: uploadReusedBlobs.size,

    deleteLocalNoteIds,
    deleteLocalConflictNoteIds,
    deleteLocalFolderIds,
    deleteLocalConflictFolderIds,
    deleteRemoteNoteIds,
    deleteRemoteConflictNoteIds,
    deleteRemoteFolderIds,
    deleteRemoteConflictFolderIds,

    keepBothConflictNoteIds,
    skippedConflictNoteIds,
    skippedConflictFolderIds,
    unchangedNoteIds,
  };
}

export interface SyncExecutionResult {
  uploadedNotes: number;
  uploadedBlobs: number;
  reusedRemoteBlobs: number;
  uploadedFolders: number;
  bytesUploaded: number;
  downloadedNotes: number;
  copiedConflictNotes: number;
  downloadedBlobs: number;
  reusedLocalBlobs: number;
  downloadedFolders: number;
  bytesDownloaded: number;
  deletedLocalNotes: number;
  deletedLocalFolders: number;
  deletedRemoteNotes: number;
  deletedRemoteFolders: number;
  cancelled: boolean;
}

export async function executeCloudSync(
  config: CloudSyncConfig,
  comparison: CloudWorkspaceComparison,
  plan: SyncExecutionPlan,
  localNotes: Note[],
  localFolders: Folder[],
  options: {
    settingsMode?: SyncSettingsMode;
    localSettings?: AppSettings;
    onApplyLocalImport: (payload: {
      upsertNotes: Note[];
      upsertFolders: Folder[];
      deleteNoteIds?: string[];
      deleteFolderIds?: string[];
      settings?: AppSettings | null;
    }) => void;
    onProgress?: (p: CloudTransferProgress) => void;
    signal?: AbortSignal;
  }
): Promise<SyncExecutionResult> {
  const settingsMode = options.settingsMode ?? 'none';

  const downloadNoteCount =
    plan.downloadNewNoteIds.length +
    plan.downloadUpdateNoteIds.length +
    plan.downloadConflictRemoteNoteIds.length +
    plan.keepBothConflictNoteIds.length;
  const downloadFolderCount =
    plan.downloadNewFolderIds.length +
    plan.downloadUpdateFolderIds.length +
    plan.downloadConflictRemoteFolderIds.length;
  const deleteLocalNoteIds = [...plan.deleteLocalNoteIds, ...plan.deleteLocalConflictNoteIds];
  const deleteLocalFolderIds = [...plan.deleteLocalFolderIds, ...plan.deleteLocalConflictFolderIds];

  const shouldDownload =
    downloadNoteCount > 0 ||
    downloadFolderCount > 0 ||
    Boolean(settingsMode === 'download' && comparison.manifest?.settings);

  const deleteRemoteNoteIds = [...plan.deleteRemoteNoteIds, ...plan.deleteRemoteConflictNoteIds];
  const deleteRemoteFolderIds = [
    ...plan.deleteRemoteFolderIds,
    ...plan.deleteRemoteConflictFolderIds,
  ];

  const baseUploadNoteCount =
    plan.uploadNewNoteIds.length +
    plan.uploadUpdateNoteIds.length +
    plan.uploadConflictLocalNoteIds.length +
    plan.keepBothConflictNoteIds.length * 2;
  const uploadFolderCount =
    plan.uploadNewFolderIds.length +
    plan.uploadUpdateFolderIds.length +
    plan.uploadConflictLocalFolderIds.length;
  const shouldUpload =
    baseUploadNoteCount > 0 ||
    uploadFolderCount > 0 ||
    deleteRemoteNoteIds.length > 0 ||
    deleteRemoteFolderIds.length > 0 ||
    settingsMode === 'upload';

  const totalSteps = Math.max(
    1,
    downloadNoteCount + baseUploadNoteCount + deleteRemoteNoteIds.length + (shouldUpload ? 1 : 0)
  );

  let downloadedNotes = 0;
  let copiedConflictNotes = 0;
  let downloadedBlobs = 0;
  let reusedLocalBlobs = 0;
  let downloadedFolders = 0;
  let bytesDownloaded = 0;
  let deletedLocalNotes = 0;
  let deletedLocalFolders = 0;

  let uploadedNotes = 0;
  let uploadedBlobs = 0;
  let reusedRemoteBlobs = 0;
  let uploadedFolders = 0;
  let deletedRemoteNotes = 0;
  let deletedRemoteFolders = 0;
  let bytesUploaded = 0;
  let cancelled = false;

  // Working copies of local workspace so Phase 2 sees copies & folder updates from Phase 1
  const workingNoteMap = new Map(localNotes.map((n) => [n.id, n]));
  const workingFolderMap = new Map(localFolders.map((f) => [f.id, f]));
  const createdCopyNoteIds: string[] = [];

  // ==================== PHASE 1: DOWNLOAD & LOCAL DELETIONS (Online -> Lokal) ====================
  let pendingUpsertNotes: Note[] = [];
  let pendingUpsertFolders: Folder[] = [];
  let pendingSettings: AppSettings | null = null;

  if (shouldDownload) {
    const importSubPlan: ImportExecutionPlan = {
      newNoteIds: plan.downloadNewNoteIds,
      updateNoteIds: plan.downloadUpdateNoteIds,
      replaceLocalNoteIds: plan.downloadConflictRemoteNoteIds,
      copyNoteIds: plan.keepBothConflictNoteIds,
      skippedConflictNoteIds: [],
      unchangedNoteIds: plan.unchangedNoteIds,
      newFolderIds: plan.downloadNewFolderIds,
      updateFolderIds: plan.downloadUpdateFolderIds,
      replaceLocalFolderIds: plan.downloadConflictRemoteFolderIds,
      skippedConflictFolderIds: [],
      estimatedDownloadBytes: plan.estimatedDownloadBytes,
      downloadBlobCount: plan.downloadNewBlobCount,
      reusedLocalBlobCount: plan.downloadReusedLocalBlobCount,
    };

    const directDownloadIds = new Set([
      ...plan.downloadNewNoteIds,
      ...plan.downloadUpdateNoteIds,
      ...plan.downloadConflictRemoteNoteIds,
    ]);

    const importRes = await executeCloudImport(config, comparison, importSubPlan, localNotes, {
      importSettings: settingsMode === 'download',
      signal: options.signal,
      onProgress: (p) => {
        if (p.phase === 'finalizing' && shouldUpload) return;
        options.onProgress?.({
          ...p,
          current: Math.min(downloadNoteCount, p.current),
          total: totalSteps,
          bytesTransferred: p.bytesTransferred,
        });
      },
    });

    downloadedNotes = importRes.importedCount;
    copiedConflictNotes = importRes.copiedCount;
    downloadedBlobs = importRes.downloadedBlobs;
    reusedLocalBlobs = importRes.reusedLocalBlobs;
    downloadedFolders = importRes.upsertFolders.length;
    bytesDownloaded = importRes.bytesDownloaded;
    cancelled = importRes.cancelled;

    pendingUpsertNotes = importRes.upsertNotes;
    pendingUpsertFolders = importRes.upsertFolders;
    pendingSettings = importRes.settings;

    for (const f of importRes.upsertFolders) {
      workingFolderMap.set(f.id, f);
    }
    for (const n of importRes.upsertNotes) {
      workingNoteMap.set(n.id, n);
      if (!directDownloadIds.has(n.id)) {
        createdCopyNoteIds.push(n.id);
      }
    }
  }

  const effectiveDeleteLocalNotes = cancelled ? [] : deleteLocalNoteIds;
  const effectiveDeleteLocalFolders = cancelled ? [] : deleteLocalFolderIds;

  if (
    pendingUpsertNotes.length > 0 ||
    pendingUpsertFolders.length > 0 ||
    effectiveDeleteLocalNotes.length > 0 ||
    effectiveDeleteLocalFolders.length > 0 ||
    pendingSettings
  ) {
    options.onApplyLocalImport({
      upsertNotes: pendingUpsertNotes,
      upsertFolders: pendingUpsertFolders,
      deleteNoteIds: effectiveDeleteLocalNotes,
      deleteFolderIds: effectiveDeleteLocalFolders,
      settings: pendingSettings,
    });

    deletedLocalNotes = effectiveDeleteLocalNotes.length;
    deletedLocalFolders = effectiveDeleteLocalFolders.length;

    if (effectiveDeleteLocalNotes.length > 0 || effectiveDeleteLocalFolders.length > 0) {
      const baseline = loadCloudBaseline(config);
      for (const id of effectiveDeleteLocalNotes) {
        delete baseline.notes[id];
        workingNoteMap.delete(id);
      }
      for (const fid of effectiveDeleteLocalFolders) {
        delete baseline.folders[fid];
        workingFolderMap.delete(fid);
      }
      saveCloudBaseline(config, baseline);
      clearLocalDeletions(effectiveDeleteLocalNotes, effectiveDeleteLocalFolders);
    }
  }

  // ==================== PHASE 2: UPLOAD & REMOTE DELETIONS (Lokal -> Online) ====================
  if (!cancelled && shouldUpload) {
    const backupSubPlan: BackupExecutionPlan = {
      newNoteIds: [...createdCopyNoteIds, ...plan.uploadNewNoteIds],
      updateNoteIds: plan.uploadUpdateNoteIds,
      overwriteRemoteNoteIds: [
        ...plan.uploadConflictLocalNoteIds,
        ...(createdCopyNoteIds.length > 0 ? plan.keepBothConflictNoteIds : []),
      ],
      skippedConflictNoteIds: [],
      unchangedNoteIds: plan.unchangedNoteIds,
      newFolderIds: plan.uploadNewFolderIds,
      updateFolderIds: plan.uploadUpdateFolderIds,
      overwriteRemoteFolderIds: plan.uploadConflictLocalFolderIds,
      skippedConflictFolderIds: [],
      estimatedUploadBytes: plan.estimatedUploadBytes,
      newBlobCount: plan.uploadNewBlobCount,
      reusedBlobCount: plan.uploadReusedRemoteBlobCount,
    };

    const backupRes = await executeCloudBackup(
      config,
      comparison,
      backupSubPlan,
      [...workingNoteMap.values()],
      [...workingFolderMap.values()],
      {
        includeSettings: settingsMode === 'upload',
        settings: options.localSettings,
        deleteRemoteNoteIds,
        deleteRemoteFolderIds,
        signal: options.signal,
        onProgress: (p) => {
          options.onProgress?.({
            ...p,
            current: Math.min(totalSteps, downloadNoteCount + p.current),
            total: totalSteps,
            bytesTransferred: bytesDownloaded + p.bytesTransferred,
          });
        },
      }
    );

    uploadedNotes = backupRes.uploadedNotes;
    uploadedBlobs = backupRes.uploadedBlobs;
    reusedRemoteBlobs = backupRes.reusedBlobs;
    uploadedFolders = backupRes.updatedFolders;
    deletedRemoteNotes = backupRes.deletedNotes;
    deletedRemoteFolders = backupRes.deletedFolders;
    bytesUploaded = backupRes.bytesUploaded;
    cancelled = backupRes.cancelled;
  }

  // Record unified lastSyncAt timestamp in baseline
  if (
    downloadedNotes > 0 ||
    copiedConflictNotes > 0 ||
    downloadedFolders > 0 ||
    deletedLocalNotes > 0 ||
    deletedLocalFolders > 0 ||
    uploadedNotes > 0 ||
    uploadedFolders > 0 ||
    deletedRemoteNotes > 0 ||
    deletedRemoteFolders > 0 ||
    settingsMode !== 'none'
  ) {
    const baseline = loadCloudBaseline(config);
    baseline.lastSyncAt = Date.now();
    saveCloudBaseline(config, baseline);
  }

  options.onProgress?.({
    phase: 'finalizing',
    label: cancelled
      ? 'Synchronisierung pausiert (Fortschritt gesichert)'
      : 'Synchronisierung abgeschlossen',
    current: totalSteps,
    total: totalSteps,
    bytesTransferred: bytesDownloaded + bytesUploaded,
  });

  return {
    uploadedNotes,
    uploadedBlobs,
    reusedRemoteBlobs,
    uploadedFolders,
    bytesUploaded,
    downloadedNotes,
    copiedConflictNotes,
    downloadedBlobs,
    reusedLocalBlobs,
    downloadedFolders,
    bytesDownloaded,
    deletedLocalNotes,
    deletedLocalFolders,
    deletedRemoteNotes,
    deletedRemoteFolders,
    cancelled,
  };
}
