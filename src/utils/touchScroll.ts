import type { PalmSensitivity } from '../types';

export interface TouchRadiusLike {
  radiusX?: number;
  radiusY?: number;
}

export interface PalmProfile {
  /** Hard palm rejection: geometric mean radius sqrt(rx*ry) above this is definitely a palm/wrist */
  hardPalmGeoRadius: number;
  /** Hard palm rejection: single-axis radius above this is definitely a palm/wrist */
  hardPalmMaxRadius: number;
  /** Hard palm rejection if contact spreads before scroll engages (forgiving for rolling thumbs) */
  hardPalmGrowGeoRadius: number;
  hardPalmGrowMaxRadius: number;
  /** Broad touch (thumb / flat or angled finger): uses slightly higher start threshold instead of rejecting */
  broadTouchRadius: number;
  /** PointerEvent width/height diameter limit for finger drawing when stylusOnly is OFF */
  pointerWidth: number;
  /** Movement threshold (CSS px) for upright fingertip */
  baseThreshold: number;
  /** Movement threshold (CSS px) for broad touch (thumb / angled finger) */
  broadThreshold: number;
  /** Movement threshold (CSS px) right after pen lifts (< 350ms) */
  postPenThreshold: number;
  /** Snap-back window when Apple Pencil lands right after a touch starts scrolling */
  snapWindowMs: number;
  snapMaxPx: number;
}

export function getPalmProfile(level: PalmSensitivity): PalmProfile {
  if (level === 'low') {
    return {
      hardPalmGeoRadius: 68,
      hardPalmMaxRadius: 86,
      hardPalmGrowGeoRadius: 74,
      hardPalmGrowMaxRadius: 94,
      broadTouchRadius: 42,
      pointerWidth: 82,
      baseThreshold: 6,
      broadThreshold: 9,
      postPenThreshold: 10,
      snapWindowMs: 180,
      snapMaxPx: 26,
    };
  }
  if (level === 'high') {
    return {
      hardPalmGeoRadius: 48,
      hardPalmMaxRadius: 62,
      hardPalmGrowGeoRadius: 54,
      hardPalmGrowMaxRadius: 68,
      broadTouchRadius: 28,
      pointerWidth: 54,
      baseThreshold: 8,
      broadThreshold: 13,
      postPenThreshold: 20,
      snapWindowMs: 380,
      snapMaxPx: 54,
    };
  }
  return {
    hardPalmGeoRadius: 56,
    hardPalmMaxRadius: 72,
    hardPalmGrowGeoRadius: 62,
    hardPalmGrowMaxRadius: 80,
    broadTouchRadius: 34,
    pointerWidth: 68,
    baseThreshold: 7,
    broadThreshold: 11,
    postPenThreshold: 14,
    snapWindowMs: 280,
    snapMaxPx: 40,
  };
}

export function getTouchRadii(t: TouchRadiusLike): { maxR: number; geoR: number } {
  const rx = Number.isFinite(t.radiusX) ? Math.max(0, t.radiusX ?? 0) : 0;
  const ry = Number.isFinite(t.radiusY) ? Math.max(0, t.radiusY ?? 0) : 0;
  const maxR = Math.max(rx, ry);
  const geoR = rx > 0 && ry > 0 ? Math.sqrt(rx * ry) : maxR;
  return { maxR, geoR };
}

/**
 * True only for genuinely massive palm/wrist contacts.
 * Thumbs and flat/angled fingers (including elongated sideways thumb rolls) return false so
 * 1-finger scrolling and 2-finger pinch-to-zoom remain reliable from any hand posture.
 */
export function isHardPalmTouch(t: TouchRadiusLike, profile: PalmProfile): boolean {
  const { maxR, geoR } = getTouchRadii(t);
  return geoR > profile.hardPalmGeoRadius || maxR > profile.hardPalmMaxRadius;
}

/** Pre-engage growth check with extra headroom while a thumb flattens at the start of a swipe */
export function isHardPalmGrowTouch(t: TouchRadiusLike, profile: PalmProfile): boolean {
  const { maxR, geoR } = getTouchRadii(t);
  return geoR > profile.hardPalmGrowGeoRadius || maxR > profile.hardPalmGrowMaxRadius;
}

