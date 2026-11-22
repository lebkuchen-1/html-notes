import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { NotesStore } from '../store/notesStore';
import {
  DEFAULT_PAPER_CONFIG,
  MAX_PAGE_HEIGHT,
  MAX_PAGE_WIDTH,
  MIN_PAGE_DIMENSION,
  PAGE_SIZE_PRESETS,
  type CanvasFontFamily,
  type CanvasImageItem,
  type CanvasTextItem,
  type DrawingTool,
  type PaperPattern,
  type PenStyle,
} from '../types';
import {
  exportCanvasToPng,
  exportInfiniteCanvasToPng,
  isPaperDark,
  resolvePaperBackgroundColor,
} from '../utils/canvasRenderer';
import {
  BRUSH_DYNAMICS_PRESETS,
  createPenPreviewStroke,
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_FOUNTAIN_FLATNESS,
  DEFAULT_FOUNTAIN_NIB_ANGLE,
  drawStyledPenStroke,
  FOUNTAIN_ANGLE_PRESETS,
  PEN_STYLE_CONFIGS,
  PEN_STYLE_ORDER,
} from '../utils/penEngine';
import {
  extractImageFilesFromTransfer,
  processImageFile,
} from '../utils/imageImport';
import {
  deleteLassoSelection,
  duplicateLassoSelection,
  extractLassoClipboard,
  formatLassoCountLabel,
  getLassoClipboard,
  getLassoItemCount,
  pasteLassoClipboard,
  recolorLassoSelection,
  setLassoClipboard,
  type LassoSelection,
} from '../utils/lasso';
import {
  extractPdfFilesFromTransfer,
  importFilesAsPages,
} from '../utils/pageImport';
import { generateId, PAPER_PRESETS } from '../utils/storage';
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
  CanvasPageSheet,
  getLastGlobalPenTimestamp,
  isAnyPenStrokeActive,
  markGlobalPenActivity,
  type EditingTextState,
  type SelectedImageState,
} from './CanvasPageSheet';
import {
  InfiniteCanvasView,
  type InfiniteCanvasHandle,
} from './InfiniteCanvasView';
import { ColorPickerPopover } from './ColorPickerPopover';
import {
  IconArrow,
  IconBallpointPen,
  IconBrushPen,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClipboardPaste,
  IconCrosshair,
  IconDownload,
  IconEllipse,
  IconEraser,
  IconFileUp,
  IconFountainPen,
  IconGrid,
  IconHighlighter,
  IconImage,
  IconInfinity,
  IconLasso,
  IconLine,
  IconMaximize,
  IconPages,
  IconPlus,
  IconPointer,
  IconRect,
  IconRedo,
  IconRotateCcw,
  IconRuler,
  IconScribble,
  IconStylus,
  IconSwap,
  IconText,
  IconTrash,
  IconUndo,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from './Icons';
import { PageOverview } from './PageOverview';

interface DrawingCanvasProps {
  store: NotesStore;
}

const DEFAULT_PEN_COLORS = [
  { value: 'auto', label: 'Tinte (Auto)' },
  { value: '#4f46e5', label: 'Indigo' },
  { value: '#2563eb', label: 'Blau' },
  { value: '#dc2626', label: 'Rot' },
  { value: '#059669', label: 'Smaragd' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#9333ea', label: 'Violett' },
] as const;

const DEFAULT_HIGHLIGHTER_COLORS = [
  { value: '#fde047', label: 'Gelb' },
  { value: '#86efac', label: 'Grün' },
  { value: '#7dd3fc', label: 'Hellblau' },
  { value: '#f9a8d4', label: 'Pink' },
  { value: '#fdba74', label: 'Pfirsich' },
] as const;

const COLOR_LABEL_MAP = new Map<string, string>(
  [...DEFAULT_PEN_COLORS, ...DEFAULT_HIGHLIGHTER_COLORS].map((c) => [
    c.value.toLowerCase(),
    c.label,
  ])
);

function getColorLabel(value: string): string {
  return COLOR_LABEL_MAP.get(value.toLowerCase()) ?? value.toUpperCase();
}

const LINE_COLOR_SWATCHES = [
  { value: 'auto', label: 'Auto' },
  { value: '#64748b', label: 'Schiefer' },
  { value: '#9c8c74', label: 'Sepia' },
  { value: '#3b82f6', label: 'Blau' },
  { value: '#059669', label: 'Grün' },
  { value: '#a855f7', label: 'Violett' },
  { value: '#e2e8f0', label: 'Hell' },
];

const SHAPE_SIZES = [
  { label: 'S', value: 2 },
  { label: 'M', value: 3.2 },
  { label: 'L', value: 5.5 },
  { label: 'XL', value: 9 },
];

const PATTERN_OPTIONS: { value: PaperPattern; label: string }[] = [
  { value: 'blank', label: 'Blanko' },
  { value: 'lined', label: 'Zeilen' },
  { value: 'grid', label: 'Kästchen' },
  { value: 'dots', label: 'Punkte' },
];

const LEADING_TOOL_ITEMS: { id: DrawingTool; label: string }[] = [
  { id: 'select', label: 'Auswählen & Verschieben' },
  { id: 'lasso', label: 'Lasso (Einkreisen, Verschieben & Skalieren)' },
];

const TRAILING_TOOL_ITEMS: { id: DrawingTool; label: string }[] = [
  { id: 'scribble', label: 'Handschrift → Text (Kritzeln)' },
  { id: 'highlighter', label: 'Textmarker' },
  { id: 'text', label: 'Text auf Canvas' },
  { id: 'line', label: 'Linie' },
  { id: 'arrow', label: 'Pfeil' },
  { id: 'rect', label: 'Rechteck' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'eraser', label: 'Radierer' },
];

function PenPreviewCanvas(props: {
  penStyle: PenStyle;
  color: string;
  width: number;
  nibAngle: number;
  nibFlatness: number;
  brushDynamics: number;
}) {
  let canvasRef: HTMLCanvasElement | undefined;

  createEffect(() => {
    const canvas = canvasRef;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = 196;
    const cssH = 42;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, targetW, targetH);
    ctx.save();
    ctx.scale(dpr, dpr);
    const sample = createPenPreviewStroke(props.penStyle, props.color, props.width, {
      nibAngle: props.nibAngle,
      nibFlatness: props.nibFlatness,
      brushDynamics: props.brushDynamics,
    });
    drawStyledPenStroke(ctx, sample, props.color);
    ctx.restore();
  });

  return <canvas ref={canvasRef} class="pen-preview-canvas" width={196} height={42} />;
}

const QUICK_APPEND_PRESETS = [
  { label: 'A4 Hoch', width: 794, height: 1123 },
  { label: 'A4 Quer', width: 1123, height: 794 },
  { label: '16:9 Whiteboard', width: 1280, height: 720 },
  { label: 'Quadrat', width: 1000, height: 1000 },
];

interface AppleTouch extends Touch {
  touchType?: 'direct' | 'stylus';
}

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 3.5;

const PEN_COLOR_KEY = 'solid-notes:pen-color';
const HIGHLIGHTER_COLOR_KEY = 'solid-notes:highlighter-color';
const PEN_PALETTE_KEY = 'solid-notes:pen-palette';
const HIGHLIGHTER_PALETTE_KEY = 'solid-notes:highlighter-palette';
const PEN_COLOR_INDEX_KEY = 'solid-notes:pen-color-index';
const HIGHLIGHTER_COLOR_INDEX_KEY = 'solid-notes:highlighter-color-index';
const PEN_STYLE_KEY = 'solid-notes:pen-style';
const PEN_WIDTHS_KEY = 'solid-notes:pen-widths';
const FOUNTAIN_ANGLE_KEY = 'solid-notes:fountain-nib-angle';
const FOUNTAIN_FLATNESS_KEY = 'solid-notes:fountain-flatness';
const BRUSH_DYNAMICS_KEY = 'solid-notes:brush-dynamics';

function loadStoredPenStyle(): PenStyle {
  try {
    const raw = localStorage.getItem(PEN_STYLE_KEY);
    if (raw === 'ballpoint' || raw === 'fountain' || raw === 'brush') return raw;
  } catch {
    // ignore
  }
  return 'ballpoint';
}

function loadStoredPenWidths(): Record<PenStyle, number> {
  const defaults: Record<PenStyle, number> = {
    ballpoint: PEN_STYLE_CONFIGS.ballpoint.defaultWidth,
    fountain: PEN_STYLE_CONFIGS.fountain.defaultWidth,
    brush: PEN_STYLE_CONFIGS.brush.defaultWidth,
  };
  try {
    const raw = localStorage.getItem(PEN_WIDTHS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const out = { ...defaults };
    for (const style of PEN_STYLE_ORDER) {
      const cfg = PEN_STYLE_CONFIGS[style];
      const val = parsed[style];
      if (typeof val === 'number' && Number.isFinite(val)) {
        out[style] = Math.max(cfg.minWidth, Math.min(cfg.maxWidth, val));
      }
    }
    return out;
  } catch {
    return defaults;
  }
}

function loadStoredNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const val = Number(raw);
      if (Number.isFinite(val)) return Math.max(min, Math.min(max, val));
    }
  } catch {
    // ignore
  }
  return fallback;
}

function normalizeStoredColor(val: unknown, allowAuto: boolean): string | null {
  if (typeof val !== 'string') return null;
  if (allowAuto && val === 'auto') return 'auto';
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val.toLowerCase();
  return null;
}

function loadStoredPalette(
  paletteKey: string,
  defaults: readonly { value: string; label: string }[],
  allowAuto: boolean,
  legacyActiveColorKey: string
): string[] {
  const fallback = defaults.map((d) => d.value);
  try {
    const raw = localStorage.getItem(paletteKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === defaults.length) {
        const normalized = parsed.map((item) => normalizeStoredColor(item, allowAuto));
        if (normalized.every((item): item is string => item !== null)) {
          return normalized;
        }
      }
    }
    // Seamless migration if the user previously had an active custom color
    const legacyActive = normalizeStoredColor(
      localStorage.getItem(legacyActiveColorKey),
      allowAuto
    );
    if (
      legacyActive &&
      !fallback.some((c) => c.toLowerCase() === legacyActive.toLowerCase())
    ) {
      const migrated = [...fallback];
      migrated[migrated.length - 1] = legacyActive;
      return migrated;
    }
  } catch {
    // ignore storage errors
  }
  return fallback;
}

function loadStoredColorIndex(
  indexKey: string,
  palette: string[],
  legacyActiveColorKey: string,
  allowAuto: boolean
): number {
  try {
    const raw = localStorage.getItem(indexKey);
    if (raw !== null) {
      const idx = Number.parseInt(raw, 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < palette.length) {
        return idx;
      }
    }
    const legacyActive = normalizeStoredColor(
      localStorage.getItem(legacyActiveColorKey),
      allowAuto
    );
    if (legacyActive) {
      const matchIdx = palette.findIndex(
        (c) => c.toLowerCase() === legacyActive.toLowerCase()
      );
      if (matchIdx >= 0) return matchIdx;
    }
  } catch {
    // ignore storage errors
  }
  return 0;
}

function saveStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

