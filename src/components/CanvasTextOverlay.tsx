import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type {
  CanvasFontFamily,
  CanvasTextItem,
  PaperConfig,
  SpellCheckLanguage,
  ThemeMode,
} from '../types';
import {
  getCanvasFontFamilyCss,
  resolveStrokeColor,
} from '../utils/canvasRenderer';
import {
  addWordToPersonalDictionary,
  applySpellReplacement,
  findSpellIssues,
  getHtmlLangForSpellCheck,
  getSpellCheckRevision,
  getSpellLanguageShortLabel,
  getSpellSuggestions,
  type SpellIssue,
} from '../utils/spellcheck';
import {
  IconCheck,
  IconMove,
  IconPlus,
  IconScribble,
  IconSpellCheck,
  IconTrash,
} from './Icons';

const FONT_FAMILIES: { value: CanvasFontFamily; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'hand', label: 'Hand' },
  { value: 'mono', label: 'Mono' },
];

const LANG_CYCLE: SpellCheckLanguage[] = ['de-en', 'de', 'en'];

interface CanvasTextOverlayProps {
  item: CanvasTextItem;
  paperConfig: PaperConfig;
  theme: ThemeMode;
  leftPx: number;
  topPx: number;
  scale: number;
  isScribbleMode: boolean;
  spellCheckEnabled: boolean;
  spellCheckLanguage: SpellCheckLanguage;
  onChangeItem: (next: CanvasTextItem) => void;
  onSyncTextStyle: (patch: {
    fontSize?: number;
    fontFamily?: CanvasFontFamily;
    bold?: boolean;
  }) => void;
  onChangeSpellLanguage: (lang: SpellCheckLanguage) => void;
  onDelete: () => void;
  onCommit: () => void;
  onStartNewBlock?: () => void;
  onStartDrag: (e: PointerEvent) => void;
  onMoveDrag: (e: PointerEvent) => void;
  onEndDrag: (e: PointerEvent) => void;
  registerTextarea?: (el: HTMLTextAreaElement | undefined) => void;
}

