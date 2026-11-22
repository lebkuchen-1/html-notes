import { createSignal } from 'solid-js';
import type {
  CanvasImageItem,
  CanvasPage,
  CanvasSnapshot,
  CanvasTextItem,
  Stroke,
  ThemeMode,
} from '../types';
import {
  drawCanvasImage,
  drawCanvasText,
  drawStroke,
  getStrokeBounds,
  isPointHittingImage,
  isPointHittingStroke,
  isPointHittingText,
  measureCanvasTextBounds,
} from './canvasRenderer';
import { generateId } from './storage';

export interface LassoPoint {
  x: number;
  y: number;
}

export interface LassoSelection {
  pageId: string;
  strokeIds: string[];
  textIds: string[];
  imageIds: string[];
}

export interface LassoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LassoTransform {
  dx: number;
  dy: number;
  scale: number;
  anchorX: number;
  anchorY: number;
}

export interface LassoClipboardData {
  strokes: Stroke[];
  texts: CanvasTextItem[];
  images: CanvasImageItem[];
  bounds: LassoBounds;
  sourcePageId: string;
}

export const IDENTITY_LASSO_TRANSFORM: LassoTransform = {
  dx: 0,
  dy: 0,
  scale: 1,
  anchorX: 0,
  anchorY: 0,
};

// Shared across tabs, pages, and notes so users can copy/cut & paste selections anywhere
const [lassoClipboard, setLassoClipboard] = createSignal<LassoClipboardData | null>(null);
export { lassoClipboard as getLassoClipboard, setLassoClipboard };

export function getLassoItemCount(selection: LassoSelection | null): number {
  if (!selection) return 0;
  return (
    selection.strokeIds.length +
    selection.textIds.length +
    selection.imageIds.length
  );
}

export function isLassoSelectionEmpty(selection: LassoSelection | null): boolean {
  return getLassoItemCount(selection) === 0;
}

export function formatLassoCountLabel(count: number): string {
  return count === 1 ? '1 Element' : `${count} Elemente`;
}

