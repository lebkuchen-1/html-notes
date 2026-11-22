import { createSignal, For, Show } from 'solid-js';
import {
  IconCheck,
  IconCopy,
  IconPalette,
  IconPlus,
  IconScissors,
  IconTrash,
} from './Icons';

export type LassoResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

const LASSO_RECOLOR_SWATCHES = [
  { value: 'auto', label: 'Tinte (Auto)' },
  { value: '#4f46e5', label: 'Indigo' },
  { value: '#2563eb', label: 'Blau' },
  { value: '#dc2626', label: 'Rot' },
  { value: '#059669', label: 'Smaragd' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#9333ea', label: 'Violett' },
];

interface CanvasLassoOverlayProps {
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
  itemCount: number;
  hasColorableItems: boolean;
  paperIsDark: boolean;
  isTransforming: boolean;
  onStartMove: (e: PointerEvent) => void;
  onStartResize: (corner: LassoResizeCorner, e: PointerEvent) => void;
  onMoveTransform: (e: PointerEvent) => void;
  onEndTransform: (e: PointerEvent) => void;
  onRecolor: (color: string) => void;
  onCopy: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}

export function CanvasLassoOverlay(props: CanvasLassoOverlayProps) {
  const [colorPickerOpen, setColorPickerOpen] = createSignal(false);

  const placeBarBelow = () => props.topPx < 54;

  return (
    <div
      class="canvas-lasso-selection"
      classList={{ 'is-transforming': props.isTransforming }}
      style={{
        left: `${props.leftPx}px`,
        top: `${props.topPx}px`,
        width: `${Math.max(24, props.widthPx)}px`,
        height: `${Math.max(24, props.heightPx)}px`,
      }}
      onPointerDown={props.onStartMove}
      onPointerMove={props.onMoveTransform}
      onPointerUp={props.onEndTransform}
      onPointerCancel={props.onEndTransform}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Floating Action Bar (hidden subtly while actively dragging/resizing) */}
      <Show when={!props.isTransforming}>
        <div
          class="canvas-text-bar canvas-lasso-bar"
          classList={{ 'is-below': placeBarBelow() }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span class="clb-count" title="Ausgewählte Elemente — zum Verschieben in den Rahmen ziehen">
            {props.itemCount === 1 ? '1 Element' : `${props.itemCount} Elemente`}
          </span>

          <Show when={props.hasColorableItems}>
            <button
              type="button"
              class="ctb-btn"
              classList={{ 'is-active': colorPickerOpen() }}
              onClick={() => setColorPickerOpen((v) => !v)}
              title="Ausgewählte Striche & Texte umfärben"
              aria-label="Umfärben"
            >
              <IconPalette size={13} />
            </button>
          </Show>

          <button
            type="button"
            class="ctb-btn"
            onClick={() => props.onDuplicate()}
            title="Auswahl duplizieren (Strg+D)"
            aria-label="Duplizieren"
          >
            <IconPlus size={13} />
          </button>

          <button
            type="button"
            class="ctb-btn"
            onClick={() => props.onCopy()}
            title="Auswahl kopieren (Strg+C)"
            aria-label="Kopieren"
          >
            <IconCopy size={13} />
          </button>

          <button
            type="button"
            class="ctb-btn"
            onClick={() => props.onCut()}
            title="Auswahl ausschneiden (Strg+X)"
            aria-label="Ausschneiden"
          >
            <IconScissors size={13} />
          </button>

          <button
            type="button"
            class="ctb-btn is-danger"
            onClick={() => props.onDelete()}
            title="Auswahl löschen (Entf)"
            aria-label="Löschen"
          >
            <IconTrash size={13} />
          </button>

          <button
            type="button"
            class="ctb-btn is-confirm"
            onClick={() => props.onDismiss()}
            title="Auswahl aufheben (Esc)"
            aria-label="Fertig"
          >
            <IconCheck size={13} />
          </button>

          {/* Compact inline recolor palette row */}
          <Show when={props.hasColorableItems && colorPickerOpen()}>
            <div class="lasso-color-popover" role="group" aria-label="Farbe ändern">
              <For each={LASSO_RECOLOR_SWATCHES}>
                {(sw) => {
                  const bg = () =>
                    sw.value === 'auto'
                      ? props.paperIsDark
                        ? '#f1f5f9'
                        : '#1e293b'
                      : sw.value;
                  return (
                    <button
                      type="button"
                      class="lasso-color-dot"
                      style={{ '--swatch-color': bg() }}
                      onClick={() => {
                        props.onRecolor(sw.value);
                        setColorPickerOpen(false);
                      }}
                      title={sw.label}
                      aria-label={`Umfärben: ${sw.label}`}
                    />
                  );
                }}
              </For>
              <label class="color-picker-wrap is-sm" title="Eigene Farbe wählen">
                <input
                  type="color"
                  value={props.paperIsDark ? '#f1f5f9' : '#4f46e5'}
                  onInput={(e) => props.onRecolor(e.currentTarget.value)}
                />
              </label>
            </div>
          </Show>
        </div>
      </Show>

      {/* Proportional Corner Resize Handles */}
      <button
        type="button"
        class="resize-handle is-nw"
        aria-label="Auswahl oben links skalieren"
        onPointerDown={(e) => props.onStartResize('nw', e)}
        onPointerMove={props.onMoveTransform}
        onPointerUp={props.onEndTransform}
        onPointerCancel={props.onEndTransform}
      />
      <button
        type="button"
        class="resize-handle is-ne"
        aria-label="Auswahl oben rechts skalieren"
        onPointerDown={(e) => props.onStartResize('ne', e)}
        onPointerMove={props.onMoveTransform}
        onPointerUp={props.onEndTransform}
        onPointerCancel={props.onEndTransform}
      />
      <button
        type="button"
        class="resize-handle is-sw"
        aria-label="Auswahl unten links skalieren"
        onPointerDown={(e) => props.onStartResize('sw', e)}
        onPointerMove={props.onMoveTransform}
        onPointerUp={props.onEndTransform}
        onPointerCancel={props.onEndTransform}
      />
      <button
        type="button"
        class="resize-handle is-se"
        aria-label="Auswahl unten rechts skalieren"
        onPointerDown={(e) => props.onStartResize('se', e)}
        onPointerMove={props.onMoveTransform}
        onPointerUp={props.onEndTransform}
        onPointerCancel={props.onEndTransform}
      />
    </div>
  );
}
