import { isImageFile, isPdfFile, stripFileExtension } from './pageImport';

export type QuickImportPayload =
  | {
      kind: 'files';
      files: File[];
      suggestedTitle: string;
      sourceUrl?: string;
    }
  | {
      kind: 'link';
      url: string;
      title: string;
      suggestedTitle: string;
      isPdfUrl?: boolean;
      corsFetchFailed?: boolean;
    }
  | {
      kind: 'text';
      text: string;
      suggestedTitle: string;
    };

export interface ClipboardReadResult {
  payload: QuickImportPayload | null;
  error?: 'permission' | 'empty' | 'unsupported' | 'shortcut_wrong_input';
  foundTypes?: string[];
  diagnostic?: string;
}

const IMAGE_MIME_PRIORITY = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

function mimeToExt(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('pdf')) return 'pdf';
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('svg')) return 'svg';
  return 'bin';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function deriveTitleFromFiles(files: File[]): string {
  if (files.length === 0) return 'Importierte Notiz';
  const first = stripFileExtension(files[0].name);
  const cleanFirst =
    first.toLowerCase() === 'image' || first.toLowerCase() === 'clipboard'
      ? `Bild ${new Intl.DateTimeFormat('de-DE', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date())}`
      : first;
  return files.length === 1 ? cleanFirst : `${cleanFirst} (+${files.length - 1})`;
}

export function deriveTitleFromUrl(rawUrl: string, htmlHint?: string): string {
  if (htmlHint) {
    try {
      const doc = new DOMParser().parseFromString(htmlHint, 'text/html');
      const anchor = doc.querySelector('a');
      const anchorText = anchor?.textContent?.trim();
      if (anchorText && anchorText.length >= 2 && !/^https?:\/\//i.test(anchorText)) {
        return anchorText.slice(0, 90);
      }
    } catch {
      // ignore HTML parse fallback
    }
  }

  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1];
    if (lastSeg) {
      const decoded = decodeURIComponent(lastSeg)
        .replace(/\.[^.]+$/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (decoded.length >= 2) {
        return decoded.slice(0, 85);
      }
    }
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'Gespeicherter Link';
  }
}

export function deriveTitleFromText(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').trim())
      .find((l) => l.length > 0) ?? '';
  if (!firstLine) return 'Eingefügte Notiz';
  return firstLine.length > 68 ? `${firstLine.slice(0, 65).trimEnd()}…` : firstLine;
}

export function formatLinkAsMarkdown(url: string, title: string): string {
  const safeTitle = title.trim() || deriveTitleFromUrl(url);
  return `[${safeTitle}](${url})`;
}

function isSingleHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function decodeBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> | null {
  try {
    let cleaned = base64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const mod = cleaned.length % 4;
    if (mod === 2) cleaned += '==';
    else if (mod === 3) cleaned += '=';
    else if (mod === 1) return null;

    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function base64ToFile(base64: string, mime: string, filename: string): File | null {
  const bytes = decodeBase64ToBytes(base64);
  if (!bytes || bytes.length === 0) return null;
  return new File([bytes], filename, { type: mime });
}

function looksLikeWholeBase64Blob(trimmed: string): boolean {
  if (trimmed.length < 80) return false;
  // Real prose has spaces between words; Base64 only has A-Z, a-z, 0-9, +, /, -, _, = and line breaks
  const sampleHead = trimmed.slice(0, 320);
  const sampleTail = trimmed.slice(-160);
  const re = /^[A-Za-z0-9+/=_\-\r\n]+$/;
  return re.test(sampleHead) && re.test(sampleTail);
}

function findPdfMagicOffset(bytes: Uint8Array): number {
  // PDF spec allows %PDF- anywhere within the first 1024 bytes
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return i;
    }
  }
  return -1;
}

function formatBytesDiagnostic(bytes: Uint8Array, totalChars: number): string {
  const sample = bytes.slice(0, 48);
  let ascii = '';
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '·';
  }
  const hex = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `${totalChars} Zeichen Base64 · Bytes: [${hex}] · Vorschau: „${ascii.trim().slice(0, 40)}“`;
}

