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
  type PalmSensitivity,
  type PenStyle,
  type StabilizationLevel,
  type Stroke,
  type StrokePoint,
} from '../types';
import {
  computePageContentBounds,
  drawStroke,
  isPaperDark,
  isPointHittingImage,
  isPointHittingStroke,
  isPointHittingText,
  renderInfiniteCanvas,
  resolvePaperBackgroundColor,
  resolveStrokeColor,
  type InfiniteCamera,
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
import { StrokeStabilizer } from '../utils/strokeStabilizer';
import {
  projectClientPointToRulerLock,
  type RulerDrawAdapter,
  type RulerStrokeLock,
} from '../utils/ruler';
import {
  createScrollAxisState,
  filterScrollDelta,
  getOneFingerPanThreshold,
  getPalmProfile,
  isHardPalmGrowTouch,
  isHardPalmTouch,
  stabilizeReleaseVelocity,
  type ScrollAxisState,
} from '../utils/touchScroll';
import {
  getLastGlobalPenTimestamp,
  markGlobalPenActivity,
  type EditingTextState,
  type SelectedImageState,
  type SelectedOcclusionState,
} from './CanvasPageSheet';
import {
  CanvasLassoOverlay,
  type LassoResizeCorner,
} from './CanvasLassoOverlay';
import {
  CanvasOcclusionOverlay,
  type OcclusionDisplayMode,
} from './CanvasOcclusionOverlay';
import { CanvasTextOverlay } from './CanvasTextOverlay';
import { InfiniteExportRegionOverlay } from './InfiniteExportRegionOverlay';
import type {
  InfiniteViewportSnapshot,
  WorldRect,
} from '../utils/infiniteExport';
import {
  IconBringFront,
  IconCheck,
  IconCrosshair,
  IconSendBack,
  IconTrash,
} from './Icons';

export interface InfiniteCanvasHandle {
  zoomBy: (delta: number) => void;
  setZoom: (nextZoom: number) => void;
  fitToContent: () => void;
  resetView: () => void;
  getViewportCenterWorld: () => { x: number; y: number };
  getViewportSnapshot: () => InfiniteViewportSnapshot;
}

interface AppleTouch extends Touch {
  touchType?: 'direct' | 'stylus';
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export const INF_MIN_ZOOM = 0.25;
export const INF_MAX_ZOOM = 4.0;

// Persist camera position/zoom per `${noteId}:${pageId}` across tab switches in this session
const cameraCache = new Map<string, InfiniteCamera>();

interface InfiniteCanvasViewProps {
  store: NotesStore;
  pageId: string;
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
  oneFingerScroll: boolean;
  pinchZoomEnabled: boolean;
  scrollMomentum: boolean;
  palmSensitivity: PalmSensitivity;
  stabilization: StabilizationLevel;
  pressureSensitivity: boolean;
  editingText: EditingTextState | null;
  selectedImage: SelectedImageState | null;
  lassoSelection: LassoSelection | null;
  occlusionDisplayMode: OcclusionDisplayMode;
  selectedOcclusion: SelectedOcclusionState | null;
  revealedOcclusionIds: ReadonlySet<string>;
  onSetSelectedOcclusion: (next: SelectedOcclusionState | null) => void;
  onToggleRevealOcclusion: (id: string) => void;
  onPointerTypeChange: (type: string) => void;
  onZoomChange: (zoom: number) => void;
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
  onImportFilesAt: (
    pageId: string,
    files: File[],
    dropPt?: { x: number; y: number }
  ) => void;
  onImportPagesFiles: (files: File[]) => void;
  registerHandle: (handle: InfiniteCanvasHandle | null) => void;
  rulerAdapter?: RulerDrawAdapter;
  exportRegionActive?: boolean;
  exportRegion?: WorldRect | null;
  onExportRegionChange?: (rect: WorldRect) => void;
  onConfirmExportRegion?: (rect: WorldRect) => void;
  onCancelExportRegion?: () => void;
}

export function InfiniteCanvasView(props: InfiniteCanvasViewProps) {
  const [vpSize, setVpSize] = createSignal({ width: 800, height: 600 });
  const [camera, setCamera] = createSignal<InfiniteCamera>({ x: -24, y: -24, zoom: 1 });
  const [isPinchingUi, setIsPinchingUi] = createSignal(false);
  const [spacePressed, setSpacePressed] = createSignal(false);
  const [isMousePanning, setIsMousePanning] = createSignal(false);
  const [hoveredTextId, setHoveredTextId] = createSignal<string | null>(null);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [lassoTransform, setLassoTransform] = createSignal<LassoTransform | null>(null);
  const isLassoTransforming = createMemo(() => lassoTransform() !== null);

  let containerRef: HTMLDivElement | undefined;
  let baseCanvasRef: HTMLCanvasElement | undefined;
  let liveCanvasRef: HTMLCanvasElement | undefined;
  let liveCtxCache: CanvasRenderingContext2D | null = null;
  let textInputRef: HTMLTextAreaElement | undefined;

  // Imperative 120Hz drawing state
  let activePointerId: number | null = null;
  let activePointerType: string | null = null;
  let isPenDownNow = false;
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

  // Live drag-to-draw occlusion mask state (world coordinates)
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
  let penContactNotifier: (() => void) | null = null;

  let mousePanState: {
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null = null;

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

  const cacheKey = () => `${props.store.activeNoteId() ?? ''}:${props.pageId}`;

  const palmProfile = createMemo(() => getPalmProfile(props.palmSensitivity));

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

  const resolvedPaperBg = createMemo(() => {
    const p = page();
    if (!p) return '#fcf9f2';
    return resolvePaperBackgroundColor(p.paperConfig, props.store.theme());
  });

  // Detect when user has panned completely away from all content on the infinite canvas
  const isContentOffscreen = createMemo(() => {
    const p = page();
    if (!p) return false;
    const hasAnything =
      p.strokes.length > 0 ||
      p.texts.length > 0 ||
      p.images.length > 0 ||
      Boolean(p.backgroundImage?.src);
    if (!hasAnything) return false;

    const bounds = computePageContentBounds(p, null);
    if (!bounds) return false;

    const cam = camera();
    const vp = vpSize();
    const viewMinX = cam.x;
    const viewMinY = cam.y;
    const viewMaxX = cam.x + vp.width / cam.zoom;
    const viewMaxY = cam.y + vp.height / cam.zoom;

    return (
      bounds.maxX < viewMinX ||
      bounds.minX > viewMaxX ||
      bounds.maxY < viewMinY ||
      bounds.minY > viewMaxY
    );
  });

  // Restore saved camera when switching note/page
  createEffect(() => {
    const key = cacheKey();
    const cached = cameraCache.get(key);
    const next: InfiniteCamera = cached ? { ...cached } : { x: -24, y: -24, zoom: 1 };
    setCamera(next);
    props.onZoomChange(next.zoom);
  });

  const updateCamera = (next: InfiniteCamera) => {
    cameraCache.set(cacheKey(), next);
    setCamera(next);
    props.onZoomChange(next.zoom);
  };

  const getDpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const getLiveCtx = (): CanvasRenderingContext2D | null => {
    if (!liveCanvasRef) return null;
    if (!liveCtxCache || liveCtxCache.canvas !== liveCanvasRef) {
      liveCtxCache = liveCanvasRef.getContext('2d');
    }
    return liveCtxCache;
  };

  const syncCanvasSizes = () => {
    const { width, height } = vpSize();
    const dpr = getDpr();
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));

    if (baseCanvasRef && (baseCanvasRef.width !== targetW || baseCanvasRef.height !== targetH)) {
      baseCanvasRef.width = targetW;
      baseCanvasRef.height = targetH;
    }
    if (liveCanvasRef && (liveCanvasRef.width !== targetW || liveCanvasRef.height !== targetH)) {
      liveCanvasRef.width = targetW;
      liveCanvasRef.height = targetH;
      penLiveState = createIncrementalPenState();
    }
    return { width, height, targetW, targetH, dpr };
  };

  const clearLiveCanvas = () => {
    if (!liveCanvasRef) return;
    const ctx = getLiveCtx();
    if (!ctx) return;
    ctx.clearRect(0, 0, liveCanvasRef.width, liveCanvasRef.height);
    penLiveState = createIncrementalPenState();
  };

  // Layer 1: Static Infinite Base Canvas
  const renderBaseNow = () => {
    baseRafId = null;
    const canvas = baseCanvasRef;
    const p = page();
    if (!canvas || !p) return;

    const { width, height, dpr } = syncCanvasSizes();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    renderInfiniteCanvas(
      ctx,
      effectivePage,
      width,
      height,
      camera(),
      props.store.theme(),
      dpr,
      {
        editingTextId: localEditingText()?.id ?? null,
        hoveredTextId:
          props.tool === 'text' || props.tool === 'scribble' || props.tool === 'select'
            ? hoveredTextId()
            : null,
        onImageLoad: scheduleBaseRender,
        hiddenIds,
      }
    );

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

    const { targetW, targetH, dpr } = syncCanvasSizes();
    const ctx = getLiveCtx();
    if (!ctx) return;

    const cam = camera();
    const totalScale = dpr * cam.zoom;
    const offsetX = -cam.x * totalScale;
    const offsetY = -cam.y * totalScale;

    if (activeStroke && activeStroke.tool === 'pen') {
      const pts = activeStroke.points;
      const color = resolveStrokeColor(
        activeStroke.color,
        p.paperConfig,
        props.store.theme()
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

    if (isLassoDrawing && lassoPoints.length >= 2) {
      const dark = isPaperDark(p.paperConfig, props.store.theme());
      ctx.save();
      ctx.scale(totalScale, totalScale);
      ctx.translate(-cam.x, -cam.y);
      drawLassoPath(ctx, lassoPoints, 1 / Math.max(0.35, cam.zoom), dark);
      ctx.restore();
      return;
    }

    if (occlusionDraft) {
      const rx = Math.min(occlusionDraft.startX, occlusionDraft.currX);
      const ry = Math.min(occlusionDraft.startY, occlusionDraft.currY);
      const rw = Math.abs(occlusionDraft.currX - occlusionDraft.startX);
      const rh = Math.abs(occlusionDraft.currY - occlusionDraft.startY);
      const invZ = 1 / Math.max(0.35, cam.zoom);
      ctx.save();
      ctx.scale(totalScale, totalScale);
      ctx.translate(-cam.x, -cam.y);
      ctx.fillStyle = 'rgba(79, 70, 229, 0.24)';
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 2 * invZ;
      ctx.setLineDash([6 * invZ, 4 * invZ]);
      ctx.beginPath();
      ctx.roundRect(rx, ry, Math.max(2, rw), Math.max(2, rh), 6 * invZ);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }

    const activeLassoT = lassoTransform();
    const activeLassoSel = localLassoSelection();
    if (activeLassoT && activeLassoSel) {
      ctx.save();
      ctx.scale(totalScale, totalScale);
      ctx.translate(-cam.x, -cam.y);
      renderSelectedItemsPreview(ctx, p, activeLassoSel, activeLassoT, props.store.theme());
      ctx.restore();
      return;
    }

    if (activeStroke) {
      ctx.save();
      ctx.scale(totalScale, totalScale);
      ctx.translate(-cam.x, -cam.y);
      drawStroke(ctx, activeStroke, p.paperConfig, props.store.theme());
      ctx.restore();
      return;
    }

    if (eraserCursor && (props.tool === 'eraser' || isErasing)) {
      const dark = isPaperDark(p.paperConfig, props.store.theme());
      const worldRadius = props.eraserSize / Math.max(0.35, cam.zoom);
      ctx.save();
      ctx.scale(totalScale, totalScale);
      ctx.translate(-cam.x, -cam.y);
      ctx.beginPath();
      ctx.arc(eraserCursor.x, eraserCursor.y, worldRadius, 0, Math.PI * 2);
      ctx.strokeStyle = dark
        ? 'rgba(248, 250, 252, 0.72)'
        : 'rgba(15, 23, 42, 0.55)';
      ctx.fillStyle = dark
        ? 'rgba(248, 250, 252, 0.08)'
        : 'rgba(15, 23, 42, 0.06)';
      ctx.lineWidth = 1.5 / Math.max(0.35, cam.zoom);
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
    void p?.strokes;
    void p?.texts;
    void p?.images;
    void p?.paperConfig;
    void p?.backgroundImage;
    void props.store.theme();
    void vpSize();
    void camera();
    void localEditingText()?.id;
    void hoveredTextId();
    void props.tool;
    void isLassoTransforming();
    void localLassoSelection();
    scheduleBaseRender();
  });

  // Camera imperative controls exposed to DrawingCanvas toolbar/statusbar
  const zoomAroundScreenPoint = (targetZoom: number, screenX: number, screenY: number) => {
    const cam = camera();
    const clamped = Math.max(INF_MIN_ZOOM, Math.min(INF_MAX_ZOOM, Math.round(targetZoom * 100) / 100));
    const worldX = cam.x + screenX / cam.zoom;
    const worldY = cam.y + screenY / cam.zoom;
    updateCamera({
      x: worldX - screenX / clamped,
      y: worldY - screenY / clamped,
      zoom: clamped,
    });
  };

  const fitToContent = () => {
    const p = page();
    const vp = vpSize();
    if (!p) return;
    const ctx = baseCanvasRef?.getContext('2d');
    const bounds = computePageContentBounds(p, ctx);
    if (!bounds) {
      updateCamera({ x: -24, y: -24, zoom: 1 });
      return;
    }
    const pad = 64;
    const contentW = Math.max(120, bounds.maxX - bounds.minX + pad * 2);
    const contentH = Math.max(120, bounds.maxY - bounds.minY + pad * 2);
    const fitZoom = Math.max(
      INF_MIN_ZOOM,
      Math.min(1.5, Math.min(vp.width / contentW, vp.height / contentH))
    );
    const roundedZoom = Math.round(fitZoom * 100) / 100;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    updateCamera({
      x: centerX - vp.width / (2 * roundedZoom),
      y: centerY - vp.height / (2 * roundedZoom),
      zoom: roundedZoom,
    });
  };

  const resetView = () => {
    updateCamera({ x: -24, y: -24, zoom: 1 });
  };

  const getViewportCenterWorld = () => {
    const cam = camera();
    const vp = vpSize();
    return {
      x: cam.x + vp.width / (2 * cam.zoom),
      y: cam.y + vp.height / (2 * cam.zoom),
    };
  };

  const getViewportSnapshot = (): InfiniteViewportSnapshot => {
    const cam = camera();
    const vp = vpSize();
    return {
      camera: { ...cam },
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      worldRect: {
        x: cam.x,
        y: cam.y,
        width: vp.width / Math.max(0.05, cam.zoom),
        height: vp.height / Math.max(0.05, cam.zoom),
      },
    };
  };

  const pageContentBounds = createMemo(() => {
    if (!props.exportRegionActive) return null;
    const p = page();
    if (!p) return null;
    void p.strokes;
    void p.texts;
    void p.images;
    void p.backgroundImage;
    return computePageContentBounds(p, baseCanvasRef?.getContext('2d') ?? null);
  });

  // Coordinate conversions
  const clientToWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = liveCanvasRef!.getBoundingClientRect();
    const cam = camera();
    return {
      x: cam.x + (clientX - rect.left) / cam.zoom,
      y: cam.y + (clientY - rect.top) / cam.zoom,
    };
  };

  const toWorldStrokePoint = (
    e: PointerEvent,
    explicitPointerType?: string,
    explicitTimeMs?: number,
    overrideClient?: { clientX: number; clientY: number }
  ): StrokePoint => {
    const clientX = overrideClient ? overrideClient.clientX : e.clientX;
    const clientY = overrideClient ? overrideClient.clientY : e.clientY;
    const { x, y } = clientToWorld(clientX, clientY);
    const evTime = explicitTimeMs ?? (e.timeStamp || performance.now());
    const relTime =
      strokeStartEventTime > 0 ? Math.max(0, Math.round(evTime - strokeStartEventTime)) : 0;
    const pType = explicitPointerType || e.pointerType;

    let pressure = 0.55;
    if (props.pressureSensitivity) {
      pressure = lastPoint?.pressure ?? 0.5;
      if (pType === 'pen') {
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
    const hitPad = 10 / Math.max(0.4, camera().zoom);
    for (let i = p.texts.length - 1; i >= 0; i--) {
      if (isPointHittingText(ctx, pt, p.texts[i], hitPad)) {
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
    const radius = props.eraserSize / Math.max(0.35, camera().zoom);
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
    isPenDownNow = false;
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
    isPenDownNow = false;
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
        const minTap = 14 / Math.max(0.35, camera().zoom);
        if (rawW < minTap && rawH < minTap) {
          if (draft.hadSelectedBefore) {
            props.onSetSelectedOcclusion(null);
          } else {
            const defW = 160;
            const defH = 44;
            const created: CanvasOcclusionItem = {
              id: generateId(),
              x: Math.round(draft.startX - defW / 2),
              y: Math.round(draft.startY - defH / 2),
              width: defW,
              height: defH,
              color: OCCLUSION_COLORS[0],
            };
            props.store.addCanvasOcclusion(created, props.pageId);
            props.onSetSelectedOcclusion({ pageId: props.pageId, occlusionId: created.id });
          }
        } else {
          const w = Math.max(24, Math.round(rawW));
          const h = Math.max(24, Math.round(rawH));
          const created: CanvasOcclusionItem = {
            id: generateId(),
            x: Math.round(Math.min(draft.startX, draft.currX)),
            y: Math.round(Math.min(draft.startY, draft.currY)),
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
        const tapThresholdWorld = 14 / Math.max(0.35, camera().zoom);
        if (totalLen < tapThresholdWorld) {
          if (hadSelectionBefore) {
            props.onSetLassoSelection(null);
          } else {
            const hit = selectPageItemAtPoint(
              p,
              pts[0],
              ctx,
              10 / Math.max(0.35, camera().zoom)
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
    if (!page()) return false;
    if (props.editingText) {
      props.onCommitEditingText();
    }

    const hit = findTextAtPoint(pt);
    if (hit) {
      props.onSetSelectedImage(null);
      const nextItem: CanvasTextItem =
        asScribble && !hit.maxWidth ? { ...hit, maxWidth: 560 } : { ...hit };
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

    const scribbleWidth = asScribble
      ? Math.max(320, Math.min(640, Math.round((vpSize().width / Math.max(0.5, camera().zoom)) * 0.72)))
      : undefined;

    props.onSetSelectedImage(null);
    props.onSetEditingText({
      pageId: props.pageId,
      item: {
        id: generateId(),
        x: pt.x,
        y: pt.y - props.textFontSize * 0.5,
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

  // Mount: ResizeObserver, imperative handle, Space-pan keybindings, window pointer safety net,
  // and unified iPad Touch + Desktop Wheel/Pinch camera controller!
  onMount(() => {
    const el = containerRef;
    if (!el) return;

    const updateSize = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setVpSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);

    props.registerHandle({
      zoomBy: (delta) => {
        const vp = vpSize();
        zoomAroundScreenPoint(camera().zoom + delta, vp.width / 2, vp.height / 2);
      },
      setZoom: (nextZoom) => {
        const vp = vpSize();
        zoomAroundScreenPoint(nextZoom, vp.width / 2, vp.height / 2);
      },
      fitToContent,
      resetView,
      getViewportCenterWorld,
      getViewportSnapshot,
    });

    const handleWindowPointerEnd = (e: PointerEvent) => {
      if (activePointerId !== null && activePointerId === e.pointerId) {
        finishPointerInteraction(e, e.type === 'pointercancel');
      }
      if (mousePanState && mousePanState.pointerId === e.pointerId) {
        mousePanState = null;
        setIsMousePanning(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (isEditable) return;
      e.preventDefault();
      setSpacePressed(true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    const handleWindowBlur = () => setSpacePressed(false);

    window.addEventListener('pointerup', handleWindowPointerEnd);
    window.addEventListener('pointercancel', handleWindowPointerEnd);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    // ==================== UNIFIED INFINITE TOUCH & WHEEL CONTROLLER ====================
    interface OneFingerPan {
      touchId: number;
      engaged: boolean;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      startCamX: number;
      startCamY: number;
      startTime: number;
      lastMoveTs: number;
      velX: number; // CSS px per 16.67ms
      velY: number;
      threshold: number;
      axis: ScrollAxisState | null;
    }

    interface PinchState {
      touchIdA: number;
      touchIdB: number;
      startDist: number;
      startZoom: number;
      worldAnchorX: number;
      worldAnchorY: number;
      lastMidX: number;
      lastMidY: number;
    }

    const ignoredPalmTouchIds = new Set<number>();
    const activeNonStylusTouchIds = new Set<number>();
    let waitForAllFingersUp = false;
    let oneFingerPan: OneFingerPan | null = null;
    let pinch: PinchState | null = null;

    let momentumRafId: number | null = null;
    let momentumVx = 0;
    let momentumVy = 0;
    let momentumLastTs = 0;

    const stopMomentum = () => {
      if (momentumRafId !== null) {
        cancelAnimationFrame(momentumRafId);
        momentumRafId = null;
      }
      momentumVx = 0;
      momentumVy = 0;
    };

    const startMomentum = (vx: number, vy: number) => {
      stopMomentum();
      if (!props.scrollMomentum) return;
      if (Math.hypot(vx, vy) < 1.2) return;
      momentumVx = Math.max(-56, Math.min(56, vx));
      momentumVy = Math.max(-56, Math.min(56, vy));
      momentumLastTs = performance.now();

      const step = (now: number) => {
        momentumRafId = null;
        if (isPenDownNow || pinch || oneFingerPan) {
          stopMomentum();
          return;
        }
        const dtMs = Math.max(4, Math.min(48, now - momentumLastTs));
        momentumLastTs = now;
        const frames = dtMs / 16.67;

        const cam = camera();
        updateCamera({
          x: cam.x - (momentumVx * frames) / cam.zoom,
          y: cam.y - (momentumVy * frames) / cam.zoom,
          zoom: cam.zoom,
        });

        const decay = Math.pow(0.942, frames);
        momentumVx *= decay;
        momentumVy *= decay;

        if (Math.hypot(momentumVx, momentumVy) >= 0.35) {
          momentumRafId = requestAnimationFrame(step);
        } else {
          stopMomentum();
        }
      };
      momentumRafId = requestAnimationFrame(step);
    };

    const getTargetElement = (target: EventTarget | null): Element | null => {
      if (target instanceof Element) return target;
      if (target instanceof Node) return target.parentElement;
      return null;
    };

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      const el = getTargetElement(target);
      if (!el) return false;
      return Boolean(
        el.closest(
          'button, input, select, textarea, label, a, summary, [role="button"], [role="tab"], .canvas-text-overlay, .canvas-image-selection, .canvas-lasso-selection, .canvas-occlusion-box, .canvas-occlusion-bar, .canvas-ruler, .export-region-interactive'
        )
      );
    };

    const canOneFingerPan = (target: EventTarget | null): boolean => {
      if (isInteractiveTarget(target)) return false;
      if (props.exportRegionActive) return true;
      if (props.stylusOnly) return props.oneFingerScroll;
      return props.tool === 'select';
    };

    const hasStylusTouch = (e: TouchEvent): boolean => {
      const all = Array.from(e.touches) as AppleTouch[];
      const changed = Array.from(e.changedTouches) as AppleTouch[];
      return (
        all.some((t) => t.touchType === 'stylus') ||
        changed.some((t) => t.touchType === 'stylus')
      );
    };

    const getCleanFingerTouches = (list: TouchList): AppleTouch[] => {
      const result: AppleTouch[] = [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i] as AppleTouch;
        if (t.touchType === 'stylus') continue;
        if (ignoredPalmTouchIds.has(t.identifier)) continue;
        result.push(t);
      }
      return result;
    };

    const findTouchById = (list: TouchList, id: number): AppleTouch | null => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i] as AppleTouch;
      }
      return null;
    };

    const beginPinch = (t0: Touch, t1: Touch) => {
      oneFingerPan = null;
      waitForAllFingersUp = false;
      stopMomentum();
      if (activePointerId !== null && activePointerType === 'touch') {
        abortCurrentInteraction();
      }

      const rect = el.getBoundingClientRect();
      const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
      const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
      const dist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const cam = camera();

      pinch = {
        touchIdA: t0.identifier,
        touchIdB: t1.identifier,
        startDist: dist,
        startZoom: cam.zoom,
        worldAnchorX: cam.x + midX / cam.zoom,
        worldAnchorY: cam.y + midY / cam.zoom,
        lastMidX: midX,
        lastMidY: midY,
      };
      if (props.pinchZoomEnabled) setIsPinchingUi(true);
    };

    const handlePenContact = () => {
      markGlobalPenActivity();
      stopMomentum();
      for (const id of activeNonStylusTouchIds) {
        ignoredPalmTouchIds.add(id);
      }
      if (pinch) {
        pinch = null;
        setIsPinchingUi(false);
      }
      if (oneFingerPan) {
        const pan = oneFingerPan;
        oneFingerPan = null;
        const profile = palmProfile();
        if (pan.engaged && performance.now() - pan.startTime < profile.snapWindowMs) {
          const cam = camera();
          const driftCss = Math.hypot(
            (cam.x - pan.startCamX) * cam.zoom,
            (cam.y - pan.startCamY) * cam.zoom
          );
          if (driftCss < profile.snapMaxPx) {
            updateCamera({ x: pan.startCamX, y: pan.startCamY, zoom: cam.zoom });
          }
        }
      }
    };

    penContactNotifier = handlePenContact;

    const handleTouchStart = (e: TouchEvent) => {
      stopMomentum();
      const profile = palmProfile();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const ct = e.changedTouches[i] as AppleTouch;
        if (ct.touchType !== 'stylus') {
          activeNonStylusTouchIds.add(ct.identifier);
          if (isPenDownNow || isHardPalmTouch(ct, profile)) {
            ignoredPalmTouchIds.add(ct.identifier);
          }
        }
      }

      if (hasStylusTouch(e)) {
        handlePenContact();
        if (!isInteractiveTarget(e.target)) e.preventDefault();
        return;
      }

      const fingerTouches = getCleanFingerTouches(e.touches);

      if (fingerTouches.length >= 2 && !isPenDownNow) {
        e.preventDefault();
        beginPinch(fingerTouches[0], fingerTouches[1]);
        return;
      }

      if (
        fingerTouches.length === 1 &&
        !isPenDownNow &&
        !waitForAllFingersUp &&
        !pinch
      ) {
        const t = fingerTouches[0];
        const isDrawingTool =
          props.tool !== 'text' && props.tool !== 'scribble' && props.tool !== 'select';

        if (canOneFingerPan(e.target)) {
          const penJustUsed = Date.now() - getLastGlobalPenTimestamp() < 350;
          const cam = camera();
          const now = performance.now();
          oneFingerPan = {
            touchId: t.identifier,
            engaged: false,
            startX: t.clientX,
            startY: t.clientY,
            lastX: t.clientX,
            lastY: t.clientY,
            startCamX: cam.x,
            startCamY: cam.y,
            startTime: now,
            lastMoveTs: now,
            velX: 0,
            velY: 0,
            threshold: getOneFingerPanThreshold(t, profile, penJustUsed),
            axis: null,
          };
          if (isDrawingTool) e.preventDefault();
          return;
        }

        if (isDrawingTool && !isInteractiveTarget(e.target)) {
          e.preventDefault();
        }
        return;
      }

      if (e.touches.length > 0 && !isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (hasStylusTouch(e)) {
        handlePenContact();
        if (!isInteractiveTarget(e.target)) e.preventDefault();
        return;
      }

      // Only reject a pending 1-finger touch if it spreads into a genuinely massive palm/wrist
      // (thumbs and angled fingers flattening during a sideways swipe stay active)
      if (oneFingerPan && !oneFingerPan.engaged) {
        const t = findTouchById(e.touches, oneFingerPan.touchId);
        if (t && isHardPalmGrowTouch(t, palmProfile())) {
          ignoredPalmTouchIds.add(t.identifier);
          oneFingerPan = null;
        }
      }

      const fingerTouches = getCleanFingerTouches(e.touches);

      // 2-finger Pinch-to-Zoom + Pan (exact world-space anchor — zero drift!)
      if ((pinch || fingerTouches.length >= 2) && !isPenDownNow) {
        e.preventDefault();
        if (activePointerId !== null && activePointerType === 'touch') {
          abortCurrentInteraction();
        }

        if (!pinch) {
          if (fingerTouches.length < 2) return;
          beginPinch(fingerTouches[0], fingerTouches[1]);
        }

        const g = pinch!;
        const t0 = findTouchById(e.touches, g.touchIdA) ?? fingerTouches[0];
        const t1 = findTouchById(e.touches, g.touchIdB) ?? fingerTouches[1];
        if (!t0 || !t1) return;

        const rect = el.getBoundingClientRect();
        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;

        if (!props.pinchZoomEnabled) {
          const cam = camera();
          const dx = midX - g.lastMidX;
          const dy = midY - g.lastMidY;
          g.lastMidX = midX;
          g.lastMidY = midY;
          updateCamera({
            x: cam.x - dx / cam.zoom,
            y: cam.y - dy / cam.zoom,
            zoom: cam.zoom,
          });
          return;
        }

        const dist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
        const nextZoom = Math.max(
          INF_MIN_ZOOM,
          Math.min(INF_MAX_ZOOM, g.startZoom * (dist / g.startDist))
        );

        g.lastMidX = midX;
        g.lastMidY = midY;

        updateCamera({
          x: g.worldAnchorX - midX / nextZoom,
          y: g.worldAnchorY - midY / nextZoom,
          zoom: nextZoom,
        });
        return;
      }

      // 1-finger Pan (with directional stabilization & thumb-arc tolerance)
      if (oneFingerPan && !isPenDownNow && !waitForAllFingersUp) {
        const t = findTouchById(e.touches, oneFingerPan.touchId);
        if (!t) return;

        const now = performance.now();
        if (!oneFingerPan.engaged) {
          const totalDx = t.clientX - oneFingerPan.startX;
          const totalDy = t.clientY - oneFingerPan.startY;
          const moved = Math.hypot(totalDx, totalDy);
          if (moved < oneFingerPan.threshold) {
            oneFingerPan.lastMoveTs = now;
            if (e.cancelable) e.preventDefault();
            return;
          }
          oneFingerPan.engaged = true;
          oneFingerPan.axis = createScrollAxisState(
            oneFingerPan.startX,
            oneFingerPan.startY,
            t.clientX,
            t.clientY,
            true,
            true
          );
          const excessRatio = moved > 0 ? Math.max(0, (moved - oneFingerPan.threshold) / moved) : 0;
          oneFingerPan.lastX = t.clientX - totalDx * excessRatio;
          oneFingerPan.lastY = t.clientY - totalDy * excessRatio;
        }

        e.preventDefault();

        const rawDx = t.clientX - oneFingerPan.lastX;
        const rawDy = t.clientY - oneFingerPan.lastY;
        const dtMs = Math.max(4, Math.min(48, now - oneFingerPan.lastMoveTs));
        oneFingerPan.lastX = t.clientX;
        oneFingerPan.lastY = t.clientY;
        oneFingerPan.lastMoveTs = now;

        const { appliedDx, appliedDy } = oneFingerPan.axis
          ? filterScrollDelta(oneFingerPan.axis, rawDx, rawDy, t.clientX, t.clientY)
          : { appliedDx: rawDx, appliedDy: rawDy };

        const cam = camera();
        updateCamera({
          x: cam.x - appliedDx / cam.zoom,
          y: cam.y - appliedDy / cam.zoom,
          zoom: cam.zoom,
        });

        const norm = 16.67 / dtMs;
        oneFingerPan.velX =
          oneFingerPan.axis?.lock === 'y'
            ? 0
            : oneFingerPan.velX * 0.35 + appliedDx * norm * 0.65;
        oneFingerPan.velY =
          oneFingerPan.axis?.lock === 'x'
            ? 0
            : oneFingerPan.velY * 0.35 + appliedDy * norm * 0.65;
        return;
      }

      if (!isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const id = e.changedTouches[i].identifier;
        ignoredPalmTouchIds.delete(id);
        activeNonStylusTouchIds.delete(id);
      }

      if (pinch) {
        const stillA = Boolean(findTouchById(e.touches, pinch.touchIdA));
        const stillB = Boolean(findTouchById(e.touches, pinch.touchIdB));
        if (!stillA || !stillB) {
          pinch = null;
          setIsPinchingUi(false);
          if (e.touches.length > 0) {
            waitForAllFingersUp = true;
          }
        }
      }

      if (oneFingerPan && !findTouchById(e.touches, oneFingerPan.touchId)) {
        const pan = oneFingerPan;
        oneFingerPan = null;
        if (
          e.type !== 'touchcancel' &&
          pan.engaged &&
          !isPenDownNow &&
          performance.now() - pan.lastMoveTs < 95
        ) {
          const { vx, vy } = stabilizeReleaseVelocity(pan.velX, pan.velY, pan.axis);
          startMomentum(vx, vy);
        }
      }

      if (e.touches.length === 0) {
        ignoredPalmTouchIds.clear();
        activeNonStylusTouchIds.clear();
        waitForAllFingersUp = false;
      }
    };

    const handleSafariGesture = (e: Event) => {
      e.preventDefault();
    };

    // Desktop Trackpad / Mouse Wheel: smooth pan + Ctrl/Pinch zoom around cursor
    const handleWheel = (e: WheelEvent) => {
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      stopMomentum();

      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = camera();

      if (e.ctrlKey || e.metaKey) {
        if (!props.pinchZoomEnabled) return;
        const factor = Math.exp(-e.deltaY * 0.005);
        zoomAroundScreenPoint(cam.zoom * factor, sx, sy);
      } else {
        const dx = e.shiftKey && Math.abs(e.deltaX) < 1 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && Math.abs(e.deltaX) < 1 ? 0 : e.deltaY;
        updateCamera({
          x: cam.x + dx / cam.zoom,
          y: cam.y + dy / cam.zoom,
          zoom: cam.zoom,
        });
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    el.addEventListener('gesturestart', handleSafariGesture, { passive: false });
    el.addEventListener('gesturechange', handleSafariGesture, { passive: false });
    el.addEventListener('wheel', handleWheel, { passive: false });

    onCleanup(() => {
      penContactNotifier = null;
      stopMomentum();
      ro.disconnect();
      props.registerHandle(null);
      window.removeEventListener('pointerup', handleWindowPointerEnd);
      window.removeEventListener('pointercancel', handleWindowPointerEnd);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      el.removeEventListener('gesturestart', handleSafariGesture);
      el.removeEventListener('gesturechange', handleSafariGesture);
      el.removeEventListener('wheel', handleWheel);
    });
  });

  onCleanup(() => {
    if (baseRafId !== null) cancelAnimationFrame(baseRafId);
    if (liveRafId !== null) cancelAnimationFrame(liveRafId);
  });

  // ==================== POINTER DRAWING PIPELINE ====================
  const handlePointerDown = (e: PointerEvent) => {
    const p = page();
    if (!p || !liveCanvasRef) return;

    // While picking an export region in "Canvas schieben" mode, allow mouse panning only (never draw ink)
    if (props.exportRegionActive) {
      if (e.pointerType === 'mouse' && (e.button === 0 || e.button === 1)) {
        e.preventDefault();
        mousePanState = {
          pointerId: e.pointerId,
          lastX: e.clientX,
          lastY: e.clientY,
        };
        setIsMousePanning(true);
        try {
          liveCanvasRef.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      return;
    }

    // Desktop pan with Middle-Mouse OR Space + Left-Click
    if (
      e.pointerType === 'mouse' &&
      (e.button === 1 || (e.button === 0 && spacePressed()))
    ) {
      e.preventDefault();
      mousePanState = {
        pointerId: e.pointerId,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      setIsMousePanning(true);
      try {
        liveCanvasRef.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    const isStylusEraser =
      e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const now = Date.now();

    if (e.pointerType === 'pen') {
      markGlobalPenActivity();
      penContactNotifier?.();
    }

    if (
      e.pointerType === 'touch' &&
      props.tool !== 'select' &&
      props.tool !== 'text' &&
      props.tool !== 'scribble'
    ) {
      const limit = palmProfile().pointerWidth;
      const isLargePalm = e.width > limit || e.height > limit;
      const penRecentlyActive = now - getLastGlobalPenTimestamp() < 1200;
      if (props.stylusOnly || penRecentlyActive || isLargePalm || activePointerType === 'pen') {
        e.preventDefault();
        return;
      }
    }

    // Self-healing pointer recovery
    if (activePointerId !== null) {
      if (e.pointerType === 'pen') {
        if (activePointerType === 'touch') {
          if (now - activeStrokeStartTime < 450) {
            abortCurrentInteraction();
          } else {
            finalizeCurrentInteraction(false, true);
          }
        } else {
          finalizeCurrentInteraction(false, false);
        }
      } else if (now - lastPointerEventWallTime > 1200) {
        finalizeCurrentInteraction(false, activePointerType === 'touch');
      } else {
        return;
      }
    }

    if (props.tool === 'select' && !isStylusEraser) {
      e.preventDefault();
      props.onPointerTypeChange(e.pointerType);
      const pt = toWorldStrokePoint(e);

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
        // On desktop mouse, dragging empty canvas in Select tool also pans nicely!
        if (e.pointerType === 'mouse') {
          mousePanState = {
            pointerId: e.pointerId,
            lastX: e.clientX,
            lastY: e.clientY,
          };
          setIsMousePanning(true);
          try {
            liveCanvasRef.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    if ((props.tool === 'text' || props.tool === 'scribble') && !isStylusEraser) {
      e.preventDefault();
      props.onPointerTypeChange(e.pointerType);
      const pt = toWorldStrokePoint(e);
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
    isPenDownNow = e.pointerType === 'pen';
    activeStrokeStartTime = now;
    lastPointerEventWallTime = now;

    try {
      liveCanvasRef.setPointerCapture(e.pointerId);
    } catch {
      // ignore
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
      rulerScaleCssPerLogical = Math.max(0.1, camera().zoom);
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

    const rawPt = toWorldStrokePoint(e, e.pointerType, startEvTime, startOverrideClient);
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

    if (mousePanState && e.pointerId === mousePanState.pointerId) {
      e.preventDefault();
      const dx = e.clientX - mousePanState.lastX;
      const dy = e.clientY - mousePanState.lastY;
      mousePanState.lastX = e.clientX;
      mousePanState.lastY = e.clientY;
      const cam = camera();
      updateCamera({
        x: cam.x - dx / cam.zoom,
        y: cam.y - dy / cam.zoom,
        zoom: cam.zoom,
      });
      return;
    }

    if (e.pointerType === 'pen') {
      markGlobalPenActivity();
    }

    if (activePointerId === null) {
      if (props.tool === 'eraser' && e.pointerType !== 'touch') {
        const pt = toWorldStrokePoint(e, e.pointerType);
        eraserCursor = { x: pt.x, y: pt.y };
        scheduleLiveRender();
      } else if (
        (props.tool === 'text' || props.tool === 'scribble' || props.tool === 'select') &&
        e.pointerType !== 'touch'
      ) {
        const pt = toWorldStrokePoint(e, e.pointerType);
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
    const camZoom = Math.max(0.35, camera().zoom);

    let erasedNow = false;

    for (const ev of sourceEvents) {
      if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) continue;
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
      const rawPt = toWorldStrokePoint(ev, parentPointerType, evTime, overrideClient);
      lastMoveTime = evTime;

      if (occlusionDraft) {
        occlusionDraft.currX = rawPt.x;
        occlusionDraft.currY = rawPt.y;
        lastPoint = rawPt;
        continue;
      }

      if (isLassoDrawing) {
        const minStep = 2.5 / Math.max(0.35, camZoom);
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
        const minDist = (activeStabilizer?.minSpacing ?? 1.1) / Math.min(2, camZoom);
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
    if (mousePanState && mousePanState.pointerId === e.pointerId) {
      if (liveCanvasRef?.hasPointerCapture(e.pointerId)) {
        try {
          liveCanvasRef.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      mousePanState = null;
      setIsMousePanning(false);
      return;
    }

    if (activePointerId !== e.pointerId) return;

    if (e.pointerType === 'pen') {
      markGlobalPenActivity();
    }

    finalizeCurrentInteraction(cancelled, e.pointerType === 'touch');
  };

  const handleLostPointerCapture = (e: PointerEvent) => {
    if (mousePanState && mousePanState.pointerId === e.pointerId) {
      mousePanState = null;
      setIsMousePanning(false);
    }
    if (activePointerId !== null && activePointerId === e.pointerId) {
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

  // ==================== INLINE TEXT & IMAGE TRANSFORMS (WORLD SPACE) ====================
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
    if (!ed) return;
    const scale = camera().zoom;
    const dx = (e.clientX - textDragState.startClientX) / scale;
    const dy = (e.clientY - textDragState.startClientY) / scale;
    props.onSetEditingText({
      pageId: props.pageId,
      item: {
        ...ed,
        x: textDragState.origX + dx,
        y: textDragState.origY + dy,
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
    const scale = camera().zoom;
    const dx = (e.clientX - imageTransformState.startClientX) / scale;
    const dy = (e.clientY - imageTransformState.startClientY) / scale;
    const orig = imageTransformState.orig;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    imageTransformState.changed = true;

    if (imageTransformState.mode === 'move') {
      props.store.updateCanvasImageLive(
        {
          ...orig,
          x: Math.round(orig.x + dx),
          y: Math.round(orig.y + dy),
        },
        props.pageId
      );
      return;
    }

    const aspect = orig.naturalWidth / Math.max(1, orig.naturalHeight);
    const minW = 48;
    const maxW = 3600;
    const rawW =
      imageTransformState.mode === 'se' || imageTransformState.mode === 'ne'
        ? orig.width + dx
        : orig.width - dx;
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

  // ==================== LASSO MOVE & PROPORTIONAL RESIZE (WORLD SPACE) ====================
  const startLassoTransform = (mode: 'move' | LassoResizeCorner, e: PointerEvent) => {
    const sel = localLassoSelection();
    const bounds = localLassoBounds();
    if (!sel || !bounds) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

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
    const scale = Math.max(0.2, camera().zoom);
    const dx = (e.clientX - lassoTransformState.startClientX) / scale;
    const dy = (e.clientY - lassoTransformState.startClientY) / scale;

    if (!lassoTransformState.changed && Math.hypot(dx, dy) < 1.2 / scale) return;
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
          ref={containerRef}
          class="infinite-canvas-viewport"
          classList={{
            'is-pan-ready': spacePressed(),
            'is-panning': isMousePanning(),
            'is-sheet-drop': isDragOver(),
          }}
          style={{ background: resolvedPaperBg() }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setIsDragOver(false);
            }
          }}
          onDrop={(e) => {
            setIsDragOver(false);
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
            const dropPt = liveCanvasRef
              ? clientToWorld(e.clientX, e.clientY)
              : getViewportCenterWorld();
            props.onImportFilesAt(props.pageId, files, dropPt);
          }}
        >
          {/* Layer 1: Static Infinite Base Canvas */}
          <canvas
            ref={baseCanvasRef}
            class="drawing-canvas drawing-canvas-base infinite-canvas-layer"
            style={{
              width: `${vpSize().width}px`,
              height: `${vpSize().height}px`,
            }}
          />

          {/* Layer 2: Interactive 120Hz Live Ink Overlay */}
          <canvas
            ref={liveCanvasRef}
            class="drawing-canvas drawing-canvas-live infinite-canvas-layer"
            classList={{
              'is-eraser': props.tool === 'eraser' && !spacePressed(),
              'is-text-tool':
                (props.tool === 'text' || props.tool === 'scribble') && !spacePressed(),
              'is-select-tool': props.tool === 'select' && !spacePressed(),
              'is-lasso-tool': props.tool === 'lasso' && !spacePressed(),
              'is-occlusion-tool': props.tool === 'occlusion' && !spacePressed(),
            }}
            style={{
              width: `${vpSize().width}px`,
              height: `${vpSize().height}px`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => finishPointerInteraction(e, false)}
            onPointerCancel={(e) => finishPointerInteraction(e, true)}
            onLostPointerCapture={handleLostPointerCapture}
            onPointerLeave={handlePointerLeave}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* Canvas Flashcard Occlusion Overlay (World Coordinates) */}
          <CanvasOcclusionOverlay
            occlusions={currPage().occlusions ?? []}
            displayMode={props.occlusionDisplayMode}
            interactiveEdit={
              (props.tool === 'occlusion' || props.tool === 'select') && !spacePressed()
            }
            selectedId={
              props.selectedOcclusion?.pageId === props.pageId
                ? props.selectedOcclusion.occlusionId
                : null
            }
            revealedIds={props.revealedOcclusionIds}
            scale={camera().zoom}
            toScreenRect={(occ) => {
              const cam = camera();
              return {
                left: (occ.x - cam.x) * cam.zoom,
                top: (occ.y - cam.y) * cam.zoom,
                width: occ.width * cam.zoom,
                height: occ.height * cam.zoom,
              };
            }}
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

          {/* Lasso Selection Move / Resize / Action Overlay (World Coordinates) */}
          <Show when={localLassoSelection() && displayedLassoBounds()}>
            {(_) => {
              const cam = () => camera();
              const sel = () => localLassoSelection()!;
              const b = () => displayedLassoBounds()!;
              const paperDark = () =>
                isPaperDark(currPage().paperConfig, props.store.theme());
              return (
                <CanvasLassoOverlay
                  leftPx={(b().x - cam().x) * cam().zoom}
                  topPx={(b().y - cam().y) * cam().zoom}
                  widthPx={b().width * cam().zoom}
                  heightPx={b().height * cam().zoom}
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

          {/* Selected Image Move / Resize Overlay (World Coordinates) */}
          <Show when={localSelectedImage()}>
            {(img) => {
              const cam = () => camera();
              const multiImages = () => currPage().images.length > 1;

              return (
                <div
                  class="canvas-image-selection"
                  style={{
                    left: `${(img().x - cam().x) * cam().zoom}px`,
                    top: `${(img().y - cam().y) * cam().zoom}px`,
                    width: `${img().width * cam().zoom}px`,
                    height: `${img().height * cam().zoom}px`,
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

          {/* Inline Canvas Text & Handwriting-to-Text (Scribble) Overlay (World Coordinates) */}
          <Show when={localEditingText()}>
            {(item) => {
              const cam = () => camera();
              return (
                <CanvasTextOverlay
                  item={item()}
                  paperConfig={currPage().paperConfig}
                  theme={props.store.theme()}
                  leftPx={(item().x - cam().x) * cam().zoom}
                  topPx={(item().y - cam().y) * cam().zoom}
                  scale={cam().zoom}
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
                    const lines = Math.max(2, curr.text.split('\n').length + 1);
                    const nextY = Math.round(curr.y + lines * curr.fontSize * 1.35 + 28);
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

          {/* Floating Back-to-Content Pill when user pans far away from drawings */}
          <Show when={isContentOffscreen() && !props.exportRegionActive}>
            <button
              type="button"
              class="infinite-return-pill"
              onClick={fitToContent}
              title="Zurück zu deinen Inhalten auf dem unendlichen Canvas"
            >
              <IconCrosshair size={14} />
              <span>Zurück zum Inhalt</span>
            </button>
          </Show>

          {/* Interactive Custom Export Region Picker Overlay */}
          <Show when={props.exportRegionActive}>
            <InfiniteExportRegionOverlay
              camera={camera()}
              viewportWidth={vpSize().width}
              viewportHeight={vpSize().height}
              region={props.exportRegion ?? null}
              contentBounds={pageContentBounds()}
              onChangeRegion={(rect) => props.onExportRegionChange?.(rect)}
              onConfirm={(rect) => props.onConfirmExportRegion?.(rect)}
              onCancel={() => props.onCancelExportRegion?.()}
              onZoomBy={(delta) => {
                const vp = vpSize();
                zoomAroundScreenPoint(camera().zoom + delta, vp.width / 2, vp.height / 2);
              }}
              onFitToContent={fitToContent}
            />
          </Show>

          {/* Floating Zoom Badge while pinching */}
          <Show when={isPinchingUi()}>
            <div class="pinch-zoom-badge is-infinite-badge" aria-live="polite">
              {Math.round(camera().zoom * 100)}%
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
