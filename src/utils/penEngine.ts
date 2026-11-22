import type { PenStyle, Stroke, StrokePoint } from '../types';

export interface PenStylePresetInfo {
  id: PenStyle;
  label: string;
  shortLabel: string;
  description: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  widthStep: number;
  sizePresets: { label: string; value: number }[];
}

export const PEN_STYLE_ORDER: readonly PenStyle[] = [
  'ballpoint',
  'fountain',
  'brush',
] as const;

export const PEN_STYLE_CONFIGS: Record<PenStyle, PenStylePresetInfo> = {
  ballpoint: {
    id: 'ballpoint',
    label: 'Kugelschreiber',
    shortLabel: 'Kuli',
    description: 'Präzise, gleichmäßige Linie für Alltag, Mathe & Skizzen',
    defaultWidth: 2.6,
    minWidth: 1,
    maxWidth: 14,
    widthStep: 0.2,
    sizePresets: [
      { label: 'S', value: 1.6 },
      { label: 'M', value: 2.6 },
      { label: 'L', value: 4.0 },
      { label: 'XL', value: 6.5 },
    ],
  },
  fountain: {
    id: 'fountain',
    label: 'Füllerfederhalter',
    shortLabel: 'Füller',
    description: 'Kalligrafische Feder — schmal/breit je nach Strichrichtung & Druck',
    defaultWidth: 3.8,
    minWidth: 1.2,
    maxWidth: 18,
    widthStep: 0.2,
    sizePresets: [
      { label: 'S', value: 2.2 },
      { label: 'M', value: 3.8 },
      { label: 'L', value: 6.0 },
      { label: 'XL', value: 9.5 },
    ],
  },
  brush: {
    id: 'brush',
    label: 'Pinselstift',
    shortLabel: 'Pinsel',
    description: 'Starke Druck- & Tempo-Dynamik mit feinen Haarlinien & spitzen Enden',
    defaultWidth: 6.8,
    minWidth: 2,
    maxWidth: 26,
    widthStep: 0.5,
    sizePresets: [
      { label: 'S', value: 3.6 },
      { label: 'M', value: 6.8 },
      { label: 'L', value: 11.0 },
      { label: 'XL', value: 16.0 },
    ],
  },
};

export const DEFAULT_FOUNTAIN_NIB_ANGLE = 40;
export const DEFAULT_FOUNTAIN_FLATNESS = 0.52;
export const DEFAULT_BRUSH_DYNAMICS = 1.0;

export const FOUNTAIN_ANGLE_PRESETS = [
  { label: 'Rechts (40°)', value: 40 },
  { label: 'Flach (20°)', value: 20 },
  { label: 'Steil (60°)', value: 60 },
  { label: 'Links (140°)', value: 140 },
] as const;

export const BRUSH_DYNAMICS_PRESETS = [
  { label: 'Sanft', value: 0.72 },
  { label: 'Standard', value: 1.0 },
  { label: 'Stark', value: 1.3 },
] as const;

export interface IncrementalPenState {
  drawnCount: number;
  prevMidX: number;
  prevMidY: number;
  prevRadius: number;
  smoothVel: number;
  smoothDirX: number;
  smoothDirY: number;
  hasDirection: boolean;
}

