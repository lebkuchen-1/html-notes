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
  error?: 'permission' | 'empty' | 'unsupported';
  foundTypes?: string[];
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

function base64ToFile(base64: string, mime: string, filename: string): File | null {
  try {
    const cleaned = base64.replace(/\s+/g, '');
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}

function looksLikeBase64Sample(str: string): boolean {
  const sample = str.slice(0, 256);
  return sample.length >= 32 && /^[A-Za-z0-9+/=]+$/.test(sample);
}

function tryDecodeEmbeddedFileText(raw: string): File | null {
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
      return base64ToFile(b64, mime, name);
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
          return base64ToFile(b64, mime, name);
        }
      }
    }
  }

  // Raw Base64 PDF / PNG / JPEG (enables a super-simple 2-step Apple Shortcut:
  // 1. "Mit Base64 codieren" -> 2. "In Zwischenablage kopieren", with or without line breaks!)
  if (trimmed.length >= 80) {
    const head = trimmed.slice(0, 24).replace(/\s+/g, '');
    if (head.startsWith('JVBERi0')) {
      const compact = trimmed.replace(/\s+/g, '');
      if (looksLikeBase64Sample(compact)) {
        return base64ToFile(compact, 'application/pdf', 'Importiertes Dokument.pdf');
      }
    } else if (head.startsWith('iVBORw0KGgo')) {
      const compact = trimmed.replace(/\s+/g, '');
      if (looksLikeBase64Sample(compact)) {
        return base64ToFile(compact, 'image/png', 'Zwischenablage.png');
      }
    } else if (head.startsWith('/9j/')) {
      const compact = trimmed.replace(/\s+/g, '');
      if (looksLikeBase64Sample(compact)) {
        return base64ToFile(compact, 'image/jpeg', 'Zwischenablage.jpg');
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
  const trimmed = plainText.trim();
  if (!trimmed) return null;

  // 1. Check Base64 PDF / Image payload (e.g. from data URI or iOS Shortcut)
  const decodedFile = tryDecodeEmbeddedFileText(trimmed);
  if (decodedFile) {
    return {
      kind: 'files',
      files: [decodedFile],
      suggestedTitle: deriveTitleFromFiles([decodedFile]),
    };
  }

  // 2. Check single HTTP(S) URL (typical result of Safari "Teilen -> Kopieren")
  const singleUrl = isSingleHttpUrl(trimmed);
  if (singleUrl) {
    const isPdfUrl = looksLikeDirectPdfUrl(singleUrl);
    const isImgUrl = looksLikeDirectImageUrl(singleUrl);

    if (isPdfUrl || isImgUrl) {
      const fetched = await tryFetchDirectFileFromUrl(singleUrl);
      if (fetched) {
        return {
          kind: 'files',
          files: [fetched],
          suggestedTitle: deriveTitleFromFiles([fetched]),
          sourceUrl: singleUrl,
        };
      }
    }

    const title = deriveTitleFromUrl(singleUrl, htmlText);
    return {
      kind: 'link',
      url: singleUrl,
      title,
      suggestedTitle: title,
      isPdfUrl,
      corsFetchFailed: isPdfUrl || isImgUrl,
    };
  }

  // 3. Regular text / article excerpt
  return {
    kind: 'text',
    text: trimmed,
    suggestedTitle: deriveTitleFromText(trimmed),
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
        const parsed = await parseClipboardTextPayload(effectiveText, htmlText);
        return { payload: parsed, error: parsed ? undefined : 'empty', foundTypes };
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
      const parsed = await parseClipboardTextPayload(text, '');
      return { payload: parsed, error: parsed ? undefined : 'empty' };
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
