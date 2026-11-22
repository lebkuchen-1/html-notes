import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { IconCheck, IconX } from './Icons';

export type ColorPickerPalettePreset = 'ink' | 'highlighter' | 'paper';

const PALETTE_PRESETS: Record<ColorPickerPalettePreset, string[]> = {
  ink: [
    '#0f172a',
    '#475569',
    '#dc2626',
    '#ea580c',
    '#d97706',
    '#16a34a',
    '#0d9488',
    '#0284c7',
    '#2563eb',
    '#4f46e5',
    '#7c3aed',
    '#c026d3',
    '#db2777',
    '#78350f',
    '#ffffff',
    '#94a3b8',
  ],
  highlighter: [
    '#fde047',
    '#fef08a',
    '#bef264',
    '#86efac',
    '#6ee7b7',
    '#67e8f9',
    '#7dd3fc',
    '#93c5fd',
    '#c4b5fd',
    '#e9d5ff',
    '#f9a8d4',
    '#fda4af',
    '#fdba74',
    '#fcd34d',
    '#cbd5e1',
    '#ffffff',
  ],
  paper: [
    '#ffffff',
    '#fcf9f2',
    '#fef9db',
    '#f5f5f4',
    '#f0fdf4',
    '#eff6ff',
    '#fdf2f8',
    '#f5f3ff',
    '#1e293b',
    '#163a6b',
    '#18181b',
    '#0f172a',
    '#14532d',
    '#3b0764',
    '#451a03',
    '#000000',
  ],
};

const RECENT_COLORS_KEY = 'solid-notes:recent-colors';
const MAX_RECENT_COLORS = 7;

function loadRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => (typeof c === 'string' ? parseHexColor(c) : null))
      .filter((c): c is string => Boolean(c))
      .slice(0, MAX_RECENT_COLORS);
  } catch {
    return [];
  }
}

const [recentColors, setRecentColors] = createSignal<string[]>(
  typeof window !== 'undefined' ? loadRecentColors() : []
);

