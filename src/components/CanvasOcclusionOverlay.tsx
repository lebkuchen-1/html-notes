import { createMemo, For, Show } from 'solid-js';
import {
  OCCLUSION_COLORS,
  type CanvasOcclusionItem,
  type CanvasSnapshot,
} from '../types';
import {
  IconBidirectional,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconTrash,
  IconUnlink,
} from './Icons';

export type OcclusionDisplayMode = 'edit' | 'study' | 'hidden';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface OcclusionScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CanvasOcclusionOverlayProps {
  occlusions: CanvasOcclusionItem[];
  displayMode: OcclusionDisplayMode;
  /** True when user can select/move/resize boxes (e.g., tool === 'occlusion' or 'select') */
  interactiveEdit: boolean;
  selectedId: string | null;
  revealedIds: ReadonlySet<string>;
  scale: number;
  toScreenRect: (item: CanvasOcclusionItem) => OcclusionScreenRect;
  pageBounds?: { width: number; height: number };
  onSelect: (id: string | null) => void;
  onToggleReveal: (id: string) => void;
  onCaptureSnapshot: () => CanvasSnapshot | null;
  onUpdateLive: (item: CanvasOcclusionItem) => void;
  onCommitUpdate: (item: CanvasOcclusionItem, prevSnap?: CanvasSnapshot) => void;
  onToggleBidirectional: (id: string) => void;
  onUnlinkPair: (id: string) => void;
  onDelete: (id: string) => void;
}

const MIN_OCCLUSION_LOGICAL = 24;
const GROUP_OPTIONS = ['', 'G1', 'G2', 'G3'] as const;

