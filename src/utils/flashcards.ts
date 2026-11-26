import type {
  CanvasOcclusionItem,
  CanvasPage,
  FlashcardProgress,
  FlashcardRating,
  Folder,
  ManualFlashcard,
  Note,
  ThemeMode,
} from '../types';
import {
  computePageContentBounds,
  isPaperDark,
  renderFullCanvas,
  renderInfiniteCanvas,
} from './canvasRenderer';

const FLASHCARD_PROGRESS_KEY = 'solid-notes:v1:flashcardProgress';
const DAY_MS = 24 * 60 * 60 * 1000;

export type StudyCardSource = 'canvas' | 'markdown' | 'manual';
export type StudyCardKind = 'occlusion' | 'cloze' | 'basic';
export type StudyCardDirection = 'single' | 'forward' | 'reverse';

export interface ClozeSegment {
  type: 'text' | 'cloze';
  text: string;
  groupKey?: string;
  hint?: string;
}

export interface StudyCard {
  /** Stable deterministic ID for SRS progress tracking */
  cardKey: string;
  noteId: string;
  noteTitle: string;
  folderId: string | null;
  folderPath: string;
  source: StudyCardSource;
  kind: StudyCardKind;
  direction: StudyCardDirection;
  bidirectional: boolean;
  /** Heading or page breadcrumb context */
  contextLabel?: string;
  /** Short single-line summary for card lists & search */
  previewTitle: string;
  previewAnswer: string;
  /** Optional hint shown on front */
  hint?: string;

  // Text / Basic / Cloze payload
  frontMarkdown?: string;
  backMarkdown?: string;
  clozeSegments?: ClozeSegment[];
  activeClozeGroup?: string;

  // Manual card reference (for editing/deleting)
  manualCardId?: string;

  // Canvas Occlusion payload
  pageId?: string;
  pageNumber?: number;
  pageTitle?: string;
  isInfiniteCanvas?: boolean;
  targetOcclusionIds?: string[];
  promptOcclusionIds?: string[];
  pairId?: string;
  groupId?: string;
}

export interface DeckStats {
  total: number;
  due: number;
  newCount: number;
  learning: number;
  mastered: number;
  suspended: number;
}

// ==================== Deterministic Hashing ====================

function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// ==================== Cloze Parser ({{answer}}, {{answer::hint}}, {{1::answer::hint}}, {{c1::answer}}) ====================

const CLOZE_REGEX = /\{\{([^{}]+)\}\}/g;

export interface ParsedClozeLine {
  segments: ClozeSegment[];
  groupOrder: string[];
}

/**
 * Parses `{{...}}` cloze deletions in a text line/paragraph.
 * Supports:
 * - `{{Mitochondrien}}` -> auto-numbered individual spots (`auto-1`, `auto-2`, ...)
 * - `{{Mitochondrien::Zellorganell}}` -> hidden answer + hint
 * - `{{1::A}} ... {{1::B}}` or `{{c1::A}}` -> grouped spots tested together in one card
 * - `{{1::A::Hinweis}}` -> grouped spot with hint
 */
export function parseClozeText(raw: string): ParsedClozeLine | null {
  CLOZE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let autoIdx = 0;
  const segments: ClozeSegment[] = [];
  const groupOrder: string[] = [];
  const seenGroups = new Set<string>();

  while ((match = CLOZE_REGEX.exec(raw)) !== null) {
    const start = match.index;
    const inner = match[1].trim();
    if (!inner) continue;

    if (start > lastIndex) {
      segments.push({ type: 'text', text: raw.slice(lastIndex, start) });
    }

    const parts = inner.split('::');
    let groupKey: string;
    let answerText: string;
    let hint: string | undefined;

    if (parts.length >= 2 && /^(?:c)?(\d+|[a-zA-Z])$/.test(parts[0].trim())) {
      const normalizedGroup = parts[0].trim().replace(/^c/i, '').toUpperCase();
      groupKey = `g${normalizedGroup}`;
      answerText = parts[1].trim();
      hint = parts.slice(2).join('::').trim() || undefined;
    } else if (parts.length >= 2) {
      autoIdx += 1;
      groupKey = `a${autoIdx}`;
      answerText = parts[0].trim();
      hint = parts.slice(1).join('::').trim() || undefined;
    } else {
      autoIdx += 1;
      groupKey = `a${autoIdx}`;
      answerText = inner;
    }

    if (answerText) {
      segments.push({
        type: 'cloze',
        text: answerText,
        groupKey,
        hint,
      });
      if (!seenGroups.has(groupKey)) {
        seenGroups.add(groupKey);
        groupOrder.push(groupKey);
      }
    } else {
      segments.push({ type: 'text', text: match[0] });
    }

    lastIndex = start + match[0].length;
  }

  if (groupOrder.length === 0) return null;
  if (lastIndex < raw.length) {
    segments.push({ type: 'text', text: raw.slice(lastIndex) });
  }

  return { segments, groupOrder };
}

export function buildClozePreviewStrings(
  segments: ClozeSegment[],
  activeGroup: string
): { front: string; answer: string } {
  const answers: string[] = [];
  const frontParts: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      frontParts.push(seg.text);
    } else if (seg.groupKey === activeGroup) {
      answers.push(seg.text);
      frontParts.push(seg.hint ? `[${seg.hint}]` : '[…]');
    } else {
      frontParts.push(seg.text);
    }
  }
  return {
    front: frontParts.join('').replace(/\s+/g, ' ').trim(),
    answer: answers.join(' · '),
  };
}

