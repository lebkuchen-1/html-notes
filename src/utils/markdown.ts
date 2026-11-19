import type { NoteImageAttachment } from '../types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveSafeImageUrl(
  rawUrl: string,
  attachmentMap: Map<string, NoteImageAttachment>
): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('note-img://')) {
    const id = trimmed.slice('note-img://'.length);
    const found = attachmentMap.get(id);
    return found ? found.src : null;
  }
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/')
  ) {
    return trimmed;
  }
  return null;
}

function formatInline(
  raw: string,
  attachmentMap: Map<string, NoteImageAttachment>
): string {
  // Extract markdown images first so their URLs don't get mangled by emphasis/code regexes
  const imagePlaceholders: string[] = [];
  const withPlaceholders = raw.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (full, alt: string, url: string) => {
      const resolved = resolveSafeImageUrl(url, attachmentMap);
      if (!resolved) return full;
      const idx = imagePlaceholders.length;
      const safeAlt = escapeHtml(alt || 'Bild');
      const safeSrc = escapeHtml(resolved);
      imagePlaceholders.push(
        `<figure class="md-image-figure"><img src="${safeSrc}" alt="${safeAlt}" loading="lazy" />${
          alt.trim() ? `<figcaption>${safeAlt}</figcaption>` : ''
        }</figure>`
      );
      return `\u0000IMG${idx}\u0000`;
    }
  );

  let s = escapeHtml(withPlaceholders);
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold + italic
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Strikethrough
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Restore image HTML
  s = s.replace(/\u0000IMG(\d+)\u0000/g, (_m, i: string) => imagePlaceholders[Number(i)] ?? '');
  return s;
}

/**
 * Lightweight, XSS-safe Markdown renderer with interactive task-list checkboxes and image support.
 */
export function renderMarkdown(
  source: string,
  attachments: NoteImageAttachment[] = []
): string {
  const attachmentMap = new Map<string, NoteImageAttachment>();
  for (const att of attachments) {
    attachmentMap.set(att.id, att);
  }

  const lines = source.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let inList: 'ul' | 'ol' | 'task' | null = null;

  const closeList = () => {
    if (inList === 'ol') out.push('</ol>');
    else if (inList) out.push('</ul>');
    inList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      closeList();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      closeList();
      continue;
    }

    if (/^([-*_]){3,}$/.test(trimmed)) {
      closeList();
      out.push('<hr />');
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      out.push(`<h${level}>${formatInline(headingMatch[2], attachmentMap)}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      closeList();
      out.push(`<blockquote>${formatInline(quoteMatch[1], attachmentMap)}</blockquote>`);
      continue;
    }

    const taskMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (taskMatch) {
      if (inList !== 'task') {
        closeList();
        out.push('<ul class="md-task-list">');
        inList = 'task';
      }
      const checked = taskMatch[1].toLowerCase() === 'x';
      out.push(
        `<li class="md-task-item${checked ? ' is-checked' : ''}">` +
          `<label>` +
          `<input type="checkbox" data-line-index="${i}"${checked ? ' checked' : ''} />` +
          `<span>${formatInline(taskMatch[2], attachmentMap)}</span>` +
          `</label>` +
          `</li>`
      );
      continue;
    }

    const ulMatch = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ulMatch) {
      if (inList !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = 'ul';
      }
      out.push(`<li>${formatInline(ulMatch[1], attachmentMap)}</li>`);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      if (inList !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${formatInline(olMatch[1], attachmentMap)}</li>`);
      continue;
    }

    closeList();
    // Standalone image line shouldn't be wrapped in <p>
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(trimmed)) {
      out.push(formatInline(trimmed, attachmentMap));
    } else {
      out.push(`<p>${formatInline(line, attachmentMap)}</p>`);
    }
  }

  if (inCodeBlock) {
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  closeList();

  return out.join('\n');
}

export function toggleCheckboxAtLine(source: string, lineIndex: number): string {
  const lines = source.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return source;
  const line = lines[lineIndex];
  if (/^\s*[-*]\s+\[ \]/.test(line)) {
    lines[lineIndex] = line.replace(/\[ \]/, '[x]');
  } else if (/^\s*[-*]\s+\[[xX]\]/.test(line)) {
    lines[lineIndex] = line.replace(/\[[xX]\]/, '[ ]');
  }
  return lines.join('\n');
}
