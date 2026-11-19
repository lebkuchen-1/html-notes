import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_PAPER_CONFIG,
  FOLDER_COLORS,
  MAX_PAGE_HEIGHT,
  MAX_PAGE_WIDTH,
  MIN_PAGE_DIMENSION,
  PAGE_SIZE_PRESETS,
  type AppSettings,
  type CanvasFontFamily,
  type CanvasImageItem,
  type CanvasPage,
  type CanvasTextItem,
  type EditorFontFamily,
  type Folder,
  type Note,
  type NoteImageAttachment,
  type NoteLocalSettings,
  type PageBackgroundImage,
  type PalmSensitivity,
  type PaperConfig,
  type PaperPattern,
  type StabilizationLevel,
  type Stroke,
  type ThemeMode,
  type ViewMode,
} from '../types';

const STORAGE_KEYS = {
  NOTES: 'solid-notes:v1:notes',
  FOLDERS: 'solid-notes:v1:folders',
  THEME: 'solid-notes:v1:theme',
  VIEW_MODE: 'solid-notes:v1:viewMode',
  ACTIVE_ID: 'solid-notes:v1:activeId',
  OPEN_TABS: 'solid-notes:v1:openTabs',
  SCREEN: 'solid-notes:v1:screen',
  SETTINGS: 'solid-notes:v1:settings',
} as const;

export interface PaperPreset {
  id: string;
  label: string;
  config: Partial<PaperConfig>;
  previewBg: string;
  previewLine: string;
}

export const PAPER_PRESETS: PaperPreset[] = [
  {
    id: 'cream',
    label: 'Warmes Papier',
    previewBg: '#fcf9f2',
    previewLine: '#b4a58c',
    config: {
      backgroundColor: '#fcf9f2',
      lineColor: '#9c8c74',
      lineOpacity: 0.24,
    },
  },
  {
    id: 'white',
    label: 'Reinweiß',
    previewBg: '#ffffff',
    previewLine: '#94a3b8',
    config: {
      backgroundColor: '#ffffff',
      lineColor: '#64748b',
      lineOpacity: 0.2,
    },
  },
  {
    id: 'legal',
    label: 'Notizblock Gelb',
    previewBg: '#fef9db',
    previewLine: '#60a5fa',
    config: {
      backgroundColor: '#fef9db',
      lineColor: '#3b82f6',
      lineOpacity: 0.28,
      pattern: 'lined',
      showMargin: true,
    },
  },
  {
    id: 'sky',
    label: 'Himmelblau',
    previewBg: '#f0f7ff',
    previewLine: '#60a5fa',
    config: {
      backgroundColor: '#f0f7ff',
      lineColor: '#3b82f6',
      lineOpacity: 0.22,
    },
  },
  {
    id: 'mint',
    label: 'Salbei',
    previewBg: '#f1f9f4',
    previewLine: '#34d399',
    config: {
      backgroundColor: '#f1f9f4',
      lineColor: '#059669',
      lineOpacity: 0.22,
    },
  },
  {
    id: 'lavender',
    label: 'Lavendel',
    previewBg: '#f6f3ff',
    previewLine: '#8b5cf6',
    config: {
      backgroundColor: '#f6f3ff',
      lineColor: '#7c3aed',
      lineOpacity: 0.2,
    },
  },
  {
    id: 'blueprint',
    label: 'Blaupause',
    previewBg: '#163a6b',
    previewLine: '#93c5fd',
    config: {
      backgroundColor: '#163a6b',
      lineColor: '#93c5fd',
      lineOpacity: 0.26,
      pattern: 'grid',
      showMargin: false,
    },
  },
  {
    id: 'chalkboard',
    label: 'Tafelgrün',
    previewBg: '#1c3329',
    previewLine: '#cbd5e1',
    config: {
      backgroundColor: '#1c3329',
      lineColor: '#e2e8f0',
      lineOpacity: 0.18,
    },
  },
  {
    id: 'slate',
    label: 'Nachtschiefer',
    previewBg: '#181c26',
    previewLine: '#94a3b8',
    config: {
      backgroundColor: '#181c26',
      lineColor: '#94a3b8',
      lineOpacity: 0.22,
    },
  },
];

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clampPageWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_CANVAS_WIDTH;
  return Math.max(MIN_PAGE_DIMENSION, Math.min(MAX_PAGE_WIDTH, Math.round(width)));
}

