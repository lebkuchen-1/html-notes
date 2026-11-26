import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type {
  CanvasPage,
  StabilizationLevel,
  Stroke,
  StrokePoint,
  ThemeMode,
} from '../types';
import {
  drawStroke,
  isPointHittingStroke,
  resolveStrokeColor,
} from '../utils/canvasRenderer';
import {
  computeOcclusionStudyViewport,
  renderOcclusionStudyCanvas,
  type OcclusionStudyViewport,
} from '../utils/flashcards';
import {
  createIncrementalPenState,
  drawPenLiveStep,
  drawPenStartDot,
  type IncrementalPenState,
} from '../utils/penEngine';
import { generateId } from '../utils/storage';
import { optimizeStroke } from '../utils/strokeCodec';
import { StrokeStabilizer } from '../utils/strokeStabilizer';
import {
  IconEraser,
  IconEye,
  IconEyeOff,
  IconPen,
  IconStylus,
  IconTrash,
  IconUndo,
} from './Icons';

interface AppleTouch extends Touch {
  touchType?: 'direct' | 'stylus';
}

const STORAGE_OCC_HEIGHT_KEY = 'solid-notes:v1:fcOccCanvasHeight';
const STORAGE_OCC_COLOR_KEY = 'solid-notes:v1:fcOccPenColor';
const STORAGE_OCC_WIDTH_KEY = 'solid-notes:v1:fcOccPenWidth';
const STORAGE_OCC_STYLUS_KEY = 'solid-notes:v1:fcOccStylusOnly';

const MIN_OCC_HEIGHT = 220;
const MAX_OCC_HEIGHT = 680;

const OCC_HEIGHT_PRESETS = [
  { id: 'S', label: 'S', height: 260 },
  { id: 'M', label: 'M', height: 380 },
  { id: 'L', label: 'L', height: 500 },
  { id: 'XL', label: 'XL', height: 620 },
] as const;

const OCC_PEN_COLORS = [
  { value: '#dc2626', label: 'Rot (Kontrast)' },
  { value: '#2563eb', label: 'Blau' },
  { value: '#059669', label: 'Grün' },
  { value: 'auto', label: 'Tinte (Auto)' },
] as const;

const OCC_PEN_WIDTHS = [
  { label: 'Fein', value: 2.2 },
  { label: 'Mittel', value: 3.4 },
  { label: 'Dick', value: 5.4 },
] as const;

function loadNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
    }
  } catch {
    // ignore
  }
  return fallback;
}

function loadColor(): string {
  try {
    const raw = localStorage.getItem(STORAGE_OCC_COLOR_KEY);
    if (raw && OCC_PEN_COLORS.some((c) => c.value === raw)) return raw;
  } catch {
    // ignore
  }
  return '#dc2626';
}

function loadStylus(fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_OCC_STYLUS_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore
  }
  return fallback;
}

export interface OcclusionStudyCanvasProps {
  page: CanvasPage;
  theme: ThemeMode;
  isInfinite: boolean;
  targetIds: string[];
  promptIds: string[];
  revealed: boolean;
  hideOtherOcclusions: boolean;
  viewMode: 'focus' | 'full';
  resetToken: number;
  stabilization: StabilizationLevel;
  pressureSensitivity: boolean;
  defaultStylusOnly: boolean;
  autoEnableStylusOnly: boolean;
  onHasDrawingChange?: (hasDrawing: boolean) => void;
}

