import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import type { SpellCheckLanguage } from '../types';
import {
  extractImageFilesFromTransfer,
  processImageFile,
} from '../utils/imageImport';
import { renderMarkdown, toggleCheckboxAtLine } from '../utils/markdown';
import {
  addWordToPersonalDictionary,
  applySpellReplacement,
  findSpellIssues,
  getHtmlLangForSpellCheck,
  getSpellCheckRevision,
  getSpellLanguageLabel,
  getSpellLanguageShortLabel,
  getSpellSuggestions,
  isSpellCheckLoading,
  type SpellIssue,
} from '../utils/spellcheck';
import { exportNoteAsMarkdown, generateId } from '../utils/storage';
import {
  IconCheckSquare,
  IconCode,
  IconDownload,
  IconEdit,
  IconEye,
  IconImage,
  IconList,
  IconQuote,
  IconSpellCheck,
  IconX,
} from './Icons';

const SPELL_LANG_OPTIONS: { value: SpellCheckLanguage; label: string }[] = [
  { value: 'de-en', label: 'DE + EN' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
];

interface TextEditorProps {
  store: NotesStore;
}

export function TextEditor(props: TextEditorProps) {
  const [previewMode, setPreviewMode] = createSignal(false);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [spellMenuOpen, setSpellMenuOpen] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let imageInputRef: HTMLInputElement | undefined;
  let spellMenuRef: HTMLDivElement | undefined;

  const note = () => props.store.activeNote();
  const effSettings = () => props.store.effectiveSettings();
  const isSpellActive = () =>
    effSettings().spellCheckEnabled && effSettings().editorSpellCheck;
  const spellLang = () => effSettings().spellCheckLanguage;

  const setSpellLangPersisted = (next: SpellCheckLanguage) => {
    const currNote = props.store.activeNote();
    if (currNote?.settings?.spellCheckLanguage !== undefined) {
      props.store.updateNoteSettings({ spellCheckLanguage: next }, currNote.id);
    } else {
      props.store.updateSettings({ spellCheckLanguage: next });
    }
  };

  const editorSpellIssues = createMemo<SpellIssue[]>(() => {
    void getSpellCheckRevision();
    if (!isSpellActive()) return [];
    const content = note()?.content ?? '';
    if (!content.trim()) return [];
    return findSpellIssues(content, spellLang(), { isMarkdown: true });
  });

  onMount(() => {
    const handleOutside = (e: PointerEvent) => {
      if (spellMenuOpen() && spellMenuRef && !spellMenuRef.contains(e.target as Node)) {
        setSpellMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    onCleanup(() => document.removeEventListener('pointerdown', handleOutside));
  });

  const editorFontCss = createMemo(() => {
    const family = effSettings().editorFontFamily;
    if (family === 'serif') return "Georgia, 'Times New Roman', serif";
    if (family === 'mono') return "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
    return 'inherit';
  });

  const stats = createMemo(() => {
    const content = note()?.content ?? '';
    const trimmed = content.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = content.length;
    return { words, chars };
  });

  const renderedHtml = createMemo(() => {
    if (!previewMode()) return '';
    return renderMarkdown(note()?.content ?? '', note()?.attachments ?? []);
  });

  createEffect(() => {
    const content = note()?.content ?? '';
    const isPreview = previewMode();
    if (!isPreview && textareaRef && textareaRef.value !== content) {
      textareaRef.value = content;
    }
  });

  const insertAtCursor = (snippet: string) => {
    const current = note()?.content ?? '';
    const el = textareaRef;
    if (!el || previewMode()) {
      const sep = current.length > 0 && !current.endsWith('\n') ? '\n\n' : '';
      props.store.updateContent(current + sep + snippet);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = current.slice(0, start) + snippet + current.slice(end);
    props.store.updateContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const importImagesIntoText = async (files: File[]) => {
    if (files.length === 0) return;
    const snippets: string[] = [];
    for (const file of files) {
      try {
        const processed = await processImageFile(file, 1200);
        const id = generateId();
        props.store.addNoteAttachment({
          id,
          name: processed.name,
          src: processed.src,
        });
        const cleanLabel = processed.name.replace(/[\[\]()]/g, '');
        snippets.push(`![${cleanLabel}](note-img://${id})`);
      } catch {
        props.store.showToast(`Bild „${file.name}“ konnte nicht geladen werden`);
      }
    }
    if (snippets.length > 0) {
      insertAtCursor(`\n${snippets.join('\n')}\n`);
      props.store.showToast(
        snippets.length === 1
          ? 'Bild im Text eingefügt (in Vorschau sichtbar)'
          : `${snippets.length} Bilder im Text eingefügt`
      );
    }
  };

  const applyWrap = (before: string, after: string, placeholder: string) => {
    if (previewMode()) setPreviewMode(false);
    const el = textareaRef;
    const current = note()?.content ?? '';
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = current.slice(start, end) || placeholder;
    const next = current.slice(0, start) + before + selected + after + current.slice(end);
    props.store.updateContent(next);

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const applyLinePrefix = (prefix: string) => {
    if (previewMode()) setPreviewMode(false);
    const el = textareaRef;
    const current = note()?.content ?? '';
    if (!el) return;

    const start = el.selectionStart;
    const lineStart = current.lastIndexOf('\n', start - 1) + 1;
    const next = current.slice(0, lineStart) + prefix + current.slice(lineStart);
    props.store.updateContent(next);

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const el = e.currentTarget as HTMLTextAreaElement;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = el.value;
      const next = val.slice(0, start) + '  ' + val.slice(end);
      props.store.updateContent(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 2, start + 2);
      });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      applyWrap('**', '**', 'fett');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      applyWrap('*', '*', 'kursiv');
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    const files = extractImageFilesFromTransfer(e.clipboardData);
    if (files.length > 0) {
      e.preventDefault();
      void importImagesIntoText(files);
    }
  };

  const handlePreviewClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const idxAttr = target.getAttribute('data-line-index');
      if (idxAttr !== null) {
        const lineIndex = Number.parseInt(idxAttr, 10);
        const current = note()?.content ?? '';
        props.store.updateContent(toggleCheckboxAtLine(current, lineIndex));
      }
    }
  };

  return (
    <section
      class="pane text-pane"
      classList={{ 'is-drag-over': isDragOver() }}
      aria-label="Text-Editor"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDragOver(false);
        }
      }}
      onDrop={(e) => {
        setIsDragOver(false);
        const files = extractImageFilesFromTransfer(e.dataTransfer);
        if (files.length > 0) {
          e.preventDefault();
          void importImagesIntoText(files);
        }
      }}
    >
      <div class="pane-toolbar">
        <div class="toolbar-group">
          <span class="pane-label">Text</span>
          <div class="toolbar-divider" />
          <button
            type="button"
            class="tool-btn tool-btn-text"
            onClick={() => applyLinePrefix('# ')}
            title="Überschrift 1"
          >
            H1
          </button>
          <button
            type="button"
            class="tool-btn tool-btn-text"
            onClick={() => applyLinePrefix('## ')}
            title="Überschrift 2"
          >
            H2
          </button>
          <button
            type="button"
            class="tool-btn tool-btn-text is-bold"
            onClick={() => applyWrap('**', '**', 'fett')}
            title="Fett (Strg+B)"
          >
            B
          </button>
          <button
            type="button"
            class="tool-btn tool-btn-text is-italic"
            onClick={() => applyWrap('*', '*', 'kursiv')}
            title="Kursiv (Strg+I)"
          >
            I
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => applyLinePrefix('- ')}
            title="Aufzählung"
          >
            <IconList size={15} />
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => applyLinePrefix('- [ ] ')}
            title="Checkliste"
          >
            <IconCheckSquare size={15} />
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => applyLinePrefix('> ')}
            title="Zitat"
          >
            <IconQuote size={15} />
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => applyWrap('`', '`', 'code')}
            title="Inline-Code"
          >
            <IconCode size={15} />
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => imageInputRef?.click()}
            title="Bild in Textnotiz einfügen"
            aria-label="Bild einfügen"
          >
            <IconImage size={15} />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            class="sr-only"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              if (files.length > 0) void importImagesIntoText(files);
              e.currentTarget.value = '';
            }}
          />
        </div>

        <div class="toolbar-group">
          <div class="paper-menu-anchor" ref={spellMenuRef}>
            <button
              type="button"
              class="tool-pill spell-trigger-btn"
              classList={{
                'is-active': spellMenuOpen(),
                'has-spell-issues': isSpellActive() && editorSpellIssues().length > 0,
              }}
              onClick={() => setSpellMenuOpen((v) => !v)}
              title={
                isSpellActive()
                  ? `Rechtschreibprüfung (${getSpellLanguageLabel(spellLang())})`
                  : 'Rechtschreibprüfung (aus)'
              }
            >
              <IconSpellCheck size={14} />
              <span class="hide-compact">
                {isSpellActive() ? getSpellLanguageShortLabel(spellLang()) : 'Aus'}
              </span>
              <Show when={isSpellActive() && editorSpellIssues().length > 0}>
                <span class="spell-count-badge">{editorSpellIssues().length}</span>
              </Show>
            </button>

            <Show when={spellMenuOpen()}>
              <div
                class="paper-popover spell-popover"
                role="dialog"
                aria-label="Text-Rechtschreibprüfung"
              >
                <div class="paper-popover-header">
                  <span>Rechtschreibung (DE / EN)</span>
                  <button
                    type="button"
                    class="icon-btn-xs"
                    onClick={() => setSpellMenuOpen(false)}
                    aria-label="Schließen"
                  >
                    <IconX size={14} />
                  </button>
                </div>

                <div class="paper-section">
                  <div class="paper-section-label">Prüfsprache</div>
                  <div class="pattern-pills">
                    <For each={SPELL_LANG_OPTIONS}>
                      {(opt) => (
                        <button
                          type="button"
                          class="pattern-pill"
                          classList={{ 'is-active': spellLang() === opt.value }}
                          onClick={() => setSpellLangPersisted(opt.value)}
                        >
                          {opt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                <Show when={isSpellActive()}>
                  <div class="paper-section">
                    <div class="paper-slider-head">
                      <span class="paper-section-label">
                        Hinweise im Text ({editorSpellIssues().length})
                      </span>
                      <Show when={isSpellCheckLoading()}>
                        <span class="paper-slider-val">Lädt…</span>
                      </Show>
                    </div>
                    <Show
                      when={editorSpellIssues().length > 0}
                      fallback={
                        <div class="spell-empty-state">
                          {isSpellCheckLoading()
                            ? 'DE/EN-Wörterbücher werden geladen…'
                            : 'Keine Rechtschreibfehler gefunden.'}
                        </div>
                      }
                    >
                      <div class="spell-issue-list">
                        <For each={editorSpellIssues().slice(0, 14)}>
                          {(issue) => {
                            const suggestions = () =>
                              getSpellSuggestions(issue.word, spellLang(), 5);
                            return (
                              <div class="spell-issue-card">
                                <div class="sic-head">
                                  <span class="sic-word">{issue.word}</span>
                                  <button
                                    type="button"
                                    class="mini-reset-btn"
                                    onClick={() => addWordToPersonalDictionary(issue.word)}
                                  >
                                    + Wörterbuch
                                  </button>
                                </div>
                                <div class="sic-suggestions">
                                  <Show
                                    when={suggestions().length > 0}
                                    fallback={
                                      <span class="ssb-no-fix">Keine Vorschläge</span>
                                    }
                                  >
                                    <For each={suggestions()}>
                                      {(sug) => (
                                        <button
                                          type="button"
                                          class="ssb-fix-btn"
                                          onClick={() => {
                                            const curr = note()?.content ?? '';
                                            props.store.updateContent(
                                              applySpellReplacement(curr, issue, sug)
                                            );
                                          }}
                                        >
                                          {sug}
                                        </button>
                                      )}
                                    </For>
                                  </Show>
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          <button
            type="button"
            class="tool-pill"
            classList={{ 'is-active': previewMode() }}
            onClick={() => setPreviewMode((v) => !v)}
            title={previewMode() ? 'Zurück zum Bearbeiten' : 'Markdown-Vorschau'}
          >
            <Show when={previewMode()} fallback={<IconEye size={14} />}>
              <IconEdit size={14} />
            </Show>
            <span>{previewMode() ? 'Bearbeiten' : 'Vorschau'}</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => {
              const current = note();
              if (current) {
                exportNoteAsMarkdown(current);
                props.store.showToast('Als Markdown exportiert');
              }
            }}
            title="Als Markdown (.md) exportieren"
          >
            <IconDownload size={15} />
          </button>
        </div>
      </div>

      <div class="text-editor-body">
        <Show
          when={!previewMode()}
          fallback={
            <div
              class="markdown-preview"
              style={{
                'font-size': `${effSettings().editorFontSize}px`,
                'font-family': editorFontCss(),
              }}
              innerHTML={
                renderedHtml() ||
                '<p class="md-empty">Noch kein Text vorhanden. Wechsle auf „Bearbeiten“, um loszuschreiben.</p>'
              }
              onClick={handlePreviewClick}
            />
          }
        >
          <textarea
            ref={(el) => {
              textareaRef = el;
              el.value = note()?.content ?? '';
            }}
            class="note-textarea"
            style={{
              'font-size': `${effSettings().editorFontSize}px`,
              'font-family': editorFontCss(),
            }}
            onInput={(e) => props.store.updateContent(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Beginne zu schreiben… (Markdown wird unterstützt, Bilder können per Button, Drag & Drop oder Strg+V eingefügt werden)"
            lang={getHtmlLangForSpellCheck(spellLang())}
            spellcheck={isSpellActive()}
            autocorrect="on"
          />
        </Show>

        <Show when={isDragOver()}>
          <div class="drop-overlay">
            <div class="drop-overlay-card">
              <IconImage size={26} />
              <span>Bild in Textnotiz ablegen</span>
            </div>
          </div>
        </Show>
      </div>

      <div class="pane-statusbar">
        <span>{stats().words} Wörter</span>
        <span class="status-dot">·</span>
        <span>{stats().chars} Zeichen</span>
        <span class="status-spacer" />
        <span class="status-hint">Markdown aktiv</span>
      </div>
    </section>
  );
}
