import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  FOLDER_COLORS,
  type CanvasPage,
  type Folder,
  type Note,
  type ThemeMode,
} from '../types';
import {
  computePageContentBounds,
  renderFullCanvas,
  renderInfiniteCanvas,
} from '../utils/canvasRenderer';
import { importFilesAsPages, stripFileExtension } from '../utils/pageImport';
import {
  IconCopy,
  IconFileUp,
  IconFolder,
  IconFolderPlus,
  IconInfinity,
  IconMoon,
  IconPen,
  IconPin,
  IconPlus,
  IconSearch,
  IconSidebar,
  IconSparkles,
  IconSun,
  IconTrash,
  IconX,
} from './Icons';

interface HomePageProps {
  store: NotesStore;
}

type SortMode = 'updated' | 'created' | 'title';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  return 'Guten Abend';
}

function formatDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function getExcerpt(content: string): string {
  const cleaned = content
    .replace(/^#+\s*/gm, '')
    .replace(/[-*]\s+\[[ xX]\]\s+/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '[Bild]')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Keine Textnotiz — zum Öffnen klicken';
  return cleaned.length > 105 ? `${cleaned.slice(0, 105)}…` : cleaned;
}

function NotePreviewCanvas(props: {
  page: CanvasPage;
  theme: ThemeMode;
  isInfinite?: boolean;
}) {
  let canvasEl: HTMLCanvasElement | undefined;

  const draw = () => {
    const canvas = canvasEl;
    if (!canvas) return;
    const cssW = 280;
    const cssH = 148;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (props.isInfinite) {
      const bounds = computePageContentBounds(props.page, ctx);
      if (bounds) {
        const pad = 42;
        const bw = Math.max(260, bounds.maxX - bounds.minX + pad * 2);
        const bh = Math.max(140, bounds.maxY - bounds.minY + pad * 2);
        const zoom = Math.min(cssW / bw, cssH / bh);
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        renderInfiniteCanvas(
          ctx,
          props.page,
          cssW,
          cssH,
          { x: cx - cssW / (2 * zoom), y: cy - cssH / (2 * zoom), zoom },
          props.theme,
          dpr,
          { onImageLoad: draw }
        );
      } else {
        renderInfiniteCanvas(
          ctx,
          props.page,
          cssW,
          cssH,
          { x: 0, y: 0, zoom: 0.55 },
          props.theme,
          dpr,
          { onImageLoad: draw }
        );
      }
      return;
    }

    // Fit full page width into preview card (showing top portion of tall pages cleanly)
    const scale = targetW / Math.max(1, props.page.width);
    renderFullCanvas(ctx, props.page, null, props.theme, scale, {
      onImageLoad: draw,
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
    void props.isInfinite;
    requestAnimationFrame(draw);
  });

  return <canvas ref={canvasEl} class="home-note-canvas" />;
}

export function HomePage(props: HomePageProps) {
  const [sortMode, setSortMode] = createSignal<SortMode>('updated');
  const [creatingFolder, setCreatingFolder] = createSignal(false);
  const [folderName, setFolderName] = createSignal('');
  const [folderColor, setFolderColor] = createSignal<string>(FOLDER_COLORS[0]);
  const [importStatus, setImportStatus] = createSignal<string | null>(null);
  let homeImportInputRef: HTMLInputElement | undefined;

  const homeFilter = () => props.store.filterMode();
  const homeFolderId = () => props.store.selectedFolderId();

  const handleImportAsNewNote = async (files: File[]) => {
    if (files.length === 0) return;
    setImportStatus('Dateien werden vorbereitet…');
    try {
      const importedPages = await importFilesAsPages(files, (status) => {
        setImportStatus(status);
      });
      if (importedPages.length === 0) {
        props.store.showToast('Keine gültigen PDF- oder Bilddateien gefunden');
        return;
      }
      const noteTitle =
        files.length === 1
          ? stripFileExtension(files[0].name)
          : `${stripFileExtension(files[0].name)} (+${files.length - 1})`;
      const hasPdf = files.some(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
      );
      props.store.createNoteWithPages(noteTitle, importedPages, {
        folderId: homeFilter() === 'folder' ? homeFolderId() : null,
        viewMode: 'canvas',
        tags: hasPdf ? ['PDF'] : ['Bilder'],
      });
    } catch {
      props.store.showToast('Fehler beim Importieren der Datei(en)');
    } finally {
      setImportStatus(null);
    }
  };

  const totalPages = createMemo(() =>
    props.store.notes().reduce((sum, n) => sum + n.pages.length, 0)
  );

  const pinnedNotes = createMemo(() =>
    props.store
      .notes()
      .filter((n) => n.pinned)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  );

  const folderMap = createMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of props.store.folders()) {
      map.set(f.id, f);
    }
    return map;
  });

  const getFolderPath = (folder: Folder): string => {
    const map = folderMap();
    const parts: string[] = [];
    let curr: Folder | undefined = folder;
    let guard = 0;
    while (curr?.parentId && guard < 10) {
      const parent = map.get(curr.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      curr = parent;
      guard++;
    }
    return parts.join(' / ');
  };

  const getSubtreeIds = (rootId: string): Set<string> => {
    const set = new Set<string>([rootId]);
    const list = props.store.folders();
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of list) {
        if (f.parentId && set.has(f.parentId) && !set.has(f.id)) {
          set.add(f.id);
          changed = true;
        }
      }
    }
    return set;
  };

  const visibleNotes = createMemo(() => {
    const q = props.store.searchQuery().trim().toLowerCase();
    const filter = homeFilter();
    const fid = homeFolderId();
    const allowedFolders = filter === 'folder' && fid ? getSubtreeIds(fid) : null;

    const list = props.store.notes().filter((note) => {
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
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.texts.some((t) => t.text.toLowerCase().includes(q))
        )
      );
    });

    const sort = sortMode();
    return [...list].sort((a, b) => {
      if (sort === 'title') {
        return (a.title || 'Unbenannte Notiz').localeCompare(
          b.title || 'Unbenannte Notiz',
          'de'
        );
      }
      if (sort === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
  });

  const handleCreateFolder = () => {
    const name = folderName().trim();
    if (!name) return;
    const created = props.store.createFolder(name, folderColor(), null);
    setFolderName('');
    setCreatingFolder(false);
    if (created) {
      props.store.selectFolder(created.id);
    }
  };

  const renderNoteCard = (note: Note) => {
    const firstPage = () => note.pages[0];
    const folder = () => (note.folderId ? folderMap().get(note.folderId) : undefined);
    const isInf = () =>
      (note.settings?.canvasMode ?? props.store.settings().canvasMode) === 'infinite';

    return (
      <article
        class="home-note-card"
        onClick={() => props.store.openNote(note.id)}
      >
        <div class="home-note-preview">
          <Show when={firstPage()}>
            {(p) => (
              <NotePreviewCanvas
                page={p()}
                theme={props.store.theme()}
                isInfinite={isInf()}
              />
            )}
          </Show>
          <div class="home-note-preview-badges">
            <Show when={isInf()}>
              <span class="hnp-badge is-infinite" title="Unendlicher Canvas (OneNote-Modus)">
                <IconInfinity size={12} />
                <span>Unendlich</span>
              </span>
            </Show>
            <Show when={!isInf() && note.pages.length > 1}>
              <span class="hnp-badge">{note.pages.length} Seiten</span>
            </Show>
            <Show when={note.pinned}>
              <span class="hnp-badge is-pin" title="Angepinnt">
                <IconPin size={11} filled />
              </span>
            </Show>
          </div>
          <div class="home-note-hover-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              class="hnh-btn"
              classList={{ 'is-pinned': note.pinned }}
              onClick={() => props.store.togglePin(note.id)}
              title={note.pinned ? 'Lösen' : 'Anpinnen'}
            >
              <IconPin size={13} filled={note.pinned} />
            </button>
            <button
              type="button"
              class="hnh-btn"
              onClick={() => props.store.duplicateNote(note.id)}
              title="Duplizieren"
            >
              <IconCopy size={13} />
            </button>
            <button
              type="button"
              class="hnh-btn is-danger"
              onClick={() => props.store.deleteNote(note.id)}
              title="Löschen"
            >
              <IconTrash size={13} />
            </button>
          </div>
        </div>

        <div class="home-note-body">
          <h3 class="home-note-title">
            {note.title.trim() || 'Unbenannte Notiz'}
          </h3>
          <p class="home-note-excerpt">{getExcerpt(note.content)}</p>

          <div class="home-note-meta">
            <span class="home-note-date">{formatDate(note.updatedAt)}</span>
            <Show when={folder()}>
              {(f) => (
                <span class="note-folder-pill">
                  <span class="nfp-dot" style={{ background: f().color }} />
                  <span>{f().name}</span>
                </span>
              )}
            </Show>
          </div>

          <Show when={note.tags.length > 0}>
            <div class="home-note-tags">
              <For each={note.tags.slice(0, 3)}>
                {(tag) => <span class="mini-tag">#{tag}</span>}
              </For>
            </div>
          </Show>
        </div>
      </article>
    );
  };

  return (
    <div class="home-page">
      {/* Top Bar */}
      <header class="home-topbar">
        <div class="home-topbar-left">
          <button
            type="button"
            class="icon-btn"
            onClick={() => props.store.setSidebarOpen((v) => !v)}
            title="Seitenleiste umschalten"
            aria-label="Seitenleiste umschalten"
          >
            <IconSidebar size={18} />
          </button>

          <div class="home-search">
            <IconSearch size={15} class="search-icon" />
            <input
              type="text"
              value={props.store.searchQuery()}
              onInput={(e) => props.store.setSearchQuery(e.currentTarget.value)}
              placeholder="Alle Notizen, Canvas-Texte & Tags durchsuchen…"
              aria-label="Alle Notizen durchsuchen"
            />
            <Show when={props.store.searchQuery().length > 0}>
              <button
                type="button"
                class="search-clear"
                onClick={() => props.store.setSearchQuery('')}
                title="Suche leeren"
              >
                <IconX size={14} />
              </button>
            </Show>
          </div>
        </div>

        <div class="home-topbar-right">
          <button
            type="button"
            class="tool-pill"
            onClick={() => homeImportInputRef?.click()}
            title="PDF oder Bilder als neue Notiz mit Seiten importieren"
          >
            <IconFileUp size={14} />
            <span class="hide-compact">PDF / Bild</span>
          </button>
          <input
            ref={homeImportInputRef}
            type="file"
            accept="application/pdf,.pdf,image/*"
            multiple
            class="sr-only"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              if (files.length > 0) void handleImportAsNewNote(files);
              e.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            class="tool-pill"
            onClick={() => setCreatingFolder((v) => !v)}
          >
            <IconFolderPlus size={14} />
            <span class="hide-compact">Neuer Ordner</span>
          </button>
          <button
            type="button"
            class="btn-primary"
            onClick={() =>
              props.store.createNote(
                homeFilter() === 'folder' ? homeFolderId() : undefined
              )
            }
          >
            <IconPlus size={16} />
            <span>Neue Notiz</span>
          </button>
          <button
            type="button"
            class="icon-btn"
            onClick={() => props.store.toggleTheme()}
            title={props.store.theme() === 'light' ? 'Dunkelmodus' : 'Hellmodus'}
            aria-label="Farbschema wechseln"
          >
            <Show when={props.store.theme() === 'light'} fallback={<IconSun size={17} />}>
              <IconMoon size={17} />
            </Show>
          </button>
        </div>
      </header>

      <div class="home-scroll">
        <div class="home-container">
          {/* Hero Greeting + Stats */}
          <section class="home-hero">
            <div>
              <h1 class="home-greeting">{getGreeting()}</h1>
              <p class="home-subtitle">
                Deine Übersicht für Notizen, Skizzen, Seiten und Ordner.
              </p>
            </div>
            <div class="home-stats">
              <div class="stat-card">
                <span class="stat-value">{props.store.notes().length}</span>
                <span class="stat-label">Notizen</span>
              </div>
              <div class="stat-card">
                <span class="stat-value">{totalPages()}</span>
                <span class="stat-label">Seiten</span>
              </div>
              <div class="stat-card">
                <span class="stat-value">{props.store.folders().length}</span>
                <span class="stat-label">Ordner</span>
              </div>
            </div>
          </section>

          {/* Inline New Folder Box if triggered */}
          <Show when={creatingFolder()}>
            <section class="home-new-folder-bar">
              <span class="hnf-label">Neuer Ordner:</span>
              <input
                ref={(el) => requestAnimationFrame(() => el.focus())}
                type="text"
                class="hnf-input"
                value={folderName()}
                onInput={(e) => setFolderName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateFolder();
                  } else if (e.key === 'Escape') {
                    setCreatingFolder(false);
                  }
                }}
                placeholder="z. B. Uni, Projekte, Ideen…"
              />
              <div class="folder-create-colors">
                <For each={FOLDER_COLORS}>
                  {(c) => (
                    <button
                      type="button"
                      class="folder-color-dot"
                      classList={{ 'is-active': folderColor() === c }}
                      style={{ background: c }}
                      onClick={() => setFolderColor(c)}
                    />
                  )}
                </For>
              </div>
              <button
                type="button"
                class="btn-primary folder-create-submit"
                disabled={!folderName().trim()}
                onClick={handleCreateFolder}
              >
                Erstellen
              </button>
              <button
                type="button"
                class="icon-btn-xs"
                onClick={() => setCreatingFolder(false)}
              >
                <IconX size={14} />
              </button>
            </section>
          </Show>

          {/* Quick Start Templates */}
          <section class="home-section">
            <div class="home-section-head">
              <h2>
                <IconSparkles size={15} />
                <span>Schnellstart &amp; Vorlagen</span>
              </h2>
            </div>

            <div class="template-grid">
              <button
                type="button"
                class="template-card"
                onClick={() =>
                  props.store.createNoteFromTemplate({
                    title: '',
                    width: 794,
                    height: 1123,
                    pageTitle: 'A4 Seite',
                    viewMode: 'split',
                    folderId: homeFilter() === 'folder' ? homeFolderId() : null,
                  })
                }
              >
                <span class="tpl-preview tpl-cream" />
                <span class="tpl-title">Leere Notiz</span>
                <span class="tpl-sub">A4 Hoch · Text &amp; Canvas</span>
              </button>

              <button
                type="button"
                class="template-card"
                onClick={() =>
                  props.store.createNoteFromTemplate({
                    title: 'Unendliches Board',
                    pageTitle: 'Endlos-Fläche',
                    paperConfig: {
                      pattern: 'dots',
                      backgroundColor: '#fcf9f2',
                      lineColor: '#9c8c74',
                      spacing: 32,
                      lineOpacity: 0.24,
                      showMargin: false,
                    },
                    viewMode: 'canvas',
                    settings: { canvasMode: 'infinite' },
                    folderId: homeFilter() === 'folder' ? homeFolderId() : null,
                  })
                }
              >
                <span class="tpl-preview tpl-infinite">
                  <IconInfinity size={22} />
                </span>
                <span class="tpl-title">Unendliches Board</span>
                <span class="tpl-sub">Wie OneNote · Grenzenlos</span>
              </button>

              <button
                type="button"
                class="template-card"
                onClick={() =>
                  props.store.createNoteFromTemplate({
                    title: 'Whiteboard-Skizze',
                    width: 1280,
                    height: 720,
                    pageTitle: '16:9 Whiteboard',
                    paperConfig: {
                      pattern: 'dots',
                      backgroundColor: '#ffffff',
                      lineColor: '#64748b',
                      spacing: 32,
                      lineOpacity: 0.22,
                    },
                    viewMode: 'canvas',
                    folderId: homeFilter() === 'folder' ? homeFolderId() : null,
                  })
                }
              >
                <span class="tpl-preview tpl-whiteboard" />
                <span class="tpl-title">16:9 Whiteboard</span>
                <span class="tpl-sub">1280 × 720 · Punktraster</span>
              </button>

              <button
                type="button"
                class="template-card"
                onClick={() =>
                  props.store.createNoteFromTemplate({
                    title: 'Meeting-Notizen',
                    content: `# Meeting-Notizen\n\n**Datum:** ${new Intl.DateTimeFormat('de-DE').format(new Date())}\n\n## Agenda\n- \n\n## Aufgaben\n- [ ] Erster Schritt\n- [ ] Nächster Schritt\n`,
                    tags: ['Meeting'],
                    width: 794,
                    height: 1123,
                    pageTitle: 'Notizblock',
                    paperConfig: {
                      pattern: 'lined',
                      backgroundColor: '#fef9db',
                      lineColor: '#3b82f6',
                      spacing: 36,
                      lineOpacity: 0.28,
                      showMargin: true,
                    },
                    viewMode: 'split',
                    folderId: homeFilter() === 'folder' ? homeFolderId() : null,
                  })
                }
              >
                <span class="tpl-preview tpl-legal" />
                <span class="tpl-title">Meeting &amp; Checkliste</span>
                <span class="tpl-sub">Gelber Block · Liniert</span>
              </button>

              <button
                type="button"
                class="template-card"
                onClick={() =>
                  props.store.createNoteFromTemplate({
                    title: 'Blaupause',
                    width: 1280,
                    height: 800,
                    pageTitle: 'Blaupause',
                    paperConfig: {
                      pattern: 'grid',
                      backgroundColor: '#163a6b',
                      lineColor: '#93c5fd',
                      spacing: 32,
                      lineOpacity: 0.28,
                      showMargin: false,
                    },
                    viewMode: 'canvas',
                    folderId: homeFilter() === 'folder' ? homeFolderId() : null,
                  })
                }
              >
                <span class="tpl-preview tpl-blueprint" />
                <span class="tpl-title">Blaupause-Skizze</span>
                <span class="tpl-sub">1280 × 800 · Raster</span>
              </button>
              <button
                type="button"
                class="template-card"
                onClick={() => homeImportInputRef?.click()}
              >
                <span class="tpl-preview tpl-pdf-import">
                  <IconFileUp size={22} />
                </span>
                <span class="tpl-title">PDF / Bilder importieren</span>
                <span class="tpl-sub">Jede Seite direkt annotieren</span>
              </button>
            </div>
          </section>

          <Show when={importStatus()}>
            {(status) => (
              <div class="import-progress-banner is-inline" role="status" aria-live="polite">
                <span class="import-spinner" />
                <span>{status()}</span>
              </div>
            )}
          </Show>

          {/* Folders Section */}
          <Show when={props.store.folders().length > 0}>
            <section class="home-section">
              <div class="home-section-head">
                <h2>
                  <IconFolder size={15} />
                  <span>Ordner</span>
                </h2>
                <Show when={homeFilter() === 'folder'}>
                  <button
                    type="button"
                    class="link-btn"
                    onClick={() => props.store.selectFilterMode('all')}
                  >
                    Ordnerfilter aufheben
                  </button>
                </Show>
              </div>

              <div class="home-folders-grid">
                <For each={props.store.folders()}>
                  {(folder) => {
                    const isSelected = () =>
                      homeFilter() === 'folder' && homeFolderId() === folder.id;
                    const parentPath = () => getFolderPath(folder);
                    const count = () => props.store.getFolderNoteCount(folder.id);

                    return (
                      <button
                        type="button"
                        class="home-folder-card"
                        classList={{ 'is-active': isSelected() }}
                        style={{ '--folder-color': folder.color }}
                        onClick={() => {
                          if (isSelected()) {
                            props.store.selectFilterMode('all');
                          } else {
                            props.store.selectFolder(folder.id);
                          }
                        }}
                      >
                        <span class="hfc-icon">
                          <IconFolder size={18} />
                        </span>
                        <div class="hfc-info">
                          <span class="hfc-name">{folder.name}</span>
                          <span class="hfc-meta">
                            {parentPath() ? `${parentPath()} · ` : ''}
                            {count()} {count() === 1 ? 'Notiz' : 'Notizen'}
                          </span>
                        </div>
                      </button>
                    );
                  }}
                </For>

                <button
                  type="button"
                  class="home-folder-card is-add"
                  onClick={() => setCreatingFolder(true)}
                >
                  <span class="hfc-icon">
                    <IconFolderPlus size={18} />
                  </span>
                  <div class="hfc-info">
                    <span class="hfc-name">Neuer Ordner</span>
                    <span class="hfc-meta">Notizen sortieren</span>
                  </div>
                </button>
              </div>
            </section>
          </Show>

          {/* Pinned Notes Highlight Row (only when showing unfiltered overview) */}
          <Show
            when={
              pinnedNotes().length > 0 &&
              homeFilter() === 'all' &&
              !props.store.searchQuery().trim()
            }
          >
            <section class="home-section">
              <div class="home-section-head">
                <h2>
                  <IconPin size={15} filled />
                  <span>Angepinnt</span>
                </h2>
              </div>
              <div class="home-notes-grid">
                <For each={pinnedNotes()}>{(note) => renderNoteCard(note)}</For>
              </div>
            </section>
          </Show>

          {/* All / Filtered Notes Grid */}
          <section class="home-section">
            <div class="home-section-head is-wrap">
              <div class="home-filter-bar">
                <button
                  type="button"
                  class="home-filter-chip"
                  classList={{ 'is-active': homeFilter() === 'all' }}
                  onClick={() => props.store.selectFilterMode('all')}
                >
                  Alle Notizen ({props.store.notes().length})
                </button>
                <button
                  type="button"
                  class="home-filter-chip"
                  classList={{ 'is-active': homeFilter() === 'pinned' }}
                  onClick={() => props.store.selectFilterMode('pinned')}
                >
                  Angepinnt ({pinnedNotes().length})
                </button>
                <Show when={props.store.folders().length > 0}>
                  <button
                    type="button"
                    class="home-filter-chip"
                    classList={{ 'is-active': homeFilter() === 'unfiled' }}
                    onClick={() => props.store.selectFilterMode('unfiled')}
                  >
                    Ohne Ordner (
                    {props.store.notes().filter((n) => n.folderId === null).length})
                  </button>
                </Show>
                <Show when={homeFilter() === 'folder' && homeFolderId()}>
                  {(fid) => (
                    <span class="home-filter-chip is-active">
                      Ordner: {folderMap().get(fid())?.name}
                    </span>
                  )}
                </Show>
              </div>

              <label class="home-sort-select">
                <span>Sortieren:</span>
                <select
                  value={sortMode()}
                  onChange={(e) => setSortMode(e.currentTarget.value as SortMode)}
                >
                  <option value="updated">Zuletzt bearbeitet</option>
                  <option value="created">Erstellungsdatum</option>
                  <option value="title">Titel (A–Z)</option>
                </select>
              </label>
            </div>

            <Show
              when={visibleNotes().length > 0}
              fallback={
                <div class="home-empty">
                  <div class="empty-icon">
                    <IconPen size={26} />
                  </div>
                  <h3>Keine Notizen gefunden</h3>
                  <p>
                    Erstelle eine neue Notiz oder passe deine Suche bzw. Ordnerauswahl an.
                  </p>
                  <div class="home-empty-actions">
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={() =>
                        props.store.createNote(
                          homeFilter() === 'folder' ? homeFolderId() : undefined
                        )
                      }
                    >
                      <IconPlus size={15} />
                      <span>Neue Notiz erstellen</span>
                    </button>
                    <Show
                      when={props.store.searchQuery() || homeFilter() !== 'all'}
                    >
                      <button
                        type="button"
                        class="tool-pill"
                        onClick={() => {
                          props.store.setSearchQuery('');
                          props.store.selectFilterMode('all');
                        }}
                      >
                        Filter zurücksetzen
                      </button>
                    </Show>
                  </div>
                </div>
              }
            >
              <div class="home-notes-grid">
                <For each={visibleNotes()}>{(note) => renderNoteCard(note)}</For>
              </div>
            </Show>
          </section>
        </div>
      </div>
    </div>
  );
}
