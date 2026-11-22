import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, untrack } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  buildBackupPlan,
  buildImportPlan,
  compareWithCloud,
  executeCloudBackup,
  executeCloudImport,
  loadCloudBaseline,
  type BackupConflictResolution,
  type CloudTransferProgress,
  type CloudWorkspaceComparison,
  type FolderConflictResolution,
  type ImportConflictResolution,
  type NoteComparison,
} from '../utils/cloudSync';
import {
  buildB2CorsRulesJson,
  buildR2CorsPolicyJson,
  clearCloudConfig,
  DEFAULT_CLOUD_CONFIG,
  inferRegionFromEndpoint,
  isCloudConfigComplete,
  loadCloudConfig,
  normalizeCloudConfig,
  saveCloudConfig,
  testCloudConnection,
  type CloudProviderPreset,
  type CloudSyncConfig,
} from '../utils/s3Client';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCloud,
  IconCloudDownload,
  IconCloudUpload,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconFolder,
  IconRefreshCw,
  IconSearch,
  IconSettings,
  IconTrash,
  IconX,
} from './Icons';

export type CloudSyncTab = 'backup' | 'import' | 'setup';
type SelectionScope = 'all' | 'custom';

interface CloudBackupDialogProps {
  store: NotesStore;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatShortDate(ts?: number): string {
  if (!ts) return '–';
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '–';
  }
}