export function clampPageHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_CANVAS_HEIGHT;
  return Math.max(MIN_PAGE_DIMENSION, Math.min(MAX_PAGE_HEIGHT, Math.round(height)));
}

export function createCanvasPage(options?: {
  title?: string;
  width?: number;
  height?: number;
  paperConfig?: Partial<PaperConfig>;
}): CanvasPage {
  return {
    id: generateId(),
    title: options?.title ?? 'Seite 1',
    width: clampPageWidth(options?.width ?? DEFAULT_CANVAS_WIDTH),
    height: clampPageHeight(options?.height ?? DEFAULT_CANVAS_HEIGHT),
    strokes: [],
    texts: [],
    images: [],
    paperConfig: {
      ...DEFAULT_PAPER_CONFIG,
      ...(options?.paperConfig ?? {}),
    },
  };
}

function createSamplePage1(): CanvasPage {
  const wavePoints = [];
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    const x = 86 + t * 620;
    const y = 410 + Math.sin(t * Math.PI * 4) * 22;
    const pressure = 0.35 + Math.sin(t * Math.PI) * 0.55;
    wavePoints.push({ x, y, pressure });
  }

  return {
    id: generateId(),
    title: 'A4 Skizze',
    width: 794,
    height: 1123,
    paperConfig: {
      ...DEFAULT_PAPER_CONFIG,
      pattern: 'grid',
      backgroundColor: '#fcf9f2',
      lineColor: '#9c8c74',
      spacing: 34,
      lineOpacity: 0.24,
      showMargin: false,
    },
    strokes: [
      {
        id: 'sample-hl-1',
        tool: 'highlighter',
        color: '#fde047',
        width: 28,
        opacity: 0.42,
        points: [
          { x: 84, y: 110, pressure: 0.5 },
          { x: 470, y: 110, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-rect-1',
        tool: 'rect',
        color: '#4f46e5',
        width: 3.2,
        opacity: 1,
        points: [
          { x: 84, y: 185, pressure: 0.5 },
          { x: 304, y: 295, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-arrow-1',
        tool: 'arrow',
        color: 'auto',
        width: 3,
        opacity: 1,
        points: [
          { x: 326, y: 240, pressure: 0.5 },
          { x: 468, y: 240, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-ellipse-1',
        tool: 'ellipse',
        color: '#059669',
        width: 3.2,
        opacity: 1,
        points: [
          { x: 488, y: 180, pressure: 0.5 },
          { x: 710, y: 300, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-wave-1',
        tool: 'pen',
        color: '#ea580c',
        width: 4.4,
        opacity: 1,
        points: wavePoints,
      },
    ],
    texts: [
      {
        id: 'sample-text-1',
        x: 88,
        y: 94,
        text: 'Skizzen & Text direkt auf dem Canvas',
        color: 'auto',
        fontSize: 24,
        fontFamily: 'sans',
        bold: true,
      },
      {
        id: 'sample-text-2',
        x: 124,
        y: 226,
        text: 'Texteingabe',
        color: '#4f46e5',
        fontSize: 22,
        fontFamily: 'sans',
        bold: true,
      },
      {
        id: 'sample-text-3',
        x: 534,
        y: 226,
        text: 'Stift & Form',
        color: '#059669',
        fontSize: 22,
        fontFamily: 'sans',
        bold: true,
      },
      {
        id: 'sample-text-4',
        x: 88,
        y: 478,
        text: 'Diese Seite hat A4-Hochformat (794 × 1123 px).\nÖffne oben „Seiten“ für die Seitenübersicht mit Seite 2 (16:9 Whiteboard)!',
        color: 'auto',
        fontSize: 18,
        fontFamily: 'sans',
        bold: false,
      },
    ],
    images: [],
  };
}

function createSamplePage2(): CanvasPage {
  return {
    id: generateId(),
    title: '16:9 Whiteboard',
    width: 1280,
    height: 720,
    paperConfig: {
      pattern: 'grid',
      backgroundColor: '#f0f7ff',
      lineColor: '#3b82f6',
      spacing: 36,
      lineOpacity: 0.2,
      showMargin: false,
    },
    strokes: [
      {
        id: 'sample-p2-r1',
        tool: 'rect',
        color: '#2563eb',
        width: 3,
        opacity: 1,
        points: [
          { x: 110, y: 240, pressure: 0.5 },
          { x: 370, y: 420, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-p2-a1',
        tool: 'arrow',
        color: 'auto',
        width: 3,
        opacity: 1,
        points: [
          { x: 390, y: 330, pressure: 0.5 },
          { x: 490, y: 330, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-p2-r2',
        tool: 'rect',
        color: '#4f46e5',
        width: 3,
        opacity: 1,
        points: [
          { x: 510, y: 240, pressure: 0.5 },
          { x: 770, y: 420, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-p2-a2',
        tool: 'arrow',
        color: 'auto',
        width: 3,
        opacity: 1,
        points: [
          { x: 790, y: 330, pressure: 0.5 },
          { x: 890, y: 330, pressure: 0.5 },
        ],
      },
      {
        id: 'sample-p2-r3',
        tool: 'rect',
        color: '#059669',
        width: 3,
        opacity: 1,
        points: [
          { x: 910, y: 240, pressure: 0.5 },
          { x: 1170, y: 420, pressure: 0.5 },
        ],
      },
    ],
    texts: [
      {
        id: 'sample-p2-t0',
        x: 110,
        y: 110,
        text: 'Seite 2: Individuelles Querformat (1280 × 720 px)',
        color: 'auto',
        fontSize: 30,
        fontFamily: 'sans',
        bold: true,
      },
      {
        id: 'sample-p2-t1',
        x: 185,
        y: 315,
        text: '1. Idee',
        color: '#2563eb',
        fontSize: 26,
        fontFamily: 'sans',
        bold: true,
      },
      {
        id: 'sample-p2-t2',
        x: 565,
        y: 315,
        text: '2. Entwurf',
        color: '#4f46e5',
        fontSize: 26,
        fontFamily: 'sans',
        bold: true,
      },
      {
        id: 'sample-p2-t3',
        x: 975,
        y: 315,
        text: '3. Fertig',
        color: '#059669',
        fontSize: 26,
        fontFamily: 'sans',
        bold: true,
      },
    ],
    images: [],
  };
}

function normalizePaperConfig(rawPage: Record<string, unknown> | undefined): PaperConfig {
  const validPatterns: PaperPattern[] = ['blank', 'lined', 'grid', 'dots'];
  const rawCfg = (rawPage?.paperConfig ?? {}) as Partial<PaperConfig>;
  const legacyPaper = rawPage?.paper as PaperPattern | undefined;

  const pattern: PaperPattern =
    rawCfg.pattern && validPatterns.includes(rawCfg.pattern)
      ? rawCfg.pattern
      : legacyPaper && validPatterns.includes(legacyPaper)
        ? legacyPaper
        : DEFAULT_PAPER_CONFIG.pattern;

  return {
    pattern,
    backgroundColor:
      typeof rawCfg.backgroundColor === 'string' && rawCfg.backgroundColor.length > 0
        ? rawCfg.backgroundColor
        : DEFAULT_PAPER_CONFIG.backgroundColor,
    lineColor:
      typeof rawCfg.lineColor === 'string' && rawCfg.lineColor.length > 0
        ? rawCfg.lineColor
        : DEFAULT_PAPER_CONFIG.lineColor,
    spacing:
      typeof rawCfg.spacing === 'number' && rawCfg.spacing >= 16 && rawCfg.spacing <= 96
        ? rawCfg.spacing
        : DEFAULT_PAPER_CONFIG.spacing,
    lineOpacity:
      typeof rawCfg.lineOpacity === 'number' &&
      rawCfg.lineOpacity >= 0.05 &&
      rawCfg.lineOpacity <= 0.9
        ? rawCfg.lineOpacity
        : DEFAULT_PAPER_CONFIG.lineOpacity,
    showMargin:
      typeof rawCfg.showMargin === 'boolean'
        ? rawCfg.showMargin
        : pattern === 'lined',
  };
}

function normalizeTexts(rawPage: Record<string, unknown> | undefined): CanvasTextItem[] {
  const rawTexts = rawPage?.texts;
  if (!Array.isArray(rawTexts)) return [];
  return rawTexts
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
    .map((t) => ({
      id: typeof t.id === 'string' ? t.id : generateId(),
      x: typeof t.x === 'number' ? t.x : 80,
      y: typeof t.y === 'number' ? t.y : 80,
      text: typeof t.text === 'string' ? t.text : '',
      color: typeof t.color === 'string' ? t.color : 'auto',
      fontSize: typeof t.fontSize === 'number' ? t.fontSize : 24,
      fontFamily: (t.fontFamily === 'serif' ||
      t.fontFamily === 'mono' ||
      t.fontFamily === 'hand' ||
      t.fontFamily === 'sans'
        ? t.fontFamily
        : 'sans') as CanvasFontFamily,
      bold: Boolean(t.bold),
    }))
    .filter((t) => t.text.trim().length > 0);
}

function normalizeImages(rawPage: Record<string, unknown> | undefined): CanvasImageItem[] {
  const rawImages = rawPage?.images;
  if (!Array.isArray(rawImages)) return [];
  return rawImages
    .filter((img): img is Record<string, unknown> => Boolean(img && typeof img === 'object'))
    .map((img) => ({
      id: typeof img.id === 'string' ? img.id : generateId(),
      src: typeof img.src === 'string' ? img.src : '',
      name: typeof img.name === 'string' ? img.name : 'Bild',
      x: typeof img.x === 'number' ? img.x : 80,
      y: typeof img.y === 'number' ? img.y : 80,
      width: typeof img.width === 'number' && img.width > 10 ? img.width : 320,
      height: typeof img.height === 'number' && img.height > 10 ? img.height : 240,
      naturalWidth: typeof img.naturalWidth === 'number' ? img.naturalWidth : 320,
      naturalHeight: typeof img.naturalHeight === 'number' ? img.naturalHeight : 240,
      opacity:
        typeof img.opacity === 'number' && img.opacity >= 0.05 && img.opacity <= 1
          ? img.opacity
          : 1,
    }))
    .filter((img) => img.src.length > 0);
}

function normalizePage(rawPage: Record<string, unknown>, index: number): CanvasPage {
  const rawWidth =
    typeof rawPage.width === 'number'
      ? rawPage.width
      : typeof rawPage.logicalWidth === 'number'
        ? rawPage.logicalWidth
        : DEFAULT_CANVAS_WIDTH;
  const rawHeight =
    typeof rawPage.height === 'number'
      ? rawPage.height
      : typeof rawPage.logicalHeight === 'number'
        ? rawPage.logicalHeight
        : DEFAULT_CANVAS_HEIGHT;

  const rawBg = rawPage.backgroundImage as Record<string, unknown> | null | undefined;
  const backgroundImage: PageBackgroundImage | null =
    rawBg && typeof rawBg === 'object' && typeof rawBg.src === 'string' && rawBg.src.length > 0
      ? {
          src: rawBg.src,
          name: typeof rawBg.name === 'string' ? rawBg.name : 'Hintergrund',
          sourceType: rawBg.sourceType === 'pdf' ? 'pdf' : 'image',
          pageNumber: typeof rawBg.pageNumber === 'number' ? rawBg.pageNumber : undefined,
          opacity:
            typeof rawBg.opacity === 'number' && rawBg.opacity >= 0.05 && rawBg.opacity <= 1
              ? rawBg.opacity
              : 1,
        }
      : null;

  return {
    id: typeof rawPage.id === 'string' ? rawPage.id : generateId(),
    title:
      typeof rawPage.title === 'string' && rawPage.title.trim().length > 0
        ? rawPage.title
        : `Seite ${index + 1}`,
    width: clampPageWidth(rawWidth),
    height: clampPageHeight(rawHeight),
    strokes: Array.isArray(rawPage.strokes) ? (rawPage.strokes as Stroke[]) : [],
    texts: normalizeTexts(rawPage),
    images: normalizeImages(rawPage),
    paperConfig: normalizePaperConfig(rawPage),
    backgroundImage,
  };
}

function normalizeAttachments(raw: Record<string, unknown>): NoteImageAttachment[] {
  const rawAtt = raw.attachments;
  if (!Array.isArray(rawAtt)) return [];
  return rawAtt
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : generateId(),
      name: typeof a.name === 'string' ? a.name : 'Bild',
      src: typeof a.src === 'string' ? a.src : '',
    }))
    .filter((a) => a.src.length > 0);
}

export function createWelcomeNote(folderId: string | null = null): Note {
  const now = Date.now();
  const page1 = createSamplePage1();
  const page2 = createSamplePage2();

  return {
    id: generateId(),
    title: 'Willkommen bei Notizblock',
    content: `# Text, Stift & Individuelle Seiten

Schreibe strukturierte **Markdown-Notizen** auf der linken Seite und arbeite rechts auf beliebig vielen **individuellen Canvas-Seiten**.

## Funktionen im Überblick

- [x] **Individuelle Seitengrößen**: Jede Seite hat ihre eigene Breite & Höhe (z. B. A4 Hochformat + 16:9 Whiteboard in derselben Notiz)
- [x] **Seitenübersicht & Kontinuierliche Sicht**: Alle Seiten untereinander scrollen oder in der Übersicht verwalten
- [x] **Notiz-Tabs & Ordner**: Mehrere Notizen in Tabs öffnen und in Ordnern (auch verschachtelt) organisieren
- [x] **Stifteingabe, Text & Bilder** direkt auf dem Canvas (inkl. Drag & Drop und \`Strg+V\`)
- [x] **Konfigurierbarer Hintergrund** pro Seite (Farbe, Zeilen, Kästchen, Punkte, Randlinie)
- [ ] Eigene Seite als **PNG** exportieren

> Tipp: Ziehe eine Notiz in der Seitenleiste einfach auf einen **Ordner**, um sie einzusortieren.`,
    tags: ['Start', 'Anleitung'],
    pinned: true,
    folderId,
    attachments: [],
    pages: [page1, page2],
    activePageId: page1.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyNote(title = '', folderId: string | null = null): Note {
  const now = Date.now();
  const firstPage = createCanvasPage({ title: 'Seite 1' });
  return {
    id: generateId(),
    title,
    content: '',
    tags: [],
    pinned: false,
    folderId,
    attachments: [],
    pages: [firstPage],
    activePageId: firstPage.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeFolder(raw: Record<string, unknown>): Folder {
  return {
    id: typeof raw.id === 'string' ? raw.id : generateId(),
    name:
      typeof raw.name === 'string' && raw.name.trim().length > 0
        ? raw.name.trim()
        : 'Ordner',
    color:
      typeof raw.color === 'string' && raw.color.length > 0
        ? raw.color
        : FOLDER_COLORS[0],
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

export function normalizeNote(raw: Record<string, unknown>): Note {
  let pages: CanvasPage[] = [];

  if (Array.isArray(raw.pages) && raw.pages.length > 0) {
    pages = raw.pages
      .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
      .map((p, idx) => normalizePage(p, idx));
  } else if (raw.canvas && typeof raw.canvas === 'object') {
    // Seamless migration from legacy single-canvas note format
    pages = [normalizePage(raw.canvas as Record<string, unknown>, 0)];
  }

  if (pages.length === 0) {
    pages = [createCanvasPage({ title: 'Seite 1' })];
  }

  const rawActivePageId = typeof raw.activePageId === 'string' ? raw.activePageId : '';
  const activePageId = pages.some((p) => p.id === rawActivePageId)
    ? rawActivePageId
    : pages[0].id;

  const normalizedSettings = normalizeNoteSettings(raw.settings);

  return {
    id: typeof raw.id === 'string' ? raw.id : generateId(),
    title: typeof raw.title === 'string' ? raw.title : '',
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === 'string')
      : [],
    pinned: Boolean(raw.pinned),
    folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
    attachments: normalizeAttachments(raw),
    pages,
    activePageId,
    ...(normalizedSettings && Object.keys(normalizedSettings).length > 0
      ? { settings: normalizedSettings }
      : {}),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

export function normalizeNoteSettings(raw: unknown): Partial<NoteLocalSettings> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const out: Partial<NoteLocalSettings> = {};

  if (obj.canvasMode === 'pages' || obj.canvasMode === 'infinite') {
    out.canvasMode = obj.canvasMode;
  }
  if (obj.stabilization === 'off' || obj.stabilization === 'light' || obj.stabilization === 'medium') {
    out.stabilization = obj.stabilization as StabilizationLevel;
  }
  if (typeof obj.pressureSensitivity === 'boolean') {
    out.pressureSensitivity = obj.pressureSensitivity;
  }
  if (typeof obj.stylusOnly === 'boolean') {
    out.stylusOnly = obj.stylusOnly;
  }
  if (typeof obj.oneFingerScroll === 'boolean') {
    out.oneFingerScroll = obj.oneFingerScroll;
  }
  if (obj.palmSensitivity === 'low' || obj.palmSensitivity === 'normal' || obj.palmSensitivity === 'high') {
    out.palmSensitivity = obj.palmSensitivity as PalmSensitivity;
  }
  if (typeof obj.pinchZoomEnabled === 'boolean') {
    out.pinchZoomEnabled = obj.pinchZoomEnabled;
  }
  if (typeof obj.scrollMomentum === 'boolean') {
    out.scrollMomentum = obj.scrollMomentum;
  }
  if (typeof obj.showSheetHeaders === 'boolean') {
    out.showSheetHeaders = obj.showSheetHeaders;
  }
  if (typeof obj.editorFontSize === 'number' && obj.editorFontSize >= 12 && obj.editorFontSize <= 24) {
    out.editorFontSize = Math.round(obj.editorFontSize);
  }
  if (obj.editorFontFamily === 'sans' || obj.editorFontFamily === 'serif' || obj.editorFontFamily === 'mono') {
    out.editorFontFamily = obj.editorFontFamily as EditorFontFamily;
  }
  if (typeof obj.editorSpellCheck === 'boolean') {
    out.editorSpellCheck = obj.editorSpellCheck;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeAppSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_APP_SETTINGS,
      defaultPaperConfig: { ...DEFAULT_APP_SETTINGS.defaultPaperConfig },
    };
  }
  const obj = raw as Record<string, unknown>;
  const localPart = normalizeNoteSettings(obj) ?? {};
  const validPreset =
    typeof obj.defaultPagePresetId === 'string' &&
    PAGE_SIZE_PRESETS.some((p) => p.id === obj.defaultPagePresetId)
      ? obj.defaultPagePresetId
      : DEFAULT_APP_SETTINGS.defaultPagePresetId;
  const pngScale: 1 | 2 | 3 =
    obj.pngExportScale === 1 || obj.pngExportScale === 2 || obj.pngExportScale === 3
      ? obj.pngExportScale
      : DEFAULT_APP_SETTINGS.pngExportScale;
  const autosave =
    typeof obj.autosaveDelayMs === 'number' &&
    obj.autosaveDelayMs >= 150 &&
    obj.autosaveDelayMs <= 3000
      ? Math.round(obj.autosaveDelayMs)
      : DEFAULT_APP_SETTINGS.autosaveDelayMs;

  return {
    ...DEFAULT_APP_SETTINGS,
    ...localPart,
    autoEnableStylusOnly:
      typeof obj.autoEnableStylusOnly === 'boolean'
        ? obj.autoEnableStylusOnly
        : DEFAULT_APP_SETTINGS.autoEnableStylusOnly,
    defaultViewMode:
      obj.defaultViewMode === 'split' ||
      obj.defaultViewMode === 'text' ||
      obj.defaultViewMode === 'canvas'
        ? obj.defaultViewMode
        : DEFAULT_APP_SETTINGS.defaultViewMode,
    defaultPagePresetId: validPreset,
    defaultPaperConfig: normalizePaperConfig({ paperConfig: obj.defaultPaperConfig }),
    pngExportScale: pngScale,
    autosaveDelayMs: autosave,
  };
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return normalizeAppSettings(null);
    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return normalizeAppSettings(null);
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function estimateStorageUsageBytes(): number {
  try {
    let total = 0;
    for (const key of Object.values(STORAGE_KEYS)) {
      const val = localStorage.getItem(key);
      if (val) total += (key.length + val.length) * 2;
    }
    return total;
  } catch {
    return 0;
  }
}

export function loadInitialWorkspace(): { notes: Note[]; folders: Folder[] } {
  try {
    const rawNotes = localStorage.getItem(STORAGE_KEYS.NOTES);
    const rawFolders = localStorage.getItem(STORAGE_KEYS.FOLDERS);

    if (!rawNotes) {
      const now = Date.now();
      const defaultFolders: Folder[] = [
        { id: generateId(), name: 'Allgemein', color: '#4f46e5', parentId: null, createdAt: now },
        { id: generateId(), name: 'Projekte', color: '#059669', parentId: null, createdAt: now + 1 },
      ];
      return {
        folders: defaultFolders,
        notes: [createWelcomeNote(defaultFolders[0].id)],
      };
    }

    const parsedNotes = JSON.parse(rawNotes);
    const notes: Note[] =
      Array.isArray(parsedNotes) && parsedNotes.length > 0
        ? parsedNotes
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === 'object')
            )
            .map(normalizeNote)
        : [createWelcomeNote()];

    let folders: Folder[] = [];
    if (rawFolders) {
      const parsedFolders = JSON.parse(rawFolders);
      if (Array.isArray(parsedFolders)) {
        folders = parsedFolders
          .filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === 'object')
          )
          .map(normalizeFolder);
      }
    }

    // Sanitize orphaned parentIds & folderIds
    const folderIds = new Set(folders.map((f) => f.id));
    folders = folders.map((f) => ({
      ...f,
      parentId: f.parentId && folderIds.has(f.parentId) && f.parentId !== f.id ? f.parentId : null,
    }));
    const cleanNotes = notes.map((n) => ({
      ...n,
      folderId: n.folderId && folderIds.has(n.folderId) ? n.folderId : null,
    }));

    return { notes: cleanNotes, folders };
  } catch {
    return { notes: [createWelcomeNote()], folders: [] };
  }
}

export function saveFolders(folders: Folder[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FOLDERS, JSON.stringify(folders));
  } catch {
    // ignore
  }
}

export function saveNotes(notes: Note[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEYS.NOTES, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

export function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME);
    if (saved === 'light' || saved === 'dark') return saved;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

export function saveTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  } catch {
    // ignore
  }
}

export function loadViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'split' || saved === 'text' || saved === 'canvas') return saved;
  } catch {
    // ignore
  }
  return 'split';
}

export function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEYS.VIEW_MODE, mode);
  } catch {
    // ignore
  }
}

export function loadActiveNoteId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_ID);
  } catch {
    return null;
  }
}

export function saveActiveNoteId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, id);
    else localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID);
  } catch {
    // ignore
  }
}

export function loadOpenTabIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OPEN_TABS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export function saveOpenTabIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.OPEN_TABS, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function loadActiveScreen(): 'home' | 'note' {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SCREEN);
    if (saved === 'home' || saved === 'note') return saved;
  } catch {
    // ignore
  }
  return 'home';
}

export function saveActiveScreen(screen: 'home' | 'note'): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SCREEN, screen);
  } catch {
    // ignore
  }
}

export function exportNotesAsJson(
  notes: Note[],
  folders: Folder[] = [],
  settings?: AppSettings
) {
  const payload = settings
    ? { version: 2, folders, notes, settings }
    : { version: 2, folders, notes };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `notizblock-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportNoteAsMarkdown(note: Note) {
  const titleLine = note.title.trim() ? `# ${note.title.trim()}\n\n` : '';
  const tagsLine =
    note.tags.length > 0 ? `Tags: ${note.tags.map((t) => `#${t}`).join(' ')}\n\n` : '';
  const body = `${titleLine}${tagsLine}${note.content}`;
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (note.title.trim() || 'notiz')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß_-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  a.download = `${safeName || 'notiz'}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
