import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import type { Folder, ViewMode } from '../types';
import type { CanvasQuickBridge } from '../utils/canvasBridge';
import {
  IconChevronLeft,
  IconChevronRight,
  IconClipboardPaste,
  IconCrosshair,
  IconDownload,
  IconExitFullscreen,
  IconEye,
  IconEyeOff,
  IconFileUp,
  IconFlashcards,
  IconFolder,
  IconGrid,
  IconInfinity,
  IconMaximize,
  IconMoon,
  IconMoreHorizontal,
  IconOcclusion,
  IconPages,
  IconPalette,
  IconPin,
  IconPlay,
  IconPlus,
  IconRedo,
  IconRuler,
  IconSettings,
  IconSidebar,
  IconSplit,
  IconStylus,
  IconSun,
  IconText,
  IconTrash,
  IconUndo,
  IconX,
} from './Icons';
import { NoteTabs } from './NoteTabs';

interface NoteHeaderProps {
  store: NotesStore;
  canvasBridge: CanvasQuickBridge;
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'split', label: 'Kombiniert' },
  { id: 'text', label: 'Text' },
];

export function NoteHeader(props: NoteHeaderProps) {
  const [tagDraft, setTagDraft] = createSignal('');
  const [addingTag, setAddingTag] = createSignal(false);
  const [editingMenuTitle, setEditingMenuTitle] = createSignal(false);
  const [quickMenuOpen, setQuickMenuOpen] = createSignal(false);
  const [fcMenuOpen, setFcMenuOpen] = createSignal(false);

  let menuTitleInputRef: HTMLInputElement | undefined;
  let tagInputRef: HTMLInputElement | undefined;
  let quickMenuRef: HTMLDivElement | undefined;
  let fcMenuRef: HTMLDivElement | undefined;

  const note = () => props.store.activeNote();
  const activePage = () => props.store.activePage();
  const activePageIndex = () => props.store.activePageIndex();
  const pageCount = () => note()?.pages.length ?? 1;
  const isCanvasVisible = () => props.store.viewMode() !== 'text';
  const isInfiniteMode = () => props.store.effectiveSettings().canvasMode === 'infinite';
  const stylusOnly = () => props.store.effectiveSettings().stylusOnly;

  // Close popovers whenever switching notes
  createEffect(() => {
    void props.store.activeNoteId();
    setQuickMenuOpen(false);
    setFcMenuOpen(false);
    setAddingTag(false);
    setEditingMenuTitle(false);
  });

  createEffect(() => {
    if (!quickMenuOpen()) {
      setEditingMenuTitle(false);
      setAddingTag(false);
    }
  });

  onMount(() => {
    const handleCaptureOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (addingTag()) {
        if (!target || !tagInputRef?.contains(target)) {
          tagInputRef?.blur();
          submitTag();
        }
      }
      if (editingMenuTitle()) {
        if (!target || !menuTitleInputRef?.contains(target)) {
          menuTitleInputRef?.blur();
          setEditingMenuTitle(false);
        }
      }
      if (quickMenuOpen()) {
        if (!target || !quickMenuRef?.contains(target)) {
          setQuickMenuOpen(false);
        }
      }
      if (fcMenuOpen()) {
        if (!target || !fcMenuRef?.contains(target)) {
          setFcMenuOpen(false);
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (quickMenuOpen()) {
          e.preventDefault();
          setQuickMenuOpen(false);
        }
        if (fcMenuOpen()) {
          e.preventDefault();
          setFcMenuOpen(false);
        }
      }
    };

    document.addEventListener('pointerdown', handleCaptureOutside, { capture: true });
    document.addEventListener('touchstart', handleCaptureOutside, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handleCaptureOutside, {
        capture: true,
      });
      document.removeEventListener('touchstart', handleCaptureOutside, {
        capture: true,
      });
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  createEffect(() => {
    const title = note()?.title ?? '';
    if (menuTitleInputRef && menuTitleInputRef.value !== title) {
      menuTitleInputRef.value = title;
    }
  });

  // Build hierarchical folder path labels for the dropdown
  const folderOptions = createMemo(() => {
    const all = props.store.folders();
    const out: { folder: Folder; label: string }[] = [];

    const visit = (parentId: string | null, prefix: string) => {
      for (const f of all) {
        if (f.parentId === parentId) {
          const label = prefix ? `${prefix} / ${f.name}` : f.name;
          out.push({ folder: f, label });
          visit(f.id, label);
        }
      }
    };
    visit(null, '');
    return out;
  });

  const activeFolderColor = createMemo(() => {
    const fid = note()?.folderId;
    if (!fid) return undefined;
    return props.store.folders().find((f) => f.id === fid)?.color;
  });

  const submitTag = () => {
    const val = tagDraft().trim();
    if (val) {
      props.store.addTag(val);
    }
    setTagDraft('');
    setAddingTag(false);
  };

  return (
    <header class="note-header has-embedded-tabs">
      {/* LEFT / MAIN: Sidebar Toggle + Integrated Note Tabs (always visible, even in Fullscreen!) */}
      <div class="header-tabs-zone">
        <button
          type="button"
          class="icon-btn"
          onClick={() => props.store.setSidebarOpen((v) => !v)}
          title="Seitenleiste umschalten"
          aria-label="Seitenleiste umschalten"
        >
          <IconSidebar size={17} />
        </button>

        <NoteTabs store={props.store} embedded />
      </div>

      {/* RIGHT: Compact Page Pill + Undo/Redo + Flashcards/Study + Fullscreen + Quick Menu (⋯) */}
      <div class="header-actions-zone">
        <Show when={isCanvasVisible() && note()}>
          <Show
            when={!isInfiniteMode()}
            fallback={
              <div class="header-page-pill is-infinite" role="group" aria-label="Unendlicher Canvas">
                <span class="hpp-inf-badge" title="Unendlicher Canvas aktiv">
                  <IconInfinity size={14} />
                </span>
                <Show when={pageCount() > 1}>
                  <button
                    type="button"
                    class="hpp-icon-btn"
                    disabled={activePageIndex() <= 0}
                    onClick={() => props.canvasBridge.getHandlers()?.goToAdjacentPage(-1)}
                    title="Vorheriges Blatt"
                    aria-label="Vorheriges Blatt"
                  >
                    <IconChevronLeft size={14} />
                  </button>
                  <span class="hpp-count">
                    {activePageIndex() + 1}/{pageCount()}
                  </span>
                  <button
                    type="button"
                    class="hpp-icon-btn"
                    disabled={activePageIndex() >= pageCount() - 1}
                    onClick={() => props.canvasBridge.getHandlers()?.goToAdjacentPage(1)}
                    title="Nächstes Blatt"
                    aria-label="Nächstes Blatt"
                  >
                    <IconChevronRight size={14} />
                  </button>
                  <span class="hpp-sep" />
                </Show>
                <button
                  type="button"
                  class="hpp-btn"
                  onClick={() => props.canvasBridge.getHandlers()?.fitInfiniteToContent()}
                  title="Alle Inhalte einpassen"
                >
                  <IconMaximize size={13} />
                  <span class="hpp-label">Einpassen</span>
                </button>
                <button
                  type="button"
                  class="hpp-icon-btn"
                  onClick={() => props.canvasBridge.getHandlers()?.resetInfiniteView()}
                  title="Zum Ursprung (100 %) zurücksetzen"
                  aria-label="Zum Ursprung zurücksetzen"
                >
                  <IconCrosshair size={13} />
                </button>
              </div>
            }
          >
            <div class="header-page-pill" role="group" aria-label="Seitennavigation">
              <button
                type="button"
                class="hpp-btn hpp-overview-btn"
                classList={{ 'is-active': props.canvasBridge.overviewOpen() }}
                onClick={() => props.canvasBridge.getHandlers()?.toggleOverview()}
                title="Seitenübersicht ein-/ausblenden"
              >
                <IconPages size={13} />
                <span class="hpp-count">
                  {activePageIndex() + 1}/{pageCount()}
                </span>
              </button>

              <Show when={pageCount() > 1}>
                <span class="hpp-sep" />
                <button
                  type="button"
                  class="hpp-icon-btn"
                  disabled={activePageIndex() <= 0}
                  onClick={() => props.canvasBridge.getHandlers()?.goToAdjacentPage(-1)}
                  title="Vorherige Seite"
                  aria-label="Vorherige Seite"
                >
                  <IconChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  class="hpp-icon-btn"
                  disabled={activePageIndex() >= pageCount() - 1}
                  onClick={() => props.canvasBridge.getHandlers()?.goToAdjacentPage(1)}
                  title="Nächste Seite"
                  aria-label="Nächste Seite"
                >
                  <IconChevronRight size={14} />
                </button>
              </Show>

              <span class="hpp-sep" />
              <button
                type="button"
                class="hpp-icon-btn hpp-add-btn"
                onClick={() => props.canvasBridge.getHandlers()?.appendPage()}
                title="Neue Seite anhängen"
                aria-label="Neue Seite anhängen"
              >
                <IconPlus size={14} />
              </button>
            </div>
          </Show>

          <div class="header-history-group" role="group" aria-label="Verlauf">
            <button
              type="button"
              class="icon-btn"
              disabled={!props.store.canUndo()}
              onClick={() => {
                const h = props.canvasBridge.getHandlers();
                if (h) h.undo();
                else props.store.undoCanvas();
              }}
              title="Rückgängig (Strg+Z)"
              aria-label="Rückgängig"
            >
              <IconUndo size={16} />
            </button>
            <button
              type="button"
              class="icon-btn"
              disabled={!props.store.canRedo()}
              onClick={() => {
                const h = props.canvasBridge.getHandlers();
                if (h) h.redo();
                else props.store.redoCanvas();
              }}
              title="Wiederholen (Strg+Umschalt+Z)"
              aria-label="Wiederholen"
            >
              <IconRedo size={16} />
            </button>
          </div>
          <span class="header-vsep" aria-hidden="true" />
        </Show>

        <Show when={note()}>
          {(current) => {
            const noteCardCount = () => props.store.getNoteStudyCardCount(current().id);
            const hasOcclusions = () =>
              isCanvasVisible() && props.canvasBridge.totalNoteOcclusions() > 0;
            const isStudyActive = () =>
              props.canvasBridge.occlusionDisplayMode() === 'study';

            return (
              <div class="header-popover-anchor" ref={fcMenuRef}>
                <button
                  type="button"
                  class="icon-btn note-fc-header-btn"
                  classList={{
                    'has-cards': noteCardCount() > 0,
                    'is-study-active': isStudyActive(),
                    'is-open': fcMenuOpen(),
                  }}
                  onClick={() => {
                    setQuickMenuOpen(false);
                    if (hasOcclusions()) {
                      setFcMenuOpen((v) => !v);
                    } else {
                      props.store.openFlashcards(
                        { type: 'note', noteId: current().id },
                        noteCardCount() > 0
                      );
                    }
                  }}
                  title={
                    hasOcclusions()
                      ? 'Lernen & Stellen verbergen (Im Canvas üben oder Stapel)'
                      : noteCardCount() > 0
                        ? `${noteCardCount()} Karteikarte(n) dieser Notiz lernen`
                        : 'Karteikarten für diese Notiz öffnen / erstellen'
                  }
                  aria-label="Karteikarten & Üben"
                  aria-expanded={hasOcclusions() ? fcMenuOpen() : undefined}
                >
                  <IconFlashcards size={16} />
                  <Show when={noteCardCount() > 0}>
                    <span class="note-fc-count-dot">{noteCardCount()}</span>
                  </Show>
                </button>

                <Show when={fcMenuOpen() && hasOcclusions()}>
                  <div
                    class="quick-menu-popover fc-quick-popover"
                    role="dialog"
                    aria-label="Lernen & Verdeckungen"
                  >
                    <div class="qm-head">
                      <span>Lernen &amp; Verdeckungen</span>
                      <span class="qm-count-pill">
                        {props.canvasBridge.totalNoteOcclusions()} Stellen
                      </span>
                    </div>

                    <Show
                      when={isStudyActive()}
                      fallback={
                        <button
                          type="button"
                          class="qm-primary-btn"
                          onClick={() => {
                            setFcMenuOpen(false);
                            props.canvasBridge.getHandlers()?.startCanvasStudy();
                          }}
                        >
                          <IconPlay size={14} />
                          <span>Im Canvas üben</span>
                        </button>
                      }
                    >
                      <button
                        type="button"
                        class="qm-primary-btn is-stop"
                        onClick={() => {
                          setFcMenuOpen(false);
                          props.canvasBridge.getHandlers()?.setOcclusionDisplayMode('edit');
                        }}
                      >
                        <IconX size={14} />
                        <span>Üben beenden</span>
                      </button>
                    </Show>

                    <button
                      type="button"
                      class="qm-item"
                      onClick={() => {
                        setFcMenuOpen(false);
                        props.store.openFlashcards(
                          { type: 'note', noteId: current().id },
                          noteCardCount() > 0
                        );
                      }}
                    >
                      <IconFlashcards size={15} />
                      <span class="qm-item-label">Karteikarten-Stapel (SM-2)</span>
                      <span class="qm-item-meta">{noteCardCount()}</span>
                    </button>

                    <div class="qm-divider" />

                    <div class="qm-section-label">Verdeckungs-Boxen</div>
                    <div class="qm-segmented">
                      <button
                        type="button"
                        class="qm-seg-btn"
                        classList={{
                          'is-active': props.canvasBridge.occlusionDisplayMode() === 'edit',
                        }}
                        onClick={() => {
                          props.canvasBridge.getHandlers()?.setOcclusionDisplayMode('edit');
                        }}
                      >
                        <IconEye size={13} />
                        <span>Bearbeiten</span>
                      </button>
                      <button
                        type="button"
                        class="qm-seg-btn"
                        classList={{
                          'is-active': props.canvasBridge.occlusionDisplayMode() === 'hidden',
                        }}
                        onClick={() => {
                          props.canvasBridge.getHandlers()?.setOcclusionDisplayMode('hidden');
                        }}
                      >
                        <IconEyeOff size={13} />
                        <span>Ausblenden</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      class="qm-item"
                      onClick={() => {
                        setFcMenuOpen(false);
                        props.canvasBridge.getHandlers()?.selectOcclusionTool();
                      }}
                    >
                      <IconOcclusion size={15} />
                      <span class="qm-item-label">Neue Stelle verbergen</span>
                    </button>
                  </div>
                </Show>
              </div>
            );
          }}
        </Show>

        <button
          type="button"
          class="icon-btn"
          classList={{ 'is-fullscreen-active': props.store.isFullscreen() }}
          onClick={() => props.store.toggleFullscreen()}
          title={
            props.store.isFullscreen()
              ? 'Vollbildmodus beenden (F11)'
              : 'Vollbildmodus (F11 / Strg+Umschalt+F)'
          }
          aria-label={
            props.store.isFullscreen() ? 'Vollbildmodus beenden' : 'Vollbildmodus aktivieren'
          }
        >
          <Show when={props.store.isFullscreen()} fallback={<IconMaximize size={15} />}>
            <IconExitFullscreen size={15} />
          </Show>
        </button>

        {/* Quick Menu (⋯) — View Mode, Canvas Mode, Title/Folder/Tags, Stylus-Only, Paper, Page Format, Import, Export, Clear, Theme & Settings */}
        <Show when={note()}>
          {(current) => (
            <div class="header-popover-anchor" ref={quickMenuRef}>
              <button
                type="button"
                class="icon-btn note-quickmenu-btn"
                classList={{
                  'is-open': quickMenuOpen(),
                  'has-overrides': props.store.activeNoteLocalOverrideCount() > 0,
                }}
                onClick={() => {
                  setFcMenuOpen(false);
                  setQuickMenuOpen((v) => !v);
                }}
                title="Schnellmenü: Ansicht, Nur Stift, Hintergrund, Ordner, Seite, Export & Einstellungen"
                aria-label="Schnellmenü öffnen"
                aria-expanded={quickMenuOpen()}
              >
                <IconMoreHorizontal size={17} />
                <Show when={props.store.activeNoteLocalOverrideCount() > 0}>
                  <span class="override-dot" />
                </Show>
              </button>

              <Show when={quickMenuOpen()}>
                <div
                  class="quick-menu-popover"
                  role="dialog"
                  aria-label="Notiz-Schnellmenü"
                >
                  {/* Section 1: View Mode */}
                  <div class="qm-section">
                    <div class="qm-section-label">Ansicht</div>
                    <div class="qm-segmented" role="tablist" aria-label="Ansichtsmodus">
                      <For each={VIEW_MODES}>
                        {(mode) => (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={props.store.viewMode() === mode.id}
                            class="qm-seg-btn"
                            classList={{ 'is-active': props.store.viewMode() === mode.id }}
                            onClick={() => props.store.setViewMode(mode.id)}
                          >
                            {mode.id === 'canvas' && <IconPalette size={13} />}
                            {mode.id === 'split' && <IconSplit size={13} />}
                            {mode.id === 'text' && <IconText size={13} />}
                            <span>{mode.label}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* Section 2: Canvas Mode (Seiten vs Unendlich) */}
                  <Show when={isCanvasVisible()}>
                    <div class="qm-section">
                      <div class="qm-section-label">Canvas-Modus</div>
                      <div class="qm-segmented" role="tablist" aria-label="Canvas-Modus">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={!isInfiniteMode()}
                          class="qm-seg-btn"
                          classList={{ 'is-active': !isInfiniteMode() }}
                          onClick={() => {
                            props.canvasBridge.getHandlers()?.setCanvasMode('pages');
                          }}
                        >
                          <IconPages size={13} />
                          <span>Seiten</span>
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={isInfiniteMode()}
                          class="qm-seg-btn"
                          classList={{ 'is-active': isInfiniteMode() }}
                          onClick={() => {
                            props.canvasBridge.getHandlers()?.setCanvasMode('infinite');
                          }}
                        >
                          <IconInfinity size={14} />
                          <span>Unendlich</span>
                        </button>
                      </div>
                    </div>
                  </Show>

                  <div class="qm-divider" />

                  {/* Section 3: Note Organization (Title, Folder, Pin, Tags) */}
                  <div class="qm-section">
                    <Show
                      when={editingMenuTitle()}
                      fallback={
                        <button
                          type="button"
                          class="qm-title-display"
                          classList={{ 'is-placeholder': !current().title.trim() }}
                          onClick={() => setEditingMenuTitle(true)}
                          title="Tippen zum Umbenennen"
                        >
                          <span class="qm-title-text">
                            {current().title || 'Titel der Notiz…'}
                          </span>
                          <span class="qm-item-meta">Umbenennen</span>
                        </button>
                      }
                    >
                      <input
                        ref={(el) => {
                          menuTitleInputRef = el;
                          el.value = current().title;
                          requestAnimationFrame(() => el.focus());
                        }}
                        type="text"
                        class="qm-title-input"
                        onInput={(e) => props.store.updateTitle(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') {
                            e.preventDefault();
                            e.currentTarget.blur();
                            setEditingMenuTitle(false);
                          }
                        }}
                        onBlur={() => setEditingMenuTitle(false)}
                        placeholder="Titel der Notiz…"
                        aria-label="Notiztitel"
                      />
                    </Show>

                    <div class="qm-note-meta-row">
                      <Show when={folderOptions().length > 0}>
                        <label class="qm-folder-select" title="Ordner zuweisen">
                          <span
                            class="hfs-icon"
                            style={{ color: activeFolderColor() ?? 'var(--text-muted)' }}
                          >
                            <IconFolder size={13} />
                          </span>
                          <select
                            value={current().folderId ?? ''}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              props.store.moveNoteToFolder(current().id, val || null);
                            }}
                            aria-label="Ordner wählen"
                          >
                            <option value="">Kein Ordner</option>
                            <For each={folderOptions()}>
                              {(opt) => <option value={opt.folder.id}>{opt.label}</option>}
                            </For>
                          </select>
                        </label>
                      </Show>

                      <button
                        type="button"
                        class="qm-pin-btn"
                        classList={{ 'is-pinned': current().pinned }}
                        onClick={() => props.store.togglePin(current().id)}
                        title={current().pinned ? 'Nicht mehr anpinnen' : 'Notiz anpinnen'}
                      >
                        <IconPin size={13} filled={current().pinned} />
                        <span>{current().pinned ? 'Angepinnt' : 'Anpinnen'}</span>
                      </button>
                    </div>

                    <div class="qm-tags-wrap">
                      <For each={current().tags}>
                        {(tag) => (
                          <span class="tag-chip">
                            <span>#{tag}</span>
                            <button
                              type="button"
                              class="tag-remove"
                              onClick={() => props.store.removeTag(tag)}
                              title={`Tag #${tag} entfernen`}
                            >
                              <IconX size={11} />
                            </button>
                          </span>
                        )}
                      </For>
                      <Show
                        when={addingTag()}
                        fallback={
                          <button
                            type="button"
                            class="tag-add-btn"
                            onClick={() => setAddingTag(true)}
                          >
                            + Tag
                          </button>
                        }
                      >
                        <input
                          ref={(el) => {
                            tagInputRef = el;
                            requestAnimationFrame(() => el.focus());
                          }}
                          type="text"
                          class="tag-input"
                          value={tagDraft()}
                          onInput={(e) => setTagDraft(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              submitTag();
                            } else if (e.key === 'Escape') {
                              setTagDraft('');
                              setAddingTag(false);
                            }
                          }}
                          onBlur={submitTag}
                          placeholder="Tag…"
                        />
                      </Show>
                    </div>
                  </div>

                  <div class="qm-divider" />

                  {/* Section 4: Input, Paper, Page, Import & Export Actions */}
                  <div class="qm-list">
                    <Show when={isCanvasVisible()}>
                      <button
                        type="button"
                        class="qm-item"
                        onClick={() => props.canvasBridge.getHandlers()?.toggleStylusOnly()}
                        aria-pressed={stylusOnly()}
                      >
                        <IconStylus size={15} />
                        <span class="qm-item-label">Nur Stift</span>
                        <span
                          class="qm-toggle-pill"
                          classList={{ 'is-on': stylusOnly() }}
                        >
                          {stylusOnly() ? 'An' : 'Aus'}
                        </span>
                      </button>

                      <button
                        type="button"
                        class="qm-item"
                        onClick={() => {
                          setQuickMenuOpen(false);
                          props.canvasBridge.getHandlers()?.openPaperMenu();
                        }}
                      >
                        <IconGrid size={15} />
                        <span class="qm-item-label">Hintergrund &amp; Papier</span>
                        <span
                          class="qm-paper-swatch"
                          style={{ background: props.canvasBridge.resolvedPaperBg() }}
                        />
                      </button>

                      <Show when={!isInfiniteMode() && activePage()}>
                        {(pg) => (
                          <button
                            type="button"
                            class="qm-item"
                            onClick={() => {
                              setQuickMenuOpen(false);
                              props.canvasBridge.getHandlers()?.openSizeMenu();
                            }}
                          >
                            <IconRuler size={15} />
                            <span class="qm-item-label">Seitenformat</span>
                            <span class="qm-item-meta">
                              {pg().width} × {pg().height}
                            </span>
                          </button>
                        )}
                      </Show>

                      <Show when={!isInfiniteMode()}>
                        <button
                          type="button"
                          class="qm-item"
                          onClick={() => {
                            setQuickMenuOpen(false);
                            props.canvasBridge.getHandlers()?.triggerPdfImport();
                          }}
                        >
                          <IconFileUp size={15} />
                          <span class="qm-item-label">PDF / Bild als Seite</span>
                        </button>
                      </Show>
                    </Show>

                    <button
                      type="button"
                      class="qm-item"
                      onClick={() => {
                        setQuickMenuOpen(false);
                        void props.store.quickImportFromClipboard('existing');
                      }}
                    >
                      <IconClipboardPaste size={15} />
                      <span class="qm-item-label">Aus Zwischenablage einfügen</span>
                    </button>

                    <Show when={isCanvasVisible()}>
                      <button
                        type="button"
                        class="qm-item"
                        onClick={() => {
                          setQuickMenuOpen(false);
                          props.canvasBridge.getHandlers()?.openExportDialog();
                        }}
                      >
                        <IconDownload size={15} />
                        <span class="qm-item-label">Exportieren (PDF / Bild)</span>
                      </button>

                      <button
                        type="button"
                        class="qm-item is-danger"
                        disabled={!props.canvasBridge.hasCanvasContent()}
                        onClick={() => {
                          setQuickMenuOpen(false);
                          props.canvasBridge.getHandlers()?.clearPage();
                        }}
                      >
                        <IconTrash size={15} />
                        <span class="qm-item-label">Aktuelle Seite leeren</span>
                      </button>
                    </Show>
                  </div>

                  <div class="qm-divider" />

                  {/* Section 5: Appearance & Settings */}
                  <div class="qm-list">
                    <button
                      type="button"
                      class="qm-item"
                      onClick={() => props.store.toggleTheme()}
                    >
                      <Show
                        when={props.store.theme() === 'light'}
                        fallback={<IconSun size={15} />}
                      >
                        <IconMoon size={15} />
                      </Show>
                      <span class="qm-item-label">
                        {props.store.theme() === 'light' ? 'Dunkelmodus' : 'Hellmodus'}
                      </span>
                    </button>

                    <button
                      type="button"
                      class="qm-item"
                      onClick={() => {
                        setQuickMenuOpen(false);
                        props.store.openSettings('local');
                      }}
                    >
                      <IconSettings size={15} />
                      <span class="qm-item-label">Einstellungen</span>
                      <Show when={props.store.activeNoteLocalOverrideCount() > 0}>
                        <span class="qm-count-pill">
                          {props.store.activeNoteLocalOverrideCount()} lokal
                        </span>
                      </Show>
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </header>
  );
}
