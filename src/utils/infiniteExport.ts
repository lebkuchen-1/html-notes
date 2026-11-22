import type { CanvasPage, PaperConfig, ThemeMode } from '../types';
import {
  computePageContentBounds,
  ensureImagesLoaded,
  getStrokeBounds,
  measureCanvasTextBounds,
  renderInfiniteCanvas,
  resolvePaperBackgroundColor,
  type ContentBounds,
  type InfiniteCamera,
} from './canvasRenderer';
import type { LassoSelection } from './lasso';
import { buildPdfFromJpegPages, canvasToBlob, canvasToJpegBytes, type PdfImagePage } from './pdfWriter';

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InfiniteViewportSnapshot {
  camera: InfiniteCamera;
  viewportWidth: number;
  viewportHeight: number;
  worldRect: WorldRect;
}

export type InfiniteExportScope = 'viewport' | 'content' | 'region' | 'selection';
export type InfiniteExportFormat = 'png' | 'jpeg' | 'pdf-single' | 'pdf-pages';
export type InfiniteExportBackground =
  | 'canvas'
  | 'solid'
  | 'white'
  | 'white-pattern'
  | 'transparent';
export type PdfPaperPresetId =
  | 'a4-p'
  | 'a4-l'
  | 'a3-p'
  | 'a3-l'
  | 'letter-p'
  | 'letter-l';
export type PdfPagingMode = 'tile' | 'fit-width' | 'fit-page';

export interface InfiniteExportLayers {
  strokes: boolean;
  highlighter: boolean;
  texts: boolean;
  images: boolean;
  backgroundImage: boolean;
}

export interface InfiniteExportOptions {
  scope: InfiniteExportScope;
  format: InfiniteExportFormat;
  background: InfiniteExportBackground;
  scale: 1 | 2 | 3;
  jpegQuality: number;
  padding: number;
  layers: InfiniteExportLayers;
  pdfPaper: PdfPaperPresetId;
  pdfPagingMode: PdfPagingMode;
  pdfMarginMm: number;
  pdfSkipEmptyPages: boolean;
  pdfShowPageNumbers: boolean;
  pdfTileScale: number;
}

export interface PdfPaperPreset {
  id: PdfPaperPresetId;
  label: string;
  shortLabel: string;
  widthMm: number;
  heightMm: number;
}

export const PDF_PAPER_PRESETS: PdfPaperPreset[] = [
  { id: 'a4-p', label: 'A4 Hochformat', shortLabel: 'A4 Hoch', widthMm: 210, heightMm: 297 },
  { id: 'a4-l', label: 'A4 Querformat', shortLabel: 'A4 Quer', widthMm: 297, heightMm: 210 },
  { id: 'a3-p', label: 'A3 Hochformat', shortLabel: 'A3 Hoch', widthMm: 297, heightMm: 420 },
  { id: 'a3-l', label: 'A3 Querformat', shortLabel: 'A3 Quer', widthMm: 420, heightMm: 297 },
  { id: 'letter-p', label: 'US Letter Hoch', shortLabel: 'Letter', widthMm: 215.9, heightMm: 279.4 },
  { id: 'letter-l', label: 'US Letter Quer', shortLabel: 'Letter Quer', widthMm: 279.4, heightMm: 215.9 },
];

export const PDF_PAPER_MAP = new Map<PdfPaperPresetId, PdfPaperPreset>(
  PDF_PAPER_PRESETS.map((p) => [p.id, p])
);

/** Matches A4 calibration used throughout Notizblock (794 px = 210 mm ≈ 96 DPI) */
export const LOGICAL_PX_PER_MM = 794 / 210;
export const LOGICAL_PX_PER_CM = 794 / 21;
const PT_PER_MM = 72 / 25.4;

/** Conservative cross-browser canvas limits (safe on iPadOS Safari ~16.7 MP cap) */
const MAX_CANVAS_EDGE_PX = 4096;
const MAX_CANVAS_AREA_PX = 16_000_000;
const MAX_PDF_TILES = 64;

const EXPORT_PREFS_STORAGE_KEY = 'solid-notes:infinite-export-prefs';

