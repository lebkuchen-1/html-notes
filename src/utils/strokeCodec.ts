import type { PenStyle, Stroke, StrokePoint } from '../types';
import {
  DEFAULT_BRUSH_DYNAMICS,
  DEFAULT_FOUNTAIN_FLATNESS,
  DEFAULT_FOUNTAIN_NIB_ANGLE,
} from './penEngine';

const MAGIC_0 = 0x4e; // 'N'
const MAGIC_1 = 0x53; // 'S'
const FORMAT_VERSION = 1;

const MAX_COORD_TENTHS = 100_000_000; // ±10,000,000 logical px (fits cleanly in 31-bit signed int)

const TOOL_TO_CODE: Record<Stroke['tool'], number> = {
  pen: 0,
  highlighter: 1,
  line: 2,
  arrow: 3,
  rect: 4,
  ellipse: 5,
};

const CODE_TO_TOOL: readonly Stroke['tool'][] = [
  'pen',
  'highlighter',
  'line',
  'arrow',
  'rect',
  'ellipse',
] as const;

const PEN_STYLE_TO_CODE: Record<PenStyle, number> = {
  ballpoint: 1,
  fountain: 2,
  brush: 3,
};

const CODE_TO_PEN_STYLE: readonly (PenStyle | undefined)[] = [
  undefined,
  'ballpoint',
  'fountain',
  'brush',
] as const;

const FLAG_HAS_PRESSURE_ARRAY = 1 << 5;
const FLAG_HAS_TIME_ARRAY = 1 << 6;
const FLAG_HAS_EXTRA_PARAMS = 1 << 7;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function roundTenth(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10) / 10;
}

function quantizePressure(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  const byte = Math.round(clamp(p, 0, 1) * 255);
  return Math.round((byte / 255) * 1000) / 1000;
}

function toCoordTenths(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const t = Math.round(v * 10);
  return t < -MAX_COORD_TENTHS ? -MAX_COORD_TENTHS : t > MAX_COORD_TENTHS ? MAX_COORD_TENTHS : t;
}

/**
 * Iterative Ramer-Douglas-Peucker simplification that preserves:
 * - sub-pixel geometric accuracy (`epsilon`)
 * - pressure dynamics (`pressureTol`, optional)
 * - velocity/timing inflection points for fountain & brush pens (`checkTime`)
 */
function simplifyStrokePoints(
  pts: readonly StrokePoint[],
  epsilon: number,
  pressureTol: number | null,
  checkTime: boolean
): StrokePoint[] {
  const n = pts.length;
  if (n <= 2) return pts.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const epsSq = epsilon * epsilon;
  const stack: number[] = [0, n - 1];

  while (stack.length >= 2) {
    const end = stack.pop()!;
    const start = stack.pop()!;
    if (end - start <= 1) continue;

    const a = pts[start];
    const b = pts[end];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const dp = b.pressure - a.pressure;
    const dtSpan =
      checkTime && a.t !== undefined && b.t !== undefined ? b.t - a.t : 0;

    let bestIdx = -1;
    let bestScore = 1; // strictly > 1 means exceeds tolerance

    for (let i = start + 1; i < end; i++) {
      const p = pts[i];
      let u = 0;
      let distSq: number;
      if (lenSq < 1e-6) {
        const px = p.x - a.x;
        const py = p.y - a.y;
        distSq = px * px + py * py;
        u = (i - start) / (end - start);
      } else {
        u = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq, 0, 1);
        const projX = a.x + u * dx;
        const projY = a.y + u * dy;
        const ex = p.x - projX;
        const ey = p.y - projY;
        distSq = ex * ex + ey * ey;
      }

      let score = distSq / epsSq;

      if (pressureTol !== null) {
        const expectedP = a.pressure + u * dp;
        const pErr = Math.abs(p.pressure - expectedP) / pressureTol;
        const pScore = pErr * pErr;
        if (pScore > score) score = pScore;
      }

      if (checkTime && dtSpan > 35 && a.t !== undefined && p.t !== undefined) {
        const expectedT = a.t + u * dtSpan;
        const tErr = Math.abs(p.t - expectedT) / Math.max(22, dtSpan * 0.22);
        const tScore = tErr * tErr;
        if (tScore > score) score = tScore;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      keep[bestIdx] = 1;
      stack.push(start, bestIdx, bestIdx, end);
    }
  }

  const out: StrokePoint[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(pts[i]);
  }
  return out;
}

