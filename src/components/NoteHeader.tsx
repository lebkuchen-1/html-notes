import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import type { Folder, ViewMode } from '../types';
import {
  addWordToPersonalDictionary,
  applySpellReplacement,
  findSpellIssues,
  getHtmlLangForSpellCheck,
  getSpellCheckRevision,
  getSpellSuggestions,
  type SpellIssue,
} from '../utils/spellcheck';
import {
  IconClipboardPaste,
  IconExitFullscreen,
  IconFolder,
  IconMaximize,
  IconMoon,
  IconPalette,
  IconPin,
  IconSettings,
  IconSidebar,
  IconSpellCheck,
  IconSplit,
  IconSun,
  IconText,
  IconX,
} from './Icons';

interface NoteHeaderProps {
  store: NotesStore;
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'split', label: 'Kombiniert' },
  { id: 'text', label: 'Text' },
];

export function NoteHeader(props: NoteHeaderProps) {
  const [tagDraft, setTagDraft] = createSignal('');
  const [addingTag, setAddingTag] = createSignal(false);
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [titleSpellOpen, setTitleSpellOpen] = createSignal(false);
  let titleInputRef: HTMLInputElement | undefined;
  let titleRowRef: HTMLDivElement | undefined;
  let tagInputRef: HTMLInputElement | undefined;
  let titleSpellRef: HTMLDivElement | undefined;

  const note = () => props.store.activeNote();
  const effSettings = () => props.store.effectiveSettings();

  // Exit title editing whenever switching to a different note
  createEffect(() => {
    void props.store.activeNoteId();
    setEditingTitle(false);
  });

  const titleSpellIssues = createMemo<SpellIssue[]>(() => {
    void getSpellCheckRevision();
    if (!effSettings().spellCheckEnabled) return [];
    const title = note()?.title ?? '';
    if (!title.trim()) return [];
    return findSpellIssues(title, effSettings().spellCheckLanguage);
  });

  createEffect(() => {
    if (titleSpellIssues().length === 0 && titleSpellOpen()) {
      setTitleSpellOpen(false);
    }
  });

  onMount(() => {
    const handleOutside = (e: PointerEvent) => {
      if (titleSpellOpen() && titleSpellRef && !titleSpellRef.contains(e.target as Node)) {
        setTitleSpellOpen(false);
      }
    };

    // Capture-phase dismissal so tapping/drawing on the canvas (which calls preventDefault()
    // and therefore suppresses native input blur) or tapping any UI area immediately closes
    // the active title/tag input and prevents iPadOS Scribble from staying latched to it.
    const handleCaptureOutsideInput = (e: Event) => {
      const target = e.target as Node | null;
      if (editingTitle()) {
        if (!target || !titleRowRef?.contains(target)) {
          titleInputRef?.blur();
          setEditingTitle(false);
        }
      }
      if (addingTag()) {
        if (!target || !tagInputRef?.contains(target)) {
          tagInputRef?.blur();
          submitTag();
        }
      }
    };

    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('pointerdown', handleCaptureOutsideInput, { capture: true });
    document.addEventListener('touchstart', handleCaptureOutsideInput, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('pointerdown', handleCaptureOutsideInput, {
        capture: true,
      });
      document.removeEventListener('touchstart', handleCaptureOutsideInput, {
        capture: true,
      });
    });
  });

  createEffect(() => {
    const title = note()?.title ?? '';
    if (titleInputRef && titleInputRef.value !== title) {
      titleInputRef.value = title;
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
    <header class="note-header">
      <div class="header-left">
        <button
          type="button"
          class="icon-btn"
          onClick={() => props.store.setSidebarOpen((v) => !v)}
          title="Seitenleiste umschalten"
          aria-label="Seitenleiste umschalten"
        >
          <IconSidebar size={18} />
        </button>

        <Show when={note()}>
          {(current) => (
            <div class="title-area">
              <div class="title-input-row" ref={titleRowRef}>
                <Show
                  when={editingTitle()}
                  fallback={
                    <button
                      type="button"
                      class="note-title-display"
                      classList={{ 'is-placeholder': !current().title.trim() }}
                      onClick={() => setEditingTitle(true)}
                      title="Tippen zum Umbenennen der Notiz"
                      aria-label={`Notiztitel: ${current().title.trim() || 'Ohne Titel'} (zum Bearbeiten tippen)`}
                    >
                      {current().title || 'Titel der Notiz…'}
                    </button>
                  }
                >
                  <input
                    ref={(el) => {
                      titleInputRef = el;
                      el.value = current().title;
                      requestAnimationFrame(() => {
                        el.focus();
                      });
                    }}
                    type="text"
                    class="note-title-input"
                    lang={getHtmlLangForSpellCheck(effSettings().spellCheckLanguage)}
                    spellcheck={effSettings().spellCheckEnabled}
                    autocorrect="on"
                    onInput={(e) => props.store.updateTitle(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        e.preventDefault();
                        e.currentTarget.blur();
                        setEditingTitle(false);
                      }
                    }}
                    onBlur={() => setEditingTitle(false)}
                    placeholder="Titel der Notiz…"
                    aria-label="Notiztitel"
                  />
                </Show>
                <Show when={titleSpellIssues().length > 0}>
                  <div class="title-spell-anchor" ref={titleSpellRef}>
                    <button
                      type="button"
                      class="title-spell-pill"
                      onClick={() => setTitleSpellOpen((v) => !v)}
                      title={`Rechtschreibhinweis im Titel (${titleSpellIssues().length})`}
                      aria-label="Rechtschreibvorschläge für Notiztitel"
                    >
                      <IconSpellCheck size={12} />
                      <span>{titleSpellIssues().length}</span>
                    </button>
                    <Show when={titleSpellOpen()}>
                      <div class="paper-popover title-spell-popover" role="dialog">
                        <div class="paper-popover-header">
                          <span>Titel-Rechtschreibung</span>
                          <button
                            type="button"
                            class="icon-btn-xs"
                            onClick={() => setTitleSpellOpen(false)}
                            aria-label="Schließen"
                          >
                            <IconX size={13} />
                          </button>
                        </div>
                        <div class="spell-issue-list">
                          <For each={titleSpellIssues()}>
                            {(issue) => {
                              const suggestions = () =>
                                getSpellSuggestions(
                                  issue.word,
                                  effSettings().spellCheckLanguage,
                                  5
                                );
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
                                              const nextTitle = applySpellReplacement(
                                                current().title,
                                                issue,
                                                sug
                                              );
                                              props.store.updateTitle(nextTitle);
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
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
              <div class="header-tags">
                <Show when={folderOptions().length > 0}>
                  <label class="header-folder-select" title="Ordner zuweisen">
                    <span
                      class="hfs-icon"
                      style={{ color: activeFolderColor() ?? 'var(--text-muted)' }}
                    >
                      <IconFolder size={12} />
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
          )}
        </Show>
      </div>

      <div class="header-right">
        <div class="view-switcher" role="tablist" aria-label="Ansichtsmodus">
          <For each={VIEW_MODES}>
            {(mode) => (
              <button
                type="button"
                role="tab"
                aria-selected={props.store.viewMode() === mode.id}
                class="view-switch-btn"
                classList={{ 'is-active': props.store.viewMode() === mode.id }}
                onClick={() => props.store.setViewMode(mode.id)}
                title={mode.label}
              >
                {mode.id === 'split' && <IconSplit size={15} />}
                {mode.id === 'text' && <IconText size={15} />}
                {mode.id === 'canvas' && <IconPalette size={15} />}
                <span class="view-switch-label">{mode.label}</span>
              </button>
            )}
          </For>
        </div>

        <Show when={note()}>
          {(current) => (
            <>
              <button
                type="button"
                class="icon-btn"
                onClick={() => void props.store.quickImportFromClipboard('existing')}
                title="Schnellimport aus Zwischenablage (Safari: Teilen → Kopieren) · Strg+Umschalt+V"
                aria-label="Aus Zwischenablage importieren"
              >
                <IconClipboardPaste size={17} />
              </button>

              <button
                type="button"
                class="icon-btn"
                classList={{ 'is-accent': current().pinned }}
                onClick={() => props.store.togglePin(current().id)}
                title={current().pinned ? 'Nicht mehr anpinnen' : 'Notiz anpinnen'}
              >
                <IconPin size={17} filled={current().pinned} />
              </button>

              <button
                type="button"
                class="icon-btn note-settings-btn"
                classList={{
                  'has-overrides': props.store.activeNoteLocalOverrideCount() > 0,
                }}
                onClick={() => props.store.openSettings('local')}
                title={
                  props.store.activeNoteLocalOverrideCount() > 0
                    ? `Notiz- & globale Einstellungen (${props.store.activeNoteLocalOverrideCount()} lokale Anpassungen) · Strg+,`
                    : 'Notiz- & globale Einstellungen öffnen (Strg+,)'
                }
                aria-label="Einstellungen für diese Notiz"
              >
                <IconSettings size={17} />
                <Show when={props.store.activeNoteLocalOverrideCount() > 0}>
                  <span class="override-dot" />
                </Show>
              </button>
            </>
          )}
        </Show>

        <button
          type="button"
          class="icon-btn"
          classList={{ 'is-fullscreen-active': props.store.isFullscreen() }}
          onClick={() => props.store.toggleFullscreen()}
          title={
            props.store.isFullscreen()
              ? 'Vollbildmodus beenden (F11 / Esc)'
              : 'Vollbildmodus: Browser-Leisten ausblenden & UI verkleinern (F11 / Strg+Umschalt+F)'
          }
          aria-label={
            props.store.isFullscreen() ? 'Vollbildmodus beenden' : 'Vollbildmodus aktivieren'
          }
        >
          <Show
            when={props.store.isFullscreen()}
            fallback={<IconMaximize size={16} />}
          >
            <IconExitFullscreen size={16} />
          </Show>
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
  );
}
