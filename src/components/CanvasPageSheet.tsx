import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  OCCLUSION_COLORS,
  type CanvasFontFamily,
  type CanvasImageItem,
  type CanvasOcclusionItem,
  type CanvasPage,
  type CanvasSnapshot,
  type CanvasTextItem,
  type DrawingTool,
  type PenStyle,
  type Stroke,
  type StrokePoint,
} from '../types';
import {
  drawStroke,
  isPaperDark,
  isPointHittingImage,
  isPointHittingStroke,
  isPointHittingText,
  renderFullCanvas,
  resolvePaperBackgroundColor,
  resolveStrokeColor,
} from '../utils/canvasRenderer';
import {
  createIncrementalPenState,
  drawPenLiveStep,
  drawPenStartDot,
  type IncrementalPenState,
} from '../utils/penEngine';
import { extractImageFilesFromTransfer } from '../utils/imageImport';
import {
  applyTransformToPageSnapshot,
  computeLassoSelectionBounds,
  drawLassoPath,
  getLassoItemCount,
  IDENTITY_LASSO_TRANSFORM,
  renderSelectedItemsPreview,
  selectPageItemAtPoint,
  selectPageItemsInLasso,
  transformBounds,
  type LassoBounds,
  type LassoPoint,
  type LassoSelection,
  type LassoTransform,
} from '../utils/lasso';
import { extractPdfFilesFromTransfer } from '../utils/pageImport';
import { generateId } from '../utils/storage';
import { optimizeStroke } from '../utils/strokeCodec';
import {
  StrokeStabilizer,
  type StabilizationLevel,
} from '../utils/strokeStabilizer';
import {
  projectClientPointToRulerLock,
  type RulerDrawAdapter,
  type RulerStrokeLock,
} from '../utils/ruler';
import {
  CanvasLassoOverlay,
  type LassoResizeCorner,
} from './CanvasLassoOverlay';
import {
  CanvasOcclusionOverlay,
  type OcclusionDisplayMode,
} from './CanvasOcclusionOverlay';
import { CanvasTextOverlay } from './CanvasTextOverlay';
import {
  IconBringFront,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconPlus,
  IconRuler,
  IconSendBack,
  IconTrash,
} from './Icons';

export interface EditingTextState {
  pageId: string;
  item: CanvasTextItem;
}

export interface SelectedImageState {
  pageId: string;
  imageId: string;
}

