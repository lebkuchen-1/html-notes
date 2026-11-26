import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import type { FlashcardScope, NotesStore } from '../store/notesStore';
import type {
  CanvasPage,
  FlashcardRating,
  Folder,
  ManualFlashcard,
  Note,
} from '../types';
import {
  computeDeckStats,
  formatIntervalGerman,
  getCardStatus,
  isCardDue,
  parseClozeText,
  previewRatingIntervals,
  type StudyCard,
  type StudyCardSource,
} from '../utils/flashcards';
import { renderInlineMarkdown } from '../utils/markdown';
import { FlashcardScratchpad } from './FlashcardScratchpad';
import { OcclusionStudyCanvas } from './OcclusionStudyCanvas';
import {
  IconArrowLeft,
  IconBidirectional,
  IconCheck,
  IconEdit,
  IconExitFullscreen,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconFlashcards,
  IconFolder,
  IconMaximize,
  IconMoon,
  IconOcclusion,
  IconPen,
  IconPlay,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconSidebar,
  IconSparkles,
  IconSplit,
  IconSun,
  IconTrash,
  IconX,
} from './Icons';

interface FlashcardsPageProps {
  store: NotesStore;
}

type SourceFilter = 'all' | StudyCardSource;
type StudyMode = 'srs' | 'practice';