// ==================== RemNote Markdown Flashcard Parser ====================

interface QaSplitResult {
  left: string;
  right: string;
  op: '>>' | '<<' | '<>' | '::';
}

/**
 * Finds RemNote-style card delimiters outside inline code spans (`...`) and URLs.
 * Priority: `<>` (bidirectional), `>>` (forward), `<<` (reverse), ` :: ` (RemNote concept bidirectional).
 */
export function splitMarkdownQaLine(rawLine: string): QaSplitResult | null {
  // Strip leading bullet / checkbox / blockquote / numbering marker cleanly
  const cleaned = rawLine
    .replace(/^\s*(?:[-*•]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, '')
    .trim();
  if (!cleaned) return null;

  // Mask inline code spans so delimiters inside `code` are ignored
  const maskedChars = cleaned.split('');
  let inCode = false;
  for (let i = 0; i < maskedChars.length; i++) {
    if (maskedChars[i] === '`') {
      inCode = !inCode;
      maskedChars[i] = ' ';
    } else if (inCode) {
      maskedChars[i] = ' ';
    }
  }
  const masked = maskedChars.join('');

  const tryDelimiter = (
    regex: RegExp,
    op: QaSplitResult['op']
  ): QaSplitResult | null => {
    const m = regex.exec(masked);
    if (!m || m.index === undefined) return null;
    const idx = m.index;
    const len = m[0].length;
    const left = cleaned.slice(0, idx).trim();
    const right = cleaned.slice(idx + len).trim();
    if (!left || !right) return null;
    return { left, right, op };
  };

  // Avoid matching `::` inside `{{...}}` cloze syntax by masking clozes when checking `::`
  const qaDelims =
    tryDelimiter(/\s*<>\s*/, '<>') ??
    tryDelimiter(/\s*>>\s*/, '>>') ??
    tryDelimiter(/\s*<<\s*/, '<<');
  if (qaDelims) return qaDelims;

  // RemNote concept/descriptor syntax `Term :: Definition` (requires surrounding spaces so URLs & clozes never falsely match)
  const maskedNoCloze = masked.replace(/\{\{[^{}]+\}\}/g, (s) => ' '.repeat(s.length));
  const mColon = /\s+::\s+/.exec(maskedNoCloze);
  if (mColon && mColon.index !== undefined) {
    const left = cleaned.slice(0, mColon.index).trim();
    const right = cleaned.slice(mColon.index + mColon[0].length).trim();
    if (left && right) {
      return { left, right, op: '::' };
    }
  }

  return null;
}

function stripMarkdownFormatting(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '[Bild]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractMarkdownFlashcards(
  note: Note,
  folderPath: string
): StudyCard[] {
  const content = note.content ?? '';
  if (!content.trim()) return [];

  const cards: StudyCard[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let currentHeading = '';
  const usedKeys = new Map<string, number>();

  const uniqueKey = (base: string): string => {
    const count = usedKeys.get(base) ?? 0;
    usedKeys.set(base, count + 1);
    return count === 0 ? base : `${base}#${count}`;
  };

  const noteTitle = note.title.trim() || 'Unbenannte Notiz';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || !trimmed) continue;

    const headingMatch = line.match(/^#{1,3}\s+(.*)$/);
    if (headingMatch) {
      currentHeading = stripMarkdownFormatting(headingMatch[1]);
      // Still allow clozes inside headings if user explicitly puts {{...}} there
      if (!trimmed.includes('{{')) continue;
    }

    const cleanedLine = line
      .replace(/^\s*(?:[-*•]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s*|#{1,3}\s+)/, '')
      .trim();

    // 1. Check Q&A RemNote syntax (`<>`, `>>`, `<<`, ` :: `)
    const qa = splitMarkdownQaLine(line);
    if (qa) {
      const hash = fnv1aHash(`${qa.op}|${qa.left}|${qa.right}`);
      const leftPlain = stripMarkdownFormatting(qa.left);
      const rightPlain = stripMarkdownFormatting(qa.right);

      if (qa.op === '>>') {
        cards.push({
          cardKey: uniqueKey(`md:${note.id}:${hash}:fwd`),
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'markdown',
          kind: 'basic',
          direction: 'forward',
          bidirectional: false,
          contextLabel: currentHeading || undefined,
          previewTitle: leftPlain,
          previewAnswer: rightPlain,
          frontMarkdown: qa.left,
          backMarkdown: qa.right,
        });
      } else if (qa.op === '<<') {
        cards.push({
          cardKey: uniqueKey(`md:${note.id}:${hash}:rev`),
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'markdown',
          kind: 'basic',
          direction: 'reverse',
          bidirectional: false,
          contextLabel: currentHeading || undefined,
          previewTitle: rightPlain,
          previewAnswer: leftPlain,
          frontMarkdown: qa.right,
          backMarkdown: qa.left,
        });
      } else {
        // Bidirectional (`<>` or ` :: `) -> generates BOTH forward and reverse cards!
        cards.push({
          cardKey: uniqueKey(`md:${note.id}:${hash}:fwd`),
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'markdown',
          kind: 'basic',
          direction: 'forward',
          bidirectional: true,
          contextLabel: currentHeading || undefined,
          previewTitle: leftPlain,
          previewAnswer: rightPlain,
          frontMarkdown: qa.left,
          backMarkdown: qa.right,
        });
        cards.push({
          cardKey: uniqueKey(`md:${note.id}:${hash}:rev`),
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'markdown',
          kind: 'basic',
          direction: 'reverse',
          bidirectional: true,
          contextLabel: currentHeading || undefined,
          previewTitle: rightPlain,
          previewAnswer: leftPlain,
          frontMarkdown: qa.right,
          backMarkdown: qa.left,
        });
      }
      continue;
    }

    // 2. Check Cloze / Stellen verbergen (`{{...}}`)
    if (cleanedLine.includes('{{')) {
      const parsed = parseClozeText(cleanedLine);
      if (parsed) {
        const lineHash = fnv1aHash(cleanedLine);
        for (const groupKey of parsed.groupOrder) {
          const preview = buildClozePreviewStrings(parsed.segments, groupKey);
          const firstHint = parsed.segments.find(
            (s) => s.type === 'cloze' && s.groupKey === groupKey && s.hint
          )?.hint;
          cards.push({
            cardKey: uniqueKey(`md:${note.id}:${lineHash}:${groupKey}`),
            noteId: note.id,
            noteTitle,
            folderId: note.folderId,
            folderPath,
            source: 'markdown',
            kind: 'cloze',
            direction: 'single',
            bidirectional: false,
            contextLabel: currentHeading || undefined,
            previewTitle: stripMarkdownFormatting(preview.front),
            previewAnswer: stripMarkdownFormatting(preview.answer),
            hint: firstHint,
            clozeSegments: parsed.segments,
            activeClozeGroup: groupKey,
          });
        }
      }
    }
  }

  return cards;
}

// ==================== Manual Flashcard Generator ====================

export function extractManualFlashcards(
  note: Note,
  folderPath: string
): StudyCard[] {
  const list = note.flashcards ?? [];
  if (list.length === 0) return [];

  const cards: StudyCard[] = [];
  const noteTitle = note.title.trim() || 'Unbenannte Notiz';

  for (const item of list) {
    if (item.kind === 'cloze') {
      const parsed = parseClozeText(item.front);
      if (!parsed) continue;
      for (const groupKey of parsed.groupOrder) {
        const preview = buildClozePreviewStrings(parsed.segments, groupKey);
        const segHint = parsed.segments.find(
          (s) => s.type === 'cloze' && s.groupKey === groupKey && s.hint
        )?.hint;
        cards.push({
          cardKey: `man:${note.id}:${item.id}:${groupKey}`,
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'manual',
          kind: 'cloze',
          direction: 'single',
          bidirectional: false,
          manualCardId: item.id,
          previewTitle: stripMarkdownFormatting(preview.front),
          previewAnswer: stripMarkdownFormatting(preview.answer),
          hint: segHint || item.hint,
          clozeSegments: parsed.segments,
          activeClozeGroup: groupKey,
        });
      }
    } else {
      const front = item.front.trim();
      const back = item.back.trim();
      if (!front || !back) continue;

      cards.push({
        cardKey: `man:${note.id}:${item.id}:fwd`,
        noteId: note.id,
        noteTitle,
        folderId: note.folderId,
        folderPath,
        source: 'manual',
        kind: 'basic',
        direction: 'forward',
        bidirectional: item.bidirectional,
        manualCardId: item.id,
        previewTitle: stripMarkdownFormatting(front),
        previewAnswer: stripMarkdownFormatting(back),
        hint: item.hint,
        frontMarkdown: front,
        backMarkdown: back,
      });

      if (item.bidirectional) {
        cards.push({
          cardKey: `man:${note.id}:${item.id}:rev`,
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'manual',
          kind: 'basic',
          direction: 'reverse',
          bidirectional: true,
          manualCardId: item.id,
          previewTitle: stripMarkdownFormatting(back),
          previewAnswer: stripMarkdownFormatting(front),
          hint: item.hint,
          frontMarkdown: back,
          backMarkdown: front,
        });
      }
    }
  }

  return cards;
}

// ==================== Canvas Occlusion Flashcard Generator ====================

export function extractCanvasOcclusionFlashcards(
  note: Note,
  folderPath: string,
  defaultCanvasMode: 'pages' | 'infinite' = 'pages'
): StudyCard[] {
  const cards: StudyCard[] = [];
  const noteTitle = note.title.trim() || 'Unbenannte Notiz';
  const isInfinite = (note.settings?.canvasMode ?? defaultCanvasMode) === 'infinite';

  note.pages.forEach((page, pageIdx) => {
    const occlusions = page.occlusions ?? [];
    if (occlusions.length === 0) return;

    const pageLabel = isInfinite ? page.title : `Seite ${pageIdx + 1} · ${page.title}`;
    const handledIds = new Set<string>();

    // 1. Paired occlusions (A ↔ B bidirectional OR A → B directional)
    const pairs = new Map<string, CanvasOcclusionItem[]>();
    for (const occ of occlusions) {
      if (occ.pairId) {
        let arr = pairs.get(occ.pairId);
        if (!arr) {
          arr = [];
          pairs.set(occ.pairId, arr);
        }
        arr.push(occ);
      }
    }

    let pairCounter = 0;
    for (const [pairId, members] of pairs) {
      if (members.length < 2) continue;
      pairCounter += 1;
      const boxA = members.find((m) => m.pairRole === 'a') ?? members[0];
      const boxB = members.find((m) => m.id !== boxA.id) ?? members[1];
      handledIds.add(boxA.id);
      handledIds.add(boxB.id);

      const isBidirectional =
        boxA.bidirectional !== undefined
          ? boxA.bidirectional
          : boxB.bidirectional !== undefined
            ? boxB.bidirectional
            : true;

      const labelA = boxA.label?.trim() || `Stelle ${pairCounter}A`;
      const labelB = boxB.label?.trim() || `Stelle ${pairCounter}B`;

      // Direction A -> B (A given/highlighted, B hidden)
      cards.push({
        cardKey: `occp:${note.id}:${page.id}:${pairId}:ab`,
        noteId: note.id,
        noteTitle,
        folderId: note.folderId,
        folderPath,
        source: 'canvas',
        kind: 'occlusion',
        direction: 'forward',
        bidirectional: isBidirectional,
        contextLabel: pageLabel,
        previewTitle: `${labelA} → ${labelB} (verdeckt)`,
        previewAnswer: `Canvas-Stelle „${labelB}“`,
        hint: boxB.label?.trim() || undefined,
        pageId: page.id,
        pageNumber: pageIdx + 1,
        pageTitle: page.title,
        isInfiniteCanvas: isInfinite,
        promptOcclusionIds: [boxA.id],
        targetOcclusionIds: [boxB.id],
        pairId,
      });

      // Direction B -> A (B given/highlighted, A hidden) when bidirectional
      if (isBidirectional) {
        cards.push({
          cardKey: `occp:${note.id}:${page.id}:${pairId}:ba`,
          noteId: note.id,
          noteTitle,
          folderId: note.folderId,
          folderPath,
          source: 'canvas',
          kind: 'occlusion',
          direction: 'reverse',
          bidirectional: true,
          contextLabel: pageLabel,
          previewTitle: `${labelB} → ${labelA} (verdeckt)`,
          previewAnswer: `Canvas-Stelle „${labelA}“`,
          hint: boxA.label?.trim() || undefined,
          pageId: page.id,
          pageNumber: pageIdx + 1,
          pageTitle: page.title,
          isInfiniteCanvas: isInfinite,
          promptOcclusionIds: [boxB.id],
          targetOcclusionIds: [boxA.id],
          pairId,
        });
      }
    }

    // 2. Grouped occlusions (multiple boxes sharing a groupId tested together in 1 card)
    const groups = new Map<string, CanvasOcclusionItem[]>();
    for (const occ of occlusions) {
      if (handledIds.has(occ.id)) continue;
      if (occ.groupId) {
        let arr = groups.get(occ.groupId);
        if (!arr) {
          arr = [];
          groups.set(occ.groupId, arr);
        }
        arr.push(occ);
        handledIds.add(occ.id);
      }
    }

    for (const [groupId, members] of groups) {
      const labels = members
        .map((m) => m.label?.trim())
        .filter((s): s is string => Boolean(s));
      cards.push({
        cardKey: `occg:${note.id}:${page.id}:${groupId}`,
        noteId: note.id,
        noteTitle,
        folderId: note.folderId,
        folderPath,
        source: 'canvas',
        kind: 'occlusion',
        direction: 'single',
        bidirectional: false,
        contextLabel: pageLabel,
        previewTitle:
          labels.length > 0
            ? `Gruppe ${groupId}: ${labels.join(', ')}`
            : `Gruppe ${groupId} (${members.length} verdeckte Stellen)`,
        previewAnswer: `${members.length} verdeckte Canvas-Stelle${members.length === 1 ? '' : 'n'}`,
        hint: labels.join(' · ') || undefined,
        pageId: page.id,
        pageNumber: pageIdx + 1,
        pageTitle: page.title,
        isInfiniteCanvas: isInfinite,
        targetOcclusionIds: members.map((m) => m.id),
        groupId,
      });
    }

    // 3. Individual single-spot occlusions
    let singleIdx = 0;
    for (const occ of occlusions) {
      if (handledIds.has(occ.id)) continue;
      singleIdx += 1;
      const customLabel = occ.label?.trim();
      cards.push({
        cardKey: `occ:${note.id}:${page.id}:${occ.id}`,
        noteId: note.id,
        noteTitle,
        folderId: note.folderId,
        folderPath,
        source: 'canvas',
        kind: 'occlusion',
        direction: 'single',
        bidirectional: false,
        contextLabel: pageLabel,
        previewTitle: customLabel
          ? `Verdeckte Stelle: ${customLabel}`
          : `Verdeckte Stelle #${singleIdx} (${page.title})`,
        previewAnswer: `Canvas-Ausschnitt auf ${page.title}`,
        hint: customLabel || undefined,
        pageId: page.id,
        pageNumber: pageIdx + 1,
        pageTitle: page.title,
        isInfiniteCanvas: isInfinite,
        targetOcclusionIds: [occ.id],
      });
    }
  });

  return cards;
}

// ==================== Unified Collection & Stats ====================

export function buildFolderPathMap(folders: Folder[]): Map<string, string> {
  const byId = new Map<string, Folder>(folders.map((f) => [f.id, f]));
  const result = new Map<string, string>();

  for (const f of folders) {
    const parts: string[] = [f.name];
    let curr: Folder | undefined = f;
    let guard = 0;
    while (curr?.parentId && guard < 12) {
      const parent = byId.get(curr.parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      curr = parent;
      guard += 1;
    }
    result.set(f.id, parts.join(' / '));
  }
  return result;
}

export function collectNoteStudyCards(
  note: Note,
  folderPath = '',
  defaultCanvasMode: 'pages' | 'infinite' = 'pages'
): StudyCard[] {
  return [
    ...extractCanvasOcclusionFlashcards(note, folderPath, defaultCanvasMode),
    ...extractMarkdownFlashcards(note, folderPath),
    ...extractManualFlashcards(note, folderPath),
  ];
}

export function collectAllStudyCards(
  notes: Note[],
  folders: Folder[],
  defaultCanvasMode: 'pages' | 'infinite' = 'pages'
): StudyCard[] {
  const folderPaths = buildFolderPathMap(folders);
  const all: StudyCard[] = [];
  for (const note of notes) {
    const fPath = note.folderId ? folderPaths.get(note.folderId) ?? '' : '';
    all.push(...collectNoteStudyCards(note, fPath, defaultCanvasMode));
  }
  return all;
}

// ==================== SM-2 Spaced Repetition Scheduler ====================

export function createDefaultProgress(cardKey: string): FlashcardProgress {
  return {
    cardKey,
    dueAt: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    suspended: false,
  };
}

export function isCardDue(
  cardKey: string,
  progressMap: Record<string, FlashcardProgress>,
  now = Date.now()
): boolean {
  const p = progressMap[cardKey];
  if (!p) return true; // New card is ready to study
  if (p.suspended) return false;
  return p.dueAt <= now;
}

export function getCardStatus(
  cardKey: string,
  progressMap: Record<string, FlashcardProgress>,
  now = Date.now()
): 'new' | 'learning' | 'due' | 'mastered' | 'suspended' {
  const p = progressMap[cardKey];
  if (!p || (p.repetitions === 0 && !p.lastReviewedAt)) return 'new';
  if (p.suspended) return 'suspended';
  if (p.intervalDays < 1) return 'learning';
  if (p.dueAt <= now) return 'due';
  return 'mastered';
}

export function computeDeckStats(
  cards: StudyCard[],
  progressMap: Record<string, FlashcardProgress>,
  now = Date.now()
): DeckStats {
  let due = 0;
  let newCount = 0;
  let learning = 0;
  let mastered = 0;
  let suspended = 0;

  for (const c of cards) {
    const status = getCardStatus(c.cardKey, progressMap, now);
    if (status === 'suspended') {
      suspended += 1;
      continue;
    }
    if (status === 'new') {
      newCount += 1;
      due += 1;
    } else if (status === 'learning') {
      learning += 1;
      if (isCardDue(c.cardKey, progressMap, now)) due += 1;
    } else if (status === 'due') {
      due += 1;
    } else {
      mastered += 1;
    }
  }

  return {
    total: cards.length,
    due,
    newCount,
    learning,
    mastered,
    suspended,
  };
}

export function scheduleFlashcardReview(
  prev: FlashcardProgress | undefined,
  cardKey: string,
  rating: FlashcardRating,
  now = Date.now()
): FlashcardProgress {
  const base = prev ? { ...prev } : createDefaultProgress(cardKey);
  const ease = Math.max(1.3, Math.min(3.2, base.easeFactor || 2.5));
  const reps = base.repetitions || 0;
  const interval = base.intervalDays || 0;

  let nextEase = ease;
  let nextReps = reps;
  let nextIntervalDays = interval;
  let nextLapses = base.lapses || 0;
  let dueOffsetMs = 0;

  if (rating === 'again') {
    nextReps = 0;
    nextIntervalDays = 0;
    nextLapses += 1;
    nextEase = Math.max(1.3, ease - 0.2);
    dueOffsetMs = 60 * 1000; // 1 minute
  } else if (rating === 'hard') {
    nextEase = Math.max(1.3, ease - 0.15);
    if (reps === 0) {
      nextReps = 1;
      nextIntervalDays = 10 / (24 * 60); // 10 minutes
      dueOffsetMs = 10 * 60 * 1000;
    } else if (reps === 1) {
      nextReps = 2;
      nextIntervalDays = 1;
      dueOffsetMs = DAY_MS;
    } else {
      nextReps = reps + 1;
      nextIntervalDays = Math.max(1, Math.round(interval * 1.2));
      dueOffsetMs = nextIntervalDays * DAY_MS;
    }
  } else if (rating === 'good') {
    if (reps === 0) {
      nextReps = 1;
      nextIntervalDays = 1;
    } else if (reps === 1) {
      nextReps = 2;
      nextIntervalDays = 3;
    } else {
      nextReps = reps + 1;
      nextIntervalDays = Math.max(interval + 1, Math.round(interval * ease));
    }
    dueOffsetMs = nextIntervalDays * DAY_MS;
  } else {
    // 'easy'
    nextEase = Math.min(3.2, ease + 0.15);
    if (reps === 0) {
      nextReps = 2;
      nextIntervalDays = 4;
    } else if (reps === 1) {
      nextReps = 3;
      nextIntervalDays = 6;
    } else {
      nextReps = reps + 1;
      nextIntervalDays = Math.max(interval + 2, Math.round(interval * ease * 1.3));
    }
    dueOffsetMs = nextIntervalDays * DAY_MS;
  }

  return {
    cardKey,
    dueAt: now + dueOffsetMs,
    intervalDays: nextIntervalDays,
    easeFactor: Number(nextEase.toFixed(2)),
    repetitions: nextReps,
    lapses: nextLapses,
    lastReviewedAt: now,
    suspended: false,
  };
}

export function formatIntervalGerman(intervalDays: number): string {
  if (intervalDays <= 0) return '1 Min.';
  const mins = Math.round(intervalDays * 24 * 60);
  if (mins < 60) return `${Math.max(1, mins)} Min.`;
  const hours = Math.round(intervalDays * 24);
  if (hours < 24) return `${hours} Std.`;
  const days = Math.round(intervalDays);
  if (days === 1) return '1 Tag';
  if (days < 30) return `${days} Tage`;
  const months = Math.round(days / 30);
  if (months === 1) return '1 Monat';
  if (months < 12) return `${months} Mon.`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return years === '1' ? '1 Jahr' : `${years} Jahre`;
}

export function previewRatingIntervals(
  prev: FlashcardProgress | undefined,
  cardKey: string
): Record<FlashcardRating, string> {
  const now = Date.now();
  return {
    again: '< 1 Min.',
    hard: formatIntervalGerman(
      scheduleFlashcardReview(prev, cardKey, 'hard', now).intervalDays
    ),
    good: formatIntervalGerman(
      scheduleFlashcardReview(prev, cardKey, 'good', now).intervalDays
    ),
    easy: formatIntervalGerman(
      scheduleFlashcardReview(prev, cardKey, 'easy', now).intervalDays
    ),
  };
}

// ==================== Persistence ====================

export function normalizeFlashcardProgressMap(
  raw: unknown
): Record<string, FlashcardProgress> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, FlashcardProgress> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    out[key] = {
      cardKey: typeof v.cardKey === 'string' ? v.cardKey : key,
      dueAt: typeof v.dueAt === 'number' && Number.isFinite(v.dueAt) ? v.dueAt : 0,
      intervalDays:
        typeof v.intervalDays === 'number' && Number.isFinite(v.intervalDays)
          ? Math.max(0, v.intervalDays)
          : 0,
      easeFactor:
        typeof v.easeFactor === 'number' && Number.isFinite(v.easeFactor)
          ? Math.max(1.3, Math.min(3.2, v.easeFactor))
          : 2.5,
      repetitions:
        typeof v.repetitions === 'number' && Number.isFinite(v.repetitions)
          ? Math.max(0, Math.round(v.repetitions))
          : 0,
      lapses:
        typeof v.lapses === 'number' && Number.isFinite(v.lapses)
          ? Math.max(0, Math.round(v.lapses))
          : 0,
      lastReviewedAt:
        typeof v.lastReviewedAt === 'number' && Number.isFinite(v.lastReviewedAt)
          ? v.lastReviewedAt
          : undefined,
      suspended: Boolean(v.suspended),
    };
  }
  return out;
}

export function loadFlashcardProgress(): Record<string, FlashcardProgress> {
  try {
    const raw = localStorage.getItem(FLASHCARD_PROGRESS_KEY);
    if (!raw) return {};
    return normalizeFlashcardProgressMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveFlashcardProgress(
  map: Record<string, FlashcardProgress>
): void {
  try {
    localStorage.setItem(FLASHCARD_PROGRESS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage quota
  }
}

// ==================== Canvas Occlusion Study Renderer ====================

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = (hex || '#4f46e5').trim().replace(/^#/, '');
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  }
  return [79, 70, 229];
}

/** Mixes accent hex with a solid light/dark writing surface so the mask is 100% opaque yet super legible to write on! */
function buildOpaqueWritableMaskFill(accentHex: string, darkSurface: boolean): string {
  const [r, g, b] = hexToRgbTuple(accentHex);
  const [bgR, bgG, bgB] = darkSurface ? [24, 28, 42] : [255, 255, 255];
  const mix = darkSurface ? 0.22 : 0.14;
  const outR = Math.round(bgR * (1 - mix) + r * mix);
  const outG = Math.round(bgG * (1 - mix) + g * mix);
  const outB = Math.round(bgB * (1 - mix) + b * mix);
  return `rgb(${outR}, ${outG}, ${outB})`;
}

function drawOcclusionOverlayRect(
  ctx: CanvasRenderingContext2D,
  occ: CanvasOcclusionItem,
  role: 'target-hidden' | 'target-revealed' | 'prompt' | 'other-hidden',
  invScale: number,
  darkSurface: boolean
) {
  const lw = Math.max(1.6, 2.4 * invScale);
  const radius = Math.min(9 * invScale, occ.width * 0.2, occ.height * 0.2);
  const accent = occ.color || '#4f46e5';

  ctx.save();
  if (role === 'target-hidden') {
    // 100% opaque writing-friendly box so users can write their answer directly inside the hidden spot
    drawRoundedRectPath(ctx, occ.x, occ.y, occ.width, occ.height, radius);
    ctx.fillStyle = buildOpaqueWritableMaskFill(accent, darkSurface);
    ctx.fill();

    // Crisp colored outline around the hidden answer box
    ctx.strokeStyle = accent;
    ctx.lineWidth = lw;
    ctx.stroke();

    // Small corner badge (`?` or `? Hinweis`) in top-left so the interior stays clean for handwriting!
    const badgeText = occ.label?.trim() ? `? ${occ.label.trim()}` : '?';
    const badgeFontSize = Math.max(10 * invScale, Math.min(13 * invScale, occ.height * 0.42));
    ctx.font = `700 ${badgeFontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    const padX = 6 * invScale;
    const pillH = Math.min(occ.height - 4 * invScale, badgeFontSize + 6 * invScale);
    const rawW = ctx.measureText(badgeText).width + padX * 2;
    const pillW = Math.min(occ.width - 6 * invScale, Math.max(pillH, rawW));

    if (pillW > 8 * invScale && pillH > 8 * invScale) {
      const px = occ.x + 3 * invScale;
      const py = occ.y + 3 * invScale;
      drawRoundedRectPath(ctx, px, py, pillW, pillH, 5 * invScale);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, px + padX, py + pillH / 2, pillW - padX * 1.5);
    }
  } else if (role === 'target-revealed') {
    // Revealed spot: crystal-clear content underneath with glowing green highlight border
    drawRoundedRectPath(ctx, occ.x, occ.y, occ.width, occ.height, radius);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
    ctx.fill();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = lw * 1.1;
    ctx.setLineDash([6 * invScale, 4 * invScale]);
    ctx.stroke();
  } else if (role === 'prompt') {
    // Visible partner spot in bidirectional pair (Gegeben)
    drawRoundedRectPath(ctx, occ.x, occ.y, occ.width, occ.height, radius);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = lw;
    ctx.stroke();

    // Small pill badge at top-left
    const pillH = 18 * invScale;
    const pillText = occ.label?.trim() ? `Gegeben: ${occ.label.trim()}` : 'Gegeben';
    ctx.font = `600 ${11 * invScale}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`;
    const pillW = Math.min(occ.width + 60 * invScale, ctx.measureText(pillText).width + 12 * invScale);
    const py = Math.max(occ.y - pillH - 4 * invScale, occ.y + 3 * invScale);
    drawRoundedRectPath(ctx, occ.x, py, pillW, pillH, 5 * invScale);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillText, occ.x + 6 * invScale, py + pillH / 2);
  } else {
    // Other unrelated occlusion hidden in "Alle verbergen" mode
    drawRoundedRectPath(ctx, occ.x, occ.y, occ.width, occ.height, radius);
    ctx.fillStyle = darkSurface ? '#252b3b' : '#e2e8f0';
    ctx.fill();
    ctx.strokeStyle = darkSurface ? 'rgba(148, 163, 184, 0.5)' : 'rgba(100, 116, 139, 0.55)';
    ctx.lineWidth = lw * 0.75;
    ctx.stroke();
  }
  ctx.restore();
}

export interface OcclusionStudyViewport {
  camX: number;
  camY: number;
  zoom: number;
}

export interface OcclusionStudyRenderOptions {
  page: CanvasPage;
  theme: ThemeMode;
  isInfinite: boolean;
  targetIds: string[];
  promptIds?: string[];
  revealed: boolean;
  hideOtherOcclusions: boolean;
  viewMode: 'focus' | 'full';
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  onImageLoad?: () => void;
}

/**
 * Computes the exact world-space camera (`camX`, `camY`, `zoom`) used by `renderOcclusionStudyCanvas`.
 * Shared between rendering and direct-on-canvas stylus drawing so strokes align subpixel-accurately!
 */
export function computeOcclusionStudyViewport(
  opts: Pick<
    OcclusionStudyRenderOptions,
    'page' | 'isInfinite' | 'targetIds' | 'promptIds' | 'viewMode' | 'cssWidth' | 'cssHeight'
  >,
  measureCtx: CanvasRenderingContext2D | null = null
): OcclusionStudyViewport {
  const { page, isInfinite, targetIds, promptIds = [], viewMode, cssWidth, cssHeight } = opts;

  const targetSet = new Set(targetIds);
  const promptSet = new Set(promptIds);
  const occlusions = page.occlusions ?? [];
  const relevant = occlusions.filter((o) => targetSet.has(o.id) || promptSet.has(o.id));

  let minX = 0;
  let minY = 0;
  let maxX = page.width;
  let maxY = page.height;

  if (viewMode === 'focus' && relevant.length > 0) {
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    for (const o of relevant) {
      if (o.x < rMinX) rMinX = o.x;
      if (o.y < rMinY) rMinY = o.y;
      if (o.x + o.width > rMaxX) rMaxX = o.x + o.width;
      if (o.y + o.height > rMaxY) rMaxY = o.y + o.height;
    }
    const spanW = Math.max(120, rMaxX - rMinX);
    const spanH = Math.max(90, rMaxY - rMinY);
    const padX = Math.max(140, spanW * 0.7);
    const padY = Math.max(120, spanH * 0.8);

    minX = rMinX - padX;
    minY = rMinY - padY;
    maxX = rMaxX + padX;
    maxY = rMaxY + padY;

    if (!isInfinite) {
      minX = Math.max(0, minX);
      minY = Math.max(0, minY);
      maxX = Math.min(page.width, maxX);
      maxY = Math.min(page.height, maxY);
      if (maxX - minX < 360) {
        const cx = (minX + maxX) / 2;
        minX = Math.max(0, cx - 180);
        maxX = Math.min(page.width, minX + 360);
      }
      if (maxY - minY < 260) {
        const cy = (minY + maxY) / 2;
        minY = Math.max(0, cy - 130);
        maxY = Math.min(page.height, minY + 260);
      }
    }
  } else if (isInfinite) {
    const content = computePageContentBounds(page, measureCtx);
    let bMinX = content ? content.minX : Infinity;
    let bMinY = content ? content.minY : Infinity;
    let bMaxX = content ? content.maxX : -Infinity;
    let bMaxY = content ? content.maxY : -Infinity;
    for (const o of occlusions) {
      if (o.x < bMinX) bMinX = o.x;
      if (o.y < bMinY) bMinY = o.y;
      if (o.x + o.width > bMaxX) bMaxX = o.x + o.width;
      if (o.y + o.height > bMaxY) bMaxY = o.y + o.height;
    }
    if (Number.isFinite(bMinX) && Number.isFinite(bMaxX)) {
      minX = bMinX - 80;
      minY = bMinY - 80;
      maxX = bMaxX + 80;
      maxY = bMaxY + 80;
    } else {
      minX = 0;
      minY = 0;
      maxX = 800;
      maxY = 600;
    }
  }

  const worldW = Math.max(120, maxX - minX);
  const worldH = Math.max(100, maxY - minY);
  const zoom = Math.min(cssWidth / worldW, cssHeight / worldH);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    camX: centerX - cssWidth / (2 * zoom),
    camY: centerY - cssHeight / (2 * zoom),
    zoom,
  };
}

/**
 * Renders a crisp HiDPI canvas preview of an occlusion flashcard into the provided canvas context.
 * Automatically frames the occluded region (with generous surrounding context) or shows the full page.
 * Returns the computed world-space viewport so interactive drawing overlays align exactly.
 */
export function renderOcclusionStudyCanvas(
  ctx: CanvasRenderingContext2D,
  opts: OcclusionStudyRenderOptions
): OcclusionStudyViewport {
  const {
    page,
    theme,
    isInfinite,
    targetIds,
    promptIds = [],
    revealed,
    hideOtherOcclusions,
    cssWidth,
    cssHeight,
    dpr,
    onImageLoad,
  } = opts;

  const targetSet = new Set(targetIds);
  const promptSet = new Set(promptIds);
  const occlusions = page.occlusions ?? [];
  const vp = computeOcclusionStudyViewport(opts, ctx);
  const { camX, camY, zoom } = vp;
  const darkSurface = isPaperDark(page.paperConfig, theme);

  ctx.save();
  ctx.clearRect(0, 0, Math.ceil(cssWidth * dpr), Math.ceil(cssHeight * dpr));

  if (isInfinite) {
    renderInfiniteCanvas(
      ctx,
      page,
      cssWidth,
      cssHeight,
      { x: camX, y: camY, zoom },
      theme,
      dpr,
      { onImageLoad }
    );
  } else {
    // Draw clean background outside page boundaries
    ctx.fillStyle = theme === 'dark' ? '#0f131c' : '#e8edf5';
    ctx.fillRect(0, 0, Math.ceil(cssWidth * dpr), Math.ceil(cssHeight * dpr));

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(-camX * zoom, -camY * zoom);
    renderFullCanvas(ctx, page, null, theme, zoom, { onImageLoad });
    ctx.restore();
  }

  // Now render occlusion masks & bidirectional connector in exact world coordinates
  ctx.save();
  ctx.scale(dpr * zoom, dpr * zoom);
  ctx.translate(-camX, -camY);

  const invScale = 1 / Math.max(0.3, zoom);

  // Dashed connector line between paired A <-> B spots
  if (promptSet.size > 0 && targetSet.size > 0) {
    const promptBox = occlusions.find((o) => promptSet.has(o.id));
    const targetBox = occlusions.find((o) => targetSet.has(o.id));
    if (promptBox && targetBox) {
      const ax = promptBox.x + promptBox.width / 2;
      const ay = promptBox.y + promptBox.height / 2;
      const bx = targetBox.x + targetBox.width / 2;
      const by = targetBox.y + targetBox.height / 2;
      ctx.save();
      ctx.strokeStyle = revealed ? 'rgba(16, 185, 129, 0.7)' : 'rgba(79, 70, 229, 0.65)';
      ctx.lineWidth = 2.2 * invScale;
      ctx.setLineDash([7 * invScale, 5 * invScale]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Draw non-target masks first, then prompt, then target on top
  for (const occ of occlusions) {
    if (targetSet.has(occ.id) || promptSet.has(occ.id)) continue;
    if (hideOtherOcclusions) {
      drawOcclusionOverlayRect(ctx, occ, 'other-hidden', invScale, darkSurface);
    }
  }
  for (const occ of occlusions) {
    if (promptSet.has(occ.id)) {
      drawOcclusionOverlayRect(ctx, occ, 'prompt', invScale, darkSurface);
    }
  }
  for (const occ of occlusions) {
    if (targetSet.has(occ.id)) {
      drawOcclusionOverlayRect(
        ctx,
        occ,
        revealed ? 'target-revealed' : 'target-hidden',
        invScale,
        darkSurface
      );
    }
  }

  ctx.restore();
  ctx.restore();
  return vp;
}