export interface SelectedOcclusionState {
  pageId: string;
  occlusionId: string;
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

// Shared across all page sheets and DrawingCanvas so moving Apple Pencil between pages
// keeps automatic palm rejection active and blocks 2-finger scroll/pinch while actively writing
let lastGlobalPenTimestamp = 0;
const activePenPageIds = new Set<string>();

export function getLastGlobalPenTimestamp(): number {
  return lastGlobalPenTimestamp;
}

export function markGlobalPenActivity(): void {
  lastGlobalPenTimestamp = Date.now();
}

export function isAnyPenStrokeActive(): boolean {
  return activePenPageIds.size > 0;
}

interface CanvasPageSheetProps {
  store: NotesStore;
  pageId: string;
  pageNumber: number;
  totalPages: number;
  cssScale: number;
  tool: DrawingTool;
  penStyle: PenStyle;
  fountainNibAngle: number;
  fountainFlatness: number;
  brushDynamics: number;
  penColor: string;
  highlighterColor: string;
  penWidth: number;
  shapeWidth: number;
  highlighterWidth: number;
  eraserSize: number;
  textFontSize: number;
  textFontFamily: CanvasFontFamily;
  textBold: boolean;
  stylusOnly: boolean;
  stabilization: StabilizationLevel;
  pressureSensitivity: boolean;
  palmRadiusLimit: number;
  showSheetHeader: boolean;
  editingText: EditingTextState | null;
  selectedImage: SelectedImageState | null;
  lassoSelection: LassoSelection | null;
  occlusionDisplayMode: OcclusionDisplayMode;
  selectedOcclusion: SelectedOcclusionState | null;
  revealedOcclusionIds: ReadonlySet<string>;
  onSetSelectedOcclusion: (next: SelectedOcclusionState | null) => void;
  onToggleRevealOcclusion: (id: string) => void;
  onPointerTypeChange: (type: string) => void;
  onPenPointerDown: () => void;
  onSetEditingText: (next: EditingTextState | null) => void;
  onCommitEditingText: () => void;
  onExitScribble: () => void;
  onSetSelectedImage: (next: SelectedImageState | null) => void;
  onSetLassoSelection: (next: LassoSelection | null) => void;
  onCopyLasso: () => void;
  onCutLasso: () => void;
  onDuplicateLasso: () => void;
  onRecolorLasso: (color: string) => void;
  onDeleteLasso: () => void;
  onSyncTextStyle: (patch: {
    fontSize?: number;
    fontFamily?: CanvasFontFamily;
    bold?: boolean;
  }) => void;
  onOpenSizeMenu: (pageId: string) => void;
  onImportFilesAt: (
    pageId: string,
    files: File[],
    dropPt?: { x: number; y: number }
  ) => void;
  onImportPagesFiles: (files: File[]) => void;
  registerElement: (pageId: string, el: HTMLDivElement | null) => void;
  registerTouchAbort: (pageId: string, fn: (() => void) | null) => void;
  rulerAdapter?: RulerDrawAdapter;
}

export function CanvasPageSheet(props: CanvasPageSheetProps) {
  const [hoveredTextId, setHoveredTextId] = createSignal<string | null>(null);
  const [isSheetDragOver, setIsSheetDragOver] = createSignal<boolean>(false);
  const [lassoTransform, setLassoTransform] = createSignal<LassoTransform | null>(null);
  const isLassoTransforming = createMemo(() => lassoTransform() !== null);

  let baseCanvasRef: HTMLCanvasElement | undefined;
  let liveCanvasRef: HTMLCanvasElement | undefined;
  let liveCtxCache: CanvasRenderingContext2D | null = null;
  let textInputRef: HTMLTextAreaElement | undefined;

  // Imperative 120Hz drawing state local to this page sheet
  let activePointerId: number | null = null;
  let activePointerType: string | null = null;
  let activeStrokeStartTime = 0;
  let lastPointerEventWallTime = 0;
  let activeStroke: Stroke | null = null;
  let activeStabilizer: StrokeStabilizer | null = null;
  let activeRulerLock: RulerStrokeLock | null = null;
  let rulerMinAlong = 0;
  let rulerMaxAlong = 0;
  let rulerScaleCssPerLogical = 1;

  // Freehand lasso loop state
  let isLassoDrawing = false;
  let lassoPoints: LassoPoint[] = [];
  let hadLassoSelectionAtDown = false;

  // Live drag-to-draw occlusion mask state
  let occlusionDraft: {
    startX: number;
    startY: number;
    currX: number;
    currY: number;
    hadSelectedBefore: boolean;
  } | null = null;
  let lassoTransformState: {
    mode: 'move' | LassoResizeCorner;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origBounds: LassoBounds;
    selection: LassoSelection;
    changed: boolean;
  } | null = null;

  // Incremental pen rendering state (O(1) per pointermove on liveCanvas!)
  let penLiveState: IncrementalPenState = createIncrementalPenState();
  let strokeStartEventTime = 0;
  let pendingLiveClearAfterBaseRender = false;

  let isErasing = false;
  let erasingStrokes: Stroke[] | null = null;
  let erasingTexts: CanvasTextItem[] | null = null;
  let erasedSomething = false;
  let eraserCursor: { x: number; y: number } | null = null;
  let lastMoveTime = 0;
  let lastPoint: StrokePoint | null = null;
  let baseRafId: number | null = null;
  let liveRafId: number | null = null;

  let textDragState: {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null = null;

  let opacityBeforeSnapshot: CanvasSnapshot | null = null;
  let imageTransformState: {
    mode: 'move' | ResizeCorner;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    orig: CanvasImageItem;
    previousSnapshot: CanvasSnapshot;
    changed: boolean;
  } | null = null;

  const page = createMemo<CanvasPage | undefined>(() =>
    props.store.activeNote()?.pages.find((p) => p.id === props.pageId)
  );

  const isActivePage = createMemo(
    () => props.store.activePage()?.id === props.pageId
  );

  const localEditingText = createMemo<CanvasTextItem | null>(() => {
    const ed = props.editingText;
    return ed && ed.pageId === props.pageId ? ed.item : null;
  });

  const localSelectedImage = createMemo<CanvasImageItem | undefined>(() => {
    const sel = props.selectedImage;
    if (!sel || sel.pageId !== props.pageId) return undefined;
    return page()?.images.find((img) => img.id === sel.imageId);
  });

  const localLassoSelection = createMemo<LassoSelection | null>(() => {
    const sel = props.lassoSelection;
    const p = page();
    if (!sel || !p || sel.pageId !== props.pageId) return null;
    const strokeIds = sel.strokeIds.filter((id) => p.strokes.some((s) => s.id === id));
    const textIds = sel.textIds.filter((id) => p.texts.some((t) => t.id === id));
    const imageIds = sel.imageIds.filter((id) => p.images.some((img) => img.id === id));
    if (strokeIds.length === 0 && textIds.length === 0 && imageIds.length === 0) return null;
    return { pageId: sel.pageId, strokeIds, textIds, imageIds };
  });

  const localLassoBounds = createMemo<LassoBounds | null>(() => {
    const sel = localLassoSelection();
    const p = page();
    if (!sel || !p) return null;
    void p.strokes;
    void p.texts;
    void p.images;
    const ctx = baseCanvasRef?.getContext('2d') ?? null;
    return computeLassoSelectionBounds(p, sel, ctx);
  });

  const displayedLassoBounds = createMemo<LassoBounds | null>(() => {
    const b = localLassoBounds();
    if (!b) return null;
    const t = lassoTransform();
    return t ? transformBounds(b, t) : b;
  });

  const cssSize = createMemo(() => {
    const p = page();
    const scale = props.cssScale;
    const width = Math.max(120, Math.round((p?.width ?? 794) * scale));
    const height = Math.max(120, Math.round((p?.height ?? 1123) * scale));
    return { width, height, scale: width / Math.max(1, p?.width ?? 794) };
  });

  const resolvedPaperBg = createMemo(() => {
    const p = page();
    if (!p) return '#fcf9f2';
    return resolvePaperBackgroundColor(p.paperConfig, props.store.theme());
  });

  const getBackingStoreSize = () => {
    const { width, height } = cssSize();
    // Cap DPR & max pixel dimension to stay well within iPadOS Safari GPU canvas limits
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxEdge = 2800;
    const rawW = Math.max(1, Math.round(width * dpr));
    const rawH = Math.max(1, Math.round(height * dpr));
    const downscale = Math.min(1, maxEdge / Math.max(rawW, rawH));
    return {
      targetW: Math.max(1, Math.round(rawW * downscale)),
      targetH: Math.max(1, Math.round(rawH * downscale)),
    };
  };

  const getLiveCtx = (): CanvasRenderingContext2D | null => {
    if (!liveCanvasRef) return null;
    if (!liveCtxCache || liveCtxCache.canvas !== liveCanvasRef) {
      // Standard 2D context avoids WebKit/iPadOS desynchronized overlay compositor stalls
      liveCtxCache = liveCanvasRef.getContext('2d');
    }
    return liveCtxCache;
  };

  const syncCanvasSizes = () => {
    const { targetW, targetH } = getBackingStoreSize();
    if (baseCanvasRef && (baseCanvasRef.width !== targetW || baseCanvasRef.height !== targetH)) {
      baseCanvasRef.width = targetW;
      baseCanvasRef.height = targetH;
    }
    if (liveCanvasRef && (liveCanvasRef.width !== targetW || liveCanvasRef.height !== targetH)) {
      liveCanvasRef.width = targetW;
      liveCanvasRef.height = targetH;
      penLiveState = createIncrementalPenState();
    }
    return { targetW, targetH };
  };

  const clearLiveCanvas = () => {
    if (!liveCanvasRef) return;
    const ctx = getLiveCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, liveCanvasRef.width, liveCanvasRef.height);
    penLiveState = createIncrementalPenState();
  };

  // Layer 1: Static Base Canvas (ONLY redraws on committed changes, resize, theme, or eraser hit!)
  const renderBaseNow = () => {
    baseRafId = null;
    const canvas = baseCanvasRef;
    const p = page();
    if (!canvas || !p) return;

    const { targetW } = syncCanvasSizes();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderScale = targetW / p.width;
    const effectivePage =
      isErasing && erasingStrokes && erasingTexts
        ? { ...p, strokes: erasingStrokes, texts: erasingTexts }
        : p;

    const lassoSel = isLassoTransforming() ? localLassoSelection() : null;
    const hiddenIds = lassoSel
      ? {
          strokes: new Set(lassoSel.strokeIds),
          texts: new Set(lassoSel.textIds),
          images: new Set(lassoSel.imageIds),
        }
      : undefined;

    renderFullCanvas(ctx, effectivePage, null, props.store.theme(), renderScale, {
      editingTextId: localEditingText()?.id ?? null,
      hoveredTextId:
        props.tool === 'text' || props.tool === 'scribble' || props.tool === 'select'
          ? hoveredTextId()
          : null,
      onImageLoad: scheduleBaseRender,
      hiddenIds,
    });

    if (pendingLiveClearAfterBaseRender) {
      pendingLiveClearAfterBaseRender = false;
      if (!activeStroke && !isLassoDrawing && !lassoTransform()) {
        clearLiveCanvas();
      }
    }
  };

  const scheduleBaseRender = () => {
    if (baseRafId === null) {
      baseRafId = requestAnimationFrame(renderBaseNow);
    }
  };

  // Layer 2: Fast Live Ink Overlay Canvas (O(1) incremental pen drawing at 120Hz!)
  const renderLiveNow = () => {
    liveRafId = null;
    const live = liveCanvasRef;
    const p = page();
    if (!live || !p) return;

    const { targetW, targetH } = syncCanvasSizes();
    const ctx = getLiveCtx();
    if (!ctx) return;
    const renderScale = targetW / p.width;

    // Fast path: Incremental O(1) pen rendering (never clears or redraws prior segments!)
    if (activeStroke && activeStroke.tool === 'pen') {
      const pts = activeStroke.points;
      const color = resolveStrokeColor(
        activeStroke.color,
        p.paperConfig,
        props.store.theme()
      );

      if (penLiveState.drawnCount === 0 && pts.length > 0) {
        ctx.clearRect(0, 0, targetW, targetH);
        drawPenStartDot(ctx, activeStroke, pts[0], color, renderScale, penLiveState);
      }

      while (penLiveState.drawnCount < pts.length) {
        const prev = pts[penLiveState.drawnCount - 1];
        const curr = pts[penLiveState.drawnCount];
        drawPenLiveStep(ctx, activeStroke, prev, curr, color, renderScale, penLiveState);
      }
      return;
    }

    // Other live previews: Lasso loop, Lasso drag/resize preview, Highlighter, Shapes, or Eraser cursor ring
    ctx.clearRect(0, 0, targetW, targetH);

    if (isLassoDrawing && lassoPoints.length >= 2) {
      const dark = isPaperDark(p.paperConfig, props.store.theme());
      ctx.save();
      ctx.scale(renderScale, renderScale);
      drawLassoPath(ctx, lassoPoints, 1 / Math.max(0.45, cssSize().scale), dark);
      ctx.restore();
      return;
    }

    if (occlusionDraft) {
      const rx = Math.min(occlusionDraft.startX, occlusionDraft.currX);
      const ry = Math.min(occlusionDraft.startY, occlusionDraft.currY);
      const rw = Math.abs(occlusionDraft.currX - occlusionDraft.startX);
      const rh = Math.abs(occlusionDraft.currY - occlusionDraft.startY);
      ctx.save();
      ctx.scale(renderScale, renderScale);
      ctx.fillStyle = 'rgba(79, 70, 229, 0.24)';
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 2 / Math.max(0.45, cssSize().scale);
      ctx.setLineDash([6 / Math.max(0.45, cssSize().scale), 4 / Math.max(0.45, cssSize().scale)]);
      ctx.beginPath();
      ctx.roundRect(rx, ry, Math.max(2, rw), Math.max(2, rh), 6);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }

    const activeLassoT = lassoTransform();
    const activeLassoSel = localLassoSelection();
    if (activeLassoT && activeLassoSel) {
      ctx.save();
      ctx.scale(renderScale, renderScale);
      renderSelectedItemsPreview(ctx, p, activeLassoSel, activeLassoT, props.store.theme());
      ctx.restore();
      return;
    }

    if (activeStroke) {
      ctx.save();
      ctx.scale(renderScale, renderScale);
      drawStroke(ctx, activeStroke, p.paperConfig, props.store.theme());
      ctx.restore();
      return;
    }

    if (eraserCursor && (props.tool === 'eraser' || isErasing)) {
      const dark = isPaperDark(p.paperConfig, props.store.theme());
      ctx.save();
      ctx.scale(renderScale, renderScale);
      ctx.beginPath();
      ctx.arc(eraserCursor.x, eraserCursor.y, props.eraserSize, 0, Math.PI * 2);
      ctx.strokeStyle = dark
        ? 'rgba(248, 250, 252, 0.72)'
        : 'rgba(15, 23, 42, 0.55)';
      ctx.fillStyle = dark
        ? 'rgba(248, 250, 252, 0.08)'
        : 'rgba(15, 23, 42, 0.06)';
      ctx.lineWidth = 1.5;
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
    const p = page();
    void p?.width;
    void p?.height;
    void p?.strokes;
    void p?.texts;
    void p?.images;
    void p?.paperConfig;
    void p?.backgroundImage;
    void props.store.theme();
    void cssSize();
    void localEditingText()?.id;
    void hoveredTextId();
    void props.tool;
    void isLassoTransforming();
    void localLassoSelection();
    scheduleBaseRender();
  });

  // Window-level pointerup/pointercancel safety net + touch-abort registration for 2-finger gestures
  onMount(() => {
    const handleWindowPointerEnd = (e: PointerEvent) => {
      if (activePointerId !== null && activePointerId === e.pointerId) {
        finishPointerInteraction(e, e.type === 'pointercancel');
      }
    };

    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);

    props.registerTouchAbort(props.pageId, () => {
      if (activePointerId !== null && activePointerType === 'touch') {
        abortCurrentInteraction();
      }
    });

    onCleanup(() => {
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
      props.registerTouchAbort(props.pageId, null);
    });
  });

