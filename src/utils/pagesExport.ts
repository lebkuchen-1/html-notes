import type { CanvasPage, ThemeMode } from '../types';
import {
  computePageContentBounds,
  ensureImagesLoaded,
  renderFullCanvas,
  renderInfiniteCanvas,
  resolvePaperBackgroundColor,
} from './canvasRenderer';
import type { LassoSelection } from './lasso';
import {
  buildFilteredExportPage,
  LOGICAL_PX_PER_MM,
  MAX_CANVAS_AREA_PX,
  MAX_CANVAS_EDGE_PX,
  PDF_PAPER_MAP,
  PT_PER_MM,
  resolveExportPaperConfig,
  type GeneratedExportArtifact,
  type InfiniteExportBackground,
  type InfiniteExportLayers,
  type InfiniteExportOptions,
  type PdfPaperPresetId,
  type WorldRect,
} from './infiniteExport';
import { buildPdfFromJpegPages, canvasToBlob, canvasToJpegBytes, type PdfImagePage } from './pdfWriter';

export type PagesExportScope = 'current' | 'all' | 'selected' | 'selection';
export type PagesExportFormat = 'pdf' | 'png' | 'jpeg';
export type PagesMultiImageMode = 'separate' | 'vertical';
export type PagesPdfPaperMode = 'original' | PdfPaperPresetId;

export interface PagesExportOptions {
  scope: PagesExportScope;
  format: PagesExportFormat;
  background: InfiniteExportBackground;
  scale: 1 | 2 | 3;
  jpegQuality: number;
  padding: number;
  layers: InfiniteExportLayers;
  pdfPaperMode: PagesPdfPaperMode;
  pdfMarginMm: number;
  pdfShowPageNumbers: boolean;
  multiImageMode: PagesMultiImageMode;
}

const PAGES_EXPORT_PREFS_KEY = 'solid-notes:pages-export-prefs';

export function createDefaultPagesExportOptions(
  defaultScale: 1 | 2 | 3 = 2,
  multiPage = false
): PagesExportOptions {
  return {
    scope: multiPage ? 'all' : 'current',
    format: multiPage ? 'pdf' : 'png',
    background: 'canvas',
    scale: defaultScale,
    jpegQuality: 0.92,
    padding: 48,
    layers: {
      strokes: true,
      highlighter: true,
      texts: true,
      images: true,
      backgroundImage: true,
    },
    pdfPaperMode: 'original',
    pdfMarginMm: 0,
    pdfShowPageNumbers: false,
    multiImageMode: 'separate',
  };
}

export function loadStoredPagesExportPrefs(
  defaultScale: 1 | 2 | 3 = 2,
  multiPage = false
): PagesExportOptions {
  const base = createDefaultPagesExportOptions(defaultScale, multiPage);
  try {
    const raw = localStorage.getItem(PAGES_EXPORT_PREFS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PagesExportOptions>;
    if (!parsed || typeof parsed !== 'object') return base;

    const format: PagesExportFormat =
      parsed.format === 'pdf' || parsed.format === 'png' || parsed.format === 'jpeg'
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

    const pdfPaperMode: PagesPdfPaperMode =
      parsed.pdfPaperMode === 'original' ||
      (parsed.pdfPaperMode && PDF_PAPER_MAP.has(parsed.pdfPaperMode))
        ? parsed.pdfPaperMode
        : base.pdfPaperMode;

    const multiImageMode: PagesMultiImageMode =
      parsed.multiImageMode === 'separate' || parsed.multiImageMode === 'vertical'
        ? parsed.multiImageMode
        : base.multiImageMode;

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
      pdfPaperMode,
      pdfMarginMm:
        typeof parsed.pdfMarginMm === 'number' && parsed.pdfMarginMm >= 0 && parsed.pdfMarginMm <= 30
          ? parsed.pdfMarginMm
          : base.pdfMarginMm,
      pdfShowPageNumbers:
        typeof parsed.pdfShowPageNumbers === 'boolean'
          ? parsed.pdfShowPageNumbers
          : base.pdfShowPageNumbers,
      multiImageMode,
    };
  } catch {
    return base;
  }
}

