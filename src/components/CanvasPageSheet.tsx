import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import type {
  CanvasFontFamily,
  CanvasImageItem,
  CanvasPage,
  CanvasSnapshot,
  CanvasTextItem,
  DrawingTool,
  Stroke,
  StrokePoint,
} from '../types';
import {
  getCanvasFontFamilyCss,
  isPaperDark,
  isPointHittingImage,
  isPointHittingStroke,
  isPointHittingText,
  renderFullCanvas,
  resolvePaperBackgroundColor,
  resolveStrokeColor,
} from '../utils/canvasRenderer';
import { extractImageFilesFromTransfer } from '../utils/imageImport';
import { extractPdfFilesFromTransfer } from '../utils/pageImport';
import { generateId } from '../utils/storage';
import {
  IconBringFront,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconMove,
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

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

const FONT_FAMILIES: { value: CanvasFontFamily; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'hand', label: 'Hand' },
  { value: 'mono', label: 'Mono' },
];

interface CanvasPageSheetProps {
  store: NotesStore;
  pageId: string;
  pageNumber: number;
  totalPages: number;
  cssScale: number;
  tool: DrawingTool;
  penColor: string;
  highlighterColor: string;
  penWidth: number;
  highlighterWidth: number;
  eraserSize: number;
  textFontSize: number;
  textFontFamily: CanvasFontFamily;
  textBold: boolean;
  stylusOnly: boolean;
  editingText: EditingTextState | null;
  selectedImage: SelectedImageState | null;
  onPointerTypeChange: (type: string) => void;
  onSetEditingText: (next: EditingTextState | null) => void;
  onCommitEditingText: () => void;
  onSetSelectedImage: (next: SelectedImageState | null) => void;
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
}

