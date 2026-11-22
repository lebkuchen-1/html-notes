import { batch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  DEFAULT_APP_SETTINGS,
  FOLDER_COLORS,
  PAGE_SIZE_PRESETS,
  type AppSettings,
  type CanvasImageItem,
  type CanvasMode,
  type CanvasPage,
  type CanvasSnapshot,
  type CanvasTextItem,
  type Folder,
  type HistoryState,
  type Note,
  type NoteImageAttachment,
  type NoteLocalSettings,
  type PageBackgroundImage,
  type PaperConfig,
  type Stroke,
  type ThemeMode,
  type ViewMode,
} from '../types';
import {
  readQuickImportFromClipboard,
  type QuickImportPayload,
} from '../utils/clipboardImport';
import { requestPersistentStorage } from '../utils/db';
import { isCloudConfigComplete, loadCloudConfig } from '../utils/s3Client';
import {
  clampPageHeight,
  clampPageWidth,
  createCanvasPage,
  generateId,
  loadActiveNoteId,
  loadActiveScreen,
  loadAppSettings,
  loadOpenTabIds,
  loadTheme,
  loadViewMode,
  loadWorkspaceAsync,
  normalizeFolder,
  normalizeNote,
  saveActiveNoteId,
  saveActiveScreen,
  saveAppSettings,
  saveFoldersAsync,
  saveNotesDeltaAsync,
  saveOpenTabIds,
  saveTheme,
  saveViewMode,
  type StorageBackend,
} from '../utils/storage';

export type SidebarFilterMode = 'all' | 'pinned' | 'unfiled' | 'folder';
export type ActiveScreen = 'home' | 'note' | 'settings';
export type SettingsScopeTab = 'global' | 'local';
export type CloudSyncModalTab = 'backup' | 'import' | 'setup';

const MAX_HISTORY = 50;

