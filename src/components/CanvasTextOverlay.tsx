import { createEffect, createMemo, For, Show } from 'solid-js';
import type {
  CanvasFontFamily,
  CanvasTextItem,
  PaperConfig,
  ThemeMode,
} from '../types';
import {
  getCanvasFontFamilyCss,
  resolveStrokeColor,
} from '../utils/canvasRenderer';
import {
  IconCheck,
  IconMove,
  IconPlus,
  IconScribble,
  IconTrash,
  IconX,
} from './Icons';

const FONT_FAMILIES: { value: CanvasFontFamily; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'hand', label: 'Hand' },
  { value: 'mono', label: 'Mono' },
];

interface CanvasTextOverlayProps {
  item: CanvasTextItem;
  paperConfig: PaperConfig;
  theme: ThemeMode;
  leftPx: number;
  topPx: number;
  scale: number;
  isScribbleMode: boolean;
  onChangeItem: (next: CanvasTextItem) => void;
  onSyncTextStyle: (patch: {
    fontSize?: number;
    fontFamily?: CanvasFontFamily;
    bold?: boolean;
  }) => void;
  onDelete: () => void;
  onCommit: () => void;
  onExitScribble?: () => void;
  onStartNewBlock?: () => void;
  onStartDrag: (e: PointerEvent) => void;
  onMoveDrag: (e: PointerEvent) => void;
  onEndDrag: (e: PointerEvent) => void;
  registerTextarea?: (el: HTMLTextAreaElement | undefined) => void;
}

export function CanvasTextOverlay(props: CanvasTextOverlayProps) {
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

  const boxWidthPx = createMemo(() => {
    if (props.item.maxWidth && props.item.maxWidth > 0) {
      return Math.max(180, Math.round(props.item.maxWidth * props.scale));
    }
    return undefined;
  });

  const blurInput = () => {
    textareaRef?.blur();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleFinish = () => {
    blurInput();
    if (props.isScribbleMode && props.onExitScribble) {
      props.onExitScribble();
    } else {
      props.onCommit();
    }
  };

  const handleDelete = () => {
    blurInput();
    props.onDelete();
  };

  const placeBarInsideTop = () => props.topPx < 46;

  return (
    <div
      class="canvas-text-overlay"
      classList={{
        'is-scribble-overlay': props.isScribbleMode,
        'is-bar-below-top': placeBarInsideTop(),
      }}
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
          <button
            type="button"
            class="ctb-scribble-badge"
            onClick={handleFinish}
            title="Handschrift → Text (Kritzeln) beenden und zum Stift zurückkehren"
          >
            <IconScribble size={12} />
            <span>Kritzeln</span>
            <IconX size={11} />
          </button>
        </Show>

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
          onClick={handleDelete}
          title={props.isScribbleMode ? 'Text löschen & Kritzeln beenden' : 'Text löschen'}
        >
          <IconTrash size={13} />
        </button>

        <button
          type="button"
          class="ctb-btn is-confirm"
          onClick={handleFinish}
          title={
            props.isScribbleMode
              ? 'Übernehmen & Kritzeln beenden (Strg+Enter / Esc)'
              : 'Übernehmen (Strg+Enter)'
          }
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
            handleFinish();
          }
        }}
      />
    </div>
  );
}
