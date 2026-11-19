import { createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { DrawingCanvas } from './components/DrawingCanvas';
import { HomePage } from './components/HomePage';
import { NoteHeader } from './components/NoteHeader';
import { NoteTabs } from './components/NoteTabs';
import { SettingsPage } from './components/SettingsPage';
import { Sidebar } from './components/Sidebar';
import { TextEditor } from './components/TextEditor';
import { createNotesStore } from './store/notesStore';

export function App() {
  const store = createNotesStore();
  const [splitRatio, setSplitRatio] = createSignal(44); // % width for text pane on desktop
  const [isDraggingSplit, setIsDraggingSplit] = createSignal(false);
  let workspaceRef: HTMLDivElement | undefined;

  const startSplitDrag = (e: PointerEvent) => {
    e.preventDefault();
    setIsDraggingSplit(true);
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
  };

  const onSplitDragMove = (e: PointerEvent) => {
    if (!isDraggingSplit() || !workspaceRef) return;
    const rect = workspaceRef.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rawPct = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitRatio(Math.max(24, Math.min(76, rawPct)));
  };

  const endSplitDrag = (e: PointerEvent) => {
    if (!isDraggingSplit()) return;
    setIsDraggingSplit(false);
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
  };

  onMount(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        if (store.activeScreen() === 'settings') {
          store.closeSettings();
        } else {
          store.openSettings(store.activeScreen() === 'note' ? 'local' : 'global');
        }
        return;
      }

      if (e.key === 'Escape' && store.activeScreen() === 'settings' && !isEditable) {
        e.preventDefault();
        store.closeSettings();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        store.createNote();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'w') {
        const activeId = store.activeNoteId();
        if (store.activeScreen() === 'note' && activeId) {
          e.preventDefault();
          store.closeTab(activeId);
        }
        return;
      }

      if (!isEditable && store.activeScreen() === 'note' && (e.ctrlKey || e.metaKey)) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          store.undoCanvas();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          store.redoCanvas();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleGlobalKeyDown));
  });

  return (
    <div class="app-shell" classList={{ 'is-dragging-split': isDraggingSplit() }}>
      <Sidebar store={store} />

      <Show when={store.sidebarOpen()}>
        <div
          class="sidebar-backdrop"
          onClick={() => store.setSidebarOpen(false)}
          aria-hidden="true"
        />
      </Show>

      <main class="main-column">
        <NoteTabs store={store} />

        <Switch fallback={<HomePage store={store} />}>
          <Match when={store.activeScreen() === 'settings'}>
            <SettingsPage store={store} />
          </Match>

          <Match when={store.activeScreen() === 'note' && store.activeNote()}>
            <NoteHeader store={store} />
            <div
              ref={workspaceRef}
              class="workspace"
              classList={{
                'mode-split': store.viewMode() === 'split',
                'mode-text': store.viewMode() === 'text',
                'mode-canvas': store.viewMode() === 'canvas',
              }}
              style={{ '--split-ratio': `${splitRatio()}%` }}
            >
              <Show when={store.viewMode() === 'split' || store.viewMode() === 'text'}>
                <TextEditor store={store} />
              </Show>

              <Show when={store.viewMode() === 'split'}>
                <div
                  class="split-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Größe von Text und Zeichenfläche anpassen"
                  onPointerDown={startSplitDrag}
                  onPointerMove={onSplitDragMove}
                  onPointerUp={endSplitDrag}
                  onPointerCancel={endSplitDrag}
                >
                  <span class="split-handle" />
                </div>
              </Show>

              <Show when={store.viewMode() === 'split' || store.viewMode() === 'canvas'}>
                <DrawingCanvas store={store} />
              </Show>
            </div>
          </Match>
        </Switch>
      </main>

      <Show when={store.toastMessage()}>
        {(msg) => (
          <div class="toast" role="status" aria-live="polite">
            {msg()}
          </div>
        )}
      </Show>
    </div>
  );
}

export default App;
