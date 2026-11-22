import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { CanvasPage, ThemeMode } from '../types';
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
  loadStoredExportPrefs,
  PDF_PAPER_PRESETS,
  renderExportPreview,
  resolveExportWorldRect,
  saveExportPrefs,
  type InfiniteExportBackground,
  type InfiniteExportFormat,
  type InfiniteExportOptions,
  type InfiniteExportScope,
  type InfiniteViewportSnapshot,
  type PdfPagingMode,
  type WorldRect,
  triggerBlobDownload,
} from '../utils/infiniteExport';
import {
  IconAlertTriangle,
  IconCopy,
  IconCrop,
  IconDownload,
  IconFileText,
  IconImage,
  IconLasso,
  IconLayers,
  IconMaximize,
  IconMonitor,
  IconPages,
  IconShare,
  IconX,
} from './Icons';

interface InfiniteExportDialogProps {
  open: boolean;
  noteTitle: string;
  page: CanvasPage;
  theme: ThemeMode;
  defaultScale: 1 | 2 | 3;
  viewport: InfiniteViewportSnapshot;
  customRegion: WorldRect | null;
  initialScope?: InfiniteExportScope;
  lassoSelection: LassoSelection | null;
  onClose: () => void;
  onStartRegionPick: (currentRect: WorldRect | null) => void;
  onToast: (msg: string) => void;
}