export function createDefaultInfiniteExportOptions(defaultScale: 1 | 2 | 3 = 2): InfiniteExportOptions {
  return {
    scope: 'viewport',
    format: 'png',
    background: 'canvas',
    scale: defaultScale,
    jpegQuality: 0.92,
    padding: 64,
    layers: {
      strokes: true,
      highlighter: true,
      texts: true,
      images: true,
      backgroundImage: true,
    },
    pdfPaper: 'a4-p',
    pdfPagingMode: 'tile',
    pdfMarginMm: 10,
    pdfSkipEmptyPages: true,
    pdfShowPageNumbers: true,
    pdfTileScale: 1,
  };
}

export function loadStoredExportPrefs(defaultScale: 1 | 2 | 3 = 2): InfiniteExportOptions {
  const base = createDefaultInfiniteExportOptions(defaultScale);
  try {
    const raw = localStorage.getItem(EXPORT_PREFS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<InfiniteExportOptions>;
    if (!parsed || typeof parsed !== 'object') return base;

    const format: InfiniteExportFormat =
      parsed.format === 'png' ||
      parsed.format === 'jpeg' ||
      parsed.format === 'pdf-single' ||
      parsed.format === 'pdf-pages'
        ? parsed.format
        : base.format;

    let background: InfiniteExportBackground =
      parsed.background === 'canvas' ||
      parsed.background === 'solid' ||
      parsed.background === 'white' ||
      parsed.background === 'white-pattern' ||
      parsed.background === 'transparent'
        ? parsed.background
        : base.background;

    if (format !== 'png' && background === 'transparent') {
      background = 'canvas';
    }

    const scale: 1 | 2 | 3 =
      parsed.scale === 1 || parsed.scale === 2 || parsed.scale === 3
        ? parsed.scale
        : base.scale;

    const pdfPaper: PdfPaperPresetId =
      parsed.pdfPaper && PDF_PAPER_MAP.has(parsed.pdfPaper)
        ? parsed.pdfPaper
        : base.pdfPaper;

    const pdfPagingMode: PdfPagingMode =
      parsed.pdfPagingMode === 'tile' ||
      parsed.pdfPagingMode === 'fit-width' ||
      parsed.pdfPagingMode === 'fit-page'
        ? parsed.pdfPagingMode
        : base.pdfPagingMode;

    return {
      ...base,
      format,
      background,
      scale,
      jpegQuality:
        typeof parsed.jpegQuality === 'number' && parsed.jpegQuality >= 0.6 && parsed.jpegQuality <= 1
          ? parsed.jpegQuality
          : base.jpegQuality,
      padding:
        typeof parsed.padding === 'number' && parsed.padding >= 0 && parsed.padding <= 240
          ? parsed.padding
          : base.padding,
      pdfPaper,
      pdfPagingMode,
      pdfMarginMm:
        typeof parsed.pdfMarginMm === 'number' && parsed.pdfMarginMm >= 0 && parsed.pdfMarginMm <= 30
          ? parsed.pdfMarginMm
          : base.pdfMarginMm,
      pdfSkipEmptyPages:
        typeof parsed.pdfSkipEmptyPages === 'boolean'
          ? parsed.pdfSkipEmptyPages
          : base.pdfSkipEmptyPages,
      pdfShowPageNumbers:
        typeof parsed.pdfShowPageNumbers === 'boolean'
          ? parsed.pdfShowPageNumbers
          : base.pdfShowPageNumbers,
      pdfTileScale:
        typeof parsed.pdfTileScale === 'number' && parsed.pdfTileScale >= 0.5 && parsed.pdfTileScale <= 1.5
          ? parsed.pdfTileScale
          : base.pdfTileScale,
    };
  } catch {
    return base;
  }
}

export function saveExportPrefs(options: InfiniteExportOptions) {
  try {
    localStorage.setItem(
      EXPORT_PREFS_STORAGE_KEY,
      JSON.stringify({
        format: options.format,
        background: options.background,
        scale: options.scale,
        jpegQuality: options.jpegQuality,
        padding: options.padding,
        pdfPaper: options.pdfPaper,
        pdfPagingMode: options.pdfPagingMode,
        pdfMarginMm: options.pdfMarginMm,
        pdfSkipEmptyPages: options.pdfSkipEmptyPages,
        pdfShowPageNumbers: options.pdfShowPageNumbers,
        pdfTileScale: options.pdfTileScale,
      })
    );
  } catch {
    // ignore storage errors
  }
}

let sharedMeasureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!sharedMeasureCtx && typeof document !== 'undefined') {
    sharedMeasureCtx = document.createElement('canvas').getContext('2d');
  }
  return sharedMeasureCtx;
}