export function createIncrementalPenState(): IncrementalPenState {
  return {
    drawnCount: 0,
    prevMidX: 0,
    prevMidY: 0,
    prevRadius: 1.5,
    smoothVel: 0.45,
    smoothDirX: 0,
    smoothDirY: 1,
    hasDirection: false,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Computes safe stroke velocity in logical px/ms between two consecutive points.
 * Gracefully handles iPadOS coalesced events with identical timestamps (dt === 0)
 * and legacy points without timestamps.
 */
function computeSegmentVelocity(prev: StrokePoint, curr: StrokePoint): number {
  const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y);
  if (dist < 0.01) return 0;
  if (prev.t === undefined || curr.t === undefined) {
    // Approximate velocity from spatial step spacing when timestamps are absent
    return clamp(dist / 12, 0.1, 2.2);
  }
  const rawDt = curr.t - prev.t;
  // Coalesced 120Hz/240Hz samples can share timestamps; fall back to ~8.33ms
  const dt = rawDt > 0.5 && rawDt < 140 ? rawDt : 8.33;
  return clamp(dist / dt, 0, 5.5);
}

/**
 * Elliptical calligraphic nib factor for a fountain pen.
 * - `nibAngleDeg` is the thin (hairline) axis in standard upward-Y degrees
 *   (40° = bottom-left to top-right `/` for right-handed writers;
 *    140° = top-left to bottom-right `\` for left-handed writers).
 * - Returns a smooth factor in `[1 - flatness, 1.0]`.
 */
function computeFountainNibFactor(
  dirX: number,
  dirY: number,
  nibAngleDeg: number,
  flatness: number
): number {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-4) return 0.78;
  const tx = dirX / len;
  const ty = dirY / len;

  // Screen coordinates have +Y downward, so upward angle θ maps to -θ
  const rad = (-nibAngleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);

  const cosDelta = tx * ux + ty * uy;
  const sinDelta = tx * uy - ty * ux;
  const minor = clamp(1 - clamp(flatness, 0, 0.85), 0.15, 1);

  return Math.sqrt(minor * minor * cosDelta * cosDelta + sinDelta * sinDelta);
}

/**
 * Computes the target stroke radius (half-width) for a given pen style.
 */
function computeTargetRadius(
  stroke: Stroke,
  pressure: number,
  dirX: number,
  dirY: number,
  velocity: number,
  hasDirection: boolean
): number {
  const style = stroke.penStyle;
  const w = Math.max(0.6, stroke.width);
  const p = clamp(pressure, 0.04, 1);

  if (style === 'ballpoint') {
    // Crisp, uniform oil-ink line with minimal organic pressure nuance (~88% .. 108%)
    const factor = 0.88 + p * 0.2;
    return Math.max(0.45, (w * factor) / 2);
  }

  if (style === 'fountain') {
    const nibAngle = stroke.nibAngle ?? DEFAULT_FOUNTAIN_NIB_ANGLE;
    const nibFlatness = stroke.nibFlatness ?? DEFAULT_FOUNTAIN_FLATNESS;
    const nibFactor = hasDirection
      ? computeFountainNibFactor(dirX, dirY, nibAngle, nibFlatness)
      : 0.78;
    // Refined pressure response + liquid-ink velocity modulation
    const pressureFactor = 0.64 + p * 0.68;
    const velFactor = clamp(1.06 - velocity * 0.13, 0.72, 1.06);
    return Math.max(0.38, (w * nibFactor * pressureFactor * velFactor) / 2);
  }

  if (style === 'brush') {
    const dynamics = clamp(stroke.brushDynamics ?? DEFAULT_BRUSH_DYNAMICS, 0.5, 1.5);
    // Power curve keeps light touches razor-fine while firm pressure blooms smoothly
    const curvedP = Math.pow(p, 1.32);
    const minRatio = clamp(0.24 - 0.08 * dynamics, 0.11, 0.28);
    const pressureRange = 1.62 * dynamics;
    const velFactor = clamp(1.1 - velocity * 0.16, 0.64, 1.1);
    const factor = (minRatio + curvedP * pressureRange) * velFactor;
    return Math.max(0.35, (w * factor) / 2);
  }

  // Legacy pen (penStyle === undefined) — preserves exact historic appearance
  return Math.max(0.4, (w * (0.42 + p * 0.9)) / 2);
}

/**
 * Fills the exact convex hull (bitangent capsule) of two circles (x0, y0, r0) and (x1, y1, r1).
 * Guarantees silky-smooth variable-width strokes with zero joint steps or bead artifacts.
 */