export function CanvasTextOverlay(props: CanvasTextOverlayProps) {
  const [activeIssueIndex, setActiveIssueIndex] = createSignal<number | null>(null);
  let textareaRef: HTMLTextAreaElement | undefined;

  const resolvedColor = createMemo(() =>
    resolveStrokeColor(props.item.color, props.paperConfig, props.theme)
  );

  const lineCount = createMemo(() => Math.max(1, props.item.text.split('\n').length));
  const longestLine = createMemo(() =>
    Math.max(
      14,
      ...props.item.text.split('\n').map((l) => l.length + 2)
    )
  );

  const spellIssues = createMemo<SpellIssue[]>(() => {
    void getSpellCheckRevision();
    if (!props.spellCheckEnabled) return [];
    return findSpellIssues(props.item.text, props.spellCheckLanguage);
  });

  // Reset open suggestion chip if the issue list shrinks or changes
  createEffect(() => {
    const list = spellIssues();
    const idx = activeIssueIndex();
    if (idx !== null && idx >= list.length) {
      setActiveIssueIndex(null);
    }
  });

  const activeIssue = createMemo<SpellIssue | null>(() => {
    const idx = activeIssueIndex();
    if (idx === null) return null;
    return spellIssues()[idx] ?? null;
  });

  const activeSuggestions = createMemo<string[]>(() => {
    void getSpellCheckRevision();
    const issue = activeIssue();
    if (!issue) return [];
    return getSpellSuggestions(issue.word, props.spellCheckLanguage, 6);
  });

  // Keep textarea DOM value & auto-height synced safely without jumping cursor during Scribble
  const syncTextareaHeight = (el: HTMLTextAreaElement | undefined) => {
    if (!el) return;
    el.style.height = 'auto';
    const minH = props.isScribbleMode
      ? Math.max(104, props.item.fontSize * props.scale * 1.35 * 3.6)
      : Math.max(36, props.item.fontSize * props.scale * 1.35 * 1.2);
    el.style.height = `${Math.max(minH, el.scrollHeight + 4)}px`;
  };

  createEffect(() => {
    const nextText = props.item.text;
    const scale = props.scale;
    const fontSize = props.item.fontSize;
    const maxW = props.item.maxWidth;
    void scale;
    void fontSize;
    void maxW;
    if (textareaRef) {
      if (textareaRef.value !== nextText) {
        textareaRef.value = nextText;
      }
      syncTextareaHeight(textareaRef);
    }
  });

  const handleApplySuggestion = (replacement: string) => {
    const issue = activeIssue();
    if (!issue) return;
    const nextText = applySpellReplacement(props.item.text, issue, replacement);
    setActiveIssueIndex(null);
    props.onChangeItem({ ...props.item, text: nextText });
    if (textareaRef) {
      textareaRef.value = nextText;
      syncTextareaHeight(textareaRef);
      textareaRef.focus();
    }
  };

  const handleAddToDict = () => {
    const issue = activeIssue();
    if (!issue) return;
    addWordToPersonalDictionary(issue.word);
    setActiveIssueIndex(null);
  };

  const cycleLanguage = () => {
    const idx = LANG_CYCLE.indexOf(props.spellCheckLanguage);
    const next = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
    props.onChangeSpellLanguage(next);
  };

  const boxWidthPx = createMemo(() => {
    if (props.item.maxWidth && props.item.maxWidth > 0) {
      return Math.max(180, Math.round(props.item.maxWidth * props.scale));
    }
    return undefined;
  });

  return (
    <div
      class="canvas-text-overlay"
      classList={{ 'is-scribble-overlay': props.isScribbleMode }}
      style={{
        left: `${props.leftPx}px`,
        top: `${props.topPx}px`,
        width: boxWidthPx() ? `${boxWidthPx()}px` : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div class="canvas-text-bar">
        <button
          type="button"
          class="ctb-btn ctb-drag"
          onPointerDown={props.onStartDrag}
          onPointerMove={props.onMoveDrag}
          onPointerUp={props.onEndDrag}
          onPointerCancel={props.onEndDrag}
          title="Textfeld verschieben"
        >
          <IconMove size={13} />
        </button>

        <Show when={props.isScribbleMode}>
          <span class="ctb-scribble-badge" title="Apple Pencil Kritzeln direkt in diesem Feld">
            <IconScribble size={12} />
            <span>Kritzeln</span>
          </span>
        </Show>

        <button
          type="button"
          class="ctb-btn ctb-lang-btn"
          classList={{ 'is-active': props.spellCheckEnabled }}
          onClick={cycleLanguage}
          title="Rechtschreib- & Kritzeln-Sprache umschalten (DE+EN / DE / EN)"
        >
          <IconSpellCheck size={12} />
          <span>{getSpellLanguageShortLabel(props.spellCheckLanguage)}</span>
        </button>

        <button
          type="button"
          class="ctb-btn ctb-bold"
          classList={{ 'is-active': props.item.bold }}
          onClick={() => {
            const nextBold = !props.item.bold;
            props.onSyncTextStyle({ bold: nextBold });
            props.onChangeItem({ ...props.item, bold: nextBold });
          }}
          title="Fett"
        >
          B
        </button>

        <select
          class="ctb-select"
          value={props.item.fontFamily}
          onChange={(e) => {
            const nextFamily = e.currentTarget.value as CanvasFontFamily;
            props.onSyncTextStyle({ fontFamily: nextFamily });
            props.onChangeItem({ ...props.item, fontFamily: nextFamily });
          }}
          title="Schriftart"
        >
          <For each={FONT_FAMILIES}>
            {(f) => <option value={f.value}>{f.label}</option>}
          </For>
        </select>

        <button
          type="button"
          class="ctb-btn"
          onClick={() => {
            const nextSize = Math.max(14, props.item.fontSize - 3);
            props.onSyncTextStyle({ fontSize: nextSize });
            props.onChangeItem({ ...props.item, fontSize: nextSize });
          }}
          title="Kleiner"
        >
          A-
        </button>
        <button
          type="button"
          class="ctb-btn"
          onClick={() => {
            const nextSize = Math.min(60, props.item.fontSize + 3);
            props.onSyncTextStyle({ fontSize: nextSize });
            props.onChangeItem({ ...props.item, fontSize: nextSize });
          }}
          title="Größer"
        >
          A+
        </button>

        <Show when={props.isScribbleMode && props.onStartNewBlock}>
          <button
            type="button"
            class="ctb-btn"
            onClick={() => props.onStartNewBlock?.()}
            title="Übernehmen & neues Kritzeln-Feld darunter starten"
          >
            <IconPlus size={13} />
          </button>
        </Show>

        <button
          type="button"
          class="ctb-btn is-danger"
          onClick={props.onDelete}
          title="Text löschen"
        >
          <IconTrash size={13} />
        </button>

        <button
          type="button"
          class="ctb-btn is-confirm"
          onClick={props.onCommit}
          title="Übernehmen (Strg+Enter)"
        >
          <IconCheck size={13} />
        </button>
      </div>

      <textarea
        ref={(el) => {
          textareaRef = el;
          props.registerTextarea?.(el);
          if (el.value !== props.item.text) el.value = props.item.text;
          requestAnimationFrame(() => syncTextareaHeight(el));
        }}
        class="canvas-text-input"
        classList={{ 'is-scribble-input': props.isScribbleMode }}
        rows={props.isScribbleMode ? Math.max(4, lineCount()) : lineCount()}
        cols={boxWidthPx() ? undefined : Math.min(48, longestLine())}
        lang={getHtmlLangForSpellCheck(props.spellCheckLanguage)}
        spellcheck={props.spellCheckEnabled}
        autocorrect="on"
        autocapitalize="sentences"
        autocomplete="off"
        placeholder={
          props.isScribbleMode
            ? 'Mit Apple Pencil direkt hier schreiben (Kritzeln → Text) oder tippen…'
            : 'Text eingeben…'
        }
        style={{
          color: resolvedColor(),
          'font-size': `${props.item.fontSize * props.scale}px`,
          'font-family': getCanvasFontFamilyCss(props.item.fontFamily),
          'font-weight': props.item.bold ? '700' : '400',
          'line-height': '1.35',
          width: boxWidthPx() ? '100%' : undefined,
        }}
        onInput={(e) => {
          const val = e.currentTarget.value;
          props.onChangeItem({ ...props.item, text: val });
          syncTextareaHeight(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Escape' ||
            ((e.ctrlKey || e.metaKey) && e.key === 'Enter')
          ) {
            e.preventDefault();
            props.onCommit();
          }
        }}
      />

      {/* Live DE/EN Spellcheck Suggestions Bar directly below the active writing box */}
      <Show when={props.spellCheckEnabled && spellIssues().length > 0}>
        <div
          class="spell-suggestions-bar"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div class="ssb-words">
            <span class="ssb-label" title="Erkannte Rechtschreibhinweise">
              <IconSpellCheck size={12} />
            </span>
            <For each={spellIssues().slice(0, 8)}>
              {(issue, idx) => (
                <button
                  type="button"
                  class="ssb-word-chip"
                  classList={{ 'is-selected': activeIssueIndex() === idx() }}
                  onClick={() =>
                    setActiveIssueIndex((curr) => (curr === idx() ? null : idx()))
                  }
                  title={`Vorschläge für „${issue.word}“ anzeigen`}
                >
                  {issue.word}
                </button>
              )}
            </For>
            <Show when={spellIssues().length > 8}>
              <span class="ssb-more">+{spellIssues().length - 8}</span>
            </Show>
          </div>

          <Show when={activeIssue()}>
            {(issue) => (
              <div class="ssb-fixes">
                <Show
                  when={activeSuggestions().length > 0}
                  fallback={<span class="ssb-no-fix">Keine Vorschläge</span>}
                >
                  <For each={activeSuggestions()}>
                    {(sug) => (
                      <button
                        type="button"
                        class="ssb-fix-btn"
                        onClick={() => handleApplySuggestion(sug)}
                      >
                        {sug}
                      </button>
                    )}
                  </For>
                </Show>
                <button
                  type="button"
                  class="ssb-dict-btn"
                  onClick={handleAddToDict}
                  title={`„${issue().word}“ dauerhaft zum persönlichen Wörterbuch hinzufügen`}
                >
                  + Wörterbuch
                </button>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