type EmbeddedBase64Result =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }
  | { kind: 'non_pdf_base64'; diagnostic: string }
  | null;

function tryDecodeEmbeddedFileText(raw: string): EmbeddedBase64Result {
  const trimmed = raw.trim();

  // Optional iOS Shortcut convention: NOTIZBLOCK_FILE_B64:<mime>:<filename>:<base64>
  if (trimmed.startsWith('NOTIZBLOCK_FILE_B64:')) {
    const rest = trimmed.slice('NOTIZBLOCK_FILE_B64:'.length);
    const firstColon = rest.indexOf(':');
    const secondColon = firstColon >= 0 ? rest.indexOf(':', firstColon + 1) : -1;
    if (firstColon > 0 && secondColon > firstColon) {
      const mime = rest.slice(0, firstColon).trim() || 'application/pdf';
      const name = rest.slice(firstColon + 1, secondColon).trim() || `Import.${mimeToExt(mime)}`;
      const b64 = rest.slice(secondColon + 1);
      const file = base64ToFile(b64, mime, name);
      if (file) return { kind: 'file', file };
    }
  }

  // Standard data URI for PDF or Image (checked via prefix to stay O(1) on large files)
  if (trimmed.startsWith('data:')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx > 5 && commaIdx < 120) {
      const header = trimmed.slice(5, commaIdx).toLowerCase();
      if (header.endsWith(';base64')) {
        const mime = header.slice(0, -';base64'.length).trim();
        if (mime === 'application/pdf' || mime.startsWith('image/')) {
          const b64 = trimmed.slice(commaIdx + 1);
          const ext = mimeToExt(mime);
          const name = mime === 'application/pdf' ? 'Zwischenablage.pdf' : `Bild.${ext}`;
          const file = base64ToFile(b64, mime, name);
          if (file) return { kind: 'file', file };
        }
      }
    }
  }

  // Raw Base64 detection (for 2-step Apple Shortcut: Base64 codieren -> In Zwischenablage kopieren)
  if (looksLikeWholeBase64Blob(trimmed)) {
    // Inspect first ~1.5 KB cheaply first to check magic bytes before decoding huge files
    const prefixChunk = trimmed.slice(0, 2048).replace(/\s+/g, '');
    const alignedPrefixLen = Math.floor(prefixChunk.length / 4) * 4;
    const headBytes = decodeBase64ToBytes(prefixChunk.slice(0, alignedPrefixLen));

    if (headBytes && headBytes.length >= 8) {
      // 1. PDF (%PDF- within first 1024 bytes)
      const pdfOffset = findPdfMagicOffset(headBytes);
      if (pdfOffset >= 0) {
        // Also tolerate multiple Base64 chunks separated by '=' padding if Shortcuts joined items
        const cleanedOnly = trimmed.replace(/[^A-Za-z0-9+/=_-]/g, '');
        const padIdx = cleanedOnly.indexOf('=');
        const firstChunk =
          padIdx > 0
            ? cleanedOnly.slice(0, padIdx + (cleanedOnly[padIdx + 1] === '=' ? 2 : 1))
            : cleanedOnly;
        const fullBytes = decodeBase64ToBytes(trimmed) ?? decodeBase64ToBytes(firstChunk);
        if (fullBytes && fullBytes.length > pdfOffset + 16) {
          const slice = pdfOffset > 0 ? fullBytes.slice(pdfOffset) : fullBytes;
          return {
            kind: 'file',
            file: new File([slice], 'Importiertes Dokument.pdf', { type: 'application/pdf' }),
          };
        }
      }

      // 2. PNG (89 50 4E 47)
      if (
        headBytes[0] === 0x89 &&
        headBytes[1] === 0x50 &&
        headBytes[2] === 0x4e &&
        headBytes[3] === 0x47
      ) {
        const file = base64ToFile(trimmed, 'image/png', 'Zwischenablage.png');
        if (file) return { kind: 'file', file };
      }

      // 3. JPEG (FF D8 FF)
      if (headBytes[0] === 0xff && headBytes[1] === 0xd8 && headBytes[2] === 0xff) {
        const file = base64ToFile(trimmed, 'image/jpeg', 'Zwischenablage.jpg');
        if (file) return { kind: 'file', file };
      }

      // 4. WebP (RIFF....WEBP)
      if (
        headBytes.length >= 12 &&
        headBytes[0] === 0x52 &&
        headBytes[1] === 0x49 &&
        headBytes[2] === 0x46 &&
        headBytes[3] === 0x46 &&
        headBytes[8] === 0x57 &&
        headBytes[9] === 0x45 &&
        headBytes[10] === 0x42 &&
        headBytes[11] === 0x50
      ) {
        const file = base64ToFile(trimmed, 'image/webp', 'Zwischenablage.webp');
        if (file) return { kind: 'file', file };
      }

      // 5. GIF (GIF8)
      if (
        headBytes[0] === 0x47 &&
        headBytes[1] === 0x49 &&
        headBytes[2] === 0x46 &&
        headBytes[3] === 0x38
      ) {
        const file = base64ToFile(trimmed, 'image/gif', 'Zwischenablage.gif');
        if (file) return { kind: 'file', file };
      }

      // 6. Base64-encoded plain URL, .webloc XML plist, or Safari HTML wrapper with <embed src="...pdf">
      if (trimmed.length < 32768) {
        const fullBytes = decodeBase64ToBytes(trimmed);
        if (fullBytes) {
          const decodedText = new TextDecoder().decode(fullBytes).trim();
          const url = isSingleHttpUrl(decodedText);
          if (url) return { kind: 'url', url };

          // Check XML .webloc plist (<key>URL</key><string>https://...</string>)
          const weblocMatch = decodedText.match(
            /<key>\s*URL\s*<\/key>\s*<string>\s*(https?:\/\/[^<\s]+)\s*<\/string>/i
          );
          if (weblocMatch?.[1]) {
            return { kind: 'url', url: weblocMatch[1] };
          }

          // Check HTML wrapper containing <embed src="https://...">, <iframe src="...">, or <object data="...">
          if (/<html|<embed|<iframe|<object/i.test(decodedText)) {
            try {
              const doc = new DOMParser().parseFromString(decodedText, 'text/html');
              const embedSrc =
                doc.querySelector('embed[src]')?.getAttribute('src') ||
                doc.querySelector('iframe[src]')?.getAttribute('src') ||
                doc.querySelector('object[data]')?.getAttribute('data') ||
                doc.querySelector('a[href*=".pdf" i]')?.getAttribute('href') ||
                '';
              const extractedUrl = isSingleHttpUrl(embedSrc);
              if (extractedUrl) {
                return { kind: 'url', url: extractedUrl };
              }
            } catch {
              // ignore DOM parse errors
            }
          }
        }
      }

      // 7. Long Base64 blob that is NOT a PDF or image (e.g. Safari Webpage / HTML / plist)
      if (trimmed.length >= 256) {
        return {
          kind: 'non_pdf_base64',
          diagnostic: formatBytesDiagnostic(headBytes, trimmed.length),
        };
      }
    }
  }

  return null;
}

function looksLikeDirectPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function looksLikeDirectImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|webp|gif)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function tryFetchDirectFileFromUrl(url: string): Promise<File | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 3600);
  try {
    const res = await fetch(url, { mode: 'cors', signal: controller.signal });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentType.includes('application/pdf') || looksLikeDirectPdfUrl(url);
    const isImg = contentType.startsWith('image/') || looksLikeDirectImageUrl(url);
    if (!isPdf && !isImg) return null;

    const blob = await res.blob();
    if (blob.size === 0 || blob.size > 40 * 1024 * 1024) return null;

    const mime = blob.type || (isPdf ? 'application/pdf' : 'image/png');
    const urlTitle = deriveTitleFromUrl(url);
    const ext = mimeToExt(mime);
    const filename = urlTitle.toLowerCase().endsWith(`.${ext}`)
      ? urlTitle
      : `${urlTitle}.${ext}`;
    return new File([blob], filename, { type: mime });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function parseClipboardTextPayload(
  plainText: string,
  htmlText = ''
): Promise<QuickImportPayload | null> {
  const res = await parseClipboardTextDetailed(plainText, htmlText);
  return res.payload;
}

async function parseClipboardTextDetailed(
  plainText: string,
  htmlText = ''
): Promise<{
  payload: QuickImportPayload | null;
  wrongShortcutInput?: boolean;
  diagnostic?: string;
}> {
  const trimmed = plainText.trim();
  if (!trimmed) return { payload: null };

  // 1. Check Base64 PDF / Image / URL payload (e.g. from data URI or iOS Shortcut)
  const decoded = tryDecodeEmbeddedFileText(trimmed);
  if (decoded?.kind === 'file') {
    return {
      payload: {
        kind: 'files',
        files: [decoded.file],
        suggestedTitle: deriveTitleFromFiles([decoded.file]),
      },
    };
  }
  if (decoded?.kind === 'non_pdf_base64') {
    return { payload: null, wrongShortcutInput: true, diagnostic: decoded.diagnostic };
  }

  const candidateText = decoded?.kind === 'url' ? decoded.url : trimmed;

  // 2. Check single HTTP(S) URL (typical result of Safari "Teilen -> Kopieren")
  const singleUrl = isSingleHttpUrl(candidateText);
  if (singleUrl) {
    const isPdfUrl = looksLikeDirectPdfUrl(singleUrl);
    const isImgUrl = looksLikeDirectImageUrl(singleUrl);

    if (isPdfUrl || isImgUrl) {
      const fetched = await tryFetchDirectFileFromUrl(singleUrl);
      if (fetched) {
        return {
          payload: {
            kind: 'files',
            files: [fetched],
            suggestedTitle: deriveTitleFromFiles([fetched]),
            sourceUrl: singleUrl,
          },
        };
      }
    }

    const title = deriveTitleFromUrl(singleUrl, htmlText);
    return {
      payload: {
        kind: 'link',
        url: singleUrl,
        title,
        suggestedTitle: title,
        isPdfUrl,
        corsFetchFailed: isPdfUrl || isImgUrl,
      },
    };
  }

  // 3. Regular text / article excerpt
  return {
    payload: {
      kind: 'text',
      text: candidateText,
      suggestedTitle: deriveTitleFromText(candidateText),
    },
  };
}

/**
 * Reads PDFs, images, links, or text directly from the system clipboard.
 * Must be invoked inside a user gesture (button click) for iPadOS Safari's native "Einsetzen" prompt.
 */
export async function readQuickImportFromClipboard(): Promise<ClipboardReadResult> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return { payload: null, error: 'unsupported' };
  }

  // Preferred rich Clipboard API (supports images, PDFs, HTML + plain text on iPadOS Safari!)
  if (typeof navigator.clipboard.read === 'function') {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      const foundTypes: string[] = [];
      let plainText = '';
      let htmlText = '';
      let uriListText = '';
      let imgCounter = 0;

      for (const item of items) {
        for (const t of item.types) {
          if (!foundTypes.includes(t)) foundTypes.push(t);
        }

        // Check PDF (exact or vendor/platform PDF mime type)
        const pdfMime = item.types.find((t) => t.toLowerCase().includes('pdf'));
        if (pdfMime) {
          const blob = await item.getType(pdfMime);
          if (blob.size > 0) {
            files.push(
              new File([blob], `Dokument${files.length > 0 ? ` ${files.length + 1}` : ''}.pdf`, {
                type: 'application/pdf',
              })
            );
            continue;
          }
        }

        // Check images (pick best mime representation per ClipboardItem)
        const imageMime =
          IMAGE_MIME_PRIORITY.find((m) => item.types.includes(m)) ??
          item.types.find((t) => t.startsWith('image/'));
        if (imageMime) {
          const blob = await item.getType(imageMime);
          if (blob.size > 0) {
            imgCounter++;
            const ext = mimeToExt(imageMime);
            files.push(
              new File(
                [blob],
                `Bild${imgCounter > 1 ? ` ${imgCounter}` : ''}.${ext}`,
                { type: imageMime }
              )
            );
            continue;
          }
        }

        if (!uriListText && item.types.includes('text/uri-list')) {
          const blob = await item.getType('text/uri-list');
          uriListText = await blob.text();
        }
        if (!htmlText && item.types.includes('text/html')) {
          const blob = await item.getType('text/html');
          htmlText = await blob.text();
        }
        if (!plainText && item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          plainText = await blob.text();
        }
      }

      if (files.length > 0) {
        return {
          payload: {
            kind: 'files',
            files,
            suggestedTitle: deriveTitleFromFiles(files),
          },
          foundTypes,
        };
      }

      const firstUri = uriListText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('#'));

      const effectiveText = plainText.trim() || firstUri || '';
      if (effectiveText) {
        const parsed = await parseClipboardTextDetailed(effectiveText, htmlText);
        return {
          payload: parsed.payload,
          error: parsed.payload
            ? undefined
            : parsed.wrongShortcutInput
              ? 'shortcut_wrong_input'
              : 'empty',
          foundTypes,
          diagnostic: parsed.diagnostic,
        };
      }

      // Fallback if only HTML was present without text/plain
      if (htmlText.trim()) {
        try {
          const doc = new DOMParser().parseFromString(htmlText, 'text/html');
          const img = doc.querySelector('img');
          const link = doc.querySelector('a[href]');
          const extracted =
            link?.getAttribute('href') ||
            img?.getAttribute('src') ||
            doc.body.textContent?.trim() ||
            '';
          if (extracted) {
            const parsed = await parseClipboardTextPayload(extracted, htmlText);
            return { payload: parsed, error: parsed ? undefined : 'empty', foundTypes };
          }
        } catch {
          // ignore
        }
      }

      return { payload: null, error: 'empty', foundTypes };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { payload: null, error: 'permission' };
      }
      // Fall through to readText() below for browsers with partial clipboard.read() support
    }
  }

  if (typeof navigator.clipboard.readText === 'function') {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return { payload: null, error: 'empty' };
      const parsed = await parseClipboardTextDetailed(text, '');
      return {
        payload: parsed.payload,
        error: parsed.payload
          ? undefined
          : parsed.wrongShortcutInput
            ? 'shortcut_wrong_input'
            : 'empty',
        diagnostic: parsed.diagnostic,
      };
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { payload: null, error: 'permission' };
      }
    }
  }

  return { payload: null, error: 'unsupported' };
}

