import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  FOLDER_COLORS,
  type CanvasImageItem,
  type CanvasMode,
  type Folder,
  type Note,
  type NoteImageAttachment,
} from '../types';
import {
  createFilesQuickImportPayload,
  formatFileSize,
  formatLinkAsMarkdown,
  parseQuickImportFromDataTransfer,
  readQuickImportFromClipboard,
  type QuickImportPayload,
} from '../utils/clipboardImport';
import { processImageFile } from '../utils/imageImport';
import { importFilesAsPages, isImageFile, isPdfFile } from '../utils/pageImport';
import { createCanvasPage, generateId } from '../utils/storage';
import {
  IconCheck,
  IconClipboardPaste,
  IconFileText,
  IconFileUp,
  IconFolder,
  IconFolderPlus,
  IconImage,
  IconInfinity,
  IconLink,
  IconPages,
  IconPen,
  IconPlus,
  IconSearch,
  IconX,
} from './Icons';

interface ImportDialogProps {
  store: NotesStore;
}

type TargetMode = 'new' | 'existing';
type ImageInsertMode = 'pages' | 'canvas-image' | 'markdown';

export function ImportDialog(props: ImportDialogProps) {
  const [targetMode, setTargetMode] = createSignal<TargetMode>('new');
  const [noteTitle, setNoteTitle] = createSignal('');
  const [selectedFolderId, setSelectedFolderId] = createSignal<string | null>(null);
  const [canvasMode, setCanvasMode] = createSignal<CanvasMode>('pages');
  const [imageInsertMode, setImageInsertMode] = createSignal<ImageInsertMode>('pages');

  // Inline new-folder creation inside dialog
  const [creatingFolder, setCreatingFolder] = createSignal(false);
  const [newFolderName, setNewFolderName] = createSignal('');
  const [newFolderColor, setNewFolderColor] = createSignal<string>(FOLDER_COLORS[0]);

  // Existing-note selection
  const [noteSearch, setNoteSearch] = createSignal('');
  const [selectedNoteId, setSelectedNoteId] = createSignal<string | null>(null);

  // Import execution & preview state
  const [isReadingClipboard, setIsReadingClipboard] = createSignal(false);
  const [isImporting, setIsImporting] = createSignal(false);
  const [importProgress, setImportProgress] = createSignal<string | null>(null);
  const [previewUrls, setPreviewUrls] = createSignal<Map<number, string>>(new Map());
  const [isDragOver, setIsDragOver] = createSignal(false);

  let fileInputRef: HTMLInputElement | undefined;
  let pasteInputRef: HTMLInputElement | undefined;

  const payload = () => props.store.importDialogPayload();
  const isOpen = () => props.store.importDialogOpen();

  // Synchronize dialog defaults whenever opened or payload changes
  createEffect(() => {
    if (!isOpen()) return;
    const defaultTarget = props.store.importDialogDefaultTarget();
    const notes = props.store.notes();
    const active = props.store.activeNote();

    const effectiveTarget: TargetMode =
      defaultTarget === 'existing' && notes.length > 0 ? 'existing' : 'new';
    setTargetMode(effectiveTarget);
    setSelectedNoteId(active?.id ?? notes[0]?.id ?? null);
    setSelectedFolderId(
      props.store.filterMode() === 'folder' ? props.store.selectedFolderId() : null
    );
    setNoteSearch('');
    setCreatingFolder(false);
    setNewFolderName('');
    setImportProgress(null);
    setIsImporting(false);
  });

  // Keep title & sensible mode defaults in sync when payload updates
  createEffect(() => {
    const p = payload();
    if (!p) {
      setNoteTitle('');
      return;
    }
    setNoteTitle(p.suggestedTitle);
    if (p.kind === 'files') {
      const hasPdf = p.files.some(isPdfFile);
      setCanvasMode(hasPdf ? 'pages' : props.store.settings().canvasMode);
      setImageInsertMode('pages');
    } else {
      setCanvasMode(props.store.settings().canvasMode);
    }
  });

  // Manage object URLs for image thumbnails cleanly
  createEffect(() => {
    const p = payload();
    const map = new Map<number, string>();
    if (p && p.kind === 'files') {
      p.files.forEach((f, idx) => {
        if (isImageFile(f) && idx < 6) {
          map.set(idx, URL.createObjectURL(f));
        }
      });
    }
    setPreviewUrls(map);
    onCleanup(() => {
      for (const url of map.values()) {
        URL.revokeObjectURL(url);
      }
    });
  });

  // Hierarchical folder list for clear selection
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

  const folderMap = createMemo(() => {
    const m = new Map<string, Folder>();
    for (const f of props.store.folders()) m.set(f.id, f);
    return m;
  });

  // Existing notes list (active note first, then most recently updated)
  const filteredExistingNotes = createMemo<Note[]>(() => {
    const q = noteSearch().trim().toLowerCase();
    const activeId = props.store.activeNoteId();
    const fMap = folderMap();
    return [...props.store.notes()]
      .filter((n) => {
        if (!q) return true;
        const folderName = n.folderId ? fMap.get(n.folderId)?.name ?? '' : '';
        return (
          n.title.toLowerCase().includes(q) ||
          folderName.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.id === activeId) return -1;
        if (b.id === activeId) return 1;
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      });
  });

  const hasOnlyImages = createMemo(() => {
    const p = payload();
    return (
      p !== null &&
      p.kind === 'files' &&
      p.files.length > 0 &&
      p.files.every((f) => isImageFile(f) && !isPdfFile(f))
    );
  });

  const payloadSummaryBadge = createMemo(() => {
    const p = payload();
    if (!p) return null;
    if (p.kind === 'files') {
      const pdfCount = p.files.filter(isPdfFile).length;
      const imgCount = p.files.filter((f) => isImageFile(f) && !isPdfFile(f)).length;
      if (pdfCount > 0 && imgCount > 0) return `${pdfCount} PDF · ${imgCount} Bild(er)`;
      if (pdfCount > 0) return pdfCount === 1 ? 'PDF-Dokument' : `${pdfCount} PDFs`;
      return imgCount === 1 ? 'Bild' : `${imgCount} Bilder`;
    }
    if (p.kind === 'link') return p.isPdfUrl ? 'PDF-Link' : 'Web-Link';
    return 'Text';
  });

  const handleReadClipboardAgain = async () => {
    setIsReadingClipboard(true);
    try {
      const res = await readQuickImportFromClipboard();
      if (res.payload) {
        props.store.setImportDialogPayload(res.payload);
        props.store.setImportDialogHint(null);
      } else if (res.error === 'permission') {
        props.store.setImportDialogHint(
          'Zugriff abgebrochen — tippe auf „Einsetzen“ in der iOS-Blase oder füge direkt ins Feld unten ein.'
        );
      } else {
        props.store.setImportDialogHint(
          'Kein lesbarer Inhalt in der Zwischenablage. Auf dem iPad blockiert Safari direkt kopierte PDF-Dateien – nutze den 2-Schritt-Apple-Kurzbefehl unten, Drag & Drop oder „PDF / Bild wählen“.'
        );
      }
    } finally {
      setIsReadingClipboard(false);
    }
  };

  const handleDirectPaste = async (e: ClipboardEvent) => {
    e.preventDefault();
    const parsed = await parseQuickImportFromDataTransfer(e.clipboardData);
    if (pasteInputRef) pasteInputRef.value = '';
    if (parsed) {
      props.store.setImportDialogPayload(parsed);
      props.store.setImportDialogHint(null);
    } else {
      props.store.setImportDialogHint(
        'Der eingefügte Inhalt konnte nicht als PDF, Bild, Link oder Text erkannt werden.'
      );
    }
  };

  const handleFilesSelected = (files: File[]) => {
    const existing = payload();
    const merged =
      existing && existing.kind === 'files' ? [...existing.files, ...files] : files;
    const next = createFilesQuickImportPayload(merged);
    if (next) {
      props.store.setImportDialogPayload(next);
      props.store.setImportDialogHint(null);
    } else {
      props.store.showToast('Bitte PDF- oder Bilddateien auswählen');
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const parsed = await parseQuickImportFromDataTransfer(e.dataTransfer);
    if (parsed) {
      props.store.setImportDialogPayload(parsed);
      props.store.setImportDialogHint(null);
    }
  };

  const handleCreateInlineFolder = () => {
    const name = newFolderName().trim();
    if (!name) return;
    const created = props.store.createFolder(name, newFolderColor(), null, false);
    if (created) {
      setSelectedFolderId(created.id);
      setNewFolderName('');
      setCreatingFolder(false);
    }
  };

  const handleConfirmImport = async () => {
    const p = payload();
    if (!p || isImporting()) return;

    const mode = targetMode();
    if (mode === 'existing' && !selectedNoteId()) {
      props.store.showToast('Bitte eine bestehende Notiz auswählen');
      return;
    }

    setIsImporting(true);
    setImportProgress('Import wird vorbereitet…');

    try {
      // ==================== CASE 1: FILES (PDF / IMAGES) ====================
      if (p.kind === 'files') {
        const onlyImgs = hasOnlyImages();
        const imgMode = onlyImgs ? imageInsertMode() : 'pages';

        // 1A: Insert images as Markdown attachments in text pane
        if (onlyImgs && imgMode === 'markdown') {
          const attachments: NoteImageAttachment[] = [];
          const lines: string[] = [];
          for (let i = 0; i < p.files.length; i++) {
            setImportProgress(`Bild ${i + 1} / ${p.files.length} wird optimiert…`);
            const processed = await processImageFile(p.files[i], 1400);
            const id = generateId();
            attachments.push({ id, name: processed.name, src: processed.src });
            lines.push(`![${processed.name}](note-img://${id})`);
          }
          const markdownBlock = lines.join('\n\n');

          if (mode === 'new') {
            const s = props.store.settings();
            const firstPage = createCanvasPage({
              title: 'Seite 1',
              paperConfig: { ...s.defaultPaperConfig },
            });
            props.store.createNoteWithPages(
              noteTitle().trim() || p.suggestedTitle,
              [firstPage],
              {
                folderId: selectedFolderId(),
                viewMode: 'split',
                tags: ['Bilder'],
                content: markdownBlock,
                attachments,
                canvasMode: canvasMode(),
              }
            );
          } else {
            props.store.appendTextToNote(selectedNoteId()!, markdownBlock, {
              attachments,
            });
          }
          props.store.closeImportDialog();
          return;
        }

        // 1B: Insert movable image(s) onto active page of an existing note
        if (onlyImgs && imgMode === 'canvas-image' && mode === 'existing') {
          const targetNote = props.store.notes().find((n) => n.id === selectedNoteId());
          const targetPage =
            targetNote?.pages.find((pg) => pg.id === targetNote.activePageId) ??
            targetNote?.pages[0];
          if (!targetNote || !targetPage) return;

          const items: CanvasImageItem[] = [];
          for (let i = 0; i < p.files.length; i++) {
            setImportProgress(`Bild ${i + 1} / ${p.files.length} wird vorbereitet…`);
            const processed = await processImageFile(p.files[i], 1400);
            const maxW = Math.min(540, Math.max(180, targetPage.width - 60));
            const maxH = Math.min(520, Math.max(180, targetPage.height - 60));
            const scale = Math.min(1, maxW / processed.width, maxH / processed.height);
            const w = Math.max(64, Math.round(processed.width * scale));
            const h = Math.max(48, Math.round(processed.height * scale));
            const offset = i * 24;
            items.push({
              id: generateId(),
              src: processed.src,
              name: processed.name,
              x: Math.max(12, Math.round((targetPage.width - w) / 2) + offset),
              y: Math.max(12, Math.round((targetPage.height - h) / 3) + offset),
              width: w,
              height: h,
              naturalWidth: processed.width,
              naturalHeight: processed.height,
              opacity: 1,
            });
          }
          props.store.appendCanvasImagesToNote(targetNote.id, items, targetPage.id);
          props.store.closeImportDialog();
          return;
        }

        // 1C: Default GoodNotes mode — import PDF / Image(s) as crisp annotatable canvas pages!
        const importedPages = await importFilesAsPages(p.files, (status) => {
          setImportProgress(status);
        });
        if (importedPages.length === 0) {
          props.store.showToast('Keine gültigen PDF- oder Bilddateien gefunden');
          return;
        }

        if (mode === 'new') {
          const hasPdf = p.files.some(isPdfFile);
          const sourceNote = p.sourceUrl ? `Quelle: [${p.sourceUrl}](${p.sourceUrl})` : '';
          props.store.createNoteWithPages(
            noteTitle().trim() || p.suggestedTitle,
            importedPages,
            {
              folderId: selectedFolderId(),
              viewMode: 'canvas',
              tags: hasPdf ? ['PDF'] : ['Bilder'],
              content: sourceNote,
              canvasMode: canvasMode(),
            }
          );
        } else {
          props.store.appendPagesToNote(selectedNoteId()!, importedPages);
        }
        props.store.closeImportDialog();
        return;
      }

      // ==================== CASE 2: LINK ====================
      if (p.kind === 'link') {
        const displayTitle = noteTitle().trim() || p.title;
        const markdown = `- ${formatLinkAsMarkdown(p.url, displayTitle)}`;
        if (mode === 'new') {
          props.store.createNoteFromTemplate({
            title: displayTitle,
            content: `# ${displayTitle}\n\n${formatLinkAsMarkdown(p.url, p.url)}\n`,
            tags: p.isPdfUrl ? ['PDF', 'Link'] : ['Link'],
            folderId: selectedFolderId(),
            viewMode: 'split',
          });
        } else {
          props.store.appendTextToNote(selectedNoteId()!, markdown);
        }
        props.store.closeImportDialog();
        return;
      }

      // ==================== CASE 3: TEXT ====================
      if (p.kind === 'text') {
        if (mode === 'new') {
          props.store.createNoteFromTemplate({
            title: noteTitle().trim() || p.suggestedTitle,
            content: p.text,
            folderId: selectedFolderId(),
            viewMode: 'split',
          });
        } else {
          props.store.appendTextToNote(selectedNoteId()!, p.text);
        }
        props.store.closeImportDialog();
      }
    } catch {
      props.store.showToast('Fehler beim Importieren');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <Show when={isOpen()}>
      <div
        class="import-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isImporting()) {
            props.store.closeImportDialog();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => void handleDrop(e)}
      >
        <div class="import-modal" classList={{ 'is-drag-over': isDragOver() }}>
          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf,image/*"
            multiple
            class="sr-only"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              if (files.length > 0) handleFilesSelected(files);
              e.currentTarget.value = '';
            }}
          />

          {/* Header */}
          <header class="import-modal-head">
            <div class="import-modal-head-left">
              <span class="import-modal-icon">
                <IconClipboardPaste size={17} />
              </span>
              <div>
                <h2 id="import-modal-title">Schnellimport</h2>
                <Show when={payloadSummaryBadge()}>
                  {(badge) => <span class="import-type-badge">{badge()}</span>}
                </Show>
              </div>
            </div>
            <button
              type="button"
              class="icon-btn"
              disabled={isImporting()}
              onClick={() => props.store.closeImportDialog()}
              title="Schließen (Esc)"
              aria-label="Schließen"
            >
              <IconX size={18} />
            </button>
          </header>

          {/* Scrollable Body */}
          <div class="import-modal-body">
            {/* Optional Hint Banner */}
            <Show when={props.store.importDialogHint()}>
              {(hint) => <div class="import-hint-banner">{hint()}</div>}
            </Show>

            {/* SECTION 1: Content Preview OR Empty Quick-Paste / File Picker */}
            <Show
              when={payload()}
              fallback={
                <div class="import-empty-source">
                  <p class="import-empty-title">
                    Inhalt aus Safari, Fotos oder Dateien übernehmen
                  </p>
                  <p class="import-empty-sub">
                    In Safari einfach <strong>Teilen → Kopieren</strong> tippen und dann hier
                    einfügen.
                  </p>

                  <div class="import-empty-actions">
                    <button
                      type="button"
                      class="btn-primary import-source-btn"
                      disabled={isReadingClipboard()}
                      onClick={() => void handleReadClipboardAgain()}
                    >
                      <IconClipboardPaste size={15} />
                      <span>
                        {isReadingClipboard()
                          ? 'Lese Zwischenablage…'
                          : 'Aus Zwischenablage einfügen'}
                      </span>
                    </button>

                    <button
                      type="button"
                      class="tool-pill import-source-btn"
                      onClick={() => fileInputRef?.click()}
                    >
                      <IconFileUp size={15} />
                      <span>PDF / Bild wählen</span>
                    </button>
                  </div>

                  <div class="import-direct-paste-box">
                    <input
                      ref={pasteInputRef}
                      type="text"
                      class="import-paste-input"
                      placeholder="Oder hier antippen → „Einsetzen“ (Links, Bilder, Text, Base64-PDF)…"
                      onPaste={(e) => void handleDirectPaste(e)}
                      onInput={(e) => {
                        // Keep input clean if user accidentally types; paste handles payload
                        if (e.currentTarget.value.length > 0 && !e.currentTarget.value.trim()) {
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>

                  <details class="import-shortcut-guide">
                    <summary>PDFs direkt über Safari „Teilen“ importieren (2-Schritt-Kurzbefehl)</summary>
                    <ol>
                      <li>
                        App <strong>Kurzbefehle</strong> öffnen → <strong>+</strong> → Namen z. B.{' '}
                        <em>„An Notizblock“</em> geben und in den Details (ⓘ){' '}
                        <strong>„Im Share-Sheet anzeigen“</strong> aktivieren (Typ: <em>PDFs &amp; Dateien</em>).
                      </li>
                      <li>
                        Aktion 1: <strong>Mit Base64 codieren</strong> (Eingabe: <em>Kurzbefehleingabe</em>).
                      </li>
                      <li>
                        Aktion 2: <strong>In Zwischenablage kopieren</strong>.
                      </li>
                    </ol>
                    <p>
                      Danach erscheint <em>„An Notizblock“</em> direkt im Safari-Teilen-Menü: PDF
                      teilen → hier auf <strong>Einfügen</strong> tippen → alle PDF-Seiten werden
                      sofort mit Notiz- &amp; Ordnerwahl importiert!
                    </p>
                  </details>
                </div>
              }
            >
              {(currentPayload) => (
                <section class="import-preview-card">
                  <div class="import-preview-head">
                    <span class="import-preview-label">Erkannter Inhalt</span>
                    <div class="import-preview-actions">
                      <button
                        type="button"
                        class="import-mini-btn"
                        disabled={isReadingClipboard() || isImporting()}
                        onClick={() => void handleReadClipboardAgain()}
                        title="Erneut aus Zwischenablage lesen"
                      >
                        <IconClipboardPaste size={12} />
                        <span>Neu einfügen</span>
                      </button>
                      <button
                        type="button"
                        class="import-mini-btn"
                        disabled={isImporting()}
                        onClick={() => fileInputRef?.click()}
                        title="PDF oder Bild hinzufügen"
                      >
                        <IconPlus size={12} />
                        <span>Datei</span>
                      </button>
                    </div>
                  </div>

                  {/* Files Preview */}
                  <Show when={currentPayload().kind === 'files'}>
                    {(() => {
                      const p = currentPayload() as Extract<QuickImportPayload, { kind: 'files' }>;
                      return (
                        <div class="import-files-preview">
                          <For each={p.files}>
                            {(file, idx) => {
                              const thumb = () => previewUrls().get(idx());
                              const pdf = isPdfFile(file);
                              return (
                                <div class="import-file-chip">
                                  <Show
                                    when={thumb()}
                                    fallback={
                                      <span
                                        class="import-file-badge"
                                        classList={{ 'is-pdf': pdf }}
                                      >
                                        {pdf ? 'PDF' : <IconImage size={14} />}
                                      </span>
                                    }
                                  >
                                    {(url) => (
                                      <img
                                        src={url()}
                                        alt={file.name}
                                        class="import-file-thumb"
                                      />
                                    )}
                                  </Show>
                                  <div class="import-file-info">
                                    <span class="import-file-name">{file.name}</span>
                                    <span class="import-file-size">
                                      {formatFileSize(file.size)}
                                    </span>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      );
                    })()}
                  </Show>

                  {/* Link Preview */}
                  <Show when={currentPayload().kind === 'link'}>
                    {(() => {
                      const p = currentPayload() as Extract<QuickImportPayload, { kind: 'link' }>;
                      return (
                        <div class="import-link-preview">
                          <div class="import-link-row">
                            <span class="import-link-icon">
                              <IconLink size={15} />
                            </span>
                            <div class="import-link-text">
                              <span class="import-link-title">{p.title}</span>
                              <span class="import-link-url">{p.url}</span>
                            </div>
                          </div>
                          <Show when={p.isPdfUrl && p.corsFetchFailed}>
                            <div class="import-link-cors-note">
                              <span>
                                Direktes Laden des PDFs wurde vom Server blockiert. Du kannst den
                                Link speichern oder das heruntergeladene PDF als Datei wählen.
                              </span>
                              <button
                                type="button"
                                class="import-mini-btn"
                                onClick={() => fileInputRef?.click()}
                              >
                                <IconFileUp size={12} />
                                <span>PDF-Datei wählen</span>
                              </button>
                            </div>
                          </Show>
                        </div>
                      );
                    })()}
                  </Show>

                  {/* Text Preview */}
                  <Show when={currentPayload().kind === 'text'}>
                    {(() => {
                      const p = currentPayload() as Extract<QuickImportPayload, { kind: 'text' }>;
                      return (
                        <div class="import-text-preview">
                          <pre>{p.text.slice(0, 320)}{p.text.length > 320 ? '…' : ''}</pre>
                          <span class="import-text-meta">{p.text.length} Zeichen</span>
                        </div>
                      );
                    })()}
                  </Show>
                </section>
              )}
            </Show>

            {/* SECTION 2: Target Switcher (New Note vs Existing Note) */}
            <Show when={payload()}>
              <section class="import-target-section">
                <div class="import-target-tabs" role="tablist" aria-label="Import-Ziel">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={targetMode() === 'new'}
                    class="import-target-tab"
                    classList={{ 'is-active': targetMode() === 'new' }}
                    onClick={() => setTargetMode('new')}
                  >
                    <IconPlus size={14} />
                    <span>Neue Notiz</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={targetMode() === 'existing'}
                    class="import-target-tab"
                    classList={{ 'is-active': targetMode() === 'existing' }}
                    disabled={props.store.notes().length === 0}
                    onClick={() => setTargetMode('existing')}
                  >
                    <IconFileText size={14} />
                    <span>Bestehende Notiz ({props.store.notes().length})</span>
                  </button>
                </div>

                {/* TARGET A: NEW NOTE + FOLDER PICKER */}
                <Show when={targetMode() === 'new'}>
                  <div class="import-form-stack">
                    <label class="import-field">
                      <span class="import-field-label">Titel der neuen Notiz</span>
                      <input
                        type="text"
                        class="import-text-input"
                        value={noteTitle()}
                        onInput={(e) => setNoteTitle(e.currentTarget.value)}
                        placeholder="Titel eingeben…"
                      />
                    </label>

                    <div class="import-field">
                      <div class="import-field-head">
                        <span class="import-field-label">
                          <IconFolder size={13} />
                          <span>Ordner wählen</span>
                        </span>
                        <button
                          type="button"
                          class="import-mini-btn"
                          onClick={() => setCreatingFolder((v) => !v)}
                        >
                          <IconFolderPlus size={12} />
                          <span>{creatingFolder() ? 'Abbrechen' : 'Neuer Ordner'}</span>
                        </button>
                      </div>

                      <Show when={creatingFolder()}>
                        <div class="import-inline-folder-form">
                          <input
                            ref={(el) => requestAnimationFrame(() => el.focus())}
                            type="text"
                            class="import-text-input is-compact"
                            value={newFolderName()}
                            onInput={(e) => setNewFolderName(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleCreateInlineFolder();
                              } else if (e.key === 'Escape') {
                                setCreatingFolder(false);
                              }
                            }}
                            placeholder="Ordnername, z. B. Uni, Mathe…"
                          />
                          <div class="import-inline-folder-row">
                            <div class="folder-create-colors">
                              <For each={FOLDER_COLORS}>
                                {(c) => (
                                  <button
                                    type="button"
                                    class="folder-color-dot"
                                    classList={{ 'is-active': newFolderColor() === c }}
                                    style={{ background: c }}
                                    onClick={() => setNewFolderColor(c)}
                                  />
                                )}
                              </For>
                            </div>
                            <button
                              type="button"
                              class="btn-primary import-inline-create-btn"
                              disabled={!newFolderName().trim()}
                              onClick={handleCreateInlineFolder}
                            >
                              <IconCheck size={13} />
                              <span>Erstellen</span>
                            </button>
                          </div>
                        </div>
                      </Show>

                      <div class="import-folder-chips">
                        <button
                          type="button"
                          class="import-folder-chip"
                          classList={{ 'is-active': selectedFolderId() === null }}
                          onClick={() => setSelectedFolderId(null)}
                        >
                          <span>Kein Ordner</span>
                        </button>
                        <For each={folderOptions()}>
                          {(opt) => (
                            <button
                              type="button"
                              class="import-folder-chip"
                              classList={{ 'is-active': selectedFolderId() === opt.folder.id }}
                              onClick={() => setSelectedFolderId(opt.folder.id)}
                            >
                              <span
                                class="import-folder-dot"
                                style={{ background: opt.folder.color }}
                              />
                              <span>{opt.label}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>

                    {/* Canvas mode choice for files */}
                    <Show when={payload()?.kind === 'files'}>
                      <div class="import-field">
                        <span class="import-field-label">Einfüge-Modus</span>
                        <div class="import-option-row">
                          <Show when={hasOnlyImages()}>
                            <button
                              type="button"
                              class="import-choice-pill"
                              classList={{
                                'is-active':
                                  imageInsertMode() === 'pages' && canvasMode() === 'pages',
                              }}
                              onClick={() => {
                                setImageInsertMode('pages');
                                setCanvasMode('pages');
                              }}
                            >
                              <IconPages size={13} />
                              <span>Seiten (beschreibbar)</span>
                            </button>
                            <button
                              type="button"
                              class="import-choice-pill"
                              classList={{
                                'is-active':
                                  imageInsertMode() === 'pages' && canvasMode() === 'infinite',
                              }}
                              onClick={() => {
                                setImageInsertMode('pages');
                                setCanvasMode('infinite');
                              }}
                            >
                              <IconInfinity size={13} />
                              <span>Unendlich</span>
                            </button>
                            <button
                              type="button"
                              class="import-choice-pill"
                              classList={{ 'is-active': imageInsertMode() === 'markdown' }}
                              onClick={() => setImageInsertMode('markdown')}
                            >
                              <IconFileText size={13} />
                              <span>Im Text</span>
                            </button>
                          </Show>
                          <Show when={!hasOnlyImages()}>
                            <button
                              type="button"
                              class="import-choice-pill"
                              classList={{ 'is-active': canvasMode() === 'pages' }}
                              onClick={() => setCanvasMode('pages')}
                            >
                              <IconPages size={13} />
                              <span>Seiten-Dokument</span>
                            </button>
                            <button
                              type="button"
                              class="import-choice-pill"
                              classList={{ 'is-active': canvasMode() === 'infinite' }}
                              onClick={() => setCanvasMode('infinite')}
                            >
                              <IconInfinity size={13} />
                              <span>Unendlicher Canvas</span>
                            </button>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>

                {/* TARGET B: EXISTING NOTE PICKER */}
                <Show when={targetMode() === 'existing'}>
                  <div class="import-form-stack">
                    <div class="import-search-box">
                      <IconSearch size={14} class="search-icon" />
                      <input
                        type="text"
                        value={noteSearch()}
                        onInput={(e) => setNoteSearch(e.currentTarget.value)}
                        placeholder="Bestehende Notiz oder Ordner suchen…"
                      />
                      <Show when={noteSearch().length > 0}>
                        <button
                          type="button"
                          class="search-clear"
                          onClick={() => setNoteSearch('')}
                        >
                          <IconX size={13} />
                        </button>
                      </Show>
                    </div>

                    <div class="import-note-list" role="listbox" aria-label="Ziel-Notiz wählen">
                      <For
                        each={filteredExistingNotes()}
                        fallback={
                          <div class="import-note-empty">Keine passende Notiz gefunden.</div>
                        }
                      >
                        {(n) => {
                          const folder = () =>
                            n.folderId ? folderMap().get(n.folderId) : undefined;
                          const isCurrent = () => n.id === props.store.activeNoteId();
                          const isSelected = () => selectedNoteId() === n.id;
                          return (
                            <button
                              type="button"
                              role="option"
                              aria-selected={isSelected()}
                              class="import-note-item"
                              classList={{ 'is-selected': isSelected() }}
                              onClick={() => setSelectedNoteId(n.id)}
                            >
                              <span class="ini-icon">
                                <IconPen size={13} />
                              </span>
                              <div class="ini-main">
                                <div class="ini-title-row">
                                  <span class="ini-title">
                                    {n.title.trim() || 'Unbenannte Notiz'}
                                  </span>
                                  <Show when={isCurrent()}>
                                    <span class="ini-current-badge">Aktuell</span>
                                  </Show>
                                </div>
                                <div class="ini-meta">
                                  <Show when={folder()}>
                                    {(f) => (
                                      <span class="ini-folder">
                                        <span
                                          class="import-folder-dot"
                                          style={{ background: f().color }}
                                        />
                                        <span>{f().name}</span>
                                      </span>
                                    )}
                                  </Show>
                                  <span>
                                    {n.pages.length}{' '}
                                    {n.pages.length === 1 ? 'Seite' : 'Seiten'}
                                  </span>
                                </div>
                              </div>
                              <Show when={isSelected()}>
                                <span class="ini-check">
                                  <IconCheck size={15} />
                                </span>
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>

                    {/* Image insertion style for existing note */}
                    <Show when={hasOnlyImages()}>
                      <div class="import-field">
                        <span class="import-field-label">Wie soll das Bild eingefügt werden?</span>
                        <div class="import-option-row">
                          <button
                            type="button"
                            class="import-choice-pill"
                            classList={{ 'is-active': imageInsertMode() === 'pages' }}
                            onClick={() => setImageInsertMode('pages')}
                          >
                            <IconPages size={13} />
                            <span>Neue Seite(n)</span>
                          </button>
                          <button
                            type="button"
                            class="import-choice-pill"
                            classList={{ 'is-active': imageInsertMode() === 'canvas-image' }}
                            onClick={() => setImageInsertMode('canvas-image')}
                          >
                            <IconImage size={13} />
                            <span>Auf aktiver Seite</span>
                          </button>
                          <button
                            type="button"
                            class="import-choice-pill"
                            classList={{ 'is-active': imageInsertMode() === 'markdown' }}
                            onClick={() => setImageInsertMode('markdown')}
                          >
                            <IconFileText size={13} />
                            <span>Im Text</span>
                          </button>
                        </div>
                      </div>
                    </Show>

                    <Show when={payload()?.kind === 'files' && !hasOnlyImages()}>
                      <p class="import-mode-note">
                        Alle PDF-Seiten werden am Ende der ausgewählten Notiz angehängt.
                      </p>
                    </Show>
                    <Show when={payload()?.kind === 'link' || payload()?.kind === 'text'}>
                      <p class="import-mode-note">
                        Der Inhalt wird sauber am Ende des Markdown-Texts angehängt.
                      </p>
                    </Show>
                  </div>
                </Show>
              </section>
            </Show>
          </div>

          {/* Footer */}
          <footer class="import-modal-foot">
            <Show
              when={importProgress()}
              fallback={
                <span class="import-foot-hint">
                  <Show when={payload()}>
                    {targetMode() === 'new'
                      ? selectedFolderId()
                        ? `Ordner: ${folderMap().get(selectedFolderId()!)?.name ?? 'Ordner'}`
                        : 'Ohne Ordner'
                      : 'Wird direkt geöffnet'}
                  </Show>
                </span>
              }
            >
              {(status) => (
                <span class="import-foot-progress">
                  <span class="import-spinner" />
                  <span>{status()}</span>
                </span>
              )}
            </Show>

            <div class="import-foot-buttons">
              <button
                type="button"
                class="tool-pill"
                disabled={isImporting()}
                onClick={() => props.store.closeImportDialog()}
              >
                Abbrechen
              </button>
              <button
                type="button"
                class="btn-primary"
                disabled={
                  !payload() ||
                  isImporting() ||
                  (targetMode() === 'existing' && !selectedNoteId())
                }
                onClick={() => void handleConfirmImport()}
              >
                <IconCheck size={15} />
                <span>
                  {targetMode() === 'new'
                    ? 'In neue Notiz importieren'
                    : 'Zur Notiz hinzufügen'}
                </span>
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Show>
  );
}