export function savePagesExportPrefs(options: PagesExportOptions) {
  try {
    localStorage.setItem(
      PAGES_EXPORT_PREFS_KEY,
      JSON.stringify({
        format: options.format,
        background: options.background,
        scale: options.scale,
        jpegQuality: options.jpegQuality,
        padding: options.padding,
        pdfPaperMode: options.pdfPaperMode,
        pdfMarginMm: options.pdfMarginMm,
        pdfShowPageNumbers: options.pdfShowPageNumbers,
        multiImageMode: options.multiImageMode,
      })
    );
  } catch {
    // ignore storage errors
  }
}

/**
 * Parses human-friendly German/English page range expressions like:
 *   "1, 3, 7"  |  "1, 3 und 7"  |  "1-3, 5, 7-9"  |  "2; 4"
 * Returns sorted, deduplicated 0-based page indices within [0, totalPages - 1].
 */
export function parsePageRangeInput(input: string, totalPages: number): number[] {
  if (totalPages <= 0) return [];
  const normalized = input
    .replace(/\bund\b|\band\b/gi, ',')
    .replace(/[–—]/g, '-')
    .replace(/;/g, ',');

  const picked = new Set<number>();
  const parts = normalized.split(',');

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const a = Number.parseInt(rangeMatch[1], 10);
      const b = Number.parseInt(rangeMatch[2], 10);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.max(1, Math.min(a, b));
        const end = Math.min(totalPages, Math.max(a, b));
        for (let p = start; p <= end; p++) {
          picked.add(p - 1);
        }
      }
      continue;
    }

    const singleMatch = part.match(/^(\d+)$/);
    if (singleMatch) {
      const n = Number.parseInt(singleMatch[1], 10);
      if (Number.isFinite(n) && n >= 1 && n <= totalPages) {
        picked.add(n - 1);
      }
    }
  }

  return Array.from(picked).sort((a, b) => a - b);
}

/**
 * Formats 0-based page indices into a compact 1-based range string,
 * e.g. [0, 2, 3, 4, 6] -> "1, 3-5, 7".
 */
export function formatPageIndicesAsRange(indices: number[]): string {
  if (indices.length === 0) return '';
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const curr = sorted[i];
    if (curr === prev + 1) {
      prev = curr;
    } else {
      if (start === prev) {
        parts.push(String(start + 1));
      } else if (prev === start + 1) {
        parts.push(`${start + 1}, ${prev + 1}`);
      } else {
        parts.push(`${start + 1}-${prev + 1}`);
      }
      start = curr;
      prev = curr;
    }
  }

  return parts.join(', ');
}

export function getPagesExportExtension(format: PagesExportFormat): string {
  if (format === 'png') return 'png';
  if (format === 'jpeg') return 'jpg';
  return 'pdf';
}

export function sanitizePagesExportBaseName(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/\.(png|jpe?g|pdf)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || 'notiz-export';
}

let measureCtxCache: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtxCache && typeof document !== 'undefined') {
    measureCtxCache = document.createElement('canvas').getContext('2d');
  }
  return measureCtxCache;
}

export function filterPageForExport(
  page: CanvasPage,
  options: PagesExportOptions,
  lassoSelection: LassoSelection | null
): { page: CanvasPage; skipPaperBackground: boolean } {
  const fakeInfOpts = {
    scope: options.scope === 'selection' ? 'selection' : 'content',
    background: options.background,
    layers: options.layers,
  } as InfiniteExportOptions;

  return buildFilteredExportPage(
    page,
    fakeInfOpts,
    options.scope === 'selection' ? lassoSelection : null
  );
}

export function resolvePageLassoRect(
  filteredPage: CanvasPage,
  padding: number
): WorldRect {
  const bounds = computePageContentBounds(filteredPage, getMeasureCtx());
  if (!bounds) {
    return { x: 0, y: 0, width: filteredPage.width, height: filteredPage.height };
  }
  const pad = Math.max(0, padding);
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width: Math.max(48, bounds.maxX - bounds.minX + pad * 2),
    height: Math.max(48, bounds.maxY - bounds.minY + pad * 2),
  };
}

