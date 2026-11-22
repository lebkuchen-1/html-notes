import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import type { ContentBounds, InfiniteCamera } from '../utils/canvasRenderer';
import { formatWorldDimensionsCm, type WorldRect } from '../utils/infiniteExport';
import {
  IconCheck,
  IconCrop,
  IconMaximize,
  IconMonitor,
  IconMove,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from './Icons';

interface InfiniteExportRegionOverlayProps {
  camera: InfiniteCamera;
  viewportWidth: number;
  viewportHeight: number;
  region: WorldRect | null;
  contentBounds: ContentBounds | null;
  onChangeRegion: (rect: WorldRect) => void;
  onConfirm: (rect: WorldRect) => void;
  onCancel: () => void;
  onZoomBy: (delta: number) => void;
  onFitToContent: () => void;
}

type HandleMode = 'draw' | 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface AspectPreset {
  id: string;
  label: string;
  ratio: number | null; // width / height
}

const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Frei', ratio: null },
  { id: 'a4-p', label: 'A4 Hoch', ratio: 210 / 297 },
  { id: 'a4-l', label: 'A4 Quer', ratio: 297 / 210 },
  { id: '16-9', label: '16:9', ratio: 16 / 9 },
  { id: '1-1', label: '1:1', ratio: 1 },
];

const MIN_WORLD_SIZE = 48;

