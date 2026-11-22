import type { AppSettings, Folder, Note } from '../types';
import {
  getCloudBucketFingerprint,
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

export interface CloudManifest {
  version: number;
  updatedAt: number;
  folders: Record<string, CloudManifestFolderEntry>;
  notes: Record<string, CloudManifestNoteEntry>;
  blobs: Record<string, CloudBlobMeta>;
  settings?: AppSettings;
}

export interface CloudSyncBaseline {
  notes: Record<string, { contentHash: string; syncedAt: number }>;
  folders: Record<string, { folderHash: string; syncedAt: number }>;
  lastBackupAt?: number;
  lastImportAt?: number;
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
  | 'conflict';

export type FolderDiffStatus =
  | 'synced'
  | 'local-only'
  | 'remote-only'
  | 'local-ahead'
  | 'remote-ahead'
  | 'conflict';

export type BackupConflictResolution = 'skip' | 'overwrite-remote';
export type ImportConflictResolution = 'keep-local' | 'use-remote' | 'keep-both';
export type FolderConflictResolution = 'keep-target' | 'overwrite-target';

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

export async function compressJsonPayload(obj: unknown): Promise<{
  bytes: Uint8Array;
  compressed: boolean;
}> {
  const rawBytes = textEncoder.encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') {
    return { bytes: rawBytes, compressed: false };
  }
  try {
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(rawBytes.byteLength);
    copy.set(rawBytes);
    await writer.write(copy);
    await writer.close();
    const compressedBuf = await new Response(cs.readable).arrayBuffer();
    return { bytes: new Uint8Array(compressedBuf), compressed: true };
  } catch {
    return { bytes: rawBytes, compressed: false };
  }
}

export async function decompressJsonPayload<T>(bytes: Uint8Array): Promise<T> {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await writer.write(copy);
    await writer.close();
    const plainBuf = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(textDecoder.decode(plainBuf)) as T;
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
    ...(parsed.settings ? { settings: normalizeAppSettings(parsed.settings) } : {}),
  };
}

function classify3Way(
  localHash: string | undefined,
  remoteHash: string | undefined,
  baseHash: string | undefined
): NoteDiffStatus {
  if (localHash && !remoteHash) return 'local-only';
  if (!localHash && remoteHash) return 'remote-only';
  if (!localHash && !remoteHash) return 'synced';
  if (localHash === remoteHash) return 'synced';
  if (baseHash) {
    if (remoteHash === baseHash && localHash !== baseHash) return 'local-ahead';
    if (localHash === baseHash && remoteHash !== baseHash) return 'remote-ahead';
  }
  return 'conflict';
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
      status: classify3Way(local?.contentHash, remote?.contentHash, baseHash),
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
      status: classify3Way(local?.folderHash, remote?.folderHash, baseHash),
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

  // Fetch freshest remote manifest right before writing so concurrent devices don't lose entries
  const latestRemote = (await fetchRemoteManifest(config, options.signal)) ?? comparison.manifest;
  const mergedManifest: CloudManifest = {
    version: CLOUD_MANIFEST_VERSION,
    updatedAt: Date.now(),
    folders: { ...(latestRemote?.folders ?? {}) },
    notes: { ...(latestRemote?.notes ?? {}) },
    blobs: { ...(latestRemote?.blobs ?? {}) },
    ...(latestRemote?.settings ? { settings: latestRemote.settings } : {}),
  };

  const baseline = loadCloudBaseline(config);
  const knownRemoteBlobs = new Set(comparison.remoteBlobKeys);

  let uploadedNotes = 0;
  let uploadedBlobs = 0;
  let reusedBlobs = 0;
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
    baseline.folders[fid] = { folderHash, syncedAt: Date.now() };
    updatedFolders++;
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

  const totalSteps = Math.max(1, noteIdsToUpload.length + 1);

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

  if (uploadedNotes > 0 || updatedFolders > 0 || (!cancelled && options.includeSettings)) {
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
    } else if (cmp.status === 'remote-only') {
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
    if (cmp.status === 'remote-only') {
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
