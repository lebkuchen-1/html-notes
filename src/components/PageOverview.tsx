import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  MAX_PAGE_HEIGHT,
  MAX_PAGE_WIDTH,
  MIN_PAGE_DIMENSION,
  PAGE_SIZE_PRESETS,
  type CanvasPage,
  type ThemeMode,
} from '../types';
import { renderFullCanvas } from '../utils/canvasRenderer';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFileUp,
  IconGrip,
  IconPlus,
  IconRuler,
  IconSwap,
  IconTrash,
  IconX,
} from './Icons';

const PAGE_DRAG_MIME = 'application/x-solid-page-id';

interface PageThumbnailProps {
  page: CanvasPage;
  theme: ThemeMode;
}

function PageThumbnail(props: PageThumbnailProps) {
  let canvasEl: HTMLCanvasElement | undefined;

  // Uniform target height so portrait, landscape, square & wide pages show true side-by-side proportions
  const maxH = 104;
  const maxW = 184;
  const minDim = 48;

  const thumbSize = () => {
    const ratio = props.page.width / Math.max(1, props.page.height);
    let h = maxH;
    let w = h * ratio;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    return {
      width: Math.max(minDim, Math.round(w)),
      height: Math.max(minDim, Math.round(h)),
    };
  };

  const drawThumb = () => {
    const canvas = canvasEl;
    if (!canvas) return;
    const { width, height } = thumbSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scale = targetW / props.page.width;
    renderFullCanvas(ctx, props.page, null, props.theme, scale, {
      onImageLoad: drawThumb,
    });
  };

  createEffect(() => {
    void props.page.width;
    void props.page.height;
    void props.page.strokes;
    void props.page.texts;
    void props.page.images;
    void props.page.paperConfig;
    void props.page.backgroundImage;
    void props.theme;
    requestAnimationFrame(drawThumb);
  });

  return (
    <div class="filmstrip-thumb-stage">
      <canvas
        ref={canvasEl}
        class="page-thumb-canvas"
        style={{
          width: `${thumbSize().width}px`,
          height: `${thumbSize().height}px`,
        }}
      />
    </div>
  );
}

interface PageOverviewProps {
  store: NotesStore;
  onClose: () => void;
  onSelectPage?: (pageId: string) => void;
  onTriggerImportPages?: () => void;
  initialShowCreator?: boolean;
}