export function isPointInPolygon(
  pt: LassoPoint,
  polygon: readonly LassoPoint[]
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function getPolygonBounds(polygon: readonly LassoPoint[]): LassoBounds | null {
  if (polygon.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function boundsOverlap(a: LassoBounds, b: LassoBounds): boolean {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}

function isStrokeSelectedByLasso(
  stroke: Stroke,
  polygon: readonly LassoPoint[],
  polyBounds: LassoBounds
): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;

  const sb = getStrokeBounds(stroke);
  if (
    sb &&
    !boundsOverlap(polyBounds, {
      x: sb.minX,
      y: sb.minY,
      width: sb.maxX - sb.minX,
      height: sb.maxY - sb.minY,
    })
  ) {
    return false;
  }

  if (stroke.tool === 'rect' && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    if (isPointInPolygon({ x: cx, y: cy }, polygon)) return true;

    const samples: LassoPoint[] = [
      { x: x1, y: y1 },
      { x: cx, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: cy },
      { x: x2, y: y2 },
      { x: cx, y: y2 },
      { x: x1, y: y2 },
      { x: x1, y: cy },
    ];
    let hits = 0;
    for (const s of samples) {
      if (isPointInPolygon(s, polygon)) hits++;
    }
    return hits >= 3;
  }

  if (stroke.tool === 'ellipse' && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    if (isPointInPolygon({ x: cx, y: cy }, polygon)) return true;

    let hits = 0;
    const total = 12;
    for (let i = 0; i < total; i++) {
      const a = (i / total) * Math.PI * 2;
      if (
        isPointInPolygon(
          { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry },
          polygon
        )
      ) {
        hits++;
      }
    }
    return hits >= 4;
  }

  if ((stroke.tool === 'line' || stroke.tool === 'arrow') && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const total = 9;
    let hits = 0;
    for (let i = 0; i < total; i++) {
      const t = i / (total - 1);
      if (
        isPointInPolygon(
          {
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
          },
          polygon
        )
      ) {
        hits++;
      }
    }
    return hits >= 3;
  }

  // Pen & Highlighter: select when a meaningful portion of points is inside the loop
  if (pts.length <= 3) {
    return pts.some((p) => isPointInPolygon(p, polygon));
  }

  const stride = pts.length > 80 ? Math.ceil(pts.length / 80) : 1;
  let sampled = 0;
  let insideCount = 0;
  for (let i = 0; i < pts.length; i += stride) {
    sampled++;
    if (isPointInPolygon(pts[i], polygon)) {
      insideCount++;
    }
  }
  return insideCount / Math.max(1, sampled) >= 0.35;
}

function isBoxSelectedByLasso(
  box: LassoBounds,
  polygon: readonly LassoPoint[],
  polyBounds: LassoBounds
): boolean {
  if (!boundsOverlap(box, polyBounds)) return false;

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (isPointInPolygon({ x: cx, y: cy }, polygon)) return true;

  const corners: LassoPoint[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  let hits = 0;
  for (const c of corners) {
    if (isPointInPolygon(c, polygon)) hits++;
  }
  if (hits >= 2) return true;

  // Also allow selecting a large box when the user draws a loop completely inside it
  const polyCenter = {
    x: polyBounds.x + polyBounds.width / 2,
    y: polyBounds.y + polyBounds.height / 2,
  };
  return (
    polyBounds.width >= 16 &&
    polyBounds.height >= 16 &&
    polyCenter.x >= box.x &&
    polyCenter.x <= box.x + box.width &&
    polyCenter.y >= box.y &&
    polyCenter.y <= box.y + box.height &&
    polyBounds.x >= box.x - 10 &&
    polyBounds.x + polyBounds.width <= box.x + box.width + 10 &&
    polyBounds.y >= box.y - 10 &&
    polyBounds.y + polyBounds.height <= box.y + box.height + 10
  );
}

export function selectPageItemsInLasso(
  page: CanvasPage,
  polygon: readonly LassoPoint[],
  ctx: CanvasRenderingContext2D | null
): LassoSelection | null {
  if (polygon.length < 3) return null;
  const polyBounds = getPolygonBounds(polygon);
  if (!polyBounds || (polyBounds.width < 6 && polyBounds.height < 6)) {
    return null;
  }

  const strokeIds: string[] = [];
  for (const stroke of page.strokes) {
    if (isStrokeSelectedByLasso(stroke, polygon, polyBounds)) {
      strokeIds.push(stroke.id);
    }
  }

  const textIds: string[] = [];
  for (const item of page.texts) {
    if (!item.text) continue;
    const box = getTextItemBounds(item, ctx);
    if (isBoxSelectedByLasso(box, polygon, polyBounds)) {
      textIds.push(item.id);
    }
  }

  const imageIds: string[] = [];
  for (const img of page.images) {
    const box: LassoBounds = {
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
    };
    if (isBoxSelectedByLasso(box, polygon, polyBounds)) {
      imageIds.push(img.id);
    }
  }

  if (strokeIds.length === 0 && textIds.length === 0 && imageIds.length === 0) {
    return null;
  }

  return {
    pageId: page.id,
    strokeIds,
    textIds,
    imageIds,
  };
}

/** Tap-to-select a single topmost object when the user taps without drawing a loop */
export function selectPageItemAtPoint(
  page: CanvasPage,
  pt: LassoPoint,
  ctx: CanvasRenderingContext2D | null,
  tolerance = 10
): LassoSelection | null {
  if (ctx) {
    for (let i = page.texts.length - 1; i >= 0; i--) {
      if (isPointHittingText(ctx, pt, page.texts[i], tolerance)) {
        return {
          pageId: page.id,
          strokeIds: [],
          textIds: [page.texts[i].id],
          imageIds: [],
        };
      }
    }
  }

  for (let i = page.strokes.length - 1; i >= 0; i--) {
    if (isPointHittingStroke(pt, page.strokes[i], tolerance)) {
      return {
        pageId: page.id,
        strokeIds: [page.strokes[i].id],
        textIds: [],
        imageIds: [],
      };
    }
  }

  for (let i = page.images.length - 1; i >= 0; i--) {
    if (isPointHittingImage(pt, page.images[i])) {
      return {
        pageId: page.id,
        strokeIds: [],
        textIds: [],
        imageIds: [page.images[i].id],
      };
    }
  }

  return null;
}

function getTextItemBounds(
  item: CanvasTextItem,
  ctx: CanvasRenderingContext2D | null
): LassoBounds {
  if (ctx) {
    const b = measureCanvasTextBounds(ctx, item);
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  const lines = item.text.split('\n');
  const maxLen = Math.max(4, ...lines.map((l) => l.length));
  const estW = item.maxWidth
    ? Math.min(item.maxWidth, maxLen * item.fontSize * 0.62)
    : maxLen * item.fontSize * 0.62;
  const estH = Math.max(1, lines.length) * item.fontSize * 1.35;
  return { x: item.x, y: item.y, width: estW, height: estH };
}

export function computeLassoSelectionBounds(
  page: CanvasPage,
  selection: LassoSelection,
  ctx: CanvasRenderingContext2D | null
): LassoBounds | null {
  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);
  const imageSet = new Set(selection.imageIds);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  };

  for (const stroke of page.strokes) {
    if (!strokeSet.has(stroke.id)) continue;
    const b = getStrokeBounds(stroke);
    if (b) include(b.minX, b.minY, b.maxX, b.maxY);
  }

  for (const item of page.texts) {
    if (!textSet.has(item.id)) continue;
    const b = getTextItemBounds(item, ctx);
    include(b.x - 4, b.y - 3, b.x + b.width + 4, b.y + b.height + 3);
  }

  for (const img of page.images) {
    if (!imageSet.has(img.id)) continue;
    include(img.x, img.y, img.x + img.width, img.y + img.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const pad = 6;
  const width = Math.max(24, maxX - minX + pad * 2);
  const height = Math.max(24, maxY - minY + pad * 2);
  return {
    x: minX - pad,
    y: minY - pad,
    width,
    height,
  };
}

export function transformPoint(
  x: number,
  y: number,
  t: LassoTransform
): { x: number; y: number } {
  return {
    x: t.anchorX + (x - t.anchorX) * t.scale + t.dx,
    y: t.anchorY + (y - t.anchorY) * t.scale + t.dy,
  };
}

export function transformBounds(
  bounds: LassoBounds,
  t: LassoTransform
): LassoBounds {
  const tl = transformPoint(bounds.x, bounds.y, t);
  return {
    x: tl.x,
    y: tl.y,
    width: Math.max(16, bounds.width * t.scale),
    height: Math.max(16, bounds.height * t.scale),
  };
}

export function applyTransformToPageSnapshot(
  page: CanvasPage,
  selection: LassoSelection,
  transform: LassoTransform
): CanvasSnapshot {
  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);
  const imageSet = new Set(selection.imageIds);

  const strokes: Stroke[] = page.strokes.map((s) => {
    if (!strokeSet.has(s.id)) return s;
    const nextWidth = Math.max(0.8, Math.min(120, Math.round(s.width * transform.scale * 100) / 100));
    return {
      ...s,
      width: nextWidth,
      points: s.points.map((pt) => {
        const next = transformPoint(pt.x, pt.y, transform);
        return {
          x: next.x,
          y: next.y,
          pressure: pt.pressure,
          ...(pt.t !== undefined ? { t: pt.t } : {}),
        };
      }),
    };
  });

  const texts: CanvasTextItem[] = page.texts.map((item) => {
    if (!textSet.has(item.id)) return item;
    const nextPos = transformPoint(item.x, item.y, transform);
    const nextFontSize = Math.max(
      8,
      Math.min(180, Math.round(item.fontSize * transform.scale * 10) / 10)
    );
    const nextMaxWidth =
      item.maxWidth !== undefined
        ? Math.max(80, Math.round(item.maxWidth * transform.scale))
        : undefined;
    return {
      ...item,
      x: Math.round(nextPos.x * 10) / 10,
      y: Math.round(nextPos.y * 10) / 10,
      fontSize: nextFontSize,
      ...(nextMaxWidth !== undefined ? { maxWidth: nextMaxWidth } : {}),
    };
  });

  const images: CanvasImageItem[] = page.images.map((img) => {
    if (!imageSet.has(img.id)) return img;
    const nextPos = transformPoint(img.x, img.y, transform);
    return {
      ...img,
      x: Math.round(nextPos.x),
      y: Math.round(nextPos.y),
      width: Math.max(24, Math.round(img.width * transform.scale)),
      height: Math.max(24, Math.round(img.height * transform.scale)),
    };
  });

  return { strokes, texts, images };
}

export function recolorLassoSelection(
  page: CanvasPage,
  selection: LassoSelection,
  color: string
): CanvasSnapshot {
  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);

  return {
    strokes: page.strokes.map((s) =>
      strokeSet.has(s.id) ? { ...s, color } : s
    ),
    texts: page.texts.map((t) =>
      textSet.has(t.id) ? { ...t, color } : t
    ),
    images: page.images,
  };
}

export function deleteLassoSelection(
  page: CanvasPage,
  selection: LassoSelection
): CanvasSnapshot {
  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);
  const imageSet = new Set(selection.imageIds);

  return {
    strokes: page.strokes.filter((s) => !strokeSet.has(s.id)),
    texts: page.texts.filter((t) => !textSet.has(t.id)),
    images: page.images.filter((img) => !imageSet.has(img.id)),
  };
}

export function duplicateLassoSelection(
  page: CanvasPage,
  selection: LassoSelection,
  offset: { dx: number; dy: number } = { dx: 24, dy: 24 }
): { snapshot: CanvasSnapshot; nextSelection: LassoSelection } {
  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);
  const imageSet = new Set(selection.imageIds);

  const newStrokes: Stroke[] = [];
  const newStrokeIds: string[] = [];
  for (const s of page.strokes) {
    if (!strokeSet.has(s.id)) continue;
    const id = generateId();
    newStrokeIds.push(id);
    newStrokes.push({
      ...s,
      id,
      points: s.points.map((pt) => ({
        x: pt.x + offset.dx,
        y: pt.y + offset.dy,
        pressure: pt.pressure,
        ...(pt.t !== undefined ? { t: pt.t } : {}),
      })),
    });
  }

  const newTexts: CanvasTextItem[] = [];
  const newTextIds: string[] = [];
  for (const t of page.texts) {
    if (!textSet.has(t.id)) continue;
    const id = generateId();
    newTextIds.push(id);
    newTexts.push({
      ...t,
      id,
      x: t.x + offset.dx,
      y: t.y + offset.dy,
    });
  }

  const newImages: CanvasImageItem[] = [];
  const newImageIds: string[] = [];
  for (const img of page.images) {
    if (!imageSet.has(img.id)) continue;
    const id = generateId();
    newImageIds.push(id);
    newImages.push({
      ...img,
      id,
      x: Math.round(img.x + offset.dx),
      y: Math.round(img.y + offset.dy),
    });
  }

  return {
    snapshot: {
      strokes: [...page.strokes, ...newStrokes],
      texts: [...page.texts, ...newTexts],
      images: [...page.images, ...newImages],
    },
    nextSelection: {
      pageId: page.id,
      strokeIds: newStrokeIds,
      textIds: newTextIds,
      imageIds: newImageIds,
    },
  };
}