export function resolveExportPaperConfig(
  original: PaperConfig,
  background: InfiniteExportBackground
): { paperConfig: PaperConfig; skipPaperBackground: boolean } {
  switch (background) {
    case 'transparent':
      return {
        paperConfig: original,
        skipPaperBackground: true,
      };
    case 'solid':
      return {
        paperConfig: {
          ...original,
          pattern: 'blank',
          showMargin: false,
        },
        skipPaperBackground: false,
      };
    case 'white':
      return {
        paperConfig: {
          ...original,
          backgroundColor: '#ffffff',
          pattern: 'blank',
          showMargin: false,
        },
        skipPaperBackground: false,
      };
    case 'white-pattern':
      return {
        paperConfig: {
          ...original,
          backgroundColor: '#ffffff',
          lineColor: 'auto',
        },
        skipPaperBackground: false,
      };
    case 'canvas':
    default:
      return {
        paperConfig: original,
        skipPaperBackground: false,
      };
  }
}

export function buildFilteredExportPage(
  page: CanvasPage,
  options: InfiniteExportOptions,
  lassoSelection?: LassoSelection | null
): { page: CanvasPage; skipPaperBackground: boolean } {
  const onlySelection =
    options.scope === 'selection' &&
    lassoSelection &&
    lassoSelection.pageId === page.id;

  const selStrokes = onlySelection ? new Set(lassoSelection.strokeIds) : null;
  const selTexts = onlySelection ? new Set(lassoSelection.textIds) : null;
  const selImages = onlySelection ? new Set(lassoSelection.imageIds) : null;

  const strokes = page.strokes.filter((s) => {
    if (selStrokes && !selStrokes.has(s.id)) return false;
    if (s.tool === 'highlighter') return options.layers.highlighter;
    return options.layers.strokes;
  });

  const texts = options.layers.texts
    ? page.texts.filter((t) => !selTexts || selTexts.has(t.id))
    : [];

  const images = options.layers.images
    ? page.images.filter((img) => !selImages || selImages.has(img.id))
    : [];

  const backgroundImage =
    !onlySelection && options.layers.backgroundImage ? page.backgroundImage ?? null : null;

  const { paperConfig, skipPaperBackground } = resolveExportPaperConfig(
    page.paperConfig,
    options.background
  );

  return {
    page: {
      ...page,
      strokes,
      texts,
      images,
      backgroundImage,
      paperConfig,
    },
    skipPaperBackground,
  };
}

export function resolveExportWorldRect(
  filteredPage: CanvasPage,
  options: InfiniteExportOptions,
  viewport: InfiniteViewportSnapshot,
  customRegion: WorldRect | null
): { rect: WorldRect; isEmptyFallback: boolean } {
  if (options.scope === 'viewport') {
    return {
      rect: {
        x: viewport.worldRect.x,
        y: viewport.worldRect.y,
        width: Math.max(40, viewport.worldRect.width),
        height: Math.max(40, viewport.worldRect.height),
      },
      isEmptyFallback: false,
    };
  }

  if (options.scope === 'region' && customRegion && customRegion.width >= 16 && customRegion.height >= 16) {
    return {
      rect: { ...customRegion },
      isEmptyFallback: false,
    };
  }

  // 'content' or 'selection' (or fallback when customRegion not yet chosen)
  const bounds = computePageContentBounds(filteredPage, getMeasureCtx());
  if (!bounds) {
    return {
      rect: {
        x: viewport.worldRect.x,
        y: viewport.worldRect.y,
        width: Math.max(120, viewport.worldRect.width),
        height: Math.max(120, viewport.worldRect.height),
      },
      isEmptyFallback: true,
    };
  }

  const pad = Math.max(0, options.padding);
  return {
    rect: {
      x: bounds.minX - pad,
      y: bounds.minY - pad,
      width: Math.max(48, bounds.maxX - bounds.minX + pad * 2),
      height: Math.max(48, bounds.maxY - bounds.minY + pad * 2),
    },
    isEmptyFallback: false,
  };
}

export interface PixelExportMetrics {
  pixelWidth: number;
  pixelHeight: number;
  effectiveScale: number;
  requestedScale: number;
  wasClamped: boolean;
}