export function DrawingCanvas(props: DrawingCanvasProps) {
  const [tool, setTool] = createSignal<DrawingTool>('pen');
  let lastNonScribbleTool: DrawingTool = 'pen';

  const initialPenPalette = loadStoredPalette(
    PEN_PALETTE_KEY,
    DEFAULT_PEN_COLORS,
    true,
    PEN_COLOR_KEY
  );
  const initialHighlighterPalette = loadStoredPalette(
    HIGHLIGHTER_PALETTE_KEY,
    DEFAULT_HIGHLIGHTER_COLORS,
    false,
    HIGHLIGHTER_COLOR_KEY
  );

  const [penPalette, setPenPalette] = createSignal<string[]>(initialPenPalette);
  const [penColorIndex, setPenColorIndex] = createSignal<number>(
    loadStoredColorIndex(PEN_COLOR_INDEX_KEY, initialPenPalette, PEN_COLOR_KEY, true)
  );
  const [highlighterPalette, setHighlighterPalette] = createSignal<string[]>(
    initialHighlighterPalette
  );
  const [highlighterColorIndex, setHighlighterColorIndex] = createSignal<number>(
    loadStoredColorIndex(
      HIGHLIGHTER_COLOR_INDEX_KEY,
      initialHighlighterPalette,
      HIGHLIGHTER_COLOR_KEY,
      false
    )
  );

  const penColor = createMemo(
    () => penPalette()[penColorIndex()] ?? DEFAULT_PEN_COLORS[0].value
  );
  const highlighterColor = createMemo(
    () => highlighterPalette()[highlighterColorIndex()] ?? DEFAULT_HIGHLIGHTER_COLORS[0].value
  );

  createEffect(() => saveStorageValue(PEN_PALETTE_KEY, JSON.stringify(penPalette())));
  createEffect(() =>
    saveStorageValue(HIGHLIGHTER_PALETTE_KEY, JSON.stringify(highlighterPalette()))
  );
  createEffect(() => saveStorageValue(PEN_COLOR_INDEX_KEY, String(penColorIndex())));
  createEffect(() =>
    saveStorageValue(HIGHLIGHTER_COLOR_INDEX_KEY, String(highlighterColorIndex()))
  );
  createEffect(() => saveStorageValue(PEN_COLOR_KEY, penColor()));
  createEffect(() => saveStorageValue(HIGHLIGHTER_COLOR_KEY, highlighterColor()));

  const [penStyle, setPenStyle] = createSignal<PenStyle>(loadStoredPenStyle());
  const [penWidths, setPenWidths] = createSignal<Record<PenStyle, number>>(
    loadStoredPenWidths()
  );
  const [fountainNibAngle, setFountainNibAngle] = createSignal<number>(
    loadStoredNumber(FOUNTAIN_ANGLE_KEY, DEFAULT_FOUNTAIN_NIB_ANGLE, 0, 175)
  );
  const [fountainFlatness, setFountainFlatness] = createSignal<number>(
    loadStoredNumber(FOUNTAIN_FLATNESS_KEY, DEFAULT_FOUNTAIN_FLATNESS, 0.15, 0.8)
  );
  const [brushDynamics, setBrushDynamics] = createSignal<number>(
    loadStoredNumber(BRUSH_DYNAMICS_KEY, DEFAULT_BRUSH_DYNAMICS, 0.55, 1.45)
  );
  const [shapeWidth, setShapeWidth] = createSignal<number>(3.2);
  const [highlighterWidth, setHighlighterWidth] = createSignal<number>(24);
  const [eraserSize, setEraserSize] = createSignal<number>(18);
  const [textFontSize, setTextFontSize] = createSignal<number>(24);
  const [textFontFamily, setTextFontFamily] = createSignal<CanvasFontFamily>('sans');
  const [textBold, setTextBold] = createSignal<boolean>(false);

  const penStyleConfig = createMemo(() => PEN_STYLE_CONFIGS[penStyle()]);
  const penWidth = createMemo(
    () => penWidths()[penStyle()] ?? penStyleConfig().defaultWidth
  );
  const setCurrentPenWidth = (w: number) => {
    const style = penStyle();
    const cfg = PEN_STYLE_CONFIGS[style];
    const clamped = Math.max(cfg.minWidth, Math.min(cfg.maxWidth, w));
    setPenWidths((prev) => ({ ...prev, [style]: clamped }));
  };

  createEffect(() => saveStorageValue(PEN_STYLE_KEY, penStyle()));
  createEffect(() => saveStorageValue(PEN_WIDTHS_KEY, JSON.stringify(penWidths())));
  createEffect(() => saveStorageValue(FOUNTAIN_ANGLE_KEY, String(fountainNibAngle())));
  createEffect(() => saveStorageValue(FOUNTAIN_FLATNESS_KEY, String(fountainFlatness())));
  createEffect(() => saveStorageValue(BRUSH_DYNAMICS_KEY, String(brushDynamics())));

  const [zoom, setZoom] = createSignal<number>(1);
  const [infiniteZoom, setInfiniteZoom] = createSignal<number>(1);
  const [liveZoomPreview, setLiveZoomPreview] = createSignal<number | null>(null);
  const [viewportWidth, setViewportWidth] = createSignal<number>(720);
  const [viewportEl, setViewportEl] = createSignal<HTMLDivElement | undefined>(undefined);
  const [lastPointerType, setLastPointerType] = createSignal<string | null>(null);

  const effSettings = () => props.store.effectiveSettings();
  const canvasMode = () => effSettings().canvasMode;
  const isInfiniteMode = () => canvasMode() === 'infinite';
  const stylusOnly = () => effSettings().stylusOnly;
  const stabilization = () => effSettings().stabilization;
  const pressureSensitivity = () => effSettings().pressureSensitivity;
  const oneFingerScroll = () => effSettings().oneFingerScroll;
  const palmSensitivity = () => effSettings().palmSensitivity;
  const pinchZoomEnabled = () => effSettings().pinchZoomEnabled;
  const scrollMomentum = () => effSettings().scrollMomentum;
  const showSheetHeaders = () => effSettings().showSheetHeaders;

  const palmProfile = createMemo(() => getPalmProfile(palmSensitivity()));

  const setStylusOnlyPersisted = (next: boolean) => {
    const currNote = props.store.activeNote();
    if (currNote?.settings?.stylusOnly !== undefined) {
      props.store.updateNoteSettings({ stylusOnly: next }, currNote.id);
    } else {
      props.store.updateSettings({ stylusOnly: next });
    }
  };

  const [penMenuOpen, setPenMenuOpen] = createSignal<boolean>(false);
  const [paperMenuOpen, setPaperMenuOpen] = createSignal<boolean>(false);
  const [sizeMenuOpen, setSizeMenuOpen] = createSignal<boolean>(false);
  const [overviewOpen, setOverviewOpen] = createSignal<boolean>(false);
  const [overviewAutoCreator, setOverviewAutoCreator] = createSignal<boolean>(false);
  const [isDragOver, setIsDragOver] = createSignal<boolean>(false);
  const [importProgress, setImportProgress] = createSignal<string | null>(null);

  const [editingText, setEditingText] = createSignal<EditingTextState | null>(null);
  const [selectedImage, setSelectedImage] = createSignal<SelectedImageState | null>(null);
  const [lassoSelection, setLassoSelection] = createSignal<LassoSelection | null>(null);

  let viewportRef: HTMLDivElement | undefined;
  let scrollContentRef: HTMLDivElement | undefined;
  let zoomStageRef: HTMLDivElement | undefined;
  let infiniteHandle: InfiniteCanvasHandle | null = null;
  let penMenuRef: HTMLDivElement | undefined;
  let paperMenuRef: HTMLDivElement | undefined;
  let sizeMenuRef: HTMLDivElement | undefined;
  let imageFileInputRef: HTMLInputElement | undefined;
  let pageImportInputRef: HTMLInputElement | undefined;

  const pageElements = new Map<string, HTMLDivElement>();
  const touchAbortCallbacks = new Map<string, () => void>();
  let penContactNotifier: (() => void) | null = null;
  let scrollRafId: number | null = null;
  let ignoreScrollSyncUntil = 0;
  let autoEnabledStylusOnce = false;

  const handlePointerTypeDetected = (pointerType: string) => {
    setLastPointerType(pointerType);
    if (
      pointerType === 'pen' &&
      props.store.settings().autoEnableStylusOnly &&
      !autoEnabledStylusOnce &&
      !stylusOnly() &&
      typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 0
    ) {
      autoEnabledStylusOnce = true;
      setStylusOnlyPersisted(true);
      props.store.showToast(
        'Stift erkannt — Stift schreibt · 1 Finger scrollt · 2 Finger zoomen'
      );
    }
  };

  const note = () => props.store.activeNote();
  const pages = () => note()?.pages ?? [];
  const pageIds = createMemo(
    () => pages().map((p) => p.id),
    undefined,
    {
      equals: (prev, next) =>
        prev.length === next.length && prev.every((id, i) => id === next[i]),
    }
  );
  const page = () => props.store.activePage();
  const pageIndex = () => props.store.activePageIndex();
  const paperConfig = () => page()?.paperConfig ?? DEFAULT_PAPER_CONFIG;

  // One consistent scale across all pages in the continuous scroll document
  const docScale = createMemo(() => {
    const list = pages();
    const maxW = list.reduce((m, p) => Math.max(m, p.width), 960);
    const availableW = Math.max(260, viewportWidth() - 48);
    const fitScale = Math.min(1, availableW / maxW);
    return fitScale * zoom();
  });

  const resolvedPaperBg = createMemo(() =>
    resolvePaperBackgroundColor(paperConfig(), props.store.theme())
  );

  const paperIsDark = createMemo(() =>
    isPaperDark(paperConfig(), props.store.theme())
  );

  const activeColor = createMemo(() => {
    const ed = editingText();
    if (ed) return ed.item.color;
    return tool() === 'highlighter' ? highlighterColor() : penColor();
  });

  const activeSlotIndex = createMemo(() => {
    if (tool() === 'highlighter') return highlighterColorIndex();
    const ed = editingText();
    if (!ed) return penColorIndex();
    const edColor = ed.item.color.toLowerCase();
    const pal = penPalette();
    if (pal[penColorIndex()]?.toLowerCase() === edColor) {
      return penColorIndex();
    }
    const matchIdx = pal.findIndex((c) => c.toLowerCase() === edColor);
    return matchIdx >= 0 ? matchIdx : penColorIndex();
  });

  const isEditingUnlistedTextColor = createMemo(() => {
    if (tool() === 'highlighter') return false;
    const ed = editingText();
    if (!ed) return false;
    const edColor = ed.item.color.toLowerCase();
    return !penPalette().some((c) => c.toLowerCase() === edColor);
  });

  const selectColorSlot = (index: number) => {
    if (tool() === 'highlighter') {
      setHighlighterColorIndex(index);
    } else {
      setPenColorIndex(index);
      const chosen = penPalette()[index] ?? DEFAULT_PEN_COLORS[0].value;
      const ed = editingText();
      if (ed) {
        setEditingText({ pageId: ed.pageId, item: { ...ed.item, color: chosen } });
      }
    }
  };

  const replaceSelectedColorFromPicker = (hex: string) => {
    const normalized = hex.toLowerCase();
    if (tool() === 'highlighter') {
      const idx = highlighterColorIndex();
      setHighlighterPalette((prev) =>
        prev.map((c, i) => (i === idx ? normalized : c))
      );
    } else {
      const idx = activeSlotIndex();
      setPenColorIndex(idx);
      setPenPalette((prev) =>
        prev.map((c, i) => (i === idx ? normalized : c))
      );
      const ed = editingText();
      if (ed) {
        setEditingText({ pageId: ed.pageId, item: { ...ed.item, color: normalized } });
      }
    }
  };

  const selectedSlotDefault = createMemo(() => {
    const idx = activeSlotIndex();
    return tool() === 'highlighter'
      ? DEFAULT_HIGHLIGHTER_COLORS[idx] ?? DEFAULT_HIGHLIGHTER_COLORS[0]
      : DEFAULT_PEN_COLORS[idx] ?? DEFAULT_PEN_COLORS[0];
  });

  const canResetSelectedColor = createMemo(() => {
    const idx = activeSlotIndex();
    const currentVal =
      tool() === 'highlighter' ? highlighterPalette()[idx] : penPalette()[idx];
    const defVal = selectedSlotDefault().value;
    return currentVal?.toLowerCase() !== defVal.toLowerCase();
  });

  const resetSelectedColorSlot = () => {
    const idx = activeSlotIndex();
    const defVal = selectedSlotDefault().value;
    if (tool() === 'highlighter') {
      setHighlighterPalette((prev) =>
        prev.map((c, i) => (i === idx ? defVal : c))
      );
    } else {
      setPenColorIndex(idx);
      setPenPalette((prev) =>
        prev.map((c, i) => (i === idx ? defVal : c))
      );
      const ed = editingText();
      if (ed) {
        setEditingText({ pageId: ed.pageId, item: { ...ed.item, color: defVal } });
      }
    }
  };

  const activeWidth = createMemo(() => {
    if (tool() === 'highlighter') return highlighterWidth();
    if (tool() === 'eraser') return eraserSize();
    if (tool() === 'text' || tool() === 'scribble') {
      return editingText()?.item.fontSize ?? textFontSize();
    }
    if (tool() === 'pen') return penWidth();
    return shapeWidth();
  });

  const setActiveWidth = (w: number) => {
    if (tool() === 'highlighter') {
      setHighlighterWidth(w);
    } else if (tool() === 'eraser') {
      setEraserSize(w);
    } else if (tool() === 'text' || tool() === 'scribble') {
      setTextFontSize(w);
      const ed = editingText();
      if (ed) {
        setEditingText({ pageId: ed.pageId, item: { ...ed.item, fontSize: w } });
      }
    } else if (tool() === 'pen') {
      setCurrentPenWidth(w);
    } else {
      setShapeWidth(w);
    }
  };

  const activeSizePresets = createMemo(() =>
    tool() === 'pen' ? penStyleConfig().sizePresets : SHAPE_SIZES
  );

  const resolvedPenPreviewColor = createMemo(() =>
    penColor() === 'auto'
      ? props.store.theme() === 'dark'
        ? '#f1f5f9'
        : '#1e293b'
      : penColor()
  );

  const blurActiveTextInput = () => {
    const active = document.activeElement;
    if (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement
    ) {
      active.blur();
    }
  };

  const commitEditingText = () => {
    const current = editingText();
    if (!current) return;
    blurActiveTextInput();
    setEditingText(null);
    props.store.upsertCanvasText(current.item, current.pageId);
  };

  const exitScribbleMode = (targetTool?: DrawingTool) => {
    if (editingText()) {
      commitEditingText();
    } else {
      blurActiveTextInput();
    }
    const next =
      targetTool && targetTool !== 'scribble'
        ? targetTool
        : lastNonScribbleTool !== 'scribble'
          ? lastNonScribbleTool
          : 'pen';
    setTool(next);
  };

  const registerPageElement = (pageId: string, el: HTMLDivElement | null) => {
    if (el) pageElements.set(pageId, el);
    else pageElements.delete(pageId);
  };

  const registerTouchAbort = (pageId: string, fn: (() => void) | null) => {
    if (fn) touchAbortCallbacks.set(pageId, fn);
    else touchAbortCallbacks.delete(pageId);
  };

  const abortAllTouchStrokes = () => {
    for (const fn of touchAbortCallbacks.values()) {
      fn();
    }
  };

  const scrollToPage = (pageId: string, behavior: ScrollBehavior = 'smooth') => {
    ignoreScrollSyncUntil = performance.now() + 650;
    requestAnimationFrame(() => {
      const el = pageElements.get(pageId);
      if (el) {
        el.scrollIntoView({ behavior, block: 'start' });
      }
    });
  };

  const handleViewportScroll = () => {
    if (performance.now() < ignoreScrollSyncUntil) return;
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      const vp = viewportRef;
      if (!vp) return;
      const vpRect = vp.getBoundingClientRect();
      const anchorY = vpRect.top + vpRect.height * 0.35;

      let bestId: string | null = null;
      let bestDist = Infinity;

      for (const id of pageIds()) {
        const el = pageElements.get(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        // If anchorY is inside the page, distance is 0 (prefer this page immediately)
        let dist: number;
        if (anchorY >= rect.top && anchorY <= rect.bottom) {
          dist = 0;
        } else {
          dist = Math.min(Math.abs(rect.top - anchorY), Math.abs(rect.bottom - anchorY));
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }

      if (bestId && bestId !== page()?.id) {
        props.store.setActivePage(bestId);
      }
    });
  };

  // Close overlays when switching notes
  {
    let prevNoteId: string | null = null;
    createEffect(() => {
      const id = props.store.activeNoteId();
      if (prevNoteId !== null && prevNoteId !== id) {
        setEditingText(null);
        setSelectedImage(null);
        setLassoSelection(null);
        setOverviewOpen(false);
        setSizeMenuOpen(false);
        setPaperMenuOpen(false);
        setPenMenuOpen(false);
      }
      prevNoteId = id;
    });
  }

  // Observe continuous viewport width continuously (remount-safe when toggling infinite <-> pages)
  createEffect(() => {
    const el = viewportEl();
    if (!el) return;
    if (el.clientWidth > 0) {
      setViewportWidth(el.clientWidth);
    }
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setViewportWidth(entry.contentRect.width);
        }
      }
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  // Unified iPad / Touch Gesture Controller on .canvas-viewport (remount-safe):
  // - 1-Finger Scroll (in Nur-Stift-Modus / Select / Außenrand) with 120Hz-normalized momentum
  // - Smart Palm Rejection: tracks resting palms by touch.identifier + contact radius + active pen,
  //   with automatic micro-drift snap-back if a palm lands right before Apple Pencil touches down
  // - Instant 2-Finger Pinch-to-Zoom + simultaneous Pan (zero deadzone, locked scroll dimensions
  //   during pinch so Safari never clamps scrollLeft/scrollTop, sub-pixel re-anchor on release)
  // - Trackpad / Ctrl+Wheel zoom anchored to cursor
  createEffect(() => {
    const vp = viewportEl();
    if (!vp) return;

    interface SheetAnchor {
      el: HTMLElement;
      relX: number;
      relY: number;
    }

    interface OneFingerPan {
      touchId: number;
      engaged: boolean;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      startScrollLeft: number;
      startScrollTop: number;
      startTime: number;
      lastMoveTs: number;
      velX: number;
      velY: number;
      threshold: number;
      axis: ScrollAxisState | null;
    }

    interface PinchGesture {
      touchIdA: number;
      touchIdB: number;
      startDist: number;
      startZoom: number;
      startMidX: number;
      startMidY: number;
      startScrollLeft: number;
      startScrollTop: number;
      lastMidX: number;
      lastMidY: number;
      targetZoom: number;
      anchor: SheetAnchor | null;
    }

    const ignoredPalmTouchIds = new Set<number>();
    const activeNonStylusTouchIds = new Set<number>();
    let waitForAllFingersUp = false;
    let oneFingerPan: OneFingerPan | null = null;
    let pinch: PinchGesture | null = null;

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
      if (!scrollMomentum()) return;
      if (Math.hypot(vx, vy) < 1.2) return;
      momentumVx = Math.max(-56, Math.min(56, vx));
      momentumVy = Math.max(-56, Math.min(56, vy));
      momentumLastTs = performance.now();

      const step = (now: number) => {
        momentumRafId = null;
        if (isAnyPenStrokeActive() || pinch || oneFingerPan) {
          stopMomentum();
          return;
        }
        const dtMs = Math.max(4, Math.min(48, now - momentumLastTs));
        momentumLastTs = now;
        const frames = dtMs / 16.67;

        vp.scrollLeft -= momentumVx * frames;
        vp.scrollTop -= momentumVy * frames;

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
          'button, input, select, textarea, label, a, summary, [role="button"], [role="tab"], .canvas-text-overlay, .canvas-image-selection, .canvas-lasso-selection, .paper-popover'
        )
      );
    };

    const canOneFingerScrollTarget = (target: EventTarget | null): boolean => {
      if (isInteractiveTarget(target)) return false;
      const onCanvas = Boolean(getTargetElement(target)?.closest('.drawing-canvas'));
      if (!onCanvas) return true;
      if (stylusOnly()) return oneFingerScroll();
      return tool() === 'select';
    };

    const findAnchorSheet = (clientX: number, clientY: number): SheetAnchor | null => {
      const sheets = vp.querySelectorAll<HTMLElement>('.canvas-sheet');
      let bestEl: HTMLElement | null = null;
      let bestDist = Infinity;
      let bestRect: DOMRect | null = null;

      sheets.forEach((sheet) => {
        const rect = sheet.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const clampedX = Math.max(rect.left, Math.min(rect.right, clientX));
        const clampedY = Math.max(rect.top, Math.min(rect.bottom, clientY));
        const d = Math.hypot(clientX - clampedX, clientY - clampedY);
        if (d < bestDist) {
          bestDist = d;
          bestEl = sheet;
          bestRect = rect;
        }
      });

      if (!bestEl || !bestRect) return null;
      const r: DOMRect = bestRect;
      return {
        el: bestEl,
        relX: (clientX - r.left) / r.width,
        relY: (clientY - r.top) / r.height,
      };
    };

    const unlockScrollContentSize = () => {
      if (scrollContentRef) {
        scrollContentRef.style.minWidth = '';
        scrollContentRef.style.minHeight = '';
      }
    };

    const beginPinch = (t0: Touch, t1: Touch) => {
      oneFingerPan = null;
      waitForAllFingersUp = false;
      stopMomentum();
      abortAllTouchStrokes();

      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      const dist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));
      const currZoom = zoom();

      // Lock scrollable box dimensions during pinch so zooming out NEVER causes Safari
      // to clamp vp.scrollLeft / vp.scrollTop mid-gesture!
      if (scrollContentRef) {
        scrollContentRef.style.minWidth = `${vp.scrollWidth}px`;
        scrollContentRef.style.minHeight = `${vp.scrollHeight}px`;
      }

      pinch = {
        touchIdA: t0.identifier,
        touchIdB: t1.identifier,
        startDist: dist,
        startZoom: currZoom,
        startMidX: midX,
        startMidY: midY,
        startScrollLeft: vp.scrollLeft,
        startScrollTop: vp.scrollTop,
        lastMidX: midX,
        lastMidY: midY,
        targetZoom: currZoom,
        anchor: findAnchorSheet(midX, midY),
      };
    };

    const finishPinch = (commit: boolean) => {
      const g = pinch;
      pinch = null;
      if (!g) return;

      if (zoomStageRef) {
        zoomStageRef.style.transform = '';
      }
      unlockScrollContentSize();
      setLiveZoomPreview(null);

      if (!commit) return;

      const committedZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.round(g.targetZoom * 100) / 100)
      );
      ignoreScrollSyncUntil = performance.now() + 260;
      setZoom(committedZoom);

      // Re-anchor scroll synchronously so the pinched spot stays pinned under the fingers
      if (g.anchor && g.anchor.el.isConnected) {
        const newRect = g.anchor.el.getBoundingClientRect();
        const newPointX = newRect.left + g.anchor.relX * newRect.width;
        const newPointY = newRect.top + g.anchor.relY * newRect.height;
        vp.scrollLeft += newPointX - g.lastMidX;
        vp.scrollTop += newPointY - g.lastMidY;
      }
    };

    const handlePenContact = () => {
      markGlobalPenActivity();
      stopMomentum();

      // Any non-stylus finger/palm currently resting on the glass is a resting palm:
      // ignore it until that specific touch lifts so shifting the hand between words never scrolls!
      for (const id of activeNonStylusTouchIds) {
        ignoredPalmTouchIds.add(id);
      }

      if (pinch) {
        finishPinch(false);
      }

      if (oneFingerPan) {
        const pan = oneFingerPan;
        oneFingerPan = null;
        const profile = palmProfile();
        // If a resting palm nudged scroll right before Apple Pencil landed, gently snap it back
        if (pan.engaged && performance.now() - pan.startTime < profile.snapWindowMs) {
          const drift = Math.hypot(
            vp.scrollLeft - pan.startScrollLeft,
            vp.scrollTop - pan.startScrollTop
          );
          if (drift < profile.snapMaxPx) {
            vp.scrollLeft = pan.startScrollLeft;
            vp.scrollTop = pan.startScrollTop;
          }
        }
      }
    };

    penContactNotifier = handlePenContact;

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

    const handleTouchStart = (e: TouchEvent) => {
      stopMomentum();
      const profile = palmProfile();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const ct = e.changedTouches[i] as AppleTouch;
        if (ct.touchType !== 'stylus') {
          activeNonStylusTouchIds.add(ct.identifier);
          if (isAnyPenStrokeActive() || isHardPalmTouch(ct, profile)) {
            ignoredPalmTouchIds.add(ct.identifier);
          }
        }
      }

      if (hasStylusTouch(e)) {
        handlePenContact();
        if (!isInteractiveTarget(e.target)) {
          e.preventDefault();
        }
        return;
      }

      const fingerTouches = getCleanFingerTouches(e.touches);

      // 2 clean fingers -> instant Pinch-to-Zoom + simultaneous Pan (or pure 2-finger pan if zoom disabled)
      if (fingerTouches.length >= 2 && !isAnyPenStrokeActive()) {
        e.preventDefault();
        beginPinch(fingerTouches[0], fingerTouches[1]);
        return;
      }

      // 1 clean finger -> smooth 1-finger scroll (when in Nur-Stift-Modus, Select, or outside canvas)
      if (
        fingerTouches.length === 1 &&
        !isAnyPenStrokeActive() &&
        !waitForAllFingersUp &&
        !pinch
      ) {
        const t = fingerTouches[0];
        const onCanvas =
          e.target instanceof Element && Boolean(e.target.closest('.drawing-canvas'));
        const isDrawingTool =
          tool() !== 'text' && tool() !== 'scribble' && tool() !== 'select';

        if (canOneFingerScrollTarget(e.target)) {
          const penJustUsed = Date.now() - getLastGlobalPenTimestamp() < 350;
          const now = performance.now();
          oneFingerPan = {
            touchId: t.identifier,
            engaged: false,
            startX: t.clientX,
            startY: t.clientY,
            lastX: t.clientX,
            lastY: t.clientY,
            startScrollLeft: vp.scrollLeft,
            startScrollTop: vp.scrollTop,
            startTime: now,
            lastMoveTs: now,
            velX: 0,
            velY: 0,
            threshold: getOneFingerPanThreshold(t, profile, penJustUsed),
            axis: null,
          };

          // Prevent Safari Scribble / selection magnifier on drawing canvas while allowing native
          // taps on text/select/headers/buttons
          if (onCanvas && isDrawingTool) {
            e.preventDefault();
          }
          return;
        }

        // Finger-drawing mode (Nur Stift AUS) on drawing canvas: block Safari scroll/bounce
        if (onCanvas && isDrawingTool) {
          e.preventDefault();
        }
        return;
      }

      // Ignored resting palm(s) or touches while pen is active: block Safari native scroll/bounce
      if (e.touches.length > 0 && !isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (hasStylusTouch(e)) {
        handlePenContact();
        if (!isInteractiveTarget(e.target)) {
          e.preventDefault();
        }
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

      // Active 2-finger Pinch-to-Zoom + Pan
      if ((pinch || fingerTouches.length >= 2) && !isAnyPenStrokeActive()) {
        e.preventDefault();
        abortAllTouchStrokes();

        if (!pinch) {
          if (fingerTouches.length < 2) return;
          beginPinch(fingerTouches[0], fingerTouches[1]);
        }

        const g = pinch!;
        const t0 = findTouchById(e.touches, g.touchIdA) ?? fingerTouches[0];
        const t1 = findTouchById(e.touches, g.touchIdB) ?? fingerTouches[1];
        if (!t0 || !t1 || !zoomStageRef) return;

        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;

        if (!pinchZoomEnabled()) {
          const dx = midX - g.lastMidX;
          const dy = midY - g.lastMidY;
          g.lastMidX = midX;
          g.lastMidY = midY;
          vp.scrollLeft -= dx;
          vp.scrollTop -= dy;
          return;
        }

        const dist = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));

        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, g.startZoom * (dist / g.startDist))
        );
        g.targetZoom = nextZoom;
        g.lastMidX = midX;
        g.lastMidY = midY;

        const s = nextZoom / g.startZoom;
        const vpRect = vp.getBoundingClientRect();
        const v0x = g.startMidX - vpRect.left;
        const v0y = g.startMidY - vpRect.top;
        const vx = midX - vpRect.left;
        const vy = midY - vpRect.top;
        const c0x = g.startScrollLeft + v0x;
        const c0y = g.startScrollTop + v0y;

        // Read live scrollLeft/scrollTop (frozen by locked minWidth/minHeight) for 1:1 tracking
        const tx = vp.scrollLeft + vx - c0x * s;
        const ty = vp.scrollTop + vy - c0y * s;

        zoomStageRef.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
        setLiveZoomPreview(nextZoom);
        return;
      }

      // Active 1-finger Pan / Scroll (with directional stabilization & thumb-arc tolerance)
      if (oneFingerPan && !isAnyPenStrokeActive() && !waitForAllFingersUp) {
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
          const canScrollX = vp.scrollWidth > vp.clientWidth + 2;
          const canScrollY = vp.scrollHeight > vp.clientHeight + 2;
          oneFingerPan.axis = createScrollAxisState(
            oneFingerPan.startX,
            oneFingerPan.startY,
            t.clientX,
            t.clientY,
            canScrollX,
            canScrollY
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

        vp.scrollLeft -= appliedDx;
        vp.scrollTop -= appliedDy;

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

      // Block Safari native scroll/bounce for ignored resting palms or finger-drawing canvas
      if (!isInteractiveTarget(e.target)) {
        const onCanvas =
          e.target instanceof Element && Boolean(e.target.closest('.drawing-canvas'));
        const isDrawingTool =
          tool() !== 'text' && tool() !== 'scribble' && tool() !== 'select';
        if ((onCanvas && isDrawingTool) || stylusOnly() || isAnyPenStrokeActive()) {
          e.preventDefault();
        }
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
          finishPinch(true);
          if (e.touches.length > 0) {
            // Avoid accidental scroll yank from the second finger lifting 20-50ms later
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
          !isAnyPenStrokeActive() &&
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

    // Prevent Safari's native page-level pinch gesture from zooming browser chrome
    const handleSafariGesture = (e: Event) => {
      e.preventDefault();
    };

    // Smooth Trackpad / Ctrl+Wheel pinch-to-zoom anchored at cursor
    const handleWheelZoom = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      stopMomentum();

      const anchor = findAnchorSheet(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0045);
      const nextZoom = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, Math.round(zoom() * factor * 100) / 100)
      );
      if (nextZoom === zoom()) return;

      ignoreScrollSyncUntil = performance.now() + 180;
      setZoom(nextZoom);

      if (anchor && anchor.el.isConnected) {
        const newRect = anchor.el.getBoundingClientRect();
        const newX = newRect.left + anchor.relX * newRect.width;
        const newY = newRect.top + anchor.relY * newRect.height;
        vp.scrollLeft += newX - e.clientX;
        vp.scrollTop += newY - e.clientY;
      }
    };

    vp.addEventListener('touchstart', handleTouchStart, { passive: false });
    vp.addEventListener('touchmove', handleTouchMove, { passive: false });
    vp.addEventListener('touchend', handleTouchEnd, { passive: true });
    vp.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    vp.addEventListener('gesturestart', handleSafariGesture, { passive: false });
    vp.addEventListener('gesturechange', handleSafariGesture, { passive: false });
    vp.addEventListener('wheel', handleWheelZoom, { passive: false });

    onCleanup(() => {
      penContactNotifier = null;
      stopMomentum();
      if (zoomStageRef) zoomStageRef.style.transform = '';
      unlockScrollContentSize();
      vp.removeEventListener('touchstart', handleTouchStart);
      vp.removeEventListener('touchmove', handleTouchMove);
      vp.removeEventListener('touchend', handleTouchEnd);
      vp.removeEventListener('touchcancel', handleTouchEnd);
      vp.removeEventListener('gesturestart', handleSafariGesture);
      vp.removeEventListener('gesturechange', handleSafariGesture);
      vp.removeEventListener('wheel', handleWheelZoom);
    });
  });

  const importImagesToPage = async (
    targetPageId: string,
    files: File[],
    dropLogicalPoint?: { x: number; y: number }
  ) => {
    const targetPage = pages().find((p) => p.id === targetPageId);
    if (!targetPage || files.length === 0) return;

    if (editingText()) commitEditingText();
    props.store.setActivePage(targetPageId);

    const importedItems: CanvasImageItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const processed = await processImageFile(file, 1400);
        const maxInitialW = Math.min(540, Math.max(180, targetPage.width - 60));
        const maxInitialH = Math.min(520, Math.max(180, targetPage.height - 60));
        const fitScale = Math.min(
          1,
          maxInitialW / processed.width,
          maxInitialH / processed.height
        );
        const w = Math.max(64, Math.round(processed.width * fitScale));
        const h = Math.max(48, Math.round(processed.height * fitScale));

        const offset = i * 24;
        let x: number;
        let y: number;

        if (isInfiniteMode()) {
          const anchor =
            dropLogicalPoint ??
            infiniteHandle?.getViewportCenterWorld() ?? { x: 360, y: 260 };
          x = Math.round(anchor.x - w / 2 + offset);
          y = Math.round(anchor.y - h / 2 + offset);
        } else if (dropLogicalPoint) {
          x = Math.max(
            12,
            Math.min(targetPage.width - w - 12, dropLogicalPoint.x - w / 2 + offset)
          );
          y = Math.max(
            12,
            Math.min(targetPage.height - h - 12, dropLogicalPoint.y - h / 2 + offset)
          );
        } else {
          x = Math.max(12, Math.round((targetPage.width - w) / 2) + offset);
          y = Math.max(12, Math.round((targetPage.height - h) / 3) + offset);
        }

        importedItems.push({
          id: generateId(),
          src: processed.src,
          name: processed.name,
          x,
          y,
          width: w,
          height: h,
          naturalWidth: processed.width,
          naturalHeight: processed.height,
          opacity: 1,
        });
      } catch {
        props.store.showToast(`Bild „${file.name}“ konnte nicht geladen werden`);
      }
    }

    if (importedItems.length > 0) {
      props.store.addCanvasImages(importedItems, targetPageId);
      setOverviewOpen(false);
      setTool('select');
      setSelectedImage({
        pageId: targetPageId,
        imageId: importedItems[importedItems.length - 1].id,
      });
      props.store.showToast(
        importedItems.length === 1
          ? `Bild auf „${targetPage.title}“ eingefügt`
          : `${importedItems.length} Bilder auf „${targetPage.title}“ eingefügt`
      );
    }
  };

  // ==================== LASSO SELECTION ACTIONS ====================
  const getLassoTargetPage = () => {
    const sel = lassoSelection();
    if (!sel) return null;
    const targetPage = pages().find((p) => p.id === sel.pageId);
    if (!targetPage) return null;
    return { sel, page: targetPage };
  };

  const handleLassoDelete = () => {
    const ctx = getLassoTargetPage();
    if (!ctx) return;
    const count = getLassoItemCount(ctx.sel);
    const nextSnapshot = deleteLassoSelection(ctx.page, ctx.sel);
    setLassoSelection(null);
    props.store.commitCanvasSnapshot(nextSnapshot, undefined, ctx.page.id);
    props.store.showToast(`${formatLassoCountLabel(count)} gelöscht`);
  };

  const handleLassoRecolor = (color: string) => {
    const ctx = getLassoTargetPage();
    if (!ctx) return;
    const nextSnapshot = recolorLassoSelection(ctx.page, ctx.sel, color);
    props.store.commitCanvasSnapshot(nextSnapshot, undefined, ctx.page.id);
  };

  const handleLassoDuplicate = () => {
    const ctx = getLassoTargetPage();
    if (!ctx) return;
    const { snapshot, nextSelection } = duplicateLassoSelection(ctx.page, ctx.sel, {
      dx: 24,
      dy: 24,
    });
    props.store.commitCanvasSnapshot(snapshot, undefined, ctx.page.id);
    setLassoSelection(nextSelection);
    props.store.showToast(`${formatLassoCountLabel(getLassoItemCount(nextSelection))} dupliziert`);
  };

  const handleLassoCopy = () => {
    const ctx = getLassoTargetPage();
    if (!ctx) return;
    const measureCtx = document.createElement('canvas').getContext('2d');
    const data = extractLassoClipboard(ctx.page, ctx.sel, measureCtx);
    if (!data) return;
    setLassoClipboard(data);
    props.store.showToast(`${formatLassoCountLabel(getLassoItemCount(ctx.sel))} kopiert`);
  };

  const handleLassoCut = () => {
    const ctx = getLassoTargetPage();
    if (!ctx) return;
    const count = getLassoItemCount(ctx.sel);
    const measureCtx = document.createElement('canvas').getContext('2d');
    const data = extractLassoClipboard(ctx.page, ctx.sel, measureCtx);
    if (!data) return;
    setLassoClipboard(data);
    const nextSnapshot = deleteLassoSelection(ctx.page, ctx.sel);
    setLassoSelection(null);
    props.store.commitCanvasSnapshot(nextSnapshot, undefined, ctx.page.id);
    props.store.showToast(`${formatLassoCountLabel(count)} ausgeschnitten`);
  };

  const handleLassoPaste = () => {
    const clip = getLassoClipboard();
    const currPage = page();
    if (!clip || !currPage) return;
    if (editingText()) commitEditingText();
    setSelectedImage(null);
    const targetCenter = isInfiniteMode()
      ? infiniteHandle?.getViewportCenterWorld()
      : undefined;
    const { snapshot, nextSelection } = pasteLassoClipboard(currPage, clip, targetCenter);
    props.store.commitCanvasSnapshot(snapshot, undefined, currPage.id);
    setTool('lasso');
    setLassoSelection(nextSelection);
    props.store.showToast(`${formatLassoCountLabel(getLassoItemCount(nextSelection))} eingefügt`);
  };

  onMount(() => {
    const handleDocPointerDown = (e: PointerEvent) => {
      const targetEl =
        e.target instanceof Element
          ? e.target
          : e.target instanceof Node
            ? e.target.parentElement
            : null;
      if (targetEl?.closest('.color-popover')) {
        return;
      }
      if (penMenuOpen() && penMenuRef && !penMenuRef.contains(e.target as Node)) {
        setPenMenuOpen(false);
      }
      if (paperMenuOpen() && paperMenuRef && !paperMenuRef.contains(e.target as Node)) {
        setPaperMenuOpen(false);
      }
      if (sizeMenuOpen() && sizeMenuRef && !sizeMenuRef.contains(e.target as Node)) {
        setSizeMenuOpen(false);
      }
    };

    const handleDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (penMenuOpen()) setPenMenuOpen(false);
        if (paperMenuOpen()) setPaperMenuOpen(false);
        if (sizeMenuOpen()) setSizeMenuOpen(false);
        if (overviewOpen()) setOverviewOpen(false);
        if (selectedImage()) setSelectedImage(null);
        if (lassoSelection()) setLassoSelection(null);
        if (tool() === 'scribble') exitScribbleMode();
      }

      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);

      if (!isEditable && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (lassoSelection()) {
          e.preventDefault();
          handleLassoDelete();
          return;
        }
        const sel = selectedImage();
        if (sel) {
          e.preventDefault();
          setSelectedImage(null);
          props.store.deleteCanvasImage(sel.imageId, sel.pageId);
          props.store.showToast('Bild entfernt');
        }
      }

      if (!isEditable && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (lassoSelection()) {
          if (key === 'c') {
            e.preventDefault();
            handleLassoCopy();
            return;
          }
          if (key === 'x') {
            e.preventDefault();
            handleLassoCut();
            return;
          }
          if (key === 'd') {
            e.preventDefault();
            handleLassoDuplicate();
            return;
          }
        }
      }
    };

    const handleDocPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (isEditable) return;

      const files = extractImageFilesFromTransfer(e.clipboardData);
      const currPageId = page()?.id;
      if (files.length > 0 && currPageId) {
        e.preventDefault();
        void importImagesToPage(currPageId, files);
        return;
      }

      if (getLassoClipboard() && currPageId) {
        const plainText = e.clipboardData?.getData('text/plain')?.trim() ?? '';
        if (tool() === 'lasso' || plainText.length === 0) {
          e.preventDefault();
          handleLassoPaste();
        }
      }
    };

    document.addEventListener('pointerdown', handleDocPointerDown);
    document.addEventListener('keydown', handleDocKeyDown);
    document.addEventListener('paste', handleDocPaste);

    onCleanup(() => {
      document.removeEventListener('pointerdown', handleDocPointerDown);
      document.removeEventListener('keydown', handleDocKeyDown);
      document.removeEventListener('paste', handleDocPaste);
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
    });
  });

  const openDefaultScribbleBox = () => {
    const currPage = page();
    if (!currPage) return;
    if (editingText()?.pageId === currPage.id) {
      // Upgrade existing open box to a comfortable Scribble wrap width if needed
      const ed = editingText()!;
      if (!ed.item.maxWidth) {
        const fallbackW = isInfiniteMode()
          ? 560
          : Math.max(240, Math.round(currPage.width - ed.item.x - 36));
        setEditingText({
          pageId: ed.pageId,
          item: { ...ed.item, maxWidth: fallbackW },
        });
      }
      return;
    }

    if (editingText()) commitEditingText();
    setSelectedImage(null);

    let x: number;
    let y: number;
    let maxWidth: number;

    if (isInfiniteMode()) {
      const center = infiniteHandle?.getViewportCenterWorld() ?? { x: 340, y: 240 };
      maxWidth = 560;
      x = Math.round(center.x - maxWidth / 2);
      y = Math.round(center.y - 90);
    } else {
      x = currPage.paperConfig.showMargin ? 94 : 44;
      maxWidth = Math.max(260, Math.round(currPage.width - x - 40));
      // Place cleanly below the lowest existing text block on this page, or near top
      let nextY = currPage.paperConfig.pattern === 'lined'
        ? Math.max(currPage.paperConfig.spacing * 1.5, 48)
        : 52;
      for (const t of currPage.texts) {
        const approxLines = Math.max(1, t.text.split('\n').length);
        const bottom = t.y + approxLines * t.fontSize * 1.35 + 24;
        if (bottom > nextY && bottom < currPage.height - 150) {
          nextY = Math.round(bottom);
        }
      }
      y = Math.min(currPage.height - 140, nextY);
    }

    setEditingText({
      pageId: currPage.id,
      item: {
        id: generateId(),
        x,
        y,
        text: '',
        color: penColor(),
        fontSize: textFontSize(),
        fontFamily: textFontFamily(),
        bold: textBold(),
        maxWidth,
      },
    });
  };

  const selectTool = (nextTool: DrawingTool) => {
    // Tapping the active H→Text (Scribble) button again toggles Scribble cleanly OFF
    if (nextTool === 'scribble' && tool() === 'scribble') {
      exitScribbleMode();
      props.store.showToast('Handschrift → Text beendet');
      return;
    }

    if (tool() !== 'scribble') {
      lastNonScribbleTool = tool();
    }

    if (
      editingText() &&
      nextTool !== 'text' &&
      nextTool !== 'scribble'
    ) {
      commitEditingText();
    } else if (nextTool !== 'scribble' && nextTool !== 'text') {
      blurActiveTextInput();
    }

    if (nextTool !== 'select') {
      setSelectedImage(null);
    }
    if (nextTool !== 'lasso') {
      setLassoSelection(null);
    }

    setTool(nextTool);
    if (nextTool !== 'pen') {
      setPenMenuOpen(false);
    }
    if (nextTool === 'scribble') {
      openDefaultScribbleBox();
      props.store.showToast(
        'Handschrift → Text (Kritzeln) aktiv · Nochmal auf H→Text oder ✓ zum Beenden'
      );
    }
  };

  const selectPenStyle = (style: PenStyle) => {
    const alreadyActive = tool() === 'pen' && penStyle() === style;
    if (alreadyActive) {
      setPaperMenuOpen(false);
      setSizeMenuOpen(false);
      setPenMenuOpen((v) => !v);
      return;
    }
    setPenStyle(style);
    selectTool('pen');
    setPenMenuOpen(false);
  };

  const resetActivePenTuning = () => {
    const style = penStyle();
    const cfg = PEN_STYLE_CONFIGS[style];
    setPenWidths((prev) => ({ ...prev, [style]: cfg.defaultWidth }));
    if (style === 'fountain') {
      setFountainNibAngle(DEFAULT_FOUNTAIN_NIB_ANGLE);
      setFountainFlatness(DEFAULT_FOUNTAIN_FLATNESS);
    } else if (style === 'brush') {
      setBrushDynamics(DEFAULT_BRUSH_DYNAMICS);
    }
  };

  const handleExportPng = async () => {
    if (editingText()) commitEditingText();
    const currentNote = note();
    const currentPage = page();
    if (!currentNote || !currentPage) return;
    const baseName = currentNote.title.trim() || 'skizze';
    const suffix = pages().length > 1 ? `-${currentPage.title}` : '';
    const safeName = `${baseName}${suffix}`
      .toLowerCase()
      .replace(/[^a-z0-9äöüß_-]+/gi, '-')
      .replace(/^-+|-+$/g, '');
    const filename = `${safeName || 'skizze'}.png`;
    if (isInfiniteMode()) {
      await exportInfiniteCanvasToPng(
        currentPage,
        props.store.theme(),
        filename,
        effSettings().pngExportScale
      );
      props.store.showToast('Unendlicher Canvas als PNG exportiert');
    } else {
      await exportCanvasToPng(
        currentPage,
        props.store.theme(),
        filename,
        effSettings().pngExportScale
      );
      props.store.showToast(`Seite „${currentPage.title}“ als PNG exportiert`);
    }
  };

  const goToAdjacentPage = (delta: -1 | 1) => {
    const list = pages();
    const nextIdx = pageIndex() + delta;
    if (nextIdx >= 0 && nextIdx < list.length) {
      const targetId = list[nextIdx].id;
      props.store.setActivePage(targetId);
      setOverviewOpen(false);
      scrollToPage(targetId);
    }
  };

  const handleAppendPage = (options?: {
    title?: string;
    width?: number;
    height?: number;
  }) => {
    const created = props.store.addPage(options);
    setOverviewOpen(false);
    if (created) {
      scrollToPage(created.id);
    }
  };

  const handleImportFilesAsPages = async (files: File[]) => {
    if (files.length === 0) return;
    if (editingText()) commitEditingText();
    setImportProgress('Dateien werden vorbereitet…');
    try {
      const createdPages = await importFilesAsPages(files, (status) => {
        setImportProgress(status);
      });
      if (createdPages.length === 0) {
        props.store.showToast('Keine gültigen PDF- oder Bilddateien gefunden');
        return;
      }
      const firstAdded = props.store.appendPages(createdPages);
      if (firstAdded) {
        scrollToPage(firstAdded.id);
      }
    } catch {
      props.store.showToast('Fehler beim Importieren der PDF-/Bilddatei');
    } finally {
      setImportProgress(null);
    }
  };

  const pointerTypeLabel = () => {
    const pt = lastPointerType();
    if (pt === 'pen') return 'Stift erkannt';
    if (pt === 'touch') return 'Touch';
    if (pt === 'mouse') return 'Maus';
    return 'Stift / Touch / Maus';
  };

  const colorPalette = createMemo(() =>
    tool() === 'highlighter' ? highlighterPalette() : penPalette()
  );

  const hasCanvasContent = createMemo(
    () =>
      (page()?.strokes.length ?? 0) > 0 ||
      (page()?.texts.length ?? 0) > 0 ||
      (page()?.images.length ?? 0) > 0
  );

  return (
    <section
      class="pane canvas-pane"
      classList={{ 'is-drag-over': isDragOver() }}
      aria-label="Zeichenfläche"
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
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
          void handleImportFilesAsPages(pdfFiles);
          return;
        }
        const files = extractImageFilesFromTransfer(e.dataTransfer);
        const currPageId = page()?.id;
        if (files.length === 0 || !currPageId) return;
        e.preventDefault();
        void importImagesToPage(currPageId, files);
      }}
    >
      {/* Drawing Toolbar */}
      <div
        class="pane-toolbar canvas-toolbar"
        onPointerDown={(e) => {
          if (tool() === 'scribble' || editingText()) {
            const rawTarget = e.target as Node | null;
            const targetEl =
              rawTarget instanceof Element ? rawTarget : rawTarget?.parentElement ?? null;
            if (targetEl?.closest('button') && !targetEl.closest('input, textarea, select')) {
              e.preventDefault();
            }
          }
        }}
      >
        <div class="toolbar-group">
          <For each={LEADING_TOOL_ITEMS}>
            {(item) => (
              <button
                type="button"
                class="tool-btn"
                classList={{ 'is-active': tool() === item.id }}
                onPointerDown={(e) => {
                  if (tool() === 'scribble' || editingText()) {
                    e.preventDefault();
                  }
                }}
                onClick={() => selectTool(item.id)}
                title={item.label}
                aria-label={item.label}
              >
                {item.id === 'select' && <IconPointer size={15} />}
                {item.id === 'lasso' && <IconLasso size={15} />}
              </button>
            )}
          </For>

          {/* Dedicated 3-Pen Selector: Kugelschreiber, Füllerfederhalter & Pinselstift + Options Popover */}
          <div class="paper-menu-anchor pen-menu-anchor" ref={penMenuRef}>
            <div
              class="pen-style-group"
              classList={{ 'is-pen-active': tool() === 'pen' }}
              role="group"
              aria-label="Stiftarten"
            >
              <For each={PEN_STYLE_ORDER}>
                {(style) => {
                  const cfg = PEN_STYLE_CONFIGS[style];
                  const isActive = () => tool() === 'pen' && penStyle() === style;
                  return (
                    <button
                      type="button"
                      class="tool-btn pen-style-btn"
                      classList={{ 'is-active': isActive() }}
                      onPointerDown={(e) => {
                        if (tool() === 'scribble' || editingText()) {
                          e.preventDefault();
                        }
                      }}
                      onClick={() => selectPenStyle(style)}
                      title={
                        isActive()
                          ? `${cfg.label} aktiv — nochmal tippen für Stift-Optionen`
                          : `${cfg.label}: ${cfg.description}`
                      }
                      aria-label={cfg.label}
                      aria-pressed={isActive()}
                    >
                      {style === 'ballpoint' && <IconBallpointPen size={15} />}
                      {style === 'fountain' && <IconFountainPen size={15} />}
                      {style === 'brush' && <IconBrushPen size={15} />}
                    </button>
                  );
                }}
              </For>
              <button
                type="button"
                class="pen-options-trigger"
                classList={{ 'is-open': penMenuOpen() }}
                onPointerDown={(e) => {
                  if (tool() === 'scribble' || editingText()) {
                    e.preventDefault();
                  }
                }}
                onClick={() => {
                  setPaperMenuOpen(false);
                  setSizeMenuOpen(false);
                  if (tool() !== 'pen') selectTool('pen');
                  setPenMenuOpen((v) => !v);
                }}
                title="Stift-Optionen & Vorschau (Kugelschreiber, Füller, Pinsel)"
                aria-label="Stift-Optionen öffnen"
                aria-expanded={penMenuOpen()}
              >
                <IconChevronDown size={12} />
              </button>
            </div>

            <Show when={penMenuOpen()}>
              <div
                class="paper-popover pen-popover"
                role="dialog"
                aria-label="Stiftart konfigurieren"
              >
                <div class="paper-popover-header">
                  <span>Stiftart &amp; Spitze</span>
                  <div class="pen-popover-head-actions">
                    <button
                      type="button"
                      class="icon-btn-xs"
                      onClick={() => resetActivePenTuning()}
                      title={`${penStyleConfig().label} auf Standard zurücksetzen`}
                      aria-label="Zurücksetzen"
                    >
                      <IconRotateCcw size={13} />
                    </button>
                    <button
                      type="button"
                      class="icon-btn-xs"
                      onClick={() => setPenMenuOpen(false)}
                      aria-label="Schließen"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                </div>

                <div class="pen-option-list">
                  <For each={PEN_STYLE_ORDER}>
                    {(style) => {
                      const cfg = PEN_STYLE_CONFIGS[style];
                      const isSelected = () => penStyle() === style;
                      return (
                        <button
                          type="button"
                          class="pen-option-card"
                          classList={{ 'is-active': isSelected() }}
                          onClick={() => {
                            setPenStyle(style);
                            if (tool() !== 'pen') selectTool('pen');
                          }}
                        >
                          <div class="pen-option-top">
                            <span class="pen-option-icon">
                              {style === 'ballpoint' && <IconBallpointPen size={16} />}
                              {style === 'fountain' && <IconFountainPen size={16} />}
                              {style === 'brush' && <IconBrushPen size={16} />}
                            </span>
                            <div class="pen-option-meta">
                              <span class="pen-option-name">{cfg.label}</span>
                              <span class="pen-option-desc">{cfg.description}</span>
                            </div>
                          </div>
                          <div class="pen-option-preview">
                            <PenPreviewCanvas
                              penStyle={style}
                              color={resolvedPenPreviewColor()}
                              width={penWidths()[style] ?? cfg.defaultWidth}
                              nibAngle={fountainNibAngle()}
                              nibFlatness={fountainFlatness()}
                              brushDynamics={brushDynamics()}
                            />
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>

                <Show when={penStyle() === 'fountain'}>
                  <div class="paper-section pen-tuning-section">
                    <div class="paper-slider-head">
                      <span class="paper-section-label">Federwinkel (Kalligrafie)</span>
                      <span class="paper-slider-val">{Math.round(fountainNibAngle())}°</span>
                    </div>
                    <div class="pen-angle-pills">
                      <For each={FOUNTAIN_ANGLE_PRESETS}>
                        {(preset) => (
                          <button
                            type="button"
                            class="pattern-pill"
                            classList={{
                              'is-active': Math.abs(fountainNibAngle() - preset.value) < 3,
                            }}
                            onClick={() => setFountainNibAngle(preset.value)}
                          >
                            {preset.label}
                          </button>
                        )}
                      </For>
                    </div>
                    <div class="paper-slider-head pen-subslider-head">
                      <span class="paper-section-label">Feder-Kontrast (Schmal / Breit)</span>
                      <span class="paper-slider-val">
                        {Math.round(fountainFlatness() * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      class="paper-range"
                      min={0.18}
                      max={0.78}
                      step={0.02}
                      value={fountainFlatness()}
                      onInput={(e) => setFountainFlatness(Number(e.currentTarget.value))}
                    />
                  </div>
                </Show>

                <Show when={penStyle() === 'brush'}>
                  <div class="paper-section pen-tuning-section">
                    <div class="paper-slider-head">
                      <span class="paper-section-label">Druck- &amp; Spitzen-Dynamik</span>
                      <span class="paper-slider-val">
                        {Math.round(brushDynamics() * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      class="paper-range"
                      min={0.55}
                      max={1.45}
                      step={0.05}
                      value={brushDynamics()}
                      onInput={(e) => setBrushDynamics(Number(e.currentTarget.value))}
                    />
                    <div class="spacing-presets">
                      <For each={BRUSH_DYNAMICS_PRESETS}>
                        {(preset) => (
                          <button
                            type="button"
                            class="mini-reset-btn"
                            classList={{
                              'is-active': Math.abs(brushDynamics() - preset.value) < 0.08,
                            }}
                            onClick={() => setBrushDynamics(preset.value)}
                          >
                            {preset.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={penStyle() === 'ballpoint'}>
                  <div class="pen-ballpoint-hint">
                    Konstante, saubere Linie mit minimaler Drucknuance — ideal für dichte Notizen,
                    Formeln und Skizzen.
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          <For each={TRAILING_TOOL_ITEMS}>
            {(item) => (
              <button
                type="button"
                class={item.id === 'scribble' ? 'tool-pill scribble-tool-btn' : 'tool-btn'}
                classList={{ 'is-active': tool() === item.id }}
                onPointerDown={(e) => {
                  // Prevent iPadOS Safari Scribble/focus-shift from swallowing the tap on toolbar buttons
                  if (tool() === 'scribble' || editingText()) {
                    e.preventDefault();
                  }
                }}
                onClick={() => selectTool(item.id)}
                title={
                  item.id === 'scribble' && tool() === 'scribble'
                    ? 'Handschrift → Text (Kritzeln) beenden'
                    : item.label
                }
                aria-label={item.label}
              >
                {item.id === 'scribble' && (
                  <>
                    <IconScribble size={15} />
                    <span class="hide-compact">H→Text</span>
                  </>
                )}
                {item.id === 'highlighter' && <IconHighlighter size={15} />}
                {item.id === 'text' && <IconText size={15} />}
                {item.id === 'line' && <IconLine size={15} />}
                {item.id === 'arrow' && <IconArrow size={15} />}
                {item.id === 'rect' && <IconRect size={15} />}
                {item.id === 'ellipse' && <IconEllipse size={15} />}
                {item.id === 'eraser' && <IconEraser size={15} />}
              </button>
            )}
          </For>

          <button
            type="button"
            class="tool-btn"
            onClick={() => imageFileInputRef?.click()}
            title="Bild auf aktive Seite importieren (oder per Drag & Drop / Strg+V)"
            aria-label="Bild importieren"
          >
            <IconImage size={15} />
          </button>
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/*"
            multiple
            class="sr-only"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              const currPageId = page()?.id;
              if (files.length > 0 && currPageId) {
                void importImagesToPage(currPageId, files);
              }
              e.currentTarget.value = '';
            }}
          />
        </div>

        <div class="toolbar-divider" />

        <Show when={tool() === 'lasso' && getLassoClipboard()}>
          <div class="toolbar-group">
            <button
              type="button"
              class="tool-pill"
              onClick={() => handleLassoPaste()}
              title="Kopierte Lasso-Auswahl auf dieser Seite einfügen (Strg+V)"
            >
              <IconClipboardPaste size={14} />
              <span class="hide-compact">Einfügen</span>
            </button>
          </div>
          <div class="toolbar-divider" />
        </Show>

        <Show when={tool() !== 'eraser' && tool() !== 'select' && tool() !== 'lasso'}>
          <div class="toolbar-group color-group">
            <Index each={colorPalette()}>
              {(swatchColor, index) => {
                const bg = () =>
                  swatchColor() === 'auto'
                    ? paperIsDark()
                      ? '#f1f5f9'
                      : '#1e293b'
                    : swatchColor();
                const label = () => getColorLabel(swatchColor());
                return (
                  <button
                    type="button"
                    class="color-swatch"
                    classList={{
                      'is-active':
                        !isEditingUnlistedTextColor() && activeSlotIndex() === index,
                      'is-auto': swatchColor() === 'auto',
                    }}
                    style={{ '--swatch-color': bg() }}
                    onClick={() => selectColorSlot(index)}
                    title={label()}
                    aria-label={`Farbe ${label()}`}
                  />
                );
              }}
            </Index>
            <ColorPickerPopover
              value={
                activeColor() === 'auto'
                  ? paperIsDark()
                    ? '#f1f5f9'
                    : '#1e293b'
                  : activeColor()
              }
              isCustomActive={isEditingUnlistedTextColor()}
              palette={tool() === 'highlighter' ? 'highlighter' : 'ink'}
              title={
                tool() === 'highlighter'
                  ? 'Textmarker-Farbe ändern'
                  : 'Stiftfarbe ändern'
              }
              onReset={canResetSelectedColor() ? resetSelectedColorSlot : undefined}
              resetLabel={selectedSlotDefault().value === 'auto' ? 'Auto' : 'Standard'}
              resetTitle={`Ausgewählte Farbe auf ${selectedSlotDefault().label} zurücksetzen`}
              onOpen={() => {
                setPenMenuOpen(false);
                setPaperMenuOpen(false);
                setSizeMenuOpen(false);
              }}
              onChange={(hex) => replaceSelectedColorFromPicker(hex)}
            />
          </div>
          <div class="toolbar-divider" />
        </Show>

        <Show when={tool() !== 'select' && tool() !== 'lasso'}>
          <div class="toolbar-group size-group">
            <Show
              when={
                tool() !== 'highlighter' &&
                tool() !== 'eraser' &&
                tool() !== 'text' &&
                tool() !== 'scribble'
              }
            >
              <For each={activeSizePresets()}>
                {(preset) => (
                  <button
                    type="button"
                    class="size-dot-btn"
                    classList={{ 'is-active': Math.abs(activeWidth() - preset.value) < 0.45 }}
                    onClick={() => setActiveWidth(preset.value)}
                    title={`Strichstärke ${preset.label} (${preset.value} px)`}
                  >
                    <span
                      class="size-dot"
                      style={{
                        width: `${Math.min(13, 3 + preset.value * 0.72)}px`,
                        height: `${Math.min(13, 3 + preset.value * 0.72)}px`,
                      }}
                    />
                  </button>
                )}
              </For>
            </Show>
            <Show when={tool() === 'text' || tool() === 'scribble'}>
              <span class="toolbar-mini-label">{Math.round(activeWidth())}px</span>
            </Show>
            <input
              type="range"
              class="width-slider"
              min={
                tool() === 'highlighter'
                  ? 12
                  : tool() === 'eraser'
                    ? 8
                    : tool() === 'text' || tool() === 'scribble'
                      ? 14
                      : tool() === 'pen'
                        ? penStyleConfig().minWidth
                        : 1
              }
              max={
                tool() === 'highlighter'
                  ? 44
                  : tool() === 'eraser'
                    ? 48
                    : tool() === 'text' || tool() === 'scribble'
                      ? 56
                      : tool() === 'pen'
                        ? penStyleConfig().maxWidth
                        : 18
              }
              step={tool() === 'pen' ? penStyleConfig().widthStep : 1}
              value={activeWidth()}
              onInput={(e) => setActiveWidth(Number(e.currentTarget.value))}
              title={
                tool() === 'text' || tool() === 'scribble'
                  ? `Schriftgröße: ${activeWidth()}px`
                  : `Größe: ${Math.round(activeWidth() * 10) / 10}px`
              }
              aria-label={
                tool() === 'text' || tool() === 'scribble' ? 'Schriftgröße' : 'Strichstärke'
              }
            />
          </div>
          <div class="toolbar-divider" />
        </Show>

        {/* Configurable Paper / Background Popover */}
        <div class="toolbar-group paper-menu-anchor" ref={paperMenuRef}>
          <button
            type="button"
            class="tool-pill paper-trigger-btn"
            classList={{ 'is-active': paperMenuOpen() }}
            onClick={() => {
              setPenMenuOpen(false);
              setSizeMenuOpen(false);
              setPaperMenuOpen((v) => !v);
            }}
            title="Hintergrund der aktiven Seite konfigurieren (Farbe, Zeilen, Kästchen)"
          >
            <span
              class="paper-trigger-swatch"
              style={{ background: resolvedPaperBg() }}
            />
            <IconGrid size={14} />
            <span class="hide-compact">Hintergrund</span>
          </button>

          <Show when={paperMenuOpen()}>
            <div class="paper-popover" role="dialog" aria-label="Hintergrund konfigurieren">
              <div class="paper-popover-header">
                <span>Hintergrund ({page()?.title})</span>
                <button
                  type="button"
                  class="icon-btn-xs"
                  onClick={() => setPaperMenuOpen(false)}
                  aria-label="Schließen"
                >
                  <IconX size={14} />
                </button>
              </div>

              <div class="paper-section">
                <div class="paper-section-label">Muster</div>
                <div class="pattern-pills">
                  <For each={PATTERN_OPTIONS}>
                    {(opt) => (
                      <button
                        type="button"
                        class="pattern-pill"
                        classList={{ 'is-active': paperConfig().pattern === opt.value }}
                        onClick={() =>
                          props.store.updatePaperConfig({ pattern: opt.value })
                        }
                      >
                        {opt.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <div class="paper-section">
                <div class="paper-section-label">Papier-Vorlagen</div>
                <div class="preset-grid">
                  <For each={PAPER_PRESETS}>
                    {(preset) => {
                      const isSelected = () =>
                        paperConfig().backgroundColor.toLowerCase() ===
                        preset.previewBg.toLowerCase();
                      return (
                        <button
                          type="button"
                          class="preset-card"
                          classList={{ 'is-active': isSelected() }}
                          onClick={() => props.store.updatePaperConfig(preset.config)}
                          title={preset.label}
                        >
                          <span
                            class="preset-thumb"
                            style={{
                              '--preset-bg': preset.previewBg,
                              '--preset-line': preset.previewLine,
                            }}
                          />
                          <span class="preset-label">{preset.label}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>

              <div class="paper-section paper-color-row">
                <div class="paper-color-col">
                  <div class="paper-section-label">Papierfarbe</div>
                  <div class="paper-color-controls">
                    <ColorPickerPopover
                      variant="pill"
                      palette="paper"
                      title="Papierfarbe wählen"
                      value={resolvedPaperBg()}
                      onChange={(hex) =>
                        props.store.updatePaperConfig({
                          backgroundColor: hex,
                        })
                      }
                    />
                    <button
                      type="button"
                      class="mini-reset-btn"
                      onClick={() =>
                        props.store.updatePaperConfig({ backgroundColor: 'theme' })
                      }
                      title="An App-Theme anpassen"
                    >
                      Theme
                    </button>
                  </div>
                </div>

                <Show when={paperConfig().pattern !== 'blank'}>
                  <div class="paper-color-col">
                    <div class="paper-section-label">Linienfarbe</div>
                    <div class="line-swatches">
                      <For each={LINE_COLOR_SWATCHES}>
                        {(sw) => (
                          <button
                            type="button"
                            class="mini-swatch"
                            classList={{
                              'is-active': paperConfig().lineColor === sw.value,
                              'is-auto-swatch': sw.value === 'auto',
                            }}
                            style={{
                              background:
                                sw.value === 'auto'
                                  ? 'linear-gradient(135deg, #64748b 50%, #e2e8f0 50%)'
                                  : sw.value,
                            }}
                            onClick={() =>
                              props.store.updatePaperConfig({ lineColor: sw.value })
                            }
                            title={sw.label}
                          />
                        )}
                      </For>
                      <ColorPickerPopover
                        size="sm"
                        palette="ink"
                        title="Eigene Linienfarbe"
                        value={
                          paperConfig().lineColor === 'auto'
                            ? '#64748b'
                            : paperConfig().lineColor
                        }
                        isCustomActive={
                          !LINE_COLOR_SWATCHES.some(
                            (sw) =>
                              sw.value.toLowerCase() ===
                              paperConfig().lineColor.toLowerCase()
                          )
                        }
                        onChange={(hex) =>
                          props.store.updatePaperConfig({
                            lineColor: hex,
                          })
                        }
                      />
                    </div>
                  </div>
                </Show>
              </div>

              <Show when={paperConfig().pattern !== 'blank'}>
                <div class="paper-section">
                  <div class="paper-slider-head">
                    <span class="paper-section-label">
                      {paperConfig().pattern === 'lined'
                        ? 'Zeilenabstand'
                        : paperConfig().pattern === 'grid'
                          ? 'Kästchengröße'
                          : 'Punktabstand'}
                    </span>
                    <span class="paper-slider-val">{paperConfig().spacing} px</span>
                  </div>
                  <input
                    type="range"
                    class="paper-range"
                    min={18}
                    max={64}
                    step={2}
                    value={paperConfig().spacing}
                    onInput={(e) =>
                      props.store.updatePaperConfig({
                        spacing: Number(e.currentTarget.value),
                      })
                    }
                  />
                  <div class="spacing-presets">
                    <button
                      type="button"
                      class="mini-reset-btn"
                      onClick={() => props.store.updatePaperConfig({ spacing: 24 })}
                    >
                      Eng (24)
                    </button>
                    <button
                      type="button"
                      class="mini-reset-btn"
                      onClick={() => props.store.updatePaperConfig({ spacing: 34 })}
                    >
                      Standard (34)
                    </button>
                    <button
                      type="button"
                      class="mini-reset-btn"
                      onClick={() => props.store.updatePaperConfig({ spacing: 48 })}
                    >
                      Groß (48)
                    </button>
                  </div>
                </div>

                <div class="paper-section">
                  <div class="paper-slider-head">
                    <span class="paper-section-label">Linien-Intensität</span>
                    <span class="paper-slider-val">
                      {Math.round(paperConfig().lineOpacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    class="paper-range"
                    min={0.08}
                    max={0.75}
                    step={0.02}
                    value={paperConfig().lineOpacity}
                    onInput={(e) =>
                      props.store.updatePaperConfig({
                        lineOpacity: Number(e.currentTarget.value),
                      })
                    }
                  />
                </div>
              </Show>

              <label class="paper-toggle-row">
                <span>Seitenrand (Randlinie) anzeigen</span>
                <input
                  type="checkbox"
                  checked={paperConfig().showMargin}
                  onChange={(e) =>
                    props.store.updatePaperConfig({
                      showMargin: e.currentTarget.checked,
                    })
                  }
                />
              </label>

              <Show when={page()?.backgroundImage}>
                {(bg) => (
                  <div class="paper-section paper-bg-img-section">
                    <div class="paper-slider-head">
                      <span class="paper-section-label">
                        {bg().sourceType === 'pdf' ? 'PDF-Hintergrund' : 'Bild-Hintergrund'}
                      </span>
                      <span class="paper-slider-val">
                        {Math.round((bg().opacity ?? 1) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      class="paper-range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={bg().opacity ?? 1}
                      onInput={(e) => {
                        const currId = page()?.id;
                        if (currId) {
                          props.store.updatePageBackgroundImage(currId, {
                            opacity: Number(e.currentTarget.value),
                          });
                        }
                      }}
                    />
                    <button
                      type="button"
                      class="mini-reset-btn is-danger-outline"
                      onClick={() => {
                        const currId = page()?.id;
                        if (currId) {
                          props.store.updatePageBackgroundImage(currId, null);
                          props.store.showToast('Seiten-Hintergrundbild entfernt');
                        }
                      }}
                    >
                      Hintergrundbild entfernen
                    </button>
                  </div>
                )}
              </Show>
            </div>
          </Show>

          <button
            type="button"
            class="tool-pill"
            classList={{ 'is-active': stylusOnly() }}
            onClick={() => {
              const next = !stylusOnly();
              setStylusOnlyPersisted(next);
              props.store.showToast(
                next
                  ? 'Nur-Stift-Modus aktiv (Stift schreibt · 1 Finger scrollt · 2 Finger zoomen)'
                  : 'Touch-Zeichnen aktiv (1 Finger zeichnet · 2 Finger zoomen)'
              );
            }}
            title="Nur-Stift-Modus: Stift schreibt, 1 Finger scrollt, 2 Finger zoomen (Handballen blockiert)"
          >
            <IconStylus size={14} />
            <span class="hide-compact">Nur Stift</span>
          </button>
        </div>

        <div class="toolbar-spacer" />

        {/* History, Clear, Export */}
        <div class="toolbar-group">
          <button
            type="button"
            class="tool-btn"
            disabled={!props.store.canUndo()}
            onClick={() => {
              if (editingText()) setEditingText(null);
              if (lassoSelection()) setLassoSelection(null);
              props.store.undoCanvas();
            }}
            title="Rückgängig auf aktiver Seite (Strg+Z)"
            aria-label="Rückgängig"
          >
            <IconUndo size={15} />
          </button>
          <button
            type="button"
            class="tool-btn"
            disabled={!props.store.canRedo()}
            onClick={() => {
              if (editingText()) setEditingText(null);
              if (lassoSelection()) setLassoSelection(null);
              props.store.redoCanvas();
            }}
            title="Wiederholen auf aktiver Seite (Strg+Umschalt+Z)"
            aria-label="Wiederholen"
          >
            <IconRedo size={15} />
          </button>
          <button
            type="button"
            class="tool-btn is-danger-hover"
            disabled={!hasCanvasContent()}
            onClick={() => {
              setEditingText(null);
              setSelectedImage(null);
              setLassoSelection(null);
              props.store.clearCanvas();
            }}
            title="Aktuelle Seite leeren"
            aria-label="Aktuelle Seite leeren"
          >
            <IconTrash size={15} />
          </button>
          <button
            type="button"
            class="tool-btn"
            onClick={() => void handleExportPng()}
            title="Aktuelle Seite als PNG exportieren"
            aria-label="Als PNG exportieren"
          >
            <IconDownload size={15} />
          </button>
        </div>
      </div>

      {/* Page & Infinite Canvas Mode Controls Bar */}
      <div class="page-strip">
        <div class="page-strip-left">
          {/* Compact Per-Note Mode Switch: Seiten vs Unendlich (OneNote) */}
          <div
            class="canvas-mode-switch"
            role="tablist"
            aria-label="Canvas-Modus für diese Notiz"
          >
            <button
              type="button"
              role="tab"
              aria-selected={!isInfiniteMode()}
              class="cms-btn"
              classList={{ 'is-active': !isInfiniteMode() }}
              onClick={() => {
                if (isInfiniteMode()) {
                  if (editingText()) commitEditingText();
                  setSelectedImage(null);
                  setLassoSelection(null);
                  props.store.updateNoteSettings({ canvasMode: 'pages' });
                  props.store.showToast('Seiten-Modus aktiv');
                }
              }}
              title="Klassischer Seiten-Modus (mehrere Seiten)"
            >
              <IconPages size={13} />
              <span class="hide-compact">Seiten</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isInfiniteMode()}
              class="cms-btn"
              classList={{ 'is-active': isInfiniteMode() }}
              onClick={() => {
                if (!isInfiniteMode()) {
                  if (editingText()) commitEditingText();
                  setSelectedImage(null);
                  setLassoSelection(null);
                  setOverviewOpen(false);
                  setSizeMenuOpen(false);
                  props.store.updateNoteSettings({ canvasMode: 'infinite' });
                  props.store.showToast('Unendlicher Canvas (wie OneNote) aktiv');
                }
              }}
              title="Unendlicher Canvas wie in OneNote (grenzenlos in alle Richtungen)"
            >
              <IconInfinity size={14} />
              <span class="hide-compact">Unendlich</span>
            </button>
          </div>

          <Show
            when={!isInfiniteMode()}
            fallback={
              <>
                <div class="active-page-indicator is-infinite-pill" title="Unendliche Zeichenfläche aktiv">
                  <span class="api-dot" />
                  <span class="api-name">Unendliche Fläche</span>
                </div>
                <Show when={pages().length > 1}>
                  <div class="page-nav-arrows">
                    <button
                      type="button"
                      class="tool-btn"
                      disabled={pageIndex() <= 0}
                      onClick={() => goToAdjacentPage(-1)}
                      title="Vorheriges Blatt"
                      aria-label="Vorheriges Blatt"
                    >
                      <IconChevronLeft size={15} />
                    </button>
                    <span class="inf-page-count">
                      {pageIndex() + 1}/{pages().length}
                    </span>
                    <button
                      type="button"
                      class="tool-btn"
                      disabled={pageIndex() >= pages().length - 1}
                      onClick={() => goToAdjacentPage(1)}
                      title="Nächstes Blatt"
                      aria-label="Nächstes Blatt"
                    >
                      <IconChevronRight size={15} />
                    </button>
                  </div>
                </Show>
              </>
            }
          >
            <button
              type="button"
              class="tool-pill page-overview-btn"
              classList={{ 'is-active': overviewOpen() }}
              onClick={() => {
                if (editingText()) commitEditingText();
                setSizeMenuOpen(false);
                setPaperMenuOpen(false);
                setOverviewAutoCreator(false);
                setOverviewOpen((v) => !v);
              }}
              title="Horizontale Seitenübersicht ein-/ausblenden"
            >
              <IconPages size={14} />
              <span>
                Übersicht ({pageIndex() + 1}/{pages().length})
              </span>
            </button>

            <div class="page-nav-arrows">
              <button
                type="button"
                class="tool-btn"
                disabled={pageIndex() <= 0}
                onClick={() => goToAdjacentPage(-1)}
                title="Zur vorherigen Seite scrollen"
                aria-label="Vorherige Seite"
              >
                <IconChevronLeft size={15} />
              </button>
              <button
                type="button"
                class="tool-btn"
                disabled={pageIndex() >= pages().length - 1}
                onClick={() => goToAdjacentPage(1)}
                title="Zur nächsten Seite scrollen"
                aria-label="Nächste Seite"
              >
                <IconChevronRight size={15} />
              </button>
            </div>

            <Show when={page()}>
              {(currPage) => (
                <div class="active-page-indicator" title="Aktuell sichtbare / aktive Seite">
                  <span class="api-dot" />
                  <span class="api-name">{currPage().title}</span>
                </div>
              )}
            </Show>
          </Show>
        </div>

        <div class="page-strip-right">
          <Show
            when={!isInfiniteMode()}
            fallback={
              <>
                <button
                  type="button"
                  class="tool-pill"
                  onClick={() => infiniteHandle?.fitToContent()}
                  title="Alle Inhalte auf der unendlichen Fläche einpassen"
                >
                  <IconMaximize size={13} />
                  <span class="hide-compact">Einpassen</span>
                </button>
                <button
                  type="button"
                  class="tool-pill"
                  onClick={() => infiniteHandle?.resetView()}
                  title="Ansicht zum Ursprung (100 %) zurücksetzen"
                >
                  <IconCrosshair size={13} />
                  <span class="hide-compact">Ursprung</span>
                </button>
              </>
            }
          >
            <Show when={page()}>
              {(currPage) => (
                <div class="paper-menu-anchor" ref={sizeMenuRef}>
                  <button
                    type="button"
                    class="tool-pill page-size-btn"
                    classList={{ 'is-active': sizeMenuOpen() }}
                    onClick={() => {
                      setPenMenuOpen(false);
                      setPaperMenuOpen(false);
                      setSizeMenuOpen((v) => !v);
                    }}
                    title="Individuelle Breite & Höhe dieser Seite festlegen"
                  >
                    <IconRuler size={14} />
                    <span>
                      {currPage().width} × {currPage().height}
                    </span>
                  </button>

                <Show when={sizeMenuOpen()}>
                  <div
                    class="paper-popover size-popover"
                    role="dialog"
                    aria-label="Seitengröße konfigurieren"
                  >
                    <div class="paper-popover-header">
                      <span>Seitenformat (Seite {pageIndex() + 1})</span>
                      <button
                        type="button"
                        class="icon-btn-xs"
                        onClick={() => setSizeMenuOpen(false)}
                        aria-label="Schließen"
                      >
                        <IconX size={14} />
                      </button>
                    </div>

                    <div class="paper-section">
                      <div class="paper-section-label">Seitenname</div>
                      <input
                        type="text"
                        class="size-title-input"
                        value={currPage().title}
                        onInput={(e) =>
                          props.store.updatePageProperties(currPage().id, {
                            title: e.currentTarget.value,
                          })
                        }
                        placeholder={`Seite ${pageIndex() + 1}`}
                      />
                    </div>

                    <div class="paper-section">
                      <div class="paper-section-label">Individuelle Maße (px)</div>
                      <div class="dim-inputs">
                        <label class="dim-field" title="Breite in Pixel">
                          <span>B</span>
                          <input
                            type="number"
                            min={MIN_PAGE_DIMENSION}
                            max={MAX_PAGE_WIDTH}
                            step={10}
                            value={currPage().width}
                            onChange={(e) =>
                              props.store.updatePageProperties(currPage().id, {
                                width: Number(e.currentTarget.value),
                              })
                            }
                          />
                        </label>
                        <span class="dim-x">×</span>
                        <label class="dim-field" title="Höhe in Pixel">
                          <span>H</span>
                          <input
                            type="number"
                            min={MIN_PAGE_DIMENSION}
                            max={MAX_PAGE_HEIGHT}
                            step={10}
                            value={currPage().height}
                            onChange={(e) =>
                              props.store.updatePageProperties(currPage().id, {
                                height: Number(e.currentTarget.value),
                              })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          class="tool-btn"
                          onClick={() =>
                            props.store.updatePageProperties(currPage().id, {
                              width: currPage().height,
                              height: currPage().width,
                            })
                          }
                          title="Breite & Höhe tauschen (Hoch-/Querformat)"
                        >
                          <IconSwap size={14} />
                        </button>
                      </div>
                    </div>

                    <div class="paper-section">
                      <div class="paper-section-label">Format-Vorlagen</div>
                      <div class="size-preset-grid">
                        <For each={PAGE_SIZE_PRESETS}>
                          {(preset) => {
                            const isMatch = () =>
                              currPage().width === preset.width &&
                              currPage().height === preset.height;
                            return (
                              <button
                                type="button"
                                class="size-preset-btn"
                                classList={{ 'is-active': isMatch() }}
                                onClick={() =>
                                  props.store.updatePageProperties(currPage().id, {
                                    width: preset.width,
                                    height: preset.height,
                                  })
                                }
                              >
                                <span class="sp-name">{preset.shortLabel}</span>
                                <span class="sp-dims">
                                  {preset.width} × {preset.height}
                                </span>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </Show>

          <button
            type="button"
            class="tool-pill page-import-btn"
            onClick={() => pageImportInputRef?.click()}
            title="PDF-Dokument oder Bilder als eigene Seiten importieren"
          >
            <IconFileUp size={14} />
            <span class="hide-compact">PDF / Bild</span>
          </button>

          <button
            type="button"
            class="tool-pill page-add-btn"
            onClick={() => handleAppendPage()}
            title="Neue Seite unten anhängen"
          >
            <IconPlus size={14} />
            <span class="hide-compact">Seite</span>
          </button>
          </Show>
          <input
            ref={pageImportInputRef}
            type="file"
            accept="application/pdf,.pdf,image/*"
            multiple
            class="sr-only"
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              if (files.length > 0) void handleImportFilesAsPages(files);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </div>

      {/* Horizontal Docked Page Overview Strip (Pages Mode only) */}
      <Show when={!isInfiniteMode() && overviewOpen()}>
        <PageOverview
          store={props.store}
          initialShowCreator={overviewAutoCreator()}
          onClose={() => {
            setOverviewOpen(false);
            setOverviewAutoCreator(false);
          }}
          onSelectPage={(id) => scrollToPage(id)}
          onTriggerImportPages={() => pageImportInputRef?.click()}
        />
      </Show>

      {/* Main Canvas Area: Infinite OneNote-style Canvas OR Continuous Multi-Page Document */}
      <Show
        when={!isInfiniteMode()}
        fallback={
          <Show when={page()}>
            {(currPage) => (
              <InfiniteCanvasView
                store={props.store}
                pageId={currPage().id}
                tool={tool()}
                penStyle={penStyle()}
                fountainNibAngle={fountainNibAngle()}
                fountainFlatness={fountainFlatness()}
                brushDynamics={brushDynamics()}
                penColor={penColor()}
                highlighterColor={highlighterColor()}
                penWidth={penWidth()}
                shapeWidth={shapeWidth()}
                highlighterWidth={highlighterWidth()}
                eraserSize={eraserSize()}
                textFontSize={textFontSize()}
                textFontFamily={textFontFamily()}
                textBold={textBold()}
                stylusOnly={stylusOnly()}
                oneFingerScroll={oneFingerScroll()}
                pinchZoomEnabled={pinchZoomEnabled()}
                scrollMomentum={scrollMomentum()}
                palmSensitivity={palmSensitivity()}
                stabilization={stabilization()}
                pressureSensitivity={pressureSensitivity()}
                editingText={editingText()}
                selectedImage={selectedImage()}
                lassoSelection={lassoSelection()}
                onPointerTypeChange={handlePointerTypeDetected}
                onZoomChange={setInfiniteZoom}
                onSetEditingText={setEditingText}
                onCommitEditingText={commitEditingText}
                onExitScribble={() => exitScribbleMode()}
                onSetSelectedImage={setSelectedImage}
                onSetLassoSelection={setLassoSelection}
                onCopyLasso={handleLassoCopy}
                onCutLasso={handleLassoCut}
                onDuplicateLasso={handleLassoDuplicate}
                onRecolorLasso={handleLassoRecolor}
                onDeleteLasso={handleLassoDelete}
                onSyncTextStyle={(patch) => {
                  if (patch.fontSize !== undefined) setTextFontSize(patch.fontSize);
                  if (patch.fontFamily !== undefined) setTextFontFamily(patch.fontFamily);
                  if (patch.bold !== undefined) setTextBold(patch.bold);
                }}
                onImportFilesAt={(targetId, files, dropPt) => {
                  void importImagesToPage(targetId, files, dropPt);
                }}
                onImportPagesFiles={(files) => {
                  void handleImportFilesAsPages(files);
                }}
                registerHandle={(h) => {
                  infiniteHandle = h;
                }}
              />
            )}
          </Show>
        }
      >
        <div
          ref={(el) => {
            viewportRef = el;
            setViewportEl(el);
          }}
          class="canvas-viewport continuous-viewport"
          onScroll={handleViewportScroll}
          onPointerDown={(e) => {
            if (
              e.target === viewportRef ||
              e.target === scrollContentRef ||
              e.target === zoomStageRef
            ) {
              if (editingText()) commitEditingText();
              if (selectedImage()) setSelectedImage(null);
              if (lassoSelection()) setLassoSelection(null);
            }
          }}
        >
        <div ref={scrollContentRef} class="canvas-scroll-content">
          <div ref={zoomStageRef} class="canvas-zoom-stage">
            <For each={pageIds()}>
              {(pid, idx) => (
                <CanvasPageSheet
                  store={props.store}
                  pageId={pid}
                  pageNumber={idx() + 1}
                  totalPages={pages().length}
                  cssScale={docScale()}
                  tool={tool()}
                  penStyle={penStyle()}
                  fountainNibAngle={fountainNibAngle()}
                  fountainFlatness={fountainFlatness()}
                  brushDynamics={brushDynamics()}
                  penColor={penColor()}
                  highlighterColor={highlighterColor()}
                  penWidth={penWidth()}
                  shapeWidth={shapeWidth()}
                  highlighterWidth={highlighterWidth()}
                  eraserSize={eraserSize()}
                  textFontSize={textFontSize()}
                  textFontFamily={textFontFamily()}
                  textBold={textBold()}
                  stylusOnly={stylusOnly()}
                  stabilization={stabilization()}
                  pressureSensitivity={pressureSensitivity()}
                  palmRadiusLimit={palmProfile().pointerWidth}
                  showSheetHeader={showSheetHeaders()}
                  editingText={editingText()}
                  selectedImage={selectedImage()}
                  lassoSelection={lassoSelection()}
                  onPointerTypeChange={handlePointerTypeDetected}
                  onPenPointerDown={() => penContactNotifier?.()}
                  onSetEditingText={setEditingText}
                  onCommitEditingText={commitEditingText}
                  onExitScribble={() => exitScribbleMode()}
                  onSetSelectedImage={setSelectedImage}
                  onSetLassoSelection={setLassoSelection}
                  onCopyLasso={handleLassoCopy}
                  onCutLasso={handleLassoCut}
                  onDuplicateLasso={handleLassoDuplicate}
                  onRecolorLasso={handleLassoRecolor}
                  onDeleteLasso={handleLassoDelete}
                  onSyncTextStyle={(patch) => {
                    if (patch.fontSize !== undefined) setTextFontSize(patch.fontSize);
                    if (patch.fontFamily !== undefined) setTextFontFamily(patch.fontFamily);
                    if (patch.bold !== undefined) setTextBold(patch.bold);
                  }}
                  onOpenSizeMenu={(targetId) => {
                    props.store.setActivePage(targetId);
                    setPaperMenuOpen(false);
                    setSizeMenuOpen(true);
                  }}
                  onImportFilesAt={(targetId, files, dropPt) => {
                    void importImagesToPage(targetId, files, dropPt);
                  }}
                  onImportPagesFiles={(files) => {
                    void handleImportFilesAsPages(files);
                  }}
                  registerElement={registerPageElement}
                  registerTouchAbort={registerTouchAbort}
                />
              )}
            </For>

            {/* Continuous Bottom Page Appender */}
            <div class="continuous-append-bar">
              <span class="cab-label">Neue Seite anhängen:</span>
              <div class="cab-actions">
                <For each={QUICK_APPEND_PRESETS}>
                  {(preset) => (
                    <button
                      type="button"
                      class="btn-extend-canvas"
                      onClick={() =>
                        handleAppendPage({
                          width: preset.width,
                          height: preset.height,
                        })
                      }
                      title={`${preset.label} (${preset.width} × ${preset.height} px)`}
                    >
                      <IconPlus size={13} />
                      <span>{preset.label}</span>
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  class="btn-extend-canvas"
                  onClick={() => pageImportInputRef?.click()}
                  title="PDF oder Bilder als neue Seiten importieren"
                >
                  <IconFileUp size={13} />
                  <span>PDF / Bild als Seite</span>
                </button>
                <button
                  type="button"
                  class="btn-extend-canvas is-accent-btn"
                  onClick={() => {
                    setOverviewAutoCreator(true);
                    setOverviewOpen(true);
                  }}
                  title="Benutzerdefinierte Breite & Höhe in der Seitenübersicht wählen"
                >
                  <IconRuler size={13} />
                  <span>Eigenes Format…</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </Show>

      <Show when={!isInfiniteMode() && liveZoomPreview() !== null}>
        <div class="pinch-zoom-badge" aria-live="polite">
          {Math.round((liveZoomPreview() ?? zoom()) * 100)}%
        </div>
      </Show>

      <Show when={importProgress()}>
        {(status) => (
          <div class="import-progress-banner" role="status" aria-live="polite">
            <span class="import-spinner" />
            <span>{status()}</span>
          </div>
        )}
      </Show>

      <Show when={isDragOver()}>
        <div class="drop-overlay">
          <div class="drop-overlay-card">
            <IconImage size={28} />
            <span>PDF als Seiten oder Bild auf „{page()?.title}“ ablegen</span>
          </div>
        </div>
      </Show>

      <div class="pane-statusbar">
        <Show
          when={!isInfiniteMode()}
          fallback={<span>Unendlicher Canvas</span>}
        >
          <span>
            Seite {pageIndex() + 1}/{pages().length}: {page()?.title}
          </span>
          <span class="status-dot">·</span>
          <span>
            {page()?.width ?? 0} × {page()?.height ?? 0} px
          </span>
        </Show>
        <span class="status-dot">·</span>
        <span>{page()?.strokes.length ?? 0} Striche</span>
        <span class="status-dot">·</span>
        <span>{page()?.texts.length ?? 0} Texte</span>
        <Show when={(page()?.images.length ?? 0) > 0}>
          <span class="status-dot">·</span>
          <span>{page()?.images.length} Bilder</span>
        </Show>
        <span class="status-dot">·</span>
        <span class="pointer-badge" classList={{ 'is-pen': lastPointerType() === 'pen' }}>
          {tool() === 'scribble'
            ? 'Handschrift → Text (Kritzeln)'
            : tool() === 'lasso'
              ? lassoSelection()
                ? `Lasso · ${formatLassoCountLabel(getLassoItemCount(lassoSelection()))}`
                : 'Lasso · Einkreisen'
              : tool() === 'pen'
                ? `${penStyleConfig().label} · ${pointerTypeLabel()}`
                : pointerTypeLabel()}
        </span>
        <span class="status-spacer" />
        <div class="zoom-controls">
          <button
            type="button"
            class="zoom-btn"
            onClick={() => {
              if (isInfiniteMode()) {
                infiniteHandle?.zoomBy(-0.15);
              } else {
                setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.15) * 100) / 100));
              }
            }}
            title="Verkleinern"
          >
            <IconZoomOut size={13} />
          </button>
          <button
            type="button"
            class="zoom-value"
            onClick={() => {
              if (isInfiniteMode()) {
                infiniteHandle?.setZoom(1);
              } else {
                setZoom(1);
              }
            }}
            title="Zoom zurücksetzen (100 %)"
          >
            {Math.round(
              (isInfiniteMode() ? infiniteZoom() : liveZoomPreview() ?? zoom()) * 100
            )}
            %
          </button>
          <button
            type="button"
            class="zoom-btn"
            onClick={() => {
              if (isInfiniteMode()) {
                infiniteHandle?.zoomBy(0.15);
              } else {
                setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.15) * 100) / 100));
              }
            }}
            title="Vergrößern"
          >
            <IconZoomIn size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}
