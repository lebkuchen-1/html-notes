export const RULER_HEIGHT_PX = 64;
export const RULER_HALF_HEIGHT_PX = RULER_HEIGHT_PX / 2;
export const RULER_VISUAL_LENGTH_PX = 2800;

/**
 * Logical pixels per centimeter (aligned to A4 width: 794px = 21.0 cm, ~96 DPI).
 */
export const LOGICAL_PX_PER_CM = 794 / 21;

export type RulerSide = 'top' | 'bottom';

export interface RulerState {
  visible: boolean;
  /** Center X in CSS px relative to the canvas stage container */
  cx: number;
  /** Center Y in CSS px relative to the canvas stage container */
  cy: number;
  /** Rotation in degrees in [-180, 180) */
  angleDeg: number;
}

export interface RulerGeometry {
  centerClientX: number;
  centerClientY: number;
  /** Unit vector along the ruler's length */
  ux: number;
  uy: number;
  /** Unit normal pointing toward the bottom edge (+Y at 0 deg) */
  nx: number;
  ny: number;
  halfHeightPx: number;
}

export interface RulerStrokeLock {
  side: RulerSide;
  /** Client-space point on the locked drawing guide line (edge + outward stroke half-width) */
  originClientX: number;
  originClientY: number;
  /** Unit direction along the ruler edge */
  ux: number;
  uy: number;
}

export interface RulerDrawAdapter {
  /** Attempts to snap a stroke starting at client coordinates to either ruler edge */
  acquireLock: (
    clientX: number,
    clientY: number,
    strokeWidthCss: number
  ) => RulerStrokeLock | null;
  /** Updates live edge feedback & measured length while drawing along the ruler */
  updateActiveLength: (side: RulerSide, logicalLengthPx: number) => void;
  /** Clears live edge feedback when the stroke finishes or cancels */
  releaseLock: () => void;
}

/** Normalizes any angle in degrees into [-180, 180). */
export function normalizeAngle180(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(a, -0) || Math.abs(a) < 1e-6) a = 0;
  return a;
}

/**
 * Returns the intuitive display tilt in (-90, 90] (0° horizontal, 90° vertical, ±45° diagonal)
 * because both ruler edges are symmetric.
 */
export function getRulerDisplayAngle(deg: number): number {
  let a = normalizeAngle180(deg);
  if (a > 90) a -= 180;
  else if (a <= -90) a += 180;
  const rounded = Math.round(a);
  if (rounded === -90) return 90;
  if (Object.is(rounded, -0)) return 0;
  return rounded;
}

export function formatRulerAngle(deg: number): string {
  return `${getRulerDisplayAngle(deg)}°`;
}

export function formatRulerLengthCm(logicalPx: number): string {
  const cm = Math.max(0, logicalPx / LOGICAL_PX_PER_CM);
  return `${cm.toFixed(1).replace('.', ',')} cm`;
}

/**
 * Gently snaps angles near 45° multiples (±2.4°) and 15° multiples (±1.1°)
 * unless snapping is disabled (e.g. holding Alt).
 */
export function snapRulerAngle(
  rawDeg: number,
  disableSnap = false
): { angleDeg: number; snapped: boolean; isMajor: boolean } {
  const norm = normalizeAngle180(rawDeg);
  if (disableSnap) {
    return { angleDeg: norm, snapped: false, isMajor: false };
  }

  const nearest45 = Math.round(norm / 45) * 45;
  if (Math.abs(norm - nearest45) <= 2.4) {
    return {
      angleDeg: normalizeAngle180(nearest45),
      snapped: true,
      isMajor: true,
    };
  }

  const nearest15 = Math.round(norm / 15) * 15;
  if (Math.abs(norm - nearest15) <= 1.1) {
    return {
      angleDeg: normalizeAngle180(nearest15),
      snapped: true,
      isMajor: false,
    };
  }

  return { angleDeg: norm, snapped: false, isMajor: false };
}

export function clampRulerCenter(
  cx: number,
  cy: number,
  containerWidth: number,
  containerHeight: number
): { cx: number; cy: number } {
  const padX = Math.min(44, Math.max(20, containerWidth * 0.1));
  const padY = Math.min(36, Math.max(20, containerHeight * 0.1));
  return {
    cx: Math.max(padX, Math.min(Math.max(padX, containerWidth - padX), cx)),
    cy: Math.max(padY, Math.min(Math.max(padY, containerHeight - padY), cy)),
  };
}

export function computeRulerGeometry(
  state: RulerState,
  containerRect: DOMRect
): RulerGeometry {
  const rad = (state.angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const nx = -uy;
  const ny = ux;
  return {
    centerClientX: containerRect.left + state.cx,
    centerClientY: containerRect.top + state.cy,
    ux,
    uy,
    nx,
    ny,
    halfHeightPx: RULER_HALF_HEIGHT_PX,
  };
}

/**
 * Checks whether a pointerdown at (clientX, clientY) is within the magnetic snap zone
 * of the ruler's top or bottom edge (-10px inside the bevel to +30px outside the edge).
 */
export function trySnapToRulerEdge(
  clientX: number,
  clientY: number,
  geometry: RulerGeometry,
  strokeWidthCss: number
): RulerStrokeLock | null {
  const dx = clientX - geometry.centerClientX;
  const dy = clientY - geometry.centerClientY;
  const along = dx * geometry.ux + dy * geometry.uy;

  if (Math.abs(along) > RULER_VISUAL_LENGTH_PX * 0.5 + 20) {
    return null;
  }

  const signedNormal = dx * geometry.nx + dy * geometry.ny;
  const side: RulerSide = signedNormal >= 0 ? 'bottom' : 'top';
  const distOutsideEdge = Math.abs(signedNormal) - geometry.halfHeightPx;

  // Snap zone: slight overlap inside the translucent beveled edge (-10px) up to 30px outside
  if (distOutsideEdge < -10 || distOutsideEdge > 30) {
    return null;
  }

  const outNx = side === 'bottom' ? geometry.nx : -geometry.nx;
  const outNy = side === 'bottom' ? geometry.ny : -geometry.ny;
  // Offset the guide slightly outside the physical edge so ink sits flush against the ruler
  const outwardOffset = Math.max(1.5, Math.min(20, strokeWidthCss * 0.5 + 0.5));
  const edgeDistance = geometry.halfHeightPx + outwardOffset;

  return {
    side,
    originClientX: geometry.centerClientX + outNx * edgeDistance,
    originClientY: geometry.centerClientY + outNy * edgeDistance,
    ux: geometry.ux,
    uy: geometry.uy,
  };
}

export function projectClientPointToRulerLock(
  clientX: number,
  clientY: number,
  lock: RulerStrokeLock
): { clientX: number; clientY: number; alongPx: number } {
  const alongPx =
    (clientX - lock.originClientX) * lock.ux +
    (clientY - lock.originClientY) * lock.uy;
  return {
    clientX: lock.originClientX + lock.ux * alongPx,
    clientY: lock.originClientY + lock.uy * alongPx,
    alongPx,
  };
}