/** True for thumbs or flat/angled fingers (larger than an upright fingertip, smaller than a palm) */
export function isBroadTouch(t: TouchRadiusLike, profile: PalmProfile): boolean {
  const { maxR, geoR } = getTouchRadii(t);
  return geoR > profile.broadTouchRadius || maxR > profile.broadTouchRadius + 6;
}

/** Picks the 1-finger pan engagement threshold (CSS px) based on contact footprint & recent pen use */
export function getOneFingerPanThreshold(
  t: TouchRadiusLike,
  profile: PalmProfile,
  penJustUsed: boolean
): number {
  if (penJustUsed) return profile.postPenThreshold;
  return isBroadTouch(t, profile) ? profile.broadThreshold : profile.baseThreshold;
}

// ==================== DIRECTIONAL 1-FINGER SCROLL STABILIZATION ====================

export type ScrollAxisLock = 'x' | 'y' | 'free';

export interface ScrollAxisState {
  lock: ScrollAxisLock;
  canScrollX: boolean;
  canScrollY: boolean;
  startX: number;
  startY: number;
  lockAnchorX: number;
  lockAnchorY: number;
  recentDx: number;
  recentDy: number;
  lockRefined: boolean;
  hasBrokenOut: boolean;
  brokenOutFrom: 'x' | 'y' | null;
  breakoutDist: number;
}

// Straight-scroll lock cone: ~±34.6° around vertical & horizontal absorbs natural thumb arcs
const INITIAL_LOCK_RATIO = 1.45;
// Second-chance lock if landing jitter was ambiguous at 7-11px but travel is straight by 18px
const REFINE_DIST_PX = 18;
const REFINE_LOCK_RATIO = 1.65;
// Cross-axis tolerance before breaking out into free 2D panning
const SOFT_BREAKOUT_PX = 26;
const MED_BREAKOUT_PX = 42;
const HARD_BREAKOUT_PX = 68;
// Smooth ease-in distance after breaking out of an axis lock (zero jump!)
const BREAKOUT_RAMP_PX = 20;

export function createScrollAxisState(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  canScrollX: boolean,
  canScrollY: boolean
): ScrollAxisState {
  let lock: ScrollAxisLock = 'free';
  let lockRefined = false;

  if (canScrollY && !canScrollX) {
    lock = 'y';
    lockRefined = true;
  } else if (canScrollX && !canScrollY) {
    lock = 'x';
    lockRefined = true;
  } else if (!canScrollX && !canScrollY) {
    lock = 'free';
    lockRefined = true;
  } else {
    const absX = Math.abs(currentX - startX);
    const absY = Math.abs(currentY - startY);
    if (absY >= absX * INITIAL_LOCK_RATIO) {
      lock = 'y';
      lockRefined = true;
    } else if (absX >= absY * INITIAL_LOCK_RATIO) {
      lock = 'x';
      lockRefined = true;
    }
  }

  return {
    lock,
    canScrollX,
    canScrollY,
    startX,
    startY,
    lockAnchorX: currentX,
    lockAnchorY: currentY,
    recentDx: currentX - startX,
    recentDy: currentY - startY,
    lockRefined,
    hasBrokenOut: false,
    brokenOutFrom: null,
    breakoutDist: 0,
  };
}

/**
 * Stabilizes straight vertical & horizontal 1-finger scrolling with natural thumb-arc tolerance,
 * while seamlessly breaking out into free 2D panning (with zero jump) when the user intentionally
 * changes direction or drags diagonally.
 */
