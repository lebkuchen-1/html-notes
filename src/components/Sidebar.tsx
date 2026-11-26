import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { NotesStore } from '../store/notesStore';
import { FOLDER_COLORS, type Folder, type Note } from '../types';
import { exportNotesAsJson } from '../utils/storage';
import {
  IconChevronDown,
  IconChevronRight,
  IconClipboardPaste,
  IconCloud,
  IconCopy,
  IconDownload,
  IconEdit,
  IconFileText,
  IconFlashcards,
  IconFolder,
  IconFolderPlus,
  IconHome,
  IconMoreHorizontal,
  IconPen,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUpload,
  IconX,
} from './Icons';

interface SidebarProps {
  store: NotesStore;
}

type SidebarDragItem =
  | {
      kind: 'folder';
      id: string;
      label: string;
      color: string;
      parentId: string | null;
    }
  | {
      kind: 'note';
      id: string;
      label: string;
      folderId: string | null;
      hasCanvas: boolean;
    };

type SidebarDropTarget =
  | { kind: 'folder'; folderId: string; position: 'before' | 'inside' | 'after' }
  | { kind: 'note'; noteId: string; folderId: string | null; position: 'before' | 'after' }
  | { kind: 'folder-root' }
  | { kind: 'note-root' };

interface PendingSidebarDrag {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  item: SidebarDragItem;
  descendants: Set<string> | null;
}

const MOUSE_DRAG_THRESHOLD_PX = 6;
const TOUCH_CANCEL_THRESHOLD_PX = 10;
const TOUCH_HOLD_DELAY_MS = 240;
const PEN_HOLD_DELAY_MS = 190;
const AUTO_EXPAND_DELAY_MS = 480;
const EDGE_SCROLL_ZONE_PX = 44;

function compareFolders(a: Folder, b: Folder): number {
  const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.createdAt - b.createdAt;
}

