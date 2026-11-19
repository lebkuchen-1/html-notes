import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import type { Folder, ViewMode } from '../types';
import {
  IconFolder,
  IconMoon,
  IconPalette,
  IconPin,
  IconSettings,
  IconSidebar,
  IconSplit,
  IconSun,
  IconText,
  IconX,
} from './Icons';

interface NoteHeaderProps {
  store: NotesStore;
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'split', label: 'Kombiniert' },
  { id: 'text', label: 'Text' },
  { id: 'canvas', label: 'Canvas' },
];

export function NoteHeader(props: NoteHeaderProps) {
  const [tagDraft, setTagDraft] = createSignal('');
  const [addingTag, setAddingTag] = createSignal(false);
  let titleInputRef: HTMLInputElement | undefined;

  const note = () => props.store.activeNote();

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
              <input
                ref={(el) => {
                  titleInputRef = el;
                  el.value = current().title;
                }}
                type="text"
                class="note-title-input"
                onInput={(e) => props.store.updateTitle(e.currentTarget.value)}
                placeholder="Titel der Notiz…"
                aria-label="Notiztitel"
              />
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
                    ref={(el) => requestAnimationFrame(() => el.focus())}
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