/**
 * Optimizes a finalized stroke without perceptible visual loss:
 * - Collapses shapes to their 2 endpoints
 * - Runs sub-pixel pressure/velocity-aware RDP simplification on freehand paths
 *   (especially dramatic savings on ruler lines, underlines, diagrams & fast handwriting)
 * - Quantizes coordinates to 0.1 px & pressure to 8-bit
 * - Strips timestamps (`t`) on tools that never use velocity (`ballpoint`, `highlighter`, shapes, legacy pen)
 */
export function optimizeStroke(stroke: Stroke): Stroke {
  const pts = stroke.points;
  if (!Array.isArray(pts) || pts.length === 0) return stroke;

  const isShape = stroke.tool !== 'pen' && stroke.tool !== 'highlighter';
  if (isShape) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    const cleanPoints: StrokePoint[] =
      pts.length === 1
        ? [{ x: roundTenth(first.x), y: roundTenth(first.y), pressure: 0.5 }]
        : [
            { x: roundTenth(first.x), y: roundTenth(first.y), pressure: 0.5 },
            { x: roundTenth(last.x), y: roundTenth(last.y), pressure: 0.5 },
          ];
    return {
      ...stroke,
      width: roundTenth(stroke.width),
      points: cleanPoints,
    };
  }

  if (stroke.tool === 'highlighter') {
    const simplified = simplifyStrokePoints(pts, 0.45, null, false);
    const cleanPoints: StrokePoint[] = simplified.map((pt) => ({
      x: roundTenth(pt.x),
      y: roundTenth(pt.y),
      pressure: 0.5,
    }));
    return {
      ...stroke,
      width: roundTenth(stroke.width),
      points: cleanPoints,
    };
  }

  // Pen stroke: only fountain & brush read `t` for velocity modulation
  const usesVelocity = stroke.penStyle === 'fountain' || stroke.penStyle === 'brush';
  const pressureTol = stroke.penStyle === 'ballpoint' ? 0.09 : 0.035;
  const simplified = simplifyStrokePoints(pts, 0.22, pressureTol, usesVelocity);

  const cleanPoints: StrokePoint[] = new Array(simplified.length);
  let lastT = 0;
  for (let i = 0; i < simplified.length; i++) {
    const pt = simplified[i];
    const x = roundTenth(pt.x);
    const y = roundTenth(pt.y);
    const pressure = quantizePressure(pt.pressure);
    if (usesVelocity && typeof pt.t === 'number' && Number.isFinite(pt.t)) {
      const t = Math.max(lastT, Math.round(pt.t));
      lastT = t;
      cleanPoints[i] = { x, y, pressure, t };
    } else {
      cleanPoints[i] = { x, y, pressure };
    }
  }

  return {
    ...stroke,
    width: roundTenth(stroke.width),
    points: cleanPoints,
  };
}

// ==================== Binary Writer / Reader ====================

