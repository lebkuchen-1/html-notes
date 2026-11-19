import { createMemo, createSignal, For, Show } from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import { IconHome, IconPen, IconPin, IconPlus, IconX } from './Icons';

interface NoteTabsProps {
  store: NotesStore;
}

export function NoteTabs(props: NoteTabsProps) {
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [dragOverId, setDragOverId] = createSignal<string | null>(null);
  let stripRef: HTMLDivElement | undefined;

  const handleWheel = (e: WheelEvent) => {
    if (!stripRef) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      stripRef.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  return (
    <div
      class="note-tabs-bar"
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

        <For each={props.store.openTabIds()}>
          {(tabId) => {
            const note = createMemo(() =>
              props.store.notes().find((n) => n.id === tabId)
            );
            const isActive = () =>
              props.store.activeScreen() === 'note' &&
              props.store.activeNoteId() === tabId;

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

                  return (
                    <div
                      role="tab"
                      tabIndex={0}
                      aria-selected={isActive()}
                      draggable={true}
                      class="note-tab"
                      classList={{
                        'is-active': isActive(),
                        'is-dragging': draggingId() === tabId,
                        'is-drag-target':
                          dragOverId() === tabId && draggingId() !== tabId,
                      }}
                      title={curr().title.trim() || 'Unbenannte Notiz'}
                      onClick={() => props.store.openNote(tabId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          props.store.openNote(tabId);
                        }
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          props.store.closeTab(tabId);
                        }
                      }}
                      onDragStart={(e) => {
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
                              when={hasCanvas()}
                              fallback={<span class="note-tab-dot" />}
                            >
                              <IconPen size={11} />
                            </Show>
                          }
                        >
                          <IconPin size={11} filled />
                        </Show>
                      </span>

                      <span class="note-tab-title">
                        {curr().title.trim() || 'Unbenannte Notiz'}
                      </span>

                      <Show when={curr().pages.length > 1}>
                        <span class="note-tab-pages">{curr().pages.length}</span>
                      </Show>

                      <button
                        type="button"
                        class="note-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
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
