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
  attachmentMap: Map<string, NoteImageAttachment>,
  options?: { renderFlashcardSyntax?: boolean }
): string {
  const renderFlashcards = options?.renderFlashcardSyntax !== false;
  // Extract markdown images first so their URLs don't get mangled by emphasis/code regexes
  const placeholders: string[] = [];
  let withPlaceholders = raw.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (full, alt: string, url: string) => {
      const resolved = resolveSafeImageUrl(url, attachmentMap);
      if (!resolved) return full;
      const idx = placeholders.length;
      const safeAlt = escapeHtml(alt || 'Bild');
      const safeSrc = escapeHtml(resolved);
      placeholders.push(
        `<figure class="md-image-figure"><img src="${safeSrc}" alt="${safeAlt}" loading="lazy" />${
          alt.trim() ? `<figcaption>${safeAlt}</figcaption>` : ''
        }</figure>`
      );
      return `\u0000PH${idx}\u0000`;
    }
  );

  // Extract inline code before flashcard syntax so `{{code}}` or `a >> b` stays untouched
  withPlaceholders = withPlaceholders.replace(/`([^`]+)`/g, (_full, code: string) => {
    const idx = placeholders.length;
    placeholders.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000PH${idx}\u0000`;
  });

  // Render RemNote-style cloze deletions (`{{Antwort}}`, `{{Antwort::Hinweis}}`, `{{1::Antwort}}`)
  if (renderFlashcards) {
    withPlaceholders = withPlaceholders.replace(
      /\{\{([^{}]+)\}\}/g,
      (_full, inner: string) => {
        const trimmed = inner.trim();
        if (!trimmed) return _full;
        const parts = trimmed.split('::');
        let groupBadge = '';
        let answer = trimmed;
        let hint = '';
        if (parts.length >= 2 && /^(?:c)?(\d+|[a-zA-Z])$/.test(parts[0].trim())) {
          groupBadge = parts[0].trim().replace(/^c/i, '').toUpperCase();
          answer = parts[1].trim();
          hint = parts.slice(2).join('::').trim();
        } else if (parts.length >= 2) {
          answer = parts[0].trim();
          hint = parts.slice(1).join('::').trim();
        }
        const idx = placeholders.length;
        const safeAnswer = escapeHtml(answer);
        const maskText = escapeHtml(hint || '•••');
        const badgeHtml = groupBadge
          ? `<span class="md-cloze-group">${escapeHtml(groupBadge)}</span>`
          : '';
        placeholders.push(
          `<button type="button" class="md-cloze-pill" title="Tippen zum Aufdecken / Verbergen">` +
            `${badgeHtml}` +
            `<span class="md-cloze-mask">${maskText}</span>` +
            `<span class="md-cloze-answer">${safeAnswer}</span>` +
            `</button>`
        );
        return `\u0000PH${idx}\u0000`;
      }
    );

    // Render RemNote-style card arrows (`<>`, `>>`, `<<`, ` :: `) cleanly as badges
    withPlaceholders = withPlaceholders
      .replace(/\s*<>\s*/g, () => {
        const idx = placeholders.length;
        placeholders.push(
          ` <span class="md-card-arrow is-bi" title="Beidseitige Karteikarte (Vorderseite ↔ Rückseite)">↔</span> `
        );
        return `\u0000PH${idx}\u0000`;
      })
      .replace(/\s*>>\s*/g, () => {
        const idx = placeholders.length;
        placeholders.push(
          ` <span class="md-card-arrow" title="Einseitige Karteikarte (Vorderseite → Rückseite)">→</span> `
        );
        return `\u0000PH${idx}\u0000`;
      })
      .replace(/\s*<<\s*/g, () => {
        const idx = placeholders.length;
        placeholders.push(
          ` <span class="md-card-arrow" title="Rückwärts-Karteikarte">←</span> `
        );
        return `\u0000PH${idx}\u0000`;
      })
      .replace(/\s+::\s+/g, () => {
        const idx = placeholders.length;
        placeholders.push(
          ` <span class="md-card-arrow is-bi" title="Beidseitige Karteikarte (RemNote ::)">↔</span> `
        );
        return `\u0000PH${idx}\u0000`;
      });
  }

  let s = escapeHtml(withPlaceholders);
  // Bold + italic
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Strikethrough
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Restore placeholders (images, inline code, cloze pills, card arrows)
  s = s.replace(/\u0000PH(\d+)\u0000/g, (_m, i: string) => placeholders[Number(i)] ?? '');
  return s;
}

/**
 * Renders inline Markdown formatting (bold, italic, code, images) without flashcard-arrow rewriting.
 * Used by the Flashcards study view so cards can contain Markdown & note images cleanly.
 */
export function renderInlineMarkdown(
  source: string,
  attachments: NoteImageAttachment[] = []
): string {
  const attachmentMap = new Map<string, NoteImageAttachment>();
  for (const att of attachments) {
    attachmentMap.set(att.id, att);
  }
  return source
    .split('\n')
    .map((line) => formatInline(line, attachmentMap, { renderFlashcardSyntax: false }))
    .join('<br />');
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