export function computeSingleImageMetrics(
  worldRect: WorldRect,
  options: InfiniteExportOptions,
  viewport: InfiniteViewportSnapshot
): PixelExportMetrics {
  // When exporting the current viewport while zoomed IN (>100%), ensure 1x matches
  // at least the user's screen CSS dimensions so details stay crisp!
  const viewportBoost =
    options.scope === 'viewport'
      ? Math.max(1, viewport.viewportWidth / Math.max(1, worldRect.width))
      : 1;
  const requestedScale = Math.max(1, Math.min(3, options.scale)) * viewportBoost;

  const edgeCapScale = MAX_CANVAS_EDGE_PX / Math.max(1, worldRect.width, worldRect.height);
  const areaCapScale = Math.sqrt(
    MAX_CANVAS_AREA_PX / Math.max(1, worldRect.width * worldRect.height)
  );
  const effectiveScale = Math.max(0.1, Math.min(requestedScale, edgeCapScale, areaCapScale));
  const wasClamped = effectiveScale < requestedScale * 0.98;

  return {
    pixelWidth: Math.max(1, Math.round(worldRect.width * effectiveScale)),
    pixelHeight: Math.max(1, Math.round(worldRect.height * effectiveScale)),
    effectiveScale,
    requestedScale,
    wasClamped,
  };
}

export interface PdfTileSpec {
  row: number;
  col: number;
  /** World rectangle mapped into the printable area of this PDF page */
  worldRect: WorldRect;
  /** Printable sub-rect inside the PDF page in mm */
  drawXmm: number;
  drawYmm: number;
  drawWmm: number;
  drawHmm: number;
  hasContent: boolean;
  skipped: boolean;
  /** 1-based page number among non-skipped pages, or null if skipped */
  pageNumber: number | null;
}

export interface PdfTileLayout {
  paper: PdfPaperPreset;
  cols: number;
  rows: number;
  totalTiles: number;
  includedPages: number;
  skippedEmptyPages: number;
  wasTileCapped: boolean;
  tiles: PdfTileSpec[];
}

function rectsOverlap(a: ContentBounds, b: WorldRect): boolean {
  return !(
    a.maxX < b.x ||
    a.minX > b.x + b.width ||
    a.maxY < b.y ||
    a.minY > b.y + b.height
  );
}

function collectItemBounds(page: CanvasPage): ContentBounds[] {
  const list: ContentBounds[] = [];
  const ctx = getMeasureCtx();

  if (page.backgroundImage?.src) {
    list.push({ minX: 0, minY: 0, maxX: page.width, maxY: page.height });
  }
  for (const img of page.images) {
    list.push({
      minX: img.x,
      minY: img.y,
      maxX: img.x + img.width,
      maxY: img.y + img.height,
    });
  }
  for (const stroke of page.strokes) {
    const b = getStrokeBounds(stroke);
    if (b) list.push(b);
  }
  for (const item of page.texts) {
    if (!item.text) continue;
    if (ctx) {
      const b = measureCanvasTextBounds(ctx, item);
      list.push({
        minX: b.x - 4,
        minY: b.y - 4,
        maxX: b.x + b.width + 4,
        maxY: b.y + b.height + 4,
      });
    } else {
      const lines = item.text.split('\n');
      const maxLen = Math.max(4, ...lines.map((l) => l.length));
      list.push({
        minX: item.x - 4,
        minY: item.y - 4,
        maxX: item.x + maxLen * item.fontSize * 0.62 + 4,
        maxY: item.y + lines.length * item.fontSize * 1.35 + 4,
      });
    }
  }
  return list;
}