  onCleanup(() => {
    if (baseRafId !== null) cancelAnimationFrame(baseRafId);
    if (liveRafId !== null) cancelAnimationFrame(liveRafId);
    activePenPageIds.delete(props.pageId);
    props.registerElement(props.pageId, null);
  });

  const toLogicalPoint = (
    e: PointerEvent,
    explicitPointerType?: string,
    explicitTimeMs?: number,
    overrideClient?: { clientX: number; clientY: number }
  ): StrokePoint => {
    const canvas = liveCanvasRef!;
    const p = page()!;
    const rect = canvas.getBoundingClientRect();
    const safeW = Math.max(1, rect.width);
    const safeH = Math.max(1, rect.height);
    const clientX = overrideClient ? overrideClient.clientX : e.clientX;
    const clientY = overrideClient ? overrideClient.clientY : e.clientY;
    const x = ((clientX - rect.left) / safeW) * p.width;
    const y = ((clientY - rect.top) / safeH) * p.height;

    const evTime = explicitTimeMs ?? (e.timeStamp || performance.now());
    const relTime =
      strokeStartEventTime > 0 ? Math.max(0, Math.round(evTime - strokeStartEventTime)) : 0;

    const pType = explicitPointerType || e.pointerType;
    let pressure = 0.55;
    if (props.pressureSensitivity) {
      pressure = lastPoint?.pressure ?? 0.5;
      if (pType === 'pen') {
        // Ignore occasional 0-pressure glitches from iPad coalesced events while preserving light brush hairlines
        const raw =
          e.pressure > 0.005 ? Math.min(1, Math.max(0.05, e.pressure)) : pressure;
        const smooth = activeStabilizer?.pressureSmoothing ?? 0.55;
        pressure = lastPoint ? lastPoint.pressure * smooth + raw * (1 - smooth) : raw;
      } else if (lastPoint && lastMoveTime > 0) {
        const dt = Math.max(1, evTime - lastMoveTime);
        const dist = Math.hypot(x - lastPoint.x, y - lastPoint.y);
        const velocity = dist / dt;
        const isBrush = props.tool === 'pen' && props.penStyle === 'brush';
        const target = isBrush
          ? Math.max(0.12, Math.min(0.92, 0.86 - velocity * 0.42))
          : Math.max(0.28, Math.min(0.88, 0.78 - velocity * 0.28));
        pressure = lastPoint.pressure * 0.65 + target * 0.35;
      }
    }

    return { x, y, pressure, t: relTime };
  };

  const findTextAtPoint = (pt: Pick<StrokePoint, 'x' | 'y'>): CanvasTextItem | null => {
    const p = page();
    const ctx = baseCanvasRef?.getContext('2d');
    if (!p || !ctx) return null;
    for (let i = p.texts.length - 1; i >= 0; i--) {
      if (isPointHittingText(ctx, pt, p.texts[i], 10)) {
        return p.texts[i];
      }
    }
    return null;
  };

  const findImageAtPoint = (pt: Pick<StrokePoint, 'x' | 'y'>): CanvasImageItem | null => {
    const p = page();
    if (!p) return null;
    for (let i = p.images.length - 1; i >= 0; i--) {
      if (isPointHittingImage(pt, p.images[i])) {
        return p.images[i];
      }
    }
    return null;
  };

  const eraseAtPoint = (pt: StrokePoint): boolean => {
    if (!erasingStrokes || !erasingTexts) return false;
    let changedNow = false;
    const radius = props.eraserSize;
    const beforeStrokes = erasingStrokes.length;
    erasingStrokes = erasingStrokes.filter(
      (stroke) => !isPointHittingStroke(pt, stroke, radius)
    );
    if (erasingStrokes.length !== beforeStrokes) {
      erasedSomething = true;
      changedNow = true;
    }

    const ctx = baseCanvasRef?.getContext('2d');
    if (ctx) {
      const beforeTexts = erasingTexts.length;
      erasingTexts = erasingTexts.filter(
        (item) => !isPointHittingText(ctx, pt, item, radius * 0.65)
      );
      if (erasingTexts.length !== beforeTexts) {
        erasedSomething = true;
        changedNow = true;
      }
    }
    return changedNow;
  };

  const abortCurrentInteraction = () => {
    if (activePointerId !== null && liveCanvasRef?.hasPointerCapture(activePointerId)) {
      try {
        liveCanvasRef.releasePointerCapture(activePointerId);
      } catch {
        // ignore
      }
    }
    activePenPageIds.delete(props.pageId);
    activePointerId = null;
    activePointerType = null;
    activeStroke = null;
    activeStabilizer = null;
    if (activeRulerLock) {
      activeRulerLock = null;
      props.rulerAdapter?.releaseLock();
    }
    isLassoDrawing = false;
    lassoPoints = [];
    hadLassoSelectionAtDown = false;
    occlusionDraft = null;
    isErasing = false;
    erasingStrokes = null;
    erasingTexts = null;
    erasedSomething = false;
    lastPoint = null;
    clearLiveCanvas();
  };