export function InfiniteExportRegionOverlay(props: InfiniteExportRegionOverlayProps) {
  const [navMode, setNavMode] = createSignal<'frame' | 'pan'>('frame');
  const [aspectId, setAspectId] = createSignal<string>('free');

  let overlayRef: HTMLDivElement | undefined;
  let dragState: {
    mode: HandleMode;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    origRect: WorldRect;
  } | null = null;

  const activeAspectRatio = createMemo<number | null>(
    () => ASPECT_PRESETS.find((p) => p.id === aspectId())?.ratio ?? null
  );

  const makeDefaultViewportRect = (): WorldRect => {
    const cam = props.camera;
    const worldW = props.viewportWidth / cam.zoom;
    const worldH = props.viewportHeight / cam.zoom;
    const insetX = worldW * 0.12;
    const insetY = worldH * 0.14;
    return {
      x: Math.round(cam.x + insetX),
      y: Math.round(cam.y + insetY),
      width: Math.max(MIN_WORLD_SIZE, Math.round(worldW - insetX * 2)),
      height: Math.max(MIN_WORLD_SIZE, Math.round(worldH - insetY * 2)),
    };
  };

  onMount(() => {
    if (!props.region || props.region.width < MIN_WORLD_SIZE || props.region.height < MIN_WORLD_SIZE) {
      props.onChangeRegion(makeDefaultViewportRect());
    }
  });

  const currentRect = createMemo<WorldRect>(() => props.region ?? makeDefaultViewportRect());

  const screenRect = createMemo(() => {
    const r = currentRect();
    const cam = props.camera;
    return {
      left: (r.x - cam.x) * cam.zoom,
      top: (r.y - cam.y) * cam.zoom,
      width: r.width * cam.zoom,
      height: r.height * cam.zoom,
    };
  });

  const clientToWorld = (clientX: number, clientY: number) => {
    const bounds = overlayRef?.getBoundingClientRect();
    const left = bounds?.left ?? 0;
    const top = bounds?.top ?? 0;
    const cam = props.camera;
    return {
      x: cam.x + (clientX - left) / cam.zoom,
      y: cam.y + (clientY - top) / cam.zoom,
    };
  };

  const applyAspectPreset = (preset: AspectPreset) => {
    setAspectId(preset.id);
    if (!preset.ratio) return;
    const r = currentRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // Keep area roughly similar while locking ratio
    const area = Math.max(MIN_WORLD_SIZE * MIN_WORLD_SIZE, r.width * r.height);
    const nextW = Math.max(MIN_WORLD_SIZE, Math.round(Math.sqrt(area * preset.ratio)));
    const nextH = Math.max(MIN_WORLD_SIZE, Math.round(nextW / preset.ratio));
    props.onChangeRegion({
      x: Math.round(cx - nextW / 2),
      y: Math.round(cy - nextH / 2),
      width: nextW,
      height: nextH,
    });
  };

  const snapToViewport = () => {
    const cam = props.camera;
    const worldW = props.viewportWidth / cam.zoom;
    const worldH = props.viewportHeight / cam.zoom;
    const ratio = activeAspectRatio();
    if (!ratio) {
      props.onChangeRegion({
        x: Math.round(cam.x),
        y: Math.round(cam.y),
        width: Math.max(MIN_WORLD_SIZE, Math.round(worldW)),
        height: Math.max(MIN_WORLD_SIZE, Math.round(worldH)),
      });
      return;
    }
    let w = worldW * 0.9;
    let h = w / ratio;
    if (h > worldH * 0.86) {
      h = worldH * 0.86;
      w = h * ratio;
    }
    props.onChangeRegion({
      x: Math.round(cam.x + (worldW - w) / 2),
      y: Math.round(cam.y + (worldH - h) / 2),
      width: Math.max(MIN_WORLD_SIZE, Math.round(w)),
      height: Math.max(MIN_WORLD_SIZE, Math.round(h)),
    });
  };

  const snapToContent = () => {
    const b = props.contentBounds;
    if (!b) return;
    const pad = 48;
    const rawW = Math.max(MIN_WORLD_SIZE, b.maxX - b.minX + pad * 2);
    const rawH = Math.max(MIN_WORLD_SIZE, b.maxY - b.minY + pad * 2);
    const ratio = activeAspectRatio();
    if (!ratio) {
      props.onChangeRegion({
        x: Math.round(b.minX - pad),
        y: Math.round(b.minY - pad),
        width: Math.round(rawW),
        height: Math.round(rawH),
      });
      return;
    }
    let w = rawW;
    let h = w / ratio;
    if (h < rawH) {
      h = rawH;
      w = h * ratio;
    }
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    props.onChangeRegion({
      x: Math.round(cx - w / 2),
      y: Math.round(cy - h / 2),
      width: Math.round(w),
      height: Math.round(h),
    });
  };

  const startDrag = (mode: HandleMode, e: PointerEvent) => {
    if (navMode() === 'pan') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const wPt = clientToWorld(e.clientX, e.clientY);
    dragState = {
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startWorldX: wPt.x,
      startWorldY: wPt.y,
      origRect: { ...currentRect() },
    };
  };

  const moveDrag = (e: PointerEvent) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const cam = props.camera;
    const dx = (e.clientX - dragState.startClientX) / cam.zoom;
    const dy = (e.clientY - dragState.startClientY) / cam.zoom;
    const orig = dragState.origRect;
    const ratio = activeAspectRatio();

    if (dragState.mode === 'move') {
      props.onChangeRegion({
        x: Math.round(orig.x + dx),
        y: Math.round(orig.y + dy),
        width: orig.width,
        height: orig.height,
      });
      return;
    }

    if (dragState.mode === 'draw') {
      const curr = clientToWorld(e.clientX, e.clientY);
      const rawDx = curr.x - dragState.startWorldX;
      const rawDy = curr.y - dragState.startWorldY;
      let w = Math.max(MIN_WORLD_SIZE, Math.abs(rawDx));
      let h = Math.max(MIN_WORLD_SIZE, Math.abs(rawDy));
      if (ratio) {
        if (w / h > ratio) {
          h = Math.max(MIN_WORLD_SIZE, w / ratio);
        } else {
          w = Math.max(MIN_WORLD_SIZE, h * ratio);
        }
      }
      const x = rawDx < 0 ? dragState.startWorldX - w : dragState.startWorldX;
      const y = rawDy < 0 ? dragState.startWorldY - h : dragState.startWorldY;
      props.onChangeRegion({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
      });
      return;
    }

    // Resize from edge or corner handle
    let left = orig.x;
    let top = orig.y;
    let right = orig.x + orig.width;
    let bottom = orig.y + orig.height;
    const m = dragState.mode;

    if (m.includes('w')) left = Math.min(right - MIN_WORLD_SIZE, orig.x + dx);
    if (m.includes('e')) right = Math.max(left + MIN_WORLD_SIZE, orig.x + orig.width + dx);
    if (m.includes('n')) top = Math.min(bottom - MIN_WORLD_SIZE, orig.y + dy);
    if (m.includes('s')) bottom = Math.max(top + MIN_WORLD_SIZE, orig.y + orig.height + dy);

    let width = Math.max(MIN_WORLD_SIZE, right - left);
    let height = Math.max(MIN_WORLD_SIZE, bottom - top);

    if (ratio) {
      if (m === 'n' || m === 's') {
        width = Math.max(MIN_WORLD_SIZE, height * ratio);
        const cx = orig.x + orig.width / 2;
        left = cx - width / 2;
      } else if (m === 'w' || m === 'e') {
        height = Math.max(MIN_WORLD_SIZE, width / ratio);
        const cy = orig.y + orig.height / 2;
        top = cy - height / 2;
      } else {
        // Corner handle: keep opposite corner anchored
        const nextH = Math.max(MIN_WORLD_SIZE, width / ratio);
        height = nextH;
        if (m.includes('n')) {
          top = bottom - height;
        }
        if (m.includes('w')) {
          left = right - width;
        }
      }
    }

    props.onChangeRegion({
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(width),
      height: Math.round(height),
    });
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    dragState = null;
  };

  return (
    <div
      ref={overlayRef}
      class="export-region-overlay"
      classList={{
        'is-pan-mode': navMode() === 'pan',
        'export-region-interactive': navMode() === 'frame',
      }}
      onPointerDown={(e) => {
        if (e.target === overlayRef) {
          startDrag('draw', e);
        }
      }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Visual Crop Frame with outside dim scrim via huge box-shadow */}
      <div
        class="export-region-frame"
        classList={{ 'export-region-interactive': navMode() === 'frame' }}
        style={{
          left: `${screenRect().left}px`,
          top: `${screenRect().top}px`,
          width: `${Math.max(8, screenRect().width)}px`,
          height: `${Math.max(8, screenRect().height)}px`,
        }}
        onPointerDown={(e) => startDrag('move', e)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Rule-of-thirds subtle alignment guides */}
        <div class="erf-grid" aria-hidden="true" />

        {/* Live Dimensions Badge (flips inside frame when near top edge) */}
        <div
          class="erf-dims-badge"
          classList={{ 'is-inside': screenRect().top < 64 }}
        >
          {Math.round(currentRect().width)} × {Math.round(currentRect().height)} px ·{' '}
          {formatWorldDimensionsCm(currentRect().width, currentRect().height)}
        </div>

        {/* 8 Resize Handles (only interactive in frame mode) */}
        <Show when={navMode() === 'frame'}>
          <For each={['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const}>
            {(dir) => (
              <button
                type="button"
                class={`erf-handle is-${dir} export-region-interactive`}
                aria-label={`Rahmen anpassen (${dir})`}
                onPointerDown={(e) => startDrag(dir, e)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            )}
          </For>
        </Show>
      </div>

      {/* Top Instruction Pill */}
      <div class="export-region-top-banner export-region-interactive">
        <IconCrop size={14} />
        <span>
          {navMode() === 'frame'
            ? 'Exportbereich ziehen oder an den Griffen anpassen'
            : 'Canvas verschieben & zoomen — danach wieder „Rahmen“ wählen'}
        </span>
      </div>

      {/* Bottom Floating Control Dock */}
      <div
        class="export-region-dock export-region-interactive"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Frame vs Pan Mode Switch */}
        <div class="erd-group erd-mode-switch" role="group" aria-label="Interaktionsmodus">
          <button
            type="button"
            class="erd-btn"
            classList={{ 'is-active': navMode() === 'frame' }}
            onClick={() => setNavMode('frame')}
            title="Exportrahmen ziehen & skalieren"
          >
            <IconCrop size={14} />
            <span>Rahmen</span>
          </button>
          <button
            type="button"
            class="erd-btn"
            classList={{ 'is-active': navMode() === 'pan' }}
            onClick={() => setNavMode('pan')}
            title="Canvas verschieben & zoomen"
          >
            <IconMove size={14} />
            <span>Canvas schieben</span>
          </button>
        </div>

        {/* Aspect Ratio Presets */}
        <div class="erd-group erd-ratios" role="group" aria-label="Seitenverhältnis">
          <For each={ASPECT_PRESETS}>
            {(preset) => (
              <button
                type="button"
                class="erd-pill"
                classList={{ 'is-active': aspectId() === preset.id }}
                onClick={() => applyAspectPreset(preset)}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>

        {/* Quick Snaps + Zoom */}
        <div class="erd-group erd-snaps">
          <button
            type="button"
            class="erd-pill"
            onClick={snapToViewport}
            title="Rahmen auf aktuellen Bildschirm setzen"
          >
            <IconMonitor size={13} />
            <span>Bildschirm</span>
          </button>
          <button
            type="button"
            class="erd-pill"
            disabled={!props.contentBounds}
            onClick={snapToContent}
            title="Rahmen an gesamten Inhalt anpassen"
          >
            <IconMaximize size={13} />
            <span>Inhalt</span>
          </button>
          <button
            type="button"
            class="erd-icon-btn"
            onClick={() => props.onZoomBy(-0.2)}
            title="Verkleinern"
            aria-label="Verkleinern"
          >
            <IconZoomOut size={14} />
          </button>
          <button
            type="button"
            class="erd-icon-btn"
            onClick={() => props.onZoomBy(0.2)}
            title="Vergrößern"
            aria-label="Vergrößern"
          >
            <IconZoomIn size={14} />
          </button>
          <button
            type="button"
            class="erd-icon-btn"
            onClick={props.onFitToContent}
            title="Alle Inhalte einpassen"
            aria-label="Alle Inhalte einpassen"
          >
            <IconMaximize size={14} />
          </button>
        </div>

        {/* Cancel / Confirm */}
        <div class="erd-actions">
          <button type="button" class="btn-secondary erd-cancel-btn" onClick={props.onCancel}>
            <IconX size={14} />
            <span>Abbrechen</span>
          </button>
          <button
            type="button"
            class="btn-primary erd-confirm-btn"
            onClick={() => props.onConfirm(currentRect())}
          >
            <IconCheck size={14} />
            <span>Bereich übernehmen</span>
          </button>
        </div>
      </div>
    </div>
  );
}