export function filterScrollDelta(
  state: ScrollAxisState,
  dx: number,
  dy: number,
  currentX: number,
  currentY: number
): { appliedDx: number; appliedDy: number } {
  // Single-axis containers (e.g. multi-page view at 100% zoom) never lock against the only scrollable axis
  if (state.canScrollY && !state.canScrollX) {
    return { appliedDx: 0, appliedDy: dy };
  }
  if (state.canScrollX && !state.canScrollY) {
    return { appliedDx: dx, appliedDy: 0 };
  }
  if (!state.canScrollX && !state.canScrollY) {
    return { appliedDx: 0, appliedDy: 0 };
  }

  const stepDist = Math.hypot(dx, dy);
  if (stepDist > 0.001) {
    const retain = Math.exp(-stepDist / 48);
    state.recentDx = state.recentDx * retain + dx;
    state.recentDy = state.recentDy * retain + dy;
  }

  // If landing noise made the initial 7-11px vector look diagonal, re-check once travel hits 18px
  if (!state.lockRefined && !state.hasBrokenOut && state.lock === 'free') {
    const totalDx = currentX - state.startX;
    const totalDy = currentY - state.startY;
    const totalDist = Math.hypot(totalDx, totalDy);
    if (totalDist >= REFINE_DIST_PX) {
      state.lockRefined = true;
      const absX = Math.abs(totalDx);
      const absY = Math.abs(totalDy);
      if (absY >= absX * REFINE_LOCK_RATIO) {
        state.lock = 'y';
        state.lockAnchorX = currentX;
        state.lockAnchorY = currentY;
      } else if (absX >= absY * REFINE_LOCK_RATIO) {
        state.lock = 'x';
        state.lockAnchorX = currentX;
        state.lockAnchorY = currentY;
      }
    }
  }

  if (state.lock === 'y') {
    const crossFromAnchor = Math.abs(currentX - state.lockAnchorX);
    const absRecentCross = Math.abs(state.recentDx);
    const absRecentMain = Math.abs(state.recentDy);
    const effectiveCross = Math.max(crossFromAnchor, absRecentCross);

    const shouldBreakOut =
      effectiveCross >= HARD_BREAKOUT_PX ||
      (effectiveCross >= MED_BREAKOUT_PX && absRecentCross >= absRecentMain * 0.45) ||
      (effectiveCross >= SOFT_BREAKOUT_PX &&
        absRecentCross >= 20 &&
        absRecentCross >= absRecentMain * 0.85);

    if (!shouldBreakOut) {
      return { appliedDx: 0, appliedDy: dy };
    }

    state.lock = 'free';
    state.hasBrokenOut = true;
    state.brokenOutFrom = 'y';
    state.breakoutDist = 0;
  } else if (state.lock === 'x') {
    const crossFromAnchor = Math.abs(currentY - state.lockAnchorY);
    const absRecentCross = Math.abs(state.recentDy);
    const absRecentMain = Math.abs(state.recentDx);
    const effectiveCross = Math.max(crossFromAnchor, absRecentCross);

    const shouldBreakOut =
      effectiveCross >= HARD_BREAKOUT_PX ||
      (effectiveCross >= MED_BREAKOUT_PX && absRecentCross >= absRecentMain * 0.45) ||
      (effectiveCross >= SOFT_BREAKOUT_PX &&
        absRecentCross >= 20 &&
        absRecentCross >= absRecentMain * 0.85);

    if (!shouldBreakOut) {
      return { appliedDx: dx, appliedDy: 0 };
    }

    state.lock = 'free';
    state.hasBrokenOut = true;
    state.brokenOutFrom = 'x';
    state.breakoutDist = 0;
  }

  // Smooth ease-in of the unlocked axis right after breaking out (prevents any snap/jerk)
  if (state.brokenOutFrom && state.breakoutDist < BREAKOUT_RAMP_PX) {
    state.breakoutDist += stepDist;
    const u = Math.min(1, state.breakoutDist / BREAKOUT_RAMP_PX);
    const weight = u * (2 - u);
    if (state.brokenOutFrom === 'y') {
      return { appliedDx: dx * weight, appliedDy: dy };
    }
    return { appliedDx: dx, appliedDy: dy * weight };
  }

  return { appliedDx: dx, appliedDy: dy };
}

/** Keeps momentum release crisp and drift-free on straight or nearly-straight flicks */
export function stabilizeReleaseVelocity(
  vx: number,
  vy: number,
  state: ScrollAxisState | null
): { vx: number; vy: number } {
  if (state?.lock === 'y') return { vx: 0, vy };
  if (state?.lock === 'x') return { vx, vy: 0 };

  const absX = Math.abs(vx);
  const absY = Math.abs(vy);
  if (absY >= absX * 2.2) return { vx: 0, vy };
  if (absX >= absY * 2.2) return { vx, vy: 0 };
  return { vx, vy };
}
