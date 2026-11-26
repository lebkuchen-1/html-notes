import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import { IconFlashcards, IconHome, IconPen, IconPin, IconPlus, IconX } from './Icons';

interface NoteTabsProps {
  store: NotesStore;
  embedded?: boolean;
}

export function NoteTabs(props: NoteTabsProps) {
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);
  const [editingTabId, setEditingTabId] = createSignal<string | null>(null);
  let stripRef: HTMLDivElement | undefined;
  let titleInputRef: HTMLInputElement | undefined;

  // Exit inline tab rename whenever switching active note or screen
  createEffect(() => {
    void props.store.activeNoteId();
    void props.store.activeScreen();
    setEditingTabId(null);
  });

  onMount(() => {
    const handleCaptureOutside = (e: Event) => {
      if (!editingTabId()) return;
      const target = e.target as Node | null;
      if (!target || !titleInputRef?.contains(target)) {
        titleInputRef?.blur();
        setEditingTabId(null);
      }
    };

    document.addEventListener('pointerdown', handleCaptureOutside, { capture: true });
    document.addEventListener('touchstart', handleCaptureOutside, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      document.removeEventListener('pointerdown', handleCaptureOutside, { capture: true });
      document.removeEventListener('touchstart', handleCaptureOutside, { capture: true });
    });
  });

  const handleWheel = (e: WheelEvent) => {
    if (!stripRef) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      stripRef.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  const folderColorMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const f of props.store.folders()) {
      if (f.color) map.set(f.id, f.color);
    }
    return map;
  });

  return (
    <div
      class="note-tabs-bar"
      classList={{ 'is-embedded': Boolean(props.embedded) }}
      onDblClick={(e) => {
        if (e.target === e.currentTarget || e.target === stripRef) {
          props.store.createNote();
        }
      }}
    >
      <div
        ref={stripRef}
        class="note-tabs-list"
        role="tablist"
        aria-label="Geöffnete Notizen"
        onWheel={handleWheel}
      >
        {/* Pinned Start / Overview Tab */}
        <button
          type="button"
          role="tab"
          aria-selected={props.store.activeScreen() === 'home'}
          class="note-tab is-home-tab"
          classList={{ 'is-active': props.store.activeScreen() === 'home' }}
          onClick={() => props.store.openHome()}
          title="Startseite / Übersicht"
        >
          <span class="note-tab-icon" aria-hidden="true">
            <IconHome size={13} />
          </span>
          <span class="note-tab-title">Übersicht</span>
        </button>

        {/* Pinned Flashcards Tab */}
        <button
          type="button"
          role="tab"
          aria-selected={props.store.activeScreen() === 'flashcards'}
          class="note-tab is-home-tab is-flashcards-tab"
          classList={{ 'is-active': props.store.activeScreen() === 'flashcards' }}
          onClick={() => props.store.openFlashcards({ type: 'all' }, false)}
          title="Karteikarten lernen & verwalten"
        >
          <span class="note-tab-icon" aria-hidden="true">
            <IconFlashcards size={13} />
          </span>
          <span class="note-tab-title">Karten</span>
          <Show when={props.store.flashcardDeckStats().due > 0}>
            <span class="note-tab-due-badge">
              {props.store.flashcardDeckStats().due}
            </span>
          </Show>
        </button>

        <For each={props.store.openTabIds()}>
          {(tabId) => {
            const note = createMemo(() =>
              props.store.notes().find((n) => n.id === tabId)
            );
            const isActive = () =>
              props.store.activeScreen() === 'note' &&
              props.store.activeNoteId() === tabId;
            const isEditingThis = () => editingTabId() === tabId;

            return (
              <Show when={note()}>
                {(curr) => {
                  const hasCanvas = () =>
                    curr().pages.some(
                      (p) =>
                        p.strokes.length > 0 ||
                        p.texts.length > 0 ||
                        p.images.length > 0
                    );
                  const folderColor = () => {
                    const fid = curr().folderId;
                    return fid ? folderColorMap().get(fid) : undefined;
                  };

                  return (
                    <div
                      role="tab"
                      tabIndex={0}
                      aria-selected={isActive()}
                      draggable={!isEditingThis()}
                      class="note-tab"
                      classList={{
                        'is-active': isActive(),
                        'is-editing': isEditingThis(),
                        'is-dragging': draggingId() === tabId,
                        'is-drag-target':
                          dragOverId() === tabId && draggingId() !== tabId,
                      }}
                      title={
                        isActive()
                          ? `${curr().title.trim() || 'Ohne Titel'} — tippen zum Umbenennen`
                          : curr().title.trim() || 'Unbenannte Notiz'
                      }
                      onClick={() => {
                        if (isActive()) {
                          if (!isEditingThis()) setEditingTabId(tabId);
                        } else {
                          setEditingTabId(null);
                          props.store.openNote(tabId);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (isEditingThis()) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (isActive()) setEditingTabId(tabId);
                          else props.store.openNote(tabId);
                        }
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          props.store.closeTab(tabId);
                        }
                      }}
                      onDragStart={(e) => {
                        if (isEditingThis()) {
                          e.preventDefault();
                          return;
                        }
                        setDraggingId(tabId);
                        e.dataTransfer?.setData('text/plain', tabId);
                        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (draggingId() && draggingId() !== tabId) {
                          e.preventDefault();
                          setDragOverId(tabId);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverId() === tabId) setDragOverId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = draggingId();
                        if (fromId && fromId !== tabId) {
                          props.store.moveTab(fromId, tabId);
                        }
                        setDraggingId(null);
                        setDragOverId(null);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverId(null);
                      }}
                    >
                      <span class="note-tab-icon" aria-hidden="true">
                        <Show
                          when={curr().pinned}
                          fallback={
                            <Show
                              when={folderColor()}
                              fallback={
                                <Show
                                  when={hasCanvas()}
                                  fallback={<span class="note-tab-dot" />}
                                >
                                  <IconPen size={11} />
                                </Show>
                              }
                            >
                              {(color) => (
                                <span
                                  class="note-tab-folder-dot"
                                  style={{ background: color() }}
                                />
                              )}
                            </Show>
                          }
                        >
                          <IconPin size={11} filled />
                        </Show>
                      </span>

                      <Show
                        when={isEditingThis()}
                        fallback={
                          <span
                            class="note-tab-title"
                            classList={{ 'is-placeholder': !curr().title.trim() }}
                          >
                            {curr().title.trim() || 'Ohne Titel'}
                          </span>
                        }
                      >
                        <input
                          ref={(el) => {
                            titleInputRef = el;
                            el.value = curr().title;
                            requestAnimationFrame(() => {
                              el.focus();
                              el.select();
                            });
                          }}
                          type="text"
                          class="note-tab-title-input"
                          onClick={(e) => e.stopPropagation()}
                          onInput={(e) => props.store.updateTitle(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter' || e.key === 'Escape') {
                              e.preventDefault();
                              e.currentTarget.blur();
                              setEditingTabId(null);
                            }
                          }}
                          onBlur={() => setEditingTabId(null)}
                          placeholder="Titel…"
                          aria-label="Notiztitel bearbeiten"
                        />
                      </Show>

                      <Show when={curr().pages.length > 1 && !isEditingThis()}>
                        <span class="note-tab-pages">{curr().pages.length}</span>
                      </Show>

                      <button
                        type="button"
                        class="note-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTabId(null);
                          props.store.closeTab(tabId);
                        }}
                        title="Tab schließen (Strg+Alt+W)"
                        aria-label={`Tab „${curr().title.trim() || 'Unbenannte Notiz'}“ schließen`}
                      >
                        <IconX size={12} />
                      </button>
                    </div>
                  );
                }}
              </Show>
            );
          }}
        </For>

        <button
          type="button"
          class="note-tab-add"
          onClick={() => props.store.createNote()}
          title="Neue Notiz in neuem Tab öffnen (Strg+Alt+N)"
          aria-label="Neuen Notiz-Tab öffnen"
        >
          <IconPlus size={14} />
        </button>
      </div>
    </div>
  );
}
