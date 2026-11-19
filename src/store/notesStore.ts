import { createEffect, createMemo, createSignal } from 'solid-js';
import {
  FOLDER_COLORS,
  type CanvasImageItem,
  type CanvasPage,
  type CanvasSnapshot,
  type CanvasTextItem,
  type Folder,
  type HistoryState,
  type Note,
  type NoteImageAttachment,
  type PageBackgroundImage,
  type PaperConfig,
  type Stroke,
  type ThemeMode,
  type ViewMode,
} from '../types';
import {
  clampPageHeight,
  clampPageWidth,
  createCanvasPage,
  createEmptyNote,
  generateId,
  loadActiveNoteId,
  loadActiveScreen,
  loadInitialWorkspace,
  loadOpenTabIds,
  loadTheme,
  loadViewMode,
  normalizeFolder,
  normalizeNote,
  saveActiveNoteId,
  saveActiveScreen,
  saveFolders,
  saveNotes,
  saveOpenTabIds,
  saveTheme,
  saveViewMode,
} from '../utils/storage';

export type SidebarFilterMode = 'all' | 'pinned' | 'unfiled' | 'folder';

const MAX_HISTORY = 50;

export function createNotesStore() {
  const { notes: initialNotes, folders: initialFolders } = loadInitialWorkspace();
  const savedActiveId = loadActiveNoteId();
  const initialActiveId =
    savedActiveId && initialNotes.some((n) => n.id === savedActiveId)
      ? savedActiveId
      : initialNotes[0]?.id ?? null;

  const validNoteIds = new Set(initialNotes.map((n) => n.id));
  const savedTabs = loadOpenTabIds().filter((id) => validNoteIds.has(id));
  const initialTabIds =
    savedTabs.length > 0
      ? initialActiveId && !savedTabs.includes(initialActiveId)
        ? [...savedTabs, initialActiveId]
        : savedTabs
      : initialActiveId
        ? [initialActiveId]
        : [];

  const [notes, setNotes] = createSignal<Note[]>(initialNotes);
  const [folders, setFolders] = createSignal<Folder[]>(initialFolders);
  const [activeNoteId, setActiveNoteId] = createSignal<string | null>(initialActiveId);
  const [openTabIds, setOpenTabIds] = createSignal<string[]>(initialTabIds);
  const [activeScreen, setActiveScreen] = createSignal<'home' | 'note'>(
    initialActiveId ? loadActiveScreen() : 'home'
  );
  const [searchQuery, setSearchQuery] = createSignal('');
  const [filterMode, setFilterMode] = createSignal<SidebarFilterMode>('all');
  const [selectedFolderId, setSelectedFolderId] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>(loadViewMode());
  const [theme, setTheme] = createSignal<ThemeMode>(loadTheme());
  const [sidebarOpen, setSidebarOpen] = createSignal(
    typeof window !== 'undefined' ? window.innerWidth >= 900 : true
  );
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);

  // Per-page undo/redo stacks keyed by `${noteId}:${pageId}`
  const [histories, setHistories] = createSignal<Record<string, HistoryState>>({});

  let toastTimer: number | undefined;
  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToastMessage(null), 2600);
  };

  let saveTimer: number | undefined;
  createEffect(() => {
    const currentNotes = notes();
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const ok = saveNotes(currentNotes);
      if (!ok) {
        showToast('Speicher voll: Bitte kleinere Bilder verwenden oder alte Notizen löschen.');
      }
    }, 220);
  });

  createEffect(() => {
    const currentTheme = theme();
    saveTheme(currentTheme);
    document.documentElement.setAttribute('data-theme', currentTheme);
  });

  createEffect(() => {
    saveViewMode(viewMode());
  });

  createEffect(() => {
    saveActiveNoteId(activeNoteId());
  });

  createEffect(() => {
    saveOpenTabIds(openTabIds());
  });

  createEffect(() => {
    saveFolders(folders());
  });

  createEffect(() => {
    saveActiveScreen(activeScreen());
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
    parentId: string | null = null
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
    selectFolder(folder.id);
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
    const note = createEmptyNote('', targetFolderId);
    setNotes((prev) => [note, ...prev]);
    setOpenTabIds((prev) => [...prev, note.id]);
    setActiveNoteId(note.id);
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
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    setOpenTabIds((prev) => [...prev, note.id]);
    setActiveNoteId(note.id);
    if (options.viewMode) {
      setViewMode(options.viewMode);
    }
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
    options?: { folderId?: string | null; viewMode?: ViewMode; tags?: string[] }
  ) => {
    if (pages.length === 0) return null;
    const now = Date.now();
    const targetFolderId =
      options?.folderId !== undefined
        ? options.folderId
        : filterMode() === 'folder'
          ? selectedFolderId()
          : null;
    const note: Note = {
      id: generateId(),
      title: title.trim() || 'Importiertes Dokument',
      content: '',
      tags: options?.tags ?? [],
      pinned: false,
      folderId: targetFolderId,
      attachments: [],
      pages,
      activePageId: pages[0].id,
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [note, ...prev]);
    setOpenTabIds((prev) => [...prev, note.id]);
    setActiveNoteId(note.id);
    if (options?.viewMode) {
      setViewMode(options.viewMode);
    }
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

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return {
    notes,
    folders,
    activeNoteId,
    setActiveNoteId,
    activeScreen,
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
    toastMessage,
    showToast,
    canUndo,
    canRedo,
    createNote,
    createNoteFromTemplate,
    createNoteWithPages,
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