export function computePdfTileLayout(
  filteredPage: CanvasPage,
  worldRect: WorldRect,
  options: InfiniteExportOptions
): PdfTileLayout {
  const paper = PDF_PAPER_MAP.get(options.pdfPaper) ?? PDF_PAPER_PRESETS[0];
  const marginMm = Math.max(0, Math.min(30, options.pdfMarginMm));
  const innerWmm = Math.max(40, paper.widthMm - marginMm * 2);
  const innerHmm = Math.max(40, paper.heightMm - marginMm * 2);

  let cols = 1;
  let rows = 1;
  let tileWorldW = worldRect.width;
  let tileWorldH = worldRect.height;
  let wasTileCapped = false;

  if (options.pdfPagingMode === 'fit-page') {
    const fitScale = Math.min(innerWmm / Math.max(1, worldRect.width), innerHmm / Math.max(1, worldRect.height));
    const drawWmm = worldRect.width * fitScale;
    const drawHmm = worldRect.height * fitScale;
    const drawXmm = marginMm + (innerWmm - drawWmm) / 2;
    const drawYmm = marginMm + (innerHmm - drawHmm) / 2;
    return {
      paper,
      cols: 1,
      rows: 1,
      totalTiles: 1,
      includedPages: 1,
      skippedEmptyPages: 0,
      wasTileCapped: false,
      tiles: [
        {
          row: 0,
          col: 0,
          worldRect: { ...worldRect },
          drawXmm,
          drawYmm,
          drawWmm,
          drawHmm,
          hasContent: true,
          skipped: false,
          pageNumber: 1,
        },
      ],
    };
  }

  if (options.pdfPagingMode === 'fit-width') {
    cols = 1;
    tileWorldW = Math.max(1, worldRect.width);
    tileWorldH = tileWorldW * (innerHmm / innerWmm);
    rows = Math.max(1, Math.ceil(worldRect.height / Math.max(1, tileWorldH)));
    if (rows > MAX_PDF_TILES) {
      rows = MAX_PDF_TILES;
      tileWorldH = worldRect.height / rows;
      wasTileCapped = true;
    }
  } else {
    // 'tile' — calibrated physical scale (100% = 794px per A4 width)
    const tileScale = Math.max(0.5, Math.min(1.5, options.pdfTileScale || 1));
    tileWorldW = (innerWmm * LOGICAL_PX_PER_MM) / tileScale;
    tileWorldH = (innerHmm * LOGICAL_PX_PER_MM) / tileScale;
    cols = Math.max(1, Math.ceil(worldRect.width / Math.max(1, tileWorldW)));
    rows = Math.max(1, Math.ceil(worldRect.height / Math.max(1, tileWorldH)));
    if (cols * rows > MAX_PDF_TILES) {
      const shrink = Math.sqrt((cols * rows) / MAX_PDF_TILES);
      cols = Math.max(1, Math.floor(cols / shrink));
      rows = Math.max(1, Math.floor(rows / shrink));
      tileWorldW = worldRect.width / cols;
      tileWorldH = worldRect.height / rows;
      wasTileCapped = true;
    }
  }

  const itemBounds = options.pdfSkipEmptyPages ? collectItemBounds(filteredPage) : [];
  const rawTiles: PdfTileSpec[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tileRect: WorldRect = {
        x: worldRect.x + c * tileWorldW,
        y: worldRect.y + r * tileWorldH,
        width: tileWorldW,
        height: tileWorldH,
      };
      const hasContent =
        !options.pdfSkipEmptyPages ||
        itemBounds.some((b) => rectsOverlap(b, tileRect));
      rawTiles.push({
        row: r,
        col: c,
        worldRect: tileRect,
        drawXmm: marginMm,
        drawYmm: marginMm,
        drawWmm: innerWmm,
        drawHmm: innerHmm,
        hasContent,
        skipped: false,
        pageNumber: null,
      });
    }
  }

  const anyNonEmpty = rawTiles.some((t) => t.hasContent);
  let nextPageNum = 1;
  let skippedEmptyPages = 0;
  for (const tile of rawTiles) {
    if (options.pdfSkipEmptyPages && anyNonEmpty && !tile.hasContent) {
      tile.skipped = true;
      skippedEmptyPages++;
    } else {
      tile.skipped = false;
      tile.pageNumber = nextPageNum++;
    }
  }

  return {
    paper,
    cols,
    rows,
    totalTiles: rawTiles.length,
    includedPages: nextPageNum - 1,
    skippedEmptyPages,
    wasTileCapped,
    tiles: rawTiles,
  };
}

/**
 * Renders an instant preview onto a small preview canvas inside the export dialog,
 * including PDF tile break overlays & skipped-empty indicators when in pdf-pages mode.
 */