export function FlashcardsPage(props: FlashcardsPageProps) {
  const [sourceFilter, setSourceFilter] = createSignal<SourceFilter>('all');
  const [search, setSearch] = createSignal('');
  const [showSyntaxHelp, setShowSyntaxHelp] = createSignal(false);

  // Study session state
  const [inSession, setInSession] = createSignal(false);
  const [studyMode, setStudyMode] = createSignal<StudyMode>('srs');
  const [queue, setQueue] = createSignal<StudyCard[]>([]);
  const [revealed, setRevealed] = createSignal(false);
  const [sessionTotalInitial, setSessionTotalInitial] = createSignal(0);
  const [sessionDoneCount, setSessionDoneCount] = createSignal(0);
  const [sessionCounts, setSessionCounts] = createSignal<Record<FlashcardRating, number>>({
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  });
  const [occViewMode, setOccViewMode] = createSignal<'focus' | 'full'>('focus');
  const [hideOtherOcclusions, setHideOtherOcclusions] = createSignal(true);

  // Freehand answer scratchpad & compare mode state
  const [scratchpadOpen, setScratchpadOpen] = createSignal<boolean>(
    (() => {
      try {
        const saved = localStorage.getItem('solid-notes:v1:fcScratchpadOpen');
        if (saved === '0') return false;
        if (saved === '1') return true;
      } catch {
        // ignore
      }
      return true;
    })()
  );
  const [compareLayout, setCompareLayout] = createSignal<'side' | 'stack'>(
    (() => {
      try {
        const saved = localStorage.getItem('solid-notes:v1:fcCompareLayout');
        if (saved === 'stack' || saved === 'side') return saved;
      } catch {
        // ignore
      }
      return 'side';
    })()
  );
  const [scratchpadResetToken, setScratchpadResetToken] = createSignal<number>(0);
  const [scratchpadHasDrawing, setScratchpadHasDrawing] = createSignal<boolean>(false);
  const [occCanvasHasDrawing, setOccCanvasHasDrawing] = createSignal<boolean>(false);
  const [extraScratchpadOnOcclusion, setExtraScratchpadOnOcclusion] =
    createSignal<boolean>(false);

  const anyAnswerDrawn = () => scratchpadHasDrawing() || occCanvasHasDrawing();

  createEffect(() => {
    try {
      localStorage.setItem('solid-notes:v1:fcScratchpadOpen', scratchpadOpen() ? '1' : '0');
      localStorage.setItem('solid-notes:v1:fcCompareLayout', compareLayout());
    } catch {
      // ignore
    }
  });

  // Create / Edit Manual Card modal state
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingCardId, setEditingCardId] = createSignal<string | null>(null);
  const [editorNoteId, setEditorNoteId] = createSignal<string>('');
  const [editorKind, setEditorKind] = createSignal<'basic' | 'cloze'>('basic');
  const [editorFront, setEditorFront] = createSignal('');
  const [editorBack, setEditorBack] = createSignal('');
  const [editorBidirectional, setEditorBidirectional] = createSignal(true);
  const [editorHint, setEditorHint] = createSignal('');
  let clozeTextareaRef: HTMLTextAreaElement | undefined;

  const scope = () => props.store.flashcardScope();

  // Helper: folder subtree resolution
  const getFolderSubtree = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    const list = props.store.folders();
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of list) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          changed = true;
        }
      }
    }
    return ids;
  };

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

  const scopedCards = createMemo<StudyCard[]>(() => {
    const all = props.store.allStudyCards();
    const s = scope();
    if (s.type === 'note') {
      return all.filter((c) => c.noteId === s.noteId);
    }
    if (s.type === 'folder') {
      const allowed = getFolderSubtree(s.folderId);
      return all.filter((c) => c.folderId !== null && allowed.has(c.folderId));
    }
    return all;
  });

  const filteredCards = createMemo<StudyCard[]>(() => {
    const src = sourceFilter();
    const q = search().trim().toLowerCase();
    return scopedCards().filter((c) => {
      if (src !== 'all' && c.source !== src) return false;
      if (!q) return true;
      return (
        c.previewTitle.toLowerCase().includes(q) ||
        c.previewAnswer.toLowerCase().includes(q) ||
        c.noteTitle.toLowerCase().includes(q) ||
        c.folderPath.toLowerCase().includes(q) ||
        (c.contextLabel ?? '').toLowerCase().includes(q)
      );
    });
  });

  const deckStats = createMemo(() =>
    computeDeckStats(filteredCards(), props.store.flashcardProgress())
  );

  const dueCards = createMemo(() => {
    const progress = props.store.flashcardProgress();
    const now = Date.now();
    return filteredCards().filter((c) => isCardDue(c.cardKey, progress, now));
  });

  const scopeTitle = createMemo(() => {
    const s = scope();
    if (s.type === 'note') {
      const n = props.store.notes().find((item) => item.id === s.noteId);
      return n ? n.title.trim() || 'Unbenannte Notiz' : 'Notiz';
    }
    if (s.type === 'folder') {
      const f = props.store.folders().find((item) => item.id === s.folderId);
      return f ? `Ordner: ${f.name}` : 'Ordner';
    }
    return 'Alle Notizen';
  });

  const currentCard = createMemo<StudyCard | null>(() => queue()[0] ?? null);

  const currentCardNote = createMemo<Note | undefined>(() => {
    const card = currentCard();
    if (!card) return undefined;
    return props.store.notes().find((n) => n.id === card.noteId);
  });

  const currentCardPage = createMemo<CanvasPage | undefined>(() => {
    const card = currentCard();
    const note = currentCardNote();
    if (!card?.pageId || !note) return undefined;
    return note.pages.find((p) => p.id === card.pageId);
  });

  const ratingPreviews = createMemo(() => {
    const card = currentCard();
    if (!card) return { again: '< 1 Min.', hard: '10 Min.', good: '1 Tag', easy: '4 Tage' };
    return previewRatingIntervals(
      props.store.flashcardProgress()[card.cardKey],
      card.cardKey
    );
  });

  const startSession = (mode: StudyMode) => {
    const progress = props.store.flashcardProgress();
    const now = Date.now();
    const candidates =
      mode === 'srs'
        ? filteredCards().filter((c) => isCardDue(c.cardKey, progress, now))
        : filteredCards().filter((c) => !progress[c.cardKey]?.suspended);

    if (candidates.length === 0) {
      props.store.showToast(
        mode === 'srs'
          ? 'Aktuell sind keine Karten fällig — nutze „Alle üben“ für den Übungsmodus'
          : 'Keine aktiven Karteikarten in dieser Auswahl'
      );
      return;
    }

    // Light shuffle while keeping bidirectional pairs separated when possible
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    setStudyMode(mode);
    setQueue(shuffled);
    setSessionTotalInitial(shuffled.length);
    setSessionDoneCount(0);
    setSessionCounts({ again: 0, hard: 0, good: 0, easy: 0 });
    setRevealed(false);
    setOccViewMode('focus');
    setScratchpadHasDrawing(false);
    setOccCanvasHasDrawing(false);
    setScratchpadResetToken((n) => n + 1);
    setInSession(true);
  };

  // Auto-start study session when requested from Canvas / NoteHeader "Lernen" button
  createEffect(() => {
    if (props.store.flashcardAutoStart()) {
      props.store.setFlashcardAutoStart(false);
      const due = dueCards();
      if (due.length > 0) {
        startSession('srs');
      } else if (filteredCards().length > 0) {
        startSession('practice');
      }
    }
  });

  const submitRating = (rating: FlashcardRating) => {
    const card = currentCard();
    if (!card) return;

    if (studyMode() === 'srs') {
      props.store.reviewFlashcard(card.cardKey, rating);
    }

    setSessionCounts((prev) => ({ ...prev, [rating]: prev[rating] + 1 }));

    setQueue((prev) => {
      const rest = prev.slice(1);
      if (rating === 'again') {
        // Re-insert card 2–3 cards later so the user practices it again right away
        const insertAt = Math.min(rest.length, 2);
        return [...rest.slice(0, insertAt), card, ...rest.slice(insertAt)];
      }
      return rest;
    });

    if (rating !== 'again') {
      setSessionDoneCount((n) => n + 1);
    }
    setRevealed(false);
    setScratchpadHasDrawing(false);
    setOccCanvasHasDrawing(false);
    setScratchpadResetToken((n) => n + 1);
  };

  const exitSession = () => {
    setInSession(false);
    setQueue([]);
    setRevealed(false);
    setScratchpadHasDrawing(false);
    setOccCanvasHasDrawing(false);
    setScratchpadResetToken((n) => n + 1);
  };

  // Keyboard shortcuts during study session
  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editorOpen()) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setEditorOpen(false);
        }
        return;
      }

      if (!inSession()) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        exitSession();
        return;
      }

      if (!currentCard()) return;

      if (!revealed()) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setRevealed(true);
        }
        return;
      }

      if (studyMode() === 'srs') {
        if (e.key === '1') {
          e.preventDefault();
          submitRating('again');
        } else if (e.key === '2') {
          e.preventDefault();
          submitRating('hard');
        } else if (e.key === '3' || e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          submitRating('good');
        } else if (e.key === '4') {
          e.preventDefault();
          submitRating('easy');
        }
      } else {
        if (e.key === '1') {
          e.preventDefault();
          submitRating('again');
        } else if (e.key === ' ' || e.key === 'Enter' || e.key === '2' || e.key === '3') {
          e.preventDefault();
          submitRating('good');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  // ==================== Manual Card Editor ====================
  const openCreateCardModal = () => {
    const s = scope();
    const defaultNoteId =
      s.type === 'note'
        ? s.noteId
        : props.store.activeNoteId() ?? props.store.notes()[0]?.id ?? '';
    setEditingCardId(null);
    setEditorNoteId(defaultNoteId);
    setEditorKind('basic');
    setEditorFront('');
    setEditorBack('');
    setEditorBidirectional(true);
    setEditorHint('');
    setEditorOpen(true);
  };

  const openEditManualCardModal = (noteId: string, cardId: string) => {
    const note = props.store.notes().find((n) => n.id === noteId);
    const existing = note?.flashcards?.find((c) => c.id === cardId);
    if (!existing) return;
    setEditingCardId(existing.id);
    setEditorNoteId(noteId);
    setEditorKind(existing.kind);
    setEditorFront(existing.front);
    setEditorBack(existing.back);
    setEditorBidirectional(existing.bidirectional);
    setEditorHint(existing.hint ?? '');
    setEditorOpen(true);
  };

  const wrapClozeSelection = (groupPrefix?: string) => {
    const el = clozeTextareaRef;
    const val = editorFront();
    const openTag = groupPrefix ? `{{${groupPrefix}::` : '{{';
    if (!el) {
      setEditorFront(`${val}${openTag}verdeckter Begriff}}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = val.slice(start, end) || 'verdeckter Begriff';
    const next = val.slice(0, start) + openTag + selected + '}}' + val.slice(end);
    setEditorFront(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + openTag.length, start + openTag.length + selected.length);
    });
  };

  const clozeEditorCount = createMemo(() => {
    if (editorKind() !== 'cloze') return 0;
    const parsed = parseClozeText(editorFront());
    return parsed ? parsed.groupOrder.length : 0;
  });

  const canSaveEditor = createMemo(() => {
    if (!editorNoteId()) return false;
    if (editorKind() === 'cloze') {
      return clozeEditorCount() > 0;
    }
    return editorFront().trim().length > 0 && editorBack().trim().length > 0;
  });

  const handleSaveManualCard = () => {
    if (!canSaveEditor()) return;
    const targetNoteId = editorNoteId();
    const editId = editingCardId();
    const payload: Omit<ManualFlashcard, 'id' | 'createdAt' | 'updatedAt'> = {
      kind: editorKind(),
      front: editorFront().trim(),
      back: editorKind() === 'basic' ? editorBack().trim() : '',
      bidirectional: editorKind() === 'basic' ? editorBidirectional() : false,
      ...(editorHint().trim() ? { hint: editorHint().trim() } : {}),
    };

    if (editId) {
      props.store.updateManualFlashcard(targetNoteId, editId, payload);
      props.store.showToast('Karteikarte aktualisiert');
    } else {
      props.store.addManualFlashcard(targetNoteId, payload);
    }
    setEditorOpen(false);
  };

  const formatCardBadge = (card: StudyCard): { label: string; cls: string } => {
    if (card.source === 'canvas') {
      if (card.pairId) {
        return {
          label: card.bidirectional
            ? card.direction === 'reverse'
              ? 'Canvas B → A (↔)'
              : 'Canvas A → B (↔)'
            : 'Canvas A → B',
          cls: 'is-canvas-bi',
        };
      }
      if (card.groupId) {
        return { label: `Canvas Gruppe ${card.groupId}`, cls: 'is-canvas' };
      }
      return { label: 'Canvas-Stelle', cls: 'is-canvas' };
    }
    if (card.kind === 'cloze') {
      return { label: 'Stellen verbergen', cls: 'is-cloze' };
    }
    if (card.bidirectional) {
      return {
        label: card.direction === 'reverse' ? 'Beidseitig ←' : 'Beidseitig →',
        cls: 'is-bi',
      };
    }
    return {
      label: card.direction === 'reverse' ? 'Rückwärts ←' : 'Einseitig →',
      cls: 'is-basic',
    };
  };

  const formatStatusLabel = (cardKey: string): { label: string; cls: string } => {
    const map = props.store.flashcardProgress();
    const status = getCardStatus(cardKey, map);
    const p = map[cardKey];
    if (status === 'suspended') return { label: 'Ausgesetzt', cls: 'is-suspended' };
    if (status === 'new') return { label: 'Neu', cls: 'is-new' };
    if (status === 'learning') return { label: 'Lernphase', cls: 'is-learning' };
    if (status === 'due') return { label: 'Fällig', cls: 'is-due' };
    const daysLeft = p ? Math.max(1, Math.ceil((p.dueAt - Date.now()) / (24 * 60 * 60 * 1000))) : 1;
    return { label: `In ${formatIntervalGerman(daysLeft)}`, cls: 'is-mastered' };
  };

  const handleScopeSelect = (rawVal: string) => {
    if (rawVal === 'all') {
      props.store.setFlashcardScope({ type: 'all' });
    } else if (rawVal.startsWith('folder:')) {
      props.store.setFlashcardScope({
        type: 'folder',
        folderId: rawVal.slice('folder:'.length),
      });
    } else if (rawVal.startsWith('note:')) {
      props.store.setFlashcardScope({
        type: 'note',
        noteId: rawVal.slice('note:'.length),
      });
    }
  };

  const scopeSelectValue = () => {
    const s = scope();
    if (s.type === 'folder') return `folder:${s.folderId}`;
    if (s.type === 'note') return `note:${s.noteId}`;
    return 'all';
  };

  const sessionProgressPct = createMemo(() => {
    const total = Math.max(1, sessionTotalInitial());
    return Math.min(100, Math.round((sessionDoneCount() / total) * 100));
  });

  return (
    <div class="flashcards-page">
      {/* Top Bar */}
      <header class="flashcards-topbar">
        <div class="fc-topbar-left">
          <button
            type="button"
            class="icon-btn"
            onClick={() => props.store.setSidebarOpen((v) => !v)}
            title="Seitenleiste umschalten"
            aria-label="Seitenleiste umschalten"
          >
            <IconSidebar size={18} />
          </button>

          <button
            type="button"
            class="tool-pill"
            onClick={() => (inSession() ? exitSession() : props.store.closeFlashcards())}
            title={inSession() ? 'Lernsitzung beenden' : 'Zurück'}
          >
            <IconArrowLeft size={14} />
            <span>{inSession() ? 'Übersicht' : 'Zurück'}</span>
          </button>

          <div class="fc-title-group">
            <h1 class="fc-page-title">
              <IconFlashcards size={18} />
              <span>Karteikarten</span>
            </h1>
            <span class="fc-scope-subtitle">{scopeTitle()}</span>
          </div>
        </div>

        <div class="fc-topbar-right">
          <Show when={!inSession()}>
            <button
              type="button"
              class="btn-primary fc-new-btn"
              disabled={props.store.notes().length === 0}
              onClick={openCreateCardModal}
              title="Neue Karteikarte (Standard, Beidseitig oder Lückentext) anlegen"
            >
              <IconPlus size={14} />
              <span>Neue Karte</span>
            </button>
          </Show>

          <button
            type="button"
            class="icon-btn"
            classList={{ 'is-fullscreen-active': props.store.isFullscreen() }}
            onClick={() => props.store.toggleFullscreen()}
            title={props.store.isFullscreen() ? 'Vollbildmodus beenden' : 'Vollbildmodus'}
            aria-label="Vollbildmodus umschalten"
          >
            <Show when={props.store.isFullscreen()} fallback={<IconMaximize size={16} />}>
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

      {/* Main Content: Either Active Study Session OR Deck Hub */}
      <Show
        when={!inSession()}
        fallback={
          <div class="fc-study-stage">
            {/* Session Progress Strip */}
            <div class="fc-session-header">
              <div class="fc-session-meta">
                <span class="fc-session-mode-pill" classList={{ 'is-practice': studyMode() === 'practice' }}>
                  {studyMode() === 'srs' ? 'Spaced Repetition' : 'Übungsmodus (ohne Fälligkeit)'}
                </span>
                <span class="fc-session-counter">
                  {sessionDoneCount()} / {sessionTotalInitial()} geschafft
                  <Show when={queue().length > 0}>
                    {' '}· {queue().length} verbleibend
                  </Show>
                </span>
              </div>
              <div class="fc-progress-track">
                <div
                  class="fc-progress-fill"
                  style={{ width: `${sessionProgressPct()}%` }}
                />
              </div>
            </div>

            <Show
              when={currentCard()}
              fallback={
                /* Session Complete Card */
                <div class="fc-complete-card">
                  <div class="fc-complete-icon">
                    <IconSparkles size={28} />
                  </div>
                  <h2>Lernsitzung abgeschlossen!</h2>
                  <p>
                    Du hast <strong>{sessionDoneCount()}</strong>{' '}
                    {sessionDoneCount() === 1 ? 'Karteikarte' : 'Karteikarten'} erfolgreich
                    durchgearbeitet.
                  </p>
                  <div class="fc-complete-stats">
                    <span class="fc-cs-pill is-again">Nochmal: {sessionCounts().again}</span>
                    <Show when={studyMode() === 'srs'}>
                      <span class="fc-cs-pill is-hard">Schwer: {sessionCounts().hard}</span>
                    </Show>
                    <span class="fc-cs-pill is-good">
                      {studyMode() === 'srs' ? `Gut: ${sessionCounts().good}` : `Gewusst: ${sessionCounts().good}`}
                    </span>
                    <Show when={studyMode() === 'srs'}>
                      <span class="fc-cs-pill is-easy">Leicht: {sessionCounts().easy}</span>
                    </Show>
                  </div>
                  <div class="fc-complete-actions">
                    <button type="button" class="btn-ghost" onClick={exitSession}>
                      Zur Übersicht
                    </button>
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={() => startSession('practice')}
                    >
                      <IconRotateCcw size={14} />
                      <span>Alle nochmal üben</span>
                    </button>
                  </div>
                </div>
              }
            >
              {(card) => {
                const badge = () => formatCardBadge(card());
                const attachments = () => currentCardNote()?.attachments ?? [];

                const showSeparateScratchpad = () =>
                  card().kind === 'occlusion'
                    ? extraScratchpadOnOcclusion()
                    : scratchpadOpen();
                const isComparingSide = () =>
                  revealed() && showSeparateScratchpad() && compareLayout() === 'side';

                return (
                  <div
                    class="fc-card-shell"
                    classList={{
                      'is-compare-wide': isComparingSide(),
                    }}
                  >
                    {/* Card Breadcrumb & Source Jump */}
                    <div class="fc-card-top">
                      <div class="fc-card-crumb">
                        <Show when={card().folderPath}>
                          <span class="fc-crumb-folder">{card().folderPath}</span>
                          <span class="fc-crumb-sep">/</span>
                        </Show>
                        <span class="fc-crumb-note">{card().noteTitle}</span>
                        <Show when={card().contextLabel}>
                          <span class="fc-crumb-sep">·</span>
                          <span class="fc-crumb-ctx">{card().contextLabel}</span>
                        </Show>
                      </div>

                      <div class="fc-card-top-right">
                        <span class={`fc-type-badge ${badge().cls}`}>{badge().label}</span>

                        <button
                          type="button"
                          class="fc-jump-btn fc-sp-toggle-btn"
                          classList={{ 'is-active': showSeparateScratchpad() }}
                          onClick={() => {
                            if (card().kind === 'occlusion') {
                              setExtraScratchpadOnOcclusion((v) => !v);
                            } else {
                              setScratchpadOpen((v) => !v);
                            }
                          }}
                          title={
                            card().kind === 'occlusion'
                              ? showSeparateScratchpad()
                                ? 'Zusätzliches Antwortfeld ausblenden (Direkt-Zeichnen im Canvas bleibt aktiv)'
                                : 'Zusätzliches freies Antwortfeld neben dem Canvas öffnen'
                              : scratchpadOpen()
                                ? 'Freies Antwort-Zeichenfeld ausblenden'
                                : 'Freies Antwort-Zeichenfeld zum Einzeichnen mit Stift öffnen'
                          }
                          aria-pressed={showSeparateScratchpad()}
                        >
                          <IconPen size={13} />
                          <span>
                            {card().kind === 'occlusion' ? 'Extra-Feld' : 'Antwortfeld'}
                          </span>
                        </button>

                        <Show when={revealed() && showSeparateScratchpad()}>
                          <button
                            type="button"
                            class="fc-jump-btn fc-layout-toggle-btn"
                            classList={{ 'is-active': compareLayout() === 'side' }}
                            onClick={() =>
                              setCompareLayout((m) => (m === 'side' ? 'stack' : 'side'))
                            }
                            title={
                              compareLayout() === 'side'
                                ? 'Vergleich untereinander anzeigen'
                                : 'Vergleich nebeneinander anzeigen'
                            }
                          >
                            <IconSplit size={13} />
                            <span class="hide-compact">
                              {compareLayout() === 'side' ? 'Nebeneinander' : 'Untereinander'}
                            </span>
                          </button>
                        </Show>

                        <button
                          type="button"
                          class="fc-jump-btn"
                          onClick={() =>
                            props.store.openNoteAtPage(card().noteId, card().pageId)
                          }
                          title="Ursprungsnotiz öffnen"
                        >
                          <IconFileText size={13} />
                          <span class="hide-compact">Notiz öffnen</span>
                        </button>
                      </div>
                    </div>

                    {/* Card Face Body + Optional Freehand Scratchpad & Compare Layout */}
                    <div
                      class="fc-card-body"
                      classList={{
                        'is-compare-active': revealed() && showSeparateScratchpad(),
                        'is-compare-side': isComparingSide(),
                      }}
                    >
                      <div class="fc-solution-pane">
                        <Show when={revealed() && showSeparateScratchpad()}>
                          <div class="fc-compare-pane-header is-solution">
                            <IconCheck size={13} />
                            <span>Lösung</span>
                          </div>
                        </Show>

                        {/* 1. Canvas Occlusion Card */}
                      <Show when={card().kind === 'occlusion' && currentCardPage()}>
                        {(pg) => (
                          <div class="fc-occlusion-card-content">
                            <div class="fc-occ-controls">
                              <span class="fc-occ-prompt-text">
                                <Show
                                  when={card().pairId}
                                  fallback={
                                    revealed()
                                      ? 'Aufgedeckt — vergleiche deine Zeichnung direkt mit der Lösung:'
                                      : 'Zeichne deine Antwort direkt in die verdeckte Stelle:'
                                  }
                                >
                                  {revealed()
                                    ? 'Beidseitiges Paar aufgedeckt — direkt vergleichen:'
                                    : 'Zeichne die gesuchte Partner-Stelle (?) direkt im Canvas ein:'}
                                </Show>
                              </span>

                              <div class="fc-occ-toggle-group">
                                <button
                                  type="button"
                                  class="occ-mode-btn"
                                  classList={{ 'is-active': occViewMode() === 'focus' }}
                                  onClick={() => setOccViewMode('focus')}
                                >
                                  Ausschnitt
                                </button>
                                <button
                                  type="button"
                                  class="occ-mode-btn"
                                  classList={{ 'is-active': occViewMode() === 'full' }}
                                  onClick={() => setOccViewMode('full')}
                                >
                                  Ganze Seite
                                </button>
                                <Show when={(pg().occlusions?.length ?? 0) > (card().targetOcclusionIds?.length ?? 0) + (card().promptOcclusionIds?.length ?? 0)}>
                                  <button
                                    type="button"
                                    class="occ-mode-btn"
                                    classList={{ 'is-active': hideOtherOcclusions() }}
                                    onClick={() => setHideOtherOcclusions((v) => !v)}
                                    title="Andere Verdeckungen auf dieser Seite während der Frage ebenfalls verbergen"
                                  >
                                    Andere verbergen
                                  </button>
                                </Show>
                              </div>
                            </div>

                            <OcclusionStudyCanvas
                              page={pg()}
                              theme={props.store.theme()}
                              isInfinite={Boolean(card().isInfiniteCanvas)}
                              targetIds={card().targetOcclusionIds ?? []}
                              promptIds={card().promptOcclusionIds ?? []}
                              revealed={revealed()}
                              hideOtherOcclusions={hideOtherOcclusions()}
                              viewMode={occViewMode()}
                              resetToken={scratchpadResetToken()}
                              stabilization={props.store.settings().stabilization}
                              pressureSensitivity={props.store.settings().pressureSensitivity}
                              defaultStylusOnly={props.store.settings().stylusOnly}
                              autoEnableStylusOnly={props.store.settings().autoEnableStylusOnly}
                              onHasDrawingChange={setOccCanvasHasDrawing}
                            />

                            <Show when={card().hint && !revealed()}>
                              <div class="fc-hint-banner">Hinweis: {card().hint}</div>
                            </Show>
                          </div>
                        )}
                      </Show>

                      {/* 2. Cloze / Stellen verbergen Text Card */}
                      <Show when={card().kind === 'cloze' && card().clozeSegments}>
                        <div class="fc-cloze-card-content">
                          <div class="fc-cloze-sentence">
                            <For each={card().clozeSegments}>
                              {(seg) => {
                                if (seg.type === 'text') {
                                  return (
                                    <span
                                      innerHTML={renderInlineMarkdown(seg.text, attachments())}
                                    />
                                  );
                                }
                                const isTarget = seg.groupKey === card().activeClozeGroup;
                                if (!isTarget) {
                                  return (
                                    <span
                                      class="fc-cloze-other"
                                      innerHTML={renderInlineMarkdown(seg.text, attachments())}
                                    />
                                  );
                                }
                                return (
                                  <Show
                                    when={revealed()}
                                    fallback={
                                      <span class="fc-cloze-blank">
                                        {seg.hint ? `[ ${seg.hint} ]` : '[ … ]'}
                                      </span>
                                    }
                                  >
                                    <span
                                      class="fc-cloze-revealed"
                                      innerHTML={renderInlineMarkdown(seg.text, attachments())}
                                    />
                                  </Show>
                                );
                              }}
                            </For>
                          </div>
                          <Show when={card().hint && !revealed()}>
                            <div class="fc-hint-banner">Hinweis: {card().hint}</div>
                          </Show>
                        </div>
                      </Show>

                      {/* 3. Basic / Bidirectional Q&A Card */}
                      <Show when={card().kind === 'basic'}>
                        <div class="fc-basic-card-content">
                          <div class="fc-basic-section">
                            <div class="fc-side-label">
                              {card().direction === 'reverse' ? 'Rückseite → Vorderseite' : 'Frage'}
                            </div>
                            <div
                              class="fc-basic-text"
                              innerHTML={renderInlineMarkdown(
                                card().frontMarkdown ?? '',
                                attachments()
                              )}
                            />
                            <Show when={card().hint && !revealed()}>
                              <div class="fc-hint-banner">Hinweis: {card().hint}</div>
                            </Show>
                          </div>

                          <Show when={revealed()}>
                            <div class="fc-answer-divider" />
                            <div class="fc-basic-section is-answer">
                              <div class="fc-side-label">Antwort</div>
                              <div
                                class="fc-basic-text is-answer-text"
                                innerHTML={renderInlineMarkdown(
                                  card().backMarkdown ?? '',
                                  attachments()
                                )}
                              />
                            </div>
                          </Show>
                        </div>
                      </Show>
                      </div>

                      {/* Optional Freehand Pen Scratchpad (Draw Answer & Compare!) */}
                      <Show when={showSeparateScratchpad()}>
                        <div class="fc-scratchpad-pane">
                          <Show when={revealed()}>
                            <div class="fc-compare-pane-header is-user-answer">
                              <IconPen size={13} />
                              <span>Deine gezeichnete Antwort</span>
                            </div>
                          </Show>
                          <FlashcardScratchpad
                            resetToken={scratchpadResetToken()}
                            theme={props.store.theme()}
                            stabilization={props.store.settings().stabilization}
                            pressureSensitivity={props.store.settings().pressureSensitivity}
                            defaultStylusOnly={props.store.settings().stylusOnly}
                            autoEnableStylusOnly={props.store.settings().autoEnableStylusOnly}
                            comparing={revealed()}
                            onHasDrawingChange={setScratchpadHasDrawing}
                          />
                        </div>
                      </Show>
                    </div>

                    {/* Bottom Reveal / Rating Bar */}
                    <div class="fc-card-footer">
                      <Show
                        when={revealed()}
                        fallback={
                          <button
                            type="button"
                            class="btn-primary fc-reveal-btn"
                            onClick={() => setRevealed(true)}
                          >
                            <IconEye size={16} />
                            <span>
                              {anyAnswerDrawn()
                                ? 'Antwort zeigen & vergleichen'
                                : 'Antwort zeigen'}
                            </span>
                            <kbd class="fc-kbd">Leertaste</kbd>
                          </button>
                        }
                      >
                        <Show
                          when={studyMode() === 'srs'}
                          fallback={
                            <div class="fc-rating-grid is-practice-grid">
                              <button
                                type="button"
                                class="fc-rate-btn is-again"
                                onClick={() => submitRating('again')}
                              >
                                <span class="fc-rate-title">Nochmal üben</span>
                                <span class="fc-rate-sub">In dieser Sitzung</span>
                              </button>
                              <button
                                type="button"
                                class="fc-rate-btn is-good"
                                onClick={() => submitRating('good')}
                              >
                                <span class="fc-rate-title">Gewusst · Weiter</span>
                                <span class="fc-rate-sub">Nächste Karte</span>
                              </button>
                            </div>
                          }
                        >
                          <div class="fc-rating-grid">
                            <button
                              type="button"
                              class="fc-rate-btn is-again"
                              onClick={() => submitRating('again')}
                            >
                              <span class="fc-rate-title">Nochmal</span>
                              <span class="fc-rate-sub">{ratingPreviews().again}</span>
                              <kbd class="fc-kbd">1</kbd>
                            </button>
                            <button
                              type="button"
                              class="fc-rate-btn is-hard"
                              onClick={() => submitRating('hard')}
                            >
                              <span class="fc-rate-title">Schwer</span>
                              <span class="fc-rate-sub">{ratingPreviews().hard}</span>
                              <kbd class="fc-kbd">2</kbd>
                            </button>
                            <button
                              type="button"
                              class="fc-rate-btn is-good"
                              onClick={() => submitRating('good')}
                            >
                              <span class="fc-rate-title">Gut</span>
                              <span class="fc-rate-sub">{ratingPreviews().good}</span>
                              <kbd class="fc-kbd">3</kbd>
                            </button>
                            <button
                              type="button"
                              class="fc-rate-btn is-easy"
                              onClick={() => submitRating('easy')}
                            >
                              <span class="fc-rate-title">Leicht</span>
                              <span class="fc-rate-sub">{ratingPreviews().easy}</span>
                              <kbd class="fc-kbd">4</kbd>
                            </button>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Show>
          </div>
        }
      >
        {/* Deck Hub & Card Inspector */}
        <div class="flashcards-scroll">
          <div class="flashcards-container">
            {/* Scope & Action Hero */}
            <section class="fc-hero-card">
              <div class="fc-hero-top">
                <div class="fc-scope-picker">
                  <label class="fc-scope-label" for="fc-scope-select">
                    <IconFolder size={14} />
                    <span>Lernbereich</span>
                  </label>
                  <select
                    id="fc-scope-select"
                    class="fc-scope-select"
                    value={scopeSelectValue()}
                    onChange={(e) => handleScopeSelect(e.currentTarget.value)}
                  >
                    <option value="all">
                      Alle Notizen ({props.store.allStudyCards().length} Karten)
                    </option>
                    <Show when={folderOptions().length > 0}>
                      <optgroup label="Ordner">
                        <For each={folderOptions()}>
                          {(opt) => (
                            <option value={`folder:${opt.folder.id}`}>
                              {opt.label}
                            </option>
                          )}
                        </For>
                      </optgroup>
                    </Show>
                    <Show when={props.store.notes().length > 0}>
                      <optgroup label="Einzelne Notiz">
                        <For each={props.store.notes()}>
                          {(n) => {
                            const cnt = () => props.store.getNoteStudyCardCount(n.id);
                            return (
                              <option value={`note:${n.id}`}>
                                {n.title.trim() || 'Unbenannte Notiz'} ({cnt()})
                              </option>
                            );
                          }}
                        </For>
                      </optgroup>
                    </Show>
                  </select>
                </div>

                <div class="fc-hero-actions">
                  <button
                    type="button"
                    class="btn-primary fc-study-btn"
                    disabled={dueCards().length === 0}
                    onClick={() => startSession('srs')}
                  >
                    <IconPlay size={14} />
                    <span>Fällige lernen ({dueCards().length})</span>
                  </button>

                  <button
                    type="button"
                    class="btn-ghost fc-practice-btn"
                    disabled={filteredCards().length === 0}
                    onClick={() => startSession('practice')}
                    title="Alle Karten dieser Auswahl sofort üben (ohne Fälligkeit zu ändern)"
                  >
                    <IconRotateCcw size={14} />
                    <span>Alle üben ({filteredCards().length})</span>
                  </button>
                </div>
              </div>

              {/* Metrics Grid */}
              <div class="fc-metrics-grid">
                <div class="fc-metric-box is-due">
                  <span class="fc-metric-val">{deckStats().due}</span>
                  <span class="fc-metric-lbl">Fällig heute</span>
                </div>
                <div class="fc-metric-box is-new">
                  <span class="fc-metric-val">{deckStats().newCount}</span>
                  <span class="fc-metric-lbl">Neu</span>
                </div>
                <div class="fc-metric-box is-learning">
                  <span class="fc-metric-val">{deckStats().learning}</span>
                  <span class="fc-metric-lbl">In Lernphase</span>
                </div>
                <div class="fc-metric-box is-mastered">
                  <span class="fc-metric-val">{deckStats().mastered}</span>
                  <span class="fc-metric-lbl">Gelernt</span>
                </div>
              </div>
            </section>

            {/* Filter & Search Bar */}
            <div class="fc-toolbar-row">
              <div class="fc-source-pills" role="tablist" aria-label="Kartenquelle filtern">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceFilter() === 'all'}
                  class="fc-filter-pill"
                  classList={{ 'is-active': sourceFilter() === 'all' }}
                  onClick={() => setSourceFilter('all')}
                >
                  Alle ({scopedCards().length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceFilter() === 'canvas'}
                  class="fc-filter-pill"
                  classList={{ 'is-active': sourceFilter() === 'canvas' }}
                  onClick={() => setSourceFilter('canvas')}
                >
                  <IconOcclusion size={13} />
                  <span>Canvas-Stellen</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceFilter() === 'markdown'}
                  class="fc-filter-pill"
                  classList={{ 'is-active': sourceFilter() === 'markdown' }}
                  onClick={() => setSourceFilter('markdown')}
                >
                  <IconFileText size={13} />
                  <span>Text (RemNote)</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceFilter() === 'manual'}
                  class="fc-filter-pill"
                  classList={{ 'is-active': sourceFilter() === 'manual' }}
                  onClick={() => setSourceFilter('manual')}
                >
                  <IconFlashcards size={13} />
                  <span>Manuell</span>
                </button>
              </div>

              <div class="fc-toolbar-right">
                <div class="fc-search-box">
                  <IconSearch size={13} />
                  <input
                    type="text"
                    value={search()}
                    onInput={(e) => setSearch(e.currentTarget.value)}
                    placeholder="Karten durchsuchen…"
                    aria-label="Karteikarten durchsuchen"
                  />
                  <Show when={search().length > 0}>
                    <button
                      type="button"
                      class="search-clear"
                      onClick={() => setSearch('')}
                      aria-label="Suche leeren"
                    >
                      <IconX size={12} />
                    </button>
                  </Show>
                </div>

                <button
                  type="button"
                  class="tool-pill"
                  classList={{ 'is-active': showSyntaxHelp() }}
                  onClick={() => setShowSyntaxHelp((v) => !v)}
                  title="Anleitung: Wie erstellt man Karteikarten?"
                >
                  <span>Anleitung</span>
                </button>

                <Show when={filteredCards().length > 0}>
                  <button
                    type="button"
                    class="tool-pill"
                    onClick={() =>
                      props.store.resetFlashcardProgress(
                        filteredCards().map((c) => c.cardKey)
                      )
                    }
                    title="Lernfortschritt dieser Auswahl zurücksetzen"
                  >
                    <IconRotateCcw size={13} />
                    <span class="hide-compact">Zurücksetzen</span>
                  </button>
                </Show>
              </div>
            </div>

            {/* RemNote & Canvas Flashcard Guide */}
            <Show when={showSyntaxHelp() || scopedCards().length === 0}>
              <section class="fc-guide-card">
                <div class="fc-guide-header">
                  <strong>So funktionieren Karteikarten (wie RemNote)</strong>
                  <Show when={scopedCards().length > 0}>
                    <button
                      type="button"
                      class="icon-btn-xs"
                      onClick={() => setShowSyntaxHelp(false)}
                      aria-label="Anleitung schließen"
                    >
                      <IconX size={14} />
                    </button>
                  </Show>
                </div>
                <div class="fc-guide-grid">
                  <div class="fc-guide-item">
                    <div class="fc-guide-badge is-canvas">
                      <IconOcclusion size={13} />
                      <span>Canvas: Stellen verbergen</span>
                    </div>
                    <p>
                      Wähle im Canvas das <strong>Verdecken-Werkzeug</strong> und ziehe Rahmen
                      über beliebige Stellen (Handschrift, PDF, Bilder). Tippe auf{' '}
                      <strong>Beidseitig ↔</strong>, um ein verknüpftes <strong>A ↔ B</strong>-Paar
                      (2 Richtungen) anzulegen, oder nutze <strong>Abdecken</strong> für den
                      Sofort-Selbsttest direkt auf dem Blatt.
                    </p>
                  </div>
                  <div class="fc-guide-item">
                    <div class="fc-guide-badge is-cloze">
                      <span>{'{{Lückentext}}'}</span>
                    </div>
                    <p>
                      Schreibe im Text-Editor <code>{'{{Mitochondrien}}'}</code> zum Verbergen
                      einzelner Wörter, <code>{'{{Antwort::Hinweis}}'}</code> mit Hinweis oder{' '}
                      <code>{'{{1::Teil A}} … {{1::Teil B}}'}</code> zum gemeinsamen Abfragen.
                    </p>
                  </div>
                  <div class="fc-guide-item">
                    <div class="fc-guide-badge is-bi">
                      <IconBidirectional size={13} />
                      <span>Ein- & Beidseitige Karten</span>
                    </div>
                    <p>
                      <code>Frage &gt;&gt; Antwort</code> erzeugt eine einseitige Karteikarte.{' '}
                      <code>Begriff &lt;&gt; Definition</code> oder{' '}
                      <code>Begriff :: Definition</code> erzeugt automatisch eine{' '}
                      <strong>beidseitige Karteikarte</strong> (vorwärts &amp; rückwärts).
                    </p>
                  </div>
                </div>
              </section>
            </Show>

            {/* Card List */}
            <Show
              when={filteredCards().length > 0}
              fallback={
                <div class="fc-empty-state">
                  <IconFlashcards size={30} />
                  <h3>Noch keine Karteikarten in dieser Auswahl</h3>
                  <p>
                    Erstelle eine neue Karteikarte, markiere Stellen auf einer Canvas-Seite mit dem
                    Verdecken-Werkzeug oder schreibe <code>{'{{Lücken}}'}</code> /{' '}
                    <code>Begriff &lt;&gt; Definition</code> in deine Textnotizen.
                  </p>
                  <Show when={props.store.notes().length > 0}>
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={openCreateCardModal}
                    >
                      <IconPlus size={14} />
                      <span>Erste Karteikarte erstellen</span>
                    </button>
                  </Show>
                </div>
              }
            >
              <div class="fc-card-list">
                <For each={filteredCards()}>
                  {(card) => {
                    const badge = () => formatCardBadge(card);
                    const status = () => formatStatusLabel(card.cardKey);
                    const isSuspended = () =>
                      Boolean(props.store.flashcardProgress()[card.cardKey]?.suspended);

                    return (
                      <article
                        class="fc-list-item"
                        classList={{ 'is-suspended': isSuspended() }}
                      >
                        <div class="fc-list-main">
                          <div class="fc-list-badges">
                            <span class={`fc-type-badge ${badge().cls}`}>
                              {badge().label}
                            </span>
                            <span class={`fc-status-pill ${status().cls}`}>
                              {status().label}
                            </span>
                            <button
                              type="button"
                              class="fc-list-source-link"
                              onClick={() =>
                                props.store.openNoteAtPage(card.noteId, card.pageId)
                              }
                              title="Zur Notiz springen"
                            >
                              {card.noteTitle}
                              <Show when={card.contextLabel}>
                                {' '}· {card.contextLabel}
                              </Show>
                            </button>
                          </div>

                          <div class="fc-list-front">{card.previewTitle}</div>
                          <div class="fc-list-back">
                            <span class="fc-list-arrow">↳</span>
                            <span>{card.previewAnswer}</span>
                          </div>
                        </div>

                        <div class="fc-list-actions">
                          <button
                            type="button"
                            class="icon-btn-xs"
                            onClick={() =>
                              props.store.toggleFlashcardSuspended(card.cardKey)
                            }
                            title={
                              isSuspended()
                                ? 'Karte wieder aktivieren'
                                : 'Karte vorübergehend aussetzen'
                            }
                          >
                            <Show when={isSuspended()} fallback={<IconEyeOff size={13} />}>
                              <IconEye size={13} />
                            </Show>
                          </button>

                          <Show when={card.source === 'manual' && card.manualCardId}>
                            <button
                              type="button"
                              class="icon-btn-xs"
                              onClick={() =>
                                openEditManualCardModal(card.noteId, card.manualCardId!)
                              }
                              title="Karteikarte bearbeiten"
                            >
                              <IconEdit size={13} />
                            </button>
                            <button
                              type="button"
                              class="icon-btn-xs is-danger"
                              onClick={() =>
                                props.store.deleteManualFlashcard(
                                  card.noteId,
                                  card.manualCardId!
                                )
                              }
                              title="Karteikarte löschen"
                            >
                              <IconTrash size={13} />
                            </button>
                          </Show>

                          <button
                            type="button"
                            class="icon-btn-xs"
                            onClick={() =>
                              props.store.resetFlashcardProgress([card.cardKey])
                            }
                            title="Lernfortschritt dieser Karte zurücksetzen"
                          >
                            <IconRotateCcw size={13} />
                          </button>
                        </div>
                      </article>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Create / Edit Manual Flashcard Modal */}
      <Show when={editorOpen()}>
        <Portal>
          <div
            class="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditorOpen(false);
            }}
          >
            <div
              class="fc-modal-card"
              role="dialog"
              aria-modal="true"
              aria-label={
                editingCardId() ? 'Karteikarte bearbeiten' : 'Neue Karteikarte erstellen'
              }
            >
              <div class="fc-modal-header">
                <h2>
                  <IconFlashcards size={17} />
                  <span>
                    {editingCardId()
                      ? 'Karteikarte bearbeiten'
                      : 'Neue Karteikarte erstellen'}
                  </span>
                </h2>
                <button
                  type="button"
                  class="icon-btn-xs"
                  onClick={() => setEditorOpen(false)}
                  aria-label="Schließen"
                >
                  <IconX size={16} />
                </button>
              </div>

              <div class="fc-modal-body">
                {/* Target Note */}
                <label class="fc-field">
                  <span class="fc-field-label">Zugehörige Notiz</span>
                  <select
                    class="fc-select"
                    value={editorNoteId()}
                    disabled={Boolean(editingCardId())}
                    onChange={(e) => setEditorNoteId(e.currentTarget.value)}
                  >
                    <For each={props.store.notes()}>
                      {(n) => (
                        <option value={n.id}>
                          {n.title.trim() || 'Unbenannte Notiz'}
                        </option>
                      )}
                    </For>
                  </select>
                </label>

                {/* Card Kind Switch */}
                <div class="fc-field">
                  <span class="fc-field-label">Kartentyp</span>
                  <div class="fc-kind-switch">
                    <button
                      type="button"
                      class="fc-kind-btn"
                      classList={{ 'is-active': editorKind() === 'basic' }}
                      onClick={() => setEditorKind('basic')}
                    >
                      <IconBidirectional size={14} />
                      <span>Vorder- &amp; Rückseite</span>
                    </button>
                    <button
                      type="button"
                      class="fc-kind-btn"
                      classList={{ 'is-active': editorKind() === 'cloze' }}
                      onClick={() => setEditorKind('cloze')}
                    >
                      <IconOcclusion size={14} />
                      <span>Stellen verbergen (Lückentext)</span>
                    </button>
                  </div>
                </div>

                <Show
                  when={editorKind() === 'basic'}
                  fallback={
                    <div class="fc-field">
                      <div class="fc-field-head-row">
                        <span class="fc-field-label">
                          Text mit verborgenen Stellen ({'{{…}}'})
                        </span>
                        <div class="fc-cloze-helpers">
                          <button
                            type="button"
                            class="mini-reset-btn"
                            onClick={() => wrapClozeSelection()}
                          >
                            + {'{{Stelle verbergen}}'}
                          </button>
                          <button
                            type="button"
                            class="mini-reset-btn"
                            onClick={() => wrapClozeSelection('1')}
                            title="Mehrere Stellen derselben Gruppe (1) werden zusammen verborgen"
                          >
                            + {'{{1::Gruppe}}'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        ref={clozeTextareaRef}
                        class="fc-textarea"
                        rows={4}
                        value={editorFront()}
                        onInput={(e) => setEditorFront(e.currentTarget.value)}
                        placeholder="z. B. Die {{Mitochondrien}} erzeugen {{ATP::Energieträger}} durch Zellatmung."
                      />
                      <div class="fc-field-hint">
                        {clozeEditorCount() > 0
                          ? `Erzeugt ${clozeEditorCount()} ${
                              clozeEditorCount() === 1 ? 'Karteikarte' : 'Karteikarten'
                            } aus den markierten Stellen.`
                          : 'Markiere ein Wort und klicke auf „+ {{Stelle verbergen}}“, um mindestens eine Lücke festzulegen.'}
                      </div>
                    </div>
                  }
                >
                  <label class="fc-field">
                    <span class="fc-field-label">Vorderseite (Frage / Begriff)</span>
                    <textarea
                      class="fc-textarea"
                      rows={3}
                      value={editorFront()}
                      onInput={(e) => setEditorFront(e.currentTarget.value)}
                      placeholder="z. B. Photosynthese (Markdown wird unterstützt)"
                    />
                  </label>

                  <label class="fc-field">
                    <span class="fc-field-label">Rückseite (Antwort / Definition)</span>
                    <textarea
                      class="fc-textarea"
                      rows={3}
                      value={editorBack()}
                      onInput={(e) => setEditorBack(e.currentTarget.value)}
                      placeholder="z. B. Umwandlung von Lichtenergie in chemische Energie (Glukose)"
                    />
                  </label>

                  {/* Bidirectional Toggle (RemNote style!) */}
                  <label class="fc-bi-toggle-row">
                    <input
                      type="checkbox"
                      checked={editorBidirectional()}
                      onChange={(e) => setEditorBidirectional(e.currentTarget.checked)}
                    />
                    <div class="fc-bi-toggle-text">
                      <strong>
                        <IconBidirectional size={13} /> Beidseitige Karteikarte (wie RemNote)
                      </strong>
                      <span>
                        {editorBidirectional()
                          ? 'Erzeugt 2 Karten: Vorderseite → Rückseite UND Rückseite → Vorderseite'
                          : 'Erzeugt 1 einseitige Karte: nur Vorderseite → Rückseite'}
                      </span>
                    </div>
                  </label>
                </Show>

                <label class="fc-field">
                  <span class="fc-field-label">Optionaler Hinweis</span>
                  <input
                    type="text"
                    class="fc-input"
                    value={editorHint()}
                    onInput={(e) => setEditorHint(e.currentTarget.value)}
                    placeholder="z. B. Eselsbrücke oder Kategorie…"
                  />
                </label>
              </div>

              <div class="fc-modal-footer">
                <button
                  type="button"
                  class="btn-ghost"
                  onClick={() => setEditorOpen(false)}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  class="btn-primary"
                  disabled={!canSaveEditor()}
                  onClick={handleSaveManualCard}
                >
                  <IconCheck size={14} />
                  <span>{editingCardId() ? 'Speichern' : 'Karte erstellen'}</span>
                </button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