export function fillTaperedCapsule(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  const safeR0 = Math.max(0.32, r0);
  const safeR1 = Math.max(0.32, r1);

  if (d < 0.02 || d + Math.min(safeR0, safeR1) <= Math.max(safeR0, safeR1) + 0.01) {
    const cx = safeR1 >= safeR0 ? x1 : x0;
    const cy = safeR1 >= safeR0 ? y1 : y0;
    const r = Math.max(safeR0, safeR1);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const phi = Math.atan2(dy, dx);
  const cosAlpha = clamp((safeR0 - safeR1) / d, -0.9999, 0.9999);
  const alpha = Math.acos(cosAlpha);

  ctx.beginPath();
  ctx.arc(x0, y0, safeR0, phi + alpha, phi - alpha, false);
  ctx.arc(x1, y1, safeR1, phi - alpha, phi + alpha, false);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws a smooth quadratic curve segment from (p0x, p0y) with control (cx, cy) to (p1x, p1y)
 * while smoothly interpolating radius from r0 to r1 via exact bitangent capsules.
 */
function fillQuadraticTaperedSegment(
  ctx: CanvasRenderingContext2D,
  p0x: number,
  p0y: number,
  r0: number,
  cx: number,
  cy: number,
  p1x: number,
  p1y: number,
  r1: number
): void {
  const chord = Math.hypot(p1x - p0x, p1y - p0y);
  const ctrlLen = Math.hypot(cx - p0x, cy - p0y) + Math.hypot(p1x - cx, p1y - cy);
  const bend = ctrlLen - chord;
  const rDiff = Math.abs(r1 - r0);

  let steps = 1;
  if (chord > 4.5 || bend > 0.35 || rDiff > 0.65) {
    steps = Math.min(8, Math.max(2, Math.ceil(Math.max(ctrlLen / 5.5, rDiff / 0.85))));
  }

  let sx = p0x;
  let sy = p0y;
  let sr = r0;

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const inv = 1 - t;
    const nx = inv * inv * p0x + 2 * inv * t * cx + t * t * p1x;
    const ny = inv * inv * p0y + 2 * inv * t * cy + t * t * p1y;
    const nr = r0 + (r1 - r0) * t;
    fillTaperedCapsule(ctx, sx, sy, sr, nx, ny, nr);
    sx = nx;
    sy = ny;
    sr = nr;
  }
}

function drawFountainNibDot(
  ctx: CanvasRenderingContext2D,
  pt: StrokePoint,
  stroke: Stroke
): number {
  const nibAngle = stroke.nibAngle ?? DEFAULT_FOUNTAIN_NIB_ANGLE;
  const nibFlatness = stroke.nibFlatness ?? DEFAULT_FOUNTAIN_FLATNESS;
  const rMajor = computeTargetRadius(stroke, pt.pressure, 0, 1, 0.35, false) * 1.15;
  const minorScale = clamp(1 - clamp(nibFlatness, 0, 0.85), 0.24, 1);
  const rMinor = Math.max(0.45, rMajor * minorScale);
  // Broad edge of the nib lies along `(-nibAngleDeg)` in screen space
  const rad = (-nibAngle * Math.PI) / 180;

  ctx.beginPath();
  ctx.ellipse(pt.x, pt.y, rMajor, rMinor, rad, 0, Math.PI * 2);
  ctx.fill();
  return (rMajor + rMinor) * 0.5;
}

/**
 * O(1) initial dot on the 120Hz live overlay canvas when a pen touches down.
 */
export function drawPenStartDot(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  pt: StrokePoint,
  color: string,
  scale: number,
  state: IncrementalPenState
): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.globalAlpha = stroke.opacity;
  ctx.fillStyle = color;

  let initRadius: number;
  if (stroke.penStyle === 'fountain') {
    initRadius = drawFountainNibDot(ctx, pt, stroke);
  } else {
    initRadius = computeTargetRadius(stroke, pt.pressure, 0, 1, 0.4, false);
    if (stroke.penStyle === 'brush') {
      // Gentle pointed initial landing for brush pen
      initRadius = Math.max(0.4, initRadius * 0.72);
    }
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, initRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  state.drawnCount = 1;
  state.prevMidX = pt.x;
  state.prevMidY = pt.y;
  state.prevRadius = initRadius;
  state.smoothVel = 0.4;
  state.smoothDirX = 0;
  state.smoothDirY = 1;
  state.hasDirection = false;
}

/**
 * O(1) incremental live stroke step for all 3 pen styles (120Hz iPad-safe).
 */
export function drawPenLiveStep(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  prev: StrokePoint,
  curr: StrokePoint,
  color: string,
  scale: number,
  state: IncrementalPenState
): void {
  const midX = (prev.x + curr.x) / 2;
  const midY = (prev.y + curr.y) / 2;
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const segLen = Math.hypot(dx, dy);

  const instVel = computeSegmentVelocity(prev, curr);
  state.smoothVel = state.smoothVel * 0.58 + instVel * 0.42;

  if (segLen > 0.35) {
    const nx = dx / segLen;
    const ny = dy / segLen;
    if (!state.hasDirection) {
      state.smoothDirX = nx;
      state.smoothDirY = ny;
      state.hasDirection = true;
    } else {
      // Gently smooth direction vector so fountain nib width transitions cleanly around curves
      state.smoothDirX = state.smoothDirX * 0.48 + nx * 0.52;
      state.smoothDirY = state.smoothDirY * 0.48 + ny * 0.52;
    }
  }

  const avgPressure = (prev.pressure + curr.pressure) / 2;
  const rawRadius = computeTargetRadius(
    stroke,
    avgPressure,
    state.smoothDirX,
    state.smoothDirY,
    state.smoothVel,
    state.hasDirection
  );

  const inertia =
    stroke.penStyle === 'brush'
      ? 0.34
      : stroke.penStyle === 'fountain'
        ? 0.28
        : 0.2;
  const nextRadius = state.prevRadius * inertia + rawRadius * (1 - inertia);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.globalAlpha = stroke.opacity;

  if (stroke.penStyle === 'ballpoint' || stroke.penStyle === undefined) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.8, nextRadius * 2);
    ctx.beginPath();
    ctx.moveTo(state.prevMidX, state.prevMidY);
    ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    fillQuadraticTaperedSegment(
      ctx,
      state.prevMidX,
      state.prevMidY,
      state.prevRadius,
      prev.x,
      prev.y,
      midX,
      midY,
      nextRadius
    );
  }

  ctx.restore();

  state.prevMidX = midX;
  state.prevMidY = midY;
  state.prevRadius = nextRadius;
  state.drawnCount++;
}