export function renderExportPreview(
  canvas: HTMLCanvasElement,
  filteredPage: CanvasPage,
  skipPaperBackground: boolean,
  worldRect: WorldRect,
  theme: ThemeMode,
  pdfLayout: PdfTileLayout | null,
  maxCssW: number,
  maxCssH: number
) {
  const aspect = worldRect.width / Math.max(1, worldRect.height);
  let cssW = maxCssW;
  let cssH = cssW / aspect;
  if (cssH > maxCssH) {
    cssH = maxCssH;
    cssW = cssH * aspect;
  }
  cssW = Math.max(80, Math.round(cssW));
  cssH = Math.max(60, Math.round(cssH));

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const targetW = Math.max(1, Math.round(cssW * dpr));
  const targetH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, targetW, targetH);

  // If pdf-pages with multiple tiles, cover the full tiled extent so page breaks align cleanly
  let previewWorld = worldRect;
  if (pdfLayout && (pdfLayout.cols > 1 || pdfLayout.rows > 1)) {
    const last = pdfLayout.tiles[pdfLayout.tiles.length - 1];
    previewWorld = {
      x: worldRect.x,
      y: worldRect.y,
      width: Math.max(worldRect.width, last.worldRect.x + last.worldRect.width - worldRect.x),
      height: Math.max(worldRect.height, last.worldRect.y + last.worldRect.height - worldRect.y),
    };
  }

  const zoom = Math.min(cssW / Math.max(1, previewWorld.width), cssH / Math.max(1, previewWorld.height));
  const renderedW = previewWorld.width * zoom;
  const renderedH = previewWorld.height * zoom;
  const offsetX = (cssW - renderedW) / 2;
  const offsetY = (cssH - renderedH) / 2;

  ctx.save();
  ctx.translate(offsetX * dpr, offsetY * dpr);
  ctx.beginPath();
  ctx.rect(0, 0, renderedW * dpr, renderedH * dpr);
  ctx.clip();

  renderInfiniteCanvas(
    ctx,
    filteredPage,
    renderedW,
    renderedH,
    { x: previewWorld.x, y: previewWorld.y, zoom },
    theme,
    dpr,
    { skipPaperBackground }
  );

  // Overlay PDF page grid & page numbers on the preview
  if (pdfLayout && pdfLayout.totalTiles > 1) {
    ctx.save();
    ctx.scale(dpr, dpr);
    for (const tile of pdfLayout.tiles) {
      const tx = (tile.worldRect.x - previewWorld.x) * zoom;
      const ty = (tile.worldRect.y - previewWorld.y) * zoom;
      const tw = tile.worldRect.width * zoom;
      const th = tile.worldRect.height * zoom;

      if (tile.skipped) {
        ctx.fillStyle = 'rgba(100, 116, 139, 0.28)';
        ctx.fillRect(tx, ty, tw, th);
        // Subtle diagonal slash
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx + 4, ty + 4);
        ctx.lineTo(tx + tw - 4, ty + th - 4);
        ctx.stroke();
      }

      ctx.strokeStyle = tile.skipped
        ? 'rgba(100, 116, 139, 0.55)'
        : 'rgba(79, 70, 229, 0.78)';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(tx + 0.5, ty + 0.5, Math.max(0, tw - 1), Math.max(0, th - 1));
      ctx.setLineDash([]);

      if (tile.pageNumber !== null && tw >= 24 && th >= 22) {
        const badgeText = String(tile.pageNumber);
        ctx.font = '700 10px -apple-system, BlinkMacSystemFont, sans-serif';
        const bw = Math.max(18, ctx.measureText(badgeText).width + 10);
        const bh = 16;
        ctx.fillStyle = 'rgba(79, 70, 229, 0.9)';
        ctx.beginPath();
        ctx.roundRect(tx + 4, ty + 4, bw, bh, 4);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, tx + 4 + bw / 2, ty + 4 + bh / 2 + 0.5);
      }
    }
    ctx.restore();
  }

  ctx.restore();
}

export interface GeneratedExportArtifact {
  blob: Blob;
  filename: string;
  mimeType: string;
  summary: string;
}

export function getExportFileExtension(format: InfiniteExportFormat): string {
  switch (format) {
    case 'png':
      return 'png';
    case 'jpeg':
      return 'jpg';
    case 'pdf-single':
    case 'pdf-pages':
      return 'pdf';
  }
}