/**
 * Extracts PDFs, images, links, or text from a Paste or Drag&Drop DataTransfer.
 */
export async function parseQuickImportFromDataTransfer(
  dt: DataTransfer | null
): Promise<QuickImportPayload | null> {
  if (!dt) return null;
  const files: File[] = [];

  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && (isPdfFile(f) || isImageFile(f))) {
          files.push(f);
        }
      }
    }
  }

  if (files.length === 0 && dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (isPdfFile(f) || isImageFile(f)) {
        files.push(f);
      }
    }
  }

  if (files.length > 0) {
    return {
      kind: 'files',
      files,
      suggestedTitle: deriveTitleFromFiles(files),
    };
  }

  const uriList = dt.getData('text/uri-list')?.trim() || '';
  const firstUri = uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#'));
  const html = dt.getData('text/html') || '';
  const plain = dt.getData('text/plain') || firstUri || '';

  if (plain.trim()) {
    return parseClipboardTextPayload(plain, html);
  }
  return null;
}

export function createFilesQuickImportPayload(files: File[]): QuickImportPayload | null {
  const valid = files.filter((f) => isPdfFile(f) || isImageFile(f));
  if (valid.length === 0) return null;
  return {
    kind: 'files',
    files: valid,
    suggestedTitle: deriveTitleFromFiles(valid),
  };
}