export function CanvasPageSheet(props: CanvasPageSheetProps) {
  const [hoveredTextId, setHoveredTextId] = createSignal<string | null>(null);
  const [isSheetDragOver, setIsSheetDragOver] = createSignal<boolean>(false);

  let canvasRef: HTMLCanvasElement | undefined;
  let textInputRef: HTMLTextAreaElement | undefined;

  // Imperative 120Hz drawing state local to this page sheet
  let activePointerId: number | null = null;
  let activeStroke: Stroke | null = null;
  let isErasing = false;
  let erasingStrokes: Stroke[] | null = null;
  let erasingTexts: CanvasTextItem[] | null = null;
  let erasedSomething = false;
  let eraserCursor: { x: number; y: number } | null = null;
  let lastMoveTime = 0;
  let lastPoint: StrokePoint | null = null;
  let rafId: number | null = null;

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

  const renderNow = () => {
    rafId = null;
    const canvas = canvasRef;
    const p = page();
    if (!canvas || !p) return;

    const { width, height } = cssSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const renderScale = targetW / p.width;
    const effectivePage =
      isErasing && erasingStrokes && erasingTexts
        ? { ...p, strokes: erasingStrokes, texts: erasingTexts }
        : p;

    renderFullCanvas(ctx, effectivePage, activeStroke, props.store.theme(), renderScale, {
      editingTextId: localEditingText()?.id ?? null,
      hoveredTextId:
        props.tool === 'text' || props.tool === 'select' ? hoveredTextId() : null,
      onImageLoad: scheduleRender,
    });

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

  const scheduleRender = () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(renderNow);
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
    scheduleRender();
  });

  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    props.registerElement(props.pageId, null);
  });

  const toLogicalPoint = (e: PointerEvent): StrokePoint => {
    const canvas = canvasRef!;
    const p = page()!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * p.width;
    const y = ((e.clientY - rect.top) / rect.height) * p.height;

    let pressure = 0.5;
    if (e.pointerType === 'pen') {
      pressure = e.pressure > 0 ? Math.min(1, Math.max(0.12, e.pressure)) : 0.5;
    } else if (lastPoint && lastMoveTime > 0) {
      const dt = Math.max(1, e.timeStamp - lastMoveTime);
      const dist = Math.hypot(x - lastPoint.x, y - lastPoint.y);
      const velocity = dist / dt;
      const target = Math.max(0.28, Math.min(0.88, 0.78 - velocity * 0.28));
      pressure = lastPoint.pressure * 0.65 + target * 0.35;
    }

    return { x, y, pressure };
  };

  const findTextAtPoint = (pt: Pick<StrokePoint, 'x' | 'y'>): CanvasTextItem | null => {
    const p = page();
    const ctx = canvasRef?.getContext('2d');
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

  const eraseAtPoint = (pt: StrokePoint) => {
    if (!erasingStrokes || !erasingTexts) return;
    const radius = props.eraserSize;
    const beforeStrokes = erasingStrokes.length;
    erasingStrokes = erasingStrokes.filter(
      (stroke) => !isPointHittingStroke(pt, stroke, radius)
    );
    if (erasingStrokes.length !== beforeStrokes) {
      erasedSomething = true;
    }

    const ctx = canvasRef?.getContext('2d');
    if (ctx) {
      const beforeTexts = erasingTexts.length;
      erasingTexts = erasingTexts.filter(
        (item) => !isPointHittingText(ctx, pt, item, radius * 0.65)
      );
      if (erasingTexts.length !== beforeTexts) {
        erasedSomething = true;
      }
    }
  };

  const openTextEditorAt = (pt: StrokePoint, onlyExisting = false) => {
    const p = page();
    if (!p) return false;

    if (props.editingText) {
      props.onCommitEditingText();
    }

    const hit = findTextAtPoint(pt);
    if (hit) {
      props.onSetSelectedImage(null);
      props.onSetEditingText({ pageId: props.pageId, item: { ...hit } });
      props.onSyncTextStyle({
        fontSize: hit.fontSize,
        fontFamily: hit.fontFamily,
        bold: hit.bold,
      });
      requestAnimationFrame(() => textInputRef?.focus());
      return true;
    }

    if (onlyExisting) return false;

    const clampedX = Math.max(16, Math.min(p.width - 140, pt.x));
    const clampedY = Math.max(12, Math.min(p.height - 50, pt.y - props.textFontSize * 0.5));
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
      },
    });
    requestAnimationFrame(() => textInputRef?.focus());
    return true;
  };

  const handlePointerDown = (e: PointerEvent) => {
    const p = page();
    if (!p || !canvasRef) return;

    const isStylusEraser =
      e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // Activate this page immediately when interacting with it in continuous scroll view
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

    if (props.tool === 'text' && !isStylusEraser) {
      e.preventDefault();
      props.onPointerTypeChange(e.pointerType);
      const pt = toLogicalPoint(e);
      openTextEditorAt(pt, false);
      return;
    }

    if (props.editingText) props.onCommitEditingText();
    if (props.selectedImage) props.onSetSelectedImage(null);

    if (props.stylusOnly && e.pointerType === 'touch') {
      return;
    }

    if (activePointerId !== null) return;

    e.preventDefault();
    props.onPointerTypeChange(e.pointerType);
    activePointerId = e.pointerId;
    canvasRef.setPointerCapture(e.pointerId);

    lastPoint = null;
    lastMoveTime = e.timeStamp;
    const pt = toLogicalPoint(e);
    lastPoint = pt;

    const currentTool = isStylusEraser ? 'eraser' : props.tool;

    if (currentTool === 'eraser') {
      isErasing = true;
      erasedSomething = false;
      erasingStrokes = [...p.strokes];
      erasingTexts = [...p.texts];
      eraserCursor = { x: pt.x, y: pt.y };
      eraseAtPoint(pt);
      scheduleRender();
      return;
    }

    if (currentTool === 'text' || currentTool === 'select') return;

    const isHighlighter = currentTool === 'highlighter';
    activeStroke = {
      id: generateId(),
      tool: currentTool,
      color: isHighlighter ? props.highlighterColor : props.penColor,
      width: isHighlighter ? props.highlighterWidth : props.penWidth,
      opacity: isHighlighter ? 0.38 : 1,
      points: [pt],
    };
    scheduleRender();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!canvasRef || !page()) return;

    if (activePointerId === null) {
      if (props.tool === 'eraser' && e.pointerType !== 'touch') {
        const pt = toLogicalPoint(e);
        eraserCursor = { x: pt.x, y: pt.y };
        scheduleRender();
      } else if (
        (props.tool === 'text' || props.tool === 'select') &&
        e.pointerType !== 'touch'
      ) {
        const pt = toLogicalPoint(e);
        const hit = findTextAtPoint(pt);
        setHoveredTextId(hit?.id ?? null);
      }
      return;
    }

    if (e.pointerId !== activePointerId) return;
    e.preventDefault();

    const events =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const sourceEvents = events.length > 0 ? events : [e];

    for (const ev of sourceEvents) {
      const pt = toLogicalPoint(ev);
      lastMoveTime = ev.timeStamp;

      if (isErasing) {
        eraserCursor = { x: pt.x, y: pt.y };
        eraseAtPoint(pt);
        lastPoint = pt;
        continue;
      }

      if (!activeStroke) continue;

      if (activeStroke.tool === 'pen' || activeStroke.tool === 'highlighter') {
        if (
          !lastPoint ||
          Math.hypot(pt.x - lastPoint.x, pt.y - lastPoint.y) >= 1.2
        ) {
          activeStroke.points.push(pt);
          lastPoint = pt;
        }
      } else {
        if (activeStroke.points.length === 1) {
          activeStroke.points.push(pt);
        } else {
          activeStroke.points[1] = pt;
        }
        lastPoint = pt;
      }
    }

    scheduleRender();
  };

  const finishPointerInteraction = (e: PointerEvent) => {
    if (activePointerId !== e.pointerId) return;
    if (canvasRef?.hasPointerCapture(e.pointerId)) {
      canvasRef.releasePointerCapture(e.pointerId);
    }
    activePointerId = null;
    lastPoint = null;

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
      if (e.pointerType === 'touch') eraserCursor = null;
      scheduleRender();
      return;
    }

    if (activeStroke) {
      const finished = activeStroke;
      activeStroke = null;
      const isShape =
        finished.tool !== 'pen' && finished.tool !== 'highlighter';
      if (!isShape || finished.points.length >= 2) {
        props.store.addStroke(finished, props.pageId);
      }
      scheduleRender();
    }
  };

  const handlePointerLeave = () => {
    if (activePointerId === null && eraserCursor) {
      eraserCursor = null;
      scheduleRender();
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

          {/* The Sheet Canvas itself */}
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
              if (canvasRef) {
                const rect = canvasRef.getBoundingClientRect();
                dropPt = {
                  x: ((e.clientX - rect.left) / rect.width) * currPage().width,
                  y: ((e.clientY - rect.top) / rect.height) * currPage().height,
                };
              }
              props.onImportFilesAt(props.pageId, files, dropPt);
            }}
          >
            <canvas
              ref={canvasRef}
              class="drawing-canvas"
              classList={{
                'is-eraser': props.tool === 'eraser',
                'is-text-tool': props.tool === 'text',
                'is-select-tool': props.tool === 'select',
                'is-stylus-only':
                  props.stylusOnly && props.tool !== 'text' && props.tool !== 'select',
              }}
              style={{
                width: `${cssSize().width}px`,
                height: `${cssSize().height}px`,
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointerInteraction}
              onPointerCancel={finishPointerInteraction}
              onPointerLeave={handlePointerLeave}
            />

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

            {/* Inline Canvas Text Editor Overlay */}
            <Show when={localEditingText()}>
              {(item) => {
                const scale = () => cssSize().scale;
                const resolvedColor = () =>
                  resolveStrokeColor(
                    item().color,
                    currPage().paperConfig,
                    props.store.theme()
                  );
                const lineCount = () => Math.max(1, item().text.split('\n').length);
                const longestLine = () =>
                  Math.max(
                    12,
                    ...item()
                      .text.split('\n')
                      .map((l) => l.length + 2)
                  );

                return (
                  <div
                    class="canvas-text-overlay"
                    style={{
                      left: `${item().x * scale()}px`,
                      top: `${item().y * scale()}px`,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div class="canvas-text-bar">
                      <button
                        type="button"
                        class="ctb-btn ctb-drag"
                        onPointerDown={startTextDrag}
                        onPointerMove={moveTextDrag}
                        onPointerUp={endTextDrag}
                        onPointerCancel={endTextDrag}
                        title="Textfeld verschieben"
                      >
                        <IconMove size={13} />
                      </button>

                      <button
                        type="button"
                        class="ctb-btn ctb-bold"
                        classList={{ 'is-active': item().bold }}
                        onClick={() => {
                          const nextBold = !item().bold;
                          props.onSyncTextStyle({ bold: nextBold });
                          props.onSetEditingText({
                            pageId: props.pageId,
                            item: { ...item(), bold: nextBold },
                          });
                        }}
                        title="Fett"
                      >
                        B
                      </button>

                      <select
                        class="ctb-select"
                        value={item().fontFamily}
                        onChange={(e) => {
                          const nextFamily = e.currentTarget.value as CanvasFontFamily;
                          props.onSyncTextStyle({ fontFamily: nextFamily });
                          props.onSetEditingText({
                            pageId: props.pageId,
                            item: { ...item(), fontFamily: nextFamily },
                          });
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
                          const nextSize = Math.max(14, item().fontSize - 3);
                          props.onSyncTextStyle({ fontSize: nextSize });
                          props.onSetEditingText({
                            pageId: props.pageId,
                            item: { ...item(), fontSize: nextSize },
                          });
                        }}
                        title="Kleiner"
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        class="ctb-btn"
                        onClick={() => {
                          const nextSize = Math.min(60, item().fontSize + 3);
                          props.onSyncTextStyle({ fontSize: nextSize });
                          props.onSetEditingText({
                            pageId: props.pageId,
                            item: { ...item(), fontSize: nextSize },
                          });
                        }}
                        title="Größer"
                      >
                        A+
                      </button>

                      <button
                        type="button"
                        class="ctb-btn is-danger"
                        onClick={() => {
                          const id = item().id;
                          props.onSetEditingText(null);
                          props.store.deleteCanvasText(id, props.pageId);
                        }}
                        title="Text löschen"
                      >
                        <IconTrash size={13} />
                      </button>

                      <button
                        type="button"
                        class="ctb-btn is-confirm"
                        onClick={props.onCommitEditingText}
                        title="Übernehmen (Strg+Enter)"
                      >
                        <IconCheck size={13} />
                      </button>
                    </div>

                    <textarea
                      ref={(el) => {
                        textInputRef = el;
                        if (el.value !== item().text) el.value = item().text;
                      }}
                      class="canvas-text-input"
                      rows={lineCount()}
                      cols={Math.min(48, longestLine())}
                      placeholder="Text eingeben…"
                      style={{
                        color: resolvedColor(),
                        'font-size': `${item().fontSize * scale()}px`,
                        'font-family': getCanvasFontFamilyCss(item().fontFamily),
                        'font-weight': item().bold ? '700' : '400',
                        'line-height': '1.35',
                      }}
                      onInput={(e) => {
                        props.onSetEditingText({
                          pageId: props.pageId,
                          item: { ...item(), text: e.currentTarget.value },
                        });
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Escape' ||
                          ((e.ctrlKey || e.metaKey) && e.key === 'Enter')
                        ) {
                          e.preventDefault();
                          props.onCommitEditingText();
                        }
                      }}
                    />
                  </div>
                );
              }}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