function recordRecentColor(hex: string) {
  const normalized = parseHexColor(hex);
  if (!normalized) return;
  setRecentColors((prev) => {
    const next = [normalized, ...prev.filter((c) => c !== normalized)].slice(
      0,
      MAX_RECENT_COLORS
    );
    try {
      localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
    return next;
  });
}

export function parseHexColor(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const expanded = trimmed
      .split('')
      .map((ch) => ch + ch)
      .join('');
    return `#${expanded.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }
  return null;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const clean = parseHexColor(hex) ?? '#4f46e5';
  const r = parseInt(clean.slice(1, 3), 16) / 255;
  const g = parseInt(clean.slice(3, 5), 16) / 255;
  const b = parseInt(clean.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const val = Math.max(0, Math.min(1, v));

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

interface ColorPickerPopoverProps {
  /** Current resolved hex color (e.g. "#4f46e5") */
  value: string;
  /** Called immediately whenever the user picks or drags a color */
  onChange?: (hex: string) => void;
  /** Called once when the user finishes picking a color (swatch tap, drag release, hex commit) */
  onCommit?: (hex: string) => void;
  /** Title shown in popover header & button tooltip */
  title?: string;
  /** Highlights the rainbow trigger & displays inner preview dot */
  isCustomActive?: boolean;
  /** Compact trigger size (20px) */
  size?: 'md' | 'sm';
  /** Render a pill-style hex button instead of the rainbow dot (e.g. Papierfarbe) */
  variant?: 'rainbow' | 'pill';
  /** Curated swatch preset */
  palette?: ColorPickerPalettePreset;
  /** Optional callback when popover opens (e.g. to close sibling menus) */
  onOpen?: () => void;
}

export function ColorPickerPopover(props: ColorPickerPopoverProps) {
  const [open, setOpen] = createSignal(false);
  const [editingHex, setEditingHex] = createSignal(false);
  const [pos, setPos] = createSignal<{ top: number; left: number }>({ top: 64, left: 16 });
  const [hsv, setHsv] = createSignal<{ h: number; s: number; v: number }>(
    hexToHsv(props.value)
  );
  const [hexDraft, setHexDraft] = createSignal<string>(
    (parseHexColor(props.value) ?? '#4f46e5').toUpperCase()
  );

  let triggerRef: HTMLButtonElement | undefined;
  let popoverRef: HTMLDivElement | undefined;
  let svAreaRef: HTMLDivElement | undefined;
  let hueBarRef: HTMLDivElement | undefined;
  let hexFieldRef: HTMLLabelElement | undefined;
  let hexInputRef: HTMLInputElement | undefined;
  let draggingSvPointerId: number | null = null;
  let draggingHuePointerId: number | null = null;
  let pickedAnyDuringOpen = false;

  const currentHex = createMemo(() => parseHexColor(props.value) ?? '#4f46e5');
  const swatches = createMemo(() => PALETTE_PRESETS[props.palette ?? 'ink']);

  // Keep HSV & hex input in sync when external value changes while not actively dragging
  createEffect(() => {
    const extHex = currentHex();
    if (draggingSvPointerId !== null || draggingHuePointerId !== null) return;
    const prevHex = hsvToHex(hsv().h, hsv().s, hsv().v);
    if (prevHex !== extHex) {
      const next = hexToHsv(extHex);
      // Preserve hue when selecting pure white/black/gray so the hue slider doesn't jump to red
      setHsv((old) => (next.s < 0.001 ? { h: old.h, s: next.s, v: next.v } : next));
    }
    setHexDraft(extHex.toUpperCase());
  });

  const updatePopoverPosition = () => {
    if (!triggerRef) return;
    const rect = triggerRef.getBoundingClientRect();
    const popW = 264;
    const popH = 342;
    const margin = 10;

    let left = rect.left + rect.width / 2 - popW / 2;
    left = Math.max(margin, Math.min(window.innerWidth - popW - margin, left));

    let top = rect.bottom + 8;
    if (top + popH > window.innerHeight - margin) {
      const aboveTop = rect.top - popH - 8;
      top =
        aboveTop >= margin
          ? aboveTop
          : Math.max(margin, window.innerHeight - popH - margin);
    }

    setPos({ top: Math.round(top), left: Math.round(left) });
  };

  const closePopover = () => {
    if (!open()) return;
    if (pickedAnyDuringOpen) {
      recordRecentColor(liveHex());
      pickedAnyDuringOpen = false;
    }
    draggingSvPointerId = null;
    draggingHuePointerId = null;
    setEditingHex(false);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (open()) {
      closePopover();
    } else {
      props.onOpen?.();
      const nextHsv = hexToHsv(currentHex());
      setHsv((old) => (nextHsv.s < 0.001 ? { h: old.h, s: nextHsv.s, v: nextHsv.v } : nextHsv));
      setHexDraft(currentHex().toUpperCase());
      setEditingHex(false);
      pickedAnyDuringOpen = false;
      updatePopoverPosition();
      setOpen(true);
    }
  };

  createEffect(() => {
    if (!open()) return;
    updatePopoverPosition();

    const handleDocPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (editingHex() && (!target || !hexFieldRef?.contains(target))) {
        const parsed = parseHexColor(hexDraft());
        if (parsed) {
          applyHexDirect(parsed);
        } else {
          setHexDraft(liveHex().toUpperCase());
        }
        hexInputRef?.blur();
        setEditingHex(false);
      }
      if (
        (triggerRef && target && triggerRef.contains(target)) ||
        (popoverRef && target && popoverRef.contains(target))
      ) {
        return;
      }
      closePopover();
    };

    const handleCaptureTouchStart = (e: TouchEvent) => {
      const target = e.target as Node | null;
      if (editingHex() && (!target || !hexFieldRef?.contains(target))) {
        const parsed = parseHexColor(hexDraft());
        if (parsed) {
          applyHexDirect(parsed);
        } else {
          setHexDraft(liveHex().toUpperCase());
        }
        hexInputRef?.blur();
        setEditingHex(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePopover();
      }
    };

    const handleReposition = () => updatePopoverPosition();

    document.addEventListener('pointerdown', handleDocPointerDown, { capture: true });
    document.addEventListener('touchstart', handleCaptureTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    onCleanup(() => {
      document.removeEventListener('pointerdown', handleDocPointerDown, { capture: true });
      document.removeEventListener('touchstart', handleCaptureTouchStart, {
        capture: true,
      });
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    });
  });

  const emitHsv = (h: number, s: number, v: number) => {
    const clampedH = ((h % 360) + 360) % 360;
    const clampedS = Math.max(0, Math.min(1, s));
    const clampedV = Math.max(0, Math.min(1, v));
    setHsv({ h: clampedH, s: clampedS, v: clampedV });
    const hex = hsvToHex(clampedH, clampedS, clampedV);
    setHexDraft(hex.toUpperCase());
    pickedAnyDuringOpen = true;
    props.onChange?.(hex);
  };

  const applyHexDirect = (hex: string, closeAfter = false) => {
    const normalized = parseHexColor(hex);
    if (!normalized) return;
    const next = hexToHsv(normalized);
    setHsv((old) => (next.s < 0.001 ? { h: old.h, s: next.s, v: next.v } : next));
    setHexDraft(normalized.toUpperCase());
    pickedAnyDuringOpen = true;
    props.onChange?.(normalized);
    props.onCommit?.(normalized);
    recordRecentColor(normalized);
    if (closeAfter) {
      pickedAnyDuringOpen = false;
      setOpen(false);
    }
  };

  const updateSvFromClient = (clientX: number, clientY: number) => {
    if (!svAreaRef) return;
    const rect = svAreaRef.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    emitHsv(hsv().h, s, v);
  };

  const updateHueFromClient = (clientX: number) => {
    if (!hueBarRef) return;
    const rect = hueBarRef.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Avoid snapping exactly to 360 -> 0 visually at the far right edge
    const nextH = ratio * 359.5;
    const curr = hsv();
    // If user starts from dark/neutral ink (like default #1e293b or #f1f5f9) and drags the
    // rainbow hue bar, lift saturation/brightness so they immediately get a vivid color!
    const nextS = curr.s < 0.15 ? 0.82 : curr.s;
    const nextV = curr.v < 0.35 ? 0.85 : curr.v;
    emitHsv(nextH, nextS, nextV);
  };

  const liveHex = createMemo(() => hsvToHex(hsv().h, hsv().s, hsv().v));
  const pureHueCss = createMemo(() => `hsl(${Math.round(hsv().h)}, 100%, 50%)`);

  return (
    <>
      <Show
        when={props.variant === 'pill'}
        fallback={
          <button
            ref={triggerRef}
            type="button"
            class="color-picker-wrap"
            classList={{
              'is-sm': props.size === 'sm',
              'is-active': Boolean(props.isCustomActive) || open(),
              'has-custom-dot': Boolean(props.isCustomActive),
            }}
            onClick={toggleOpen}
            title={props.title ?? 'Eigene Farbe wählen'}
            aria-label={props.title ?? 'Eigene Farbe wählen'}
            aria-expanded={open()}
            aria-haspopup="dialog"
          >
            <Show when={props.isCustomActive}>
              <span
                class="color-picker-center-dot"
                style={{ background: currentHex() }}
              />
            </Show>
          </button>
        }
      >
        <button
          ref={triggerRef}
          type="button"
          class="paper-color-input"
          classList={{ 'is-open': open() }}
          onClick={toggleOpen}
          title={props.title ?? 'Beliebige Farbe wählen'}
          aria-label={props.title ?? 'Beliebige Farbe wählen'}
          aria-expanded={open()}
          aria-haspopup="dialog"
        >
          <span
            class="paper-color-preview"
            style={{ background: currentHex() }}
          />
          <span>{currentHex().toUpperCase()}</span>
        </button>
      </Show>

      <Show when={open()}>
        <Portal>
          <div
            ref={popoverRef}
            class="color-popover"
            role="dialog"
            aria-label={props.title ?? 'Farbe wählen'}
            style={{
              top: `${pos().top}px`,
              left: `${pos().left}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div class="cp-header">
              <div class="cp-header-left">
                <span
                  class="cp-preview-dot"
                  style={{ background: liveHex() }}
                />
                <span class="cp-title">{props.title ?? 'Farbe wählen'}</span>
              </div>
              <button
                type="button"
                class="icon-btn-xs"
                onClick={closePopover}
                title="Schließen"
                aria-label="Farbauswahl schließen"
              >
                <IconX size={14} />
              </button>
            </div>

            {/* 2D Saturation / Value Square */}
            <div
              ref={svAreaRef}
              class="cp-sv-area"
              style={{ 'background-color': pureHueCss() }}
              onPointerDown={(e) => {
                e.preventDefault();
                draggingSvPointerId = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateSvFromClient(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (draggingSvPointerId !== e.pointerId) return;
                e.preventDefault();
                updateSvFromClient(e.clientX, e.clientY);
              }}
              onPointerUp={(e) => {
                if (draggingSvPointerId !== e.pointerId) return;
                draggingSvPointerId = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                const hex = liveHex();
                props.onCommit?.(hex);
                recordRecentColor(hex);
              }}
              onPointerCancel={() => {
                draggingSvPointerId = null;
              }}
            >
              <div class="cp-sv-white" />
              <div class="cp-sv-black" />
              <div
                class="cp-sv-thumb"
                style={{
                  left: `${hsv().s * 100}%`,
                  top: `${(1 - hsv().v) * 100}%`,
                  background: liveHex(),
                }}
              />
            </div>

            {/* Rainbow Hue Slider */}
            <div
              ref={hueBarRef}
              class="cp-hue-bar"
              onPointerDown={(e) => {
                e.preventDefault();
                draggingHuePointerId = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateHueFromClient(e.clientX);
              }}
              onPointerMove={(e) => {
                if (draggingHuePointerId !== e.pointerId) return;
                e.preventDefault();
                updateHueFromClient(e.clientX);
              }}
              onPointerUp={(e) => {
                if (draggingHuePointerId !== e.pointerId) return;
                draggingHuePointerId = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                const hex = liveHex();
                props.onCommit?.(hex);
                recordRecentColor(hex);
              }}
              onPointerCancel={() => {
                draggingHuePointerId = null;
              }}
            >
              <div
                class="cp-hue-thumb"
                style={{
                  left: `${(hsv().h / 360) * 100}%`,
                  background: pureHueCss(),
                }}
              />
            </div>

            {/* Curated Quick Swatches */}
            <div class="cp-swatches" role="group" aria-label="Farbpalette">
              <For each={swatches()}>
                {(hex) => (
                  <button
                    type="button"
                    class="cp-swatch"
                    classList={{ 'is-active': liveHex() === hex.toLowerCase() }}
                    style={{ '--swatch-color': hex }}
                    onClick={() => applyHexDirect(hex)}
                    title={hex.toUpperCase()}
                    aria-label={`Farbe ${hex.toUpperCase()}`}
                  />
                )}
              </For>
            </div>

            {/* Recently Used Custom Colors */}
            <Show when={recentColors().length > 0}>
              <div class="cp-recent-row">
                <span class="cp-recent-label">Zuletzt</span>
                <div class="cp-recent-dots">
                  <For each={recentColors()}>
                    {(hex) => (
                      <button
                        type="button"
                        class="cp-swatch is-recent"
                        classList={{ 'is-active': liveHex() === hex }}
                        style={{ '--swatch-color': hex }}
                        onClick={() => applyHexDirect(hex)}
                        title={hex.toUpperCase()}
                        aria-label={`Zuletzt genutzte Farbe ${hex.toUpperCase()}`}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Click-to-edit Hex Input + Done Button (prevents iPadOS Scribble hijacking swatches) */}
            <div class="cp-footer">
              <Show
                when={editingHex()}
                fallback={
                  <button
                    type="button"
                    class="cp-hex-field is-display-btn"
                    onClick={() => {
                      setHexDraft(liveHex().toUpperCase());
                      setEditingHex(true);
                    }}
                    title="Hex-Farbcode bearbeiten"
                    aria-label={`Hex-Farbcode ${liveHex().toUpperCase()} bearbeiten`}
                  >
                    <span class="cp-hex-label">HEX</span>
                    <span class="cp-hex-value">{liveHex().toUpperCase()}</span>
                  </button>
                }
              >
                <label
                  ref={hexFieldRef}
                  class="cp-hex-field"
                  title="Hex-Farbcode eingeben"
                >
                  <span class="cp-hex-label">HEX</span>
                  <input
                    ref={(el) => {
                      hexInputRef = el;
                      requestAnimationFrame(() => el.focus());
                    }}
                    type="text"
                    class="cp-hex-input"
                    value={hexDraft()}
                    maxLength={7}
                    spellcheck={false}
                    autocomplete="off"
                    onInput={(e) => {
                      const raw = e.currentTarget.value;
                      setHexDraft(raw);
                      const parsed = parseHexColor(raw);
                      if (parsed) {
                        const next = hexToHsv(parsed);
                        setHsv((old) =>
                          next.s < 0.001 ? { h: old.h, s: next.s, v: next.v } : next
                        );
                        pickedAnyDuringOpen = true;
                        props.onChange?.(parsed);
                      }
                    }}
                    onBlur={() => {
                      const parsed = parseHexColor(hexDraft());
                      if (parsed) {
                        applyHexDirect(parsed);
                      } else {
                        setHexDraft(liveHex().toUpperCase());
                      }
                      setEditingHex(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const parsed = parseHexColor(hexDraft());
                        if (parsed) {
                          applyHexDirect(parsed, true);
                        } else {
                          closePopover();
                        }
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setHexDraft(liveHex().toUpperCase());
                        setEditingHex(false);
                      }
                    }}
                  />
                </label>
              </Show>
              <button
                type="button"
                class="cp-done-btn"
                onClick={closePopover}
                title="Farbe übernehmen"
              >
                <IconCheck size={13} />
                <span>Fertig</span>
              </button>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