export function extractLassoClipboard(
  page: CanvasPage,
  selection: LassoSelection,
  ctx: CanvasRenderingContext2D | null
): LassoClipboardData | null {
  const bounds = computeLassoSelectionBounds(page, selection, ctx);
  if (!bounds) return null;

  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);
  const imageSet = new Set(selection.imageIds);

  return {
    strokes: page.strokes
      .filter((s) => strokeSet.has(s.id))
      .map((s) => ({
        ...s,
        points: s.points.map((pt) => ({ ...pt })),
      })),
    texts: page.texts
      .filter((t) => textSet.has(t.id))
      .map((t) => ({ ...t })),
    images: page.images
      .filter((img) => imageSet.has(img.id))
      .map((img) => ({ ...img })),
    bounds,
    sourcePageId: page.id,
  };
}

export function pasteLassoClipboard(
  page: CanvasPage,
  clipboard: LassoClipboardData,
  targetCenter?: { x: number; y: number }
): { snapshot: CanvasSnapshot; nextSelection: LassoSelection } {
  const srcCenterX = clipboard.bounds.x + clipboard.bounds.width / 2;
  const srcCenterY = clipboard.bounds.y + clipboard.bounds.height / 2;

  let dx = 28;
  let dy = 28;
  if (targetCenter) {
    dx = targetCenter.x - srcCenterX;
    dy = targetCenter.y - srcCenterY;
  } else if (clipboard.sourcePageId !== page.id) {
    // Center nicely on a different page
    dx = page.width / 2 - srcCenterX;
    dy = Math.min(page.height / 2, 360) - srcCenterY;
  }

  const newStrokes: Stroke[] = [];
  const newStrokeIds: string[] = [];
  for (const s of clipboard.strokes) {
    const id = generateId();
    newStrokeIds.push(id);
    newStrokes.push({
      ...s,
      id,
      points: s.points.map((pt) => ({
        x: pt.x + dx,
        y: pt.y + dy,
        pressure: pt.pressure,
        ...(pt.t !== undefined ? { t: pt.t } : {}),
      })),
    });
  }

  const newTexts: CanvasTextItem[] = [];
  const newTextIds: string[] = [];
  for (const t of clipboard.texts) {
    const id = generateId();
    newTextIds.push(id);
    newTexts.push({
      ...t,
      id,
      x: t.x + dx,
      y: t.y + dy,
    });
  }

  const newImages: CanvasImageItem[] = [];
  const newImageIds: string[] = [];
  for (const img of clipboard.images) {
    const id = generateId();
    newImageIds.push(id);
    newImages.push({
      ...img,
      id,
      x: Math.round(img.x + dx),
      y: Math.round(img.y + dy),
    });
  }

  return {
    snapshot: {
      strokes: [...page.strokes, ...newStrokes],
      texts: [...page.texts, ...newTexts],
      images: [...page.images, ...newImages],
    },
    nextSelection: {
      pageId: page.id,
      strokeIds: newStrokeIds,
      textIds: newTextIds,
      imageIds: newImageIds,
    },
  };
}