export function PageOverview(props: PageOverviewProps) {
  const [showCreator, setShowCreator] = createSignal(Boolean(props.initialShowCreator));
  const [newWidth, setNewWidth] = createSignal(DEFAULT_CANVAS_WIDTH);
  const [newHeight, setNewHeight] = createSignal(DEFAULT_CANVAS_HEIGHT);
  const [newTitle, setNewTitle] = createSignal('');
  const [editingOptionsPageId, setEditingOptionsPageId] = createSignal<string | null>(
    null
  );

  // Drag & Drop reordering state
  const [draggingPageId, setDraggingPageId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{
    pageId: string;
    position: 'before' | 'after';
  } | null>(null);

  let filmstripRef: HTMLDivElement | undefined;

  const pages = () => props.store.activeNote()?.pages ?? [];
  const pageIds = createMemo(() => pages().map((p) => p.id));
  const activePageId = () => props.store.activePage()?.id ?? '';

  const otherNotes = createMemo(() => {
    const currId = props.store.activeNoteId();
    return props.store.notes().filter((n) => n.id !== currId);
  });

  const handleCreateCustomPage = () => {
    const created = props.store.addPage({
      title: newTitle().trim() || undefined,
      width: newWidth(),
      height: newHeight(),
    });
    setNewTitle('');
    setShowCreator(false);
    if (created) {
      props.onSelectPage?.(created.id);
    }
  };

  const handleWheel = (e: WheelEvent) => {
    if (!filmstripRef) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      filmstripRef.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  return (
    <div class="page-overview-dock" role="region" aria-label="Seitenübersicht">
      <div class="pod-header">
        <div class="pod-header-left">
          <span class="pod-title">Seitenübersicht</span>
          <span class="page-overview-count">
            {pages().length} {pages().length === 1 ? 'Seite' : 'Seiten'}
          </span>
          <Show when={pages().length > 1}>
            <span class="pod-hint">Zum Verschieben ziehen</span>
          </Show>
        </div>

        <div class="pod-header-right">
          <Show when={props.onTriggerImportPages}>
            <button
              type="button"
              class="tool-pill pod-new-btn"
              onClick={() => props.onTriggerImportPages?.()}
              title="PDF oder Bilder als neue Seiten importieren"
            >
              <IconFileUp size={13} />
              <span>PDF / Bild</span>
            </button>
          </Show>
          <button
            type="button"
            class="tool-pill pod-new-btn"
            classList={{ 'is-active': showCreator() }}
            onClick={() => setShowCreator((v) => !v)}
            title="Neue Seite mit individueller Größe erstellen"
          >
            <IconPlus size={13} />
            <span>Neue Seite</span>
          </button>
          <button
            type="button"
            class="icon-btn-xs"
            onClick={props.onClose}
            title="Seitenübersicht ausblenden"
            aria-label="Seitenübersicht ausblenden"
          >
            <IconX size={15} />
          </button>
        </div>
      </div>

      {/* Collapsible Compact New-Page Builder */}
      <Show when={showCreator()}>
        <div class="pod-creator">
          <div class="npb-row">
            <input
              type="text"
              class="npb-title-input"
              value={newTitle()}
              onInput={(e) => setNewTitle(e.currentTarget.value)}
              placeholder={`Seite ${pages().length + 1}`}
              aria-label="Titel der neuen Seite"
            />
            <div class="dim-inputs">
              <label class="dim-field is-compact" title="Breite in Pixel">
                <span>B</span>
                <input
                  type="number"
                  min={MIN_PAGE_DIMENSION}
                  max={MAX_PAGE_WIDTH}
                  step={10}
                  value={newWidth()}
                  onInput={(e) => setNewWidth(Number(e.currentTarget.value))}
                />
              </label>
              <span class="dim-x">×</span>
              <label class="dim-field is-compact" title="Höhe in Pixel">
                <span>H</span>
                <input
                  type="number"
                  min={MIN_PAGE_DIMENSION}
                  max={MAX_PAGE_HEIGHT}
                  step={10}
                  value={newHeight()}
                  onInput={(e) => setNewHeight(Number(e.currentTarget.value))}
                />
              </label>
              <button
                type="button"
                class="tool-btn"
                onClick={() => {
                  const w = newWidth();
                  const h = newHeight();
                  setNewWidth(h);
                  setNewHeight(w);
                }}
                title="Hoch-/Querformat tauschen"
              >
                <IconSwap size={13} />
              </button>
            </div>
            <button
              type="button"
              class="btn-primary npb-add-btn"
              onClick={handleCreateCustomPage}
            >
              <IconPlus size={14} />
              <span>Hinzufügen</span>
            </button>
          </div>

          <div class="npb-presets">
            <For each={PAGE_SIZE_PRESETS}>
              {(preset) => {
                const isSelected = () =>
                  newWidth() === preset.width && newHeight() === preset.height;
                return (
                  <button
                    type="button"
                    class="npb-preset-chip"
                    classList={{ 'is-active': isSelected() }}
                    onClick={() => {
                      setNewWidth(preset.width);
                      setNewHeight(preset.height);
                    }}
                    title={`${preset.label} (${preset.width} × ${preset.height} px)`}
                  >
                    <span>{preset.shortLabel}</span>
                    <span class="npb-preset-dims">
                      {preset.width}×{preset.height}
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Horizontal Scrollable Filmstrip */}
      <div
        ref={filmstripRef}
        class="page-filmstrip"
        onWheel={handleWheel}
        onDragOver={(e) => {
          if (draggingPageId()) e.preventDefault();
        }}
      >
        <For each={pageIds()}>
          {(pageId, idx) => {
            const page = createMemo(() => pages().find((p) => p.id === pageId));
            const isActive = () => pageId === activePageId();
            const isEditingOpts = () => editingOptionsPageId() === pageId;
            const isDropBefore = () =>
              dropTarget()?.pageId === pageId &&
              dropTarget()?.position === 'before' &&
              draggingPageId() !== pageId;
            const isDropAfter = () =>
              dropTarget()?.pageId === pageId &&
              dropTarget()?.position === 'after' &&
              draggingPageId() !== pageId;

            return (
              <Show when={page()}>
                {(curr) => (
                  <div
                    draggable={true}
                    class="filmstrip-card"
                    classList={{
                      'is-active': isActive(),
                      'is-dragging': draggingPageId() === pageId,
                      'is-drop-before': isDropBefore(),
                      'is-drop-after': isDropAfter(),
                    }}
                    onClick={() => {
                      props.store.setActivePage(pageId);
                      props.onSelectPage?.(pageId);
                    }}
                    onDragStart={(e) => {
                      // Don't hijack drag when user is selecting text in an input
                      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
                        e.preventDefault();
                        return;
                      }
                      setDraggingPageId(pageId);
                      e.dataTransfer?.setData(PAGE_DRAG_MIME, pageId);
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      const fromId = draggingPageId();
                      if (!fromId || fromId === pageId) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const midX = rect.left + rect.width / 2;
                      const position: 'before' | 'after' =
                        e.clientX < midX ? 'before' : 'after';
                      setDropTarget({ pageId, position });
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        if (dropTarget()?.pageId === pageId) {
                          setDropTarget(null);
                        }
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromId =
                        draggingPageId() || e.dataTransfer?.getData(PAGE_DRAG_MIME);
                      const target = dropTarget();
                      if (fromId && fromId !== pageId) {
                        props.store.reorderPage(
                          fromId,
                          pageId,
                          target?.pageId === pageId ? target.position : 'before'
                        );
                      }
                      setDraggingPageId(null);
                      setDropTarget(null);
                    }}
                    onDragEnd={() => {
                      setDraggingPageId(null);
                      setDropTarget(null);
                    }}
                  >
                    <div class="filmstrip-card-top">
                      <span class="filmstrip-grip" title="Ziehen zum Verschieben">
                        <IconGrip size={13} />
                        <span class="page-num-badge">#{idx() + 1}</span>
                        <Show when={curr().backgroundImage}>
                          {(bg) => (
                            <span
                              class="sheet-source-badge is-xs"
                              classList={{ 'is-pdf': bg().sourceType === 'pdf' }}
                            >
                              {bg().sourceType === 'pdf' ? 'PDF' : 'Bild'}
                            </span>
                          )}
                        </Show>
                      </span>
                      <button
                        type="button"
                        class="filmstrip-dim-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingOptionsPageId((prev) =>
                            prev === pageId ? null : pageId
                          );
                        }}
                        title="Größe ändern oder in andere Notiz verschieben"
                      >
                        {curr().width}×{curr().height}
                      </button>
                    </div>

                    <PageThumbnail page={curr()} theme={props.store.theme()} />

                    <div class="filmstrip-card-footer" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        class="filmstrip-name"
                        value={curr().title}
                        onInput={(e) =>
                          props.store.updatePageProperties(pageId, {
                            title: e.currentTarget.value,
                          })
                        }
                        aria-label="Seitenname"
                      />

                      <Show when={isEditingOpts()}>
                        <div class="filmstrip-opts-box">
                          <div class="page-card-size-editor">
                            <label class="dim-field is-compact">
                              <span>B</span>
                              <input
                                type="number"
                                min={MIN_PAGE_DIMENSION}
                                max={MAX_PAGE_WIDTH}
                                step={10}
                                value={curr().width}
                                onChange={(e) =>
                                  props.store.updatePageProperties(pageId, {
                                    width: Number(e.currentTarget.value),
                                  })
                                }
                              />
                            </label>
                            <span class="dim-x">×</span>
                            <label class="dim-field is-compact">
                              <span>H</span>
                              <input
                                type="number"
                                min={MIN_PAGE_DIMENSION}
                                max={MAX_PAGE_HEIGHT}
                                step={10}
                                value={curr().height}
                                onChange={(e) =>
                                  props.store.updatePageProperties(pageId, {
                                    height: Number(e.currentTarget.value),
                                  })
                                }
                              />
                            </label>
                            <button
                              type="button"
                              class="icon-btn-xs"
                              onClick={() =>
                                props.store.updatePageProperties(pageId, {
                                  width: curr().height,
                                  height: curr().width,
                                })
                              }
                              title="Tauschen"
                            >
                              <IconSwap size={12} />
                            </button>
                          </div>

                          <Show when={otherNotes().length > 0 && pages().length > 1}>
                            <select
                              class="move-note-select"
                              value=""
                              onChange={(e) => {
                                const targetNoteId = e.currentTarget.value;
                                if (targetNoteId) {
                                  setEditingOptionsPageId(null);
                                  props.store.movePageToNote(pageId, targetNoteId);
                                }
                              }}
                              aria-label="In andere Notiz verschieben"
                            >
                              <option value="">In Notiz verschieben…</option>
                              <For each={otherNotes()}>
                                {(n) => (
                                  <option value={n.id}>
                                    {n.title.trim() || 'Unbenannte Notiz'}
                                  </option>
                                )}
                              </For>
                            </select>
                          </Show>
                        </div>
                      </Show>

                      <div class="filmstrip-actions">
                        <button
                          type="button"
                          class="icon-btn-xs"
                          disabled={idx() === 0}
                          onClick={() => props.store.movePage(pageId, -1)}
                          title="Nach links / vorne verschieben"
                        >
                          <IconChevronLeft size={13} />
                        </button>
                        <button
                          type="button"
                          class="icon-btn-xs"
                          disabled={idx() === pages().length - 1}
                          onClick={() => props.store.movePage(pageId, 1)}
                          title="Nach rechts / hinten verschieben"
                        >
                          <IconChevronRight size={13} />
                        </button>
                        <button
                          type="button"
                          class="icon-btn-xs"
                          classList={{ 'is-active-icon': isEditingOpts() }}
                          onClick={() =>
                            setEditingOptionsPageId((prev) =>
                              prev === pageId ? null : pageId
                            )
                          }
                          title="Größe anpassen / in andere Notiz verschieben"
                        >
                          <IconRuler size={12} />
                        </button>
                        <button
                          type="button"
                          class="icon-btn-xs"
                          onClick={() => props.store.duplicatePage(pageId)}
                          title="Seite duplizieren"
                        >
                          <IconCopy size={12} />
                        </button>
                        <button
                          type="button"
                          class="icon-btn-xs is-danger"
                          disabled={pages().length <= 1}
                          onClick={() => props.store.deletePage(pageId)}
                          title="Seite löschen"
                        >
                          <IconTrash size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Show>
            );
          }}
        </For>

        {/* Add Page Card at end of horizontal filmstrip */}
        <button
          type="button"
          class="filmstrip-add-card"
          onClick={() => setShowCreator(true)}
          title="Neue Seite mit Wunschformat hinzufügen"
        >
          <span class="fac-icon">
            <IconPlus size={18} />
          </span>
          <span>Neue Seite</span>
        </button>
      </div>
    </div>
  );
}