const FORMAT_CARDS: { id: InfiniteExportFormat; label: string; sub: string }[] = [
  { id: 'png', label: 'PNG', sub: 'Verlustfrei' },
  { id: 'jpeg', label: 'JPEG', sub: 'Kompakt' },
  { id: 'pdf-single', label: 'PDF (1 Blatt)', sub: 'Endlos-Format' },
  { id: 'pdf-pages', label: 'PDF (Seiten)', sub: 'A4 / Kacheln' },
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

export function InfiniteExportDialog(props: InfiniteExportDialogProps) {
  const [options, setOptions] = createSignal<InfiniteExportOptions>(
    loadStoredExportPrefs(props.defaultScale)
  );
  const [filename, setFilename] = createSignal('');
  const [isExporting, setIsExporting] = createSignal(false);
  const [progressText, setProgressText] = createSignal<string | null>(null);
  const [imagesTick, setImagesTick] = createSignal(0);

  let previewCanvasRef: HTMLCanvasElement | undefined;

  const canCopyClipboard = canCopyPngToClipboard();
  const canNativeShare = canShareFilesNative();

  const hasValidLasso = createMemo(() => {
    const sel = props.lassoSelection;
    return Boolean(sel && sel.pageId === props.page.id && getLassoItemCount(sel) > 0);
  });

  const lassoCount = createMemo(() =>
    hasValidLasso() ? getLassoItemCount(props.lassoSelection) : 0
  );

  // Sync defaults each time dialog opens
  createEffect(() => {
    if (!props.open) return;
    const stored = loadStoredExportPrefs(props.defaultScale);
    let nextScope: InfiniteExportScope = props.initialScope ?? 'viewport';
    if (nextScope === 'selection' && !hasValidLasso()) {
      nextScope = 'viewport';
    }
    if (nextScope === 'region' && !props.customRegion) {
      nextScope = 'viewport';
    }
    setOptions({
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
    const baseTitle = props.noteTitle.trim() || 'Unendlicher Canvas';
    setFilename(baseTitle);
    setIsExporting(false);
    setProgressText(null);
  });

  // Preload page images so preview renders images crisply
  createEffect(() => {
    if (!props.open) return;
    const sources = props.page.images.map((i) => i.src);
    if (props.page.backgroundImage?.src) sources.push(props.page.backgroundImage.src);
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

  const patchOptions = (patch: Partial<InfiniteExportOptions>) => {
    setOptions((prev) => {
      const next: InfiniteExportOptions = { ...prev, ...patch };
      if (next.format !== 'png' && next.background === 'transparent') {
        next.background = 'canvas';
      }
      saveExportPrefs(next);
      return next;
    });
  };

  const toggleLayer = (key: keyof InfiniteExportOptions['layers']) => {
    setOptions((prev) => ({
      ...prev,
      layers: { ...prev.layers, [key]: !prev.layers[key] },
    }));
  };

  const filteredResult = createMemo(() =>
    buildFilteredExportPage(props.page, options(), props.lassoSelection)
  );

  const worldRectResult = createMemo(() =>
    resolveExportWorldRect(
      filteredResult().page,
      options(),
      props.viewport,
      props.customRegion
    )
  );

  const imageMetrics = createMemo(() =>
    computeSingleImageMetrics(worldRectResult().rect, options(), props.viewport)
  );

  const pdfLayout = createMemo(() =>
    options().format === 'pdf-pages'
      ? computePdfTileLayout(filteredResult().page, worldRectResult().rect, options())
      : null
  );

  const hasAnyPageContent = createMemo(
    () =>
      props.page.strokes.length > 0 ||
      props.page.texts.length > 0 ||
      props.page.images.length > 0 ||
      Boolean(props.page.backgroundImage?.src)
  );

  const hasBackgroundImage = createMemo(() => Boolean(props.page.backgroundImage?.src));

  // Re-render live preview canvas whenever options, rect, or decoded images update
  createEffect(() => {
    if (!props.open) return;
    const canvas = previewCanvasRef;
    if (!canvas) return;
    void imagesTick();
    const { page: fPage, skipPaperBackground } = filteredResult();
    const { rect } = worldRectResult();
    const layout = pdfLayout();
    const forceOpaque = options().format !== 'png';
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
  });

  const scopeSummaryBadge = createMemo(() => {
    const opts = options();
    const rect = worldRectResult().rect;
    if (opts.format === 'pdf-pages') {
      const layout = pdfLayout();
      if (!layout) return '';
      return `${layout.paper.shortLabel} · ${layout.includedPages} ${layout.includedPages === 1 ? 'Seite' : 'Seiten'}`;
    }
    if (opts.format === 'pdf-single') {
      return `PDF · ${formatWorldDimensionsCm(rect.width, rect.height)}`;
    }
    const m = imageMetrics();
    return `${m.pixelWidth} × ${m.pixelHeight} px`;
  });

  const runExportAction = async (mode: 'download' | 'clipboard' | 'share') => {
    if (isExporting()) return;
    setIsExporting(true);
    setProgressText('Export wird vorbereitet…');
    try {
      const opts =
        mode === 'clipboard'
          ? { ...options(), format: 'png' as const }
          : options();

      const artifact = await generateInfiniteExportArtifact(
        props.page,
        props.theme,
        opts,
        props.viewport,
        props.customRegion,
        props.lassoSelection,
        filename(),
        (status) => setProgressText(status)
      );

      if (mode === 'clipboard') {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': artifact.blob }),
        ]);
        props.onToast(`In Zwischenablage kopiert (${artifact.summary})`);
        props.onClose();
        return;
      }

      if (mode === 'share') {
        const file = new File([artifact.blob], artifact.filename, {
          type: artifact.mimeType,
        });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: props.noteTitle || 'Notizblock Export',
          });
          props.onToast(`Geteilt: ${artifact.summary}`);
          props.onClose();
          return;
        }
      }

      triggerBlobDownload(artifact.blob, artifact.filename);
      props.onToast(`Exportiert: ${artifact.filename} (${artifact.summary})`);
      props.onClose();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled native share sheet — stay cleanly in dialog
      } else {
        const msg = err instanceof Error ? err.message : 'Unbekannter Fehler';
        props.onToast(`Export fehlgeschlagen: ${msg}`);
      }
    } finally {
      setIsExporting(false);
      setProgressText(null);
    }
  };

  const handleSelectScope = (scope: InfiniteExportScope) => {
    if (scope === 'region' && !props.customRegion) {
      props.onStartRegionPick(null);
      return;
    }
    patchOptions({ scope });
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="import-modal-backdrop inf-export-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Unendlichen Canvas exportieren"
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
                  <h2>Unendlichen Canvas exportieren</h2>
                  <span class="import-type-badge">{scopeSummaryBadge()}</span>
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

            {/* Body: Preview + Granular Options */}
            <div class="import-modal-body inf-export-body">
              <div class="inf-export-grid">
                {/* Left Column: Live Preview */}
                <div class="inf-export-preview-col">
                  <div class="inf-export-preview-stage">
                    <div
                      class="inf-export-preview-frame"
                      classList={{
                        'is-checkerboard':
                          options().format === 'png' && options().background === 'transparent',
                      }}
                    >
                      <canvas ref={previewCanvasRef} class="inf-export-preview-canvas" />
                    </div>

                    <div class="inf-export-preview-meta">
                      <span class="iem-chip">
                        {formatWorldDimensionsCm(
                          worldRectResult().rect.width,
                          worldRectResult().rect.height
                        )}
                      </span>
                      <Show
                        when={options().format === 'pdf-pages' && pdfLayout()}
                        fallback={
                          <span class="iem-chip">
                            {imageMetrics().pixelWidth} × {imageMetrics().pixelHeight} px
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
                    </div>

                    <Show when={worldRectResult().isEmptyFallback && options().scope === 'content'}>
                      <div class="inf-export-notice">
                        Canvas ist leer — es wird der aktuelle Bildschirmbereich exportiert.
                      </div>
                    </Show>

                    <Show
                      when={
                        options().format !== 'pdf-pages' &&
                        imageMetrics().wasClamped
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

                    <Show when={options().scope === 'region'}>
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
                  {/* 1. Scope (Area) */}
                  <div class="import-field">
                    <div class="import-field-head">
                      <span class="import-field-label">Ausschnitt / Bereich</span>
                      <Show when={options().scope !== 'region'}>
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
                        classList={{ 'is-active': options().scope === 'viewport' }}
                        onClick={() => handleSelectScope('viewport')}
                      >
                        <IconMonitor size={15} />
                        <div>
                          <span class="isc-title">Aktueller Bildschirm</span>
                          <span class="isc-sub">
                            Sichtbarer Ausschnitt ({Math.round(props.viewport.camera.zoom * 100)} %)
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        class="inf-scope-card"
                        classList={{ 'is-active': options().scope === 'content' }}
                        onClick={() => handleSelectScope('content')}
                      >
                        <IconMaximize size={15} />
                        <div>
                          <span class="isc-title">Gesamter Inhalt</span>
                          <span class="isc-sub">
                            {hasAnyPageContent() ? 'Alles auf dem Board' : 'Noch kein Inhalt'}
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        class="inf-scope-card"
                        classList={{ 'is-active': options().scope === 'region' }}
                        onClick={() => handleSelectScope('region')}
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
                          classList={{ 'is-active': options().scope === 'selection' }}
                          onClick={() => handleSelectScope('selection')}
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

                  {/* Padding for content / selection scopes */}
                  <Show when={options().scope === 'content' || options().scope === 'selection'}>
                    <div class="import-field">
                      <span class="import-field-label">Randabstand um den Inhalt</span>
                      <div class="import-option-row">
                        <For each={PADDING_PRESETS}>
                          {(p) => (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{ 'is-active': options().padding === p.value }}
                              onClick={() => patchOptions({ padding: p.value })}
                            >
                              {p.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* 2. Output Format */}
                  <div class="import-field">
                    <span class="import-field-label">Format</span>
                    <div class="inf-format-grid">
                      <For each={FORMAT_CARDS}>
                        {(fmt) => (
                          <button
                            type="button"
                            class="inf-format-card"
                            classList={{ 'is-active': options().format === fmt.id }}
                            onClick={() => patchOptions({ format: fmt.id })}
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
                  </div>

                  {/* 2b. PDF Multi-Page Tiling Options */}
                  <Show when={options().format === 'pdf-pages'}>
                    <div class="inf-pdf-panel">
                      <div class="import-field">
                        <span class="import-field-label">Papierformat</span>
                        <div class="import-option-row">
                          <For each={PDF_PAPER_PRESETS}>
                            {(paper) => (
                              <button
                                type="button"
                                class="import-choice-pill inf-compact-pill"
                                classList={{ 'is-active': options().pdfPaper === paper.id }}
                                onClick={() => patchOptions({ pdfPaper: paper.id })}
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
                              classList={{ 'is-active': options().pdfPagingMode === m.id }}
                              onClick={() => patchOptions({ pdfPagingMode: m.id })}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div class="inf-inline-split">
                        <Show when={options().pdfPagingMode === 'tile'}>
                          <div class="import-field">
                            <span class="import-field-label">Maßstab</span>
                            <div class="import-option-row">
                              <For each={PDF_TILE_SCALE_PRESETS}>
                                {(s) => (
                                  <button
                                    type="button"
                                    class="import-choice-pill inf-compact-pill"
                                    classList={{
                                      'is-active': Math.abs(options().pdfTileScale - s.value) < 0.02,
                                    }}
                                    onClick={() => patchOptions({ pdfTileScale: s.value })}
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
                                  classList={{ 'is-active': options().pdfMarginMm === m.value }}
                                  onClick={() => patchOptions({ pdfMarginMm: m.value })}
                                >
                                  {m.label}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>

                      <div class="inf-toggle-row">
                        <Show when={options().pdfPagingMode !== 'fit-page'}>
                          <label class="inf-check-label">
                            <input
                              type="checkbox"
                              checked={options().pdfSkipEmptyPages}
                              onChange={(e) =>
                                patchOptions({ pdfSkipEmptyPages: e.currentTarget.checked })
                              }
                            />
                            <span>Leere Seiten überspringen</span>
                          </label>
                        </Show>
                        <label class="inf-check-label">
                          <input
                            type="checkbox"
                            checked={options().pdfShowPageNumbers}
                            onChange={(e) =>
                              patchOptions({ pdfShowPageNumbers: e.currentTarget.checked })
                            }
                          />
                          <span>Seitenzahlen anzeigen</span>
                        </label>
                      </div>
                    </div>
                  </Show>

                  {/* 2c. JPEG Quality */}
                  <Show when={options().format === 'jpeg'}>
                    <div class="import-field">
                      <span class="import-field-label">JPEG-Qualität</span>
                      <div class="import-option-row">
                        <For each={JPEG_QUALITY_PRESETS}>
                          {(q) => (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{
                                'is-active': Math.abs(options().jpegQuality - q.value) < 0.01,
                              }}
                              onClick={() => patchOptions({ jpegQuality: q.value })}
                            >
                              {q.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* 3. Background & Paper Style */}
                  <div class="import-field">
                    <span class="import-field-label">Hintergrund &amp; Papier</span>
                    <div class="import-option-row">
                      <For each={BACKGROUND_OPTIONS}>
                        {(bg) => {
                          const disabled = () =>
                            Boolean(bg.pngOnly && options().format !== 'png');
                          return (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{ 'is-active': options().background === bg.id }}
                              disabled={disabled()}
                              title={
                                disabled()
                                  ? 'Transparenter Hintergrund ist nur bei PNG verfügbar'
                                  : undefined
                              }
                              onClick={() => patchOptions({ background: bg.id })}
                            >
                              {bg.label}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>

                  {/* 4. Resolution + Layers */}
                  <div class="inf-inline-split">
                    <div class="import-field">
                      <span class="import-field-label">Auflösung</span>
                      <div class="import-option-row">
                        <For each={SCALE_PRESETS}>
                          {(s) => (
                            <button
                              type="button"
                              class="import-choice-pill inf-compact-pill"
                              classList={{ 'is-active': options().scale === s.value }}
                              onClick={() => patchOptions({ scale: s.value })}
                            >
                              <strong>{s.label}</strong>
                              <span class="inf-scale-hint">{s.hint}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </div>

                  {/* 5. Granular Content Layers */}
                  <div class="import-field">
                    <span class="import-field-label">
                      <IconLayers size={13} />
                      <span>Ebenen einbeziehen</span>
                    </span>
                    <div class="import-option-row">
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': options().layers.strokes }}
                        onClick={() => toggleLayer('strokes')}
                      >
                        Stift &amp; Formen
                      </button>
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': options().layers.highlighter }}
                        onClick={() => toggleLayer('highlighter')}
                      >
                        Textmarker
                      </button>
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': options().layers.texts }}
                        onClick={() => toggleLayer('texts')}
                      >
                        Texte
                      </button>
                      <button
                        type="button"
                        class="import-choice-pill inf-compact-pill"
                        classList={{ 'is-active': options().layers.images }}
                        onClick={() => toggleLayer('images')}
                      >
                        Bilder
                      </button>
                      <Show when={hasBackgroundImage()}>
                        <button
                          type="button"
                          class="import-choice-pill inf-compact-pill"
                          classList={{ 'is-active': options().layers.backgroundImage }}
                          onClick={() => toggleLayer('backgroundImage')}
                        >
                          Hintergrund-PDF
                        </button>
                      </Show>
                    </div>
                  </div>

                  {/* 6. Filename */}
                  <div class="import-field">
                    <span class="import-field-label">Dateiname</span>
                    <div class="inf-filename-wrap">
                      <input
                        type="text"
                        class="import-text-input is-compact"
                        value={filename()}
                        onInput={(e) => setFilename(e.currentTarget.value)}
                        placeholder="canvas-export"
                      />
                      <span class="inf-filename-ext">
                        .{getExportFileExtension(options().format)}
                      </span>
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
                    {options().background === 'white' || options().background === 'white-pattern'
                      ? 'Auto-Tinte wird automatisch dunkel für sauberen Druck gerendert.'
                      : 'Tipp: Mit „Eigener Bereich“ lässt sich jeder Ausschnitt exakt einrahmen.'}
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

                <Show when={canCopyClipboard && options().format === 'png'}>
                  <button
                    type="button"
                    class="btn-secondary"
                    disabled={isExporting()}
                    onClick={() => void runExportAction('clipboard')}
                    title="PNG direkt in die Zwischenablage kopieren"
                  >
                    <IconCopy size={14} />
                    <span>Kopieren</span>
                  </button>
                </Show>

                <Show when={canNativeShare}>
                  <button
                    type="button"
                    class="btn-secondary"
                    disabled={isExporting()}
                    onClick={() => void runExportAction('share')}
                    title="Über System-Teilen-Menü senden (Fotos, Dateien, AirDrop…)"
                  >
                    <IconShare size={14} />
                    <span>Teilen</span>
                  </button>
                </Show>

                <button
                  type="button"
                  class="btn-primary"
                  disabled={isExporting()}
                  onClick={() => void runExportAction('download')}
                >
                  <IconDownload size={14} />
                  <span>
                    {options().format === 'png'
                      ? 'Als PNG speichern'
                      : options().format === 'jpeg'
                        ? 'Als JPEG speichern'
                        : 'Als PDF speichern'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