function compareNotesInFolder(a: Note, b: Note): number {
  const aHas = a.sortOrder !== undefined;
  const bHas = b.sortOrder !== undefined;
  if (aHas !== bHas) return aHas ? 1 : -1;
  if (aHas && bHas && a.sortOrder !== b.sortOrder) {
    return a.sortOrder! - b.sortOrder!;
  }
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

export function Sidebar(props: SidebarProps) {
  let sidebarRef: HTMLElement | undefined;
  let explorerRef: HTMLDivElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let quickMenuRef: HTMLDivElement | undefined;

  const [creatingParentId, setCreatingParentId] = createSignal<string | null | undefined>(
    undefined
  );
  const [newFolderName, setNewFolderName] = createSignal('');
  const [newFolderColor, setNewFolderColor] = createSignal<string>(FOLDER_COLORS[0]);

  const [renamingFolderId, setRenamingFolderId] = createSignal<string | null>(null);
  const [renameDraft, setRenameDraft] = createSignal('');
  const [collapsedIds, setCollapsedIds] = createSignal<Set<string>>(new Set());
  const [favoritesCollapsed, setFavoritesCollapsed] = createSignal<boolean>(true);
  const [treeFilter, setTreeFilter] = createSignal('');
  const [quickMenuOpen, setQuickMenuOpen] = createSignal(false);

  // Unified Pointer Drag & Drop state (Desktop Mouse + iPadOS Touch & Apple Pencil)
  const [activeDrag, setActiveDrag] = createSignal<SidebarDragItem | null>(null);
  const [dragPointerType, setDragPointerType] = createSignal<string>('mouse');
  const [dragPos, setDragPos] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dropTarget, setDropTarget] = createSignal<SidebarDropTarget | null>(null);

  let pendingDrag: PendingSidebarDrag | null = null;
  let holdTimer: number | undefined;
  let autoExpandTimer: number | undefined;
  let autoExpandFolderId: string | null = null;
  let autoScrollRaf: number | undefined;
  let suppressClickUntil = 0;

  const clearHoldTimer = () => {
    if (holdTimer !== undefined) {
      window.clearTimeout(holdTimer);
      holdTimer = undefined;
    }
  };

  const clearAutoExpandTimer = () => {
    if (autoExpandTimer !== undefined) {
      window.clearTimeout(autoExpandTimer);
      autoExpandTimer = undefined;
    }
    autoExpandFolderId = null;
  };

  const stopAutoScroll = () => {
    if (autoScrollRaf !== undefined) {
      window.cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = undefined;
    }
  };

  const updateBodyDragClass = (active: boolean) => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('is-sidebar-dragging', active);
  };

  let windowListenersAttached = false;
  let detachListenersFn: (() => void) | null = null;

  const cancelDrag = () => {
    clearHoldTimer();
    clearAutoExpandTimer();
    stopAutoScroll();
    if (windowListenersAttached && detachListenersFn) {
      detachListenersFn();
    }
    pendingDrag = null;
    if (activeDrag()) {
      setActiveDrag(null);
      setDropTarget(null);
      updateBodyDragClass(false);
    }
  };

  // Close Quick Menu & cancel any active drag whenever sidebar closes
  createEffect(() => {
    if (!props.store.sidebarOpen()) {
      setQuickMenuOpen(false);
      cancelDrag();
    }
  });

  onMount(() => {
    const handleOutside = (e: Event) => {
      if (!quickMenuOpen()) return;
      const target = e.target as Node | null;
      if (!target || !quickMenuRef?.contains(target)) {
        setQuickMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeDrag() || pendingDrag) {
          e.preventDefault();
          cancelDrag();
          return;
        }
        if (quickMenuOpen()) {
          e.preventDefault();
          setQuickMenuOpen(false);
        }
      }
    };
    document.addEventListener('pointerdown', handleOutside, { capture: true });
    document.addEventListener('touchstart', handleOutside, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      cancelDrag();
      document.removeEventListener('pointerdown', handleOutside, { capture: true });
      document.removeEventListener('touchstart', handleOutside, { capture: true });
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  const query = () => treeFilter().trim().toLowerCase();

  const matchesQuery = (note: Note): boolean => {
    const q = query();
    if (!q) return true;
    return (
      note.title.toLowerCase().includes(q) ||
      note.content.toLowerCase().includes(q) ||
      note.tags.some((t) => t.toLowerCase().includes(q)) ||
      note.pages.some(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.texts.some((t) => t.text.toLowerCase().includes(q))
      )
    );
  };

  const folderMatchesOrHasMatchingDescendant = (folderId: string): boolean => {
    const q = query();
    if (!q) return true;
    const folder = props.store.folders().find((f) => f.id === folderId);
    if (folder?.name.toLowerCase().includes(q)) return true;
    if (props.store.notes().some((n) => n.folderId === folderId && matchesQuery(n))) {
      return true;
    }
    return props.store
      .folders()
      .some(
        (child) =>
          child.parentId === folderId && folderMatchesOrHasMatchingDescendant(child.id)
      );
  };

  const rootFolders = createMemo(() =>
    props.store
      .folders()
      .filter((f) => f.parentId === null && folderMatchesOrHasMatchingDescendant(f.id))
      .sort(compareFolders)
  );

  const getChildFolders = (parentId: string) =>
    props.store
      .folders()
      .filter(
        (f) => f.parentId === parentId && folderMatchesOrHasMatchingDescendant(f.id)
      )
      .sort(compareFolders);

  const getDirectNotes = (folderId: string | null) =>
    [...props.store.notes()]
      .filter((n) => n.folderId === folderId && matchesQuery(n))
      .sort(compareNotesInFolder);

  const pinnedNotes = createMemo(() =>
    [...props.store.notes()]
      .filter((n) => n.pinned && matchesQuery(n))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  const rootNotes = createMemo(() => getDirectNotes(null));

  const expandableFolderIds = createMemo(() =>
    props.store
      .folders()
      .filter(
        (f) =>
          props.store.folders().some((c) => c.parentId === f.id) ||
          props.store.notes().some((n) => n.folderId === f.id)
      )
      .map((f) => f.id)
  );

  const allFoldersCollapsed = createMemo(() => {
    const ids = expandableFolderIds();
    if (ids.length === 0) return false;
    const collapsed = collapsedIds();
    return ids.every((id) => collapsed.has(id));
  });

  const toggleAllFoldersCollapsed = () => {
    const ids = expandableFolderIds();
    if (ids.length === 0) return;
    if (allFoldersCollapsed()) {
      setCollapsedIds(new Set<string>());
    } else {
      setCollapsedIds(new Set<string>(ids));
    }
  };

  const folderById = (id: string | null): Folder | undefined => {
    if (!id) return undefined;
    return props.store.folders().find((f) => f.id === id);
  };

  const noteById = (id: string | null): Note | undefined => {
    if (!id) return undefined;
    return props.store.notes().find((n) => n.id === id);
  };

  const toggleCollapsed = (folderId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const ensureExpanded = (folderId: string) => {
    setCollapsedIds((prev) => {
      if (!prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
  };

  const openNewFolderForm = (parentId: string | null) => {
    setCreatingParentId(parentId);
    setNewFolderName('');
    setNewFolderColor(
      FOLDER_COLORS[props.store.folders().length % FOLDER_COLORS.length]
    );
    if (parentId) ensureExpanded(parentId);
  };

  const submitNewFolder = () => {
    const parentId = creatingParentId();
    if (parentId === undefined) return;
    const name = newFolderName().trim();
    if (name) {
      props.store.createFolder(name, newFolderColor(), parentId);
    }
    setCreatingParentId(undefined);
    setNewFolderName('');
  };

  const startRenamingFolder = (folder: Folder) => {
    setRenamingFolderId(folder.id);
    setRenameDraft(folder.name);
  };

  const commitRenameFolder = () => {
    const id = renamingFolderId();
    if (id && renameDraft().trim()) {
      props.store.renameFolder(id, renameDraft());
    }
    setRenamingFolderId(null);
    setRenameDraft('');
  };

  const handleOpenNote = (note: Note) => {
    if (Date.now() < suppressClickUntil || activeDrag()) return;
    props.store.openNote(note.id);
    if (window.innerWidth < 900) {
      props.store.setSidebarOpen(false);
    }
  };

  const handleImportFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        props.store.importNotesFromJson(reader.result);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };

  // ==================== UNIFIED POINTER DRAG & DROP ENGINE ====================

  const scheduleAutoExpandIfNeeded = (target: SidebarDropTarget | null) => {
    if (
      target &&
      target.kind === 'folder' &&
      target.position === 'inside' &&
      collapsedIds().has(target.folderId)
    ) {
      if (autoExpandFolderId === target.folderId) return;
      clearAutoExpandTimer();
      autoExpandFolderId = target.folderId;
      autoExpandTimer = window.setTimeout(() => {
        if (autoExpandFolderId) {
          ensureExpanded(autoExpandFolderId);
        }
        autoExpandTimer = undefined;
        autoExpandFolderId = null;
      }, AUTO_EXPAND_DELAY_MS);
    } else {
      clearAutoExpandTimer();
    }
  };

  const resolveDropTargetAtPoint = (
    clientX: number,
    clientY: number,
    drag: PendingSidebarDrag
  ): SidebarDropTarget | null => {
    if (sidebarRef) {
      const sRect = sidebarRef.getBoundingClientRect();
      // Cancel drop target if dragged well outside sidebar horizontally
      if (clientX < sRect.left - 36 || clientX > sRect.right + 44) {
        return null;
      }
    }

    const elements = document.elementsFromPoint(clientX, clientY);
    const { item, descendants } = drag;

    for (const el of elements) {
      if (!(el instanceof HTMLElement)) continue;

      // 1. Folder row target
      const folderRow = el.closest<HTMLElement>('.folder-row[data-dnd-folder-id]');
      if (folderRow) {
        const targetFolderId = folderRow.dataset.dndFolderId;
        if (!targetFolderId) continue;

        if (item.kind === 'folder') {
          if (descendants?.has(targetFolderId)) return null;
          const rect = folderRow.getBoundingClientRect();
          const ratio = (clientY - rect.top) / Math.max(1, rect.height);
          if (ratio < 0.26) {
            return { kind: 'folder', folderId: targetFolderId, position: 'before' };
          }
          if (ratio > 0.74) {
            return { kind: 'folder', folderId: targetFolderId, position: 'after' };
          }
          return { kind: 'folder', folderId: targetFolderId, position: 'inside' };
        } else {
          // Note dropped on folder row -> entire row targets inside folder (ignore own current folder)
          if (item.folderId === targetFolderId) return null;
          return { kind: 'folder', folderId: targetFolderId, position: 'inside' };
        }
      }

      // 2. Note row target (folder children or root notes; ignore Favorites mirror list)
      const noteRow = el.closest<HTMLElement>('.tree-note-row[data-dnd-note-id]');
      if (noteRow) {
        if (noteRow.dataset.dndNoDrop === 'true') continue;
        const targetNoteId = noteRow.dataset.dndNoteId;
        const rawFolder = noteRow.dataset.dndNoteFolder;
        if (!targetNoteId || rawFolder === undefined) continue;
        const targetFolderId = rawFolder === '__root__' ? null : rawFolder;

        if (item.kind === 'note') {
          if (targetNoteId === item.id) return null;
          const rect = noteRow.getBoundingClientRect();
          const ratio = (clientY - rect.top) / Math.max(1, rect.height);
          return {
            kind: 'note',
            noteId: targetNoteId,
            folderId: targetFolderId,
            position: ratio < 0.5 ? 'before' : 'after',
          };
        } else {
          // Folder dragged over a note inside a folder -> target that containing folder
          if (targetFolderId && !descendants?.has(targetFolderId)) {
            return { kind: 'folder', folderId: targetFolderId, position: 'inside' };
          }
          return null;
        }
      }

      // 3. Dedicated folder-root drop zone ("Ordner" header / root strip)
      const folderRootZone = el.closest<HTMLElement>('[data-dnd-zone="folder-root"]');
      if (folderRootZone) {
        if (item.kind === 'folder' && item.parentId !== null) {
          return { kind: 'folder-root' };
        }
        return null;
      }

      // 4. Unfiled / "Weitere Notizen" root zone
      const noteRootZone = el.closest<HTMLElement>('[data-dnd-zone="note-root"]');
      if (noteRootZone) {
        if (item.kind === 'note' && item.folderId !== null) {
          return { kind: 'note-root' };
        }
        return null;
      }
    }

    return null;
  };

  const startAutoScrollLoop = () => {
    stopAutoScroll();
    const tick = () => {
      if (!pendingDrag || !activeDrag() || !explorerRef) {
        autoScrollRaf = undefined;
        return;
      }
      const rect = explorerRef.getBoundingClientRect();
      const y = pendingDrag.currY;
      let delta = 0;
      if (y < rect.top + EDGE_SCROLL_ZONE_PX && explorerRef.scrollTop > 0) {
        const ratio = Math.min(1, (rect.top + EDGE_SCROLL_ZONE_PX - y) / EDGE_SCROLL_ZONE_PX);
        delta = -Math.max(2, Math.round(ratio * 10));
      } else if (
        y > rect.bottom - EDGE_SCROLL_ZONE_PX &&
        explorerRef.scrollTop + explorerRef.clientHeight < explorerRef.scrollHeight
      ) {
        const ratio = Math.min(
          1,
          (y - (rect.bottom - EDGE_SCROLL_ZONE_PX)) / EDGE_SCROLL_ZONE_PX
        );
        delta = Math.max(2, Math.round(ratio * 10));
      }

      if (delta !== 0) {
        explorerRef.scrollTop += delta;
        const nextTarget = resolveDropTargetAtPoint(
          pendingDrag.currX,
          pendingDrag.currY,
          pendingDrag
        );
        setDropTarget(nextTarget);
        scheduleAutoExpandIfNeeded(nextTarget);
      }

      autoScrollRaf = window.requestAnimationFrame(tick);
    };
    autoScrollRaf = window.requestAnimationFrame(tick);
  };

  const activatePendingDrag = () => {
    if (!pendingDrag || activeDrag()) return;
    clearHoldTimer();
    setDragPointerType(pendingDrag.pointerType);
    setActiveDrag(pendingDrag.item);
    setDragPos({ x: pendingDrag.currX, y: pendingDrag.currY });
    updateBodyDragClass(true);

    // Subtle haptic feedback on supported touch devices
    if (pendingDrag.pointerType !== 'mouse' && typeof navigator !== 'undefined') {
      try {
        navigator.vibrate?.(10);
      } catch {
        // ignore
      }
    }

    const initialTarget = resolveDropTargetAtPoint(
      pendingDrag.currX,
      pendingDrag.currY,
      pendingDrag
    );
    setDropTarget(initialTarget);
    scheduleAutoExpandIfNeeded(initialTarget);
    startAutoScrollLoop();
  };

  const commitDrop = (item: SidebarDragItem, target: SidebarDropTarget | null) => {
    if (!target) return;

    if (item.kind === 'folder') {
      if (target.kind === 'folder-root') {
        props.store.moveFolder(item.id, null);
        return;
      }
      if (target.kind === 'folder') {
        if (target.position === 'inside') {
          if (props.store.moveFolder(item.id, target.folderId)) {
            ensureExpanded(target.folderId);
          }
        } else {
          const anchorFolder = folderById(target.folderId);
          if (!anchorFolder) return;
          if (
            props.store.moveFolder(item.id, anchorFolder.parentId, {
              siblingId: target.folderId,
              position: target.position,
            }) &&
            anchorFolder.parentId
          ) {
            ensureExpanded(anchorFolder.parentId);
          }
        }
      }
      return;
    }

    // item.kind === 'note'
    if (target.kind === 'folder') {
      props.store.moveNoteToFolder(item.id, target.folderId);
      ensureExpanded(target.folderId);
    } else if (target.kind === 'note') {
      props.store.moveAndReorderNote(item.id, target.folderId, {
        siblingId: target.noteId,
        position: target.position,
      });
      if (target.folderId) {
        ensureExpanded(target.folderId);
      }
    } else if (target.kind === 'note-root') {
      props.store.moveNoteToFolder(item.id, null);
    }
  };

  const detachWindowDragListeners = () => {
    if (!windowListenersAttached) return;
    windowListenersAttached = false;
    window.removeEventListener('pointermove', onWindowPointerMove, { capture: true });
    window.removeEventListener('pointerup', onWindowPointerUp, { capture: true });
    window.removeEventListener('pointercancel', onWindowPointerCancel, { capture: true });
    window.removeEventListener('touchmove', onWindowTouchMove, { capture: true });
    window.removeEventListener('contextmenu', onWindowContextMenu, { capture: true });
  };
  detachListenersFn = detachWindowDragListeners;

  const onWindowTouchMove = (e: TouchEvent) => {
    // Once touch/pen drag is active, prevent Safari from scrolling the sidebar beneath the ghost
    if (activeDrag() && e.cancelable) {
      e.preventDefault();
    }
  };

  const onWindowContextMenu = (e: Event) => {
    if (activeDrag()) {
      e.preventDefault();
    }
  };

  const onWindowPointerMove = (e: PointerEvent) => {
    if (!pendingDrag || e.pointerId !== pendingDrag.pointerId) return;
    pendingDrag.currX = e.clientX;
    pendingDrag.currY = e.clientY;

    if (!activeDrag()) {
      const dist = Math.hypot(
        e.clientX - pendingDrag.startX,
        e.clientY - pendingDrag.startY
      );
      if (pendingDrag.pointerType === 'mouse') {
        if (dist >= MOUSE_DRAG_THRESHOLD_PX) {
          activatePendingDrag();
        }
      } else {
        // Touch / Pen: if the user started scrolling before hold timer completed, abort drag cleanly
        if (dist >= TOUCH_CANCEL_THRESHOLD_PX) {
          clearHoldTimer();
          pendingDrag = null;
          detachWindowDragListeners();
        }
      }
      return;
    }

    if (e.cancelable) e.preventDefault();
    setDragPos({ x: e.clientX, y: e.clientY });
    const nextTarget = resolveDropTargetAtPoint(e.clientX, e.clientY, pendingDrag);
    setDropTarget(nextTarget);
    scheduleAutoExpandIfNeeded(nextTarget);
  };

  const onWindowPointerUp = (e: PointerEvent) => {
    if (!pendingDrag || e.pointerId !== pendingDrag.pointerId) return;
    const item = activeDrag();
    const target = dropTarget();
    detachWindowDragListeners();
    cancelDrag();

    if (item) {
      suppressClickUntil = Date.now() + 380;
      commitDrop(item, target);
    }
  };

  const onWindowPointerCancel = (e: PointerEvent) => {
    if (!pendingDrag || e.pointerId !== pendingDrag.pointerId) return;
    const wasActive = Boolean(activeDrag());
    detachWindowDragListeners();
    cancelDrag();
    if (wasActive) {
      suppressClickUntil = Date.now() + 250;
    }
  };

  const startDragCandidate = (e: PointerEvent, item: SidebarDragItem) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (renamingFolderId() !== null) return;
    const targetEl = e.target as HTMLElement | null;
    if (
      targetEl?.closest(
        'button, input, textarea, select, a, .folder-actions, .tree-row-actions, .folder-chevron'
      )
    ) {
      return;
    }

    // Reset any stale drag before starting a fresh candidate
    detachWindowDragListeners();
    cancelDrag();

    pendingDrag = {
      pointerId: e.pointerId,
      pointerType: e.pointerType || 'mouse',
      startX: e.clientX,
      startY: e.clientY,
      currX: e.clientX,
      currY: e.clientY,
      item,
      descendants:
        item.kind === 'folder' ? props.store.getDescendantFolderIds(item.id) : null,
    };

    windowListenersAttached = true;
    window.addEventListener('pointermove', onWindowPointerMove, { capture: true });
    window.addEventListener('pointerup', onWindowPointerUp, { capture: true });
    window.addEventListener('pointercancel', onWindowPointerCancel, { capture: true });
    window.addEventListener('touchmove', onWindowTouchMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener('contextmenu', onWindowContextMenu, { capture: true });

    if (e.pointerType !== 'mouse') {
      const delay = e.pointerType === 'pen' ? PEN_HOLD_DELAY_MS : TOUCH_HOLD_DELAY_MS;
      holdTimer = window.setTimeout(() => {
        activatePendingDrag();
      }, delay);
    }
  };

  const dropActionHint = createMemo<string | null>(() => {
    const drag = activeDrag();
    const target = dropTarget();
    if (!drag || !target) return null;

    if (target.kind === 'folder-root') {
      return 'Auf oberste Ebene';
    }
    if (target.kind === 'note-root') {
      return 'Aus Ordner entfernen';
    }
    if (target.kind === 'folder') {
      const f = folderById(target.folderId);
      const name = f?.name ?? 'Ordner';
      if (target.position === 'inside') return `In „${name}“`;
      if (target.position === 'before') return `Vor „${name}“`;
      return `Nach „${name}“`;
    }
    if (target.kind === 'note') {
      const n = noteById(target.noteId);
      const name = n?.title.trim() || 'Unbenannte Notiz';
      if (drag.kind === 'note' && drag.folderId !== target.folderId) {
        if (target.folderId) {
          const fname = folderById(target.folderId)?.name ?? 'Ordner';
          return `In „${fname}“`;
        }
        return 'Aus Ordner entfernen';
      }
      return target.position === 'before' ? `Vor „${name}“` : `Nach „${name}“`;
    }
    return null;
  });

  const isDraggingNestedFolder = createMemo(() => {
    const drag = activeDrag();
    return drag?.kind === 'folder' && drag.parentId !== null;
  });

  const renderNoteTreeItem = (
    note: Note,
    depth: number,
    showPinIcon = true,
    allowDropTarget = true
  ) => {
    const isActive = () =>
      props.store.activeScreen() === 'note' &&
      props.store.activeNoteId() === note.id;
    const hasCanvas = () =>
      note.pages.some(
        (p) => p.strokes.length > 0 || p.texts.length > 0 || p.images.length > 0
      );
    const isDraggingThis = () =>
      activeDrag()?.kind === 'note' && activeDrag()?.id === note.id;
    const isDropBefore = () =>
      allowDropTarget &&
      dropTarget()?.kind === 'note' &&
      (dropTarget() as Extract<SidebarDropTarget, { kind: 'note' }>).noteId === note.id &&
      (dropTarget() as Extract<SidebarDropTarget, { kind: 'note' }>).position === 'before';
    const isDropAfter = () =>
      allowDropTarget &&
      dropTarget()?.kind === 'note' &&
      (dropTarget() as Extract<SidebarDropTarget, { kind: 'note' }>).noteId === note.id &&
      (dropTarget() as Extract<SidebarDropTarget, { kind: 'note' }>).position === 'after';

    return (
      <div
        role="treeitem"
        data-dnd-note-id={note.id}
        data-dnd-note-folder={note.folderId ?? '__root__'}
        data-dnd-no-drop={allowDropTarget ? undefined : 'true'}
        class="tree-note-row"
        classList={{
          'is-active': isActive(),
          'is-dragging': isDraggingThis(),
          'is-drop-before': isDropBefore(),
          'is-drop-after': isDropAfter(),
        }}
        style={{ 'padding-left': `${10 + depth * 14}px` }}
        title={note.title.trim() || 'Unbenannte Notiz'}
        onClick={() => handleOpenNote(note)}
        onPointerDown={(e) =>
          startDragCandidate(e, {
            kind: 'note',
            id: note.id,
            label: note.title.trim() || 'Unbenannte Notiz',
            folderId: note.folderId,
            hasCanvas: hasCanvas(),
          })
        }
      >
        <span class="tree-note-icon" aria-hidden="true">
          <Show when={hasCanvas()} fallback={<IconFileText size={13} />}>
            <IconPen size={12} />
          </Show>
        </span>

        <span class="tree-note-title">
          {note.title.trim() || 'Unbenannte Notiz'}
        </span>

        <div class="tree-note-meta">
          <Show when={note.pages.length > 1}>
            <span class="tree-note-pages" title={`${note.pages.length} Seiten`}>
              {note.pages.length}
            </span>
          </Show>
          <Show when={showPinIcon && note.pinned}>
            <span class="tree-note-pin" title="Angepinnt">
              <IconPin size={11} filled />
            </span>
          </Show>
        </div>

        <div class="tree-row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            class="icon-btn-xs"
            classList={{ 'is-pinned': note.pinned }}
            onClick={() => props.store.togglePin(note.id)}
            title={note.pinned ? 'Lösen' : 'Anpinnen'}
          >
            <IconPin size={12} filled={note.pinned} />
          </button>
          <button
            type="button"
            class="icon-btn-xs"
            onClick={() => props.store.duplicateNote(note.id)}
            title="Duplizieren"
          >
            <IconCopy size={12} />
          </button>
          <button
            type="button"
            class="icon-btn-xs is-danger"
            onClick={() => props.store.deleteNote(note.id)}
            title="Löschen"
          >
            <IconTrash size={12} />
          </button>
        </div>
      </div>
    );
  };

  const renderFolderTree = (folder: Folder, depth: number) => {
    const childFolders = () => getChildFolders(folder.id);
    const directNotes = () => getDirectNotes(folder.id);
    const hasEntries = () => childFolders().length > 0 || directNotes().length > 0;
    const isExpanded = () => Boolean(query()) || !collapsedIds().has(folder.id);
    const isSelectedOnHome = () =>
      props.store.activeScreen() === 'home' &&
      props.store.filterMode() === 'folder' &&
      props.store.selectedFolderId() === folder.id;
    const isRenaming = () => renamingFolderId() === folder.id;
    const isDraggingThisBranch = () =>
      activeDrag()?.kind === 'folder' && activeDrag()?.id === folder.id;
    const folderDropPos = () => {
      const t = dropTarget();
      if (t?.kind === 'folder' && t.folderId === folder.id) return t.position;
      return null;
    };

    return (
      <div
        class="folder-branch"
        classList={{ 'is-dragging-branch': isDraggingThisBranch() }}
      >
        <div
          data-dnd-folder-id={folder.id}
          class="folder-row"
          classList={{
            'is-active': isSelectedOnHome(),
            'is-dragging': isDraggingThisBranch(),
            'is-drop-target': folderDropPos() === 'inside',
            'is-drop-before': folderDropPos() === 'before',
            'is-drop-after': folderDropPos() === 'after',
          }}
          style={{ 'padding-left': `${6 + depth * 14}px` }}
          onClick={() => {
            if (Date.now() < suppressClickUntil || activeDrag()) return;
            ensureExpanded(folder.id);
            props.store.openFolderInHome(folder.id);
            if (window.innerWidth < 900) props.store.setSidebarOpen(false);
          }}
          onPointerDown={(e) => {
            if (isRenaming()) return;
            startDragCandidate(e, {
              kind: 'folder',
              id: folder.id,
              label: folder.name,
              color: folder.color,
              parentId: folder.parentId,
            });
          }}
        >
          <button
            type="button"
            class="folder-chevron"
            classList={{ 'is-hidden': !hasEntries() }}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapsed(folder.id);
            }}
            aria-label={isExpanded() ? 'Zuklappen' : 'Aufklappen'}
          >
            <Show when={isExpanded()} fallback={<IconChevronRight size={12} />}>
              <IconChevronDown size={12} />
            </Show>
          </button>

          <span class="folder-icon" style={{ color: folder.color }}>
            <IconFolder size={14} />
          </span>

          <Show
            when={!isRenaming()}
            fallback={
              <input
                ref={(el) => requestAnimationFrame(() => el.select())}
                type="text"
                class="folder-rename-input"
                value={renameDraft()}
                onClick={(e) => e.stopPropagation()}
                onInput={(e) => setRenameDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRenameFolder();
                  } else if (e.key === 'Escape') {
                    setRenamingFolderId(null);
                  }
                }}
                onBlur={commitRenameFolder}
              />
            }
          >
            <span class="folder-name">{folder.name}</span>
          </Show>

          <span class="folder-count">
            {props.store.getFolderNoteCount(folder.id)}
          </span>

          <div class="folder-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              class="icon-btn-xs"
              onClick={() => {
                ensureExpanded(folder.id);
                props.store.createNote(folder.id);
              }}
              title="Neue Notiz in diesem Ordner"
            >
              <IconPlus size={12} />
            </button>
            <button
              type="button"
              class="icon-btn-xs"
              onClick={() => openNewFolderForm(folder.id)}
              title="Unterordner erstellen"
            >
              <IconFolderPlus size={12} />
            </button>
            <button
              type="button"
              class="icon-btn-xs"
              onClick={() => startRenamingFolder(folder)}
              title="Umbenennen"
            >
              <IconEdit size={12} />
            </button>
            <button
              type="button"
              class="icon-btn-xs is-danger"
              onClick={() => props.store.deleteFolder(folder.id)}
              title="Ordner löschen"
            >
              <IconTrash size={12} />
            </button>
          </div>
        </div>

        <Show when={isExpanded() && hasEntries()}>
          <div class="folder-children">
            <For each={childFolders()}>
              {(child) => renderFolderTree(child, depth + 1)}
            </For>
            <For each={directNotes()}>
              {(note) => renderNoteTreeItem(note, depth + 1)}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <aside
      ref={sidebarRef}
      class="sidebar"
      classList={{
        'is-open': props.store.sidebarOpen(),
        'is-dnd-active': Boolean(activeDrag()),
      }}
    >
      {/* Slim Header: Brand/Home + Quick Actions (+ Note, + Folder, ⋯ Quick Menu) */}
      <div class="sidebar-top" ref={quickMenuRef}>
        <button
          type="button"
          class="brand brand-btn"
          onClick={() => {
            props.store.openHome('all');
            if (window.innerWidth < 900) props.store.setSidebarOpen(false);
          }}
          title="Zur Startseite / Übersicht"
        >
          <div class="brand-logo" aria-hidden="true">
            <IconPen size={14} />
          </div>
          <div class="brand-text">
            <div class="brand-title">Notizblock</div>
          </div>
        </button>

        <div class="sidebar-top-actions">
          <button
            type="button"
            class="icon-btn sidebar-top-btn"
            onClick={() =>
              creatingParentId() === null
                ? setCreatingParentId(undefined)
                : openNewFolderForm(null)
            }
            title="Neuen Ordner erstellen"
            aria-label="Neuen Ordner erstellen"
          >
            <IconFolderPlus size={16} />
          </button>

          <button
            type="button"
            class="icon-btn sidebar-top-btn sidebar-new-icon"
            onClick={() => props.store.createNote()}
            title="Neue Notiz (Strg+Alt+N)"
            aria-label="Neue Notiz"
          >
            <IconPlus size={16} />
          </button>

          <button
            type="button"
            class="icon-btn sidebar-top-btn sidebar-quickmenu-btn"
            classList={{ 'is-open': quickMenuOpen() }}
            onClick={() => setQuickMenuOpen((v) => !v)}
            title="Menü: Startseite, Karteikarten, Import, Backup & Einstellungen"
            aria-label="Seitenleisten-Schnellmenü"
            aria-expanded={quickMenuOpen()}
          >
            <IconMoreHorizontal size={16} />
            <Show when={props.store.isCloudConfigured()}>
              <span class="sidebar-qm-cloud-dot" aria-hidden="true" />
            </Show>
          </button>
        </div>

        {/* Sidebar Quick Menu Popover (Navigation, Import, Sync, Backup, Settings) */}
        <Show when={quickMenuOpen()}>
          <div
            class="quick-menu-popover sidebar-quickmenu-popover"
            role="dialog"
            aria-label="Seitenleisten-Schnellmenü"
          >
            <div class="qm-section-label">Ansichten</div>
            <div class="qm-list">
              <button
                type="button"
                class="qm-item"
                classList={{
                  'is-active-row':
                    props.store.activeScreen() === 'home' &&
                    props.store.filterMode() === 'all',
                }}
                onClick={() => {
                  setQuickMenuOpen(false);
                  props.store.openHome('all');
                  if (window.innerWidth < 900) props.store.setSidebarOpen(false);
                }}
              >
                <IconHome size={15} />
                <span class="qm-item-label">Startseite</span>
                <span class="qm-item-meta">{props.store.notes().length}</span>
              </button>

              <button
                type="button"
                class="qm-item"
                classList={{
                  'is-active-row':
                    props.store.activeScreen() === 'home' &&
                    props.store.filterMode() === 'pinned',
                }}
                onClick={() => {
                  setQuickMenuOpen(false);
                  props.store.openHome('pinned');
                  if (window.innerWidth < 900) props.store.setSidebarOpen(false);
                }}
              >
                <IconPin size={14} filled={props.store.filterMode() === 'pinned'} />
                <span class="qm-item-label">Angepinnt</span>
                <span class="qm-item-meta">
                  {props.store.notes().filter((n) => n.pinned).length}
                </span>
              </button>

              <button
                type="button"
                class="qm-item"
                classList={{
                  'is-active-row': props.store.activeScreen() === 'flashcards',
                }}
                onClick={() => {
                  setQuickMenuOpen(false);
                  props.store.openFlashcards({ type: 'all' }, false);
                  if (window.innerWidth < 900) props.store.setSidebarOpen(false);
                }}
              >
                <IconFlashcards size={15} />
                <span class="qm-item-label">Karteikarten</span>
                <Show
                  when={props.store.flashcardDeckStats().due > 0}
                  fallback={
                    <Show when={props.store.flashcardDeckStats().total > 0}>
                      <span class="qm-item-meta">
                        {props.store.flashcardDeckStats().total}
                      </span>
                    </Show>
                  }
                >
                  <span class="qm-count-pill">
                    {props.store.flashcardDeckStats().due}
                  </span>
                </Show>
              </button>
            </div>

            <div class="qm-divider" />

            <div class="qm-section-label">Import &amp; Datensicherung</div>
            <div class="qm-list">
              <button
                type="button"
                class="qm-item"
                onClick={() => {
                  setQuickMenuOpen(false);
                  if (window.innerWidth < 900) props.store.setSidebarOpen(false);
                  void props.store.quickImportFromClipboard();
                }}
              >
                <IconClipboardPaste size={15} />
                <span class="qm-item-label">Schnellimport</span>
              </button>

              <button
                type="button"
                class="qm-item"
                onClick={() => {
                  setQuickMenuOpen(false);
                  if (window.innerWidth < 900) props.store.setSidebarOpen(false);
                  props.store.openCloudSync();
                }}
              >
                <IconCloud size={15} />
                <span class="qm-item-label">Online-Sync &amp; Backup</span>
                <Show when={props.store.isCloudConfigured()}>
                  <span class="cloud-nav-dot" title="Cloud-Bucket verbunden" />
                </Show>
              </button>

              <button
                type="button"
                class="qm-item"
                onClick={() => {
                  setQuickMenuOpen(false);
                  exportNotesAsJson(
                    props.store.notes(),
                    props.store.folders(),
                    props.store.settings(),
                    props.store.flashcardProgress()
                  );
                  props.store.showToast('JSON-Backup exportiert');
                }}
              >
                <IconDownload size={15} />
                <span class="qm-item-label">JSON-Backup sichern</span>
              </button>

              <button
                type="button"
                class="qm-item"
                onClick={() => {
                  setQuickMenuOpen(false);
                  fileInputRef?.click();
                }}
              >
                <IconUpload size={15} />
                <span class="qm-item-label">JSON-Backup importieren</span>
              </button>
            </div>

            <div class="qm-divider" />

            <div class="qm-list">
              <button
                type="button"
                class="qm-item"
                classList={{
                  'is-active-row': props.store.activeScreen() === 'settings',
                }}
                onClick={() => {
                  setQuickMenuOpen(false);
                  props.store.openSettings('global');
                  if (window.innerWidth < 900) props.store.setSidebarOpen(false);
                }}
              >
                <IconSettings size={15} />
                <span class="qm-item-label">Einstellungen</span>
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Slim Tree Filter */}
      <div class="sidebar-search is-slim">
        <IconSearch size={13} class="search-icon" />
        <input
          type="text"
          value={treeFilter()}
          disabled={!props.store.sidebarOpen()}
          onInput={(e) => setTreeFilter(e.currentTarget.value)}
          placeholder="Ordner & Notizen filtern…"
          aria-label="Seitenleiste filtern"
        />
        <Show when={treeFilter().length > 0}>
          <button
            type="button"
            class="search-clear"
            onClick={() => setTreeFilter('')}
            title="Filter leeren"
          >
            <IconX size={13} />
          </button>
        </Show>
      </div>

      {/* Scrollable Folder-First Workspace Explorer (uses ~90% of sidebar height!) */}
      <div
        ref={explorerRef}
        class="sidebar-explorer"
        role="tree"
        onContextMenu={(e) => {
          if (activeDrag() || pendingDrag) e.preventDefault();
        }}
      >
        {/* Folders & Contained Notes Tree — Primary Section right at the top! */}
        <div class="explorer-group">
          <div
            data-dnd-zone="folder-root"
            class="explorer-section-header"
            classList={{ 'is-root-drop-header': dropTarget()?.kind === 'folder-root' }}
          >
            <span class="folders-heading">
              Ordner
              <Show when={props.store.folders().length > 0}>
                <span class="folders-heading-count">{props.store.folders().length}</span>
              </Show>
            </span>
            <div class="explorer-section-tools">
              <Show when={expandableFolderIds().length > 0 && !query()}>
                <button
                  type="button"
                  class="explorer-collapse-btn"
                  onClick={toggleAllFoldersCollapsed}
                  title={
                    allFoldersCollapsed()
                      ? 'Alle Ordner ausklappen'
                      : 'Alle Ordner einklappen'
                  }
                >
                  {allFoldersCollapsed() ? 'Aufklappen' : 'Einklappen'}
                </button>
              </Show>
              <button
                type="button"
                class="icon-btn-xs"
                onClick={() =>
                  creatingParentId() === null
                    ? setCreatingParentId(undefined)
                    : openNewFolderForm(null)
                }
                title="Neuen Ordner erstellen"
                aria-label="Neuen Ordner erstellen"
              >
                <IconFolderPlus size={14} />
              </button>
            </div>
          </div>

          <Show when={creatingParentId() !== undefined}>
            <div class="folder-create-box">
              <Show when={creatingParentId()}>
                {(pid) => (
                  <div class="folder-create-parent">
                    Unterordner in „{folderById(pid())?.name}“
                  </div>
                )}
              </Show>
              <input
                ref={(el) => requestAnimationFrame(() => el.focus())}
                type="text"
                class="folder-create-input"
                value={newFolderName()}
                onInput={(e) => setNewFolderName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitNewFolder();
                  } else if (e.key === 'Escape') {
                    setCreatingParentId(undefined);
                  }
                }}
                placeholder="Ordnername…"
              />
              <div class="folder-create-colors">
                <For each={FOLDER_COLORS}>
                  {(color) => (
                    <button
                      type="button"
                      class="folder-color-dot"
                      classList={{ 'is-active': newFolderColor() === color }}
                      style={{ background: color }}
                      onClick={() => setNewFolderColor(color)}
                      aria-label={`Ordnerfarbe ${color}`}
                    />
                  )}
                </For>
              </div>
              <div class="folder-create-actions">
                <button
                  type="button"
                  class="btn-ghost-sm"
                  onClick={() => setCreatingParentId(undefined)}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  class="btn-primary folder-create-submit"
                  disabled={!newFolderName().trim()}
                  onClick={submitNewFolder}
                >
                  Erstellen
                </button>
              </div>
            </div>
          </Show>

          <Show
            when={rootFolders().length > 0}
            fallback={
              <Show when={!query()}>
                <div class="explorer-empty-hint">Noch keine Ordner</div>
              </Show>
            }
          >
            <div class="explorer-list">
              <For each={rootFolders()}>
                {(folder) => renderFolderTree(folder, 0)}
              </For>
            </div>
          </Show>

          <Show when={isDraggingNestedFolder()}>
            <div
              data-dnd-zone="folder-root"
              class="folder-root-drop-strip"
              classList={{ 'is-active': dropTarget()?.kind === 'folder-root' }}
            >
              ↑ Auf oberste Ebene verschieben
            </div>
          </Show>
        </div>

        {/* Unfiled / Loose Root Notes (also acts as a drop target to remove a note from folders) */}
        <div
          data-dnd-zone="note-root"
          class="explorer-group"
          classList={{ 'is-root-drop': dropTarget()?.kind === 'note-root' }}
        >
          <div class="explorer-section-header">
            <button
              type="button"
              class="explorer-heading-btn"
              onClick={() => {
                props.store.openHome('unfiled');
                if (window.innerWidth < 900) props.store.setSidebarOpen(false);
              }}
              title="Alle Notizen ohne Ordner auf der Startseite anzeigen"
            >
              Weitere Notizen
              <Show when={rootNotes().length > 0}>
                <span class="folders-heading-count">{rootNotes().length}</span>
              </Show>
            </button>
            <button
              type="button"
              class="icon-btn-xs"
              onClick={() => props.store.createNote(null)}
              title="Neue Notiz ohne Ordner erstellen"
              aria-label="Neue Notiz ohne Ordner"
            >
              <IconPlus size={13} />
            </button>
          </div>

          <Show
            when={rootNotes().length > 0}
            fallback={
              <div class="explorer-empty-hint">
                {dropTarget()?.kind === 'note-root'
                  ? 'Hier ablegen zum Ausordnen'
                  : 'Keine losen Notizen'}
              </div>
            }
          >
            <div class="explorer-list">
              <For each={rootNotes()}>
                {(note) => renderNoteTreeItem(note, 0)}
              </For>
            </div>
          </Show>
        </div>

        {/* Collapsible Favorites Section (collapsed by default so Folders stay dominant) */}
        <Show when={pinnedNotes().length > 0}>
          <div class="explorer-group">
            <button
              type="button"
              class="explorer-section-toggle"
              onClick={() => setFavoritesCollapsed((v) => !v)}
            >
              <Show
                when={!favoritesCollapsed() || Boolean(query())}
                fallback={<IconChevronRight size={11} />}
              >
                <IconChevronDown size={11} />
              </Show>
              <span>Favoriten</span>
              <span class="folders-heading-count">{pinnedNotes().length}</span>
            </button>
            <Show when={!favoritesCollapsed() || Boolean(query())}>
              <div class="explorer-list">
                <For each={pinnedNotes()}>
                  {(note) => renderNoteTreeItem(note, 0, false, false)}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* Floating Drag Ghost Pill (Portal, pointer-events: none, touch-offset above finger) */}
      <Show when={activeDrag()}>
        {(item) => {
          const ghostCoords = () => {
            const isMouse = dragPointerType() === 'mouse';
            const rawX = dragPos().x + (isMouse ? 14 : -24);
            const rawY = dragPos().y + (isMouse ? -18 : -52);
            const maxX = typeof window !== 'undefined' ? window.innerWidth - 224 : rawX;
            const maxY = typeof window !== 'undefined' ? window.innerHeight - 54 : rawY;
            return {
              x: Math.round(Math.max(8, Math.min(maxX, rawX))),
              y: Math.round(Math.max(8, Math.min(maxY, rawY))),
            };
          };
          return (
            <Portal>
              <div
                class="sidebar-drag-ghost"
                classList={{ 'has-target': Boolean(dropActionHint()) }}
                style={{
                  transform: `translate3d(${ghostCoords().x}px, ${ghostCoords().y}px, 0)`,
                }}
              >
                <div class="sidebar-drag-ghost-main">
                  <Show
                    when={item().kind === 'folder'}
                    fallback={
                      <span class="sidebar-drag-ghost-icon">
                        <Show
                          when={(item() as Extract<SidebarDragItem, { kind: 'note' }>).hasCanvas}
                          fallback={<IconFileText size={13} />}
                        >
                          <IconPen size={12} />
                        </Show>
                      </span>
                    }
                  >
                    <span
                      class="sidebar-drag-ghost-icon"
                      style={{
                        color: (item() as Extract<SidebarDragItem, { kind: 'folder' }>).color,
                      }}
                    >
                      <IconFolder size={14} />
                    </span>
                  </Show>
                  <span class="sidebar-drag-ghost-label">{item().label}</span>
                </div>
                <Show when={dropActionHint()}>
                  {(hint) => <div class="sidebar-drag-ghost-hint">{hint()}</div>}
                </Show>
              </div>
            </Portal>
          );
        }}
      </Show>

      {/* Hidden JSON Backup Import Input (triggered from Sidebar Quick Menu) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        class="sr-only"
        onChange={handleImportFile}
      />
    </aside>
  );
}