export function computeSafePagePixelDims(
  logicalW: number,
  logicalH: number,
  desiredScale: number
): { pixelWidth: number; pixelHeight: number; effectiveScale: number; wasClamped: boolean } {
  const edgeCap = MAX_CANVAS_EDGE_PX / Math.max(1, logicalW, logicalH);
  const areaCap = Math.sqrt(MAX_CANVAS_AREA_PX / Math.max(1, logicalW * logicalH));
  const effectiveScale = Math.max(0.1, Math.min(desiredScale, edgeCap, areaCap));
  return {
    pixelWidth: Math.max(1, Math.round(logicalW * effectiveScale)),
    pixelHeight: Math.max(1, Math.round(logicalH * effectiveScale)),
    effectiveScale,
    wasClamped: effectiveScale < desiredScale * 0.98,
  };
}

export function renderPagesExportPreview(
  canvas: HTMLCanvasElement,
  page: CanvasPage,
  options: PagesExportOptions,
  lassoSelection: LassoSelection | null,
  theme: ThemeMode,
  maxCssW: number,
  maxCssH: number
) {
  const { page: filtered, skipPaperBackground } = filterPageForExport(
    page,
    options,
    lassoSelection
  );
  const forceOpaque = options.format !== 'png';
  const effectiveSkip = forceOpaque ? false : skipPaperBackground;

  const isSelectionScope =
    options.scope === 'selection' &&
    lassoSelection &&
    lassoSelection.pageId === page.id;

  const targetRect: WorldRect = isSelectionScope
    ? resolvePageLassoRect(filtered, options.padding)
    : { x: 0, y: 0, width: filtered.width, height: filtered.height };

  const aspect = targetRect.width / Math.max(1, targetRect.height);
  let cssW = maxCssW;
  let cssH = cssW / aspect;
  if (cssH > maxCssH) {
    cssH = maxCssH;
    cssW = cssH * aspect;
  }
  cssW = Math.max(72, Math.round(cssW));
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

  if (isSelectionScope) {
    const zoom = cssW / Math.max(1, targetRect.width);
    renderInfiniteCanvas(
      ctx,
      filtered,
      cssW,
      cssH,
      { x: targetRect.x, y: targetRect.y, zoom },
      theme,
      dpr,
      { skipPaperBackground: effectiveSkip }
    );
  } else {
    const scale = targetW / Math.max(1, filtered.width);
    renderFullCanvas(ctx, filtered, null, theme, scale, {
      skipPaperBackground: effectiveSkip,
    });
  }
}

export interface PagesExportBatchResult {
  artifacts: GeneratedExportArtifact[];
  summary: string;
}