class ByteWriter {
  private buf: Uint8Array;
  private len = 0;

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(initialCapacity);
  }

  private ensure(extra: number) {
    const needed = this.len + extra;
    if (needed <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < needed) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  writeU8(v: number) {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  writeU16(v: number) {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
  }

  writeBytes(bytes: Uint8Array) {
    this.ensure(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }

  writeVarUint(v: number) {
    let n = v >>> 0;
    this.ensure(5);
    while (n >= 0x80) {
      this.buf[this.len++] = (n & 0x7f) | 0x80;
      n >>>= 7;
    }
    this.buf[this.len++] = n;
  }

  writeVarSint(v: number) {
    // Zig-zag encoding for signed 32-bit integers
    const zigzag = ((v << 1) ^ (v >> 31)) >>> 0;
    this.writeVarUint(zigzag);
  }

  writeString(str: string) {
    const encoded = textEncoder.encode(str);
    this.writeVarUint(encoded.length);
    this.writeBytes(encoded);
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

class ByteReader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  readU8(): number {
    return this.buf[this.pos++] ?? 0;
  }

  readU16(): number {
    const lo = this.buf[this.pos++] ?? 0;
    const hi = this.buf[this.pos++] ?? 0;
    return lo | (hi << 8);
  }

  readVarUint(): number {
    let result = 0;
    let shift = 0;
    while (this.pos < this.buf.length) {
      const b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
      if (shift > 35) break;
    }
    return result >>> 0;
  }

  readVarSint(): number {
    const u = this.readVarUint();
    return (u >>> 1) ^ -(u & 1);
  }

  readString(): string {
    const len = this.readVarUint();
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return textDecoder.decode(slice);
  }
}

function parseHex6Color(color: string): [number, number, number] | null {
  if (color.length !== 7 || color.charCodeAt(0) !== 35 /* '#' */) return null;
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function byteToHex2(v: number): string {
  return v.toString(16).padStart(2, '0');
}

/**
 * Encodes a list of Strokes into a compact delta-varint binary `Uint8Array`.
 * Typical size: ~80–220 bytes per handwritten stroke (~20×–40× smaller than JS objects/JSON).
 */
export function encodeStrokesBinary(strokes: readonly Stroke[]): Uint8Array {
  // Estimate initial buffer size to avoid repeated reallocations
  let approxPoints = 0;
  for (let i = 0; i < strokes.length; i++) {
    approxPoints += strokes[i].points.length;
  }
  const writer = new ByteWriter(Math.max(64, strokes.length * 52 + approxPoints * 5));

  writer.writeU8(MAGIC_0);
  writer.writeU8(MAGIC_1);
  writer.writeU8(FORMAT_VERSION);
  writer.writeVarUint(strokes.length);

  for (let sIdx = 0; sIdx < strokes.length; sIdx++) {
    const s = strokes[sIdx];
    const pts = s.points;
    const n = pts.length;

    const toolCode = TOOL_TO_CODE[s.tool] ?? 0;
    const styleCode = s.penStyle ? PEN_STYLE_TO_CODE[s.penStyle] ?? 0 : 0;

    // Detect whether pressure varies across points
    const firstPByte = n > 0 ? Math.round(clamp(pts[0].pressure, 0, 1) * 255) : 128;
    let hasPressureArray = false;
    for (let i = 1; i < n; i++) {
      if (Math.round(clamp(pts[i].pressure, 0, 1) * 255) !== firstPByte) {
        hasPressureArray = true;
        break;
      }
    }

    // Store timestamps only for fountain/brush strokes that actually have them
    const allowTime = s.tool === 'pen' && (s.penStyle === 'fountain' || s.penStyle === 'brush');
    let hasTimeArray = false;
    if (allowTime && n > 0) {
      for (let i = 0; i < n; i++) {
        if (typeof pts[i].t === 'number' && Number.isFinite(pts[i].t)) {
          hasTimeArray = true;
          break;
        }
      }
    }

    const hasExtraParams =
      s.nibAngle !== undefined ||
      s.nibFlatness !== undefined ||
      s.brushDynamics !== undefined;

    const flags =
      (toolCode & 0x07) |
      ((styleCode & 0x03) << 3) |
      (hasPressureArray ? FLAG_HAS_PRESSURE_ARRAY : 0) |
      (hasTimeArray ? FLAG_HAS_TIME_ARRAY : 0) |
      (hasExtraParams ? FLAG_HAS_EXTRA_PARAMS : 0);

    writer.writeString(s.id);
    writer.writeU8(flags);

    // Compact color
    if (s.color === 'auto') {
      writer.writeU8(0);
    } else {
      const rgb = parseHex6Color(s.color);
      if (rgb) {
        writer.writeU8(1);
        writer.writeU8(rgb[0]);
        writer.writeU8(rgb[1]);
        writer.writeU8(rgb[2]);
      } else {
        writer.writeU8(2);
        writer.writeString(s.color);
      }
    }

    writer.writeU16(Math.round(clamp(s.width, 0.1, 6500) * 10));
    writer.writeU8(Math.round(clamp(s.opacity, 0, 1) * 255));

    if (hasExtraParams) {
      const angle = Math.round(clamp(s.nibAngle ?? DEFAULT_FOUNTAIN_NIB_ANGLE, 0, 360));
      const flatness = Math.round(clamp(s.nibFlatness ?? DEFAULT_FOUNTAIN_FLATNESS, 0, 1) * 200);
      const dynamics = Math.round(clamp(s.brushDynamics ?? DEFAULT_BRUSH_DYNAMICS, 0, 2.5) * 100);
      writer.writeU16(angle);
      writer.writeU8(flatness);
      writer.writeU8(dynamics);
    }

    writer.writeVarUint(n);

    // Delta-encoded (x, y) in tenths of a logical pixel
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < n; i++) {
      const xTenths = toCoordTenths(pts[i].x);
      const yTenths = toCoordTenths(pts[i].y);
      writer.writeVarSint(xTenths - prevX);
      writer.writeVarSint(yTenths - prevY);
      prevX = xTenths;
      prevY = yTenths;
    }

    // Pressure
    if (n > 0) {
      if (hasPressureArray) {
        for (let i = 0; i < n; i++) {
          writer.writeU8(Math.round(clamp(pts[i].pressure, 0, 1) * 255));
        }
      } else {
        writer.writeU8(firstPByte);
      }
    }

    // Optional relative timestamps (delta-encoded ms)
    if (hasTimeArray) {
      let prevT = 0;
      for (let i = 0; i < n; i++) {
        const rawT = pts[i].t;
        const currT =
          typeof rawT === 'number' && Number.isFinite(rawT)
            ? Math.max(prevT, Math.round(rawT))
            : prevT;
        writer.writeVarUint(currT - prevT);
        prevT = currT;
      }
    }
  }

  return writer.toUint8Array();
}

/**
 * Decodes a binary `Uint8Array` stroke chunk produced by `encodeStrokesBinary`.
 */
export function decodeStrokesBinary(bytes: Uint8Array): Stroke[] {
  if (bytes.length < 4 || bytes[0] !== MAGIC_0 || bytes[1] !== MAGIC_1) {
    return [];
  }
  const version = bytes[2];
  if (version !== FORMAT_VERSION) {
    return [];
  }

  const reader = new ByteReader(bytes.subarray(3));
  const strokeCount = reader.readVarUint();
  const strokes: Stroke[] = new Array(strokeCount);

  for (let sIdx = 0; sIdx < strokeCount; sIdx++) {
    const id = reader.readString();
    const flags = reader.readU8();

    const tool = CODE_TO_TOOL[flags & 0x07] ?? 'pen';
    const penStyle = CODE_TO_PEN_STYLE[(flags >>> 3) & 0x03];
    const hasPressureArray = (flags & FLAG_HAS_PRESSURE_ARRAY) !== 0;
    const hasTimeArray = (flags & FLAG_HAS_TIME_ARRAY) !== 0;
    const hasExtraParams = (flags & FLAG_HAS_EXTRA_PARAMS) !== 0;

    const colorTag = reader.readU8();
    let color: string;
    if (colorTag === 0) {
      color = 'auto';
    } else if (colorTag === 1) {
      const r = reader.readU8();
      const g = reader.readU8();
      const b = reader.readU8();
      color = `#${byteToHex2(r)}${byteToHex2(g)}${byteToHex2(b)}`;
    } else {
      color = reader.readString();
    }

    const width = reader.readU16() / 10;
    const opacity = Math.round((reader.readU8() / 255) * 1000) / 1000;

    let nibAngle: number | undefined;
    let nibFlatness: number | undefined;
    let brushDynamics: number | undefined;
    if (hasExtraParams) {
      const angle = reader.readU16();
      const flatness = reader.readU8() / 200;
      const dynamics = reader.readU8() / 100;
      if (penStyle === 'fountain') {
        nibAngle = angle;
        nibFlatness = flatness;
      } else if (penStyle === 'brush') {
        brushDynamics = dynamics;
      }
    }

    const n = reader.readVarUint();
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);

    let accX = 0;
    let accY = 0;
    for (let i = 0; i < n; i++) {
      accX += reader.readVarSint();
      accY += reader.readVarSint();
      xs[i] = accX / 10;
      ys[i] = accY / 10;
    }

    const points: StrokePoint[] = new Array(n);
    if (n > 0) {
      if (hasPressureArray) {
        for (let i = 0; i < n; i++) {
          const p = Math.round((reader.readU8() / 255) * 1000) / 1000;
          points[i] = { x: xs[i], y: ys[i], pressure: p };
        }
      } else {
        const constP = Math.round((reader.readU8() / 255) * 1000) / 1000;
        for (let i = 0; i < n; i++) {
          points[i] = { x: xs[i], y: ys[i], pressure: constP };
        }
      }
    }

    if (hasTimeArray) {
      let accT = 0;
      for (let i = 0; i < n; i++) {
        accT += reader.readVarUint();
        points[i].t = accT;
      }
    }

    const stroke: Stroke = {
      id,
      tool,
      ...(penStyle ? { penStyle } : {}),
      ...(nibAngle !== undefined ? { nibAngle } : {}),
      ...(nibFlatness !== undefined ? { nibFlatness } : {}),
      ...(brushDynamics !== undefined ? { brushDynamics } : {}),
      color,
      width,
      opacity,
      points,
    };
    strokes[sIdx] = stroke;
  }

  return strokes;
}

/**
 * Fast, allocation-free estimate of how many bytes a stroke occupies in the binary v2 format.
 */
export function estimateStrokeBinaryBytes(stroke: Stroke): number {
  const n = stroke.points.length;
  const headerBytes = 12 + stroke.id.length;
  const usesVelocity = stroke.tool === 'pen' && (stroke.penStyle === 'fountain' || stroke.penStyle === 'brush');
  const bytesPerPoint =
    stroke.tool !== 'pen'
      ? 2.8
      : usesVelocity
        ? 4.8
        : 3.8;
  return Math.round(headerBytes + n * bytesPerPoint);
}
