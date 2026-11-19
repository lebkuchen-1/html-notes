export type DrawingTool =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'eraser'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse';

export type PaperPattern = 'blank' | 'lined' | 'grid' | 'dots';

export type CanvasFontFamily = 'sans' | 'serif' | 'hand' | 'mono';

export type ViewMode = 'split' | 'text' | 'canvas';

export type ThemeMode = 'light' | 'dark';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  tool: Exclude<DrawingTool, 'select' | 'eraser' | 'text'>;
  /** 'auto' adapts to the canvas background luminance; otherwise hex color */
  color: string;
  width: number;
  opacity: number;
  points: StrokePoint[];
}

export interface CanvasTextItem {
  id: string;
  x: number;
  y: number;
  text: string;
  /** 'auto' adapts to the canvas background luminance; otherwise hex color */
  color: string;
  fontSize: number;
  fontFamily: CanvasFontFamily;
  bold: boolean;
}

export interface CanvasImageItem {
  id: string;
  src: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  opacity: number;
}

export interface NoteImageAttachment {
  id: string;
  name: string;
  src: string;
}

export interface PaperConfig {
  pattern: PaperPattern;
  /** 'theme' uses theme default surface, or any hex color (e.g. '#fcf9f2') */
  backgroundColor: string;
  /** 'auto' derives a contrasting color from backgroundColor, or hex */
  lineColor: string;
  /** Spacing in logical px for lines, grid squares, or dots */
  spacing: number;
  /** Opacity of pattern lines/dots (0.08 .. 0.85) */
  lineOpacity: number;
  /** Classic notebook vertical margin line */
  showMargin: boolean;
}

export interface PageBackgroundImage {
  src: string;
  name: string;
  sourceType: 'pdf' | 'image';
  pageNumber?: number;
  opacity: number;
}

export interface CanvasPage {
  id: string;
  title: string;
  width: number;
  height: number;
  strokes: Stroke[];
  texts: CanvasTextItem[];
  images: CanvasImageItem[];
  paperConfig: PaperConfig;
  backgroundImage?: PageBackgroundImage | null;
}

export interface CanvasSnapshot {
  strokes: Stroke[];
  texts: CanvasTextItem[];
  images: CanvasImageItem[];
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  createdAt: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  folderId: string | null;
  attachments: NoteImageAttachment[];
  pages: CanvasPage[];
  activePageId: string;
  createdAt: number;
  updatedAt: number;
}

export const FOLDER_COLORS = [
  '#4f46e5', // Indigo
  '#2563eb', // Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Red
  '#9333ea', // Purple
  '#0891b2', // Cyan
  '#64748b', // Slate
] as const;

export interface HistoryState {
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];
}

export interface PageSizePreset {
  id: string;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
}

export const MIN_PAGE_DIMENSION = 320;
export const MAX_PAGE_WIDTH = 3200;
export const MAX_PAGE_HEIGHT = 6000;

export const DEFAULT_CANVAS_WIDTH = 794;
export const DEFAULT_CANVAS_HEIGHT = 1123;

export const PAGE_SIZE_PRESETS: PageSizePreset[] = [
  { id: 'a4-p', label: 'A4 Hochformat', shortLabel: 'A4 Hoch', width: 794, height: 1123 },
  { id: 'a4-l', label: 'A4 Querformat', shortLabel: 'A4 Quer', width: 1123, height: 794 },
  { id: 'a5-p', label: 'A5 Notizheft', shortLabel: 'A5', width: 559, height: 794 },
  { id: 'square', label: 'Quadrat', shortLabel: 'Quadrat', width: 1000, height: 1000 },
  { id: 'slide-16-9', label: '16:9 Whiteboard', shortLabel: '16:9', width: 1280, height: 720 },
  { id: 'wide', label: 'Breitbild / Timeline', shortLabel: 'Breit', width: 1600, height: 760 },
  { id: 'long', label: 'Langes Blatt', shortLabel: 'Lang', width: 900, height: 1650 },
  { id: 'card', label: 'Karte / Mobil', shortLabel: 'Karte', width: 460, height: 780 },
];

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  pattern: 'grid',
  backgroundColor: '#fcf9f2',
  lineColor: 'auto',
  spacing: 34,
  lineOpacity: 0.24,
  showMargin: false,
};
