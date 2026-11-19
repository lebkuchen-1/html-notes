export interface ProcessedImage {
  src: string;
  width: number;
  height: number;
  name: string;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = url;
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Datei konnte nicht gelesen werden'));
    };
    reader.onerror = () => reject(new Error('Fehler beim Lesen der Datei'));
    reader.readAsDataURL(file);
  });
}

/**
 * Loads an image file, downscales if larger than maxDimension to keep localStorage fast,
 * and returns a crisp data URL plus dimensions.
 */
export async function processImageFile(
  file: File,
  maxDimension = 1400
): Promise<ProcessedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const origW = img.naturalWidth || img.width || 400;
    const origH = img.naturalHeight || img.height || 300;

    // Keep small SVG/GIF/PNG files directly if they are already compact
    if (
      (file.type === 'image/svg+xml' || file.type === 'image/gif') &&
      file.size <= 350 * 1024
    ) {
      const src = await readAsDataUrl(file);
      return {
        src,
        width: origW,
        height: origH,
        name: file.name || 'Bild',
      };
    }

    const scale = Math.min(1, maxDimension / Math.max(origW, origH));
    const targetW = Math.max(1, Math.round(origW * scale));
    const targetH = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallbackSrc = await readAsDataUrl(file);
      return { src: fallbackSrc, width: origW, height: origH, name: file.name || 'Bild' };
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Preserve transparency for PNG/WebP/SVG; use crisp JPEG for photos
    const mayHaveAlpha =
      file.type === 'image/png' ||
      file.type === 'image/webp' ||
      file.type === 'image/svg+xml';

    let src: string;
    if (mayHaveAlpha) {
      const webp = canvas.toDataURL('image/webp', 0.88);
      if (webp.startsWith('data:image/webp')) {
        src = webp;
      } else {
        src = canvas.toDataURL('image/png');
      }
    } else {
      src = canvas.toDataURL('image/jpeg', 0.84);
    }

    return {
      src,
      width: targetW,
      height: targetH,
      name: file.name || 'Bild',
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function extractImageFilesFromTransfer(
  dataTransfer: DataTransfer | null
): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];

  if (dataTransfer.items && dataTransfer.items.length > 0) {
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  }

  if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (let i = 0; i < dataTransfer.files.length; i++) {
      const f = dataTransfer.files[i];
      if (f.type.startsWith('image/')) {
        files.push(f);
      }
    }
  }

  return files;
}