  const finalizeCurrentInteraction = (cancelled = false, isTouch = false) => {
    const pointerIdToRelease = activePointerId;
    if (pointerIdToRelease !== null && liveCanvasRef?.hasPointerCapture(pointerIdToRelease)) {
      try {
        liveCanvasRef.releasePointerCapture(pointerIdToRelease);
      } catch {
        // ignore
      }
    }
    const wasPen = activePointerType === 'pen';
    activePenPageIds.delete(props.pageId);
    activePointerId = null;
    activePointerType = null;
    lastPoint = null;
    if (activeRulerLock) {
      activeRulerLock = null;
      props.rulerAdapter?.releaseLock();
    }

    if (occlusionDraft) {
      const draft = occlusionDraft;
      occlusionDraft = null;
      clearLiveCanvas();
      const p = page();
      const shouldDiscard = cancelled && !wasPen;
      if (!shouldDiscard && p) {
        const rawW = Math.abs(draft.currX - draft.startX);
        const rawH = Math.abs(draft.currY - draft.startY);
        if (rawW < 14 && rawH < 14) {
          // Short tap on empty space: deselect if one was selected, otherwise place a handy default mask
          if (draft.hadSelectedBefore) {
            props.onSetSelectedOcclusion(null);
          } else {
            const defW = Math.min(160, p.width - 24);
            const defH = 44;
            const x = Math.max(8, Math.min(p.width - defW - 8, Math.round(draft.startX - defW / 2)));
            const y = Math.max(8, Math.min(p.height - defH - 8, Math.round(draft.startY - defH / 2)));
            const created: CanvasOcclusionItem = {
              id: generateId(),
              x,
              y,
              width: defW,
              height: defH,
              color: OCCLUSION_COLORS[0],
            };
            props.store.addCanvasOcclusion(created, props.pageId);
            props.onSetSelectedOcclusion({ pageId: props.pageId, occlusionId: created.id });
          }
        } else {
          const w = Math.max(24, Math.min(p.width, Math.round(rawW)));
          const h = Math.max(24, Math.min(p.height, Math.round(rawH)));
          const x = Math.max(0, Math.min(p.width - w, Math.round(Math.min(draft.startX, draft.currX))));
          const y = Math.max(0, Math.min(p.height - h, Math.round(Math.min(draft.startY, draft.currY))));
          const created: CanvasOcclusionItem = {
            id: generateId(),
            x,
            y,
            width: w,
            height: h,
            color: OCCLUSION_COLORS[0],
          };
          props.store.addCanvasOcclusion(created, props.pageId);
          props.onSetSelectedOcclusion({ pageId: props.pageId, occlusionId: created.id });
        }
      }
      return;
    }

    if (isLassoDrawing) {
      const pts = lassoPoints;
      const hadSelectionBefore = hadLassoSelectionAtDown;
      isLassoDrawing = false;
      lassoPoints = [];
      hadLassoSelectionAtDown = false;
      clearLiveCanvas();

      const p = page();
      const shouldDiscard = cancelled && !wasPen;
      if (!shouldDiscard && p && pts.length > 0) {
        let totalLen = 0;
        for (let i = 1; i < pts.length; i++) {
          totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        const ctx = baseCanvasRef?.getContext('2d') ?? null;
        if (totalLen < 14) {
          // Short tap: dismiss existing selection, or tap-to-select a single object if none was active
          if (hadSelectionBefore) {
            props.onSetLassoSelection(null);
          } else {
            const hit = selectPageItemAtPoint(
              p,
              pts[0],
              ctx,
              10 / Math.max(0.45, cssSize().scale)
            );
            props.onSetLassoSelection(hit);
          }
        } else {
          const selected = selectPageItemsInLasso(p, pts, ctx);
          props.onSetLassoSelection(selected);
        }
      }
      return;
    }

    if (isErasing) {
      const p = page();
      if (erasedSomething && erasingStrokes && erasingTexts && p) {
        props.store.commitCanvasSnapshot(
          {
            strokes: erasingStrokes,
            texts: erasingTexts,
            images: p.images,
          },
          undefined,
          props.pageId
        );
      }
      isErasing = false;
      erasingStrokes = null;
      erasingTexts = null;
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

      // On iPadOS Safari, if a genuine pen stroke gets pointercancel after already drawing points,
      // preserve it instead of losing the user's writing! Discard only cancelled accidental touch touches.
      const shouldDiscard = cancelled && !wasPen;
      const isShape =
        finished.tool !== 'pen' && finished.tool !== 'highlighter';

      if (!shouldDiscard && (!isShape || finished.points.length >= 2)) {
        if (stabilizer && (finished.tool === 'pen' || finished.tool === 'highlighter')) {
          finished.points = stabilizer.finalize(finished.points);
        }
        const compacted = optimizeStroke(finished);
        pendingLiveClearAfterBaseRender = true;
        props.store.addStroke(compacted, props.pageId);
      } else {
        clearLiveCanvas();
      }
    } else {
      activeStabilizer = null;
    }
  };

  const openTextEditorAt = (
    pt: StrokePoint,
    onlyExisting = false,
    asScribble = false
  ) => {
    const p = page();
    if (!p) return false;

    if (props.editingText) {
      props.onCommitEditingText();
    }

    const hit = findTextAtPoint(pt);
    if (hit) {
      props.onSetSelectedImage(null);
      const nextItem: CanvasTextItem =
        asScribble && !hit.maxWidth
          ? {
              ...hit,
              maxWidth: Math.max(240, Math.round(p.width - hit.x - 36)),
            }
          : { ...hit };
      props.onSetEditingText({ pageId: props.pageId, item: nextItem });
      props.onSyncTextStyle({
        fontSize: hit.fontSize,
        fontFamily: hit.fontFamily,
        bold: hit.bold,
      });
      requestAnimationFrame(() => textInputRef?.focus());
      return true;
    }

    if (onlyExisting) return false;

    const minX = p.paperConfig.showMargin ? 92 : 36;
    const clampedX = asScribble
      ? Math.max(minX, Math.min(Math.max(minX, p.width - 280), Math.round(pt.x)))
      : Math.max(16, Math.min(p.width - 140, pt.x));
    const clampedY = Math.max(
      16,
      Math.min(p.height - (asScribble ? 120 : 50), pt.y - props.textFontSize * 0.5)
    );
    const scribbleWidth = asScribble
      ? Math.max(240, Math.round(p.width - clampedX - 36))
      : undefined;

    props.onSetSelectedImage(null);
    props.onSetEditingText({
      pageId: props.pageId,
      item: {
        id: generateId(),
        x: clampedX,
        y: clampedY,
        text: '',
        color: props.penColor,
        fontSize: props.textFontSize,
        fontFamily: props.textFontFamily,
        bold: props.textBold,
        ...(scribbleWidth ? { maxWidth: scribbleWidth } : {}),
      },
    });
    requestAnimationFrame(() => textInputRef?.focus());
    return true;
  };

  const handlePointerDown = (e: PointerEvent) => {
    const p = page();
    if (!p || !liveCanvasRef) return;

    const isStylusEraser =
      e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const now = Date.now();

    // Record Apple Pencil / stylus activity for automatic palm rejection
    if (e.pointerType === 'pen') {
      lastGlobalPenTimestamp = now;
      props.onPenPointerDown();
    }

    // Palm Rejection for touch pointers on drawing tools:
    if (
      e.pointerType === 'touch' &&
      props.tool !== 'select' &&
      props.tool !== 'text' &&
      props.tool !== 'scribble'
    ) {
      const isLargePalm =
        e.width > props.palmRadiusLimit || e.height > props.palmRadiusLimit;
      const penRecentlyActive = now - lastGlobalPenTimestamp < 1200;
      if (props.stylusOnly || penRecentlyActive || isLargePalm || activePointerType === 'pen') {
        e.preventDefault();
        return;
      }
    }

    // Self-healing pointer recovery (fixes iPadOS Safari bug where a dropped pointerup
    // could leave activePointerId stuck and make writing randomly stop):
    if (activePointerId !== null) {
      if (e.pointerType === 'pen') {
        if (activePointerType === 'touch') {
          // Preempt stray palm touch immediately (< 450ms discard, otherwise commit cleanly)
          if (now - activeStrokeStartTime < 450) {
            abortCurrentInteraction();
          } else {
            finalizeCurrentInteraction(false, true);
          }
        } else {
          // Only one physical stylus can be down at once — previous pen stroke lost its pointerup;
          // commit it cleanly so the new stroke is NEVER blocked!
          finalizeCurrentInteraction(false, false);
        }
      } else if (now - lastPointerEventWallTime > 1200) {
        // Recover from any orphaned touch/mouse pointer that never received pointerup
        finalizeCurrentInteraction(false, activePointerType === 'touch');
      } else {
        return;
      }
    }

    if (!isActivePage()) {
      props.store.setActivePage(props.pageId);
    }

    if (props.tool === 'select' && !isStylusEraser) {
      e.preventDefault();
      props.onPointerTypeChange(e.pointerType);
      const pt = toLogicalPoint(e);

      const hitText = findTextAtPoint(pt);
      if (hitText) {
        openTextEditorAt(pt, true);
        return;
      }

      if (props.editingText) props.onCommitEditingText();

      const hitImg = findImageAtPoint(pt);
      if (hitImg) {
        props.onSetSelectedImage({ pageId: props.pageId, imageId: hitImg.id });
      } else {
        props.onSetSelectedImage(null);
      }
      return;
    }

    if ((props.tool === 'text' || props.tool === 'scribble') && !isStylusEraser) {
      e.preventDefault();
      props.onPointerTypeChange(e.pointerType);
      const pt = toLogicalPoint(e);
      openTextEditorAt(pt, false, props.tool === 'scribble');
      return;
    }

    if (props.editingText) props.onCommitEditingText();
    if (props.selectedImage) props.onSetSelectedImage(null);
    const hadSelectedOccAtDown = Boolean(props.selectedOcclusion);
    if (props.selectedOcclusion) props.onSetSelectedOcclusion(null);
    hadLassoSelectionAtDown = Boolean(props.lassoSelection);
    if (props.lassoSelection) props.onSetLassoSelection(null);

    e.preventDefault();
    props.onPointerTypeChange(e.pointerType);
    activePointerId = e.pointerId;
    activePointerType = e.pointerType;
    activeStrokeStartTime = now;
    lastPointerEventWallTime = now;
    if (e.pointerType === 'pen') {
      activePenPageIds.add(props.pageId);
    }
    try {
      liveCanvasRef.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture fails on synthetic events
    }

    lastPoint = null;
    const startEvTime = e.timeStamp || performance.now();
    strokeStartEventTime = startEvTime;
    lastMoveTime = startEvTime;

    const currentTool = isStylusEraser ? 'eraser' : props.tool;
    const isHighlighter = currentTool === 'highlighter';
    const isPen = currentTool === 'pen';
    const isRulerGuideable = isPen || isHighlighter;

    let startOverrideClient: { clientX: number; clientY: number } | undefined;
    activeRulerLock = null;
    if (isRulerGuideable && props.rulerAdapter) {
      const rect = liveCanvasRef.getBoundingClientRect();
      rulerScaleCssPerLogical = Math.max(0.1, rect.width / Math.max(1, p.width));
      const strokeWidthCss =
        (isHighlighter ? props.highlighterWidth : props.penWidth) * rulerScaleCssPerLogical;
      const lock = props.rulerAdapter.acquireLock(e.clientX, e.clientY, strokeWidthCss);
      if (lock) {
        activeRulerLock = lock;
        const proj = projectClientPointToRulerLock(e.clientX, e.clientY, lock);
        startOverrideClient = { clientX: proj.clientX, clientY: proj.clientY };
        rulerMinAlong = proj.alongPx;
        rulerMaxAlong = proj.alongPx;
        props.rulerAdapter.updateActiveLength(lock.side, 0);
      }
    }

    const useStabilizer = (isPen || isHighlighter) && !activeRulerLock;
    activeStabilizer = useStabilizer
      ? new StrokeStabilizer(isHighlighter ? 'light' : props.stabilization)
      : null;

    const rawPt = toLogicalPoint(e, e.pointerType, startEvTime, startOverrideClient);
    const pt = activeStabilizer
      ? activeStabilizer.filter(rawPt, startEvTime)
      : rawPt;
    lastPoint = pt;

    if (currentTool === 'occlusion') {
      occlusionDraft = {
        startX: rawPt.x,
        startY: rawPt.y,
        currX: rawPt.x,
        currY: rawPt.y,
        hadSelectedBefore: hadSelectedOccAtDown,
      };
      scheduleLiveRender();
      return;
    }

    if (currentTool === 'lasso') {
      isLassoDrawing = true;
      lassoPoints = [{ x: rawPt.x, y: rawPt.y }];
      scheduleLiveRender();
      return;
    }

    if (currentTool === 'eraser') {
      isErasing = true;
      erasedSomething = false;
      erasingStrokes = [...p.strokes];
      erasingTexts = [...p.texts];
      eraserCursor = { x: pt.x, y: pt.y };
      if (eraseAtPoint(pt)) {
        scheduleBaseRender();
      }
      scheduleLiveRender();
      return;
    }

    if (currentTool === 'text' || currentTool === 'scribble' || currentTool === 'select') return;

    penLiveState = createIncrementalPenState();
    pendingLiveClearAfterBaseRender = false;
    activeStroke = {
      id: generateId(),
      tool: currentTool,
      ...(isPen
        ? {
            penStyle: props.penStyle,
            ...(props.penStyle === 'fountain'
              ? {
                  nibAngle: props.fountainNibAngle,
                  nibFlatness: props.fountainFlatness,
                }
              : {}),
            ...(props.penStyle === 'brush'
              ? {
                  brushDynamics: props.brushDynamics,
                }
              : {}),
          }
        : {}),
      color: isHighlighter ? props.highlighterColor : props.penColor,
      width: isHighlighter
        ? props.highlighterWidth
        : isPen
          ? props.penWidth
          : props.shapeWidth,
      opacity: isHighlighter ? 0.38 : 1,
      points: [pt],
    };
    scheduleLiveRender();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!liveCanvasRef || !page()) return;

    if (e.pointerType === 'pen') {
      lastGlobalPenTimestamp = Date.now();
    }

    if (activePointerId === null) {
      if (props.tool === 'eraser' && e.pointerType !== 'touch') {
        const pt = toLogicalPoint(e, e.pointerType);
        eraserCursor = { x: pt.x, y: pt.y };
        scheduleLiveRender();
      } else if (
        (props.tool === 'text' || props.tool === 'scribble' || props.tool === 'select') &&
        e.pointerType !== 'touch'
      ) {
        const pt = toLogicalPoint(e, e.pointerType);
        const hit = findTextAtPoint(pt);
        setHoveredTextId(hit?.id ?? null);
      }
      return;
    }

    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    lastPointerEventWallTime = Date.now();

    const parentPointerType = activePointerType || e.pointerType;
    const rawCoalesced =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const sourceEvents = rawCoalesced.length > 0 ? rawCoalesced : [e];

    let erasedNow = false;

    for (const ev of sourceEvents) {
      if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) continue;
      // Guard against occasional WebKit coalesced (0, 0) glitch events
      if (
        ev !== e &&
        ev.clientX === 0 &&
        ev.clientY === 0 &&
        Math.hypot(e.clientX, e.clientY) > 12
      ) {
        continue;
      }

      const evTime = ev.timeStamp || e.timeStamp || performance.now();
      let overrideClient: { clientX: number; clientY: number } | undefined;
      if (activeRulerLock) {
        const proj = projectClientPointToRulerLock(ev.clientX, ev.clientY, activeRulerLock);
        overrideClient = { clientX: proj.clientX, clientY: proj.clientY };
        if (proj.alongPx < rulerMinAlong) rulerMinAlong = proj.alongPx;
        if (proj.alongPx > rulerMaxAlong) rulerMaxAlong = proj.alongPx;
        props.rulerAdapter?.updateActiveLength(
          activeRulerLock.side,
          (rulerMaxAlong - rulerMinAlong) / rulerScaleCssPerLogical
        );
      }
      const rawPt = toLogicalPoint(ev, parentPointerType, evTime, overrideClient);
      lastMoveTime = evTime;

      if (occlusionDraft) {
        occlusionDraft.currX = rawPt.x;
        occlusionDraft.currY = rawPt.y;
        lastPoint = rawPt;
        continue;
      }

      if (isLassoDrawing) {
        const minStep = 2.5 / Math.max(0.45, cssSize().scale);
        const prev = lassoPoints[lassoPoints.length - 1];
        if (!prev || Math.hypot(rawPt.x - prev.x, rawPt.y - prev.y) >= minStep) {
          lassoPoints.push({ x: rawPt.x, y: rawPt.y });
        }
        lastPoint = rawPt;
        continue;
      }

      if (isErasing) {
        eraserCursor = { x: rawPt.x, y: rawPt.y };
        if (eraseAtPoint(rawPt)) erasedNow = true;
        lastPoint = rawPt;
        continue;
      }

      if (!activeStroke) continue;

      if (activeStroke.tool === 'pen' || activeStroke.tool === 'highlighter') {
        const pt = activeStabilizer
          ? activeStabilizer.filter(rawPt, evTime)
          : rawPt;
        const minDist = activeStabilizer?.minSpacing ?? 1.1;
        if (
          !lastPoint ||
          Math.hypot(pt.x - lastPoint.x, pt.y - lastPoint.y) >= minDist
        ) {
          activeStroke.points.push(pt);
          lastPoint = pt;
        }
      } else {
        if (activeStroke.points.length === 1) {
          activeStroke.points.push(rawPt);
        } else {
          activeStroke.points[1] = rawPt;
        }
        lastPoint = rawPt;
      }
    }

