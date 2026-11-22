/**
 * Minimal, zero-dependency PDF 1.4 binary writer for single-page and multi-page
 * image-based exports (JPEG / DCTDecode streams).
 *
 * Works completely offline across desktop browsers and iPadOS Safari without
 * external PDF libraries.
 */

export interface PdfImagePage {
  /** Page width in PDF points (72 pt = 1 inch) */
  widthPt: number;
  /** Page height in PDF points (72 pt = 1 inch) */
  heightPt: number;
  /** Raw JPEG bytes (baseline DCT) */
  jpegBytes: Uint8Array;
  /** Encoded image pixel width */
  pixelWidth: number;
  /** Encoded image pixel height */
  pixelHeight: number;
}

const encoder = new TextEncoder();

function encodeAscii(str: string): Uint8Array {
  return encoder.encode(str);
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? Number(n.toFixed(2)).toString() : '0';
}

function padOffset(offset: number): string {
  return String(offset).padStart(10, '0');
}

export function buildPdfFromJpegPages(pages: PdfImagePage[]): Blob {
  if (pages.length === 0) {
    throw new Error('Mindestens eine Seite ist für den PDF-Export erforderlich.');
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const offsets: number[] = [0]; // object 0 is the free head entry

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };

  const pushStr = (str: string) => {
    pushBytes(encodeAscii(str));
  };

  // PDF 1.4 header + binary marker comment
  pushBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])); // %PDF-1.4\n
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary comment\n

  // Object numbering:
  // 1: Catalog
  // 2: Pages
  // For page i (0-based):
  //   pageObjId    = 3 + i * 3
  //   imgObjId     = 4 + i * 3
  //   contentObjId = 5 + i * 3
  const pageObjIds = pages.map((_, i) => 3 + i * 3);

  // 1 0 obj — Catalog
  offsets.push(byteLength);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2 0 obj — Pages
  offsets.push(byteLength);
  const kidsRef = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [${kidsRef}] /Count ${pages.length} >>\nendobj\n`);

  // Page + Image + Content objects
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageId = 3 + i * 3;
    const imgId = 4 + i * 3;
    const contentId = 5 + i * 3;
    const wPt = fmtNum(Math.max(1, p.widthPt));
    const hPt = fmtNum(Math.max(1, p.heightPt));

    // Page object
    offsets.push(byteLength);
    pushStr(
      `${pageId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] ` +
        `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>\n` +
        `endobj\n`
    );

    // Image XObject
    offsets.push(byteLength);
    pushStr(
      `${imgId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image ` +
        `/Width ${Math.max(1, Math.round(p.pixelWidth))} ` +
        `/Height ${Math.max(1, Math.round(p.pixelHeight))} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${p.jpegBytes.length} >>\n` +
        `stream\n`
    );
    pushBytes(p.jpegBytes);
    pushStr('\nendstream\nendobj\n');

    // Content stream drawing the full-bleed page image
    const contentStr = `q\n${wPt} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = encodeAscii(contentStr);
    offsets.push(byteLength);
    pushStr(
      `${contentId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`
    );
    pushBytes(contentBytes);
    pushStr('endstream\nendobj\n');
  }

  // Cross-reference table
  const xrefStart = byteLength;
  const totalObjects = offsets.length;
  pushStr(`xref\n0 ${totalObjects}\n`);
  pushStr('0000000000 65535 f \n');
  for (let id = 1; id < totalObjects; id++) {
    pushStr(`${padOffset(offsets[id])} 00000 n \n`);
  }

  // Trailer
  pushStr(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`
  );

  // Merge chunks into a single Uint8Array for Blob creation
  const out = new Uint8Array(byteLength);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return new Blob([out], { type: 'application/pdf' });
}

export async function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality = 0.92
): Promise<Uint8Array> {
  const clampedQ = Math.max(0.5, Math.min(1, quality));
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', clampedQ);
  });
  if (blob) {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }

  // Fallback via data URL
  const dataUrl = canvas.toDataURL('image/jpeg', clampedQ);
  const base64 = dataUrl.split(',')[1] ?? '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: 'image/png' | 'image/jpeg',
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        try {
          const dataUrl = canvas.toDataURL(mimeType, quality);
          const base64 = dataUrl.split(',')[1] ?? '';
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i);
          }
          resolve(new Blob([bytes], { type: mimeType }));
        } catch (err) {
          reject(err);
        }
      },
      mimeType,
      quality
    );
  });
}