export function sanitizeExportFilename(raw: string, format: InfiniteExportFormat): string {
  const ext = getExportFileExtension(format);
  const stripped = raw
    .trim()
    .replace(/\.(png|jpe?g|pdf)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const base = stripped || 'canvas-export';
  return `${base}.${ext}`;
}

export async function generateInfiniteExportArtifact(
  page: CanvasPage,
  theme: ThemeMode,
  options: InfiniteExportOptions,
  viewport: InfiniteViewportSnapshot,
  customRegion: WorldRect | null,
  lassoSelection: LassoSelection | null,
  rawFilename: string,
  onProgress?: (status: string) => void
): Promise<GeneratedExportArtifact> {
  const { page: filteredPage, skipPaperBackground } = buildFilteredExportPage(
    page,
    options,
    lassoSelection
  );

  // Wait for all images used in the filtered page to decode
  const imgSources = filteredPage.images.map((i) => i.src);
  if (filteredPage.backgroundImage?.src) imgSources.push(filteredPage.backgroundImage.src);
  if (imgSources.length > 0) {
    onProgress?.('Bilder werden vorbereitet…');
    await ensureImagesLoaded(imgSources);
  }

  const { rect: worldRect } = resolveExportWorldRect(
    filteredPage,
    options,
    viewport,
    customRegion
  );
  const filename = sanitizeExportFilename(rawFilename, options.format);

  // ==================== 1. PNG / JPEG SINGLE IMAGE ====================
  if (options.format === 'png' || options.format === 'jpeg') {
    onProgress?.(options.format === 'png' ? 'PNG wird gerendert…' : 'JPEG wird gerendert…');
    const metrics = computeSingleImageMetrics(worldRect, options, viewport);
    const offscreen = document.createElement('canvas');
    offscreen.width = metrics.pixelWidth;
    offscreen.height = metrics.pixelHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

    const forceOpaque = options.format === 'jpeg';
    const effectiveSkipBg = forceOpaque ? false : skipPaperBackground;

    renderInfiniteCanvas(
      ctx,
      filteredPage,
      worldRect.width,
      worldRect.height,
      { x: worldRect.x, y: worldRect.y, zoom: 1 },
      theme,
      metrics.effectiveScale,
      { skipPaperBackground: effectiveSkipBg }
    );

    const mimeType = options.format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(
      offscreen,
      mimeType,
      options.format === 'jpeg' ? options.jpegQuality : undefined
    );
    return {
      blob,
      filename,
      mimeType,
      summary: `${metrics.pixelWidth} × ${metrics.pixelHeight} px (${options.format.toUpperCase()})`,
    };
  }

  // ==================== 2. PDF SINGLE SHEET (ENDLESS / ONE BIG PAGE) ====================
  if (options.format === 'pdf-single') {
    onProgress?.('PDF-Einzelblatt wird erstellt…');
    const metrics = computeSingleImageMetrics(worldRect, options, viewport);
    const offscreen = document.createElement('canvas');
    offscreen.width = metrics.pixelWidth;
    offscreen.height = metrics.pixelHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

    renderInfiniteCanvas(
      ctx,
      filteredPage,
      worldRect.width,
      worldRect.height,
      { x: worldRect.x, y: worldRect.y, zoom: 1 },
      theme,
      metrics.effectiveScale,
      { skipPaperBackground: false }
    );

    const jpegBytes = await canvasToJpegBytes(offscreen, 0.93);
    // Physical PDF size in points matching our A4 calibration (794px = 210mm = 595.28pt)
    const widthPt = (worldRect.width / LOGICAL_PX_PER_MM) * PT_PER_MM;
    const heightPt = (worldRect.height / LOGICAL_PX_PER_MM) * PT_PER_MM;

    const blob = buildPdfFromJpegPages([
      {
        widthPt: Math.max(72, Math.min(14400, widthPt)),
        heightPt: Math.max(72, Math.min(14400, heightPt)),
        jpegBytes,
        pixelWidth: metrics.pixelWidth,
        pixelHeight: metrics.pixelHeight,
      },
    ]);

    return {
      blob,
      filename,
      mimeType: 'application/pdf',
      summary: `PDF-Einzelblatt (${Math.round(worldRect.width / LOGICAL_PX_PER_CM)} × ${Math.round(worldRect.height / LOGICAL_PX_PER_CM)} cm)`,
    };
  }

  // ==================== 3. PDF MULTI-PAGE PRINT TILES (A4 / A3 / LETTER) ====================
  const layout = computePdfTileLayout(filteredPage, worldRect, options);
  const includedTiles = layout.tiles.filter((t) => !t.skipped);
  const pdfPages: PdfImagePage[] = [];

  // Target crisp print resolution per page (~150 DPI at 1x, ~200 DPI at 2x, ~260 DPI at 3x)
  const dpiMultiplier = options.scale === 1 ? 1.5 : options.scale === 2 ? 2.15 : 2.8;
  const rawPagePxW = Math.round(layout.paper.widthMm * LOGICAL_PX_PER_MM * dpiMultiplier);
  const rawPagePxH = Math.round(layout.paper.heightMm * LOGICAL_PX_PER_MM * dpiMultiplier);
  const safePageScale = Math.min(
    1,
    MAX_CANVAS_EDGE_PX / Math.max(1, rawPagePxW, rawPagePxH),
    Math.sqrt(MAX_CANVAS_AREA_PX / Math.max(1, rawPagePxW * rawPagePxH))
  );
  const pagePxW = Math.max(300, Math.round(rawPagePxW * safePageScale));
  const pagePxH = Math.max(300, Math.round(rawPagePxH * safePageScale));
  const pxPerMm = pagePxW / layout.paper.widthMm;

  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = pagePxW;
  pageCanvas.height = pagePxH;
  const ctx = pageCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

  const outerBg =
    options.background === 'white' || options.background === 'white-pattern'
      ? '#ffffff'
      : resolvePaperBackgroundColor(filteredPage.paperConfig, theme);
  const isOuterDark =
    outerBg.toLowerCase() !== '#ffffff' &&
    outerBg.toLowerCase() !== '#fcf9f2' &&
    theme === 'dark' &&
    filteredPage.paperConfig.backgroundColor === 'theme';

  for (let i = 0; i < includedTiles.length; i++) {
    const tile = includedTiles[i];
    onProgress?.(`PDF-Seite ${i + 1} von ${includedTiles.length} wird gerendert…`);

    // Fill full physical sheet background (margins)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = outerBg;
    ctx.fillRect(0, 0, pagePxW, pagePxH);

    // Clip to printable area and render world slice
    const drawX = Math.round(tile.drawXmm * pxPerMm);
    const drawY = Math.round(tile.drawYmm * pxPerMm);
    const drawW = Math.max(1, Math.round(tile.drawWmm * pxPerMm));
    const drawH = Math.max(1, Math.round(tile.drawHmm * pxPerMm));

    ctx.translate(drawX, drawY);
    ctx.beginPath();
    ctx.rect(0, 0, drawW, drawH);
    ctx.clip();

    const tileZoom = drawW / Math.max(1, tile.worldRect.width);
    renderInfiniteCanvas(
      ctx,
      filteredPage,
      tile.worldRect.width,
      tile.worldRect.height,
      {
        x: tile.worldRect.x,
        y: tile.worldRect.y,
        zoom: 1,
      },
      theme,
      tileZoom,
      { skipPaperBackground: false }
    );
    ctx.restore();

    // Optional clean page number in bottom margin
    if (options.pdfShowPageNumbers && includedTiles.length > 1) {
      ctx.save();
      const fontSize = Math.max(12, Math.round(3.2 * pxPerMm));
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      ctx.fillStyle = isOuterDark ? 'rgba(226, 232, 240, 0.72)' : 'rgba(71, 85, 105, 0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label =
        layout.cols > 1
          ? `Seite ${i + 1} / ${includedTiles.length}  (Zeile ${tile.row + 1}, Spalte ${tile.col + 1})`
          : `Seite ${i + 1} / ${includedTiles.length}`;
      const footerY = pagePxH - Math.max(8, Math.round(Math.max(3, options.pdfMarginMm * 0.35) * pxPerMm));
      ctx.fillText(label, pagePxW / 2, footerY);
      ctx.restore();
    }

    const jpegBytes = await canvasToJpegBytes(pageCanvas, 0.92);
    pdfPages.push({
      widthPt: layout.paper.widthMm * PT_PER_MM,
      heightPt: layout.paper.heightMm * PT_PER_MM,
      jpegBytes,
      pixelWidth: pagePxW,
      pixelHeight: pagePxH,
    });

    // Yield briefly on multi-page builds so UI progress stays responsive on iPadOS
    if (includedTiles.length > 2) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const blob = buildPdfFromJpegPages(pdfPages);
  return {
    blob,
    filename,
    mimeType: 'application/pdf',
    summary: `PDF (${layout.paper.shortLabel} · ${includedTiles.length} ${includedTiles.length === 1 ? 'Seite' : 'Seiten'})`,
  };
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function canCopyPngToClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  );
}

export function canShareFilesNative(): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function' ||
    typeof File === 'undefined'
  ) {
    return false;
  }
  try {
    const probe = new File([new Uint8Array([0])], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function formatWorldDimensionsCm(width: number, height: number): string {
  const wCm = width / LOGICAL_PX_PER_CM;
  const hCm = height / LOGICAL_PX_PER_CM;
  const fmt = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace('.', ','));
  return `${fmt(wCm)} × ${fmt(hCm)} cm`;
}
