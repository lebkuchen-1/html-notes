import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { CanvasMode, CanvasPage, ThemeMode } from '../types';
import { ensureImagesLoaded } from '../utils/canvasRenderer';
import { getLassoItemCount, type LassoSelection } from '../utils/lasso';
import {
  buildFilteredExportPage,
  canCopyPngToClipboard,
  canShareFilesNative,
  computePdfTileLayout,
  computeSingleImageMetrics,
  formatWorldDimensionsCm,
  generateInfiniteExportArtifact,
  getExportFileExtension,
  isAppleStandalonePwa,
  loadStoredExportPrefs,
  PDF_PAPER_PRESETS,
  renderExportPreview,
  resolveExportWorldRect,
  saveExportPrefs,
  shareExportArtifacts,
  triggerBlobDownload,
  triggerMultiBlobDownload,
  type GeneratedExportArtifact,
  type InfiniteExportBackground,
  type InfiniteExportFormat,
  type InfiniteExportOptions,
  type InfiniteExportScope,
  type InfiniteViewportSnapshot,
  type PdfPagingMode,
  type WorldRect,
} from '../utils/infiniteExport';
import {
  computeSafePagePixelDims,
  formatPageIndicesAsRange,
  generatePagesExportArtifacts,
  getPagesExportExtension,
  loadStoredPagesExportPrefs,
  parsePageRangeInput,
  renderPagesExportPreview,
  resolvePageLassoRect,
  savePagesExportPrefs,
  filterPageForExport,
  type PagesExportFormat,
  type PagesExportOptions,
  type PagesExportScope,
  type PagesMultiImageMode,
  type PagesPdfPaperMode,
} from '../utils/pagesExport';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconCrop,
  IconDownload,
  IconFileText,
  IconImage,
  IconLasso,
  IconLayers,
  IconList,
  IconMaximize,
  IconMonitor,
  IconPages,
  IconShare,
  IconX,
} from './Icons';

interface CanvasExportDialogProps {
  open: boolean;
  mode: CanvasMode;
  noteTitle: string;
  pages: CanvasPage[];
  activePage: CanvasPage;
  activePageIndex: number;
  theme: ThemeMode;
  defaultScale: 1 | 2 | 3;
  viewport: InfiniteViewportSnapshot | null;
  customRegion: WorldRect | null;
  initialInfiniteScope?: InfiniteExportScope;
  lassoSelection: LassoSelection | null;
  onClose: () => void;
  onStartRegionPick: (currentRect: WorldRect | null) => void;
  onToast: (msg: string) => void;
}

const INF_FORMAT_CARDS: { id: InfiniteExportFormat; label: string; sub: string }[] = [
  { id: 'png', label: 'PNG', sub: 'Verlustfrei' },
  { id: 'jpeg', label: 'JPEG', sub: 'Kompakt' },
  { id: 'pdf-single', label: 'PDF (1 Blatt)', sub: 'Endlos-Format' },
  { id: 'pdf-pages', label: 'PDF (Seiten)', sub: 'A4 / Kacheln' },
];

const PAGES_FORMAT_CARDS: { id: PagesExportFormat; label: string; sub: string }[] = [
  { id: 'pdf', label: 'PDF', sub: 'Dokument' },
  { id: 'png', label: 'PNG', sub: 'Verlustfrei' },
  { id: 'jpeg', label: 'JPEG', sub: 'Kompakt' },
];

const BACKGROUND_OPTIONS: {
  id: InfiniteExportBackground;
  label: string;
  pngOnly?: boolean;
}[] = [
  { id: 'canvas', label: 'Wie Canvas' },
  { id: 'solid', label: 'Ohne Raster' },
  { id: 'white', label: 'Weiß (Druck)' },
  { id: 'white-pattern', label: 'Weiß + Raster' },
  { id: 'transparent', label: 'Transparent', pngOnly: true },
];

const PADDING_PRESETS = [
  { label: 'Eng (0)', value: 0 },
  { label: '32 px', value: 32 },
  { label: '64 px', value: 64 },
  { label: '120 px', value: 120 },
];

const PDF_MARGIN_PRESETS = [
  { label: 'Randlos', value: 0 },
  { label: '10 mm', value: 10 },
  { label: '15 mm', value: 15 },
];

const PDF_TILE_SCALE_PRESETS = [
  { label: '75 %', value: 0.75 },
  { label: '100 %', value: 1 },
  { label: '125 %', value: 1.25 },
];

const JPEG_QUALITY_PRESETS = [
  { label: '80 %', value: 0.8 },
  { label: '90 %', value: 0.9 },
  { label: '95 %', value: 0.95 },
];

const SCALE_PRESETS: { value: 1 | 2 | 3; label: string; hint: string }[] = [
  { value: 1, label: '1×', hint: 'Standard' },
  { value: 2, label: '2×', hint: 'Retina' },
  { value: 3, label: '3×', hint: 'Druck' },
];

