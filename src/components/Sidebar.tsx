import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
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

const NOTE_DRAG_MIME = 'application/x-solid-note-id';

export function Sidebar(props: SidebarProps) {
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
  const [dragOverTarget, setDragOverTarget] = createSignal<string | null>(null);
  const [treeFilter, setTreeFilter] = createSignal('');
  const [quickMenuOpen, setQuickMenuOpen] = createSignal(false);

  // Close Quick Menu whenever sidebar closes
  createEffect(() => {
    if (!props.store.sidebarOpen()) {
      setQuickMenuOpen(false);
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
      if (e.key === 'Escape' && quickMenuOpen()) {
        e.preventDefault();
        setQuickMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside, { capture: true });
    document.addEventListener('touchstart', handleOutside, { capture: true, passive: true });
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
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
  );

  const getChildFolders = (parentId: string) =>
    props.store
      .folders()
      .filter(
        (f) => f.parentId === parentId && folderMatchesOrHasMatchingDescendant(f.id)
      );

  const getDirectNotes = (folderId: string | null) =>
    [...props.store.notes()]
      .filter((n) => n.folderId === folderId && matchesQuery(n))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });

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

  const handleDropOnFolder = (e: DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
    const noteId = e.dataTransfer?.getData(NOTE_DRAG_MIME);
    if (noteId) {
      props.store.moveNoteToFolder(noteId, targetFolderId);
      if (targetFolderId) ensureExpanded(targetFolderId);
    }
  };

  const renderNoteTreeItem = (note: Note, depth: number, showPinIcon = true) => {
    const isActive = () =>
      props.store.activeScreen() === 'note' &&
      props.store.activeNoteId() === note.id;
    const hasCanvas = () =>
      note.pages.some(
        (p) => p.strokes.length > 0 || p.texts.length > 0 || p.images.length > 0
      );

    return (
      <div
        role="treeitem"
        draggable={true}
        class="tree-note-row"
        classList={{ 'is-active': isActive() }}
        style={{ 'padding-left': `${10 + depth * 14}px` }}
        title={note.title.trim() || 'Unbenannte Notiz'}
        onClick={() => handleOpenNote(note)}
        onDragStart={(e) => {
          e.dataTransfer?.setData(NOTE_DRAG_MIME, note.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDragOverTarget(null)}
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

    return (
      <div class="folder-branch">
        <div
          class="folder-row"
          classList={{
            'is-active': isSelectedOnHome(),
            'is-drop-target': dragOverTarget() === folder.id,
          }}
          style={{ 'padding-left': `${6 + depth * 14}px` }}
          onClick={() => {
            ensureExpanded(folder.id);
            props.store.openFolderInHome(folder.id);
            if (window.innerWidth < 900) props.store.setSidebarOpen(false);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes(NOTE_DRAG_MIME)) {
              e.preventDefault();
              setDragOverTarget(folder.id);
            }
          }}
          onDragLeave={() => {
            if (dragOverTarget() === folder.id) setDragOverTarget(null);
          }}
          onDrop={(e) => handleDropOnFolder(e, folder.id)}
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
    <aside class="sidebar" classList={{ 'is-open': props.store.sidebarOpen() }}>
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
      <div class="sidebar-explorer" role="tree">
        {/* Folders & Contained Notes Tree — Primary Section right at the top! */}
        <div class="explorer-group">
          <div class="explorer-section-header">
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
        </div>

        {/* Unfiled / Loose Root Notes (also acts as a drop target to remove a note from folders) */}
        <div
          class="explorer-group"
          classList={{ 'is-root-drop': dragOverTarget() === '__root__' }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes(NOTE_DRAG_MIME)) {
              e.preventDefault();
              setDragOverTarget('__root__');
            }
          }}
          onDragLeave={(e) => {
            if (
              !e.currentTarget.contains(e.relatedTarget as Node | null) &&
              dragOverTarget() === '__root__'
            ) {
              setDragOverTarget(null);
            }
          }}
          onDrop={(e) => handleDropOnFolder(e, null)}
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
                {dragOverTarget() === '__root__'
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
                  {(note) => renderNoteTreeItem(note, 0, false)}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </div>

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
