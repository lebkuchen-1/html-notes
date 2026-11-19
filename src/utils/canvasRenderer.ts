import type {
  CanvasFontFamily,
  CanvasImageItem,
  CanvasPage,
  CanvasTextItem,
  PaperConfig,
  Stroke,
  StrokePoint,
  ThemeMode,
} from '../types';

const imageCache = new Map<string, HTMLImageElement>();

function getCachedImage(src: string, onLoad?: () => void): HTMLImageElement | null {
  const existing = imageCache.get(src);
  if (existing) {
    if (existing.complete && existing.naturalWidth > 0) return existing;
    if (onLoad) existing.addEventListener('load', onLoad, { once: true });
    return null;
  }

  const img = new Image();
  imageCache.set(src, img);
  if (onLoad) {
    img.addEventListener('load', onLoad, { once: true });
  }
  img.src = src;
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function ensureImagesLoaded(sources: string[]): Promise<void> {
  if (sources.length === 0) return Promise.resolve();
  return Promise.all(
    sources.map(
      (src) =>
        new Promise<void>((resolve) => {
          const cached = getCachedImage(src);
          if (cached && cached.complete && cached.naturalWidth > 0) {
            resolve();
            return;
          }
          const img = imageCache.get(src);
          if (!img) {
            resolve();
            return;
          }
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        })
    )
  ).then(() => undefined);
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (cleaned.length === 3) {
    const r = Number.parseInt(cleaned[0] + cleaned[0], 16);
    const g = Number.parseInt(cleaned[1] + cleaned[1], 16);
    const b = Number.parseInt(cleaned[2] + cleaned[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  if (cleaned.length === 6) {
    const r = Number.parseInt(cleaned.slice(0, 2), 16);
    const g = Number.parseInt(cleaned.slice(2, 4), 16);
    const b = Number.parseInt(cleaned.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

export function resolvePaperBackgroundColor(
  paperConfig: PaperConfig,
  theme: ThemeMode
): string {
  if (paperConfig.backgroundColor === 'theme') {
    return theme === 'dark' ? '#181c26' : '#ffffff';
  }
  return paperConfig.backgroundColor || (theme === 'dark' ? '#181c26' : '#fcf9f2');
}

export function isColorDark(hex: string): boolean {
  const rgb = parseHexRgb(hex);
  if (!rgb) return false;
  // Relative perceptual luminance (sRGB approximation)
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance < 0.52;
}

export function isPaperDark(paperConfig: PaperConfig, theme: ThemeMode): boolean {
  return isColorDark(resolvePaperBackgroundColor(paperConfig, theme));
}

function colorWithAlpha(hex: string, alpha: number): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return `rgba(100, 116, 139, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function resolveStrokeColor(
  color: string,
  paperConfig: PaperConfig,
  theme: ThemeMode
): string {
  if (color === 'auto') {
    return isPaperDark(paperConfig, theme) ? '#f1f5f9' : '#1e293b';
  }
  return color;
}

export function getCanvasFontFamilyCss(fontFamily: CanvasFontFamily): string {
  switch (fontFamily) {
    case 'serif':
      return "Georgia, 'Times New Roman', serif";
    case 'mono':
      return "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
    case 'hand':
      return "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";
    case 'sans':
    default:
      return "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }
}

export function getCanvasFontCss(item: Pick<CanvasTextItem, 'fontSize' | 'fontFamily' | 'bold'>): string {
  const weight = item.bold ? 700 : 400;
  return `${weight} ${item.fontSize}px ${getCanvasFontFamilyCss(item.fontFamily)}`;
}

export function drawPaperBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  paperConfig: PaperConfig,
  theme: ThemeMode
) {
  const bg = resolvePaperBackgroundColor(paperConfig, theme);
  const dark = isColorDark(bg);
  const opacity = Math.max(0.06, Math.min(0.9, paperConfig.lineOpacity ?? 0.24));
  const step = Math.max(16, Math.min(96, paperConfig.spacing || 34));

  const baseLineHex =
    paperConfig.lineColor && paperConfig.lineColor !== 'auto'
      ? paperConfig.lineColor
      : dark
        ? '#cbd5e1'
        : '#64748b';

  const lineStroke = colorWithAlpha(baseLineHex, opacity);
  const dotFill = colorWithAlpha(baseLineHex, Math.min(0.95, opacity * 1.45));
  const marginStroke = dark
    ? 'rgba(248, 113, 113, 0.32)'
    : 'rgba(239, 68, 68, 0.28)';

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (paperConfig.pattern === 'grid') {
    ctx.strokeStyle = lineStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();

    // Subtle major grid accent every 5 squares
    const majorStep = step * 5;
    ctx.strokeStyle = colorWithAlpha(baseLineHex, Math.min(0.9, opacity * 1.45));
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = majorStep; x < width; x += majorStep) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = majorStep; y < height; y += majorStep) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  } else if (paperConfig.pattern === 'lined') {
    ctx.strokeStyle = lineStroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startY = Math.max(step * 1.5, 48);
    for (let y = startY; y < height; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();
  } else if (paperConfig.pattern === 'dots') {
    ctx.fillStyle = dotFill;
    const radius = Math.max(1.2, Math.min(2.2, step * 0.045));
    for (let y = step; y < height; y += step) {
      for (let x = step; x < width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (paperConfig.showMargin) {
    const marginX = 82;
    ctx.strokeStyle = marginStroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(marginX, 0);
    ctx.lineTo(marginX, height);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPenStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string
) {
  const pts = stroke.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    const r = Math.max(0.75, (stroke.width * (0.45 + pts[0].pressure * 0.85)) / 2);
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  let prevMidX = pts[0].x;
  let prevMidY = pts[0].y;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;

    const avgPressure = (prev.pressure + curr.pressure) / 2;
    const segmentWidth = Math.max(0.8, stroke.width * (0.42 + avgPressure * 0.9));

    ctx.lineWidth = segmentWidth;
    ctx.beginPath();
    ctx.moveTo(prevMidX, prevMidY);
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();

    prevMidX = midX;
    prevMidY = midY;
  }

  const last = pts[pts.length - 1];
  ctx.lineWidth = Math.max(0.8, stroke.width * (0.42 + last.pressure * 0.9));
  ctx.beginPath();
  ctx.moveTo(prevMidX, prevMidY);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();

  ctx.restore();
}

function drawHighlighterStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string
) {
  const pts = stroke.points;
  if (pts.length === 0) return;

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function drawShapeStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string
) {
  if (stroke.points.length < 2) return;
  const start = stroke.points[0];
  const end = stroke.points[stroke.points.length - 1];

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.tool === 'line') {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  } else if (stroke.tool === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len > 4) {
      const angle = Math.atan2(dy, dx);
      const headLength = Math.min(len * 0.4, Math.max(12, stroke.width * 3.8));
      const spread = Math.PI / 6.5;

      ctx.beginPath();
      ctx.moveTo(
        end.x - headLength * Math.cos(angle - spread),
        end.y - headLength * Math.sin(angle - spread)
      );
      ctx.lineTo(end.x, end.y);
      ctx.lineTo(
        end.x - headLength * Math.cos(angle + spread),
        end.y - headLength * Math.sin(angle + spread)
      );
      ctx.stroke();
    }
  } else if (stroke.tool === 'rect') {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(8, w * 0.1, h * 0.1));
    ctx.stroke();
  } else if (stroke.tool === 'ellipse') {
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.abs(end.x - start.x) / 2;
    const ry = Math.abs(end.y - start.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  paperConfig: PaperConfig,
  theme: ThemeMode
) {
  const color = resolveStrokeColor(stroke.color, paperConfig, theme);
  if (stroke.tool === 'highlighter') {
    drawHighlighterStroke(ctx, stroke, color);
  } else if (stroke.tool === 'pen') {
    drawPenStroke(ctx, stroke, color);
  } else {
    drawShapeStroke(ctx, stroke, color);
  }
}

export function measureCanvasTextBounds(
  ctx: CanvasRenderingContext2D,
  item: CanvasTextItem
): { x: number; y: number; width: number; height: number } {
  const lines = item.text.split('\n');
  const lineHeight = item.fontSize * 1.35;
  ctx.save();
  ctx.font = getCanvasFontCss(item);
  let maxWidth = 24;
  for (const line of lines) {
    const w = ctx.measureText(line || ' ').width;
    if (w > maxWidth) maxWidth = w;
  }
  ctx.restore();
  return {
    x: item.x,
    y: item.y,
    width: maxWidth,
    height: Math.max(lineHeight, lines.length * lineHeight),
  };
}

export function drawCanvasText(
  ctx: CanvasRenderingContext2D,
  item: CanvasTextItem,
  paperConfig: PaperConfig,
  theme: ThemeMode,
  highlightBox = false
) {
  if (!item.text) return;
  const color = resolveStrokeColor(item.color, paperConfig, theme);
  const lines = item.text.split('\n');
  const lineHeight = item.fontSize * 1.35;

  ctx.save();
  ctx.font = getCanvasFontCss(item);
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  if (highlightBox) {
    const bounds = measureCanvasTextBounds(ctx, item);
    ctx.save();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.55)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(bounds.x - 6, bounds.y - 4, bounds.width + 12, bounds.height + 8, 6);
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], item.x, item.y + i * lineHeight);
  }
  ctx.restore();
}

function drawCanvasImage(
  ctx: CanvasRenderingContext2D,
  item: CanvasImageItem,
  onImageLoad?: () => void
) {
  const img = getCachedImage(item.src, onImageLoad);
  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, item.opacity ?? 1));

  if (img) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, item.x, item.y, item.width, item.height);
  } else {
    // Subtle loading placeholder until decoded
    ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(item.x, item.y, item.width, item.height, 8);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawPageBackgroundImage(
  ctx: CanvasRenderingContext2D,
  page: CanvasPage,
  onImageLoad?: () => void
) {
  const bgImg = page.backgroundImage;
  if (!bgImg || !bgImg.src) return;
  const img = getCachedImage(bgImg.src, onImageLoad);
  if (!img) return;

  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1, bgImg.opacity ?? 1));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Contain cleanly inside page while preserving natural ratio (full-bleed when page matches ratio)
  const scale = Math.min(
    page.width / Math.max(1, img.naturalWidth),
    page.height / Math.max(1, img.naturalHeight)
  );
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const dx = (page.width - drawW) / 2;
  const dy = (page.height - drawH) / 2;
  ctx.drawImage(img, dx, dy, drawW, drawH);
  ctx.restore();
}

export function renderFullCanvas(
  ctx: CanvasRenderingContext2D,
  page: CanvasPage,
  activeStroke: Stroke | null,
  theme: ThemeMode,
  scale: number,
  options?: {
    editingTextId?: string | null;
    hoveredTextId?: string | null;
    onImageLoad?: () => void;
  }
) {
  ctx.save();
  ctx.scale(scale, scale);

  // 0. Base paper color + pattern
  drawPaperBackground(
    ctx,
    page.width,
    page.height,
    page.paperConfig,
    theme
  );

  // 0b. Dedicated locked PDF / Image page background (if present)
  drawPageBackgroundImage(ctx, page, options?.onImageLoad);

  // 1. Imported movable images (underneath ink & text so user can annotate directly over images)
  for (const imgItem of page.images) {
    drawCanvasImage(ctx, imgItem, options?.onImageLoad);
  }

  // 2. Highlighters
  for (const stroke of page.strokes) {
    if (stroke.tool === 'highlighter') {
      drawStroke(ctx, stroke, page.paperConfig, theme);
    }
  }
  if (activeStroke && activeStroke.tool === 'highlighter') {
    drawStroke(ctx, activeStroke, page.paperConfig, theme);
  }

  // 3. Pen & geometric strokes
  for (const stroke of page.strokes) {
    if (stroke.tool !== 'highlighter') {
      drawStroke(ctx, stroke, page.paperConfig, theme);
    }
  }
  if (activeStroke && activeStroke.tool !== 'highlighter') {
    drawStroke(ctx, activeStroke, page.paperConfig, theme);
  }

  // 4. Canvas Text Items (skipping whichever one is currently open in the HTML editor overlay)
  const editingId = options?.editingTextId ?? null;
  const hoveredId = options?.hoveredTextId ?? null;
  for (const textItem of page.texts) {
    if (textItem.id === editingId) continue;
    drawCanvasText(
      ctx,
      textItem,
      page.paperConfig,
      theme,
      textItem.id === hoveredId
    );
  }

  ctx.restore();
}

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return (px - projX) ** 2 + (py - projY) ** 2;
}

export function isPointHittingStroke(
  point: Pick<StrokePoint, 'x' | 'y'>,
  stroke: Stroke,
  eraserRadius: number
): boolean {
  const threshold = eraserRadius + stroke.width / 2 + 3;
  const thresholdSq = threshold * threshold;
  const pts = stroke.points;
  if (pts.length === 0) return false;

  if (stroke.tool === 'rect' && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    return (
      pointToSegmentDistSq(point.x, point.y, x1, y1, x2, y1) <= thresholdSq ||
      pointToSegmentDistSq(point.x, point.y, x2, y1, x2, y2) <= thresholdSq ||
      pointToSegmentDistSq(point.x, point.y, x2, y2, x1, y2) <= thresholdSq ||
      pointToSegmentDistSq(point.x, point.y, x1, y2, x1, y1) <= thresholdSq
    );
  }

  if (stroke.tool === 'ellipse' && pts.length >= 2) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const rx = Math.max(1, Math.abs(end.x - start.x) / 2);
    const ry = Math.max(1, Math.abs(end.y - start.y) / 2);
    const nx = (point.x - cx) / rx;
    const ny = (point.y - cy) / ry;
    const dist = Math.hypot(nx, ny);
    const avgR = (rx + ry) / 2;
    const radialDist = Math.abs(dist - 1) * avgR;
    return radialDist <= threshold;
  }

  if (pts.length === 1) {
    return (point.x - pts[0].x) ** 2 + (point.y - pts[0].y) ** 2 <= thresholdSq;
  }

  for (let i = 1; i < pts.length; i++) {
    if (
      pointToSegmentDistSq(
        point.x,
        point.y,
        pts[i - 1].x,
        pts[i - 1].y,
        pts[i].x,
        pts[i].y
      ) <= thresholdSq
    ) {
      return true;
    }
  }
  return false;
}

export function isPointHittingText(
  ctx: CanvasRenderingContext2D,
  point: Pick<StrokePoint, 'x' | 'y'>,
  item: CanvasTextItem,
  padding = 8
): boolean {
  const bounds = measureCanvasTextBounds(ctx, item);
  return (
    point.x >= bounds.x - padding &&
    point.x <= bounds.x + bounds.width + padding &&
    point.y >= bounds.y - padding &&
    point.y <= bounds.y + bounds.height + padding
  );
}

export function isPointHittingImage(
  point: Pick<StrokePoint, 'x' | 'y'>,
  item: CanvasImageItem
): boolean {
  return (
    point.x >= item.x &&
    point.x <= item.x + item.width &&
    point.y >= item.y &&
    point.y <= item.y + item.height
  );
}

export async function exportCanvasToPng(
  page: CanvasPage,
  theme: ThemeMode,
  filename: string
) {
  const sources = page.images.map((i) => i.src);
  if (page.backgroundImage?.src) sources.push(page.backgroundImage.src);
  await ensureImagesLoaded(sources);
  const exportScale = 2;
  const offscreen = document.createElement('canvas');
  offscreen.width = Math.round(page.width * exportScale);
  offscreen.height = Math.round(page.height * exportScale);
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;

  renderFullCanvas(ctx, page, null, theme, exportScale);

  const url = offscreen.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