export function CanvasOcclusionOverlay(props: CanvasOcclusionOverlayProps) {
  let transformState: {
    mode: 'move' | ResizeCorner;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    orig: CanvasOcclusionItem;
    prevSnap: CanvasSnapshot | null;
    changed: boolean;
  } | null = null;

  const isStudyMode = () => props.displayMode === 'study';
  const isEditInteractive = () =>
    props.displayMode === 'edit' && props.interactiveEdit;

  // Compute pair connector segments and sequential badge numbers
  const pairConnections = createMemo(() => {
    const byPair = new Map<string, CanvasOcclusionItem[]>();
    for (const o of props.occlusions) {
      if (!o.pairId) continue;
      let list = byPair.get(o.pairId);
      if (!list) {
        list = [];
        byPair.set(o.pairId, list);
      }
      list.push(o);
    }

    const lines: {
      pairId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      midX: number;
      midY: number;
      color: string;
      bidirectional: boolean;
    }[] = [];

    for (const [pairId, members] of byPair) {
      if (members.length < 2) continue;
      const a = members.find((m) => m.pairRole === 'a') ?? members[0];
      const b = members.find((m) => m.id !== a.id) ?? members[1];
      const ra = props.toScreenRect(a);
      const rb = props.toScreenRect(b);
      const x1 = ra.left + ra.width / 2;
      const y1 = ra.top + ra.height / 2;
      const x2 = rb.left + rb.width / 2;
      const y2 = rb.top + rb.height / 2;
      lines.push({
        pairId,
        x1,
        y1,
        x2,
        y2,
        midX: (x1 + x2) / 2,
        midY: (y1 + y2) / 2,
        color: a.color || OCCLUSION_COLORS[0],
        bidirectional: a.bidirectional ?? b.bidirectional ?? true,
      });
    }
    return lines;
  });

  const badgeById = createMemo(() => {
    const map = new Map<string, string>();
    const pairIndexMap = new Map<string, number>();
    let singleIdx = 0;

    for (const o of props.occlusions) {
      if (o.pairId) {
        let pIdx = pairIndexMap.get(o.pairId);
        if (pIdx === undefined) {
          pIdx = pairIndexMap.size + 1;
          pairIndexMap.set(o.pairId, pIdx);
        }
        const side = o.pairRole === 'b' ? 'B' : 'A';
        const arrow = (o.bidirectional ?? true) ? '↔' : '→';
        map.set(o.id, `${pIdx}${side} ${arrow}`);
      } else if (o.groupId) {
        map.set(o.id, o.groupId);
      } else {
        singleIdx += 1;
        map.set(o.id, `#${singleIdx}`);
      }
    }
    return map;
  });

  const clampItem = (
    x: number,
    y: number,
    width: number,
    height: number
  ): { x: number; y: number; width: number; height: number } => {
    const bounds = props.pageBounds;
    if (!bounds) {
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(MIN_OCCLUSION_LOGICAL, Math.round(width)),
        height: Math.max(MIN_OCCLUSION_LOGICAL, Math.round(height)),
      };
    }
    const w = Math.max(MIN_OCCLUSION_LOGICAL, Math.min(bounds.width, Math.round(width)));
    const h = Math.max(MIN_OCCLUSION_LOGICAL, Math.min(bounds.height, Math.round(height)));
    const cx = Math.max(0, Math.min(bounds.width - w, Math.round(x)));
    const cy = Math.max(0, Math.min(bounds.height - h, Math.round(y)));
    return { x: cx, y: cy, width: w, height: h };
  };

  const startTransform = (
    item: CanvasOcclusionItem,
    mode: 'move' | ResizeCorner,
    e: PointerEvent
  ) => {
    if (!isEditInteractive()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    props.onSelect(item.id);
    const prevSnap = props.onCaptureSnapshot();
    transformState = {
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      orig: { ...item },
      prevSnap,
      changed: false,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const moveTransform = (e: PointerEvent) => {
    const st = transformState;
    if (!st || e.pointerId !== st.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const scale = Math.max(0.2, props.scale);
    const dx = (e.clientX - st.startClientX) / scale;
    const dy = (e.clientY - st.startClientY) / scale;
    if (!st.changed && Math.hypot(dx, dy) < 2) return;
    st.changed = true;

    const orig = st.orig;
    let nextX = orig.x;
    let nextY = orig.y;
    let nextW = orig.width;
    let nextH = orig.height;

    if (st.mode === 'move') {
      nextX = orig.x + dx;
      nextY = orig.y + dy;
    } else {
      if (st.mode === 'nw' || st.mode === 'sw') {
        const clampedDx = Math.min(dx, orig.width - MIN_OCCLUSION_LOGICAL);
        nextX = orig.x + clampedDx;
        nextW = orig.width - clampedDx;
      } else {
        nextW = Math.max(MIN_OCCLUSION_LOGICAL, orig.width + dx);
      }
      if (st.mode === 'nw' || st.mode === 'ne') {
        const clampedDy = Math.min(dy, orig.height - MIN_OCCLUSION_LOGICAL);
        nextY = orig.y + clampedDy;
        nextH = orig.height - clampedDy;
      } else {
        nextH = Math.max(MIN_OCCLUSION_LOGICAL, orig.height + dy);
      }
    }

    const clamped = clampItem(nextX, nextY, nextW, nextH);
    props.onUpdateLive({
      ...orig,
      ...clamped,
    });
  };

  const endTransform = (e: PointerEvent) => {
    const st = transformState;
    if (!st || e.pointerId !== st.pointerId) return;
    transformState = null;

    try {
      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    if (st.changed) {
      const latest = props.occlusions.find((o) => o.id === st.orig.id);
      if (latest) {
        props.onCommitUpdate(latest, st.prevSnap ?? undefined);
      }
    }
  };

  return (
    <Show when={props.displayMode !== 'hidden' && props.occlusions.length > 0}>
      <div
        class="canvas-occlusion-overlay"
        classList={{
          'is-study-mode': isStudyMode(),
          'is-edit-interactive': isEditInteractive(),
        }}
      >
        {/* Dashed connector lines between paired A <-> B spots */}
        <Show when={!isStudyMode() && pairConnections().length > 0}>
          <svg class="canvas-occlusion-connectors" aria-hidden="true">
            <For each={pairConnections()}>
              {(conn) => (
                <g>
                  <line
                    x1={conn.x1}
                    y1={conn.y1}
                    x2={conn.x2}
                    y2={conn.y2}
                    stroke={conn.color}
                    stroke-width="2"
                    stroke-dasharray="6 4"
                    stroke-opacity="0.72"
                  />
                  <rect
                    x={conn.midX - 13}
                    y={conn.midY - 10}
                    width="26"
                    height="20"
                    rx="10"
                    fill={conn.color}
                  />
                  <text
                    x={conn.midX}
                    y={conn.midY + 4}
                    text-anchor="middle"
                    fill="#ffffff"
                    font-size="11"
                    font-weight="700"
                  >
                    {conn.bidirectional ? '↔' : '→'}
                  </text>
                </g>
              )}
            </For>
          </svg>
        </Show>

        <For each={props.occlusions}>
          {(occ) => {
            const rect = () => props.toScreenRect(occ);
            const isSelected = () =>
              isEditInteractive() && props.selectedId === occ.id;
            const isRevealed = () => isStudyMode() && props.revealedIds.has(occ.id);
            const badge = () => badgeById().get(occ.id) ?? '#';
            const placeBarBelow = () => rect().top < 64;

            return (
              <div
                class="canvas-occlusion-box"
                classList={{
                  'is-selected': isSelected(),
                  'is-study': isStudyMode(),
                  'is-revealed': isRevealed(),
                  'is-interactive': isEditInteractive() || isStudyMode(),
                  'is-paired': Boolean(occ.pairId),
                }}
                style={{
                  left: `${rect().left}px`,
                  top: `${rect().top}px`,
                  width: `${rect().width}px`,
                  height: `${rect().height}px`,
                  '--occ-color': occ.color || OCCLUSION_COLORS[0],
                }}
                onPointerDown={(e) => {
                  if (isStudyMode()) {
                    e.stopPropagation();
                    return;
                  }
                  if (isEditInteractive()) {
                    startTransform(occ, 'move', e);
                  }
                }}
                onPointerMove={(e) => {
                  if (isEditInteractive()) moveTransform(e);
                }}
                onPointerUp={(e) => {
                  if (isEditInteractive()) endTransform(e);
                }}
                onPointerCancel={(e) => {
                  if (isEditInteractive()) endTransform(e);
                }}
                onClick={(e) => {
                  if (isStudyMode()) {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onToggleReveal(occ.id);
                  } else if (isEditInteractive()) {
                    e.stopPropagation();
                  }
                }}
                title={
                  isStudyMode()
                    ? isRevealed()
                      ? 'Tippen zum Wieder-Verdecken'
                      : occ.label
                        ? `Hinweis: ${occ.label} — Tippen zum Aufdecken`
                        : 'Tippen zum Aufdecken'
                    : isEditInteractive()
                      ? 'Ziehen zum Verschieben · Tippen für Optionen'
                      : undefined
                }
              >
                {/* Study-mode badge / hint */}
                <Show
                  when={isStudyMode()}
                  fallback={
                    <div class="occ-edit-badge">
                      <span>{badge()}</span>
                      <Show when={occ.label}>
                        <span class="occ-edit-label">· {occ.label}</span>
                      </Show>
                    </div>
                  }
                >
                  <Show
                    when={!isRevealed()}
                    fallback={
                      <span class="occ-revealed-pill">
                        <IconEye size={11} />
                      </span>
                    }
                  >
                    <div class="occ-study-center">
                      <span class="occ-study-q">?</span>
                      <Show when={occ.label}>
                        <span class="occ-study-hint">{occ.label}</span>
                      </Show>
                    </div>
                  </Show>
                </Show>

                {/* Selection handles & floating RemNote-style action bar */}
                <Show when={isSelected()}>
                  <div
                    class="canvas-text-bar canvas-occlusion-bar"
                    classList={{ 'is-below': placeBarBelow() }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Bidirectional pair button (A ↔ B) */}
                    <button
                      type="button"
                      class="occ-bar-pill"
                      classList={{
                        'is-active': Boolean(occ.pairId && (occ.bidirectional ?? true)),
                      }}
                      onClick={() => props.onToggleBidirectional(occ.id)}
                      title={
                        occ.pairId
                          ? (occ.bidirectional ?? true)
                            ? 'Beidseitig aktiv (A ↔ B, 2 Karten) — klicken für nur A → B'
                            : 'Einseitig (A → B) — klicken für Beidseitig (A ↔ B)'
                          : 'Beidseitige Karteikarte (A ↔ B): Gegenstück-Stelle erstellen'
                      }
                    >
                      <IconBidirectional size={13} />
                      <span>
                        {occ.pairId
                          ? (occ.bidirectional ?? true)
                            ? 'A ↔ B'
                            : 'A → B'
                          : 'Beidseitig'}
                      </span>
                    </button>

                    <Show when={occ.pairId}>
                      <button
                        type="button"
                        class="ctb-btn"
                        onClick={() => props.onUnlinkPair(occ.id)}
                        title="Paar-Verknüpfung trennen"
                      >
                        <IconUnlink size={13} />
                      </button>
                    </Show>

                    {/* Group selector (only when not paired) */}
                    <Show when={!occ.pairId}>
                      <div class="occ-group-pills" title="Stellen derselben Gruppe werden gemeinsam abgefragt">
                        <For each={GROUP_OPTIONS}>
                          {(grp) => {
                            const active = () => (occ.groupId ?? '') === grp;
                            return (
                              <button
                                type="button"
                                class="occ-grp-btn"
                                classList={{ 'is-active': active() }}
                                onClick={() => {
                                  const next: CanvasOcclusionItem = { ...occ };
                                  if (grp) next.groupId = grp;
                                  else delete next.groupId;
                                  props.onCommitUpdate(next);
                                }}
                                title={
                                  grp
                                    ? `Gruppe ${grp} (zusammen verbergen)`
                                    : 'Einzelne Stelle (eigene Karteikarte)'
                                }
                              >
                                {grp || '1'}
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </Show>

                    {/* Optional hint input */}
                    <input
                      type="text"
                      class="occ-hint-input"
                      value={occ.label ?? ''}
                      placeholder="Hinweis…"
                      aria-label="Hinweis für verdeckte Stelle"
                      onInput={(e) => {
                        const val = e.currentTarget.value;
                        const next: CanvasOcclusionItem = { ...occ };
                        if (val.trim()) next.label = val;
                        else delete next.label;
                        props.onUpdateLive(next);
                      }}
                      onChange={(e) => {
                        const val = e.currentTarget.value.trim();
                        const next: CanvasOcclusionItem = { ...occ };
                        if (val) next.label = val;
                        else delete next.label;
                        props.onCommitUpdate(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === 'Escape') {
                          e.currentTarget.blur();
                        }
                      }}
                    />

                    {/* Mask accent color dots */}
                    <div class="occ-color-dots">
                      <For each={OCCLUSION_COLORS}>
                        {(color) => (
                          <button
                            type="button"
                            class="occ-color-dot"
                            classList={{ 'is-active': occ.color === color }}
                            style={{ background: color }}
                            onClick={() =>
                              props.onCommitUpdate({ ...occ, color })
                            }
                            aria-label={`Maskenfarbe ${color}`}
                          />
                        )}
                      </For>
                    </div>

                    <button
                      type="button"
                      class="ctb-btn is-danger"
                      onClick={() => props.onDelete(occ.id)}
                      title="Verdeckte Stelle löschen (Entf)"
                    >
                      <IconTrash size={13} />
                    </button>

                    <button
                      type="button"
                      class="ctb-btn is-confirm"
                      onClick={() => props.onSelect(null)}
                      title="Fertig"
                    >
                      <IconCheck size={13} />
                    </button>
                  </div>

                  {/* 4 Touch-friendly Resize Handles */}
                  <button
                    type="button"
                    class="resize-handle is-nw"
                    aria-label="Oben links skalieren"
                    onPointerDown={(e) => startTransform(occ, 'nw', e)}
                    onPointerMove={moveTransform}
                    onPointerUp={endTransform}
                    onPointerCancel={endTransform}
                  />
                  <button
                    type="button"
                    class="resize-handle is-ne"
                    aria-label="Oben rechts skalieren"
                    onPointerDown={(e) => startTransform(occ, 'ne', e)}
                    onPointerMove={moveTransform}
                    onPointerUp={endTransform}
                    onPointerCancel={endTransform}
                  />
                  <button
                    type="button"
                    class="resize-handle is-sw"
                    aria-label="Unten links skalieren"
                    onPointerDown={(e) => startTransform(occ, 'sw', e)}
                    onPointerMove={moveTransform}
                    onPointerUp={endTransform}
                    onPointerCancel={endTransform}
                  />
                  <button
                    type="button"
                    class="resize-handle is-se"
                    aria-label="Unten rechts skalieren"
                    onPointerDown={(e) => startTransform(occ, 'se', e)}
                    onPointerMove={moveTransform}
                    onPointerUp={endTransform}
                    onPointerCancel={endTransform}
                  />
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

export { IconEyeOff };
