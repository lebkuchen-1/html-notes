import type { StabilizationLevel, StrokePoint } from '../types';

export type { StabilizationLevel };

interface StabilizerPreset {
  minCutoff: number;
  beta: number;
  dCutoff: number;
  minSpacing: number;
  pressureSmoothing: number;
  polishWeight: number;
}

const PRESETS: Record<StabilizationLevel, StabilizerPreset> = {
  off: {
    minCutoff: 0,
    beta: 0,
    dCutoff: 1,
    minSpacing: 1.1,
    pressureSmoothing: 0.45,
    polishWeight: 0,
  },
  // Tuned for natural handwriting: removes micro-tremor without feeling laggy or rounding sharp letters
  light: {
    minCutoff: 11.5,
    beta: 0.065,
    dCutoff: 1.0,
    minSpacing: 1.7,
    pressureSmoothing: 0.62,
    polishWeight: 0.14,
  },
  medium: {
    minCutoff: 6.8,
    beta: 0.045,
    dCutoff: 1.0,
    minSpacing: 2.1,
    pressureSmoothing: 0.7,
    polishWeight: 0.22,
  },
};

function smoothingFactor(dtSec: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSec;
  return r / (r + 1);
}

/**
 * Velocity-adaptive One-Euro filter for natural stylus/mouse handwriting stabilization.
 * - Keeps the exact initial point (pinpoint accuracy for dots and stroke starts).
 * - Smooths slow hand-tremor while ramping responsiveness quickly on fast strokes & corners.
 */
export class StrokeStabilizer {
  private readonly level: StabilizationLevel;
  private readonly preset: StabilizerPreset;
  private initialized = false;
  private lastTimeMs = 0;
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;
  private lastRawX = 0;
  private lastRawY = 0;
  private lastPressure = 0.5;

  constructor(level: StabilizationLevel) {
    this.level = level;
    this.preset = PRESETS[level];
  }

  get minSpacing(): number {
    return this.preset.minSpacing;
  }

  get pressureSmoothing(): number {
    return this.preset.pressureSmoothing;
  }

  reset() {
    this.initialized = false;
    this.lastTimeMs = 0;
    this.dx = 0;
    this.dy = 0;
  }

  filter(raw: StrokePoint, timeMs: number): StrokePoint {
    this.lastRawX = raw.x;
    this.lastRawY = raw.y;
    this.lastPressure = raw.pressure;

    if (!this.initialized || this.level === 'off') {
      this.initialized = true;
      this.lastTimeMs = timeMs;
      this.x = raw.x;
      this.y = raw.y;
      this.dx = 0;
      this.dy = 0;
      return raw;
    }

    // Coalesced events on iPadOS Safari can share identical timestamps (dt === 0);
    // fall back to ~120Hz (8.33ms) and clamp large gaps so cutoff stays stable.
    const rawDtMs = timeMs - this.lastTimeMs;
    const dtSec =
      rawDtMs > 0.5 && rawDtMs < 80 ? rawDtMs / 1000 : 1 / 120;
    this.lastTimeMs = timeMs;

    const instDx = (raw.x - this.x) / dtSec;
    const instDy = (raw.y - this.y) / dtSec;

    const aD = smoothingFactor(dtSec, this.preset.dCutoff);
    this.dx = this.dx + aD * (instDx - this.dx);
    this.dy = this.dy + aD * (instDy - this.dy);

    const speed = Math.hypot(this.dx, this.dy);
    const cutoff = this.preset.minCutoff + this.preset.beta * speed;
    const alpha = smoothingFactor(dtSec, cutoff);

    this.x = this.x + alpha * (raw.x - this.x);
    this.y = this.y + alpha * (raw.y - this.y);

    return {
      x: this.x,
      y: this.y,
      pressure: raw.pressure,
    };
  }

  /**
   * Gently closes any tiny trailing gap to the actual pen lift position and runs
   * a subtle corner-preserving micro-polish pass (never rounds sharp letter corners).
   */
  finalize(points: StrokePoint[]): StrokePoint[] {
    if (this.level === 'off' || points.length < 2) {
      return points;
    }

    const result = points.slice();

    // Catch up gently to exact pen-up endpoint so strokes never feel cut short
    if (this.initialized) {
      const last = result[result.length - 1];
      const gap = Math.hypot(this.lastRawX - last.x, this.lastRawY - last.y);
      if (gap >= 0.9 && gap < 28) {
        result.push({
          x: last.x + (this.lastRawX - last.x) * 0.72,
          y: last.y + (this.lastRawY - last.y) * 0.72,
          pressure: this.lastPressure,
        });
      }
    }

    const w = this.preset.polishWeight;
    if (w <= 0 || result.length < 4) {
      return result;
    }

    // Single angle-aware Laplacian pass: smooths 1-sample micro-wobble while keeping corners crisp
    const polished: StrokePoint[] = [result[0]];
    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];

      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);

      if (len1 < 0.01 || len2 < 0.01) {
        polished.push(curr);
        continue;
      }

      // cos(theta) close to 1 = smooth continuation; lower = sharp corner (preserve!)
      const cosAngle = (v1x * v2x + v1y * v2y) / (len1 * len2);
      if (cosAngle < 0.55) {
        polished.push(curr);
        continue;
      }

      const avgX = (prev.x + next.x) * 0.5;
      const avgY = (prev.y + next.y) * 0.5;
      const avgP = (prev.pressure + next.pressure) * 0.5;
      const factor = w * Math.min(1, (cosAngle - 0.55) / 0.45);

      polished.push({
        x: curr.x + (avgX - curr.x) * factor,
        y: curr.y + (avgY - curr.y) * factor,
        pressure: curr.pressure + (avgP - curr.pressure) * factor,
      });
    }
    polished.push(result[result.length - 1]);

    return polished;
  }
}
