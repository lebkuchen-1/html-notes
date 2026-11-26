import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  OCCLUSION_COLORS,
  type CanvasOcclusionItem,
  type CanvasSnapshot,
  type PaperConfig,
  type StabilizationLevel,
  type Stroke,
  type StrokePoint,
  type ThemeMode,
} from '../types';
import {
  drawStroke,
  isPointHittingStroke,
  resolveStrokeColor,
} from '../utils/canvasRenderer';
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
  IconBidirectional,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconTrash,
  IconUnlink,
} from './Icons';

interface AppleTouch extends Touch {
  touchType?: 'direct' | 'stylus';
}

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
  // Direct-on-Canvas temporary practice ink during Abdeckband (`study`) mode
  studyPracticeActive?: boolean;
  studyPracticeTool?: 'pen' | 'eraser';
  studyPracticeColor?: string;
  studyPracticeWidth?: number;
  studyPracticeClearToken?: number;
  studyPracticeStylusOnly?: boolean;
  studyPracticeStabilization?: StabilizationLevel;
  studyPracticePressure?: boolean;
  paperConfig?: PaperConfig;
  theme?: ThemeMode;
  viewportSize?: { width: number; height: number };
  worldOrigin?: { x: number; y: number };
  onStudyPracticeHasStrokesChange?: (hasStrokes: boolean) => void;
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
  const isPracticeDrawOn = () => isStudyMode() && Boolean(props.studyPracticeActive);

  // Temporary practice strokes (never persisted into saved note!)
  const [practiceStrokes, setPracticeStrokes] = createSignal<Stroke[]>([]);
  let practiceBaseRef: HTMLCanvasElement | undefined;
  let practiceLiveRef: HTMLCanvasElement | undefined;
  let practiceLiveCtx: CanvasRenderingContext2D | null = null;
  let pActiveId: number | null = null;
  let pActiveType: string | null = null;
  let pActiveStroke: Stroke | null = null;
  let pStabilizer: StrokeStabilizer | null = null;
  let pPenLiveState: IncrementalPenState = createIncrementalPenState();
  let pStartTime = 0;
  let pLastMoveTime = 0;
  let pLastPt: StrokePoint | null = null;
  let pLastPenTs = 0;
  let pPendingClear = false;
  let pIsErasing = false;
  let pErasingList: Stroke[] | null = null;
  let pErasedAny = false;
  let pBaseRaf: number | null = null;
  let pLiveRaf: number | null = null;

  const clearPracticeLive = () => {
    if (practiceLiveRef && practiceLiveCtx) {
      practiceLiveCtx.clearRect(0, 0, practiceLiveRef.width, practiceLiveRef.height);
    }
  };

  const abortPracticeStroke = () => {
    if (pActiveId !== null && practiceLiveRef?.hasPointerCapture(pActiveId)) {
      try {
        practiceLiveRef.releasePointerCapture(pActiveId);
      } catch {
        // ignore
      }
    }
    pActiveId = null;
    pActiveType = null;
    pActiveStroke = null;
    pStabilizer = null;
    pPenLiveState = createIncrementalPenState();
    pIsErasing = false;
    pErasingList = null;
    pErasedAny = false;
    pLastPt = null;
    clearPracticeLive();
  };

  let lastClearToken = props.studyPracticeClearToken ?? 0;
  createEffect(() => {
    const tok = props.studyPracticeClearToken ?? 0;
    if (tok !== lastClearToken) {
      lastClearToken = tok;
      abortPracticeStroke();
      setPracticeStrokes([]);
    }
  });

  // Clear temporary practice ink automatically if user leaves study mode
  createEffect(() => {
    if (!isStudyMode() && practiceStrokes().length > 0) {
      abortPracticeStroke();
      setPracticeStrokes([]);
    }
  });

  createEffect(() => {
    props.onStudyPracticeHasStrokesChange?.(practiceStrokes().length > 0);
  });

  const getPracticeOrigin = () => props.worldOrigin ?? { x: 0, y: 0 };

  const syncPracticeCanvases = () => {
    const vp = props.viewportSize;
    const cssW = Math.max(1, Math.round(vp?.width ?? practiceBaseRef?.clientWidth ?? 1));
    const cssH = Math.max(1, Math.round(vp?.height ?? practiceBaseRef?.clientHeight ?? 1));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxDim = 2600;
    const clampedDpr = Math.min(dpr, maxDim / Math.max(cssW, cssH, 1));
    const targetW = Math.max(1, Math.round(cssW * clampedDpr));
    const targetH = Math.max(1, Math.round(cssH * clampedDpr));
    if (practiceBaseRef && (practiceBaseRef.width !== targetW || practiceBaseRef.height !== targetH)) {
      practiceBaseRef.width = targetW;
      practiceBaseRef.height = targetH;
    }
    if (practiceLiveRef && (practiceLiveRef.width !== targetW || practiceLiveRef.height !== targetH)) {
      practiceLiveRef.width = targetW;
      practiceLiveRef.height = targetH;
      practiceLiveCtx = practiceLiveRef.getContext('2d');
    }
    return { dpr: clampedDpr, targetW, targetH };
  };

  const renderPracticeBaseNow = () => {
    pBaseRaf = null;
    if (!practiceBaseRef) return;
    const { dpr, targetW, targetH } = syncPracticeCanvases();
    const ctx = practiceBaseRef.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, targetW, targetH);

    const list = pIsErasing && pErasingList ? pErasingList : practiceStrokes();
    if (list.length > 0 && props.paperConfig) {
      const origin = getPracticeOrigin();
      const s = Math.max(0.1, props.scale);
      ctx.save();
      ctx.scale(dpr * s, dpr * s);
      ctx.translate(-origin.x, -origin.y);
      for (const stroke of list) {
        drawStroke(ctx, stroke, props.paperConfig, props.theme ?? 'light');
      }
      ctx.restore();
    }

    if (pPendingClear) {
      pPendingClear = false;
      if (!pActiveStroke) clearPracticeLive();
    }
  };

  const schedulePracticeBase = () => {
    if (pBaseRaf === null) pBaseRaf = requestAnimationFrame(renderPracticeBaseNow);
  };

  const renderPracticeLiveNow = () => {
    pLiveRaf = null;
    if (!practiceLiveRef) return;
    const { dpr, targetW, targetH } = syncPracticeCanvases();
    if (!practiceLiveCtx) practiceLiveCtx = practiceLiveRef.getContext('2d');
    const ctx = practiceLiveCtx;
    if (!ctx) return;

    if (pActiveStroke && pActiveStroke.tool === 'pen' && props.paperConfig) {
      const origin = getPracticeOrigin();
      const s = Math.max(0.1, props.scale);
      const totalScale = dpr * s;
      const offsetX = -origin.x * totalScale;
      const offsetY = -origin.y * totalScale;
      const pts = pActiveStroke.points;
      const color = resolveStrokeColor(
        pActiveStroke.color,
        props.paperConfig,
        props.theme ?? 'light'
      );
      if (pPenLiveState.drawnCount === 0 && pts.length > 0) {
        ctx.clearRect(0, 0, targetW, targetH);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        drawPenStartDot(ctx, pActiveStroke, pts[0], color, totalScale, pPenLiveState);
        ctx.restore();
      }
      if (pPenLiveState.drawnCount < pts.length) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        while (pPenLiveState.drawnCount < pts.length) {
          const prev = pts[pPenLiveState.drawnCount - 1];
          const curr = pts[pPenLiveState.drawnCount];
          drawPenLiveStep(ctx, pActiveStroke, prev, curr, color, totalScale, pPenLiveState);
        }
        ctx.restore();
      }
      return;
    }

    ctx.clearRect(0, 0, targetW, targetH);
  };

  const schedulePracticeLive = () => {
    if (pLiveRaf === null) pLiveRaf = requestAnimationFrame(renderPracticeLiveNow);
  };

  createEffect(() => {
    void isStudyMode();
    void isPracticeDrawOn();
    void practiceStrokes();
    void props.scale;
    void props.viewportSize?.width;
    void props.viewportSize?.height;
    void props.worldOrigin?.x;
    void props.worldOrigin?.y;
    void props.theme;
    if (isStudyMode() && (isPracticeDrawOn() || practiceStrokes().length > 0)) {
      schedulePracticeBase();
    }
  });

  const toPracticeWorldPoint = (
    e: PointerEvent,
    explicitType?: string,
    explicitTs?: number
  ): StrokePoint => {
    const rect = practiceLiveRef!.getBoundingClientRect();
    const origin = getPracticeOrigin();
    const s = Math.max(0.1, props.scale);
    const x = origin.x + (e.clientX - rect.left) / s;
    const y = origin.y + (e.clientY - rect.top) / s;

    const evTime = explicitTs ?? (e.timeStamp || performance.now());
    const relTime = pStartTime > 0 ? Math.max(0, Math.round(evTime - pStartTime)) : 0;
    const pType = explicitType || e.pointerType;
    let pressure = 0.55;
    if (props.studyPracticePressure !== false) {
      pressure = pLastPt?.pressure ?? 0.52;
      if (pType === 'pen') {
        const raw = e.pressure > 0.005 ? Math.min(1, Math.max(0.05, e.pressure)) : pressure;
        const smooth = pStabilizer?.pressureSmoothing ?? 0.55;
        pressure = pLastPt ? pLastPt.pressure * smooth + raw * (1 - smooth) : raw;
      } else if (pLastPt && pLastMoveTime > 0) {
        const dt = Math.max(1, evTime - pLastMoveTime);
        const dist = Math.hypot(x - pLastPt.x, y - pLastPt.y) * s;
        const vel = dist / dt;
        const target = Math.max(0.28, Math.min(0.88, 0.78 - vel * 0.28));
        pressure = pLastPt.pressure * 0.65 + target * 0.35;
      }
    }
    return { x, y, pressure, t: relTime };
  };

  const finalizePracticeStroke = (cancelled = false) => {
    const pid = pActiveId;
    if (pid !== null && practiceLiveRef?.hasPointerCapture(pid)) {
      try {
        practiceLiveRef.releasePointerCapture(pid);
      } catch {
        // ignore
      }
    }
    const wasPen = pActiveType === 'pen';
    pActiveId = null;
    pActiveType = null;
    pLastPt = null;

    if (pIsErasing) {
      if (pErasedAny && pErasingList) {
        setPracticeStrokes(pErasingList);
      }
      pIsErasing = false;
      pErasingList = null;
      pErasedAny = false;
      schedulePracticeBase();
      schedulePracticeLive();
      return;
    }

    if (pActiveStroke) {
      const finished = pActiveStroke;
      const stab = pStabilizer;
      pActiveStroke = null;
      pStabilizer = null;
      pPenLiveState = createIncrementalPenState();

      if (!(cancelled && !wasPen) && finished.points.length > 0) {
        if (stab) finished.points = stab.finalize(finished.points);
        const compacted = optimizeStroke(finished);
        pPendingClear = true;
        setPracticeStrokes((prev) => [...prev, compacted]);
      } else {
        clearPracticeLive();
      }
    } else {
      pStabilizer = null;
    }
  };

  const handlePracticePointerDown = (e: PointerEvent) => {
    if (!isPracticeDrawOn() || !practiceLiveRef) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const now = Date.now();
    const isStylusEraser =
      e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);

    if (e.pointerType === 'pen') {
      pLastPenTs = now;
    }
    if (e.pointerType === 'touch') {
      const isLargePalm = e.width > 34 || e.height > 34;
      if (props.studyPracticeStylusOnly || now - pLastPenTs < 1200 || isLargePalm || pActiveType === 'pen') {
        return;
      }
    }

    if (pActiveId !== null) {
      if (e.pointerType === 'pen') finalizePracticeStroke(false);
      else return;
    }

    e.preventDefault();
    e.stopPropagation();

    pActiveId = e.pointerId;
    pActiveType = e.pointerType;
    try {
      practiceLiveRef.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    pLastPt = null;
    const startTs = e.timeStamp || performance.now();
    pStartTime = startTs;
    pLastMoveTime = startTs;

    if (isStylusEraser || props.studyPracticeTool === 'eraser') {
      pIsErasing = true;
      pErasedAny = false;
      pErasingList = [...practiceStrokes()];
      const pt = toPracticeWorldPoint(e, e.pointerType, startTs);
      pLastPt = pt;
      const rad = 16 / Math.max(0.35, props.scale);
      const before = pErasingList.length;
      pErasingList = pErasingList.filter((st) => !isPointHittingStroke(pt, st, rad));
      if (pErasingList.length !== before) {
        pErasedAny = true;
        schedulePracticeBase();
      }
      return;
    }

    pStabilizer = new StrokeStabilizer(props.studyPracticeStabilization ?? 'light');
    const rawPt = toPracticeWorldPoint(e, e.pointerType, startTs);
    const pt = pStabilizer.filter(rawPt, startTs);
    pLastPt = pt;
    pPenLiveState = createIncrementalPenState();
    pPendingClear = false;
    const chosenColor =
      props.studyPracticeColor && props.studyPracticeColor !== 'auto'
        ? props.studyPracticeColor
        : '#dc2626';
    pActiveStroke = {
      id: generateId(),
      tool: 'pen',
      penStyle: 'ballpoint',
      color: chosenColor,
      width: Math.max(2, props.studyPracticeWidth ?? 3.4),
      opacity: 1,
      points: [pt],
    };
    schedulePracticeLive();
  };

  const handlePracticePointerMove = (e: PointerEvent) => {
    if (pActiveId === null || e.pointerId !== pActiveId || !practiceLiveRef) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.pointerType === 'pen') pLastPenTs = Date.now();

    const pType = pActiveType || e.pointerType;
    const coalesced =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e];
    const minDist = (pStabilizer?.minSpacing ?? 1.1) / Math.max(0.4, props.scale);
    let erasedNow = false;

    for (const ev of events) {
      if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) continue;
      if (ev !== e && ev.clientX === 0 && ev.clientY === 0 && Math.hypot(e.clientX, e.clientY) > 12) {
        continue;
      }
      const evTime = ev.timeStamp || e.timeStamp || performance.now();
      const rawPt = toPracticeWorldPoint(ev, pType, evTime);
      pLastMoveTime = evTime;

      if (pIsErasing && pErasingList) {
        const rad = 16 / Math.max(0.35, props.scale);
        const before = pErasingList.length;
        pErasingList = pErasingList.filter((st) => !isPointHittingStroke(rawPt, st, rad));
        if (pErasingList.length !== before) {
          pErasedAny = true;
          erasedNow = true;
        }
        pLastPt = rawPt;
        continue;
      }

      if (!pActiveStroke) continue;
      const pt = pStabilizer ? pStabilizer.filter(rawPt, evTime) : rawPt;
      if (!pLastPt || Math.hypot(pt.x - pLastPt.x, pt.y - pLastPt.y) >= minDist) {
        pActiveStroke.points.push(pt);
        pLastPt = pt;
      }
    }
    if (erasedNow) schedulePracticeBase();
    schedulePracticeLive();
  };

  onMount(() => {
    const onWinEnd = (e: PointerEvent) => {
      if (pActiveId !== null && e.pointerId === pActiveId) {
        finalizePracticeStroke(e.type === 'pointercancel');
      }
    };
    window.addEventListener('pointerup', onWinEnd);
    window.addEventListener('pointercancel', onWinEnd);
    onCleanup(() => {
      window.removeEventListener('pointerup', onWinEnd);
      window.removeEventListener('pointercancel', onWinEnd);
      if (pBaseRaf !== null) cancelAnimationFrame(pBaseRaf);
      if (pLiveRaf !== null) cancelAnimationFrame(pLiveRaf);
    });
  });

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
                  'is-practice-surface': isPracticeDrawOn(),
                  'is-revealed': isRevealed(),
                  'is-interactive':
                    isEditInteractive() || (isStudyMode() && !isPracticeDrawOn()),
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

        {/* Temporary Direct-on-Canvas Practice Ink Layer (Abdeckband Self-Test!) */}
        <Show when={isStudyMode() && (isPracticeDrawOn() || practiceStrokes().length > 0)}>
          <canvas
            ref={practiceBaseRef}
            class="canvas-occ-practice-canvas is-base"
          />
          <Show when={isPracticeDrawOn()}>
            <canvas
              ref={(el) => {
                practiceLiveRef = el;
                practiceLiveCtx = el.getContext('2d');
                el.addEventListener(
                  'touchstart',
                  (e: TouchEvent) => {
                    for (let i = 0; i < e.touches.length; i++) {
                      if ((e.touches[i] as AppleTouch).touchType === 'stylus') {
                        if (e.cancelable) e.preventDefault();
                        return;
                      }
                    }
                    if (!props.studyPracticeStylusOnly && e.touches.length === 1) {
                      if (e.cancelable) e.preventDefault();
                    }
                  },
                  { passive: false }
                );
              }}
              class="canvas-occ-practice-canvas is-live"
              classList={{
                'is-stylus-only': Boolean(props.studyPracticeStylusOnly),
                'is-eraser': props.studyPracticeTool === 'eraser',
              }}
              onPointerDown={handlePracticePointerDown}
              onPointerMove={handlePracticePointerMove}
              onPointerUp={(e) => {
                if (pActiveId !== null && e.pointerId === pActiveId) {
                  finalizePracticeStroke(false);
                }
              }}
              onPointerCancel={(e) => {
                if (pActiveId !== null && e.pointerId === pActiveId) {
                  finalizePracticeStroke(true);
                }
              }}
              onLostPointerCapture={() => {
                if (pActiveId !== null) finalizePracticeStroke(false);
              }}
              onContextMenu={(e) => e.preventDefault()}
            />

            {/* Per-box corner peek buttons floating above practice ink so you can reveal any single spot while drawing! */}
            <For each={props.occlusions}>
              {(occ) => {
                const rect = () => props.toScreenRect(occ);
                const rev = () => props.revealedIds.has(occ.id);
                return (
                  <button
                    type="button"
                    class="occ-practice-peek-btn"
                    classList={{ 'is-revealed': rev() }}
                    style={{
                      left: `${rect().left + rect().width - 24}px`,
                      top: `${rect().top - 10}px`,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onToggleReveal(occ.id);
                    }}
                    title={
                      rev()
                        ? 'Stelle wieder verdecken'
                        : 'Stelle direkt unter deiner Zeichnung aufdecken & vergleichen'
                    }
                    aria-label={rev() ? 'Wieder verdecken' : 'Aufdecken zum Vergleichen'}
                  >
                    <Show when={rev()} fallback={<IconEye size={12} />}>
                      <IconEyeOff size={12} />
                    </Show>
                  </button>
                );
              }}
            </For>
          </Show>
        </Show>
      </div>
    </Show>
  );
}

export { IconEyeOff };