export function createNotesStore() {
  const [isHydrated, setIsHydrated] = createSignal<boolean>(false);
  const [storageBackend, setStorageBackend] = createSignal<StorageBackend>('indexeddb');
  const [notes, setNotes] = createSignal<Note[]>([]);
  const [folders, setFolders] = createSignal<Folder[]>([]);
  const [activeNoteId, setActiveNoteId] = createSignal<string | null>(null);
  const [openTabIds, setOpenTabIds] = createSignal<string[]>([]);
  const [activeScreen, setActiveScreen] = createSignal<ActiveScreen>('home');
  const [settingsTab, setSettingsTab] = createSignal<SettingsScopeTab>('global');
  let previousNonSettingsScreen: 'home' | 'note' = 'home';
  const [settings, setSettings] = createSignal<AppSettings>(loadAppSettings());
  const [searchQuery, setSearchQuery] = createSignal('');
  const [filterMode, setFilterMode] = createSignal<SidebarFilterMode>('all');
  const [selectedFolderId, setSelectedFolderId] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>(loadViewMode());
  const [theme, setTheme] = createSignal<ThemeMode>(loadTheme());
  const [sidebarOpen, setSidebarOpen] = createSignal(
    typeof window !== 'undefined' ? window.innerWidth >= 900 : true
  );
  const [isFullscreen, setIsFullscreen] = createSignal<boolean>(false);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = createSignal<boolean>(false);
  const [importDialogPayload, setImportDialogPayload] =
    createSignal<QuickImportPayload | null>(null);
  const [importDialogHint, setImportDialogHint] = createSignal<string | null>(null);
  const [importDialogDefaultTarget, setImportDialogDefaultTarget] = createSignal<
    'new' | 'existing'
  >('new');
  const [cloudSyncOpen, setCloudSyncOpen] = createSignal<boolean>(false);
  const [cloudSyncTab, setCloudSyncTab] = createSignal<CloudSyncModalTab>('backup');
  const [cloudConfigVersion, setCloudConfigVersion] = createSignal<number>(0);

  const isCloudConfigured = createMemo(() => {
    cloudConfigVersion();
    return isCloudConfigComplete(loadCloudConfig());
  });

  const bumpCloudConfigVersion = () => setCloudConfigVersion((v) => v + 1);

  const openCloudSync = (tab?: CloudSyncModalTab) => {
    const configured = isCloudConfigComplete(loadCloudConfig());
    setCloudSyncTab(tab ?? (configured ? 'backup' : 'setup'));
    setCloudSyncOpen(true);
  };

  const closeCloudSync = () => {
    setCloudSyncOpen(false);
  };

  let enteredNativeFullscreen = false;
  let sidebarWasOpenBeforeFullscreen = false;

  const getNativeFullscreenElement = (): Element | null => {
    if (typeof document === 'undefined') return null;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  };

  const isStandalonePwa = (): boolean => {
    if (typeof window === 'undefined') return false;
    const nav = navigator as Navigator & { standalone?: boolean };
    return (
      nav.standalone === true ||
      Boolean(window.matchMedia?.('(display-mode: standalone)').matches)
    );
  };

  const enterFullscreen = () => {
    if (!isFullscreen()) {
      sidebarWasOpenBeforeFullscreen = sidebarOpen();
      setSidebarOpen(false);
      setIsFullscreen(true);
    }

    // In iPadOS Home-Screen Standalone mode, Safari chrome is already hidden permanently;
    // avoid invoking WebKit's native WKFullScreenWindowController swipe-dismiss overlay!
    if (
      typeof document === 'undefined' ||
      isStandalonePwa() ||
      getNativeFullscreenElement()
    ) {
      return;
    }
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    try {
      if (typeof el.requestFullscreen === 'function') {
        const res = el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        if (res && typeof res.then === 'function') {
          res
            .then(() => {
              enteredNativeFullscreen = true;
            })
            .catch(() => {
              // Compact fullscreen UI remains active even if browser declines native fullscreen
            });
        } else {
          enteredNativeFullscreen = true;
        }
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        el.webkitRequestFullscreen();
        enteredNativeFullscreen = true;
      }
    } catch {
      // Compact fullscreen UI remains active
    }
  };

  const exitFullscreen = () => {
    setIsFullscreen(false);
    if (
      sidebarWasOpenBeforeFullscreen &&
      typeof window !== 'undefined' &&
      window.innerWidth >= 900
    ) {
      setSidebarOpen(true);
    }
    sidebarWasOpenBeforeFullscreen = false;

    if (typeof document !== 'undefined' && getNativeFullscreenElement()) {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      try {
        if (typeof document.exitFullscreen === 'function') {
          void document.exitFullscreen().catch(() => {});
        } else if (typeof doc.webkitExitFullscreen === 'function') {
          doc.webkitExitFullscreen();
        }
      } catch {
        // ignore
      }
    }
    enteredNativeFullscreen = false;
  };

  const toggleFullscreen = () => {
    if (isFullscreen()) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  };

  if (typeof document !== 'undefined') {
    const handleNativeFullscreenChange = () => {
      const activeEl = getNativeFullscreenElement();
      if (activeEl) {
        enteredNativeFullscreen = true;
        if (!isFullscreen()) {
          sidebarWasOpenBeforeFullscreen = sidebarOpen();
          setSidebarOpen(false);
          setIsFullscreen(true);
        }
      } else if (enteredNativeFullscreen) {
        enteredNativeFullscreen = false;
        setIsFullscreen(false);
        if (
          sidebarWasOpenBeforeFullscreen &&
          typeof window !== 'undefined' &&
          window.innerWidth >= 900
        ) {
          setSidebarOpen(true);
        }
        sidebarWasOpenBeforeFullscreen = false;
      }
    };
    document.addEventListener('fullscreenchange', handleNativeFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleNativeFullscreenChange);

    // In fullscreen mode, prevent stray finger overscroll swipes on non-scrollable UI chrome
    // from leaking into Safari's native pan/fullscreen recognizer.
    // IMPORTANT (iPadOS WebKit): NEVER call preventDefault() on stylus touches, interactive UI
    // controls, or small tap jitter (< 10px) — calling preventDefault() on touchmove in WebKit
    // cancels synthetic click events, and Apple Pencil emits sub-pixel touchmove on almost every tap.
    const FULLSCREEN_ALLOW_TOUCHMOVE_SELECTOR = [
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'label',
      'summary',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '.note-textarea',
      '.markdown-preview',
      '.settings-scroll',
      '.home-scroll',
      '.sidebar-explorer',
      '.folder-tree',
      '.note-list',
      '.note-tabs-list',
      '.paper-popover',
      '.color-popover',
      '.page-filmstrip',
      '.import-modal-body',
      '.import-note-list',
      '.import-folder-chips',
      '.import-paste-input',
      '.cloud-modal-body',
      '.cloud-tree-list',
      '.cloud-conflicts-list',
      '.cloud-code-block',
      '.canvas-text-overlay',
      '.canvas-text-input',
      '.canvas-image-selection',
      '.canvas-lasso-selection',
    ].join(', ');

    const fullscreenTouchStarts = new Map<number, { x: number; y: number }>();

    const getTouchTargetElement = (target: EventTarget | null): Element | null => {
      if (target instanceof Element) return target;
      if (target instanceof Node) return target.parentElement;
      return null;
    };

    const isStylusTouch = (e: TouchEvent): boolean => {
      type StylusTouch = Touch & { touchType?: string };
      for (let i = 0; i < e.touches.length; i++) {
        if ((e.touches[i] as StylusTouch).touchType === 'stylus') return true;
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        if ((e.changedTouches[i] as StylusTouch).touchType === 'stylus') return true;
      }
      return false;
    };

    const handleFullscreenTouchStart = (e: TouchEvent) => {
      if (!isFullscreen()) {
        fullscreenTouchStarts.clear();
        return;
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        fullscreenTouchStarts.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    };

    const handleFullscreenTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        fullscreenTouchStarts.delete(e.changedTouches[i].identifier);
      }
      if (e.touches.length === 0) {
        fullscreenTouchStarts.clear();
      }
    };

    const handleFullscreenTouchMoveGuard = (e: TouchEvent) => {
      if (!isFullscreen() || e.defaultPrevented) return;
      if (isStylusTouch(e)) return;

      const targetEl = getTouchTargetElement(e.target);
      if (targetEl?.closest(FULLSCREEN_ALLOW_TOUCHMOVE_SELECTOR)) {
        return;
      }

      // Allow small tap jitter (< 10px) on clickable rows/cards so taps never lose click events
      if (e.touches.length === 1) {
        const t = e.touches[0];
        const start = fullscreenTouchStarts.get(t.identifier);
        if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) < 10) {
          return;
        }
      }

      if (e.cancelable) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchstart', handleFullscreenTouchStart, { passive: true });
    document.addEventListener('touchmove', handleFullscreenTouchMoveGuard, {
      passive: false,
    });
    document.addEventListener('touchend', handleFullscreenTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleFullscreenTouchEnd, { passive: true });

    onCleanup(() => {
      document.removeEventListener('fullscreenchange', handleNativeFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleNativeFullscreenChange);
      document.removeEventListener('touchstart', handleFullscreenTouchStart);
      document.removeEventListener('touchmove', handleFullscreenTouchMoveGuard);
      document.removeEventListener('touchend', handleFullscreenTouchEnd);
      document.removeEventListener('touchcancel', handleFullscreenTouchEnd);
    });
  }

  // Per-page undo/redo stacks keyed by `${noteId}:${pageId}`
  const [histories, setHistories] = createSignal<Record<string, HistoryState>>({});

  // Snapshots of last persisted records so IndexedDB writes ONLY changed/deleted notes
  let lastSavedNotesMap = new Map<string, Note>();
  let lastSavedFoldersRef: Folder[] | null = null;

  let toastTimer: number | undefined;
  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToastMessage(null), 2600);
  };

  // Async IndexedDB hydration
  void loadWorkspaceAsync().then((loaded) => {
    const savedActiveId = loadActiveNoteId();
    const initialActiveId =
      savedActiveId && loaded.notes.some((n) => n.id === savedActiveId)
        ? savedActiveId
        : loaded.notes[0]?.id ?? null;

    const validNoteIds = new Set(loaded.notes.map((n) => n.id));
    const savedTabs = loadOpenTabIds().filter((id) => validNoteIds.has(id));
    const initialTabIds =
      savedTabs.length > 0
        ? initialActiveId && !savedTabs.includes(initialActiveId)
          ? [...savedTabs, initialActiveId]
          : savedTabs
        : initialActiveId
          ? [initialActiveId]
          : [];

    const initialScreen: 'home' | 'note' = initialActiveId ? loadActiveScreen() : 'home';

    lastSavedNotesMap = new Map(loaded.notes.map((n) => [n.id, n]));
    lastSavedFoldersRef = loaded.folders;
    previousNonSettingsScreen = initialScreen;

    batch(() => {
      setStorageBackend(loaded.backend);
      setNotes(loaded.notes);
      setFolders(loaded.folders);
      setActiveNoteId(initialActiveId);
      setOpenTabIds(initialTabIds);
      setActiveScreen(initialScreen);
      setIsHydrated(true);
    });

    if (loaded.backend === 'indexeddb') {
      void requestPersistentStorage();
    }
  });

  let saveTimer: number | undefined;

  const flushNotesSave = async (currentNotes: Note[]) => {
    const changed: Note[] = [];
    const currentIds = new Set<string>();

    for (const n of currentNotes) {
      currentIds.add(n.id);
      if (lastSavedNotesMap.get(n.id) !== n) {
        changed.push(n);
      }
    }

    const deletedIds: string[] = [];
    for (const prevId of lastSavedNotesMap.keys()) {
      if (!currentIds.has(prevId)) {
        deletedIds.push(prevId);
      }
    }

    if (changed.length === 0 && deletedIds.length === 0) return;

    const prevSnapshot = lastSavedNotesMap;
    lastSavedNotesMap = new Map(currentNotes.map((n) => [n.id, n]));

    const ok = await saveNotesDeltaAsync(
      changed,
      deletedIds,
      currentNotes,
      storageBackend()
    );
    if (!ok) {
      lastSavedNotesMap = prevSnapshot;
      showToast('Speichern fehlgeschlagen: Bitte genügend freien Gerätespeicher sicherstellen.');
    }
  };

  createEffect(() => {
    const currentNotes = notes();
    const delay = settings().autosaveDelayMs;
    if (!isHydrated()) return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined;
      void flushNotesSave(currentNotes);
    }, delay);
  });

  // Flush any pending debounced IndexedDB write immediately when iPad Safari backgrounds/closes
  if (typeof window !== 'undefined') {
    const flushNow = () => {
      if (!isHydrated()) return;
      if (saveTimer !== undefined) {
        window.clearTimeout(saveTimer);
        saveTimer = undefined;
        void flushNotesSave(notes());
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushNow);
    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushNow);
    });
  }

  createEffect(() => {
    saveAppSettings(settings());
  });

  createEffect(() => {
    const currentTheme = theme();
    saveTheme(currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
    const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.content = currentTheme === 'dark' ? '#151822' : '#ffffff';
    }
  });

  createEffect(() => {
    saveViewMode(viewMode());
  });

  createEffect(() => {
    const id = activeNoteId();
    if (!isHydrated()) return;
    saveActiveNoteId(id);
  });

  createEffect(() => {
    const tabs = openTabIds();
    if (!isHydrated()) return;
    saveOpenTabIds(tabs);
  });

  createEffect(() => {
    const currentFolders = folders();
    if (!isHydrated()) return;
    if (currentFolders === lastSavedFoldersRef) return;
    lastSavedFoldersRef = currentFolders;
    void saveFoldersAsync(currentFolders, storageBackend());
  });

  createEffect(() => {
    const screen = activeScreen();
    if (!isHydrated()) return;
    if (screen === 'home' || screen === 'note') {
      previousNonSettingsScreen = screen;
      saveActiveScreen(screen);
    }
  });

  const activeNote = createMemo<Note | undefined>(() => {
    const id = activeNoteId();
    if (!id) return undefined;
    return notes().find((n) => n.id === id);
  });

  const activePage = createMemo<CanvasPage | undefined>(() => {
    const n = activeNote();
    if (!n || n.pages.length === 0) return undefined;
    return n.pages.find((p) => p.id === n.activePageId) ?? n.pages[0];
  });

  const activePageIndex = createMemo<number>(() => {
    const n = activeNote();
    const p = activePage();
    if (!n || !p) return 0;
    const idx = n.pages.findIndex((item) => item.id === p.id);
    return idx >= 0 ? idx : 0;
  });

  // Effective settings for the currently active note (global AppSettings + per-note local overrides)
  const effectiveSettings = createMemo<AppSettings>(() => {
    const g = settings();
    const local = activeNote()?.settings;
    if (!local) return g;
    return { ...g, ...local };
  });

  const activeNoteLocalOverrideCount = createMemo<number>(() => {
    const local = activeNote()?.settings;
    if (!local) return 0;
    return Object.values(local).filter((v) => v !== undefined).length;
  });

  const openSettings = (tab?: SettingsScopeTab) => {
    const resolvedTab: SettingsScopeTab =
      tab === 'local' && activeNote() ? 'local' : tab ?? 'global';
    setSettingsTab(resolvedTab);
    setActiveScreen('settings');
  };

  const closeSettings = () => {
    if (previousNonSettingsScreen === 'note' && activeNote()) {
      setActiveScreen('note');
    } else {
      setActiveScreen('home');
    }
  };

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...patch,
      defaultPaperConfig: patch.defaultPaperConfig
        ? { ...prev.defaultPaperConfig, ...patch.defaultPaperConfig }
        : prev.defaultPaperConfig,
    }));
  };

  const updateDefaultPaperConfig = (patch: Partial<PaperConfig>) => {
    setSettings((prev) => ({
      ...prev,
      defaultPaperConfig: { ...prev.defaultPaperConfig, ...patch },
    }));
  };

  const resetSettings = () => {
    setSettings({
      ...DEFAULT_APP_SETTINGS,
      defaultPaperConfig: { ...DEFAULT_APP_SETTINGS.defaultPaperConfig },
    });
    showToast('Globale Einstellungen zurückgesetzt');
  };

  const updateNoteSettings = (
    patch: Partial<{ [K in keyof NoteLocalSettings]: NoteLocalSettings[K] | undefined }>,
    targetNoteId?: string
  ) => {
    const id = targetNoteId ?? activeNoteId();
    if (!id) return;
    updateNoteById(id, (n) => {
      const next: Partial<NoteLocalSettings> = { ...(n.settings ?? {}) };
      for (const [key, val] of Object.entries(patch)) {
        const k = key as keyof NoteLocalSettings;
        if (val === undefined) {
          delete next[k];
        } else {
          (next as Record<string, unknown>)[k] = val;
        }
      }
      const hasAny = Object.keys(next).length > 0;
      const updatedNote: Note = {
        ...n,
        updatedAt: Date.now(),
      };
      if (hasAny) {
        updatedNote.settings = next;
      } else {
        delete updatedNote.settings;
      }
      return updatedNote;
    });
  };

  const resetNoteSettings = (targetNoteId?: string) => {
    const id = targetNoteId ?? activeNoteId();
    if (!id) return;
    updateNoteById(id, (n) => {
      const next = { ...n, updatedAt: Date.now() };
      delete next.settings;
      return next;
    });
    showToast('Lokale Notiz-Einstellungen auf Global zurückgesetzt');
  };

  const getDescendantFolderIds = (rootFolderId: string): Set<string> => {
    const result = new Set<string>([rootFolderId]);
    const list = folders();
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of list) {
        if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
          result.add(f.id);
          changed = true;
        }
      }
    }
    return result;
  };

  const getFolderNoteCount = (folderId: string): number => {
    const subtree = getDescendantFolderIds(folderId);
    return notes().filter((n) => n.folderId && subtree.has(n.folderId)).length;
  };

  const filteredNotes = createMemo<Note[]>(() => {
    const q = searchQuery().trim().toLowerCase();
    const filter = filterMode();
    const folderId = selectedFolderId();
    const allowedFolders =
      filter === 'folder' && folderId ? getDescendantFolderIds(folderId) : null;

    return [...notes()]
      .filter((note) => {
        if (filter === 'pinned' && !note.pinned) return false;
        if (filter === 'unfiled' && note.folderId !== null) return false;
        if (allowedFolders && (!note.folderId || !allowedFolders.has(note.folderId))) {
          return false;
        }
        if (!q) return true;
        return (
          note.title.toLowerCase().includes(q) ||
          note.content.toLowerCase().includes(q) ||
          note.tags.some((t) => t.toLowerCase().includes(q)) ||
          note.pages.some(
            (page) =>
              page.title.toLowerCase().includes(q) ||
              page.texts.some((t) => t.text.toLowerCase().includes(q))
          )
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  });

  const historyKey = (noteId: string, pageId: string) => `${noteId}:${pageId}`;

  const activeHistory = createMemo<HistoryState>(() => {
    const n = activeNote();
    const p = activePage();
    if (!n || !p) return { past: [], future: [] };
    return histories()[historyKey(n.id, p.id)] ?? { past: [], future: [] };
  });

  const canUndo = createMemo(() => activeHistory().past.length > 0);
  const canRedo = createMemo(() => activeHistory().future.length > 0);

  const updateNoteById = (id: string, updater: (note: Note) => Note) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? updater(n) : n)));
  };

  const updatePageById = (
    noteId: string,
    pageId: string,
    updater: (page: CanvasPage) => CanvasPage
  ) => {
    updateNoteById(noteId, (n) => ({
      ...n,
      pages: n.pages.map((p) => (p.id === pageId ? updater(p) : p)),
      updatedAt: Date.now(),
    }));
  };

  const openHome = (mode?: Exclude<SidebarFilterMode, 'folder'>) => {
    if (mode) {
      setSelectedFolderId(null);
      setFilterMode(mode);
    }
    setActiveScreen('home');
  };

  const openFolderInHome = (folderId: string) => {
    setSelectedFolderId(folderId);
    setFilterMode('folder');
    setActiveScreen('home');
  };

  const openNote = (id: string) => {
    if (!notes().some((n) => n.id === id)) return;
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveNoteId(id);
    setActiveScreen('note');
  };

  const closeTab = (id: string) => {
    const currentTabs = openTabIds();
    const idx = currentTabs.indexOf(id);
    if (idx < 0) return;

    const remaining = currentTabs.filter((tabId) => tabId !== id);
    setOpenTabIds(remaining);

    if (activeNoteId() === id) {
      const nextId = remaining[idx - 1] ?? remaining[idx] ?? null;
      setActiveNoteId(nextId);
      if (!nextId) {
        setActiveScreen('home');
      }
    }
  };

  const closeOtherTabs = (keepId: string) => {
    if (!notes().some((n) => n.id === keepId)) return;
    setOpenTabIds([keepId]);
    setActiveNoteId(keepId);
    setActiveScreen('note');
  };

  const moveTab = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setOpenTabIds((prev) => {
      const fromIdx = prev.indexOf(fromId);
      const toIdx = prev.indexOf(toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // ==================== FOLDER MANAGEMENT ====================
  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setFilterMode('folder');
  };

  const selectFilterMode = (mode: Exclude<SidebarFilterMode, 'folder'>) => {
    setSelectedFolderId(null);
    setFilterMode(mode);
  };

  const createFolder = (
    name: string,
    color?: string,
    parentId: string | null = null,
    selectAfter = true
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const folder: Folder = {
      id: generateId(),
      name: trimmed,
      color: color || FOLDER_COLORS[folders().length % FOLDER_COLORS.length],
      parentId,
      createdAt: Date.now(),
    };
    setFolders((prev) => [...prev, folder]);
    if (selectAfter) {
      selectFolder(folder.id);
    }
    showToast(`Ordner „${folder.name}“ erstellt`);
    return folder;
  };

  const renameFolder = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
    );
  };

  const updateFolderColor = (id: string, color: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, color } : f)));
  };

  const deleteFolder = (id: string) => {
    const target = folders().find((f) => f.id === id);
    if (!target) return;
    const toRemove = getDescendantFolderIds(id);
    const fallbackParent = target.parentId;

    setFolders((prev) => prev.filter((f) => !toRemove.has(f.id)));
    // Move notes from deleted folder(s) safely to parent folder (or root), never deleting notes
    setNotes((prev) =>
      prev.map((n) =>
        n.folderId && toRemove.has(n.folderId)
          ? { ...n, folderId: fallbackParent, updatedAt: Date.now() }
          : n
      )
    );

    if (selectedFolderId() && toRemove.has(selectedFolderId()!)) {
      if (fallbackParent) {
        setSelectedFolderId(fallbackParent);
      } else {
        setSelectedFolderId(null);
        setFilterMode('all');
      }
    }
    showToast(`Ordner „${target.name}“ gelöscht (Notizen bleiben erhalten)`);
  };

  const moveNoteToFolder = (noteId: string, folderId: string | null) => {
    const note = notes().find((n) => n.id === noteId);
    if (!note || note.folderId === folderId) return;
    updateNoteById(noteId, (n) => ({
      ...n,
      folderId,
      updatedAt: Date.now(),
    }));
    if (folderId) {
      const folderName = folders().find((f) => f.id === folderId)?.name ?? 'Ordner';
      showToast(`In Ordner „${folderName}“ verschoben`);
    } else {
      showToast('Aus Ordner entfernt');
    }
  };

  const createNote = (explicitFolderId?: string | null) => {
    const targetFolderId =
      explicitFolderId !== undefined
        ? explicitFolderId
        : filterMode() === 'folder'
          ? selectedFolderId()
          : null;
    const s = settings();
    const preset = PAGE_SIZE_PRESETS.find((p) => p.id === s.defaultPagePresetId);
    const now = Date.now();
    const firstPage = createCanvasPage({
      title: 'Seite 1',
      width: preset?.width,
      height: preset?.height,
      paperConfig: { ...s.defaultPaperConfig },
    });
    const note: Note = {
      id: generateId(),
      title: '',
      content: '',
      tags: [],
      pinned: false,
      folderId: targetFolderId,
      attachments: [],
      pages: [firstPage],
      activePageId: firstPage.id,
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    setOpenTabIds((prev) => [...prev, note.id]);
    setActiveNoteId(note.id);
    setViewMode(s.defaultViewMode);
    setActiveScreen('note');
    if (window.innerWidth < 900) {
      setSidebarOpen(false);
    }
    showToast('Neue Notiz erstellt');
    return note;
  };

  const createNoteFromTemplate = (options: {
    title?: string;
    content?: string;
    tags?: string[];
    folderId?: string | null;
    pageTitle?: string;
    width?: number;
    height?: number;
    paperConfig?: Partial<PaperConfig>;
    viewMode?: ViewMode;
    settings?: Partial<NoteLocalSettings>;
  }) => {
    const now = Date.now();
    const targetFolderId =
      options.folderId !== undefined
        ? options.folderId
        : filterMode() === 'folder'
          ? selectedFolderId()
          : null;
    const firstPage = createCanvasPage({
      title: options.pageTitle ?? 'Seite 1',
      width: options.width,
      height: options.height,
      paperConfig: options.paperConfig,
    });
    const note: Note = {
      id: generateId(),
      title: options.title ?? '',
      content: options.content ?? '',
      tags: options.tags ?? [],
      pinned: false,
      folderId: targetFolderId,
      attachments: [],
      pages: [firstPage],
      activePageId: firstPage.id,
      ...(options.settings && Object.keys(options.settings).length > 0
        ? { settings: { ...options.settings } }
        : {}),
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    setOpenTabIds((prev) => [...prev, note.id]);
    setActiveNoteId(note.id);
    setViewMode(options.viewMode ?? settings().defaultViewMode);
    setActiveScreen('note');
    if (window.innerWidth < 900) {
      setSidebarOpen(false);
    }
    showToast(
      options.title ? `Vorlage „${options.title}“ erstellt` : 'Neue Notiz erstellt'
    );
    return note;
  };

  const createNoteWithPages = (
    title: string,
    pages: CanvasPage[],
    options?: {
      folderId?: string | null;
      viewMode?: ViewMode;
      tags?: string[];
      content?: string;
      canvasMode?: CanvasMode;
      attachments?: NoteImageAttachment[];
    }
  ) => {
    if (pages.length === 0) return null;
    const now = Date.now();
    const targetFolderId =
      options?.folderId !== undefined
        ? options.folderId
        : filterMode() === 'folder'
          ? selectedFolderId()
          : null;
    const localSettings: Partial<NoteLocalSettings> | undefined =
      options?.canvasMode && options.canvasMode !== settings().canvasMode
        ? { canvasMode: options.canvasMode }
        : undefined;
    const note: Note = {
      id: generateId(),
      title: title.trim() || 'Importiertes Dokument',
      content: options?.content ?? '',
      tags: options?.tags ?? [],
      pinned: false,
      folderId: targetFolderId,
      attachments: options?.attachments ?? [],
      pages,
      activePageId: pages[0].id,
      ...(localSettings ? { settings: localSettings } : {}),
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    setOpenTabIds((prev) => [...prev, note.id]);
    setActiveNoteId(note.id);
    setViewMode(options?.viewMode ?? settings().defaultViewMode);
    setActiveScreen('note');
    if (window.innerWidth < 900) {
      setSidebarOpen(false);
    }
    showToast(
      pages.length === 1
        ? `Notiz „${note.title}“ mit 1 Seite erstellt`
        : `Notiz „${note.title}“ mit ${pages.length} Seiten erstellt`
    );
    return note;
  };

  const openImportDialog = (options?: {
    payload?: QuickImportPayload | null;
    hint?: string | null;
    defaultTarget?: 'new' | 'existing';
  }) => {
    const resolvedTarget: 'new' | 'existing' =
      options?.defaultTarget ??
      (activeScreen() === 'note' && activeNote() ? 'existing' : 'new');
    setImportDialogPayload(options?.payload ?? null);
    setImportDialogHint(options?.hint ?? null);
    setImportDialogDefaultTarget(resolvedTarget);
    setImportDialogOpen(true);
  };

  const closeImportDialog = () => {
    setImportDialogOpen(false);
    setImportDialogHint(null);
  };

  const quickImportFromClipboard = async (defaultTarget?: 'new' | 'existing') => {
    const resolvedTarget: 'new' | 'existing' =
      defaultTarget ??
      (activeScreen() === 'note' && activeNote() ? 'existing' : 'new');
    const result = await readQuickImportFromClipboard();
    if (result.payload) {
      openImportDialog({
        payload: result.payload,
        hint: null,
        defaultTarget: resolvedTarget,
      });
      return;
    }

    const hint =
      result.error === 'shortcut_wrong_input'
        ? `Base64 ohne PDF-Daten erkannt. ${result.diagnostic ? `(${result.diagnostic}) ` : ''}Für PDFs auf iPadOS bitte „PDF / Bild wählen“ oder Drag & Drop im Split View nutzen.`
        : result.error === 'permission'
          ? 'Zugriff auf Zwischenablage abgebrochen — tippe unten auf „Aus Zwischenablage einfügen“ oder füge direkt ins Feld ein.'
          : result.error === 'empty'
            ? 'Kein lesbarer Inhalt in der Zwischenablage. Auf iPadOS funktionieren Bilder, Links & Text über „Teilen → Kopieren“ — für PDF-Dateien bitte „PDF / Bild wählen“ oder Drag & Drop im Split View nutzen.'
            : 'Tippe unten ins Einfüge-Feld (→ „Einsetzen“) oder wähle eine PDF-/Bilddatei.';

    openImportDialog({
      payload: null,
      hint,
      defaultTarget: resolvedTarget,
    });
  };

  const appendPagesToNote = (noteId: string, newPages: CanvasPage[]) => {
    const target = notes().find((n) => n.id === noteId);
    if (!target || newPages.length === 0) return null;

    updateNoteById(noteId, (curr) => ({
      ...curr,
      pages: [...curr.pages, ...newPages],
      activePageId: newPages[0].id,
      updatedAt: Date.now(),
    }));
    openNote(noteId);
    if (viewMode() === 'text') {
      setViewMode('canvas');
    }
    if (window.innerWidth < 900) {
      setSidebarOpen(false);
    }
    const label = target.title.trim() || 'Unbenannte Notiz';
    showToast(
      newPages.length === 1
        ? `1 Seite zu „${label}“ hinzugefügt`
        : `${newPages.length} Seiten zu „${label}“ hinzugefügt`
    );
    return newPages[0];
  };

  const appendTextToNote = (
    noteId: string,
    markdownBlock: string,
    options?: { tags?: string[]; attachments?: NoteImageAttachment[] }
  ) => {
    const target = notes().find((n) => n.id === noteId);
    const block = markdownBlock.trim();
    if (!target || !block) return;

    updateNoteById(noteId, (curr) => {
      const existing = curr.content.trimEnd();
      const nextContent = existing ? `${existing}\n\n${block}\n` : `${block}\n`;
      const nextTags = [...curr.tags];
      for (const t of options?.tags ?? []) {
        if (!nextTags.some((x) => x.toLowerCase() === t.toLowerCase())) {
          nextTags.push(t);
        }
      }
      return {
        ...curr,
        content: nextContent,
        tags: nextTags,
        attachments: options?.attachments?.length
          ? [...curr.attachments, ...options.attachments]
          : curr.attachments,
        updatedAt: Date.now(),
      };
    });
    openNote(noteId);
    if (viewMode() === 'canvas') {
      setViewMode('split');
    }
    if (window.innerWidth < 900) {
      setSidebarOpen(false);
    }
    const label = target.title.trim() || 'Unbenannte Notiz';
    showToast(`Inhalt zu „${label}“ hinzugefügt`);
  };

  const appendCanvasImagesToNote = (
    noteId: string,
    items: CanvasImageItem[],
    targetPageId?: string
  ) => {
    const target = notes().find((n) => n.id === noteId);
    if (!target || items.length === 0) return;
    const page =
      (targetPageId ? target.pages.find((p) => p.id === targetPageId) : undefined) ??
      target.pages.find((p) => p.id === target.activePageId) ??
      target.pages[0];
    if (!page) return;

    pushCanvasHistory(target.id, page.id, getPageSnapshot(page));
    updatePageById(target.id, page.id, (p) => ({
      ...p,
      images: [...p.images, ...items],
    }));
    openNote(noteId);
    if (viewMode() === 'text') {
      setViewMode('canvas');
    }
    if (window.innerWidth < 900) {
      setSidebarOpen(false);
    }
    const label = target.title.trim() || 'Unbenannte Notiz';
    showToast(
      items.length === 1
        ? `Bild auf „${label}“ eingefügt`
        : `${items.length} Bilder auf „${label}“ eingefügt`
    );
  };

  const duplicateNote = (id: string) => {
    const original = notes().find((n) => n.id === id);
    if (!original) return;
    const now = Date.now();
    const clonedPages: CanvasPage[] = original.pages.map((page) => ({
      ...page,
      id: generateId(),
      paperConfig: { ...page.paperConfig },
      backgroundImage: page.backgroundImage ? { ...page.backgroundImage } : null,
      strokes: page.strokes.map((s) => ({
        ...s,
        id: generateId(),
        points: s.points.map((pt) => ({ ...pt })),
      })),
      texts: page.texts.map((t) => ({ ...t, id: generateId() })),
      images: page.images.map((img) => ({ ...img, id: generateId() })),
    }));
    const copy: Note = {
      ...original,
      id: generateId(),
      title: original.title ? `${original.title} (Kopie)` : 'Unbenannte Kopie',
      pinned: false,
      tags: [...original.tags],
      attachments: original.attachments.map((a) => ({ ...a })),
      pages: clonedPages,
      activePageId: clonedPages[0].id,
      ...(original.settings ? { settings: { ...original.settings } } : {}),
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [copy, ...prev]);
    setOpenTabIds((prev) => {
      const origIdx = prev.indexOf(id);
      if (origIdx >= 0) {
        const next = [...prev];
        next.splice(origIdx + 1, 0, copy.id);
        return next;
      }
      return [...prev, copy.id];
    });
    setActiveNoteId(copy.id);
    setActiveScreen('note');
    showToast('Notiz dupliziert');
  };

  const deleteNote = (id: string) => {
    const prevTabs = openTabIds();
    const tabIdx = prevTabs.indexOf(id);
    const remainingTabs = prevTabs.filter((t) => t !== id);
    setOpenTabIds(remainingTabs);

    setNotes((prev) => {
      const remaining = prev.filter((n) => n.id !== id);
      if (activeNoteId() === id) {
        const nextFromTabs =
          remainingTabs[tabIdx - 1] ?? remainingTabs[tabIdx] ?? null;
        if (nextFromTabs) {
          setActiveNoteId(nextFromTabs);
        } else if (remaining[0]) {
          setOpenTabIds([remaining[0].id]);
          setActiveNoteId(remaining[0].id);
        } else {
          setActiveNoteId(null);
          setActiveScreen('home');
        }
      }
      return remaining;
    });
    setHistories((prev) => {
      const next: Record<string, HistoryState> = {};
      const prefix = `${id}:`;
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      return next;
    });
    showToast('Notiz gelöscht');
  };

  const togglePin = (id: string) => {
    updateNoteById(id, (n) => ({
      ...n,
      pinned: !n.pinned,
      updatedAt: Date.now(),
    }));
  };

  const updateTitle = (title: string) => {
    const id = activeNoteId();
    if (!id) return;
    updateNoteById(id, (n) => ({ ...n, title, updatedAt: Date.now() }));
  };

  const updateContent = (content: string) => {
    const id = activeNoteId();
    if (!id) return;
    updateNoteById(id, (n) => ({ ...n, content, updatedAt: Date.now() }));
  };

  const addNoteAttachment = (attachment: NoteImageAttachment) => {
    const id = activeNoteId();
    if (!id) return;
    updateNoteById(id, (n) => ({
      ...n,
      attachments: [...n.attachments, attachment],
      updatedAt: Date.now(),
    }));
  };

  const addTag = (rawTag: string) => {
    const id = activeNoteId();
    const tag = rawTag.trim().replace(/^#/, '');
    if (!id || !tag) return;
    updateNoteById(id, (n) => {
      if (n.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return n;
      return { ...n, tags: [...n.tags, tag], updatedAt: Date.now() };
    });
  };

  const removeTag = (tag: string) => {
    const id = activeNoteId();
    if (!id) return;
    updateNoteById(id, (n) => ({
      ...n,
      tags: n.tags.filter((t) => t !== tag),
      updatedAt: Date.now(),
    }));
  };

  // ==================== PAGE MANAGEMENT ====================
  const setActivePage = (pageId: string) => {
    const n = activeNote();
    if (!n || !n.pages.some((p) => p.id === pageId)) return;
    updateNoteById(n.id, (curr) => ({ ...curr, activePageId: pageId }));
  };

  const addPage = (options?: {
    title?: string;
    width?: number;
    height?: number;
    paperConfig?: Partial<PaperConfig>;
  }) => {
    const n = activeNote();
    const current = activePage();
    if (!n) return;
    const newPage = createCanvasPage({
      title: options?.title?.trim() || `Seite ${n.pages.length + 1}`,
      width: options?.width ?? current?.width,
      height: options?.height ?? current?.height,
      paperConfig: options?.paperConfig ?? (current ? { ...current.paperConfig } : undefined),
    });
    updateNoteById(n.id, (curr) => ({
      ...curr,
      pages: [...curr.pages, newPage],
      activePageId: newPage.id,
      updatedAt: Date.now(),
    }));
    showToast(`Neue Seite (${newPage.width} × ${newPage.height}) hinzugefügt`);
    return newPage;
  };

  const appendPages = (newPages: CanvasPage[]) => {
    const n = activeNote();
    if (!n || newPages.length === 0) return null;

    // If the current note only has 1 completely blank untitled default page, offer seamless append
    updateNoteById(n.id, (curr) => ({
      ...curr,
      pages: [...curr.pages, ...newPages],
      activePageId: newPages[0].id,
      updatedAt: Date.now(),
    }));
    showToast(
      newPages.length === 1
        ? `Seite „${newPages[0].title}“ hinzugefügt`
        : `${newPages.length} Seiten importiert`
    );
    return newPages[0];
  };

  const updatePageBackgroundImage = (
    pageId: string,
    patch: Partial<PageBackgroundImage> | null
  ) => {
    const n = activeNote();
    if (!n) return;
    updatePageById(n.id, pageId, (p) => {
      if (patch === null) {
        return { ...p, backgroundImage: null };
      }
      if (!p.backgroundImage) return p;
      return {
        ...p,
        backgroundImage: { ...p.backgroundImage, ...patch },
      };
    });
  };

  const duplicatePage = (pageId: string) => {
    const n = activeNote();
    if (!n) return;
    const idx = n.pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    const orig = n.pages[idx];
    const copy: CanvasPage = {
      ...orig,
      id: generateId(),
      title: `${orig.title} (Kopie)`,
      paperConfig: { ...orig.paperConfig },
      backgroundImage: orig.backgroundImage ? { ...orig.backgroundImage } : null,
      strokes: orig.strokes.map((s) => ({
        ...s,
        id: generateId(),
        points: s.points.map((pt) => ({ ...pt })),
      })),
      texts: orig.texts.map((t) => ({ ...t, id: generateId() })),
      images: orig.images.map((img) => ({ ...img, id: generateId() })),
    };
    const nextPages = [...n.pages];
    nextPages.splice(idx + 1, 0, copy);
    updateNoteById(n.id, (curr) => ({
      ...curr,
      pages: nextPages,
      activePageId: copy.id,
      updatedAt: Date.now(),
    }));
    showToast('Seite dupliziert');
  };

  const deletePage = (pageId: string) => {
    const n = activeNote();
    if (!n || n.pages.length <= 1) {
      showToast('Die letzte Seite kann nicht gelöscht werden');
      return;
    }
    const idx = n.pages.findIndex((p) => p.id === pageId);
    if (idx < 0) return;
    const remaining = n.pages.filter((p) => p.id !== pageId);
    const nextActiveId =
      n.activePageId === pageId
        ? remaining[Math.min(idx, remaining.length - 1)].id
        : n.activePageId;

    updateNoteById(n.id, (curr) => ({
      ...curr,
      pages: remaining,
      activePageId: nextActiveId,
      updatedAt: Date.now(),
    }));
    setHistories((prev) => {
      const next = { ...prev };
      delete next[historyKey(n.id, pageId)];
      return next;
    });
    showToast('Seite gelöscht');
  };

  const movePage = (pageId: string, direction: -1 | 1) => {
    const n = activeNote();
    if (!n) return;
    const idx = n.pages.findIndex((p) => p.id === pageId);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= n.pages.length) return;
    const nextPages = [...n.pages];
    const [moved] = nextPages.splice(idx, 1);
    nextPages.splice(targetIdx, 0, moved);
    updateNoteById(n.id, (curr) => ({
      ...curr,
      pages: nextPages,
      updatedAt: Date.now(),
    }));
  };

  const reorderPage = (
    fromPageId: string,
    toPageId: string,
    position: 'before' | 'after' = 'before'
  ) => {
    const n = activeNote();
    if (!n || fromPageId === toPageId) return;
    const fromIdx = n.pages.findIndex((p) => p.id === fromPageId);
    if (fromIdx < 0) return;

    const nextPages = [...n.pages];
    const [moved] = nextPages.splice(fromIdx, 1);
    const targetIdx = nextPages.findIndex((p) => p.id === toPageId);
    if (targetIdx < 0) return;

    const insertIdx = position === 'after' ? targetIdx + 1 : targetIdx;
    nextPages.splice(insertIdx, 0, moved);

    updateNoteById(n.id, (curr) => ({
      ...curr,
      pages: nextPages,
      updatedAt: Date.now(),
    }));
    showToast(`Seite „${moved.title}“ verschoben`);
  };

  const movePageToNote = (pageId: string, targetNoteId: string) => {
    const sourceNote = activeNote();
    const targetNote = notes().find((n) => n.id === targetNoteId);
    if (!sourceNote || !targetNote || sourceNote.id === targetNote.id) return;
    if (sourceNote.pages.length <= 1) {
      showToast('Die letzte Seite einer Notiz kann nicht verschoben werden');
      return;
    }

    const pageIdx = sourceNote.pages.findIndex((p) => p.id === pageId);
    if (pageIdx < 0) return;
    const pageToMove = sourceNote.pages[pageIdx];

    const remainingSourcePages = sourceNote.pages.filter((p) => p.id !== pageId);
    const nextSourceActiveId =
      sourceNote.activePageId === pageId
        ? remainingSourcePages[Math.min(pageIdx, remainingSourcePages.length - 1)].id
        : sourceNote.activePageId;

    const now = Date.now();
    setNotes((prev) =>
      prev.map((n) => {
        if (n.id === sourceNote.id) {
          return {
            ...n,
            pages: remainingSourcePages,
            activePageId: nextSourceActiveId,
            updatedAt: now,
          };
        }
        if (n.id === targetNote.id) {
          return {
            ...n,
            pages: [...n.pages, pageToMove],
            activePageId: pageToMove.id,
            updatedAt: now,
          };
        }
        return n;
      })
    );
    showToast(
      `Seite „${pageToMove.title}“ nach „${targetNote.title.trim() || 'Unbenannte Notiz'}“ verschoben`
    );
  };

  const updatePageProperties = (
    pageId: string,
    patch: { title?: string; width?: number; height?: number }
  ) => {
    const n = activeNote();
    if (!n) return;
    updatePageById(n.id, pageId, (p) => ({
      ...p,
      title: patch.title !== undefined ? patch.title : p.title,
      width: patch.width !== undefined ? clampPageWidth(patch.width) : p.width,
      height: patch.height !== undefined ? clampPageHeight(patch.height) : p.height,
    }));
  };

  // ==================== PAGE CANVAS OPS ====================
  const resolveTargetPage = (targetPageId?: string): { note: Note; page: CanvasPage } | null => {
    const n = activeNote();
    if (!n) return null;
    const p = targetPageId
      ? n.pages.find((item) => item.id === targetPageId)
      : activePage();
    if (!p) return null;
    return { note: n, page: p };
  };

  const getPageSnapshot = (page: CanvasPage): CanvasSnapshot => ({
    strokes: page.strokes,
    texts: page.texts,
    images: page.images,
  });

  const pushCanvasHistory = (noteId: string, pageId: string, previous: CanvasSnapshot) => {
    const key = historyKey(noteId, pageId);
    setHistories((prev) => {
      const curr = prev[key] ?? { past: [], future: [] };
      const past = [...curr.past, previous].slice(-MAX_HISTORY);
      return {
        ...prev,
        [key]: { past, future: [] },
      };
    });
  };

  const commitCanvasSnapshot = (
    next: CanvasSnapshot,
    previousOverride?: CanvasSnapshot,
    targetPageId?: string
  ) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { note: n, page: p } = resolved;
    pushCanvasHistory(n.id, p.id, previousOverride ?? getPageSnapshot(p));
    updatePageById(n.id, p.id, (page) => ({
      ...page,
      strokes: next.strokes,
      texts: next.texts,
      images: next.images,
    }));
  };

  const addStroke = (stroke: Stroke, targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    commitCanvasSnapshot(
      {
        strokes: [...p.strokes, stroke],
        texts: p.texts,
        images: p.images,
      },
      undefined,
      p.id
    );
  };

  const upsertCanvasText = (item: CanvasTextItem, targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    const trimmed = item.text.trim();
    const exists = p.texts.some((t) => t.id === item.id);

    if (!trimmed) {
      if (exists) {
        commitCanvasSnapshot(
          {
            strokes: p.strokes,
            texts: p.texts.filter((t) => t.id !== item.id),
            images: p.images,
          },
          undefined,
          p.id
        );
      }
      return;
    }

    const nextTexts = exists
      ? p.texts.map((t) => (t.id === item.id ? item : t))
      : [...p.texts, item];

    commitCanvasSnapshot(
      {
        strokes: p.strokes,
        texts: nextTexts,
        images: p.images,
      },
      undefined,
      p.id
    );
  };

  const deleteCanvasText = (textId: string, targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    if (!p.texts.some((t) => t.id === textId)) return;
    commitCanvasSnapshot(
      {
        strokes: p.strokes,
        texts: p.texts.filter((t) => t.id !== textId),
        images: p.images,
      },
      undefined,
      p.id
    );
  };

  const addCanvasImages = (items: CanvasImageItem[], targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved || items.length === 0) return;
    const { note: n, page: p } = resolved;

    pushCanvasHistory(n.id, p.id, getPageSnapshot(p));
    updatePageById(n.id, p.id, (page) => ({
      ...page,
      images: [...page.images, ...items],
    }));
  };

  const updateCanvasImageLive = (item: CanvasImageItem, targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { note: n, page: p } = resolved;
    updatePageById(n.id, p.id, (page) => ({
      ...page,
      images: page.images.map((img) => (img.id === item.id ? item : img)),
    }));
  };

  const updateCanvasImage = (
    item: CanvasImageItem,
    previousOverride?: CanvasSnapshot,
    targetPageId?: string
  ) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    commitCanvasSnapshot(
      {
        strokes: p.strokes,
        texts: p.texts,
        images: p.images.map((img) => (img.id === item.id ? item : img)),
      },
      previousOverride,
      p.id
    );
  };

  const deleteCanvasImage = (imageId: string, targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    if (!p.images.some((img) => img.id === imageId)) return;
    commitCanvasSnapshot(
      {
        strokes: p.strokes,
        texts: p.texts,
        images: p.images.filter((img) => img.id !== imageId),
      },
      undefined,
      p.id
    );
  };

  const reorderCanvasImage = (
    imageId: string,
    direction: 'front' | 'back',
    targetPageId?: string
  ) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    const target = p.images.find((img) => img.id === imageId);
    if (!target || p.images.length < 2) return;
    const others = p.images.filter((img) => img.id !== imageId);
    const nextImages = direction === 'front' ? [...others, target] : [target, ...others];
    commitCanvasSnapshot(
      {
        strokes: p.strokes,
        texts: p.texts,
        images: nextImages,
      },
      undefined,
      p.id
    );
  };

  const clearCanvas = (targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { page: p } = resolved;
    if (p.strokes.length === 0 && p.texts.length === 0 && p.images.length === 0) {
      return;
    }
    commitCanvasSnapshot({ strokes: [], texts: [], images: [] }, undefined, p.id);
    showToast(`Seite „${p.title}“ geleert (mit Rückgängig wiederherstellbar)`);
  };

  const undoCanvas = () => {
    const n = activeNote();
    const p = activePage();
    if (!n || !p) return;
    const key = historyKey(n.id, p.id);
    const hist = histories()[key];
    if (!hist || hist.past.length === 0) return;

    const previous = hist.past[hist.past.length - 1];
    const nextPast = hist.past.slice(0, -1);
    const nextFuture = [getPageSnapshot(p), ...hist.future].slice(0, MAX_HISTORY);

    setHistories((prev) => ({
      ...prev,
      [key]: { past: nextPast, future: nextFuture },
    }));

    updatePageById(n.id, p.id, (page) => ({
      ...page,
      strokes: previous.strokes,
      texts: previous.texts,
      images: previous.images,
    }));
  };

  const redoCanvas = () => {
    const n = activeNote();
    const p = activePage();
    if (!n || !p) return;
    const key = historyKey(n.id, p.id);
    const hist = histories()[key];
    if (!hist || hist.future.length === 0) return;

    const next = hist.future[0];
    const nextFuture = hist.future.slice(1);
    const nextPast = [...hist.past, getPageSnapshot(p)].slice(-MAX_HISTORY);

    setHistories((prev) => ({
      ...prev,
      [key]: { past: nextPast, future: nextFuture },
    }));

    updatePageById(n.id, p.id, (page) => ({
      ...page,
      strokes: next.strokes,
      texts: next.texts,
      images: next.images,
    }));
  };

  const updatePaperConfig = (patch: Partial<PaperConfig>) => {
    const n = activeNote();
    const p = activePage();
    if (!n || !p) return;
    updatePageById(n.id, p.id, (page) => ({
      ...page,
      paperConfig: { ...page.paperConfig, ...patch },
    }));
  };

  const extendCanvasHeight = (delta = 400, targetPageId?: string) => {
    const resolved = resolveTargetPage(targetPageId);
    if (!resolved) return;
    const { note: n, page: p } = resolved;
    const nextHeight = clampPageHeight(p.height + delta);
    updatePageById(n.id, p.id, (page) => ({
      ...page,
      height: nextHeight,
    }));
    showToast(`Höhe von „${p.title}“ auf ${nextHeight} px erweitert`);
  };

  const importNotesFromJson = (jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const rawNotes = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray(parsed.notes)
          ? parsed.notes
          : null;

      if (!rawNotes) {
        showToast('Ungültiges Backup-Format');
        return;
      }

      // Import folders (remapping IDs cleanly to avoid collisions)
      const folderIdMap = new Map<string, string>();
      const importedFolders: Folder[] = [];
      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.folders)) {
        const rawFolders = parsed.folders
          .filter((item: unknown): item is Record<string, unknown> =>
            Boolean(item && typeof item === 'object')
          )
          .map(normalizeFolder);

        for (const f of rawFolders) {
          folderIdMap.set(f.id, generateId());
        }
        for (const f of rawFolders) {
          importedFolders.push({
            ...f,
            id: folderIdMap.get(f.id)!,
            parentId: f.parentId ? folderIdMap.get(f.parentId) ?? null : null,
          });
        }
      }

      const importedNotes: Note[] = rawNotes
        .filter((item: unknown): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object')
        )
        .map((item: Record<string, unknown>) => {
          const norm = normalizeNote(item);
          return {
            ...norm,
            id: generateId(),
            folderId: norm.folderId ? folderIdMap.get(norm.folderId) ?? null : null,
            updatedAt: Date.now(),
          };
        });

      if (importedNotes.length === 0) {
        showToast('Keine gültigen Notizen in der Datei gefunden');
        return;
      }

      if (importedFolders.length > 0) {
        setFolders((prev) => [...prev, ...importedFolders]);
      }
      setNotes((prev) => [...importedNotes, ...prev]);
      openNote(importedNotes[0].id);
      showToast(
        importedFolders.length > 0
          ? `${importedNotes.length} Notiz(en) & ${importedFolders.length} Ordner importiert`
          : `${importedNotes.length} Notiz(en) importiert`
      );
    } catch {
      showToast('Fehler beim Lesen der JSON-Datei');
    }
  };

  const applyCloudImport = (payload: {
    upsertNotes: Note[];
    upsertFolders: Folder[];
    settings?: AppSettings | null;
  }) => {
    const incomingFolders = payload.upsertFolders;
    const incomingNotes = payload.upsertNotes;

    batch(() => {
      if (incomingFolders.length > 0) {
        setFolders((prev) => {
          const map = new Map(prev.map((f) => [f.id, f]));
          for (const f of incomingFolders) {
            map.set(f.id, f);
          }
          const merged = [...map.values()];
          const validIds = new Set(merged.map((f) => f.id));
          return merged
            .map((f) => ({
              ...f,
              parentId:
                f.parentId && validIds.has(f.parentId) && f.parentId !== f.id
                  ? f.parentId
                  : null,
            }))
            .sort((a, b) => a.createdAt - b.createdAt);
        });
      }

      if (incomingNotes.length > 0) {
        const replacedIds = new Set(incomingNotes.map((n) => n.id));
        const validFolderIds = new Set(folders().map((f) => f.id));
        for (const f of incomingFolders) validFolderIds.add(f.id);

        setNotes((prev) => {
          const map = new Map(prev.map((n) => [n.id, n]));
          for (const n of incomingNotes) {
            map.set(n.id, {
              ...n,
              folderId: n.folderId && validFolderIds.has(n.folderId) ? n.folderId : null,
            });
          }
          return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
        });

        // Clear stale undo history only for notes whose contents were replaced
        setHistories((prev) => {
          const next: Record<string, HistoryState> = {};
          for (const [k, v] of Object.entries(prev)) {
            const noteId = k.split(':')[0];
            if (!replacedIds.has(noteId)) next[k] = v;
          }
          return next;
        });
      }

      if (payload.settings) {
        setSettings({
          ...payload.settings,
          defaultPaperConfig: { ...payload.settings.defaultPaperConfig },
        });
      }
    });
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return {
    isHydrated,
    storageBackend,
    notes,
    folders,
    activeNoteId,
    setActiveNoteId,
    activeScreen,
    settingsTab,
    setSettingsTab,
    openSettings,
    closeSettings,
    settings,
    effectiveSettings,
    activeNoteLocalOverrideCount,
    updateSettings,
    updateDefaultPaperConfig,
    resetSettings,
    updateNoteSettings,
    resetNoteSettings,
    openHome,
    openFolderInHome,
    openTabIds,
    openNote,
    closeTab,
    closeOtherTabs,
    moveTab,
    activeNote,
    activePage,
    activePageIndex,
    filteredNotes,
    searchQuery,
    setSearchQuery,
    filterMode,
    setFilterMode,
    selectedFolderId,
    selectFolder,
    selectFilterMode,
    getFolderNoteCount,
    createFolder,
    renameFolder,
    updateFolderColor,
    deleteFolder,
    moveNoteToFolder,
    viewMode,
    setViewMode,
    theme,
    toggleTheme,
    sidebarOpen,
    setSidebarOpen,
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
    toastMessage,
    showToast,
    importDialogOpen,
    importDialogPayload,
    setImportDialogPayload,
    importDialogHint,
    setImportDialogHint,
    importDialogDefaultTarget,
    openImportDialog,
    closeImportDialog,
    quickImportFromClipboard,
    cloudSyncOpen,
    cloudSyncTab,
    setCloudSyncTab,
    cloudConfigVersion,
    bumpCloudConfigVersion,
    isCloudConfigured,
    openCloudSync,
    closeCloudSync,
    applyCloudImport,
    canUndo,
    canRedo,
    createNote,
    createNoteFromTemplate,
    createNoteWithPages,
    appendPagesToNote,
    appendTextToNote,
    appendCanvasImagesToNote,
    duplicateNote,
    deleteNote,
    togglePin,
    updateTitle,
    updateContent,
    addNoteAttachment,
    addTag,
    removeTag,
    setActivePage,
    addPage,
    appendPages,
    updatePageBackgroundImage,
    duplicatePage,
    deletePage,
    movePage,
    reorderPage,
    movePageToNote,
    updatePageProperties,
    addStroke,
    commitCanvasSnapshot,
    upsertCanvasText,
    deleteCanvasText,
    addCanvasImages,
    updateCanvasImageLive,
    updateCanvasImage,
    deleteCanvasImage,
    reorderCanvasImage,
    clearCanvas,
    undoCanvas,
    redoCanvas,
    updatePaperConfig,
    extendCanvasHeight,
    importNotesFromJson,
  };
}

export type NotesStore = ReturnType<typeof createNotesStore>;