export function CanvasExportDialog(props: CanvasExportDialogProps) {
  const isInfinite = () => props.mode === 'infinite';

  const [infOpts, setInfOpts] = createSignal<InfiniteExportOptions>(
    loadStoredExportPrefs(props.defaultScale)
  );
  const [pagesOpts, setPagesOpts] = createSignal<PagesExportOptions>(
    loadStoredPagesExportPrefs(props.defaultScale, props.pages.length > 1)
  );

  // Pages-mode custom page selection (0-based indices) + synced range text input ("1, 3, 7")
  const [pickedIndices, setPickedIndices] = createSignal<number[]>([0]);
  const [pageRangeText, setPageRangeText] = createSignal<string>('1');
  const [previewCursor, setPreviewCursor] = createSignal<number>(0);

  const [filename, setFilename] = createSignal('');
  const [isExporting, setIsExporting] = createSignal(false);
  const [progressText, setProgressText] = createSignal<string | null>(null);
  const [imagesTick, setImagesTick] = createSignal(0);

  let previewCanvasRef: HTMLCanvasElement | undefined;

  const canCopyClipboard = canCopyPngToClipboard();
  const canNativeShare = canShareFilesNative();
  const preferSharePrimary = isAppleStandalonePwa() && canNativeShare;

  const hasValidLasso = createMemo(() => {
    const sel = props.lassoSelection;
    return Boolean(sel && sel.pageId === props.activePage.id && getLassoItemCount(sel) > 0);
  });

  const lassoCount = createMemo(() =>
    hasValidLasso() ? getLassoItemCount(props.lassoSelection) : 0
  );

  const fallbackViewport = createMemo<InfiniteViewportSnapshot>(() => {
    if (props.viewport) return props.viewport;
    return {
      camera: { x: 0, y: 0, zoom: 1 },
      viewportWidth: props.activePage.width,
      viewportHeight: props.activePage.height,
      worldRect: {
        x: 0,
        y: 0,
        width: props.activePage.width,
        height: props.activePage.height,
      },
    };
  });

  // Sync defaults each time dialog opens
  createEffect(() => {
    if (!props.open) return;
    const baseTitle = props.noteTitle.trim() || (isInfinite() ? 'Unendlicher Canvas' : 'Notiz');
    setFilename(baseTitle);
    setIsExporting(false);
    setProgressText(null);
    setPreviewCursor(0);

    if (isInfinite()) {
      const stored = loadStoredExportPrefs(props.defaultScale);
      let nextScope: InfiniteExportScope = props.initialInfiniteScope ?? 'viewport';
      if (nextScope === 'selection' && !hasValidLasso()) nextScope = 'viewport';
      if (nextScope === 'region' && !props.customRegion) nextScope = 'viewport';
      setInfOpts({
        ...stored,
        scope: nextScope,
        layers: {
          strokes: true,
          highlighter: true,
          texts: true,
          images: true,
          backgroundImage: true,
        },
      });
    } else {
      const multi = props.pages.length > 1;
      const stored = loadStoredPagesExportPrefs(props.defaultScale, multi);
      const initialScope: PagesExportScope = multi ? 'all' : 'current';
      const safeIdx = Math.max(0, Math.min(props.pages.length - 1, props.activePageIndex));
      setPickedIndices([safeIdx]);
      setPageRangeText(String(safeIdx + 1));
      setPagesOpts({
        ...stored,
        scope: initialScope,
        // Default to PDF when opening a multi-page note unless user previously picked a format
        format: multi && stored.format === 'png' && stored.multiImageMode === 'separate'
          ? stored.format
          : stored.format,
        layers: {
          strokes: true,
          highlighter: true,
          texts: true,
          images: true,
          backgroundImage: true,
        },
      });
    }
  });

  // Resolved 0-based page indices for Pages Mode
  const resolvedPageIndices = createMemo<number[]>(() => {
    const total = props.pages.length;
    if (total === 0) return [];
    const scope = pagesOpts().scope;
    const safeActive = Math.max(0, Math.min(total - 1, props.activePageIndex));
    if (scope === 'current' || scope === 'selection') {
      return [safeActive];
    }
    if (scope === 'all') {
      return Array.from({ length: total }, (_, i) => i);
    }
    // 'selected'
    return pickedIndices().filter((i) => i >= 0 && i < total);
  });

  // Clamp preview cursor when selected page count changes
  createEffect(() => {
    const len = resolvedPageIndices().length;
    if (len === 0) {
      setPreviewCursor(0);
    } else if (previewCursor() >= len) {
      setPreviewCursor(len - 1);
    }
  });

  const currentPreviewPageEntry = createMemo(() => {
    const indices = resolvedPageIndices();
    if (indices.length === 0) {
      return { page: props.activePage, pageNumber: props.activePageIndex + 1, pos: 0, total: 0 };
    }
    const pos = Math.max(0, Math.min(indices.length - 1, previewCursor()));
    const pageIdx = indices[pos];
    return {
      page: props.pages[pageIdx] ?? props.activePage,
      pageNumber: pageIdx + 1,
      pos,
      total: indices.length,
    };
  });

  // Preload images for the currently previewed page
  createEffect(() => {
    if (!props.open) return;
    const targetPage = isInfinite() ? props.activePage : currentPreviewPageEntry().page;
    const sources = targetPage.images.map((i) => i.src);
    if (targetPage.backgroundImage?.src) sources.push(targetPage.backgroundImage.src);
    if (sources.length === 0) return;
    let cancelled = false;
    void ensureImagesLoaded(sources).then(() => {
      if (!cancelled) setImagesTick((n) => n + 1);
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  // Escape closes dialog
  createEffect(() => {
    if (!props.open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isExporting()) {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    onCleanup(() => window.removeEventListener('keydown', handleKey));
  });

  // Option patchers
  const patchInf = (patch: Partial<InfiniteExportOptions>) => {
    setInfOpts((prev) => {
      const next: InfiniteExportOptions = { ...prev, ...patch };
      if (next.format !== 'png' && next.background === 'transparent') {
        next.background = 'canvas';
      }
      saveExportPrefs(next);
      return next;
    });
  };

  const patchPages = (patch: Partial<PagesExportOptions>) => {
    setPagesOpts((prev) => {
      const next: PagesExportOptions = { ...prev, ...patch };
      if (next.format !== 'png' && next.background === 'transparent') {
        next.background = 'canvas';
      }
      savePagesExportPrefs(next);
      return next;
    });
  };

  const activeBackground = () =>
    isInfinite() ? infOpts().background : pagesOpts().background;

  const setActiveBackground = (bg: InfiniteExportBackground) => {
    if (isInfinite()) patchInf({ background: bg });
    else patchPages({ background: bg });
  };

  const activeScale = () => (isInfinite() ? infOpts().scale : pagesOpts().scale);
  const setActiveScale = (scale: 1 | 2 | 3) => {
    if (isInfinite()) patchInf({ scale });
    else patchPages({ scale });
  };

  const activeLayers = () => (isInfinite() ? infOpts().layers : pagesOpts().layers);
  const toggleLayer = (key: keyof InfiniteExportOptions['layers']) => {
    if (isInfinite()) {
      setInfOpts((prev) => ({
        ...prev,
        layers: { ...prev.layers, [key]: !prev.layers[key] },
      }));
    } else {
      setPagesOpts((prev) => ({
        ...prev,
        layers: { ...prev.layers, [key]: !prev.layers[key] },
      }));
    }
  };

  const activeJpegQuality = () =>
    isInfinite() ? infOpts().jpegQuality : pagesOpts().jpegQuality;
  const setActiveJpegQuality = (q: number) => {
    if (isInfinite()) patchInf({ jpegQuality: q });
    else patchPages({ jpegQuality: q });
  };

  const activePadding = () => (isInfinite() ? infOpts().padding : pagesOpts().padding);
  const setActivePadding = (padding: number) => {
    if (isInfinite()) patchInf({ padding });
    else patchPages({ padding });
  };

  const isPngFormat = () =>
    isInfinite() ? infOpts().format === 'png' : pagesOpts().format === 'png';

  const isJpegFormat = () =>
    isInfinite() ? infOpts().format === 'jpeg' : pagesOpts().format === 'jpeg';

  // Infinite-mode derived metrics
  const infFiltered = createMemo(() =>
    buildFilteredExportPage(props.activePage, infOpts(), props.lassoSelection)
  );
  const infWorldRect = createMemo(() =>
    resolveExportWorldRect(
      infFiltered().page,
      infOpts(),
      fallbackViewport(),
      props.customRegion
    )
  );
  const infImageMetrics = createMemo(() =>
    computeSingleImageMetrics(infWorldRect().rect, infOpts(), fallbackViewport())
  );
  const infPdfLayout = createMemo(() =>
    infOpts().format === 'pdf-pages'
      ? computePdfTileLayout(infFiltered().page, infWorldRect().rect, infOpts())
      : null
  );

  // Pages-mode derived metrics for current preview page
  const pagesPreviewMetrics = createMemo(() => {
    const entry = currentPreviewPageEntry();
    const opts = pagesOpts();
    const isSel = opts.scope === 'selection' && hasValidLasso();
    if (isSel) {
      const { page: fPage } = filterPageForExport(entry.page, opts, props.lassoSelection);
      const rect = resolvePageLassoRect(fPage, opts.padding);
      return computeSafePagePixelDims(rect.width, rect.height, opts.scale);
    }
    return computeSafePagePixelDims(entry.page.width, entry.page.height, opts.scale);
  });

  const hasAnyInfiniteContent = createMemo(
    () =>
      props.activePage.strokes.length > 0 ||
      props.activePage.texts.length > 0 ||
      props.activePage.images.length > 0 ||
      Boolean(props.activePage.backgroundImage?.src)
  );

  const hasAnyBackgroundImage = createMemo(() => {
    if (isInfinite()) return Boolean(props.activePage.backgroundImage?.src);
    return props.pages.some((p) => Boolean(p.backgroundImage?.src));
  });

  // Live preview render effect
  createEffect(() => {
    if (!props.open) return;
    const canvas = previewCanvasRef;
    if (!canvas) return;
    void imagesTick();

    if (isInfinite()) {
      const { page: fPage, skipPaperBackground } = infFiltered();
      const { rect } = infWorldRect();
      const layout = infPdfLayout();
      const forceOpaque = infOpts().format !== 'png';
      renderExportPreview(
        canvas,
        fPage,
        forceOpaque ? false : skipPaperBackground,
        rect,
        props.theme,
        layout,
        300,
        230
      );
    } else {
      const entry = currentPreviewPageEntry();
      renderPagesExportPreview(
        canvas,
        entry.page,
        pagesOpts(),
        props.lassoSelection,
        props.theme,
        300,
        230
      );
    }
  });

  // Page selection chip helpers (Pages Mode)
  const togglePageIndex = (idx: number) => {
    setPickedIndices((prev) => {
      const next = prev.includes(idx)
        ? prev.filter((i) => i !== idx)
        : [...prev, idx].sort((a, b) => a - b);
      setPageRangeText(formatPageIndicesAsRange(next));
      return next;
    });
  };

  const applyRangeText = (raw: string) => {
    setPageRangeText(raw);
    const parsed = parsePageRangeInput(raw, props.pages.length);
    setPickedIndices(parsed);
  };

  const selectAllCustomPages = () => {
    const all = Array.from({ length: props.pages.length }, (_, i) => i);
    setPickedIndices(all);
    setPageRangeText(formatPageIndicesAsRange(all));
  };

  const selectOnlyActiveCustomPage = () => {
    const idx = Math.max(0, Math.min(props.pages.length - 1, props.activePageIndex));
    setPickedIndices([idx]);
    setPageRangeText(String(idx + 1));
  };

  const clearCustomPages = () => {
    setPickedIndices([]);
    setPageRangeText('');
  };

  const headerBadgeText = createMemo(() => {
    if (isInfinite()) {
      const opts = infOpts();
      const rect = infWorldRect().rect;
      if (opts.format === 'pdf-pages') {
        const layout = infPdfLayout();
        if (!layout) return '';
        return `${layout.paper.shortLabel} · ${layout.includedPages} ${layout.includedPages === 1 ? 'Seite' : 'Seiten'}`;
      }
      if (opts.format === 'pdf-single') {
        return `PDF · ${formatWorldDimensionsCm(rect.width, rect.height)}`;
      }
      const m = infImageMetrics();
      return `${m.pixelWidth} × ${m.pixelHeight} px`;
    }

    const indices = resolvedPageIndices();
    const opts = pagesOpts();
    if (indices.length === 0) return 'Keine Seite gewählt';
    if (opts.format === 'pdf') {
      return `PDF · ${indices.length} ${indices.length === 1 ? 'Seite' : 'Seiten'}`;
    }
    if (indices.length > 1) {
      return opts.multiImageMode === 'vertical'
        ? `${opts.format.toUpperCase()} · ${indices.length} Seiten kombiniert`
        : `${indices.length} ${opts.format.toUpperCase()}-Dateien`;
    }
    const m = pagesPreviewMetrics();
    return `${m.pixelWidth} × ${m.pixelHeight} px`;
  });

  const canRunExport = createMemo(() => {
    if (isExporting()) return false;
    if (!isInfinite() && resolvedPageIndices().length === 0) return false;
    return true;
  });

  const canCopySinglePng = createMemo(() => {
    if (!canCopyClipboard || !isPngFormat()) return false;
    if (!isInfinite()) {
      const count = resolvedPageIndices().length;
      if (count === 0) return false;
      if (count > 1 && pagesOpts().multiImageMode === 'separate') return false;
    }
    return true;
  });

  const fileExtension = createMemo(() =>
    isInfinite()
      ? getExportFileExtension(infOpts().format)
      : getPagesExportExtension(pagesOpts().format)
  );

  const primaryFormatLabel = createMemo(() => {
    if (isInfinite()) {
      const f = infOpts().format;
      if (f === 'png') return 'PNG';
      if (f === 'jpeg') return 'JPEG';
      return 'PDF';
    }
    const f = pagesOpts().format;
    if (f === 'png') return 'PNG';
    if (f === 'jpeg') return 'JPEG';
    return 'PDF';
  });

  const runExportAction = async (mode: 'download' | 'clipboard' | 'share') => {
    if (!canRunExport()) return;
    setIsExporting(true);
    setProgressText('Export wird vorbereitet…');

    try {
      let artifacts: GeneratedExportArtifact[] = [];
      let summary = '';

      if (isInfinite()) {
        const opts =
          mode === 'clipboard' ? { ...infOpts(), format: 'png' as const } : infOpts();
        const art = await generateInfiniteExportArtifact(
          props.activePage,
          props.theme,
          opts,
          fallbackViewport(),
          props.customRegion,
          props.lassoSelection,
          filename(),
          (s) => setProgressText(s)
        );
        artifacts = [art];
        summary = art.summary;
      } else {
        const opts =
          mode === 'clipboard' ? { ...pagesOpts(), format: 'png' as const } : pagesOpts();
        const res = await generatePagesExportArtifacts(
          props.pages,
          resolvedPageIndices(),
          props.theme,
          opts,
          props.lassoSelection,
          filename(),
          (s) => setProgressText(s)
        );
        artifacts = res.artifacts;
        summary = res.summary;
      }

      if (mode === 'clipboard' && artifacts[0]) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': artifacts[0].blob }),
        ]);
        props.onToast(`In Zwischenablage kopiert (${summary})`);
        props.onClose();
        return;
      }

      if (mode === 'share') {
        const shared = await shareExportArtifacts(
          artifacts,
          props.noteTitle || 'Notizblock Export'
        );
        if (shared) {
          props.onToast(`Geteilt: ${summary}`);
          props.onClose();
          return;
        }
      }

      if (artifacts.length === 1) {
        triggerBlobDownload(artifacts[0].blob, artifacts[0].filename);
        props.onToast(`Exportiert: ${artifacts[0].filename} (${summary})`);
      } else {
        await triggerMultiBlobDownload(artifacts);
        props.onToast(`Exportiert: ${summary}`);
      }
      props.onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User dismissed iPadOS Share Sheet — keep dialog open cleanly
      } else {
        const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
        props.onToast(`Export fehlgeschlagen: ${msg}`);
      }
    } finally {
      setIsExporting(false);
      setProgressText(null);
    }
  };

  const handleSelectInfiniteScope = (scope: InfiniteExportScope) => {
    if (scope === 'region' && !props.customRegion) {
      props.onStartRegionPick(null);
      return;
    }
    patchInf({ scope });
  };

  const handleSelectPagesScope = (scope: PagesExportScope) => {
    patchPages({ scope });
    if (scope === 'selected' && pickedIndices().length === 0) {
      selectOnlyActiveCustomPage();
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="import-modal-backdrop inf-export-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={isInfinite() ? 'Unendlichen Canvas exportieren' : 'Seiten exportieren'}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isExporting()) {
              props.onClose();
            }
          }}
        >
          <div class="import-modal inf-export-modal" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div class="import-modal-head">
              <div class="import-modal-head-left">
                <div class="import-modal-icon">
                  <IconDownload size={18} />
                </div>
                <div>
                  <h2>
                    {isInfinite()
                      ? 'Unendlichen Canvas exportieren'
                      : 'Seiten exportieren'}
                  </h2>
                  <span class="import-type-badge">{headerBadgeText()}</span>
                </div>
              </div>
              <button
                type="button"
                class="icon-btn"
                disabled={isExporting()}
                onClick={props.onClose}
                aria-label="Schließen"
              >
                <IconX size={16} />
              </button>
            </div>

            {/* Body: Live Preview + Granular Controls */}
            <div class="import-modal-body inf-export-body">
              <div class="inf-export-grid">
                {/* Left Column: Live Preview */}
                <div class="inf-export-preview-col">
                  <div class="inf-export-preview-stage">
                    <div
                      class="inf-export-preview-frame"
                      classList={{
                        'is-checkerboard': isPngFormat() && activeBackground() === 'transparent',
                      }}
                    >
                      <Show
                        when={isInfinite() || resolvedPageIndices().length > 0}
                        fallback={
                          <div class="inf-export-empty-preview">
                            Keine Seite ausgewählt
                          </div>
                        }
                      >
                        <canvas ref={previewCanvasRef} class="inf-export-preview-canvas" />
                      </Show>
                    </div>

                    {/* Multi-page preview pager in Pages Mode */}
                    <Show when={!isInfinite() && currentPreviewPageEntry().total > 1}>
                      <div class="inf-preview-pager">
                        <button
                          type="button"
                          class="icon-btn-xs"
                          disabled={currentPreviewPageEntry().pos <= 0}
                          onClick={() => setPreviewCursor((c) => Math.max(0, c - 1))}
                          aria-label="Vorherige Vorschauseite"
                        >
                          <IconChevronLeft size={14} />
                        </button>
                        <span class="ipp-label">
                          Vorschau: Seite {currentPreviewPageEntry().pageNumber} (
                          {currentPreviewPageEntry().pos + 1}/{currentPreviewPageEntry().total})
                        </span>
                        <button
                          type="button"
                          class="icon-btn-xs"
                          disabled={
                            currentPreviewPageEntry().pos >= currentPreviewPageEntry().total - 1
                          }
                          onClick={() =>
                            setPreviewCursor((c) =>
                              Math.min(currentPreviewPageEntry().total - 1, c + 1)
                            )
                          }
                          aria-label="Nächste Vorschauseite"
                        >
                          <IconChevronRight size={14} />
                        </button>
                      </div>
                    </Show>

                    {/* Preview Metadata Chips */}
                    <div class="inf-export-preview-meta">
                      <Show
                        when={isInfinite()}
                        fallback={
                          <Show when={resolvedPageIndices().length > 0}>
                            <span class="iem-chip">
                              Seite {currentPreviewPageEntry().pageNumber}:{' '}
                              {currentPreviewPageEntry().page.title}
                            </span>
                            <span class="iem-chip">
                              {pagesPreviewMetrics().pixelWidth} ×{' '}
                              {pagesPreviewMetrics().pixelHeight} px
                            </span>
                          </Show>
                        }
                      >
                        <span class="iem-chip">
                          {formatWorldDimensionsCm(
                            infWorldRect().rect.width,
                            infWorldRect().rect.height
                          )}
                        </span>
                        <Show
                          when={infOpts().format === 'pdf-pages' && infPdfLayout()}
                          fallback={
                            <span class="iem-chip">
                              {infImageMetrics().pixelWidth} × {infImageMetrics().pixelHeight} px
                            </span>
                          }
                        >
                          {(layout) => (
                            <span class="iem-chip">
                              {layout().cols} × {layout().rows} Raster
                              <Show when={layout().skippedEmptyPages > 0}>
                                {` · ${layout().skippedEmptyPages} leer übersprungen`}
                              </Show>
                            </span>
                          )}
                        </Show>
                      </Show>
                    </div>

                    <Show
                      when={
                        isInfinite() &&
                        infWorldRect().isEmptyFallback &&
                        infOpts().scope === 'content'
                      }
                    >
                      <div class="inf-export-notice">
                        Canvas ist leer — es wird der aktuelle Bildschirmbereich exportiert.
                      </div>
                    </Show>

                    <Show
                      when={
                        isInfinite() &&
                        infOpts().format !== 'pdf-pages' &&
                        infImageMetrics().wasClamped
                      }
                    >
                      <div class="inf-export-notice is-warn">
                        <IconAlertTriangle size={14} />
                        <span>
                          Große Fläche automatisch auf Browser-Limit skaliert. Für maximale
                          Druckschärfe nutze <strong>PDF (Seiten)</strong>.
                        </span>
                      </div>
                    </Show>

                    <Show when={isInfinite() && infOpts().scope === 'region'}>
                      <button
                        type="button"
                        class="btn-secondary inf-export-pick-btn"
                        onClick={() => props.onStartRegionPick(props.customRegion)}
                      >
                        <IconCrop size={14} />
                        <span>Bereich auf Canvas anpassen</span>
                      </button>
                    </Show>
                  </div>
                </div>

                {/* Right Column: Granular Controls */}
                <div class="inf-export-controls-col">
                  {/* ==================== 1. SCOPE (INFINITE VS PAGES) ==================== */}
                  <Show
                    when={isInfinite()}
                    fallback={
                      /* PAGES MODE SCOPE */
                      <div class="import-field">
                        <span class="import-field-label">Welche Seiten exportieren?</span>
                        <div class="inf-scope-grid">
                          <button
                            type="button"
                            class="inf-scope-card"
                            classList={{ 'is-active': pagesOpts().scope === 'current' }}
                            onClick={() => handleSelectPagesScope('current')}
                          >
                            <IconFileText size={15} />
                            <div>
                              <span class="isc-title">Aktuelle Seite</span>
                              <span class="isc-sub">
                                Seite {props.activePageIndex + 1}: {props.activePage.title}
                              </span>
                            </div>
                          </button>

                          <button
                            type="button"
                            class="inf-scope-card"
                            classList={{ 'is-active': pagesOpts().scope === 'all' }}
                            onClick={() => handleSelectPagesScope('all')}
                          >
                            <IconPages size={15} />
                            <div>
                              <span class="isc-title">Alle Seiten</span>
                              <span class="isc-sub">
                                {props.pages.length}{' '}
                                {props.pages.length === 1 ? 'Seite' : 'Seiten'} gesamt
                              </span>
                            </div>
                          </button>

                          <Show when={props.pages.length > 1}>
                            <button
                              type="button"
                              class="inf-scope-card"
                              classList={{ 'is-active': pagesOpts().scope === 'selected' }}
                              onClick={() => handleSelectPagesScope('selected')}
                            >
                              <IconList size={15} />
                              <div>
                                <span class="isc-title">Bestimmte Seiten</span>
                                <span class="isc-sub">
                                  {pickedIndices().length > 0
                                    ? `Seiten: ${formatPageIndicesAsRange(pickedIndices())}`
                                    : 'z. B. 1, 3, 7 wählen'}
                                </span>
                              </div>
                            </button>
                          </Show>

                          <Show when={hasValidLasso()}>
                            <button
                              type="button"
                              class="inf-scope-card"
                              classList={{ 'is-active': pagesOpts().scope === 'selection' }}
                              onClick={() => handleSelectPagesScope('selection')}
                            >
                              <IconLasso size={15} />
                              <div>
                                <span class="isc-title">Lasso-Auswahl</span>
                                <span class="isc-sub">
                                  Nur {lassoCount()} {lassoCount() === 1 ? 'Element' : 'Elemente'}
                                </span>
                              </div>
                            </button>
                          </Show>
                        </div>

                        {/* Granular Custom Page Picker (Chips + Range Input "1, 3, 7" / "1-3, 7") */}
                        <Show when={pagesOpts().scope === 'selected'}>
                          <div class="pages-picker-panel">
                            <div class="pages-picker-head">
                              <span class="pages-picker-count">
                                {pickedIndices().length} von {props.pages.length} Seiten gewählt
                              </span>
                              <div class="pages-picker-quick">
                                <button
                                  type="button"
                                  class="import-mini-btn"
                                  onClick={selectAllCustomPages}
                                >
                                  Alle
                                </button>
                                <button
                                  type="button"
                                  class="import-mini-btn"
                                  onClick={selectOnlyActiveCustomPage}
                                >
                                  Nur aktuelle
                                </button>
                                <button
                                  type="button"
                                  class="import-mini-btn"
                                  onClick={clearCustomPages}
                                >
                                  Keine
                                </button>
                              </div>
                            </div>

                            <input
                              type="text"
                              class="import-text-input is-compact"
                              value={pageRangeText()}
                              onInput={(e) => applyRangeText(e.currentTarget.value)}
                              placeholder="z. B. 1, 3, 5-7"
                              aria-label="Seitenbereich eingeben (z. B. 1, 3, 7)"
                            />

                            <div class="pages-chip-grid" role="group" aria-label="Einzelne Seiten auswählen">
                              <For each={props.pages}>
                                {(p, idx) => {
                                  const isPicked = () => pickedIndices().includes(idx());
                                  return (
                                    <button
                                      type="button"
                                      class="page-pick-chip"
                                      classList={{
                                        'is-active': isPicked(),
                                        'is-current': idx() === props.activePageIndex,
                                      }}
                                      onClick={() => togglePageIndex(idx())}
                                      title={`Seite ${idx() + 1}: ${p.title} (${p.width} × ${p.height} px)`}
                                      aria-pressed={isPicked()}
                                    >
                                      {idx() + 1}
                                    </button>
                                  );
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>
                      </div>
                    }
                  >
                    {/* INFINITE MODE SCOPE */}
                    <div class="import-field">
                      <div class="import-field-head">
                        <span class="import-field-label">Ausschnitt / Bereich</span>
                        <Show when={infOpts().scope !== 'region'}>
                          <button
                            type="button"
                            class="import-mini-btn"
                            onClick={() => props.onStartRegionPick(props.customRegion)}
                          >
                            <IconCrop size={12} />
                            <span>Auf Canvas markieren</span>
                          </button>
                        </Show>
                      </div>
                      <div class="inf-scope-grid">
                        <button
                          type="button"
                          class="inf-scope-card"
                          classList={{ 'is-active': infOpts().scope === 'viewport' }}
                          onClick={() => handleSelectInfiniteScope('viewport')}
                        >
                          <IconMonitor size={15} />
                          <div>
                            <span class="isc-title">Aktueller Bildschirm</span>
                            <span class="isc-sub">
                              Sichtbarer Ausschnitt ({Math.round(fallbackViewport().camera.zoom * 100)} %)
                            </span>
                          </div>
                        </button>

                        <button
                          type="button"
                          class="inf-scope-card"
                          classList={{ 'is-active': infOpts().scope === 'content' }}
                          onClick={() => handleSelectInfiniteScope('content')}
                        >
                          <IconMaximize size={15} />
                          <div>
                            <span class="isc-title">Gesamter Inhalt</span>
                            <span class="isc-sub">
                              {hasAnyInfiniteContent() ? 'Alles auf dem Board' : 'Noch kein Inhalt'}
                            </span>
                          </div>
                        </button>

                        <button
                          type="button"
                          class="inf-scope-card"
                          classList={{ 'is-active': infOpts().scope === 'region' }}
                          onClick={() => handleSelectInfiniteScope('region')}
                        >
                          <IconCrop size={15} />
                          <div>
                            <span class="isc-title">Eigener Bereich</span>
                            <span class="isc-sub">
                              {props.customRegion
                                ? `${Math.round(props.customRegion.width)} × ${Math.round(props.customRegion.height)} px`
                                : 'Rahmen aufziehen…'}
                            </span>
                          </div>
                        </button>

                        <Show when={hasValidLasso()}>
                          <button
                            type="button"
                            class="inf-scope-card"
                            classList={{ 'is-active': infOpts().scope === 'selection' }}
                            onClick={() => handleSelectInfiniteScope('selection')}
                          >
                            <IconLasso size={15} />
                            <div>
                              <span class="isc-title">Lasso-Auswahl</span>
                              <span class="isc-sub">
                                Nur {lassoCount()} {lassoCount() === 1 ? 'Element' : 'Elemente'}
                              </span>
                            </div>
                          </button>
                        </Show>
                      </div>
                    </div>
                  </Show>

                  {/* Padding for content (Infinite) or Lasso selection (both modes) */}
                  <Show
                    when={
                      (isInfinite() &&
                        (infOpts().scope === 'content' || infOpts().scope === 'selection')) ||
                      (!isInfinite() && pagesOpts().scope === 'selection')
                    }
                  >
                    <div class="import-field">
                      <span class="import-field-label">Randabstand um den Inhalt</span>
                      <div class="import-option-row">
                        <For each={PADDING_PRESETS}>
                          {(p) => (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{ 'is-active': activePadding() === p.value }}
                              onClick={() => setActivePadding(p.value)}
                            >
                              {p.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* ==================== 2. FORMAT ==================== */}
                  <div class="import-field">
                    <span class="import-field-label">Format</span>
                    <Show
                      when={isInfinite()}
                      fallback={
                        <div class="inf-format-grid is-three-col">
                          <For each={PAGES_FORMAT_CARDS}>
                            {(fmt) => (
                              <button
                                type="button"
                                class="inf-format-card"
                                classList={{ 'is-active': pagesOpts().format === fmt.id }}
                                onClick={() => patchPages({ format: fmt.id })}
                              >
                                <span class="ifc-icon">
                                  {fmt.id === 'pdf' ? (
                                    <IconPages size={14} />
                                  ) : (
                                    <IconImage size={14} />
                                  )}
                                </span>
                                <span class="ifc-label">{fmt.label}</span>
                                <span class="ifc-sub">{fmt.sub}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      }
                    >
                      <div class="inf-format-grid">
                        <For each={INF_FORMAT_CARDS}>
                          {(fmt) => (
                            <button
                              type="button"
                              class="inf-format-card"
                              classList={{ 'is-active': infOpts().format === fmt.id }}
                              onClick={() => patchInf({ format: fmt.id })}
                            >
                              <span class="ifc-icon">
                                {fmt.id === 'png' || fmt.id === 'jpeg' ? (
                                  <IconImage size={14} />
                                ) : fmt.id === 'pdf-single' ? (
                                  <IconFileText size={14} />
                                ) : (
                                  <IconPages size={14} />
                                )}
                              </span>
                              <span class="ifc-label">{fmt.label}</span>
                              <span class="ifc-sub">{fmt.sub}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* 2b-i. Pages Mode: Multi-Image Arrangement (when >1 page & PNG/JPEG) */}
                  <Show
                    when={
                      !isInfinite() &&
                      pagesOpts().format !== 'pdf' &&
                      resolvedPageIndices().length > 1
                    }
                  >
                    <div class="import-field">
                      <span class="import-field-label">Mehrere Seiten als Bild</span>
                      <div class="import-option-row">
                        {(
                          [
                            { id: 'separate', label: 'Einzelne Dateien' },
                            { id: 'vertical', label: 'Untereinander (1 langes Bild)' },
                          ] as { id: PagesMultiImageMode; label: string }[]
                        ).map((m) => (
                          <button
                            type="button"
                            class="import-choice-pill inf-compact-pill"
                            classList={{ 'is-active': pagesOpts().multiImageMode === m.id }}
                            onClick={() => patchPages({ multiImageMode: m.id })}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Show>

                  {/* 2b-ii. Pages Mode: PDF Options */}
                  <Show when={!isInfinite() && pagesOpts().format === 'pdf'}>
                    <div class="inf-pdf-panel">
                      <div class="import-field">
                        <span class="import-field-label">PDF-Seitenformat</span>
                        <div class="import-option-row">
                          <button
                            type="button"
                            class="import-choice-pill inf-compact-pill"
                            classList={{ 'is-active': pagesOpts().pdfPaperMode === 'original' }}
                            onClick={() => patchPages({ pdfPaperMode: 'original' })}
                            title="Behält pro Seite ihr exaktes eigenes Format (A4, 16:9, importiertes PDF…)"
                          >
                            Originalformat
                          </button>
                          <For each={PDF_PAPER_PRESETS}>
                            {(paper) => (
                              <button
                                type="button"
                                class="import-choice-pill inf-compact-pill"
                                classList={{
                                  'is-active': pagesOpts().pdfPaperMode === (paper.id as PagesPdfPaperMode),
                                }}
                                onClick={() => patchPages({ pdfPaperMode: paper.id })}
                              >
                                {paper.shortLabel}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>

                      <Show when={pagesOpts().pdfPaperMode !== 'original'}>
                        <div class="import-field">
                          <span class="import-field-label">Druckrand</span>
                          <div class="import-option-row">
                            <For each={PDF_MARGIN_PRESETS}>
                              {(m) => (
                                <button
                                  type="button"
                                  class="import-choice-pill inf-compact-pill"
                                  classList={{ 'is-active': pagesOpts().pdfMarginMm === m.value }}
                                  onClick={() => patchPages({ pdfMarginMm: m.value })}
                                >
                                  {m.label}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>

                      <Show when={resolvedPageIndices().length > 1}>
                        <div class="inf-toggle-row">
                          <label class="inf-check-label">
                            <input
                              type="checkbox"
                              checked={pagesOpts().pdfShowPageNumbers}
                              onChange={(e) =>
                                patchPages({ pdfShowPageNumbers: e.currentTarget.checked })
                              }
                            />
                            <span>Seitenzahlen anzeigen</span>
                          </label>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  {/* 2b-iii. Infinite Mode: PDF Multi-Page Tiling Options */}
                  <Show when={isInfinite() && infOpts().format === 'pdf-pages'}>
                    <div class="inf-pdf-panel">
                      <div class="import-field">
                        <span class="import-field-label">Papierformat</span>
                        <div class="import-option-row">
                          <For each={PDF_PAPER_PRESETS}>
                            {(paper) => (
                              <button
                                type="button"
                                class="import-choice-pill inf-compact-pill"
                                classList={{ 'is-active': infOpts().pdfPaper === paper.id }}
                                onClick={() => patchInf({ pdfPaper: paper.id })}
                              >
                                {paper.shortLabel}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class="import-field">
                        <span class="import-field-label">Seitenaufteilung</span>
                        <div class="import-option-row">
                          {(
                            [
                              { id: 'tile', label: 'Kacheln (1:1)' },
                              { id: 'fit-width', label: 'Breite auf 1 Seite' },
                              { id: 'fit-page', label: 'Alles auf 1 Seite' },
                            ] as { id: PdfPagingMode; label: string }[]
                          ).map((m) => (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{ 'is-active': infOpts().pdfPagingMode === m.id }}
                              onClick={() => patchInf({ pdfPagingMode: m.id })}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div class="inf-inline-split">
                        <Show when={infOpts().pdfPagingMode === 'tile'}>
                          <div class="import-field">
                            <span class="import-field-label">Maßstab</span>
                            <div class="import-option-row">
                              <For each={PDF_TILE_SCALE_PRESETS}>
                                {(s) => (
                                  <button
                                    type="button"
                                    class="import-choice-pill inf-compact-pill"
                                    classList={{
                                      'is-active': Math.abs(infOpts().pdfTileScale - s.value) < 0.02,
                                    }}
                                    onClick={() => patchInf({ pdfTileScale: s.value })}
                                  >
                                    {s.label}
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        <div class="import-field">
                          <span class="import-field-label">Druckrand</span>
                          <div class="import-option-row">
                            <For each={PDF_MARGIN_PRESETS}>
                              {(m) => (
                                <button
                                  type="button"
                                  class="import-choice-pill inf-compact-pill"
                                  classList={{ 'is-active': infOpts().pdfMarginMm === m.value }}
                                  onClick={() => patchInf({ pdfMarginMm: m.value })}
                                >
                                  {m.label}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>

                      <div class="inf-toggle-row">
                        <Show when={infOpts().pdfPagingMode !== 'fit-page'}>
                          <label class="inf-check-label">
                            <input
                              type="checkbox"
                              checked={infOpts().pdfSkipEmptyPages}
                              onChange={(e) =>
                                patchInf({ pdfSkipEmptyPages: e.currentTarget.checked })
                              }
                            />
                            <span>Leere Seiten überspringen</span>
                          </label>
                        </Show>
                        <label class="inf-check-label">
                          <input
                            type="checkbox"
                            checked={infOpts().pdfShowPageNumbers}
                            onChange={(e) =>
                              patchInf({ pdfShowPageNumbers: e.currentTarget.checked })
                            }
                          />
                          <span>Seitenzahlen anzeigen</span>
                        </label>
                      </div>
                    </div>
                  </Show>

                  {/* 2c. JPEG Quality */}
                  <Show when={isJpegFormat()}>
                    <div class="import-field">
                      <span class="import-field-label">JPEG-Qualität</span>
                      <div class="import-option-row">
                        <For each={JPEG_QUALITY_PRESETS}>
                          {(q) => (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{
                                'is-active': Math.abs(activeJpegQuality() - q.value) < 0.01,
                              }}
                              onClick={() => setActiveJpegQuality(q.value)}
                            >
                              {q.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* ==================== 3. BACKGROUND & PAPER ==================== */}
                  <div class="import-field">
                    <span class="import-field-label">Hintergrund &amp; Papier</span>
                    <div class="import-option-row">
                      <For each={BACKGROUND_OPTIONS}>
                        {(bg) => {
                          const disabled = () => Boolean(bg.pngOnly && !isPngFormat());
                          return (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{ 'is-active': activeBackground() === bg.id }}
                              disabled={disabled()}
                              title={
                                disabled()
                                  ? 'Transparenter Hintergrund ist nur bei PNG verfügbar'
                                  : undefined
                              }
                              onClick={() => setActiveBackground(bg.id)}
                            >
                              {bg.label}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>

                  {/* ==================== 4. RESOLUTION ==================== */}
                  <div class="import-field">
                    <span class="import-field-label">Auflösung</span>
                    <div class="import-option-row">
                      <For each={SCALE_PRESETS}>
                        {(s) => (
                          <button
                            type="button"
                            class="import-choice-pill inf-compact-pill"
                            classList={{ 'is-active': activeScale() === s.value }}
                            onClick={() => setActiveScale(s.value)}
                          >
                            <strong>{s.label}</strong>
                            <span class="inf-scale-hint">{s.hint}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* ==================== 5. CONTENT LAYERS ==================== */}
                  <div class="import-field">
                    <span class="import-field-label">
                      <IconLayers size={13} />
                      <span>Ebenen einbeziehen</span>
                    </span>
                    <div class="import-option-row">
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': activeLayers().strokes }}
                        onClick={() => toggleLayer('strokes')}
                      >
                        Stift &amp; Formen
                      </button>
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': activeLayers().highlighter }}
                        onClick={() => toggleLayer('highlighter')}
                      >
                        Textmarker
                      </button>
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': activeLayers().texts }}
                        onClick={() => toggleLayer('texts')}
                      >
                        Texte
                      </button>
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': activeLayers().images }}
                        onClick={() => toggleLayer('images')}
                      >
                        Bilder
                      </button>
                      <Show when={hasAnyBackgroundImage()}>
                        <button
                          type="button"
                          class="import-choice-pill inf-compact-pill"
                          classList={{ 'is-active': activeLayers().backgroundImage }}
                          onClick={() => toggleLayer('backgroundImage')}
                        >
                          Hintergrund-PDF
                        </button>
                      </Show>
                    </div>
                  </div>

                  {/* ==================== 6. FILENAME ==================== */}
                  <div class="import-field">
                    <span class="import-field-label">Dateiname</span>
                    <div class="inf-filename-wrap">
                      <input
                        type="text"
                        class="import-text-input is-compact"
                        value={filename()}
                        onInput={(e) => setFilename(e.currentTarget.value)}
                        placeholder="notiz-export"
                      />
                      <span class="inf-filename-ext">.{fileExtension()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div class="import-modal-foot">
              <Show
                when={progressText()}
                fallback={
                  <span class="import-foot-hint">
                    {activeBackground() === 'white' || activeBackground() === 'white-pattern'
                      ? 'Auto-Tinte wird automatisch dunkel für sauberen Druck gerendert.'
                      : preferSharePrimary
                        ? 'iPad-Modus: „Teilen / Sichern“ öffnet direkt „In Dateien sichern“, Fotos & AirDrop.'
                        : isInfinite()
                          ? 'Tipp: Mit „Eigener Bereich“ lässt sich jeder Ausschnitt exakt einrahmen.'
                          : 'Tipp: Unter „Bestimmte Seiten“ einfach z. B. 1, 3, 7 wählen oder tippen.'}
                  </span>
                }
              >
                {(status) => (
                  <span class="import-foot-progress">
                    <span class="import-spinner" />
                    <span>{status()}</span>
                  </span>
                )}
              </Show>

              <div class="import-foot-buttons">
                <button
                  type="button"
                  class="btn-secondary"
                  disabled={isExporting()}
                  onClick={props.onClose}
                >
                  Abbrechen
                </button>

                <Show when={canCopySinglePng()}>
                  <button
                    type="button"
                    class="btn-secondary"
                    disabled={!canRunExport()}
                    onClick={() => void runExportAction('clipboard')}
                    title="PNG direkt in die Zwischenablage kopieren"
                  >
                    <IconCopy size={14} />
                    <span>Kopieren</span>
                  </button>
                </Show>

                <Show
                  when={preferSharePrimary}
                  fallback={
                    <>
                      <Show when={canNativeShare}>
                        <button
                          type="button"
                          class="btn-secondary"
                          disabled={!canRunExport()}
                          onClick={() => void runExportAction('share')}
                          title="Über System-Teilen-Menü senden (Dateien, Fotos, AirDrop…)"
                        >
                          <IconShare size={14} />
                          <span>Teilen</span>
                        </button>
                      </Show>

                      <button
                        type="button"
                        class="btn-primary"
                        disabled={!canRunExport()}
                        onClick={() => void runExportAction('download')}
                      >
                        <IconDownload size={14} />
                        <span>Als {primaryFormatLabel()} speichern</span>
                      </button>
                    </>
                  }
                >
                  <button
                    type="button"
                    class="btn-secondary"
                    disabled={!canRunExport()}
                    onClick={() => void runExportAction('download')}
                    title="Direkt als Download speichern"
                  >
                    <IconDownload size={14} />
                    <span>Download</span>
                  </button>

                  <button
                    type="button"
                    class="btn-primary"
                    disabled={!canRunExport()}
                    onClick={() => void runExportAction('share')}
                    title="Über iPadOS-Teilen-Menü sichern (In Dateien sichern, Fotos, AirDrop…)"
                  >
                    <IconShare size={14} />
                    <span>{primaryFormatLabel()} teilen / sichern</span>
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
