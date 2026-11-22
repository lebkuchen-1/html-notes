import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  clampRulerCenter,
  formatRulerAngle,
  getRulerDisplayAngle,
  LOGICAL_PX_PER_CM,
  normalizeAngle180,
  RULER_HEIGHT_PX,
  RULER_VISUAL_LENGTH_PX,
  snapRulerAngle,
  type RulerSide,
  type RulerState,
} from '../utils/ruler';
import { IconRotateCw, IconX } from './Icons';

interface CanvasRulerOverlayProps {
  state: RulerState;
  /** CSS pixels per logical canvas pixel (docScale in pages mode, camera.zoom in infinite mode) */
  canvasScale: number;
  containerWidth: number;
  containerHeight: number;
  activeEdge: { side: RulerSide; lengthCm: string } | null;
  paperIsDark: boolean;
  onUpdate: (patch: Partial<RulerState>) => void;
  onClose: () => void;
}

const QUICK_ANGLES = [
  { label: '0°', value: 0 },
  { label: '45°', value: 45 },
  { label: '90°', value: 90 },
  { label: '-45°', value: -45 },
] as const;

export function CanvasRulerOverlay(props: CanvasRulerOverlayProps) {
  const [quickAnglesOpen, setQuickAnglesOpen] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isRotating, setIsRotating] = createSignal(false);
  const [isSnapped, setIsSnapped] = createSignal(false);

  let rulerEl: HTMLDivElement | undefined;
  let bodyEl: HTMLDivElement | undefined;

  // 1-pointer drag state (mouse, finger or stylus on body)
  let dragState: {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origCx: number;
    origCy: number;
  } | null = null;

  // 1-pointer rotation handle state
  let rotateHandleState: {
    pointerId: number;
    centerClientX: number;
    centerClientY: number;
    startPointerAngleRad: number;
    origAngleDeg: number;
  } | null = null;

  // 2-finger native touch drag + rotate state (iPad / touchscreens)
  let twoFingerState: {
    touchIdA: number;
    touchIdB: number;
    startMidX: number;
    startMidY: number;
    startAngleRad: number;
    origCx: number;
    origCy: number;
    origAngleDeg: number;
  } | null = null;

  // Dynamic centimeter / millimeter scale markings that adapt to canvas zoom
  const tickData = createMemo(() => {
    const pxPerCm = LOGICAL_PX_PER_CM * Math.max(0.25, props.canvasScale);
    const halfLen = RULER_VISUAL_LENGTH_PX / 2;
    const maxCm = Math.min(70, Math.ceil(halfLen / pxPerCm));
    const showMm = pxPerCm >= 26;
    const showHalfCm = pxPerCm >= 14;
    const labelStepCm = pxPerCm < 20 ? 2 : 1;

    const majorParts: string[] = [];
    const midParts: string[] = [];
    const minorParts: string[] = [];
    const labels: { x: number; text: string }[] = [];

    const h = RULER_HEIGHT_PX;
    const majorLen = 13;
    const midLen = 8.5;
    const minorLen = 5;

    for (let cm = -maxCm; cm <= maxCm; cm++) {
      const xCm = halfLen + cm * pxPerCm;
      if (xCm >= 0 && xCm <= RULER_VISUAL_LENGTH_PX) {
        const xr = Math.round(xCm * 10) / 10;
        majorParts.push(`M${xr},0v${majorLen}M${xr},${h}v-${majorLen}`);

        // Avoid overlapping the central angle HUD (~60px radius) and rotate handles (~148px ± 22px)
        const distFromCenter = Math.abs(xCm - halfLen);
        const nearRotateHandle = Math.abs(distFromCenter - 148) < 24;
        if (
          cm !== 0 &&
          Math.abs(cm) % labelStepCm === 0 &&
          distFromCenter > 56 &&
          !nearRotateHandle
        ) {
          labels.push({ x: xr, text: String(Math.abs(cm)) });
        }
      }

      if (cm < maxCm) {
        if (showMm) {
          for (let mm = 1; mm <= 9; mm++) {
            const xMm = xCm + (mm / 10) * pxPerCm;
            if (xMm < 0 || xMm > RULER_VISUAL_LENGTH_PX) continue;
            const xr = Math.round(xMm * 10) / 10;
            if (mm === 5) {
              midParts.push(`M${xr},0v${midLen}M${xr},${h}v-${midLen}`);
            } else {
              minorParts.push(`M${xr},0v${minorLen}M${xr},${h}v-${minorLen}`);
            }
          }
        } else if (showHalfCm) {
          const xHalf = xCm + 0.5 * pxPerCm;
          if (xHalf >= 0 && xHalf <= RULER_VISUAL_LENGTH_PX) {
            const xr = Math.round(xHalf * 10) / 10;
            midParts.push(`M${xr},0v${midLen}M${xr},${h}v-${midLen}`);
          }
        }
      }
    }

    return {
      majorPath: majorParts.join(''),
      midPath: midParts.join(''),
      minorPath: minorParts.join(''),
      labels,
    };
  });

  const displayAngle = createMemo(() => getRulerDisplayAngle(props.state.angleDeg));

  const getRulerCenterClient = (): { x: number; y: number } | null => {
    const parent = rulerEl?.parentElement;
    if (!parent) return null;
    const rect = parent.getBoundingClientRect();
    return {
      x: rect.left + props.state.cx,
      y: rect.top + props.state.cy,
    };
  };

  // ==================== 1-POINTER BODY DRAG ====================
  const handleBodyPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (twoFingerState) return;
    const target = e.target as Element | null;
    if (target?.closest('button, .ruler-rotate-handle, .ruler-center-hud')) return;

    e.preventDefault();
    e.stopPropagation();
    setQuickAnglesOpen(false);
    setIsDragging(true);

    dragState = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origCx: props.state.cx,
      origCy: props.state.cy,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleBodyPointerMove = (e: PointerEvent) => {
    if (twoFingerState) return;
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const rawCx = dragState.origCx + (e.clientX - dragState.startClientX);
    const rawCy = dragState.origCy + (e.clientY - dragState.startClientY);
    const clamped = clampRulerCenter(
      rawCx,
      rawCy,
      props.containerWidth,
      props.containerHeight
    );
    props.onUpdate({ cx: clamped.cx, cy: clamped.cy });
  };

  const handleBodyPointerEnd = (e: PointerEvent) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    dragState = null;
    setIsDragging(false);
  };

  // ==================== 1-POINTER ROTATE HANDLES ====================
  const handleRotatePointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const center = getRulerCenterClient();
    if (!center) return;

    e.preventDefault();
    e.stopPropagation();
    setQuickAnglesOpen(false);
    setIsRotating(true);

    rotateHandleState = {
      pointerId: e.pointerId,
      centerClientX: center.x,
      centerClientY: center.y,
      startPointerAngleRad: Math.atan2(
        e.clientY - center.y,
        e.clientX - center.x
      ),
      origAngleDeg: props.state.angleDeg,
    };

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleRotatePointerMove = (e: PointerEvent) => {
    if (!rotateHandleState || e.pointerId !== rotateHandleState.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const currRad = Math.atan2(
      e.clientY - rotateHandleState.centerClientY,
      e.clientX - rotateHandleState.centerClientX
    );
    const deltaDeg = ((currRad - rotateHandleState.startPointerAngleRad) * 180) / Math.PI;
    const snapped = snapRulerAngle(rotateHandleState.origAngleDeg + deltaDeg, e.altKey);
    setIsSnapped(snapped.snapped);
    props.onUpdate({ angleDeg: snapped.angleDeg });
  };

  const handleRotatePointerEnd = (e: PointerEvent) => {
    if (!rotateHandleState || e.pointerId !== rotateHandleState.pointerId) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    rotateHandleState = null;
    setIsRotating(false);
    setIsSnapped(false);
  };

  // ==================== 2-FINGER TOUCH ROTATE + DRAG + WHEEL ROTATE ====================
  onMount(() => {
    const el = bodyEl;
    if (!el) return;

    const findTouch = (list: TouchList, id: number): Touch | null => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    };

    const onTouchStart = (e: TouchEvent) => {
      // Prevent viewport scroll/pinch controller from intercepting touches on the ruler
      e.stopPropagation();
      // Use targetTouches so a resting palm elsewhere on the canvas never triggers 2-finger rotate
      if (e.targetTouches.length >= 2) {
        e.preventDefault();
        dragState = null;
        setIsDragging(false);
        setQuickAnglesOpen(false);
        setIsRotating(true);

        const t0 = e.targetTouches[0];
        const t1 = e.targetTouches[1];
        twoFingerState = {
          touchIdA: t0.identifier,
          touchIdB: t1.identifier,
          startMidX: (t0.clientX + t1.clientX) / 2,
          startMidY: (t0.clientY + t1.clientY) / 2,
          startAngleRad: Math.atan2(
            t1.clientY - t0.clientY,
            t1.clientX - t0.clientX
          ),
          origCx: props.state.cx,
          origCy: props.state.cy,
          origAngleDeg: props.state.angleDeg,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.stopPropagation();
      if (!twoFingerState) return;
      const t0 = findTouch(e.touches, twoFingerState.touchIdA);
      const t1 = findTouch(e.touches, twoFingerState.touchIdB);
      if (!t0 || !t1) return;

      e.preventDefault();
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const angleRad = Math.atan2(
        t1.clientY - t0.clientY,
        t1.clientX - t0.clientX
      );
      const deltaDeg = ((angleRad - twoFingerState.startAngleRad) * 180) / Math.PI;
      const snapped = snapRulerAngle(twoFingerState.origAngleDeg + deltaDeg, false);
      const clamped = clampRulerCenter(
        twoFingerState.origCx + (midX - twoFingerState.startMidX),
        twoFingerState.origCy + (midY - twoFingerState.startMidY),
        props.containerWidth,
        props.containerHeight
      );
      setIsSnapped(snapped.snapped);
      props.onUpdate({
        cx: clamped.cx,
        cy: clamped.cy,
        angleDeg: snapped.angleDeg,
      });
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.stopPropagation();
      if (!twoFingerState) return;
      const stillA = Boolean(findTouch(e.touches, twoFingerState.touchIdA));
      const stillB = Boolean(findTouch(e.touches, twoFingerState.touchIdB));
      if (!stillA || !stillB) {
        twoFingerState = null;
        setIsRotating(false);
        setIsSnapped(false);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY > 0 ? 1 : -1;
      const step = e.shiftKey ? 15 : 1;
      const rawNext = e.shiftKey
        ? Math.round((props.state.angleDeg + dir * step) / 15) * 15
        : props.state.angleDeg + dir * step;
      props.onUpdate({ angleDeg: normalizeAngle180(rawNext) });
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });

    onCleanup(() => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
    });
  });

  return (
    <div
      ref={rulerEl}
      class="canvas-ruler"
      classList={{
        'is-dark-paper': props.paperIsDark,
        'is-dragging': isDragging(),
        'is-rotating': isRotating(),
        'is-edge-top': props.activeEdge?.side === 'top',
        'is-edge-bottom': props.activeEdge?.side === 'bottom',
      }}
      style={{
        left: `${props.state.cx}px`,
        top: `${props.state.cy}px`,
        width: `${RULER_VISUAL_LENGTH_PX}px`,
        height: `${RULER_HEIGHT_PX}px`,
        transform: `translate(-50%, -50%) rotate(${props.state.angleDeg}deg)`,
      }}
      role="region"
      aria-label={`Lineal (${formatRulerAngle(props.state.angleDeg)})`}
    >
      {/* Top & bottom beveled edge highlight lines (pointer-events: none so pen snaps right at the edge) */}
      <div class="canvas-ruler-edge is-top" aria-hidden="true" />
      <div class="canvas-ruler-edge is-bottom" aria-hidden="true" />

      {/* Crisp Vector Centimeter & Millimeter Markings flush to both ruler edges */}
      <svg
        class="canvas-ruler-ticks"
        width={RULER_VISUAL_LENGTH_PX}
        height={RULER_HEIGHT_PX}
        viewBox={`0 0 ${RULER_VISUAL_LENGTH_PX} ${RULER_HEIGHT_PX}`}
        aria-hidden="true"
      >
        <path class="ruler-tick-minor" d={tickData().minorPath} />
        <path class="ruler-tick-mid" d={tickData().midPath} />
        <path class="ruler-tick-major" d={tickData().majorPath} />
        <For each={tickData().labels}>
          {(lbl) => (
            <text
              class="ruler-tick-label"
              x={lbl.x}
              y={RULER_HEIGHT_PX / 2 + 3.5}
              text-anchor="middle"
            >
              {lbl.text}
            </text>
          )}
        </For>
      </svg>

      {/* Subtle center guide hairline */}
      <div class="canvas-ruler-centerline" aria-hidden="true" />

      {/* Main interactive body (inset 6px from top/bottom edges so strokes touching the bevel snap cleanly) */}
      <div
        ref={bodyEl}
        class="canvas-ruler-body"
        onPointerDown={handleBodyPointerDown}
        onPointerMove={handleBodyPointerMove}
        onPointerUp={handleBodyPointerEnd}
        onPointerCancel={handleBodyPointerEnd}
        onLostPointerCapture={handleBodyPointerEnd}
        onContextMenu={(e) => e.preventDefault()}
        title="Ziehen zum Verschieben · 2 Finger oder Drehgriffe zum Drehen · Mausrad dreht um 1°"
      >

        {/* Left & Right 1-Finger / Mouse / Pencil Rotation Handles */}
        <button
          type="button"
          class="ruler-rotate-handle is-left"
          onPointerDown={handleRotatePointerDown}
          onPointerMove={handleRotatePointerMove}
          onPointerUp={handleRotatePointerEnd}
          onPointerCancel={handleRotatePointerEnd}
          onLostPointerCapture={handleRotatePointerEnd}
          title="Lineal drehen (Alt gedrückt halten für freien Winkel)"
          aria-label="Lineal drehen"
        >
          <IconRotateCw size={14} />
        </button>

        <button
          type="button"
          class="ruler-rotate-handle is-right"
          onPointerDown={handleRotatePointerDown}
          onPointerMove={handleRotatePointerMove}
          onPointerUp={handleRotatePointerEnd}
          onPointerCancel={handleRotatePointerEnd}
          onLostPointerCapture={handleRotatePointerEnd}
          title="Lineal drehen (Alt gedrückt halten für freien Winkel)"
          aria-label="Lineal drehen"
        >
          <IconRotateCw size={14} />
        </button>

        {/* Central Counter-Rotated HUD Pill (Always Upright & Readable) */}
        <div
          class="ruler-center-hud"
          classList={{ 'is-above': props.state.cy > props.containerHeight - 100 }}
          style={{ transform: `translate(-50%, -50%) rotate(${-props.state.angleDeg}deg)` }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            class="ruler-angle-pill"
            classList={{
              'is-snapped': isSnapped(),
              'is-measuring': Boolean(props.activeEdge),
              'is-open': quickAnglesOpen(),
            }}
            onClick={() => setQuickAnglesOpen((v) => !v)}
            title="Schnellwinkel wählen oder Lineal ausblenden"
            aria-expanded={quickAnglesOpen()}
          >
            <span class="ruler-angle-val">{displayAngle()}°</span>
            <Show when={props.activeEdge}>
              {(edge) => (
                <>
                  <span class="ruler-hud-sep">·</span>
                  <span class="ruler-length-val">{edge().lengthCm}</span>
                </>
              )}
            </Show>
          </button>

          <Show when={quickAnglesOpen()}>
            <div class="ruler-quick-bar" role="toolbar" aria-label="Lineal-Schnellaktionen">
              <For each={QUICK_ANGLES}>
                {(preset) => (
                  <button
                    type="button"
                    class="ruler-quick-btn"
                    classList={{ 'is-active': displayAngle() === preset.value }}
                    onClick={() => {
                      props.onUpdate({ angleDeg: preset.value });
                      setQuickAnglesOpen(false);
                    }}
                  >
                    {preset.label}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="ruler-quick-btn is-close"
                onClick={() => {
                  setQuickAnglesOpen(false);
                  props.onClose();
                }}
                title="Lineal ausblenden (R)"
                aria-label="Lineal ausblenden"
              >
                <IconX size={13} />
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