export async function generatePagesExportArtifacts(
  allPages: CanvasPage[],
  selectedIndices: number[],
  theme: ThemeMode,
  options: PagesExportOptions,
  lassoSelection: LassoSelection | null,
  rawFilename: string,
  onProgress?: (status: string) => void
): Promise<PagesExportBatchResult> {
  const validIndices = selectedIndices.filter((i) => i >= 0 && i < allPages.length);
  if (validIndices.length === 0) {
    throw new Error('Bitte mindestens eine Seite für den Export auswählen.');
  }

  const chosenPages = validIndices.map((idx) => ({
    index: idx,
    pageNumber: idx + 1,
    page: allPages[idx],
  }));

  // Preload all images across selected pages
  const imgSources: string[] = [];
  for (const item of chosenPages) {
    if (options.layers.images) {
      for (const img of item.page.images) imgSources.push(img.src);
    }
    if (options.layers.backgroundImage && item.page.backgroundImage?.src) {
      imgSources.push(item.page.backgroundImage.src);
    }
  }
  if (imgSources.length > 0) {
    onProgress?.('Bilder werden vorbereitet…');
    await ensureImagesLoaded(imgSources);
  }

  const baseName = sanitizePagesExportBaseName(rawFilename);
  const ext = getPagesExportExtension(options.format);
  const isSelectionOnly =
    options.scope === 'selection' &&
    lassoSelection !== null &&
    chosenPages.length === 1 &&
    chosenPages[0].page.id === lassoSelection.pageId;

  // ==================== 1. PDF EXPORT (1 OR MANY SELECTED PAGES IN ONE PDF) ====================
  if (options.format === 'pdf') {
    const pdfPages: PdfImagePage[] = [];
    const fixedPaper =
      options.pdfPaperMode !== 'original'
        ? PDF_PAPER_MAP.get(options.pdfPaperMode) ?? null
        : null;

    for (let i = 0; i < chosenPages.length; i++) {
      const entry = chosenPages[i];
      onProgress?.(
        chosenPages.length > 1
          ? `PDF-Seite ${i + 1} von ${chosenPages.length} (Seite ${entry.pageNumber}) wird gerendert…`
          : 'PDF wird erstellt…'
      );

      const { page: filtered } = filterPageForExport(
        entry.page,
        options,
        isSelectionOnly ? lassoSelection : null
      );

      const srcRect: WorldRect = isSelectionOnly
        ? resolvePageLassoRect(filtered, options.padding)
        : { x: 0, y: 0, width: filtered.width, height: filtered.height };

      let pageWidthPt: number;
      let pageHeightPt: number;
      const offscreen = document.createElement('canvas');

      if (!fixedPaper) {
        // Keep each page's exact natural dimensions (great for mixed A4 / 16:9 / imported PDFs!)
        const dims = computeSafePagePixelDims(srcRect.width, srcRect.height, options.scale);
        offscreen.width = dims.pixelWidth;
        offscreen.height = dims.pixelHeight;
        const ctx = offscreen.getContext('2d');
        if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

        if (isSelectionOnly) {
          renderInfiniteCanvas(
            ctx,
            filtered,
            srcRect.width,
            srcRect.height,
            { x: srcRect.x, y: srcRect.y, zoom: 1 },
            theme,
            dims.effectiveScale,
            { skipPaperBackground: false }
          );
        } else {
          renderFullCanvas(ctx, filtered, null, theme, dims.effectiveScale, {
            skipPaperBackground: false,
          });
        }

        if (options.pdfShowPageNumbers && chosenPages.length > 1) {
          drawPdfFooterNumber(
            ctx,
            dims.pixelWidth,
            dims.pixelHeight,
            i + 1,
            chosenPages.length,
            filtered.paperConfig,
            theme
          );
        }

        pageWidthPt = Math.max(72, Math.min(14400, (srcRect.width / LOGICAL_PX_PER_MM) * PT_PER_MM));
        pageHeightPt = Math.max(72, Math.min(14400, (srcRect.height / LOGICAL_PX_PER_MM) * PT_PER_MM));
      } else {
        // Fit proportionally centered onto chosen physical print sheet (A4 / A3 / Letter)
        const dpiMul = options.scale === 1 ? 1.5 : options.scale === 2 ? 2.15 : 2.8;
        const rawW = Math.round(fixedPaper.widthMm * LOGICAL_PX_PER_MM * dpiMul);
        const rawH = Math.round(fixedPaper.heightMm * LOGICAL_PX_PER_MM * dpiMul);
        const safeDims = computeSafePagePixelDims(rawW, rawH, 1);
        offscreen.width = safeDims.pixelWidth;
        offscreen.height = safeDims.pixelHeight;
        const ctx = offscreen.getContext('2d');
        if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

        const pxPerMm = safeDims.pixelWidth / fixedPaper.widthMm;
        const marginMm = Math.max(0, Math.min(30, options.pdfMarginMm));
        const innerW = Math.max(40, (fixedPaper.widthMm - marginMm * 2) * pxPerMm);
        const innerH = Math.max(40, (fixedPaper.heightMm - marginMm * 2) * pxPerMm);

        const fitScale = Math.min(innerW / Math.max(1, srcRect.width), innerH / Math.max(1, srcRect.height));
        const drawW = srcRect.width * fitScale;
        const drawH = srcRect.height * fitScale;
        const drawX = (safeDims.pixelWidth - drawW) / 2;
        const drawY = (safeDims.pixelHeight - drawH) / 2;

        const sheetBg =
          options.background === 'white' || options.background === 'white-pattern'
            ? '#ffffff'
            : resolvePaperBackgroundColor(filtered.paperConfig, theme);
        ctx.fillStyle = sheetBg;
        ctx.fillRect(0, 0, safeDims.pixelWidth, safeDims.pixelHeight);

        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.beginPath();
        ctx.rect(0, 0, drawW, drawH);
        ctx.clip();
        if (isSelectionOnly) {
          renderInfiniteCanvas(
            ctx,
            filtered,
            srcRect.width,
            srcRect.height,
            { x: srcRect.x, y: srcRect.y, zoom: 1 },
            theme,
            fitScale,
            { skipPaperBackground: false }
          );
        } else {
          renderFullCanvas(ctx, filtered, null, theme, fitScale, {
            skipPaperBackground: false,
          });
        }
        ctx.restore();

        if (options.pdfShowPageNumbers && chosenPages.length > 1) {
          drawPdfFooterNumber(
            ctx,
            safeDims.pixelWidth,
            safeDims.pixelHeight,
            i + 1,
            chosenPages.length,
            filtered.paperConfig,
            theme
          );
        }

        pageWidthPt = fixedPaper.widthMm * PT_PER_MM;
        pageHeightPt = fixedPaper.heightMm * PT_PER_MM;
      }

      const jpegBytes = await canvasToJpegBytes(offscreen, 0.92);
      pdfPages.push({
        widthPt: pageWidthPt,
        heightPt: pageHeightPt,
        jpegBytes,
        pixelWidth: offscreen.width,
        pixelHeight: offscreen.height,
      });

      if (chosenPages.length > 2) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const blob = buildPdfFromJpegPages(pdfPages);
    const filename = `${baseName}.pdf`;
    const summary =
      chosenPages.length === 1
        ? `PDF (Seite ${chosenPages[0].pageNumber})`
        : `PDF (${chosenPages.length} Seiten)`;

    return {
      artifacts: [{ blob, filename, mimeType: 'application/pdf', summary }],
      summary,
    };
  }

  // ==================== 2. PNG / JPEG — STITCHED VERTICAL SINGLE IMAGE ====================
  const mimeType = options.format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = options.format === 'jpeg' ? options.jpegQuality : undefined;
  const forceOpaque = options.format === 'jpeg';

  if (chosenPages.length > 1 && options.multiImageMode === 'vertical') {
    onProgress?.(`${chosenPages.length} Seiten werden als langes Bild zusammengefügt…`);
    const gap = 24;
    const maxLogicalW = chosenPages.reduce((m, e) => Math.max(m, e.page.width), 1);
    const totalLogicalH =
      chosenPages.reduce((sum, e) => sum + e.page.height, 0) + gap * (chosenPages.length - 1);

    const dims = computeSafePagePixelDims(maxLogicalW, totalLogicalH, options.scale);
    const offscreen = document.createElement('canvas');
    offscreen.width = dims.pixelWidth;
    offscreen.height = dims.pixelHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

    const { skipPaperBackground } = resolveExportPaperConfig(
      chosenPages[0].page.paperConfig,
      options.background
    );
    const effectiveSkip = forceOpaque ? false : skipPaperBackground;

    if (!effectiveSkip) {
      // Neutral backdrop between stitched pages
      ctx.fillStyle = options.background === 'white' || options.background === 'white-pattern'
        ? '#f1f5f9'
        : theme === 'dark'
          ? '#0f172a'
          : '#e2e8f0';
      ctx.fillRect(0, 0, dims.pixelWidth, dims.pixelHeight);
    }

    let cursorY = 0;
    for (const entry of chosenPages) {
      const { page: filtered } = filterPageForExport(entry.page, options, null);
      const offsetX = ((maxLogicalW - filtered.width) / 2) * dims.effectiveScale;
      const offsetY = cursorY * dims.effectiveScale;
      ctx.save();
      ctx.translate(offsetX, offsetY);
      renderFullCanvas(ctx, filtered, null, theme, dims.effectiveScale, {
        skipPaperBackground: effectiveSkip,
      });
      ctx.restore();
      cursorY += filtered.height + gap;
    }

    const blob = await canvasToBlob(offscreen, mimeType, quality);
    const filename = `${baseName}.${ext}`;
    const summary = `${dims.pixelWidth} × ${dims.pixelHeight} px (${chosenPages.length} Seiten)`;
    return {
      artifacts: [{ blob, filename, mimeType, summary }],
      summary,
    };
  }

  // ==================== 3. PNG / JPEG — SINGLE PAGE OR SEPARATE IMAGE PER PAGE ====================
  const artifacts: GeneratedExportArtifact[] = [];
  for (let i = 0; i < chosenPages.length; i++) {
    const entry = chosenPages[i];
    onProgress?.(
      chosenPages.length > 1
        ? `Bild ${i + 1} von ${chosenPages.length} (Seite ${entry.pageNumber}) wird gerendert…`
        : `${options.format.toUpperCase()} wird gerendert…`
    );

    const { page: filtered, skipPaperBackground } = filterPageForExport(
      entry.page,
      options,
      isSelectionOnly ? lassoSelection : null
    );
    const effectiveSkip = forceOpaque ? false : skipPaperBackground;

    const srcRect: WorldRect = isSelectionOnly
      ? resolvePageLassoRect(filtered, options.padding)
      : { x: 0, y: 0, width: filtered.width, height: filtered.height };

    const dims = computeSafePagePixelDims(srcRect.width, srcRect.height, options.scale);
    const offscreen = document.createElement('canvas');
    offscreen.width = dims.pixelWidth;
    offscreen.height = dims.pixelHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) throw new Error('Canvas-Kontext konnte nicht erstellt werden.');

    if (isSelectionOnly) {
      renderInfiniteCanvas(
        ctx,
        filtered,
        srcRect.width,
        srcRect.height,
        { x: srcRect.x, y: srcRect.y, zoom: 1 },
        theme,
        dims.effectiveScale,
        { skipPaperBackground: effectiveSkip }
      );
    } else {
      renderFullCanvas(ctx, filtered, null, theme, dims.effectiveScale, {
        skipPaperBackground: effectiveSkip,
      });
    }

    const blob = await canvasToBlob(offscreen, mimeType, quality);
    const suffix = chosenPages.length > 1 ? `-seite-${entry.pageNumber}` : '';
    const filename = `${baseName}${suffix}.${ext}`;
    const summary = `${dims.pixelWidth} × ${dims.pixelHeight} px (${options.format.toUpperCase()})`;
    artifacts.push({ blob, filename, mimeType, summary });
  }

  const summary =
    artifacts.length === 1
      ? artifacts[0].summary
      : `${artifacts.length} ${options.format.toUpperCase()}-Dateien`;

  return { artifacts, summary };
}

function drawPdfFooterNumber(
  ctx: CanvasRenderingContext2D,
  pxW: number,
  pxH: number,
  pageNum: number,
  total: number,
  paperConfig: CanvasPage['paperConfig'],
  theme: ThemeMode
) {
  const bg = resolvePaperBackgroundColor(paperConfig, theme).toLowerCase();
  const isDark = bg !== '#ffffff' && bg !== '#fcf9f2' && theme === 'dark';
  ctx.save();
  const fontSize = Math.max(12, Math.round(Math.min(pxW, pxH) * 0.014));
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = isDark ? 'rgba(226, 232, 240, 0.72)' : 'rgba(71, 85, 105, 0.78)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Seite ${pageNum} / ${total}`, pxW / 2, pxH - Math.max(10, Math.round(fontSize * 0.75)));
  ctx.restore();
}