export function CloudBackupDialog(props: CloudBackupDialogProps) {
  const isOpen = () => props.store.cloudSyncOpen();
  const activeTab = () => props.store.cloudSyncTab();

  // Config form state
  const [configDraft, setConfigDraft] = createSignal<CloudSyncConfig>(
    loadCloudConfig() ?? { ...DEFAULT_CLOUD_CONFIG }
  );
  const [showSecret, setShowSecret] = createSignal(false);
  const [showCorsHelp, setShowCorsHelp] = createSignal(false);
  const [testingConn, setTestingConn] = createSignal(false);
  const [connTestResult, setConnTestResult] = createSignal<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Comparison & sync state
  const [comparison, setComparison] = createSignal<CloudWorkspaceComparison | null>(null);
  const [isAnalyzing, setIsAnalyzing] = createSignal(false);
  const [analyzeError, setAnalyzeError] = createSignal<string | null>(null);

  // Scope & selection state
  const [scope, setScope] = createSignal<SelectionScope>('all');
  const [selectedNoteIds, setSelectedNoteIds] = createSignal<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = createSignal<Set<string>>(new Set());
  const [collapsedFolders, setCollapsedFolders] = createSignal<Set<string>>(new Set());
  const [treeSearch, setTreeSearch] = createSignal('');
  const [includeSettings, setIncludeSettings] = createSignal(false);

  // Conflict resolution state
  const [backupConflicts, setBackupConflicts] = createSignal<
    Record<string, BackupConflictResolution>
  >({});
  const [importConflicts, setImportConflicts] = createSignal<
    Record<string, ImportConflictResolution>
  >({});
  const [folderConflicts, setFolderConflicts] = createSignal<
    Record<string, FolderConflictResolution>
  >({});

  // Transfer execution state
  const [isRunning, setIsRunning] = createSignal(false);
  const [progress, setProgress] = createSignal<CloudTransferProgress | null>(null);
  const [lastResultMessage, setLastResultMessage] = createSignal<string | null>(null);
  const [runError, setRunError] = createSignal<string | null>(null);

  let activeAbort: AbortController | null = null;

  const savedConfig = createMemo(() => {
    // Re-evaluate when modal opens or config changes
    props.store.cloudConfigVersion();
    return loadCloudConfig();
  });

  const isConfigured = createMemo(() => isCloudConfigComplete(savedConfig()));

  const providerLabel = (p: CloudProviderPreset) =>
    p === 'r2' ? 'Cloudflare R2' : p === 'b2' ? 'Backblaze B2' : 'S3';

  const cancelOngoing = () => {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
  };

  onCleanup(() => {
    cancelOngoing();
  });

  const selectAllForTab = (tab: 'backup' | 'import', cmp: CloudWorkspaceComparison) => {
    const nextNotes = new Set<string>();
    const nextFolders = new Set<string>();
    if (tab === 'backup') {
      for (const n of props.store.notes()) nextNotes.add(n.id);
      for (const f of props.store.folders()) nextFolders.add(f.id);
    } else {
      for (const [id, entry] of cmp.notesById) {
        if (entry.remote) nextNotes.add(id);
      }
      for (const [id, entry] of cmp.foldersById) {
        if (entry.remote) nextFolders.add(id);
      }
    }
    setSelectedNoteIds(nextNotes);
    setSelectedFolderIds(nextFolders);
  };

  const selectOnlyChangedForTab = (tab: 'backup' | 'import', cmp: CloudWorkspaceComparison) => {
    const nextNotes = new Set<string>();
    const nextFolders = new Set<string>();
    if (tab === 'backup') {
      for (const [id, entry] of cmp.notesById) {
        if (entry.local && entry.status !== 'synced') {
          nextNotes.add(id);
        }
      }
      for (const [id, entry] of cmp.foldersById) {
        if (entry.local && entry.status !== 'synced') {
          nextFolders.add(id);
        }
      }
    } else {
      for (const [id, entry] of cmp.notesById) {
        if (entry.remote && entry.status !== 'synced') {
          nextNotes.add(id);
        }
      }
      for (const [id, entry] of cmp.foldersById) {
        if (entry.remote && entry.status !== 'synced') {
          nextFolders.add(id);
        }
      }
    }
    setSelectedNoteIds(nextNotes);
    setSelectedFolderIds(nextFolders);
  };

  const runComparison = async () => {
    const cfg = savedConfig();
    if (!cfg || !isCloudConfigComplete(cfg)) {
      setComparison(null);
      return;
    }
    cancelOngoing();
    const ctrl = new AbortController();
    activeAbort = ctrl;
    setIsAnalyzing(true);
    setAnalyzeError(null);
    setRunError(null);
    setProgress(null);

    try {
      const cmp = await compareWithCloud(
        cfg,
        props.store.notes(),
        props.store.folders(),
        (p) => setProgress(p),
        ctrl.signal
      );
      if (ctrl.signal.aborted) return;
      setComparison(cmp);
      const tab = activeTab();
      if (tab === 'backup' || tab === 'import') {
        if (scope() === 'all') {
          selectAllForTab(tab, cmp);
        } else {
          // Prune stale IDs if needed
          selectOnlyChangedForTab(tab, cmp);
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setAnalyzeError(
        err instanceof Error ? err.message : 'Fehler beim Abgleich mit dem Cloud-Bucket.'
      );
    } finally {
      if (activeAbort === ctrl) activeAbort = null;
      setIsAnalyzing(false);
    }
  };

  // Initialize state ONLY when modal transitions open/closed (not on tab switches)
  createEffect(
    on(isOpen, (open) => {
      if (!open) {
        cancelOngoing();
        setIsRunning(false);
        setIsAnalyzing(false);
        return;
      }
      const existing = loadCloudConfig();
      setConfigDraft(existing ? { ...existing } : { ...DEFAULT_CLOUD_CONFIG });
      setConnTestResult(null);
      setLastResultMessage(null);
      setRunError(null);
      setAnalyzeError(null);
      setTreeSearch('');
      setBackupConflicts({});
      setImportConflicts({});
      setFolderConflicts({});
      setIncludeSettings(false);
      setScope('all');

      const tab = untrack(() => activeTab());
      if (!isCloudConfigComplete(existing)) {
        if (tab !== 'setup') {
          props.store.setCloudSyncTab('setup');
        }
      } else if (tab !== 'setup') {
        void runComparison();
      }
    })
  );

  // Re-initialize selection when switching between Backup & Import tabs
  createEffect(
    on(activeTab, (tab) => {
      if (!untrack(() => isOpen()) || (tab !== 'backup' && tab !== 'import')) return;
      const cmp = untrack(() => comparison());
      setLastResultMessage(null);
      setRunError(null);
      if (!cmp && untrack(() => isConfigured()) && !untrack(() => isAnalyzing())) {
        void runComparison();
        return;
      }
      if (cmp && untrack(() => scope()) === 'all') {
        selectAllForTab(tab, cmp);
      } else if (cmp) {
        const validNotes = new Set<string>();
        const validFolders = new Set<string>();
        for (const id of untrack(() => selectedNoteIds())) {
          const entry = cmp.notesById.get(id);
          if (tab === 'backup' ? entry?.local : entry?.remote) validNotes.add(id);
        }
        for (const id of untrack(() => selectedFolderIds())) {
          const entry = cmp.foldersById.get(id);
          if (tab === 'backup' ? entry?.local : entry?.remote) validFolders.add(id);
        }
        if (validNotes.size === 0 && validFolders.size === 0) {
          selectAllForTab(tab, cmp);
        } else {
          setSelectedNoteIds(validNotes);
          setSelectedFolderIds(validFolders);
        }
      }
    })
  );

  // ==================== Tree Data for Active Tab ====================

  interface TreeFolderNode {
    id: string;
    name: string;
    color: string;
    parentId: string | null;
    status: string;
  }

  interface TreeNoteNode {
    id: string;
    title: string;
    folderId: string | null;
    pageCount: number;
    updatedAt: number;
    sizeBytes: number;
    transferHintBytes: number;
    comparison: NoteComparison;
  }

  const tabFolders = createMemo<TreeFolderNode[]>(() => {
    const cmp = comparison();
    const tab = activeTab();
    if (!cmp || (tab !== 'backup' && tab !== 'import')) return [];
    const list: TreeFolderNode[] = [];
    for (const entry of cmp.foldersById.values()) {
      if (tab === 'backup' && entry.local) {
        list.push({
          id: entry.id,
          name: entry.local.name,
          color: entry.local.color,
          parentId: entry.local.parentId,
          status: entry.status,
        });
      } else if (tab === 'import' && entry.remote) {
        list.push({
          id: entry.id,
          name: entry.remote.name,
          color: entry.remote.color,
          parentId: entry.remote.parentId,
          status: entry.status,
        });
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });

  const tabNotes = createMemo<TreeNoteNode[]>(() => {
    const cmp = comparison();
    const tab = activeTab();
    if (!cmp || (tab !== 'backup' && tab !== 'import')) return [];

    // Local blob set for import transfer hints
    const localBlobSet = new Set<string>();
    if (tab === 'import') {
      for (const entry of cmp.notesById.values()) {
        if (entry.local) {
          for (const h of entry.local.blobHashes) localBlobSet.add(h);
        }
      }
    }

    const list: TreeNoteNode[] = [];
    for (const entry of cmp.notesById.values()) {
      if (tab === 'backup' && entry.local) {
        const missingBlobBytes = entry.local.blobHashes.reduce(
          (sum, h) =>
            cmp.remoteBlobKeys.has(h) ? sum : sum + (entry.local!.blobMeta[h]?.size ?? 0),
          0
        );
        list.push({
          id: entry.id,
          title: entry.local.title.trim() || 'Unbenannte Notiz',
          folderId: entry.local.folderId,
          pageCount: entry.local.pageCount,
          updatedAt: entry.local.updatedAt,
          sizeBytes: entry.local.estimatedNoteBytes + entry.local.totalBlobBytes,
          transferHintBytes:
            entry.status === 'synced'
              ? 0
              : entry.local.estimatedNoteBytes + missingBlobBytes,
          comparison: entry,
        });
      } else if (tab === 'import' && entry.remote) {
        const missingBlobBytes = entry.remote.blobHashes.reduce(
          (sum, h) =>
            localBlobSet.has(h) ? sum : sum + (cmp.manifest?.blobs[h]?.size ?? 0),
          0
        );
        list.push({
          id: entry.id,
          title: entry.remote.title.trim() || 'Unbenannte Notiz',
          folderId: entry.remote.folderId,
          pageCount: entry.remote.pageCount,
          updatedAt: entry.remote.updatedAt,
          sizeBytes: entry.remote.noteBytes + entry.remote.totalBlobBytes,
          transferHintBytes:
            entry.status === 'synced'
              ? 0
              : entry.remote.noteBytes + missingBlobBytes,
          comparison: entry,
        });
      }
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  });

  const folderMap = createMemo(() => new Map(tabFolders().map((f) => [f.id, f])));

  const getFolderBreadcrumb = (folderId: string | null): string => {
    if (!folderId) return 'Ohne Ordner';
    const map = folderMap();
    const parts: string[] = [];
    let curr: string | null = folderId;
    let guard = 0;
    while (curr && guard < 16) {
      const f = map.get(curr);
      if (!f) break;
      parts.unshift(f.name);
      curr = f.parentId;
      guard++;
    }
    return parts.length > 0 ? parts.join(' / ') : 'Ohne Ordner';
  };

  const searchLower = () => treeSearch().trim().toLowerCase();

  const noteMatchesSearch = (n: TreeNoteNode) => {
    const q = searchLower();
    if (!q) return true;
    return (
      n.title.toLowerCase().includes(q) ||
      getFolderBreadcrumb(n.folderId).toLowerCase().includes(q)
    );
  };

  const getDescendantFolderIds = (rootId: string): string[] => {
    const out: string[] = [rootId];
    const folders = tabFolders();
    const stack = [rootId];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      for (const f of folders) {
        if (f.parentId === curr && !out.includes(f.id)) {
          out.push(f.id);
          stack.push(f.id);
        }
      }
    }
    return out;
  };

  const getNotesUnderFolder = (folderId: string): TreeNoteNode[] => {
    const fIds = new Set(getDescendantFolderIds(folderId));
    return tabNotes().filter((n) => n.folderId && fIds.has(n.folderId));
  };

  const getFolderCheckState = (folderId: string): 'checked' | 'unchecked' | 'partial' => {
    const subNotes = getNotesUnderFolder(folderId);
    const selNotes = selectedNoteIds();
    const selFolders = selectedFolderIds();
    if (subNotes.length === 0) {
      return selFolders.has(folderId) ? 'checked' : 'unchecked';
    }
    let count = 0;
    for (const n of subNotes) {
      if (selNotes.has(n.id)) count++;
    }
    if (count === 0) return selFolders.has(folderId) ? 'partial' : 'unchecked';
    if (count === subNotes.length) return 'checked';
    return 'partial';
  };

  const toggleFolderSelection = (folderId: string) => {
    setScope('custom');
    const state = getFolderCheckState(folderId);
    const shouldCheck = state !== 'checked';
    const descFolders = getDescendantFolderIds(folderId);
    const subNotes = getNotesUnderFolder(folderId);

    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      for (const id of descFolders) {
        if (shouldCheck) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      for (const n of subNotes) {
        if (shouldCheck) next.add(n.id);
        else next.delete(n.id);
      }
      return next;
    });
  };

  const toggleNoteSelection = (noteId: string) => {
    setScope('custom');
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  // ==================== Plans & Conflicts ====================

  const backupPlan = createMemo(() => {
    const cmp = comparison();
    if (!cmp || activeTab() !== 'backup') return null;
    return buildBackupPlan(
      cmp,
      selectedNoteIds(),
      selectedFolderIds(),
      backupConflicts(),
      folderConflicts()
    );
  });

  const importPlan = createMemo(() => {
    const cmp = comparison();
    if (!cmp || activeTab() !== 'import') return null;
    return buildImportPlan(
      cmp,
      selectedNoteIds(),
      selectedFolderIds(),
      importConflicts(),
      folderConflicts()
    );
  });

  const conflictingSelectedNotes = createMemo(() => {
    const cmp = comparison();
    const tab = activeTab();
    if (!cmp || (tab !== 'backup' && tab !== 'import')) return [];
    const sel = selectedNoteIds();
    const out: NoteComparison[] = [];
    for (const id of sel) {
      const entry = cmp.notesById.get(id);
      if (!entry) continue;
      if (tab === 'backup' && (entry.status === 'conflict' || entry.status === 'remote-ahead')) {
        out.push(entry);
      } else if (
        tab === 'import' &&
        (entry.status === 'conflict' || entry.status === 'local-ahead')
      ) {
        out.push(entry);
      }
    }
    return out;
  });

  const conflictingRequiredFolders = createMemo(() => {
    const cmp = comparison();
    const tab = activeTab();
    if (!cmp || (tab !== 'backup' && tab !== 'import')) return [];
    const plan = tab === 'backup' ? backupPlan() : importPlan();
    if (!plan) return [];
    const ids =
      tab === 'backup'
        ? [
            ...(plan as ReturnType<typeof buildBackupPlan>).overwriteRemoteFolderIds,
            ...(plan as ReturnType<typeof buildBackupPlan>).skippedConflictFolderIds,
          ]
        : [
            ...(plan as ReturnType<typeof buildImportPlan>).replaceLocalFolderIds,
            ...(plan as ReturnType<typeof buildImportPlan>).skippedConflictFolderIds,
          ];
    return ids
      .map((id) => cmp.foldersById.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  });

  // Explicit list of items that will be overwritten/replaced
  const replacedItemsSummary = createMemo(() => {
    const cmp = comparison();
    const tab = activeTab();
    if (!cmp || (tab !== 'backup' && tab !== 'import')) {
      return { notes: [] as { id: string; title: string; kind: 'update' | 'conflict' }[], folders: [] as { id: string; name: string; kind: 'update' | 'conflict' }[] };
    }
    if (tab === 'backup') {
      const p = backupPlan();
      if (!p) return { notes: [], folders: [] };
      const notes = [
        ...p.overwriteRemoteNoteIds.map((id) => ({
          id,
          title: cmp.notesById.get(id)?.local?.title.trim() || 'Unbenannte Notiz',
          kind: 'conflict' as const,
        })),
        ...p.updateNoteIds.map((id) => ({
          id,
          title: cmp.notesById.get(id)?.local?.title.trim() || 'Unbenannte Notiz',
          kind: 'update' as const,
        })),
      ];
      const folders = [
        ...p.overwriteRemoteFolderIds.map((id) => ({
          id,
          name: cmp.foldersById.get(id)?.local?.name || 'Ordner',
          kind: 'conflict' as const,
        })),
        ...p.updateFolderIds.map((id) => ({
          id,
          name: cmp.foldersById.get(id)?.local?.name || 'Ordner',
          kind: 'update' as const,
        })),
      ];
      return { notes, folders };
    } else {
      const p = importPlan();
      if (!p) return { notes: [], folders: [] };
      const notes = [
        ...p.replaceLocalNoteIds.map((id) => ({
          id,
          title: cmp.notesById.get(id)?.remote?.title.trim() || 'Unbenannte Notiz',
          kind: 'conflict' as const,
        })),
        ...p.updateNoteIds.map((id) => ({
          id,
          title: cmp.notesById.get(id)?.remote?.title.trim() || 'Unbenannte Notiz',
          kind: 'update' as const,
        })),
      ];
      const folders = [
        ...p.replaceLocalFolderIds.map((id) => ({
          id,
          name: cmp.foldersById.get(id)?.remote?.name || 'Ordner',
          kind: 'conflict' as const,
        })),
        ...p.updateFolderIds.map((id) => ({
          id,
          name: cmp.foldersById.get(id)?.remote?.name || 'Ordner',
          kind: 'update' as const,
        })),
      ];
      return { notes, folders };
    }
  });

  const canExecuteAction = createMemo(() => {
    if (isRunning() || isAnalyzing()) return false;
    if (activeTab() === 'backup') {
      const p = backupPlan();
      if (!p) return false;
      return (
        p.newNoteIds.length +
          p.updateNoteIds.length +
          p.overwriteRemoteNoteIds.length +
          p.newFolderIds.length +
          p.updateFolderIds.length +
          p.overwriteRemoteFolderIds.length >
          0 || includeSettings()
      );
    }
    if (activeTab() === 'import') {
      const p = importPlan();
      if (!p) return false;
      return (
        p.newNoteIds.length +
          p.updateNoteIds.length +
          p.replaceLocalNoteIds.length +
          p.copyNoteIds.length +
          p.newFolderIds.length +
          p.updateFolderIds.length +
          p.replaceLocalFolderIds.length >
          0 || Boolean(includeSettings() && comparison()?.manifest?.settings)
      );
    }
    return false;
  });

  // ==================== Actions ====================

  const handleRunBackup = async () => {
    const cfg = savedConfig();
    const cmp = comparison();
    const plan = backupPlan();
    if (!cfg || !cmp || !plan) return;

    cancelOngoing();
    const ctrl = new AbortController();
    activeAbort = ctrl;
    setIsRunning(true);
    setRunError(null);
    setLastResultMessage(null);

    try {
      const res = await executeCloudBackup(
        cfg,
        cmp,
        plan,
        props.store.notes(),
        props.store.folders(),
        {
          includeSettings: includeSettings(),
          settings: props.store.settings(),
          onProgress: (p) => setProgress(p),
          signal: ctrl.signal,
        }
      );

      const summary = res.cancelled
        ? `Backup pausiert — ${res.uploadedNotes} Notiz(en) & ${res.uploadedBlobs} Medien bereits gesichert (${formatBytes(res.bytesUploaded)}).`
        : `Backup fertig: ${res.uploadedNotes} Notiz(en), ${res.updatedFolders} Ordner, ${res.uploadedBlobs} neue Medien (${formatBytes(res.bytesUploaded)})${res.reusedBlobs > 0 ? ` · ${res.reusedBlobs} Medien wiederverwendet` : ''}.`;
      setLastResultMessage(summary);
      props.store.bumpCloudConfigVersion();
      props.store.showToast(
        res.cancelled ? 'Online-Backup pausiert' : 'Online-Backup erfolgreich'
      );
      await runComparison();
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : 'Fehler beim Online-Backup.'
      );
    } finally {
      if (activeAbort === ctrl) activeAbort = null;
      setIsRunning(false);
    }
  };

  const handleRunImport = async () => {
    const cfg = savedConfig();
    const cmp = comparison();
    const plan = importPlan();
    if (!cfg || !cmp || !plan) return;

    cancelOngoing();
    const ctrl = new AbortController();
    activeAbort = ctrl;
    setIsRunning(true);
    setRunError(null);
    setLastResultMessage(null);

    try {
      const res = await executeCloudImport(
        cfg,
        cmp,
        plan,
        props.store.notes(),
        {
          importSettings: includeSettings(),
          onProgress: (p) => setProgress(p),
          signal: ctrl.signal,
        }
      );

      if (res.upsertNotes.length > 0 || res.upsertFolders.length > 0 || res.settings) {
        props.store.applyCloudImport({
          upsertNotes: res.upsertNotes,
          upsertFolders: res.upsertFolders,
          settings: res.settings,
        });
      }

      const summary = res.cancelled
        ? `Import abgebrochen — ${res.importedCount + res.copiedCount} Notiz(en) bereits übernommen.`
        : `Import fertig: ${res.importedCount} Notiz(en) übernommen${res.copiedCount > 0 ? `, ${res.copiedCount} als Kopie` : ''}${res.upsertFolders.length > 0 ? `, ${res.upsertFolders.length} Ordner` : ''} (${formatBytes(res.bytesDownloaded)})${res.reusedLocalBlobs > 0 ? ` · ${res.reusedLocalBlobs} lokale Medien wiederverwendet` : ''}.`;
      setLastResultMessage(summary);
      props.store.bumpCloudConfigVersion();
      props.store.showToast(
        res.cancelled ? 'Online-Import abgebrochen' : 'Online-Import erfolgreich'
      );
      await runComparison();
    } catch (err) {
      setRunError(
        err instanceof Error ? err.message : 'Fehler beim Online-Import.'
      );
    } finally {
      if (activeAbort === ctrl) activeAbort = null;
      setIsRunning(false);
    }
  };

  // ==================== Config Form Actions ====================

  const updateDraft = (patch: Partial<CloudSyncConfig>) => {
    setConfigDraft((prev) => {
      const next = { ...prev, ...patch };
      if (patch.provider) {
        if (patch.provider === 'r2') {
          next.region = 'auto';
        } else if (patch.provider === 'b2') {
          next.region = inferRegionFromEndpoint(next.endpoint, 'b2');
        }
      }
      if (patch.endpoint !== undefined && prev.provider !== 'custom') {
        const inferred = inferRegionFromEndpoint(patch.endpoint, next.provider);
        if (inferred) next.region = inferred;
      }
      return next;
    });
    setConnTestResult(null);
  };

  const handleTestConnection = async () => {
    const normalized = normalizeCloudConfig(configDraft());
    setConfigDraft(normalized);
    setTestingConn(true);
    setConnTestResult(null);
    const result = await testCloudConnection(normalized);
    setConnTestResult({ ok: result.ok, message: result.message });
    setTestingConn(false);
  };

  const handleSaveConfig = () => {
    const normalized = normalizeCloudConfig(configDraft());
    if (!isCloudConfigComplete(normalized)) {
      setConnTestResult({
        ok: false,
        message: 'Bitte Endpoint, Bucket, Region, Access Key ID und Secret Access Key ausfüllen.',
      });
      return;
    }
    saveCloudConfig(normalized);
    setConfigDraft(normalized);
    props.store.bumpCloudConfigVersion();
    props.store.showToast('Cloud-Verbindung lokal gespeichert');
    props.store.setCloudSyncTab('backup');
    void runComparison();
  };

  const handleDeleteConfig = () => {
    clearCloudConfig();
    setConfigDraft({ ...DEFAULT_CLOUD_CONFIG });
    setComparison(null);
    setConnTestResult(null);
    props.store.bumpCloudConfigVersion();
    props.store.showToast('Cloud-Zugangsdaten entfernt');
  };

  const copySnippet = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      props.store.showToast(`${label} kopiert`);
    } catch {
      props.store.showToast('Kopieren fehlgeschlagen');
    }
  };

  // ==================== Badge Helpers ====================

  const renderStatusBadge = (status: string, tab: 'backup' | 'import') => {
    if (status === 'synced') {
      return <span class="cloud-badge is-synced">Synchron</span>;
    }
    if (tab === 'backup') {
      if (status === 'local-only') return <span class="cloud-badge is-new">Neu</span>;
      if (status === 'local-ahead') return <span class="cloud-badge is-update">Geändert</span>;
      return <span class="cloud-badge is-conflict">Konflikt</span>;
    }
    if (status === 'remote-only') return <span class="cloud-badge is-new">Neu</span>;
    if (status === 'remote-ahead') return <span class="cloud-badge is-update">Aktueller</span>;
    return <span class="cloud-badge is-conflict">Konflikt</span>;
  };

  const rootFolders = createMemo(() => {
    const all = tabFolders();
    const allIds = new Set(all.map((f) => f.id));
    return all.filter((f) => !f.parentId || !allIds.has(f.parentId));
  });

  const unfiledNotes = createMemo(() => {
    const validFolderIds = new Set(tabFolders().map((f) => f.id));
    return tabNotes().filter(
      (n) => (!n.folderId || !validFolderIds.has(n.folderId)) && noteMatchesSearch(n)
    );
  });

  const folderMatchesSearch = (folderId: string): boolean => {
    const q = searchLower();
    if (!q) return true;
    const f = folderMap().get(folderId);
    if (f?.name.toLowerCase().includes(q)) return true;
    if (tabNotes().some((n) => n.folderId === folderId && noteMatchesSearch(n))) return true;
    return tabFolders().some((c) => c.parentId === folderId && folderMatchesSearch(c.id));
  };

  const renderNoteRow = (note: TreeNoteNode, depth: number) => {
    const tab = activeTab() === 'import' ? 'import' : 'backup';
    const isChecked = () => selectedNoteIds().has(note.id);
    return (
      <label
        class="cloud-tree-note"
        classList={{
          'is-selected': isChecked(),
          'is-conflict':
            (tab === 'backup' &&
              (note.comparison.status === 'conflict' ||
                note.comparison.status === 'remote-ahead')) ||
            (tab === 'import' &&
              (note.comparison.status === 'conflict' ||
                note.comparison.status === 'local-ahead')),
        }}
        style={{ 'padding-left': `${14 + depth * 18}px` }}
      >
        <input
          type="checkbox"
          class="cloud-checkbox"
          checked={isChecked()}
          onChange={() => toggleNoteSelection(note.id)}
        />
        <span class="cloud-tree-icon">
          <IconFileText size={14} />
        </span>
        <div class="cloud-tree-note-info">
          <span class="cloud-tree-note-title">{note.title}</span>
          <span class="cloud-tree-note-sub">
            {note.pageCount} {note.pageCount === 1 ? 'Seite' : 'Seiten'} ·{' '}
            {formatBytes(note.sizeBytes)}
            <Show when={note.comparison.status !== 'synced' && note.transferHintBytes < note.sizeBytes * 0.7}>
              {' '}
              · <strong>nur ~{formatBytes(note.transferHintBytes)} Transfer</strong>
            </Show>
          </span>
        </div>
        {renderStatusBadge(note.comparison.status, tab)}
      </label>
    );
  };

  const renderFolderBranch = (folder: TreeFolderNode, depth: number) => {
    const tab = activeTab() === 'import' ? 'import' : 'backup';
    const children = () =>
      tabFolders().filter((f) => f.parentId === folder.id && folderMatchesSearch(f.id));
    const directNotes = () =>
      tabNotes().filter((n) => n.folderId === folder.id && noteMatchesSearch(n));
    const hasEntries = () => children().length > 0 || directNotes().length > 0;
    const isExpanded = () => Boolean(searchLower()) || !collapsedFolders().has(folder.id);
    const checkState = () => getFolderCheckState(folder.id);
    const allSubNotes = () => getNotesUnderFolder(folder.id);
    const selectedSubCount = () =>
      allSubNotes().filter((n) => selectedNoteIds().has(n.id)).length;

    return (
      <div class="cloud-tree-branch">
        <div
          class="cloud-tree-folder"
          style={{ 'padding-left': `${8 + depth * 18}px` }}
        >
          <button
            type="button"
            class="cloud-tree-chevron"
            classList={{ 'is-empty': !hasEntries() }}
            onClick={() => toggleFolderCollapsed(folder.id)}
            aria-label={isExpanded() ? 'Zuklappen' : 'Aufklappen'}
          >
            <Show when={isExpanded()} fallback={<IconChevronRight size={13} />}>
              <IconChevronDown size={13} />
            </Show>
          </button>

          <input
            type="checkbox"
            class="cloud-checkbox"
            checked={checkState() === 'checked'}
            ref={(el) => {
              createEffect(() => {
                el.indeterminate = checkState() === 'partial';
              });
            }}
            onChange={() => toggleFolderSelection(folder.id)}
          />

          <span class="cloud-tree-folder-icon" style={{ color: folder.color }}>
            <IconFolder size={15} />
          </span>

          <button
            type="button"
            class="cloud-tree-folder-label"
            onClick={() => toggleFolderSelection(folder.id)}
          >
            <span class="cloud-tree-folder-name">{folder.name}</span>
            <span class="cloud-tree-folder-count">
              {selectedSubCount()}/{allSubNotes().length}
            </span>
          </button>

          <Show when={folder.status !== 'synced'}>
            {renderStatusBadge(folder.status, tab)}
          </Show>
        </div>

        <Show when={isExpanded() && hasEntries()}>
          <div class="cloud-tree-children">
            <For each={children()}>{(child) => renderFolderBranch(child, depth + 1)}</For>
            <For each={directNotes()}>{(note) => renderNoteRow(note, depth + 1)}</For>
          </div>
        </Show>
      </div>
    );
  };

  const baselineInfo = createMemo(() => {
    const cfg = savedConfig();
    if (!cfg || !isCloudConfigComplete(cfg)) return null;
    props.store.cloudConfigVersion();
    return loadCloudBaseline(cfg);
  });

  return (
    <Show when={isOpen()}>
      <div
        class="cloud-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Online-Backup & Import"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isRunning()) {
            props.store.closeCloudSync();
          }
        }}
      >
        <div class="cloud-modal">
          {/* Header */}
          <div class="cloud-modal-head">
            <div class="cloud-modal-title-group">
              <span class="cloud-modal-icon">
                <IconCloud size={18} />
              </span>
              <div>
                <h2 class="cloud-modal-title">Online-Backup &amp; Import</h2>
                <div class="cloud-modal-subtitle">
                  <Show
                    when={isConfigured() && savedConfig()}
                    fallback={<span>Optionaler S3-Speicher (Cloudflare R2 / Backblaze B2)</span>}
                  >
                    {(cfg) => (
                      <span>
                        {providerLabel(cfg().provider)} · <strong>{cfg().bucket}</strong>
                        <Show when={baselineInfo()?.lastBackupAt}>
                          {(ts) => <> · Letztes Backup: {formatShortDate(ts())}</>}
                        </Show>
                      </span>
                    )}
                  </Show>
                </div>
              </div>
            </div>

            <button
              type="button"
              class="icon-btn"
              disabled={isRunning()}
              onClick={() => props.store.closeCloudSync()}
              title="Schließen (Esc)"
              aria-label="Schließen"
            >
              <IconX size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div class="cloud-modal-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === 'backup'}
              class="cloud-tab-btn"
              classList={{ 'is-active': activeTab() === 'backup' }}
              disabled={!isConfigured() || isRunning()}
              onClick={() => props.store.setCloudSyncTab('backup')}
            >
              <IconCloudUpload size={15} />
              <span>Hochladen (Backup)</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === 'import'}
              class="cloud-tab-btn"
              classList={{ 'is-active': activeTab() === 'import' }}
              disabled={!isConfigured() || isRunning()}
              onClick={() => props.store.setCloudSyncTab('import')}
            >
              <IconCloudDownload size={15} />
              <span>Importieren</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab() === 'setup'}
              class="cloud-tab-btn"
              classList={{ 'is-active': activeTab() === 'setup' }}
              disabled={isRunning()}
              onClick={() => props.store.setCloudSyncTab('setup')}
            >
              <IconSettings size={15} />
              <span>Verbindung</span>
              <Show when={!isConfigured()}>
                <span class="cloud-setup-dot" />
              </Show>
            </button>
          </div>

          {/* Scrollable Body */}
          <div class="cloud-modal-body">
            {/* ==================== TAB: SETUP ==================== */}
            <Show when={activeTab() === 'setup'}>
              <div class="cloud-setup-panel">
                <p class="cloud-intro-text">
                  Verbinde deinen eigenen <strong>S3-kompatiblen Bucket</strong> (z. B. Cloudflare R2
                  oder Backblaze B2 mit 10 GB Gratis-Speicher). Notizen werden einzeln komprimiert und
                  Medien (Bilder/PDF-Seiten) dedupliziert ausgelagert — so werden bei Änderungen nur
                  wenige Kilobyte übertragen. Zugangsdaten bleiben ausschließlich lokal auf diesem Gerät.
                </p>

                <div class="cloud-field-group">
                  <label class="cloud-label">Anbieter-Vorlage</label>
                  <div class="segmented-control">
                    <button
                      type="button"
                      class="seg-btn"
                      classList={{ 'is-active': configDraft().provider === 'r2' }}
                      onClick={() => updateDraft({ provider: 'r2' })}
                    >
                      Cloudflare R2
                    </button>
                    <button
                      type="button"
                      class="seg-btn"
                      classList={{ 'is-active': configDraft().provider === 'b2' }}
                      onClick={() => updateDraft({ provider: 'b2' })}
                    >
                      Backblaze B2
                    </button>
                    <button
                      type="button"
                      class="seg-btn"
                      classList={{ 'is-active': configDraft().provider === 'custom' }}
                      onClick={() => updateDraft({ provider: 'custom' })}
                    >
                      Benutzerdefiniert (S3)
                    </button>
                  </div>
                </div>

                <div class="cloud-form-grid">
                  <div class="cloud-field-group is-full">
                    <label class="cloud-label" for="cloud-endpoint">
                      S3 Endpoint-URL
                    </label>
                    <input
                      id="cloud-endpoint"
                      type="url"
                      class="cloud-input"
                      value={configDraft().endpoint}
                      onInput={(e) => updateDraft({ endpoint: e.currentTarget.value })}
                      placeholder={
                        configDraft().provider === 'r2'
                          ? 'https://<Account-ID>.r2.cloudflarestorage.com'
                          : configDraft().provider === 'b2'
                            ? 'https://s3.eu-central-003.backblazeb2.com'
                            : 'https://s3.example.com'
                      }
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </div>

                  <div class="cloud-field-group">
                    <label class="cloud-label" for="cloud-bucket">
                      Bucket-Name
                    </label>
                    <input
                      id="cloud-bucket"
                      type="text"
                      class="cloud-input"
                      value={configDraft().bucket}
                      onInput={(e) => updateDraft({ bucket: e.currentTarget.value })}
                      placeholder="z. B. notizblock-backup"
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </div>

                  <div class="cloud-field-group">
                    <label class="cloud-label" for="cloud-region">
                      Region
                    </label>
                    <input
                      id="cloud-region"
                      type="text"
                      class="cloud-input"
                      value={configDraft().region}
                      onInput={(e) => updateDraft({ region: e.currentTarget.value })}
                      placeholder={configDraft().provider === 'r2' ? 'auto' : 'eu-central-003'}
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </div>

                  <div class="cloud-field-group">
                    <label class="cloud-label" for="cloud-key-id">
                      Access Key ID
                    </label>
                    <input
                      id="cloud-key-id"
                      type="text"
                      class="cloud-input"
                      value={configDraft().accessKeyId}
                      onInput={(e) => updateDraft({ accessKeyId: e.currentTarget.value })}
                      placeholder="Access Key ID"
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </div>

                  <div class="cloud-field-group">
                    <label class="cloud-label" for="cloud-secret">
                      Secret Access Key
                    </label>
                    <div class="cloud-secret-wrap">
                      <input
                        id="cloud-secret"
                        type={showSecret() ? 'text' : 'password'}
                        class="cloud-input"
                        value={configDraft().secretAccessKey}
                        onInput={(e) => updateDraft({ secretAccessKey: e.currentTarget.value })}
                        placeholder="Secret Access Key"
                        autocomplete="off"
                        spellcheck={false}
                      />
                      <button
                        type="button"
                        class="cloud-secret-toggle"
                        onClick={() => setShowSecret((v) => !v)}
                        title={showSecret() ? 'Verbergen' : 'Anzeigen'}
                      >
                        <Show when={showSecret()} fallback={<IconEye size={15} />}>
                          <IconEyeOff size={15} />
                        </Show>
                      </button>
                    </div>
                  </div>

                  <div class="cloud-field-group is-full">
                    <label class="cloud-label" for="cloud-prefix">
                      Ordner-Präfix im Bucket (optional)
                    </label>
                    <input
                      id="cloud-prefix"
                      type="text"
                      class="cloud-input"
                      value={configDraft().prefix}
                      onInput={(e) => updateDraft({ prefix: e.currentTarget.value })}
                      placeholder="notizblock"
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </div>
                </div>

                {/* Collapsible CORS Help */}
                <div class="cloud-cors-box">
                  <button
                    type="button"
                    class="cloud-cors-toggle"
                    onClick={() => setShowCorsHelp((v) => !v)}
                  >
                    <Show when={showCorsHelp()} fallback={<IconChevronRight size={14} />}>
                      <IconChevronDown size={14} />
                    </Show>
                    <span>CORS-Einrichtung im Bucket (einmalig nötig)</span>
                  </button>

                  <Show when={showCorsHelp()}>
                    <div class="cloud-cors-content">
                      <Show
                        when={configDraft().provider !== 'b2'}
                        fallback={
                          <>
                            <p>
                              Für <strong>Backblaze B2</strong> über die <code>b2</code>-CLI einmalig
                              setzen (oder im B2-Dashboard unter <em>CORS Rules</em> „Share everything
                              with B2 Native &amp; S3 API“ wählen):
                            </p>
                            <pre class="cloud-code-block">{buildB2CorsRulesJson()}</pre>
                            <button
                              type="button"
                              class="btn-ghost-sm"
                              onClick={() =>
                                void copySnippet(buildB2CorsRulesJson(), 'B2 CORS-JSON')
                              }
                            >
                              <IconCopy size={13} />
                              <span>B2 CORS-JSON kopieren</span>
                            </button>
                          </>
                        }
                      >
                        <p>
                          In <strong>Cloudflare R2</strong> unter{' '}
                          <em>Bucket → Settings → CORS Policy</em> dieses JSON einfügen und speichern:
                        </p>
                        <pre class="cloud-code-block">{buildR2CorsPolicyJson()}</pre>
                        <button
                          type="button"
                          class="btn-ghost-sm"
                          onClick={() =>
                            void copySnippet(buildR2CorsPolicyJson(), 'R2 CORS-Policy')
                          }
                        >
                          <IconCopy size={13} />
                          <span>CORS-Policy kopieren</span>
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>

                <Show when={connTestResult()}>
                  {(res) => (
                    <div
                      class="cloud-alert"
                      classList={{ 'is-success': res().ok, 'is-error': !res().ok }}
                    >
                      <Show when={res().ok} fallback={<IconAlertTriangle size={15} />}>
                        <IconCheck size={15} />
                      </Show>
                      <span>{res().message}</span>
                    </div>
                  )}
                </Show>

                <div class="cloud-setup-actions">
                  <button
                    type="button"
                    class="tool-pill"
                    disabled={testingConn()}
                    onClick={() => void handleTestConnection()}
                  >
                    <IconRefreshCw size={14} class={testingConn() ? 'is-spinning' : ''} />
                    <span>{testingConn() ? 'Teste…' : 'Verbindung testen'}</span>
                  </button>

                  <button
                    type="button"
                    class="btn-primary"
                    onClick={handleSaveConfig}
                  >
                    <IconCheck size={14} />
                    <span>Speichern &amp; weiter</span>
                  </button>

                  <Show when={isConfigured()}>
                    <button
                      type="button"
                      class="btn-ghost-sm is-danger-ghost"
                      onClick={handleDeleteConfig}
                    >
                      <IconTrash size={13} />
                      <span>Zugangsdaten entfernen</span>
                    </button>
                  </Show>
                </div>
              </div>
            </Show>

            {/* ==================== TAB: BACKUP OR IMPORT ==================== */}
            <Show when={activeTab() === 'backup' || activeTab() === 'import'}>
              {/* Analyzing Banner */}
              <Show when={isAnalyzing()}>
                <div class="cloud-progress-card">
                  <div class="cloud-progress-head">
                    <span class="import-spinner" />
                    <div>
                      <strong>{progress()?.label || 'Vergleiche lokalen & Online-Stand…'}</strong>
                      <Show when={progress()?.detail}>
                        {(d) => <div class="cloud-progress-detail">{d()}</div>}
                      </Show>
                    </div>
                  </div>
                  <Show when={progress() && progress()!.total > 0}>
                    <div class="cloud-progress-bar">
                      <div
                        class="cloud-progress-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(((progress()?.current ?? 0) / (progress()?.total ?? 1)) * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Analyze / Run Errors */}
              <Show when={analyzeError()}>
                {(err) => (
                  <div class="cloud-alert is-error">
                    <IconAlertTriangle size={16} />
                    <div class="cloud-alert-body">
                      <span>{err()}</span>
                      <div class="cloud-alert-actions">
                        <button
                          type="button"
                          class="btn-ghost-sm"
                          onClick={() => void runComparison()}
                        >
                          Erneut versuchen
                        </button>
                        <button
                          type="button"
                          class="btn-ghost-sm"
                          onClick={() => props.store.setCloudSyncTab('setup')}
                        >
                          Verbindung prüfen
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Show>

              <Show when={runError()}>
                {(err) => (
                  <div class="cloud-alert is-error">
                    <IconAlertTriangle size={16} />
                    <span>{err()}</span>
                  </div>
                )}
              </Show>

              <Show when={lastResultMessage()}>
                {(msg) => (
                  <div class="cloud-alert is-success">
                    <IconCheck size={16} />
                    <span>{msg()}</span>
                  </div>
                )}
              </Show>

              {/* Live Transfer Progress */}
              <Show when={isRunning() && progress()}>
                {(p) => (
                  <div class="cloud-progress-card is-active-transfer">
                    <div class="cloud-progress-head">
                      <span class="import-spinner" />
                      <div class="cloud-progress-text">
                        <strong>{p().label}</strong>
                        <div class="cloud-progress-detail">
                          {p().detail ? `${p().detail} · ` : ''}
                          Übertragen: {formatBytes(p().bytesTransferred)}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="btn-ghost-sm is-danger-ghost"
                        onClick={cancelOngoing}
                      >
                        Abbrechen
                      </button>
                    </div>
                    <div class="cloud-progress-bar">
                      <div
                        class="cloud-progress-fill"
                        style={{
                          width: `${Math.max(
                            4,
                            Math.min(100, Math.round((p().current / Math.max(1, p().total)) * 100))
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </Show>

              {/* Main Content when Comparison is Ready */}
              <Show when={!isAnalyzing() && comparison()}>
                {(cmp) => (
                  <Show
                    when={
                      activeTab() === 'backup' ||
                      (cmp().manifest && Object.keys(cmp().manifest!.notes).length > 0)
                    }
                    fallback={
                      <div class="cloud-empty-state">
                        <IconCloud size={32} />
                        <strong>Noch kein Online-Backup vorhanden</strong>
                        <p>
                          Im Bucket <code>{savedConfig()?.bucket}</code> wurden noch keine
                          gesicherten Notizen gefunden. Wechsle auf „Hochladen“, um dein erstes
                          Backup anzulegen.
                        </p>
                        <button
                          type="button"
                          class="btn-primary"
                          onClick={() => props.store.setCloudSyncTab('backup')}
                        >
                          <IconCloudUpload size={14} />
                          <span>Zum Online-Backup</span>
                        </button>
                      </div>
                    }
                  >
                    {/* Toolbar: Scope Switch + Refresh */}
                    <div class="cloud-scope-bar">
                      <div class="segmented-control">
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{ 'is-active': scope() === 'all' }}
                          disabled={isRunning()}
                          onClick={() => {
                            setScope('all');
                            selectAllForTab(
                              activeTab() === 'import' ? 'import' : 'backup',
                              cmp()
                            );
                          }}
                        >
                          Gesamt ({tabNotes().length})
                        </button>
                        <button
                          type="button"
                          class="seg-btn"
                          classList={{ 'is-active': scope() === 'custom' }}
                          disabled={isRunning()}
                          onClick={() => setScope('custom')}
                        >
                          Auswahl (Ordner &amp; Notizen)
                        </button>
                      </div>

                      <div class="cloud-scope-actions">
                        <button
                          type="button"
                          class="btn-ghost-sm"
                          disabled={isRunning()}
                          onClick={() => {
                            setScope('custom');
                            selectOnlyChangedForTab(
                              activeTab() === 'import' ? 'import' : 'backup',
                              cmp()
                            );
                          }}
                          title="Nur neue, geänderte oder konfliktbehaftete Einträge markieren"
                        >
                          Nur Änderungen
                        </button>
                        <button
                          type="button"
                          class="btn-ghost-sm"
                          disabled={isRunning()}
                          onClick={() => {
                            setScope('custom');
                            setSelectedNoteIds(new Set<string>());
                            setSelectedFolderIds(new Set<string>());
                          }}
                        >
                          Keine
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          disabled={isRunning()}
                          onClick={() => void runComparison()}
                          title="Mit Cloud neu abgleichen"
                          aria-label="Neu abgleichen"
                        >
                          <IconRefreshCw size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Search & Hierarchical Selection Tree */}
                    <div class="cloud-tree-card">
                      <div class="cloud-tree-toolbar">
                        <div class="cloud-tree-search">
                          <IconSearch size={13} />
                          <input
                            type="text"
                            value={treeSearch()}
                            onInput={(e) => setTreeSearch(e.currentTarget.value)}
                            placeholder="Ordner oder Notizen filtern…"
                          />
                          <Show when={treeSearch()}>
                            <button
                              type="button"
                              class="search-clear"
                              onClick={() => setTreeSearch('')}
                            >
                              <IconX size={12} />
                            </button>
                          </Show>
                        </div>
                        <span class="cloud-selection-count">
                          {selectedNoteIds().size} / {tabNotes().length} Notizen gewählt
                        </span>
                      </div>

                      <div class="cloud-tree-list">
                        <For
                          each={rootFolders().filter((f) => folderMatchesSearch(f.id))}
                        >
                          {(folder) => renderFolderBranch(folder, 0)}
                        </For>

                        <Show when={unfiledNotes().length > 0}>
                          <div class="cloud-tree-unfiled-label">Weitere Notizen (ohne Ordner)</div>
                          <For each={unfiledNotes()}>{(note) => renderNoteRow(note, 0)}</For>
                        </Show>

                        <Show
                          when={
                            rootFolders().filter((f) => folderMatchesSearch(f.id)).length === 0 &&
                            unfiledNotes().length === 0
                          }
                        >
                          <div class="cloud-tree-empty">Keine passenden Einträge gefunden.</div>
                        </Show>
                      </div>
                    </div>

                    {/* ==================== CONFLICT RESOLUTION PANEL ==================== */}
                    <Show
                      when={
                        conflictingSelectedNotes().length > 0 ||
                        conflictingRequiredFolders().length > 0
                      }
                    >
                      <div class="cloud-conflicts-card">
                        <div class="cloud-conflicts-head">
                          <div class="cloud-conflicts-title">
                            <IconAlertTriangle size={16} />
                            <strong>
                              Konflikte lösen (
                              {conflictingSelectedNotes().length +
                                conflictingRequiredFolders().length}
                              )
                            </strong>
                          </div>

                          <div class="cloud-conflict-bulk">
                            <Show
                              when={activeTab() === 'import'}
                              fallback={
                                <>
                                  <button
                                    type="button"
                                    class="btn-ghost-sm"
                                    onClick={() => {
                                      const next: Record<string, BackupConflictResolution> = {
                                        ...backupConflicts(),
                                      };
                                      for (const n of conflictingSelectedNotes()) next[n.id] = 'skip';
                                      setBackupConflicts(next);
                                      const nextF: Record<string, FolderConflictResolution> = {
                                        ...folderConflicts(),
                                      };
                                      for (const f of conflictingRequiredFolders()) {
                                        nextF[f.id] = 'keep-target';
                                      }
                                      setFolderConflicts(nextF);
                                    }}
                                  >
                                    Alle überspringen
                                  </button>
                                  <button
                                    type="button"
                                    class="btn-ghost-sm"
                                    onClick={() => {
                                      const next: Record<string, BackupConflictResolution> = {
                                        ...backupConflicts(),
                                      };
                                      for (const n of conflictingSelectedNotes()) {
                                        next[n.id] = 'overwrite-remote';
                                      }
                                      setBackupConflicts(next);
                                      const nextF: Record<string, FolderConflictResolution> = {
                                        ...folderConflicts(),
                                      };
                                      for (const f of conflictingRequiredFolders()) {
                                        nextF[f.id] = 'overwrite-target';
                                      }
                                      setFolderConflicts(nextF);
                                    }}
                                  >
                                    Alle online ersetzen
                                  </button>
                                </>
                              }
                            >
                              <button
                                type="button"
                                class="btn-ghost-sm"
                                onClick={() => {
                                  const next: Record<string, ImportConflictResolution> = {
                                    ...importConflicts(),
                                  };
                                  for (const n of conflictingSelectedNotes()) {
                                    next[n.id] = 'keep-local';
                                  }
                                  setImportConflicts(next);
                                  const nextF: Record<string, FolderConflictResolution> = {
                                    ...folderConflicts(),
                                  };
                                  for (const f of conflictingRequiredFolders()) {
                                    nextF[f.id] = 'keep-target';
                                  }
                                  setFolderConflicts(nextF);
                                }}
                              >
                                Alle lokal behalten
                              </button>
                              <button
                                type="button"
                                class="btn-ghost-sm"
                                onClick={() => {
                                  const next: Record<string, ImportConflictResolution> = {
                                    ...importConflicts(),
                                  };
                                  for (const n of conflictingSelectedNotes()) {
                                    next[n.id] = 'keep-both';
                                  }
                                  setImportConflicts(next);
                                }}
                              >
                                Alle als Kopie
                              </button>
                              <button
                                type="button"
                                class="btn-ghost-sm"
                                onClick={() => {
                                  const next: Record<string, ImportConflictResolution> = {
                                    ...importConflicts(),
                                  };
                                  for (const n of conflictingSelectedNotes()) {
                                    next[n.id] = 'use-remote';
                                  }
                                  setImportConflicts(next);
                                  const nextF: Record<string, FolderConflictResolution> = {
                                    ...folderConflicts(),
                                  };
                                  for (const f of conflictingRequiredFolders()) {
                                    nextF[f.id] = 'overwrite-target';
                                  }
                                  setFolderConflicts(nextF);
                                }}
                              >
                                Alle online übernehmen
                              </button>
                            </Show>
                          </div>
                        </div>

                        <p class="cloud-conflicts-desc">
                          Diese Einträge weichen lokal und online voneinander ab. Standardmäßig
                          wird nichts überschrieben — wähle pro Eintrag, was passieren soll:
                        </p>

                        <div class="cloud-conflicts-list">
                          <For each={conflictingSelectedNotes()}>
                            {(entry) => {
                              const title = () =>
                                entry.local?.title.trim() ||
                                entry.remote?.title.trim() ||
                                'Unbenannte Notiz';
                              const backupChoice = () => backupConflicts()[entry.id] ?? 'skip';
                              const importChoice = () =>
                                importConflicts()[entry.id] ?? 'keep-local';
                              return (
                                <div class="cloud-conflict-row">
                                  <div class="cloud-conflict-meta">
                                    <div class="cloud-conflict-name">
                                      <IconFileText size={13} />
                                      <span>{title()}</span>
                                    </div>
                                    <div class="cloud-conflict-times">
                                      <span>
                                        Lokal: {formatShortDate(entry.local?.updatedAt)} (
                                        {entry.local?.pageCount ?? 0} S.)
                                      </span>
                                      <span>·</span>
                                      <span>
                                        Online: {formatShortDate(entry.remote?.updatedAt)} (
                                        {entry.remote?.pageCount ?? 0} S.)
                                      </span>
                                    </div>
                                  </div>

                                  <div class="cloud-conflict-controls">
                                    <Show
                                      when={activeTab() === 'import'}
                                      fallback={
                                        <div class="segmented-control">
                                          <button
                                            type="button"
                                            class="seg-btn"
                                            classList={{ 'is-active': backupChoice() === 'skip' }}
                                            onClick={() =>
                                              setBackupConflicts((p) => ({
                                                ...p,
                                                [entry.id]: 'skip',
                                              }))
                                            }
                                          >
                                            Überspringen
                                          </button>
                                          <button
                                            type="button"
                                            class="seg-btn is-warn-seg"
                                            classList={{
                                              'is-active': backupChoice() === 'overwrite-remote',
                                            }}
                                            onClick={() =>
                                              setBackupConflicts((p) => ({
                                                ...p,
                                                [entry.id]: 'overwrite-remote',
                                              }))
                                            }
                                          >
                                            Online ersetzen
                                          </button>
                                        </div>
                                      }
                                    >
                                      <div class="segmented-control">
                                        <button
                                          type="button"
                                          class="seg-btn"
                                          classList={{
                                            'is-active': importChoice() === 'keep-local',
                                          }}
                                          onClick={() =>
                                            setImportConflicts((p) => ({
                                              ...p,
                                              [entry.id]: 'keep-local',
                                            }))
                                          }
                                        >
                                          Lokal behalten
                                        </button>
                                        <button
                                          type="button"
                                          class="seg-btn"
                                          classList={{
                                            'is-active': importChoice() === 'keep-both',
                                          }}
                                          onClick={() =>
                                            setImportConflicts((p) => ({
                                              ...p,
                                              [entry.id]: 'keep-both',
                                            }))
                                          }
                                        >
                                          Kopie
                                        </button>
                                        <button
                                          type="button"
                                          class="seg-btn is-warn-seg"
                                          classList={{
                                            'is-active': importChoice() === 'use-remote',
                                          }}
                                          onClick={() =>
                                            setImportConflicts((p) => ({
                                              ...p,
                                              [entry.id]: 'use-remote',
                                            }))
                                          }
                                        >
                                          Ersetzen
                                        </button>
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              );
                            }}
                          </For>

                          <For each={conflictingRequiredFolders()}>
                            {(fEntry) => {
                              const decision = () => folderConflicts()[fEntry.id] ?? 'keep-target';
                              return (
                                <div class="cloud-conflict-row">
                                  <div class="cloud-conflict-meta">
                                    <div class="cloud-conflict-name">
                                      <IconFolder size={13} />
                                      <span>
                                        Ordner: Lokal „{fEntry.local?.name ?? '–'}“ vs. Online „
                                        {fEntry.remote?.name ?? '–'}“
                                      </span>
                                    </div>
                                  </div>
                                  <div class="cloud-conflict-controls">
                                    <div class="segmented-control">
                                      <button
                                        type="button"
                                        class="seg-btn"
                                        classList={{ 'is-active': decision() === 'keep-target' }}
                                        onClick={() =>
                                          setFolderConflicts((p) => ({
                                            ...p,
                                            [fEntry.id]: 'keep-target',
                                          }))
                                        }
                                      >
                                        {activeTab() === 'import'
                                          ? 'Lokal behalten'
                                          : 'Online behalten'}
                                      </button>
                                      <button
                                        type="button"
                                        class="seg-btn is-warn-seg"
                                        classList={{
                                          'is-active': decision() === 'overwrite-target',
                                        }}
                                        onClick={() =>
                                          setFolderConflicts((p) => ({
                                            ...p,
                                            [fEntry.id]: 'overwrite-target',
                                          }))
                                        }
                                      >
                                        {activeTab() === 'import'
                                          ? 'Online übernehmen'
                                          : 'Online ersetzen'}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    </Show>

                    {/* ==================== PRE-FLIGHT SUMMARY ==================== */}
                    <div class="cloud-summary-card">
                      <div class="cloud-summary-head">
                        <strong>Zusammenfassung</strong>
                        <span class="cloud-transfer-pill">
                          <Show when={activeTab() === 'backup' && backupPlan()}>
                            {(p) => (
                              <>
                                Transfer: ~{formatBytes(p().estimatedUploadBytes)} ·{' '}
                                {p().newBlobCount} neue Medien
                                <Show when={p().reusedBlobCount > 0}>
                                  {' '}
                                  ({p().reusedBlobCount} bereits in Cloud)
                                </Show>
                              </>
                            )}
                          </Show>
                          <Show when={activeTab() === 'import' && importPlan()}>
                            {(p) => (
                              <>
                                Transfer: ~{formatBytes(p().estimatedDownloadBytes)} ·{' '}
                                {p().downloadBlobCount} neue Medien
                                <Show when={p().reusedLocalBlobCount > 0}>
                                  {' '}
                                  ({p().reusedLocalBlobCount} bereits lokal)
                                </Show>
                              </>
                            )}
                          </Show>
                        </span>
                      </div>

                      {/* Stat Chips */}
                      <div class="cloud-summary-stats">
                        <Show when={activeTab() === 'backup' && backupPlan()}>
                          {(p) => (
                            <>
                              <span class="cloud-stat-chip is-new">
                                Neu: {p().newNoteIds.length} Notizen
                                <Show when={p().newFolderIds.length > 0}>
                                  , {p().newFolderIds.length} Ordner
                                </Show>
                              </span>
                              <span class="cloud-stat-chip is-update">
                                Aktualisiert: {p().updateNoteIds.length}
                              </span>
                              <Show
                                when={
                                  p().overwriteRemoteNoteIds.length +
                                    p().overwriteRemoteFolderIds.length >
                                  0
                                }
                              >
                                <span class="cloud-stat-chip is-warn">
                                  Ersetzt (Konflikt):{' '}
                                  {p().overwriteRemoteNoteIds.length +
                                    p().overwriteRemoteFolderIds.length}
                                </span>
                              </Show>
                              <span class="cloud-stat-chip">
                                Unverändert: {p().unchangedNoteIds.length}
                              </span>
                              <Show when={p().skippedConflictNoteIds.length > 0}>
                                <span class="cloud-stat-chip">
                                  Übersprungen: {p().skippedConflictNoteIds.length}
                                </span>
                              </Show>
                            </>
                          )}
                        </Show>

                        <Show when={activeTab() === 'import' && importPlan()}>
                          {(p) => (
                            <>
                              <span class="cloud-stat-chip is-new">
                                Neu lokal: {p().newNoteIds.length} Notizen
                                <Show when={p().newFolderIds.length > 0}>
                                  , {p().newFolderIds.length} Ordner
                                </Show>
                              </span>
                              <span class="cloud-stat-chip is-update">
                                Aktualisiert: {p().updateNoteIds.length}
                              </span>
                              <Show
                                when={
                                  p().replaceLocalNoteIds.length +
                                    p().replaceLocalFolderIds.length >
                                  0
                                }
                              >
                                <span class="cloud-stat-chip is-warn">
                                  Lokal ersetzt:{' '}
                                  {p().replaceLocalNoteIds.length +
                                    p().replaceLocalFolderIds.length}
                                </span>
                              </Show>
                              <Show when={p().copyNoteIds.length > 0}>
                                <span class="cloud-stat-chip is-new">
                                  Als Kopie: {p().copyNoteIds.length}
                                </span>
                              </Show>
                              <span class="cloud-stat-chip">
                                Unverändert: {p().unchangedNoteIds.length}
                              </span>
                              <Show when={p().skippedConflictNoteIds.length > 0}>
                                <span class="cloud-stat-chip">
                                  Behalten: {p().skippedConflictNoteIds.length}
                                </span>
                              </Show>
                            </>
                          )}
                        </Show>
                      </div>

                      {/* Explicit list of notes/folders that will be replaced or updated */}
                      <Show
                        when={
                          replacedItemsSummary().notes.length > 0 ||
                          replacedItemsSummary().folders.length > 0
                        }
                      >
                        <div class="cloud-replace-preview">
                          <div class="cloud-replace-title">
                            {activeTab() === 'import'
                              ? 'Folgende lokale Einträge werden aktualisiert / ersetzt:'
                              : 'Folgende Online-Einträge werden aktualisiert / ersetzt:'}
                          </div>
                          <div class="cloud-replace-chips">
                            <For each={replacedItemsSummary().folders.slice(0, 8)}>
                              {(f) => (
                                <span
                                  class="cloud-replace-chip"
                                  classList={{ 'is-conflict': f.kind === 'conflict' }}
                                >
                                  <IconFolder size={11} />
                                  <span>{f.name}</span>
                                </span>
                              )}
                            </For>
                            <For each={replacedItemsSummary().notes.slice(0, 10)}>
                              {(n) => (
                                <span
                                  class="cloud-replace-chip"
                                  classList={{ 'is-conflict': n.kind === 'conflict' }}
                                >
                                  <IconFileText size={11} />
                                  <span>{n.title}</span>
                                </span>
                              )}
                            </For>
                            <Show
                              when={
                                replacedItemsSummary().notes.length +
                                  replacedItemsSummary().folders.length >
                                18
                              }
                            >
                              <span class="cloud-replace-more">
                                +
                                {replacedItemsSummary().notes.length +
                                  replacedItemsSummary().folders.length -
                                  18}{' '}
                                weitere
                              </span>
                            </Show>
                          </div>
                        </div>
                      </Show>

                      {/* Optional global settings checkbox */}
                      <Show
                        when={
                          activeTab() === 'backup' ||
                          Boolean(cmp().manifest?.settings)
                        }
                      >
                        <label class="cloud-settings-opt">
                          <input
                            type="checkbox"
                            class="cloud-checkbox"
                            checked={includeSettings()}
                            onChange={(e) => setIncludeSettings(e.currentTarget.checked)}
                          />
                          <span>
                            {activeTab() === 'backup'
                              ? 'Globale App-Einstellungen mitsichern'
                              : 'Globale App-Einstellungen aus Online-Backup übernehmen'}
                          </span>
                        </label>
                      </Show>

                      <div class="cloud-safety-note">
                        {activeTab() === 'import'
                          ? 'Sicherheitsgarantie: Beim Online-Import werden niemals lokale Notizen oder Ordner gelöscht.'
                          : 'Sicherheitsgarantie: Nicht ausgewählte Notizen im Bucket bleiben vollständig erhalten.'}
                      </div>
                    </div>
                  </Show>
                )}
              </Show>
            </Show>
          </div>

          {/* Sticky Footer for Backup / Import */}
          <Show when={activeTab() === 'backup' || activeTab() === 'import'}>
            <div class="cloud-modal-foot">
              <button
                type="button"
                class="btn-ghost-sm"
                disabled={isRunning()}
                onClick={() => props.store.closeCloudSync()}
              >
                Schließen
              </button>

              <Show
                when={activeTab() === 'backup'}
                fallback={
                  <button
                    type="button"
                    class="btn-primary"
                    disabled={!canExecuteAction()}
                    onClick={() => void handleRunImport()}
                  >
                    <IconCloudDownload size={15} />
                    <span>
                      {isRunning() ? 'Importiert…' : 'Online-Import starten'}
                    </span>
                  </button>
                }
              >
                <button
                  type="button"
                  class="btn-primary"
                  disabled={!canExecuteAction()}
                  onClick={() => void handleRunBackup()}
                >
                  <IconCloudUpload size={15} />
                  <span>
                    {isRunning() ? 'Sichert…' : 'Online-Backup starten'}
                  </span>
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
