import { DEFAULT_PAPER_CONFIG, type CanvasPage } from '../types';
import { processImageFile } from './imageImport';
import { clampPageHeight, clampPageWidth, generateId } from './storage';

let pdfJsConfigured = false;

async function getPdfJs() {
  const [pdfjsLib, workerMod] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  if (!pdfJsConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
    pdfJsConfigured = true;
  }
  return pdfjsLib;
}

export function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function stripFileExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim() || 'Seite';
}

/**
 * Normalizes arbitrary PDF/image natural dimensions to comfortable logical canvas page dimensions
 * while preserving the exact aspect ratio.
 */
function computeLogicalPageSize(naturalW: number, naturalH: number): {
  width: number;
  height: number;
} {
  const safeW = Math.max(1, naturalW);
  const safeH = Math.max(1, naturalH);
  const ratio = safeW / safeH;

  // Landscape pages normalize around width ~1160px; portrait pages around height ~1123px (A4 feel)
  let targetW: number;
  let targetH: number;
  if (ratio >= 1) {
    targetW = Math.min(1280, Math.max(760, Math.round(safeW)));
    targetH = Math.round(targetW / ratio);
    if (targetH > 1200) {
      targetH = 1200;
      targetW = Math.round(targetH * ratio);
    }
  } else {
    targetH = Math.min(1280, Math.max(820, Math.round(safeH)));
    targetW = Math.round(targetH * ratio);
    if (targetW > 1100) {
      targetW = 1100;
      targetH = Math.round(targetW / ratio);
    }
  }

  return {
    width: clampPageWidth(targetW),
    height: clampPageHeight(targetH),
  };
}

export async function importPdfAsPages(
  file: File,
  onProgress?: (pageNum: number, totalPages: number) => void
): Promise<CanvasPage[]> {
  const pdfjsLib = await getPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const baseName = stripFileExtension(file.name);
  const total = pdf.numPages;
  const pages: CanvasPage[] = [];

  // Adaptive resolution/compression so multi-page PDFs stay crisp and localStorage-friendly
  const maxRenderDim = total > 15 ? 1150 : total > 6 ? 1300 : 1500;
  const jpegQuality = total > 15 ? 0.74 : total > 6 ? 0.8 : 0.85;

  try {
    for (let pageNum = 1; pageNum <= total; pageNum++) {
      onProgress?.(pageNum, total);
      const pdfPage = await pdf.getPage(pageNum);
      const baseViewport = pdfPage.getViewport({ scale: 1 });

      // Logical page dimensions (CSS points at 96/72 ≈ 1.333 scale gives A4 = 794×1123!)
      const logicalFromPdf = computeLogicalPageSize(
        baseViewport.width * (96 / 72),
        baseViewport.height * (96 / 72)
      );

      // Render viewport scaled to crisp bitmap
      const renderScale = Math.min(
        2.2,
        maxRenderDim / Math.max(baseViewport.width, baseViewport.height)
      );
      const renderViewport = pdfPage.getViewport({ scale: renderScale });

      const offscreen = document.createElement('canvas');
      offscreen.width = Math.max(1, Math.round(renderViewport.width));
      offscreen.height = Math.max(1, Math.round(renderViewport.height));
      const ctx = offscreen.getContext('2d');

      if (ctx) {
        // Crisp white paper base behind transparent PDF regions
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, offscreen.width, offscreen.height);
      }

      await pdfPage.render({
        canvas: offscreen,
        viewport: renderViewport,
      }).promise;

      const src = offscreen.toDataURL('image/jpeg', jpegQuality);
      pdfPage.cleanup();

      pages.push({
        id: generateId(),
        title: total === 1 ? baseName : `${baseName} – S. ${pageNum}`,
        width: logicalFromPdf.width,
        height: logicalFromPdf.height,
        strokes: [],
        texts: [],
        images: [],
        paperConfig: {
          ...DEFAULT_PAPER_CONFIG,
          pattern: 'blank',
          backgroundColor: '#ffffff',
          showMargin: false,
        },
        backgroundImage: {
          src,
          name: file.name,
          sourceType: 'pdf',
          pageNumber: pageNum,
          opacity: 1,
        },
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}

export async function importImageAsPage(file: File): Promise<CanvasPage> {
  const processed = await processImageFile(file, 1500);
  const dims = computeLogicalPageSize(processed.width, processed.height);

  return {
    id: generateId(),
    title: stripFileExtension(processed.name),
    width: dims.width,
    height: dims.height,
    strokes: [],
    texts: [],
    images: [],
    paperConfig: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'blank',
      backgroundColor: '#ffffff',
      showMargin: false,
    },
    backgroundImage: {
      src: processed.src,
      name: processed.name,
      sourceType: 'image',
      opacity: 1,
    },
  };
}

export async function importFilesAsPages(
  files: File[],
  onProgress?: (status: string) => void
): Promise<CanvasPage[]> {
  const created: CanvasPage[] = [];

  for (const file of files) {
    if (isPdfFile(file)) {
      const pdfPages = await importPdfAsPages(file, (num, total) => {
        onProgress?.(`PDF „${file.name}“: Seite ${num} / ${total}…`);
      });
      created.push(...pdfPages);
    } else if (isImageFile(file)) {
      onProgress?.(`Bild „${file.name}“ wird als Seite vorbereitet…`);
      const imgPage = await importImageAsPage(file);
      created.push(imgPage);
    }
  }

  return created;
}

export function extractPdfFilesFromTransfer(
  dataTransfer: DataTransfer | null
): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && isPdfFile(f)) files.push(f);
      }
    }
  }

  if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      if (isPdfFile(f)) files.push(f);
    }
  }

  return files;
}