/** Draws the active freehand lasso loop on the live canvas overlay */
export function drawLassoPath(
  ctx: CanvasRenderingContext2D,
  points: readonly LassoPoint[],
  invZoom = 1,
  darkPaper = false
) {
  if (points.length < 2) return;

  const strokeColor = darkPaper ? '#818cf8' : '#4f46e5';
  const fillColor = darkPaper
    ? 'rgba(129, 140, 248, 0.14)'
    : 'rgba(79, 70, 229, 0.09)';

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();

  // Subtle translucent fill inside loop
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Main dashed lasso stroke along user's path
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(1.2, 2 * invZoom);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([7 * invZoom, 5 * invZoom]);
  ctx.stroke();

  // Faint closing guide line back to start
  if (points.length >= 3) {
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(points[0].x, points[0].y);
    ctx.strokeStyle = darkPaper
      ? 'rgba(129, 140, 248, 0.45)'
      : 'rgba(79, 70, 229, 0.35)';
    ctx.lineWidth = Math.max(0.9, 1.3 * invZoom);
    ctx.setLineDash([4 * invZoom, 4 * invZoom]);
    ctx.stroke();
  }

  // Start anchor dot
  ctx.setLineDash([]);
  ctx.fillStyle = strokeColor;
  ctx.beginPath();
  ctx.arc(points[0].x, points[0].y, Math.max(2.2, 3.2 * invZoom), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Draws only the currently selected items transformed on the 120Hz live canvas during move/resize */
export function renderSelectedItemsPreview(
  ctx: CanvasRenderingContext2D,
  page: CanvasPage,
  selection: LassoSelection,
  transform: LassoTransform,
  theme: ThemeMode
) {
  const strokeSet = new Set(selection.strokeIds);
  const textSet = new Set(selection.textIds);
  const imageSet = new Set(selection.imageIds);

  ctx.save();
  ctx.translate(transform.anchorX + transform.dx, transform.anchorY + transform.dy);
  ctx.scale(transform.scale, transform.scale);
  ctx.translate(-transform.anchorX, -transform.anchorY);

  // 1. Selected images
  for (const img of page.images) {
    if (!imageSet.has(img.id)) continue;
    drawCanvasImage(ctx, img);
  }

  // 2. Selected highlighters
  for (const stroke of page.strokes) {
    if (stroke.tool === 'highlighter' && strokeSet.has(stroke.id)) {
      drawStroke(ctx, stroke, page.paperConfig, theme);
    }
  }

  // 3. Selected pen & shapes
  for (const stroke of page.strokes) {
    if (stroke.tool !== 'highlighter' && strokeSet.has(stroke.id)) {
      drawStroke(ctx, stroke, page.paperConfig, theme);
    }
  }

  // 4. Selected texts
  for (const textItem of page.texts) {
    if (!textSet.has(textItem.id)) continue;
    drawCanvasText(ctx, textItem, page.paperConfig, theme, false);
  }

  ctx.restore();
}