/**
 * Full-stroke renderer for Base Canvas, Thumbnails, PNG Export, and Lasso Preview.
 * - Legacy (`penStyle === undefined`): matches historic pen look identically.
 * - `'ballpoint'`: crisp uniform ballpoint ink.
 * - `'fountain'`: calligraphic angled nib + liquid-ink velocity flow + refined exit taper.
 * - `'brush'`: expressive sculpted pressure/velocity ribbon + natural lead-in & flick exit taper.
 */
export function drawStyledPenStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  color: string
): void {
  const pts = stroke.points;
  if (pts.length === 0) return;

  const style = stroke.penStyle;

  ctx.save();
  ctx.globalAlpha = stroke.opacity;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Single tap / dot
  if (pts.length === 1) {
    if (style === 'fountain') {
      drawFountainNibDot(ctx, pts[0], stroke);
    } else if (style === undefined) {
      const r = Math.max(0.75, (stroke.width * (0.45 + pts[0].pressure * 0.85)) / 2);
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const r = computeTargetRadius(stroke, pts[0].pressure, 0, 1, 0.35, false);
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // Fast crisp quadratic stroke renderer for legacy pen & ballpoint pen
  if (style === undefined || style === 'ballpoint') {
    let prevMidX = pts[0].x;
    let prevMidY = pts[0].y;

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const midX = (prev.x + curr.x) / 2;
      const midY = (prev.y + curr.y) / 2;
      const avgPressure = (prev.pressure + curr.pressure) / 2;

      const segmentWidth =
        style === 'ballpoint'
          ? Math.max(0.8, stroke.width * (0.88 + clamp(avgPressure, 0.04, 1) * 0.2))
          : Math.max(0.8, stroke.width * (0.42 + avgPressure * 0.9));

      ctx.lineWidth = segmentWidth;
      ctx.beginPath();
      ctx.moveTo(prevMidX, prevMidY);
      ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
      ctx.stroke();

      prevMidX = midX;
      prevMidY = midY;
    }

    const last = pts[pts.length - 1];
    ctx.lineWidth =
      style === 'ballpoint'
        ? Math.max(0.8, stroke.width * (0.88 + clamp(last.pressure, 0.04, 1) * 0.2))
        : Math.max(0.8, stroke.width * (0.42 + last.pressure * 0.9));
    ctx.beginPath();
    ctx.moveTo(prevMidX, prevMidY);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();

    ctx.restore();
    return;
  }

  // Variable-width tapered ribbon renderer for Fountain Pen & Brush Pen
  const n = pts.length;
  const cumLen = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cumLen[i] = cumLen[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const totalLen = cumLen[n - 1];

  // Compute smoothed per-point radii along the stroke
  const radii = new Float64Array(n);
  let smoothVel = 0.4;
  let smoothDirX = 0;
  let smoothDirY = 1;
  let hasDir = false;

  // Look ahead slightly for initial direction so fountain nib angle is right from point 0
  for (let i = 1; i < Math.min(n, 5); i++) {
    const dx = pts[i].x - pts[0].x;
    const dy = pts[i].y - pts[0].y;
    const d = Math.hypot(dx, dy);
    if (d > 0.5) {
      smoothDirX = dx / d;
      smoothDirY = dy / d;
      hasDir = true;
      break;
    }
  }

  const inertia = style === 'brush' ? 0.36 : 0.28;
  radii[0] = computeTargetRadius(
    stroke,
    pts[0].pressure,
    smoothDirX,
    smoothDirY,
    smoothVel,
    hasDir
  );

  for (let i = 1; i < n; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const segLen = Math.hypot(dx, dy);

    const instVel = computeSegmentVelocity(prev, curr);
    smoothVel = smoothVel * 0.56 + instVel * 0.44;

    if (segLen > 0.35) {
      const nx = dx / segLen;
      const ny = dy / segLen;
      if (!hasDir) {
        smoothDirX = nx;
        smoothDirY = ny;
        hasDir = true;
      } else {
        smoothDirX = smoothDirX * 0.46 + nx * 0.54;
        smoothDirY = smoothDirY * 0.46 + ny * 0.54;
      }
    }

    const rawR = computeTargetRadius(
      stroke,
      curr.pressure,
      smoothDirX,
      smoothDirY,
      smoothVel,
      hasDir
    );
    radii[i] = radii[i - 1] * inertia + rawR * (1 - inertia);
  }

  // Apply natural lead-in & flick exit tapers on strokes longer than a tiny dot
  if (totalLen > 8) {
    const startTaperLen =
      style === 'brush'
        ? Math.min(totalLen * 0.22, Math.max(8, stroke.width * 1.9))
        : Math.min(totalLen * 0.14, Math.max(5, stroke.width * 1.1));
    const endTaperLen =
      style === 'brush'
        ? Math.min(totalLen * 0.34, Math.max(14, stroke.width * 3.4))
        : Math.min(totalLen * 0.22, Math.max(8, stroke.width * 2.0));

    const startMinScale = style === 'brush' ? 0.56 : 0.82;
    // Faster lift creates a sharper calligraphy tail
    const liftVelBoost = clamp(smoothVel * 0.22, 0, 0.26);
    const endMinScale =
      style === 'brush'
        ? clamp(0.32 - liftVelBoost * 0.7, 0.14, 0.34)
        : clamp(0.62 - liftVelBoost * 0.65, 0.38, 0.64);

    for (let i = 0; i < n; i++) {
      const distStart = cumLen[i];
      const distEnd = totalLen - cumLen[i];
      let mult = 1;

      if (distStart < startTaperLen && startTaperLen > 0.1) {
        const u = distStart / startTaperLen;
        const ease = u * (2 - u); // smooth ease-out
        mult = Math.min(mult, startMinScale + (1 - startMinScale) * ease);
      }

      if (distEnd < endTaperLen && endTaperLen > 0.1) {
        const u = distEnd / endTaperLen;
        const ease = u * (2 - u);
        mult = Math.min(mult, endMinScale + (1 - endMinScale) * ease);
      }

      radii[i] = Math.max(0.32, radii[i] * mult);
    }
  }

  // Subtle nib-shaped landing for fountain pen
  if (style === 'fountain') {
    const nibAngle = stroke.nibAngle ?? DEFAULT_FOUNTAIN_NIB_ANGLE;
    const nibFlatness = stroke.nibFlatness ?? DEFAULT_FOUNTAIN_FLATNESS;
    const rMajor = radii[0] * 1.06;
    const rMinor = Math.max(0.38, rMajor * clamp(1 - nibFlatness, 0.28, 1));
    ctx.beginPath();
    ctx.ellipse(pts[0].x, pts[0].y, rMajor, rMinor, (-nibAngle * Math.PI) / 180, 0, Math.PI * 2);
    ctx.fill();
  }

  let prevMidX = pts[0].x;
  let prevMidY = pts[0].y;
  let prevR = radii[0];

  for (let i = 1; i < n; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    const midR = (radii[i - 1] + radii[i]) / 2;

    fillQuadraticTaperedSegment(ctx, prevMidX, prevMidY, prevR, prev.x, prev.y, midX, midY, midR);

    prevMidX = midX;
    prevMidY = midY;
    prevR = midR;
  }

  const last = pts[n - 1];
  fillTaperedCapsule(ctx, prevMidX, prevMidY, prevR, last.x, last.y, radii[n - 1]);

  ctx.restore();
}

/**
 * Returns the maximum visual stroke width (for accurate viewport culling & eraser hit-testing).
 */
export function getEffectiveStrokeMaxWidth(stroke: Stroke): number {
  if (stroke.tool !== 'pen') return stroke.width;
  if (stroke.penStyle === 'brush') {
    const dynamics = clamp(stroke.brushDynamics ?? DEFAULT_BRUSH_DYNAMICS, 0.5, 1.5);
    return stroke.width * (0.25 + 1.62 * dynamics);
  }
  if (stroke.penStyle === 'fountain') {
    return stroke.width * 1.38;
  }
  if (stroke.penStyle === 'ballpoint') {
    return stroke.width * 1.1;
  }
  return stroke.width * 1.35;
}

/**
 * Generates an expressive synthetic S-curve sample stroke for rendering live pen previews
 * inside the Pen Popover using the exact same `drawStyledPenStroke` engine!
 */
export function createPenPreviewStroke(
  penStyle: PenStyle,
  color: string,
  width: number,
  options?: {
    nibAngle?: number;
    nibFlatness?: number;
    brushDynamics?: number;
  }
): Stroke {
  const points: StrokePoint[] = [];
  const steps = 42;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = 14 + u * 168;
    // Expressive handwriting-like wave with both up-right `/` and down-right `\` strokes
    const y = 21 - Math.sin(u * Math.PI * 2.35) * 11.5;
    // Varying pressure: light entry -> firm downstroke -> light upstroke -> firm swell -> light tail
    const waveP = 0.45 + 0.42 * Math.sin(u * Math.PI * 2.1 - 0.35);
    const envelope = Math.sin(Math.min(1, u * 1.12) * Math.PI * 0.92);
    const pressure = clamp(0.14 + waveP * (0.4 + 0.6 * envelope), 0.1, 0.96);
    points.push({
      x,
      y,
      pressure,
      t: Math.round(u * 380),
    });
  }

  return {
    id: `preview-${penStyle}`,
    tool: 'pen',
    penStyle,
    ...(penStyle === 'fountain'
      ? {
          nibAngle: options?.nibAngle ?? DEFAULT_FOUNTAIN_NIB_ANGLE,
          nibFlatness: options?.nibFlatness ?? DEFAULT_FOUNTAIN_FLATNESS,
        }
      : {}),
    ...(penStyle === 'brush'
      ? {
          brushDynamics: options?.brushDynamics ?? DEFAULT_BRUSH_DYNAMICS,
        }
      : {}),
    color,
    width: Math.min(width, penStyle === 'brush' ? 9.5 : 7.5),
    opacity: 1,
    points,
  };
}