export function OcclusionStudyCanvas(props: OcclusionStudyCanvasProps) {
  const [userStrokes, setUserStrokes] = createSignal<Stroke[]>([]);
  const [showOverlayDrawing, setShowOverlayDrawing] = createSignal<boolean>(true);
  const [tool, setTool] = createSignal<'pen' | 'eraser'>('pen');
  const [penColor, setPenColor] = createSignal<string>(loadColor());
  const [penWidth, setPenWidth] = createSignal<number>(
    loadNum(STORAGE_OCC_WIDTH_KEY, 3.4, 1.5, 10)
  );
  const [heightPx, setHeightPx] = createSignal<number>(
    loadNum(STORAGE_OCC_HEIGHT_KEY, 380, MIN_OCC_HEIGHT, MAX_OCC_HEIGHT)
  );
  const [stylusOnly, setStylusOnly] = createSignal<boolean>(
    loadStylus(props.defaultStylusOnly)
  );
  const [isResizing, setIsResizing] = createSignal<boolean>(false);
  const [stageWidth, setStageWidth] = createSignal<number>(640);

  let wrapperRef: HTMLDivElement | undefined;
  let baseCanvasRef: HTMLCanvasElement | undefined;
  let liveCanvasRef: HTMLCanvasElement | undefined;
  let liveCtxCache: CanvasRenderingContext2D | null = null;
  let currentViewport: OcclusionStudyViewport = { camX: 0, camY: 0, zoom: 1 };

  // Imperative 120Hz drawing state (in exact page world coordinates!)
  let activePointerId: number | null = null;
  let activePointerType: string | null = null;
  let activeStroke: Stroke | null = null;
  let activeStabilizer: StrokeStabilizer | null = null;
  let penLiveState: IncrementalPenState = createIncrementalPenState();
  let strokeStartEventTime = 0;
  let lastMoveTime = 0;
  let lastPoint: StrokePoint | null = null;
  let lastPenTimestamp = 0;
  let pendingLiveClearAfterBaseRender = false;
  let isErasing = false;
  let erasingStrokes: Stroke[] | null = null;
  let erasedSomething = false;
  let eraserCursor: { x: number; y: number } | null = null;
  let baseRafId: number | null = null;
  let liveRafId: number | null = null;

  createEffect(() => {
    try {
      localStorage.setItem(STORAGE_OCC_HEIGHT_KEY, String(Math.round(heightPx())));
      localStorage.setItem(STORAGE_OCC_COLOR_KEY, penColor());
      localStorage.setItem(STORAGE_OCC_WIDTH_KEY, String(penWidth()));
      localStorage.setItem(STORAGE_OCC_STYLUS_KEY, stylusOnly() ? '1' : '0');
    } catch {
      // ignore
    }
  });

  // Reset drawn answer whenever moving to the next flashcard
  let lastResetToken = props.resetToken;
  createEffect(() => {
    const tok = props.resetToken;
    if (tok !== lastResetToken) {
      lastResetToken = tok;
      abortActiveStroke();
      setUserStrokes([]);
      setShowOverlayDrawing(true);
    }
  });

  createEffect(() => {
    props.onHasDrawingChange?.(userStrokes().length > 0);
  });

  const getDpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const syncBackingStore = () => {
    const cssW = Math.max(220, stageWidth());
    const cssH = Math.max(MIN_OCC_HEIGHT, heightPx());
    const dpr = getDpr();
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (baseCanvasRef && (baseCanvasRef.width !== targetW || baseCanvasRef.height !== targetH)) {
      baseCanvasRef.width = targetW;
      baseCanvasRef.height = targetH;
    }
    if (liveCanvasRef && (liveCanvasRef.width !== targetW || liveCanvasRef.height !== targetH)) {
      liveCanvasRef.width = targetW;
      liveCanvasRef.height = targetH;
      liveCtxCache = liveCanvasRef.getContext('2d');
    }
    return { cssW, cssH, dpr, targetW, targetH };
  };

  const getLiveCtx = () => {
    if (!liveCanvasRef) return null;
    if (!liveCtxCache) liveCtxCache = liveCanvasRef.getContext('2d');
    return liveCtxCache;
  };

  const clearLiveCanvas = () => {
    const live = liveCanvasRef;
    const ctx = getLiveCtx();
    if (live && ctx) {
      ctx.clearRect(0, 0, live.width, live.height);
    }
  };

  const renderBaseNow = () => {
    baseRafId = null;
    const base = baseCanvasRef;
    if (!base) return;
    const { cssW, cssH, dpr } = syncBackingStore();
    const ctx = base.getContext('2d');
    if (!ctx) return;

    const vp = renderOcclusionStudyCanvas(ctx, {
      page: props.page,
      theme: props.theme,
      isInfinite: props.isInfinite,
      targetIds: props.targetIds,
      promptIds: props.promptIds,
      revealed: props.revealed,
      hideOtherOcclusions: props.hideOtherOcclusions,
      viewMode: props.viewMode,
      cssWidth: cssW,
      cssHeight: cssH,
      dpr,
      onImageLoad: scheduleBaseRender,
    });
    currentViewport = vp;

    // Overlay user's direct-on-canvas answer strokes in exact world coordinates
    const strokesToDraw = isErasing && erasingStrokes ? erasingStrokes : userStrokes();
    if (showOverlayDrawing() && strokesToDraw.length > 0) {
      ctx.save();
      ctx.scale(dpr * vp.zoom, dpr * vp.zoom);
      ctx.translate(-vp.camX, -vp.camY);
      for (const s of strokesToDraw) {
        drawStroke(ctx, s, props.page.paperConfig, props.theme);
      }
      ctx.restore();
    }

    if (pendingLiveClearAfterBaseRender) {
      pendingLiveClearAfterBaseRender = false;
      if (!activeStroke) clearLiveCanvas();
    }
  };

  const scheduleBaseRender = () => {
    if (baseRafId === null) {
      baseRafId = requestAnimationFrame(renderBaseNow);
    }
  };

  const renderLiveNow = () => {
    liveRafId = null;
    const live = liveCanvasRef;
    if (!live) return;
    const { cssW, cssH, dpr, targetW, targetH } = syncBackingStore();
    const ctx = getLiveCtx();
    if (!ctx) return;

    const vp = currentViewport ?? computeOcclusionStudyViewport({
      page: props.page,
      isInfinite: props.isInfinite,
      targetIds: props.targetIds,
      promptIds: props.promptIds,
      viewMode: props.viewMode,
      cssWidth: cssW,
      cssHeight: cssH,
    });
    const totalScale = dpr * vp.zoom;
    const offsetX = -vp.camX * totalScale;
    const offsetY = -vp.camY * totalScale;

    if (activeStroke && activeStroke.tool === 'pen') {
      const pts = activeStroke.points;
      const color = resolveStrokeColor(
        activeStroke.color,
        props.page.paperConfig,
        props.theme
      );
      if (penLiveState.drawnCount === 0 && pts.length > 0) {
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        drawPenStartDot(ctx, activeStroke, pts[0], color, totalScale, penLiveState);
        ctx.restore();
      }
      if (penLiveState.drawnCount < pts.length) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        while (penLiveState.drawnCount < pts.length) {
          const prev = pts[penLiveState.drawnCount - 1];
          const curr = pts[penLiveState.drawnCount];
          drawPenLiveStep(ctx, activeStroke, prev, curr, color, totalScale, penLiveState);
        }
        ctx.restore();
      }
      return;
    }

    ctx.clearRect(0, 0, targetW, targetH);

    if (eraserCursor && (tool() === 'eraser' || isErasing)) {
      ctx.save();
      ctx.scale(totalScale, totalScale);
      ctx.translate(-vp.camX, -vp.camY);
      ctx.beginPath();
      ctx.arc(eraserCursor.x, eraserCursor.y, 15 / Math.max(0.35, vp.zoom), 0, Math.PI * 2);
      ctx.strokeStyle =
        props.theme === 'dark' ? 'rgba(248, 250, 252, 0.72)' : 'rgba(15, 23, 42, 0.55)';
      ctx.fillStyle =
        props.theme === 'dark' ? 'rgba(248, 250, 252, 0.08)' : 'rgba(15, 23, 42, 0.06)';
      ctx.lineWidth = 1.5 / Math.max(0.35, vp.zoom);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };

  const scheduleLiveRender = () => {
    if (liveRafId === null) {
      liveRafId = requestAnimationFrame(renderLiveNow);
    }
  };

  createEffect(() => {
    void stageWidth();
    void heightPx();
    void props.page;
    void props.theme;
    void props.isInfinite;
    void props.targetIds;
    void props.promptIds;
    void props.revealed;
    void props.hideOtherOcclusions;
    void props.viewMode;
    void userStrokes();
    void showOverlayDrawing();
    scheduleBaseRender();
  });

  const toWorldPoint = (
    e: PointerEvent,
    explicitPointerType?: string,
    explicitTimeMs?: number
  ): StrokePoint => {
    const rect = liveCanvasRef!.getBoundingClientRect();
    const vp = currentViewport;
    const x = vp.camX + (e.clientX - rect.left) / Math.max(0.1, vp.zoom);
    const y = vp.camY + (e.clientY - rect.top) / Math.max(0.1, vp.zoom);

    const evTime = explicitTimeMs ?? (e.timeStamp || performance.now());
    const relTime =
      strokeStartEventTime > 0 ? Math.max(0, Math.round(evTime - strokeStartEventTime)) : 0;

    const pType = explicitPointerType || e.pointerType;
    let pressure = 0.55;
    if (props.pressureSensitivity) {
      pressure = lastPoint?.pressure ?? 0.52;
      if (pType === 'pen') {
        const raw =
          e.pressure > 0.005 ? Math.min(1, Math.max(0.05, e.pressure)) : pressure;
        const smooth = activeStabilizer?.pressureSmoothing ?? 0.55;
        pressure = lastPoint ? lastPoint.pressure * smooth + raw * (1 - smooth) : raw;
      } else if (lastPoint && lastMoveTime > 0) {
        const dt = Math.max(1, evTime - lastMoveTime);
        const dist = Math.hypot(x - lastPoint.x, y - lastPoint.y);
        const velocity = (dist * vp.zoom) / dt;
        const target = Math.max(0.28, Math.min(0.88, 0.78 - velocity * 0.28));
        pressure = lastPoint.pressure * 0.65 + target * 0.35;
      }
    }
    return { x, y, pressure, t: relTime };
  };

  const eraseAtPoint = (pt: StrokePoint): boolean => {
    if (!erasingStrokes) return false;
    const radius = 15 / Math.max(0.35, currentViewport.zoom);
    const before = erasingStrokes.length;
    erasingStrokes = erasingStrokes.filter((s) => !isPointHittingStroke(pt, s, radius));
    if (erasingStrokes.length !== before) {
      erasedSomething = true;
      return true;
    }
    return false;
  };

  const abortActiveStroke = () => {
    if (activePointerId !== null && liveCanvasRef?.hasPointerCapture(activePointerId)) {
      try {
        liveCanvasRef.releasePointerCapture(activePointerId);
      } catch {
        // ignore
      }
    }
    activePointerId = null;
    activePointerType = null;
    activeStroke = null;
    activeStabilizer = null;
    penLiveState = createIncrementalPenState();
    isErasing = false;
    erasingStrokes = null;
    erasedSomething = false;
    lastPoint = null;
    clearLiveCanvas();
  };

  const finalizeStroke = (cancelled = false, isTouch = false) => {
    const pid = activePointerId;
    if (pid !== null && liveCanvasRef?.hasPointerCapture(pid)) {
      try {
        liveCanvasRef.releasePointerCapture(pid);
      } catch {
        // ignore
      }
    }
    const wasPen = activePointerType === 'pen';
    activePointerId = null;
    activePointerType = null;
    lastPoint = null;

    if (isErasing) {
      if (erasedSomething && erasingStrokes) {
        setUserStrokes(erasingStrokes);
      }
      isErasing = false;
      erasingStrokes = null;
      erasedSomething = false;
      if (isTouch) eraserCursor = null;
      scheduleBaseRender();
      scheduleLiveRender();
      return;
    }

    if (activeStroke) {
      const finished = activeStroke;
      const stabilizer = activeStabilizer;
      activeStroke = null;
      activeStabilizer = null;
      penLiveState = createIncrementalPenState();

      const shouldDiscard = cancelled && !wasPen;
      if (!shouldDiscard && finished.points.length > 0) {
        if (stabilizer) {
          finished.points = stabilizer.finalize(finished.points);
        }
        const compacted = optimizeStroke(finished);
        pendingLiveClearAfterBaseRender = true;
        setUserStrokes((prev) => [...prev, compacted]);
      } else {
        clearLiveCanvas();
      }
    } else {
      activeStabilizer = null;
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (!liveCanvasRef) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const now = Date.now();
    const isStylusEraser =
      e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);

    if (e.pointerType === 'pen') {
      lastPenTimestamp = now;
      if (props.autoEnableStylusOnly && !stylusOnly()) {
        setStylusOnly(true);
      }
    }

    if (e.pointerType === 'touch') {
      const isLargePalm = e.width > 34 || e.height > 34;
      const penRecentlyUsed = now - lastPenTimestamp < 1200;
      if (stylusOnly() || penRecentlyUsed || isLargePalm || activePointerType === 'pen') {
        return;
      }
    }

    if (activePointerId !== null) {
      if (e.pointerType === 'pen') {
        finalizeStroke(false, activePointerType === 'touch');
      } else {
        return;
      }
    }

    // Auto-show user drawing if they start drawing while "Nur Lösung" was active
    if (!showOverlayDrawing()) {
      setShowOverlayDrawing(true);
    }

    e.preventDefault();
    e.stopPropagation();

    activePointerId = e.pointerId;
    activePointerType = e.pointerType;
    try {
      liveCanvasRef.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    lastPoint = null;
    const startEvTime = e.timeStamp || performance.now();
    strokeStartEventTime = startEvTime;
    lastMoveTime = startEvTime;

    const useEraser = isStylusEraser || tool() === 'eraser';
    if (useEraser) {
      isErasing = true;
      erasedSomething = false;
      erasingStrokes = [...userStrokes()];
      const pt = toWorldPoint(e, e.pointerType, startEvTime);
      eraserCursor = { x: pt.x, y: pt.y };
      lastPoint = pt;
      if (eraseAtPoint(pt)) scheduleBaseRender();
      scheduleLiveRender();
      return;
    }

    activeStabilizer = new StrokeStabilizer(props.stabilization);
    const rawPt = toWorldPoint(e, e.pointerType, startEvTime);
    const pt = activeStabilizer.filter(rawPt, startEvTime);
    lastPoint = pt;
    penLiveState = createIncrementalPenState();
    pendingLiveClearAfterBaseRender = false;
    // Keep visual stroke width consistent regardless of zoom level
    const worldWidth = penWidth() / Math.max(0.4, currentViewport.zoom);
    activeStroke = {
      id: generateId(),
      tool: 'pen',
      penStyle: 'ballpoint',
      color: penColor(),
      width: worldWidth,
      opacity: 1,
      points: [pt],
    };
    scheduleLiveRender();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!liveCanvasRef) return;
    if (e.pointerType === 'pen') {
      lastPenTimestamp = Date.now();
    }

    if (activePointerId === null) {
      if (tool() === 'eraser' && e.pointerType !== 'touch') {
        const pt = toWorldPoint(e, e.pointerType);
        eraserCursor = { x: pt.x, y: pt.y };
        scheduleLiveRender();
      }
      return;
    }

    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const parentType = activePointerType || e.pointerType;
    const coalesced =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e];
    const minDist = (activeStabilizer?.minSpacing ?? 1.1) / Math.max(0.4, currentViewport.zoom);
    let erasedNow = false;

    for (const ev of events) {
      if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) continue;
      if (ev !== e && ev.clientX === 0 && ev.clientY === 0 && Math.hypot(e.clientX, e.clientY) > 12) {
        continue;
      }
      const evTime = ev.timeStamp || e.timeStamp || performance.now();
      const rawPt = toWorldPoint(ev, parentType, evTime);
      lastMoveTime = evTime;

      if (isErasing) {
        eraserCursor = { x: rawPt.x, y: rawPt.y };
        if (eraseAtPoint(rawPt)) erasedNow = true;
        lastPoint = rawPt;
        continue;
      }

      if (!activeStroke) continue;
      const pt = activeStabilizer ? activeStabilizer.filter(rawPt, evTime) : rawPt;
      if (!lastPoint || Math.hypot(pt.x - lastPoint.x, pt.y - lastPoint.y) >= minDist) {
        activeStroke.points.push(pt);
        lastPoint = pt;
      }
    }

    if (erasedNow) scheduleBaseRender();
    scheduleLiveRender();
  };

  const handlePointerEnd = (e: PointerEvent, cancelled: boolean) => {
    if (activePointerId !== null && e.pointerId === activePointerId) {
      finalizeStroke(cancelled, e.pointerType === 'touch');
    }
  };

  // Drag-to-resize canvas height
  let resizeDrag: { pointerId: number; startY: number; startH: number } | null = null;

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeDrag = { pointerId: e.pointerId, startY: e.clientY, startH: heightPx() };
    setIsResizing(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const moveResize = (e: PointerEvent) => {
    if (!resizeDrag || e.pointerId !== resizeDrag.pointerId) return;
    e.preventDefault();
    const nextH = Math.max(
      MIN_OCC_HEIGHT,
      Math.min(MAX_OCC_HEIGHT, Math.round(resizeDrag.startH + (e.clientY - resizeDrag.startY)))
    );
    setHeightPx(nextH);
  };

  const endResize = (e: PointerEvent) => {
    if (!resizeDrag || e.pointerId !== resizeDrag.pointerId) return;
    resizeDrag = null;
    setIsResizing(false);
    try {
      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
  };

  onMount(() => {
    const sync = () => {
      if (!wrapperRef) return;
      const w = Math.round(wrapperRef.getBoundingClientRect().width);
      if (w > 40) setStageWidth(w);
    };
    sync();
    const ro = new ResizeObserver(sync);
    if (wrapperRef) ro.observe(wrapperRef);

    const handleWindowPointerEnd = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId === activePointerId) {
        finalizeStroke(e.type === 'pointercancel', e.pointerType === 'touch');
      }
    };
    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);

    const handleTouchGuard = (e: TouchEvent) => {
      for (let i = 0; i < e.touches.length; i++) {
        if ((e.touches[i] as AppleTouch).touchType === 'stylus') {
          if (e.cancelable) e.preventDefault();
          return;
        }
      }
      if (!stylusOnly() && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
      }
    };
    const liveEl = liveCanvasRef;
    liveEl?.addEventListener('touchstart', handleTouchGuard, { passive: false });
    liveEl?.addEventListener('touchmove', handleTouchGuard, { passive: false });

    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
      liveEl?.removeEventListener('touchstart', handleTouchGuard);
      liveEl?.removeEventListener('touchmove', handleTouchGuard);
      if (baseRafId !== null) cancelAnimationFrame(baseRafId);
      if (liveRafId !== null) cancelAnimationFrame(liveRafId);
    });
  });

  const activeHeightPreset = () =>
    OCC_HEIGHT_PRESETS.find((p) => Math.abs(p.height - heightPx()) <= 20)?.id ?? null;

  return (
    <div
      class="fc-occ-interactive-shell"
      classList={{
        'is-revealed': props.revealed,
        'is-resizing': isResizing(),
      }}
    >
      {/* Inline Direct-on-Canvas Drawing & Compare Toolbar */}
      <div class="fc-scratchpad-bar fc-occ-draw-bar">
        <div class="fc-sp-group">
          <span class="fc-sp-title">
            {props.revealed ? 'Vergleich direkt im Canvas' : 'Direkt einzeichnen'}
          </span>

          <div class="fc-sp-divider" />

          <button
            type="button"
            class="fc-sp-btn"
            classList={{ 'is-active': tool() === 'pen' }}
            onClick={() => setTool('pen')}
            title="Stift (direkt auf dem Canvas zeichnen)"
            aria-label="Stift"
          >
            <IconPen size={13} />
          </button>
          <button
            type="button"
            class="fc-sp-btn"
            classList={{ 'is-active': tool() === 'eraser' }}
            onClick={() => setTool('eraser')}
            title="Radierer (löscht nur deine Antwort-Zeichnung)"
            aria-label="Radierer"
          >
            <IconEraser size={13} />
          </button>

          <div class="fc-sp-colors">
            <For each={OCC_PEN_COLORS}>
              {(c) => {
                const bg = () =>
                  c.value === 'auto'
                    ? props.theme === 'dark'
                      ? '#f1f5f9'
                      : '#1e293b'
                    : c.value;
                return (
                  <button
                    type="button"
                    class="fc-sp-swatch"
                    classList={{ 'is-active': tool() === 'pen' && penColor() === c.value }}
                    style={{ background: bg() }}
                    onClick={() => {
                      setPenColor(c.value);
                      setTool('pen');
                    }}
                    title={`Farbe: ${c.label}`}
                    aria-label={`Farbe ${c.label}`}
                  />
                );
              }}
            </For>
          </div>

          <div class="fc-sp-pills" title="Strichstärke">
            <For each={OCC_PEN_WIDTHS}>
              {(w) => (
                <button
                  type="button"
                  class="fc-sp-mini-pill"
                  classList={{ 'is-active': Math.abs(penWidth() - w.value) < 0.6 }}
                  onClick={() => {
                    setPenWidth(w.value);
                    setTool('pen');
                  }}
                  title={`Strichstärke ${w.label}`}
                >
                  <span
                    class="fc-sp-dot"
                    style={{
                      width: `${Math.round(3 + w.value * 0.9)}px`,
                      height: `${Math.round(3 + w.value * 0.9)}px`,
                    }}
                  />
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="fc-sp-group">
          {/* Compare overlay toggle once solution is revealed */}
          <Show when={props.revealed && userStrokes().length > 0}>
            <button
              type="button"
              class="fc-occ-compare-pill"
              classList={{ 'is-active': showOverlayDrawing() }}
              onClick={() => setShowOverlayDrawing((v) => !v)}
              title={
                showOverlayDrawing()
                  ? 'Deine Zeichnung ausblenden, um nur die Originallösung zu sehen'
                  : 'Deine Zeichnung wieder über der Lösung einblenden'
              }
            >
              <Show when={showOverlayDrawing()} fallback={<IconEyeOff size={12} />}>
                <IconEye size={12} />
              </Show>
              <span>{showOverlayDrawing() ? 'Überlagert' : 'Nur Lösung'}</span>
            </button>
          </Show>

          {/* Optionalgröße (Canvas Height Presets) */}
          <div class="fc-sp-pills" role="group" aria-label="Canvas-Größe">
            <For each={OCC_HEIGHT_PRESETS}>
              {(preset) => (
                <button
                  type="button"
                  class="fc-sp-mini-pill"
                  classList={{ 'is-active': activeHeightPreset() === preset.id }}
                  onClick={() => setHeightPx(preset.height)}
                  title={`Größe ${preset.label} (${preset.height} px)`}
                >
                  {preset.label}
                </button>
              )}
            </For>
          </div>

          <button
            type="button"
            class="fc-sp-btn"
            classList={{ 'is-active': stylusOnly() }}
            onClick={() => setStylusOnly((v) => !v)}
            title={
              stylusOnly()
                ? 'Nur Stift aktiv (Finger scrollt die Karte)'
                : 'Nur-Stift-Modus aktivieren (Handballenschutz)'
            }
            aria-label="Nur Stift"
            aria-pressed={stylusOnly()}
          >
            <IconStylus size={13} />
          </button>

          <button
            type="button"
            class="fc-sp-btn"
            disabled={userStrokes().length === 0}
            onClick={() => setUserStrokes((prev) => prev.slice(0, -1))}
            title="Letzten Strich rückgängig"
            aria-label="Rückgängig"
          >
            <IconUndo size={13} />
          </button>

          <button
            type="button"
            class="fc-sp-btn is-danger"
            disabled={userStrokes().length === 0}
            onClick={() => {
              abortActiveStroke();
              setUserStrokes([]);
            }}
            title="Eigene Zeichnung löschen"
            aria-label="Eigene Zeichnung löschen"
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      {/* Interactive Dual-Layer Occlusion Canvas */}
      <div
        ref={wrapperRef}
        class="fc-occ-canvas-wrap is-drawable"
        style={{ height: `${heightPx()}px` }}
      >
        <canvas
          ref={baseCanvasRef}
          class="fc-occ-canvas is-base"
          style={{ width: '100%', height: `${heightPx()}px` }}
        />
        <canvas
          ref={liveCanvasRef}
          class="fc-occ-canvas fc-occ-canvas-live is-live"
          classList={{
            'is-eraser': tool() === 'eraser',
            'is-stylus-only': stylusOnly(),
          }}
          style={{ width: '100%', height: `${heightPx()}px` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => handlePointerEnd(e, false)}
          onPointerCancel={(e) => handlePointerEnd(e, true)}
          onLostPointerCapture={() => {
            if (activePointerId !== null) {
              finalizeStroke(false, activePointerType === 'touch');
            }
          }}
          onPointerLeave={() => {
            if (eraserCursor) {
              eraserCursor = null;
              scheduleLiveRender();
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
        />

        <Show when={isResizing()}>
          <div class="fc-scratchpad-size-badge">{heightPx()} px</div>
        </Show>
      </div>

      {/* Bottom Resize Handle */}
      <div
        class="fc-scratchpad-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Höhe der Canvas-Karte anpassen"
        title="Ziehen zum Anpassen der Größe"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <span class="fc-sp-grip" />
      </div>
    </div>
  );
}