    if (erasedNow) scheduleBaseRender();
    scheduleLiveRender();
  };

  const finishPointerInteraction = (e: PointerEvent, cancelled = false) => {
    if (activePointerId !== e.pointerId) return;

    if (e.pointerType === 'pen') {
      lastGlobalPenTimestamp = Date.now();
    }

    finalizeCurrentInteraction(cancelled, e.pointerType === 'touch');
  };

  const handleLostPointerCapture = (e: PointerEvent) => {
    if (activePointerId !== null && activePointerId === e.pointerId) {
      // Never leave activePointerId stuck if Safari silently releases capture
      finalizeCurrentInteraction(false, e.pointerType === 'touch');
    }
  };

  const handlePointerLeave = () => {
    if (activePointerId === null && eraserCursor) {
      eraserCursor = null;
      scheduleLiveRender();
    }
    if (hoveredTextId()) {
      setHoveredTextId(null);
    }
  };

  const startTextDrag = (e: PointerEvent) => {
    const ed = localEditingText();
    if (!ed) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    textDragState = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: ed.x,
      origY: ed.y,
    };
  };

  const moveTextDrag = (e: PointerEvent) => {
    if (!textDragState || e.pointerId !== textDragState.pointerId) return;
    const ed = localEditingText();
    const p = page();
    if (!ed || !p) return;
    const scale = cssSize().scale;
    const dx = (e.clientX - textDragState.startClientX) / scale;
    const dy = (e.clientY - textDragState.startClientY) / scale;
    props.onSetEditingText({
      pageId: props.pageId,
      item: {
        ...ed,
        x: Math.max(8, Math.min(p.width - 80, textDragState.origX + dx)),
        y: Math.max(8, Math.min(p.height - 40, textDragState.origY + dy)),
      },
    });
  };

  const endTextDrag = (e: PointerEvent) => {
    if (!textDragState || e.pointerId !== textDragState.pointerId) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    textDragState = null;
  };

  const startImageTransform = (mode: 'move' | ResizeCorner, e: PointerEvent) => {
    const img = localSelectedImage();
    const p = page();
    if (!img || !p) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    imageTransformState = {
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      orig: { ...img },
      previousSnapshot: {
        strokes: p.strokes,
        texts: p.texts,
        images: p.images.map((item) => ({ ...item })),
      },
      changed: false,
    };
  };

  const moveImageTransform = (e: PointerEvent) => {
    if (!imageTransformState || e.pointerId !== imageTransformState.pointerId) return;
    const p = page();
    if (!p) return;

    const scale = cssSize().scale;
    const dx = (e.clientX - imageTransformState.startClientX) / scale;
    const dy = (e.clientY - imageTransformState.startClientY) / scale;
    const orig = imageTransformState.orig;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    imageTransformState.changed = true;

    if (imageTransformState.mode === 'move') {
      const nextX = Math.max(-orig.width + 40, Math.min(p.width - 40, orig.x + dx));
      const nextY = Math.max(-orig.height + 40, Math.min(p.height - 40, orig.y + dy));
      props.store.updateCanvasImageLive(
        {
          ...orig,
          x: Math.round(nextX),
          y: Math.round(nextY),
        },
        props.pageId
      );
      return;
    }

    const aspect = orig.naturalWidth / Math.max(1, orig.naturalHeight);
    const minW = 48;
    const maxW = Math.max(200, p.width - 16);

    let rawW = orig.width;
    if (imageTransformState.mode === 'se' || imageTransformState.mode === 'ne') {
      rawW = orig.width + dx;
    } else {
      rawW = orig.width - dx;
    }

    const nextW = Math.max(minW, Math.min(maxW, rawW));
    const nextH = Math.max(36, nextW / aspect);

    let nextX = orig.x;
    let nextY = orig.y;
    if (imageTransformState.mode === 'nw' || imageTransformState.mode === 'sw') {
      nextX = orig.x + (orig.width - nextW);
    }
    if (imageTransformState.mode === 'nw' || imageTransformState.mode === 'ne') {
      nextY = orig.y + (orig.height - nextH);
    }

    props.store.updateCanvasImageLive(
      {
        ...orig,
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: Math.round(nextW),
        height: Math.round(nextH),
      },
      props.pageId
    );
  };

  const endImageTransform = (e: PointerEvent) => {
    if (!imageTransformState || e.pointerId !== imageTransformState.pointerId) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    const state = imageTransformState;
    imageTransformState = null;

    if (state.changed) {
      const latest = localSelectedImage();
      if (latest) {
        props.store.updateCanvasImage(latest, state.previousSnapshot, props.pageId);
      }
    }
  };

  // ==================== LASSO MOVE & PROPORTIONAL RESIZE (120Hz LIVE LAYER) ====================
  const startLassoTransform = (mode: 'move' | LassoResizeCorner, e: PointerEvent) => {
    const sel = localLassoSelection();
    const bounds = localLassoBounds();
    if (!sel || !bounds) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    if (!isActivePage()) props.store.setActivePage(props.pageId);

    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    lassoTransformState = {
      mode,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origBounds: { ...bounds },
      selection: sel,
      changed: false,
    };
    setLassoTransform({
      ...IDENTITY_LASSO_TRANSFORM,
      anchorX: bounds.x,
      anchorY: bounds.y,
    });
    scheduleLiveRender();
  };

  const moveLassoTransform = (e: PointerEvent) => {
    if (!lassoTransformState || e.pointerId !== lassoTransformState.pointerId) return;
    e.preventDefault();
    const scale = Math.max(0.2, cssSize().scale);
    const dx = (e.clientX - lassoTransformState.startClientX) / scale;
    const dy = (e.clientY - lassoTransformState.startClientY) / scale;

    if (!lassoTransformState.changed && Math.hypot(dx, dy) < 1.2) return;
    lassoTransformState.changed = true;

    const orig = lassoTransformState.origBounds;
    if (lassoTransformState.mode === 'move') {
      setLassoTransform({
        dx,
        dy,
        scale: 1,
        anchorX: orig.x,
        anchorY: orig.y,
      });
      scheduleLiveRender();
      return;
    }

    const mode = lassoTransformState.mode;
    const anchorX = mode === 'nw' || mode === 'sw' ? orig.x + orig.width : orig.x;
    const anchorY = mode === 'nw' || mode === 'ne' ? orig.y + orig.height : orig.y;
    const handleX = mode === 'nw' || mode === 'sw' ? orig.x : orig.x + orig.width;
    const handleY = mode === 'nw' || mode === 'ne' ? orig.y : orig.y + orig.height;

    const origVx = handleX - anchorX;
    const origVy = handleY - anchorY;
    const origLenSq = Math.max(1, origVx * origVx + origVy * origVy);
    const currVx = handleX + dx - anchorX;
    const currVy = handleY + dy - anchorY;
    const rawScale = (currVx * origVx + currVy * origVy) / origLenSq;
    const minScale = Math.max(0.15, 24 / Math.max(24, Math.max(orig.width, orig.height)));
    const nextScale = Math.max(minScale, Math.min(8, rawScale));

    setLassoTransform({
      dx: 0,
      dy: 0,
      scale: nextScale,
      anchorX,
      anchorY,
    });
    scheduleLiveRender();
  };

  const endLassoTransform = (e: PointerEvent) => {
    if (!lassoTransformState || e.pointerId !== lassoTransformState.pointerId) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      try {
        target.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const state = lassoTransformState;
    const finalTransform = lassoTransform();
    lassoTransformState = null;

    const p = page();
    if (state.changed && finalTransform && p) {
      const nextSnapshot = applyTransformToPageSnapshot(p, state.selection, finalTransform);
      pendingLiveClearAfterBaseRender = true;
      batch(() => {
        setLassoTransform(null);
        props.store.commitCanvasSnapshot(nextSnapshot, undefined, props.pageId);
      });
    } else {
      setLassoTransform(null);
      clearLiveCanvas();
    }
  };

  return (
    <Show when={page()}>
      {(currPage) => (
        <div
          ref={(el) => props.registerElement(props.pageId, el)}
          class="continuous-page-block"
          classList={{ 'is-active-page': isActivePage() }}
          data-page-id={props.pageId}
        >
          {/* Compact Page Header above each sheet */}
          <Show when={props.showSheetHeader}>
            <div
              class="sheet-header"
              style={{ width: `${cssSize().width}px` }}
              onPointerDown={() => {
                if (!isActivePage()) props.store.setActivePage(props.pageId);
              }}
            >
            <div class="sheet-header-left">
              <span class="sheet-index-pill">#{props.pageNumber}</span>
              <Show when={currPage().backgroundImage}>
                {(bg) => (
                  <span
                    class="sheet-source-badge"
                    classList={{ 'is-pdf': bg().sourceType === 'pdf' }}
                  >
                    {bg().sourceType === 'pdf' ? 'PDF' : 'Bild'}
                  </span>
                )}
              </Show>
              <span class="sheet-title">{currPage().title}</span>
            </div>

            <div class="sheet-header-right">
              <button
                type="button"
                class="sheet-dim-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.store.setActivePage(props.pageId);
                  props.onOpenSizeMenu(props.pageId);
                }}
                title="Breite & Höhe dieser Seite anpassen"
              >
                <IconRuler size={12} />
                <span>
                  {currPage().width} × {currPage().height}
                </span>
              </button>
              <button
                type="button"
                class="sheet-mini-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.store.extendCanvasHeight(400, props.pageId);
                }}
                title="Höhe dieser Seite erweitern (+400 px)"
              >
                <IconPlus size={12} />
                <span>H</span>
              </button>
              <Show when={props.totalPages > 1}>
                <button
                  type="button"
                  class="sheet-mini-btn"
                  disabled={props.pageNumber <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.store.movePage(props.pageId, -1);
                  }}
                  title="Seite nach oben verschieben"
                >
                  <IconChevronUp size={12} />
                </button>
                <button
                  type="button"
                  class="sheet-mini-btn"
                  disabled={props.pageNumber >= props.totalPages}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.store.movePage(props.pageId, 1);
                  }}
                  title="Seite nach unten verschieben"
                >
                  <IconChevronDown size={12} />
                </button>
              </Show>
              <button
                type="button"
                class="sheet-mini-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.store.duplicatePage(props.pageId);
                }}
                title="Seite duplizieren"
              >
                <IconCopy size={12} />
              </button>
              <Show when={props.totalPages > 1}>
                <button
                  type="button"
                  class="sheet-mini-btn is-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.store.deletePage(props.pageId);
                  }}
                  title="Seite löschen"
                >
                  <IconTrash size={12} />
                </button>
              </Show>
            </div>
          </div>
          </Show>

          {/* Dual-Layer Canvas Sheet (Base Static Layer + 120Hz Live Ink Overlay) */}
          <div
            class="canvas-sheet"
            classList={{
              'is-active-sheet': isActivePage(),
              'is-sheet-drop': isSheetDragOver(),
            }}
            style={{
              width: `${cssSize().width}px`,
              height: `${cssSize().height}px`,
              background: resolvedPaperBg(),
            }}
            onDragOver={(e) => {
              if (e.dataTransfer?.types.includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
                setIsSheetDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setIsSheetDragOver(false);
              }
            }}
            onDrop={(e) => {
              setIsSheetDragOver(false);
              const pdfFiles = extractPdfFilesFromTransfer(e.dataTransfer);
              if (pdfFiles.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                props.onImportPagesFiles(pdfFiles);
                return;
              }
              const files = extractImageFilesFromTransfer(e.dataTransfer);
              if (files.length === 0) return;
              e.preventDefault();
              e.stopPropagation();
              let dropPt: { x: number; y: number } | undefined;
              if (liveCanvasRef) {
                const rect = liveCanvasRef.getBoundingClientRect();
                dropPt = {
                  x: ((e.clientX - rect.left) / rect.width) * currPage().width,
                  y: ((e.clientY - rect.top) / rect.height) * currPage().height,
                };
              }
              props.onImportFilesAt(props.pageId, files, dropPt);
            }}
          >
            {/* Layer 1: Static base canvas */}
            <canvas
              ref={baseCanvasRef}
              class="drawing-canvas drawing-canvas-base"
              style={{
                width: `${cssSize().width}px`,
                height: `${cssSize().height}px`,
              }}
            />

            {/* Layer 2: Interactive live-ink overlay canvas */}
            <canvas
              ref={liveCanvasRef}
              class="drawing-canvas drawing-canvas-live"
              classList={{
                'is-eraser': props.tool === 'eraser',
                'is-text-tool': props.tool === 'text' || props.tool === 'scribble',
                'is-select-tool': props.tool === 'select',
                'is-lasso-tool': props.tool === 'lasso',
                'is-occlusion-tool': props.tool === 'occlusion',
              }}
              style={{
                width: `${cssSize().width}px`,
                height: `${cssSize().height}px`,
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => finishPointerInteraction(e, false)}
              onPointerCancel={(e) => finishPointerInteraction(e, true)}
              onLostPointerCapture={handleLostPointerCapture}
              onPointerLeave={handlePointerLeave}
              onContextMenu={(e) => e.preventDefault()}
            />

            {/* Canvas Flashcard Occlusion Overlay (Stellen verbergen & Beidseitige Paare A ↔ B) */}
            <CanvasOcclusionOverlay
              occlusions={currPage().occlusions ?? []}
              displayMode={props.occlusionDisplayMode}
              interactiveEdit={props.tool === 'occlusion' || props.tool === 'select'}
              selectedId={
                props.selectedOcclusion?.pageId === props.pageId
                  ? props.selectedOcclusion.occlusionId
                  : null
              }
              revealedIds={props.revealedOcclusionIds}
              scale={cssSize().scale}
              toScreenRect={(occ) => {
                const s = cssSize().scale;
                return {
                  left: occ.x * s,
                  top: occ.y * s,
                  width: occ.width * s,
                  height: occ.height * s,
                };
              }}
              pageBounds={{ width: currPage().width, height: currPage().height }}
              onSelect={(id) =>
                props.onSetSelectedOcclusion(
                  id ? { pageId: props.pageId, occlusionId: id } : null
                )
              }
              onToggleReveal={(id) => props.onToggleRevealOcclusion(id)}
              onCaptureSnapshot={() => {
                const p = currPage();
                return {
                  strokes: p.strokes,
                  texts: p.texts,
                  images: p.images,
                  occlusions: (p.occlusions ?? []).map((o) => ({ ...o })),
                };
              }}
              onUpdateLive={(item) =>
                props.store.updateCanvasOcclusionLive(item, props.pageId)
              }
              onCommitUpdate={(item, prevSnap) =>
                props.store.updateCanvasOcclusion(item, prevSnap, props.pageId)
              }
              onToggleBidirectional={(id) => {
                const partner = props.store.createBidirectionalPartnerOcclusion(
                  id,
                  props.pageId
                );
                if (partner) {
                  props.onSetSelectedOcclusion({
                    pageId: props.pageId,
                    occlusionId: partner.id,
                  });
                }
              }}
              onUnlinkPair={(id) =>
                props.store.unlinkOcclusionPair(id, props.pageId)
              }
              onDelete={(id) => {
                props.onSetSelectedOcclusion(null);
                props.store.deleteCanvasOcclusion(id, props.pageId);
                props.store.showToast('Verdeckte Stelle entfernt');
              }}
            />

            {/* Lasso Selection Move / Resize / Action Overlay */}
            <Show when={localLassoSelection() && displayedLassoBounds()}>
              {(_) => {
                const scale = () => cssSize().scale;
                const sel = () => localLassoSelection()!;
                const b = () => displayedLassoBounds()!;
                const paperDark = () =>
                  isPaperDark(currPage().paperConfig, props.store.theme());
                return (
                  <CanvasLassoOverlay
                    leftPx={b().x * scale()}
                    topPx={b().y * scale()}
                    widthPx={b().width * scale()}
                    heightPx={b().height * scale()}
                    itemCount={getLassoItemCount(sel())}
                    hasColorableItems={
                      sel().strokeIds.length > 0 || sel().textIds.length > 0
                    }
                    paperIsDark={paperDark()}
                    isTransforming={isLassoTransforming()}
                    onStartMove={(e) => startLassoTransform('move', e)}
                    onStartResize={(corner, e) => startLassoTransform(corner, e)}
                    onMoveTransform={moveLassoTransform}
                    onEndTransform={endLassoTransform}
                    onRecolor={props.onRecolorLasso}
                    onCopy={props.onCopyLasso}
                    onCut={props.onCutLasso}
                    onDuplicate={props.onDuplicateLasso}
                    onDelete={props.onDeleteLasso}
                    onDismiss={() => props.onSetLassoSelection(null)}
                  />
                );
              }}
            </Show>

            {/* Selected Image Move / Resize Overlay */}
            <Show when={localSelectedImage()}>
              {(img) => {
                const scale = () => cssSize().scale;
                const multiImages = () => currPage().images.length > 1;

                return (
                  <div
                    class="canvas-image-selection"
                    style={{
                      left: `${img().x * scale()}px`,
                      top: `${img().y * scale()}px`,
                      width: `${img().width * scale()}px`,
                      height: `${img().height * scale()}px`,
                    }}
                    onPointerDown={(e) => startImageTransform('move', e)}
                    onPointerMove={moveImageTransform}
                    onPointerUp={endImageTransform}
                    onPointerCancel={endImageTransform}
                  >
                    <div
                      class="canvas-text-bar canvas-image-bar"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <span class="cib-name" title={img().name}>
                        {img().name}
                      </span>

                      <label class="cib-opacity" title="Deckkraft anpassen">
                        <span>{Math.round(img().opacity * 100)}%</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={img().opacity}
                          onPointerDown={() => {
                            const p = currPage();
                            opacityBeforeSnapshot = {
                              strokes: p.strokes,
                              texts: p.texts,
                              images: p.images.map((item) => ({ ...item })),
                            };
                          }}
                          onInput={(e) =>
                            props.store.updateCanvasImageLive(
                              {
                                ...img(),
                                opacity: Number(e.currentTarget.value),
                              },
                              props.pageId
                            )
                          }
                          onChange={(e) => {
                            const prevSnap = opacityBeforeSnapshot;
                            opacityBeforeSnapshot = null;
                            props.store.updateCanvasImage(
                              { ...img(), opacity: Number(e.currentTarget.value) },
                              prevSnap ?? undefined,
                              props.pageId
                            );
                          }}
                        />
                      </label>

                      <Show when={multiImages()}>
                        <button
                          type="button"
                          class="ctb-btn"
                          onClick={() =>
                            props.store.reorderCanvasImage(img().id, 'back', props.pageId)
                          }
                          title="In den Hintergrund"
                        >
                          <IconSendBack size={13} />
                        </button>
                        <button
                          type="button"
                          class="ctb-btn"
                          onClick={() =>
                            props.store.reorderCanvasImage(img().id, 'front', props.pageId)
                          }
                          title="In den Vordergrund"
                        >
                          <IconBringFront size={13} />
                        </button>
                      </Show>

                      <button
                        type="button"
                        class="ctb-btn is-danger"
                        onClick={() => {
                          const id = img().id;
                          props.onSetSelectedImage(null);
                          props.store.deleteCanvasImage(id, props.pageId);
                          props.store.showToast('Bild entfernt');
                        }}
                        title="Bild löschen (Entf)"
                      >
                        <IconTrash size={13} />
                      </button>

                      <button
                        type="button"
                        class="ctb-btn is-confirm"
                        onClick={() => props.onSetSelectedImage(null)}
                        title="Fertig"
                      >
                        <IconCheck size={13} />
                      </button>
                    </div>

                    <button
                      type="button"
                      class="resize-handle is-nw"
                      aria-label="Oben links skalieren"
                      onPointerDown={(e) => startImageTransform('nw', e)}
                      onPointerMove={moveImageTransform}
                      onPointerUp={endImageTransform}
                      onPointerCancel={endImageTransform}
                    />
                    <button
                      type="button"
                      class="resize-handle is-ne"
                      aria-label="Oben rechts skalieren"
                      onPointerDown={(e) => startImageTransform('ne', e)}
                      onPointerMove={moveImageTransform}
                      onPointerUp={endImageTransform}
                      onPointerCancel={endImageTransform}
                    />
                    <button
                      type="button"
                      class="resize-handle is-sw"
                      aria-label="Unten links skalieren"
                      onPointerDown={(e) => startImageTransform('sw', e)}
                      onPointerMove={moveImageTransform}
                      onPointerUp={endImageTransform}
                      onPointerCancel={endImageTransform}
                    />
                    <button
                      type="button"
                      class="resize-handle is-se"
                      aria-label="Unten rechts skalieren"
                      onPointerDown={(e) => startImageTransform('se', e)}
                      onPointerMove={moveImageTransform}
                      onPointerUp={endImageTransform}
                      onPointerCancel={endImageTransform}
                    />
                  </div>
                );
              }}
            </Show>

            {/* Inline Canvas Text & Handwriting-to-Text (Scribble) Overlay */}
            <Show when={localEditingText()}>
              {(item) => {
                const scale = () => cssSize().scale;
                return (
                  <CanvasTextOverlay
                    item={item()}
                    paperConfig={currPage().paperConfig}
                    theme={props.store.theme()}
                    leftPx={item().x * scale()}
                    topPx={item().y * scale()}
                    scale={scale()}
                    isScribbleMode={props.tool === 'scribble'}
                    onChangeItem={(next) =>
                      props.onSetEditingText({ pageId: props.pageId, item: next })
                    }
                    onSyncTextStyle={props.onSyncTextStyle}
                    onDelete={() => {
                      const id = item().id;
                      props.onSetEditingText(null);
                      props.store.deleteCanvasText(id, props.pageId);
                      if (props.tool === 'scribble') {
                        props.onExitScribble();
                      }
                    }}
                    onCommit={props.onCommitEditingText}
                    onExitScribble={props.onExitScribble}
                    onStartNewBlock={() => {
                      const curr = item();
                      const p = currPage();
                      const lines = Math.max(2, curr.text.split('\n').length + 1);
                      const nextY = Math.min(
                        p.height - 130,
                        Math.round(curr.y + lines * curr.fontSize * 1.35 + 24)
                      );
                      props.onCommitEditingText();
                      openTextEditorAt(
                        { x: curr.x, y: nextY + curr.fontSize * 0.5, pressure: 0.5 },
                        false,
                        true
                      );
                    }}
                    onStartDrag={startTextDrag}
                    onMoveDrag={moveTextDrag}
                    onEndDrag={endTextDrag}
                    registerTextarea={(el) => {
                      textInputRef = el;
                    }}
                  />
                );
              }}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
