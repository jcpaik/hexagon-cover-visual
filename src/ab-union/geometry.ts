import { fitTriangle } from '../cover';
import { closestPointOnSegment, distance, distanceToSegment, pointInTriangle } from '../geometry';
import { HEXAGON_VERTICES } from '../hexagon';
import { CIRCUMRADIUS, getVertices } from '../triangle';
import type { Point, TriangleState } from '../types';
import type {
  AbUnionHexAxisHull,
  AbUnionLabel,
  AbUnionLocalLineSegment,
  AbUnionLocalRegionVariant,
  AbUnionMarkPrimitive,
  AbUnionMarkSourceRef,
  AbUnionState,
  HexAxisHull,
} from './types';

export const SQRT3 = Math.sqrt(3);
export const ANGLE_PERIOD = 2 * Math.PI / 3;
export const EPS = 1e-7;
const EPS2 = 1e-12;
const HEX_AXIS_HULL_STEPS = 3;
const HEX_AXIS_HULL_NEAR_EQUALITY_SUM = 0.9;
const HEX_AXIS_HULL_MIN_EDGE = 0.15;

export function mod6(index: number): number {
  return (index + 6) % 6;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

export function edgeVector(index: number): Point {
  const start = HEXAGON_VERTICES[index];
  const end = HEXAGON_VERTICES[mod6(index + 1)];
  return { x: end.x - start.x, y: end.y - start.y };
}

export function localCPoint(index: number, localC: number): Point {
  const vertex = HEXAGON_VERTICES[index];
  const radius = 1 - clamp01(localC);
  return { x: vertex.x * radius, y: vertex.y * radius };
}

export function pointOnEdge(index: number, value: number): Point {
  const start = HEXAGON_VERTICES[index];
  const edge = edgeVector(index);
  const clamped = clamp01(value);
  return { x: start.x + clamped * edge.x, y: start.y + clamped * edge.y };
}

export function pointInHex(point: Point): boolean {
  let inside = false;
  for (let i = 0, j = 5; i < 6; j = i++) {
    const vi = HEXAGON_VERTICES[i];
    const vj = HEXAGON_VERTICES[j];
    const crosses = (vi.y > point.y) !== (vj.y > point.y);
    if (crosses) {
      const xAtY = ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x;
      if (point.x < xAtY) inside = !inside;
    }
  }
  return inside;
}

export function pointInClosedHex(point: Point): boolean {
  for (let i = 0; i < 6; i++) {
    const a = HEXAGON_VERTICES[i];
    const b = HEXAGON_VERTICES[mod6(i + 1)];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross < -EPS) return false;
  }
  return true;
}

export function clampPointToHexagon(point: Point): Point {
  if (pointInClosedHex(point)) return point;
  let best = closestPointOnSegment(point, HEXAGON_VERTICES[0], HEXAGON_VERTICES[1]);
  let bestDistance = distance(point, best);
  for (let i = 1; i < 6; i++) {
    const candidate = closestPointOnSegment(point, HEXAGON_VERTICES[i], HEXAGON_VERTICES[mod6(i + 1)]);
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }
  return best;
}

function containsConeRegion(u: number, v: number, outLen: number, inLen: number): boolean {
  if (u < -EPS || v < -EPS) return false;

  const a = outLen;
  const b = inLen;
  const s2 = a * a + a * b + b * b;
  if (s2 > 1 + EPS) return false;

  if (a < EPS && b < EPS) {
    return u * u + v * v - u * v <= 1 + EPS;
  }

  if (a > EPS && b > EPS) {
    if (b * u + a * v <= a * b + EPS) return true;
  } else if (a > EPS) {
    if (Math.abs(v) <= EPS && u <= a + EPS) return true;
  } else if (b > EPS) {
    if (Math.abs(u) <= EPS && v <= b + EPS) return true;
  }

  if (Math.max(a + b, a - u + v, u + b, v) <= 1 + EPS) return true;
  if (Math.max(a + b, b - v + u, v + a, u) <= 1 + EPS) return true;

  const du = u - a;
  const da2 = du * du + v * v - du * v;
  if (da2 > EPS2) {
    const da = Math.sqrt(da2);
    const p = a * (a - u + v) + b * v;
    const q = a * (a - u);
    const s = a * (a + b - u) + b * (v - u);
    const ell = Math.max(da, p / da) - Math.min(0, q / da, s / da);
    if (ell <= 1 + EPS) return true;
  }

  const dv = v - b;
  const db2 = u * u + dv * dv - u * dv;
  if (db2 > EPS2) {
    const db = Math.sqrt(db2);
    const p = b * (b - v + u) + a * u;
    const q = b * (b - v);
    const s = b * (a + b - v) + a * (u - v);
    const ell = Math.max(db, p / db) - Math.min(0, q / db, s / db);
    if (ell <= 1 + EPS) return true;
  }

  return false;
}

function strictTwoLineSupersetPolygon(outLen: number, inLen: number): Point[] | null {
  const sum = outLen + inLen;
  const rho = outLen * outLen + outLen * inLen + inLen * inLen;
  if (sum <= 1 + EPS || rho >= 1 - EPS || outLen <= EPS || inLen <= EPS) return null;

  const dSquared = 4 * rho - 3;
  if (dSquared < -EPS) return null;

  const h = Math.sqrt(3) / 2;
  const d = Math.sqrt(Math.max(0, dSquared));
  const denominator = 2 * rho;
  const alpha = h * (outLen + 2 * inLen - outLen * d) / denominator;
  const beta = h * (outLen - inLen + sum * d) / denominator;
  const gamma = h * (-outLen + inLen + sum * d) / denominator;
  const delta = h * (2 * outLen + inLen - inLen * d) / denominator;
  const omega = alpha * delta - gamma * beta;
  if (
    alpha <= EPS ||
    beta <= EPS ||
    gamma <= EPS ||
    delta <= EPS ||
    omega <= EPS
  ) {
    return null;
  }

  const yAxisHit = alpha * outLen / beta;
  const xAxisHit = delta * inLen / gamma;
  const p2 = {
    x: delta * (outLen * alpha - inLen * beta) / omega,
    y: alpha * (inLen * delta - outLen * gamma) / omega,
  };
  if (
    !Number.isFinite(yAxisHit) ||
    !Number.isFinite(xAxisHit) ||
    !Number.isFinite(p2.x) ||
    !Number.isFinite(p2.y) ||
    yAxisHit < -EPS ||
    xAxisHit < -EPS ||
    p2.x < -EPS ||
    p2.y < -EPS
  ) {
    return null;
  }

  return [
    { x: 0, y: 0 },
    { x: 0, y: Math.max(0, yAxisHit) },
    { x: Math.max(0, p2.x), y: Math.max(0, p2.y) },
    { x: Math.max(0, xAxisHit), y: 0 },
  ];
}

export function abUnionStrictTwoLineSupersetSegments(a: number, b: number): AbUnionLocalLineSegment[] {
  const polygon = strictTwoLineSupersetPolygon(b, a);
  if (polygon === null) return [];
  return [
    { start: polygon[1], end: polygon[2] },
    { start: polygon[2], end: polygon[3] },
  ];
}

function containsStrictTwoLineSupersetLocal(u: number, v: number, outLen: number, inLen: number): boolean {
  const polygon = strictTwoLineSupersetPolygon(outLen, inLen);
  return polygon === null
    ? containsConeRegion(u, v, outLen, inLen)
    : containsConeRegion(u, v, outLen, inLen) || pointInConvexPolygon({ x: u, y: v }, polygon);
}

function containsLocalRegion(
  u: number,
  v: number,
  outLen: number,
  inLen: number,
  variant: AbUnionLocalRegionVariant,
): boolean {
  return variant === 'strict-two-line-superset'
    ? containsStrictTwoLineSupersetLocal(u, v, outLen, inLen)
    : containsConeRegion(u, v, outLen, inLen);
}

export function containsAbUnionLocal(
  u: number,
  v: number,
  a: number,
  b: number,
  variant: AbUnionLocalRegionVariant = 'exact',
): boolean {
  if (variant === 'strict-two-line-superset') {
    return containsStrictTwoLineSupersetLocal(u, v, b, a);
  }
  return containsConeRegion(u, v, b, a);
}

function inCornerSector(u: number, v: number): boolean {
  return u <= 1 + EPS && v <= 1 + EPS;
}

function inLocalHexFootprint(u: number, v: number): boolean {
  return u >= -EPS &&
    u <= 2 + EPS &&
    v >= -EPS &&
    v <= 2 + EPS &&
    Math.abs(u - v) <= 1 + EPS;
}

export function containsExactRegionLocal(
  state: AbUnionState,
  u: number,
  v: number,
  outLen: number,
  inLen: number,
  variant: AbUnionLocalRegionVariant,
): boolean {
  return (
    (!state.clipToCornerSectors || inCornerSector(u, v)) &&
    containsLocalRegion(u, v, outLen, inLen, variant)
  );
}

export function shouldUseHexAxisHull(state: AbUnionState, outLen: number, inLen: number): boolean {
  return state.useAxisAlignedHull && outLen + inLen < 1 - EPS;
}

function emptyHexAxisHull(): HexAxisHull {
  return {
    maxU: 0,
    slabs: [],
  };
}

export function abUnionAdjacentBoundaryHit(edgeOppositeLength: number): number {
  const value = clamp01(edgeOppositeLength);
  return Math.max(0, (-value + Math.sqrt(Math.max(0, 4 - 3 * value * value))) / 2);
}

interface HexAxisHullSample {
  u: number;
  v: number;
  delta: number;
}

interface RawHexAxisHullSlab {
  uStart: number;
  uEnd: number;
  maxV: number;
  minDelta: number;
  maxDelta: number;
  found: boolean;
}

function uniqueSortedBreakpoints(values: number[], maxU: number): number[] {
  return values
    .map((value) => Math.max(0, Math.min(maxU, value)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .filter((value, index, array) => index === 0 || Math.abs(value - array[index - 1]) > EPS);
}

function coarsenHexAxisHullBreakpoints(breakpoints: number[], minEdge: number): number[] {
  const coarsened = breakpoints.slice();
  while (coarsened.length > 2) {
    let shortestGap = Number.POSITIVE_INFINITY;
    let removeIndex = -1;

    for (let index = 0; index < coarsened.length - 1; index++) {
      const gap = coarsened[index + 1] - coarsened[index];
      if (gap >= minEdge - EPS || gap >= shortestGap) continue;

      shortestGap = gap;
      if (index === 0) {
        removeIndex = 1;
      } else if (index === coarsened.length - 2) {
        removeIndex = coarsened.length - 2;
      } else {
        const removeLeftSpan = coarsened[index + 1] - coarsened[index - 1];
        const removeRightSpan = coarsened[index + 2] - coarsened[index];
        removeIndex = removeLeftSpan <= removeRightSpan ? index : index + 1;
      }
    }

    if (removeIndex < 1 || removeIndex >= coarsened.length - 1) break;
    coarsened.splice(removeIndex, 1);
  }

  return coarsened;
}

function adaptiveHexAxisHullBreakpoints(
  samples: HexAxisHullSample[],
  maxU: number,
  outLen: number,
  inLen: number,
  margin: number,
): number[] {
  const bottomHit = abUnionAdjacentBoundaryHit(inLen);
  const leftHit = abUnionAdjacentBoundaryHit(outLen);
  const coarse = Array.from({ length: HEX_AXIS_HULL_STEPS + 1 }, (_, index) =>
    (maxU * index) / HEX_AXIS_HULL_STEPS,
  );

  if (outLen + inLen < HEX_AXIS_HULL_NEAR_EQUALITY_SUM) {
    return coarsenHexAxisHullBreakpoints(uniqueSortedBreakpoints(coarse, maxU), HEX_AXIS_HULL_MIN_EDGE);
  }

  const topStart = samples.reduce(
    (best, sample) => sample.v >= 1 - 2 * margin ? Math.min(best, sample.u) : best,
    Number.POSITIVE_INFINITY,
  );
  const topEnd = samples.reduce(
    (best, sample) => sample.v >= 1 - 2 * margin ? Math.max(best, sample.u) : best,
    0,
  );
  const rightShelfV = Math.max(0, Math.min(1, 1 - outLen + margin));
  const rightShelfStart = samples.reduce(
    (best, sample) => sample.v > rightShelfV + EPS ? Math.max(best, sample.u) : best,
    0,
  );
  return uniqueSortedBreakpoints([
    0,
    1 - leftHit,
    1 - inLen,
    Number.isFinite(topStart) ? topStart + margin : 1 - leftHit,
    topEnd + margin,
    rightShelfStart + margin,
    bottomHit,
    maxU,
  ], maxU);
}

function fillRawHexAxisSlabs(slabs: RawHexAxisHullSlab[]): void {
  let previous: RawHexAxisHullSlab | null = null;
  for (const slab of slabs) {
    if (slab.found) {
      previous = slab;
    } else if (previous) {
      slab.maxV = previous.maxV;
      slab.minDelta = previous.minDelta;
      slab.maxDelta = previous.maxDelta;
    }
  }

  let next: RawHexAxisHullSlab | null = null;
  for (let index = slabs.length - 1; index >= 0; index--) {
    const slab = slabs[index];
    if (slab.found) {
      next = slab;
    } else if (next) {
      slab.maxV = next.maxV;
      slab.minDelta = next.minDelta;
      slab.maxDelta = next.maxDelta;
    }
  }
}

export function buildHexAxisHullFromSamples(
  sampleCount: number,
  getU: (index: number) => number,
  getV: (index: number) => number,
  containsSample: (index: number, u: number, v: number) => boolean,
  outLen: number,
  inLen: number,
  margin: number,
): HexAxisHull {
  let found = false;
  let maxU = 0;
  let minDelta = Number.POSITIVE_INFINITY;
  let maxDelta = Number.NEGATIVE_INFINITY;
  const samples: HexAxisHullSample[] = [];

  for (let k = 0; k < sampleCount; k++) {
    const u = getU(k);
    const v = getV(k);
    if (!containsSample(k, u, v)) continue;
    const delta = u - v;
    found = true;
    samples.push({ u, v, delta });
    maxU = Math.max(maxU, u);
    minDelta = Math.min(minDelta, delta);
    maxDelta = Math.max(maxDelta, delta);
  }

  if (!found) return emptyHexAxisHull();

  const bottomHit = abUnionAdjacentBoundaryHit(inLen);
  const leftHit = abUnionAdjacentBoundaryHit(outLen);
  const hullMaxU = Math.max(maxU, bottomHit) + margin;
  const globalMinDelta = Math.min(-leftHit, minDelta) - margin;
  const globalMaxDelta = Math.max(bottomHit, maxDelta) + margin;
  samples.push({ u: bottomHit, v: 0, delta: bottomHit });
  samples.push({ u: 0, v: leftHit, delta: -leftHit });

  const breakpoints = adaptiveHexAxisHullBreakpoints(samples, hullMaxU, outLen, inLen, margin);
  const rawSlabs: RawHexAxisHullSlab[] = [];
  for (let index = 0; index < breakpoints.length - 1; index++) {
    rawSlabs.push({
      uStart: breakpoints[index],
      uEnd: breakpoints[index + 1],
      maxV: Number.NEGATIVE_INFINITY,
      minDelta: Number.POSITIVE_INFINITY,
      maxDelta: Number.NEGATIVE_INFINITY,
      found: false,
    });
  }

  for (const sample of samples) {
    const slabIndex = rawSlabs.findIndex((slab, index) =>
      sample.u >= slab.uStart - EPS &&
      (sample.u < slab.uEnd - EPS || index === rawSlabs.length - 1 && sample.u <= slab.uEnd + EPS),
    );
    const slab = rawSlabs[
      slabIndex >= 0
        ? slabIndex
        : sample.u <= rawSlabs[0].uStart ? 0 : rawSlabs.length - 1
    ];
    slab.found = true;
    slab.maxV = Math.max(slab.maxV, Math.max(0, sample.v) + margin);
    slab.minDelta = Math.min(slab.minDelta, sample.delta);
    slab.maxDelta = Math.max(slab.maxDelta, sample.delta);
  }

  const useLocalDelta = outLen + inLen >= HEX_AXIS_HULL_NEAR_EQUALITY_SUM;
  fillRawHexAxisSlabs(rawSlabs);
  if (!useLocalDelta) {
    for (let i = rawSlabs.length - 2; i >= 0; i--) {
      rawSlabs[i].maxV = Math.max(rawSlabs[i].maxV, rawSlabs[i + 1].maxV);
    }
  }
  return {
    maxU: hullMaxU,
    slabs: rawSlabs.map((slab) => {
      const useLocalMaxDelta = useLocalDelta && slab.uStart >= bottomHit - EPS;
      return {
        uStart: slab.uStart,
        uEnd: slab.uEnd,
        maxV: slab.maxV,
        minDelta: useLocalDelta ? slab.minDelta - margin : globalMinDelta,
        maxDelta: useLocalMaxDelta ? slab.maxDelta + margin : globalMaxDelta,
      };
    }),
  };
}

export function buildAbUnionLocalHexAxisHull(
  a: number,
  b: number,
  sampleSteps: number,
  margin: number,
): AbUnionHexAxisHull {
  const steps = Math.max(1, Math.floor(sampleSteps));
  const samplesPerAxis = steps + 1;
  const sampleCount = samplesPerAxis * samplesPerAxis;
  const outLen = clamp01(b);
  const inLen = clamp01(a);

  return buildHexAxisHullFromSamples(
    sampleCount,
    (index) => (2 * Math.floor(index / samplesPerAxis)) / steps,
    (index) => (2 * (index % samplesPerAxis)) / steps,
    (_index, u, v) => inLocalHexFootprint(u, v) && containsConeRegion(u, v, outLen, inLen),
    outLen,
    inLen,
    Math.max(0, margin),
  );
}

export function pointInHexAxisHull(u: number, v: number, hull: HexAxisHull): boolean {
  if (u < -EPS || v < -EPS || u > hull.maxU + EPS) return false;
  const slab = hull.slabs.find((candidate, index) =>
    u >= candidate.uStart - EPS &&
    (u < candidate.uEnd - EPS || index === hull.slabs.length - 1 && u <= candidate.uEnd + EPS),
  );
  if (!slab) return false;
  const delta = u - v;
  return (
    delta >= slab.minDelta - EPS &&
    delta <= slab.maxDelta + EPS &&
    v <= slab.maxV + EPS
  );
}

export function lineIntersection(n1: Point, c1: number, n2: Point, c2: number): Point {
  const det = n1.x * n2.y - n1.y * n2.x;
  return {
    x: (c1 * n2.y - n1.y * c2) / det,
    y: (n1.x * c2 - c1 * n2.x) / det,
  };
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 1) return sorted;

  function cross(o: Point, a: Point, b: Point): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pointInConvexPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) <= EPS) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

export function localCHull(localCs: number[]): Point[] {
  return convexHull(localCs.map((value, index) => localCPoint(index, value)));
}

export function sameMarkSource(a: AbUnionMarkSourceRef, b: AbUnionMarkSourceRef): boolean {
  return a.kind === b.kind && a.index === b.index;
}

export function markSourceLabel(ref: AbUnionMarkSourceRef): string {
  if (ref.kind === 'hex-edge') return `e${ref.index}`;
  if (ref.kind === 'half-diagonal') return `r${ref.index}`;
  if (ref.kind === 'center-triangle-edge') return `C:e${ref.index}`;
  return 'C:circle';
}

export function isCenterMarkSource(ref: AbUnionMarkSourceRef): boolean {
  return ref.kind === 'center-triangle-edge' || ref.kind === 'center-circle';
}

export function isSkeletonMarkSource(ref: AbUnionMarkSourceRef): boolean {
  return ref.kind === 'hex-edge' || ref.kind === 'half-diagonal';
}

export function hexEdgeSource(label: AbUnionLabel): number | null {
  if (label.first?.kind === 'hex-edge') return label.first.index;
  if (label.second?.kind === 'hex-edge') return label.second.index;
  return null;
}

export function markPrimitiveForRef(
  ref: AbUnionMarkSourceRef,
  state: AbUnionState,
  triangleState: TriangleState,
): AbUnionMarkPrimitive | null {
  const index = ref.index;
  if (ref.kind === 'hex-edge') {
    if (!Number.isInteger(index) || index < 0 || index >= 6) return null;
    return {
      kind: 'line',
      ref,
      label: markSourceLabel(ref),
      start: HEXAGON_VERTICES[index],
      end: HEXAGON_VERTICES[mod6(index + 1)],
    };
  }
  if (ref.kind === 'half-diagonal') {
    if (!Number.isInteger(index) || index < 0 || index >= 6) return null;
    return {
      kind: 'line',
      ref,
      label: markSourceLabel(ref),
      start: { x: 0, y: 0 },
      end: HEXAGON_VERTICES[index],
    };
  }
  if (ref.kind === 'center-triangle-edge') {
    if (state.centerMode !== 'triangle' || !Number.isInteger(index) || index < 0 || index >= 3) return null;
    const vertices = getVertices(triangleState);
    return {
      kind: 'line',
      ref,
      label: markSourceLabel(ref),
      start: vertices[index],
      end: vertices[(index + 1) % 3],
    };
  }
  if (ref.kind === 'center-circle') {
    if (state.centerMode !== 'circle') return null;
    return {
      kind: 'circle',
      ref,
      label: markSourceLabel(ref),
      center: triangleState.position,
      radius: CIRCUMRADIUS,
    };
  }
  return null;
}

function segmentIntersectionPoints(a: Extract<AbUnionMarkPrimitive, { kind: 'line' }>, b: Extract<AbUnionMarkPrimitive, { kind: 'line' }>): Point[] {
  const r = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const s = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPS) return [];
  const q = { x: b.start.x - a.start.x, y: b.start.y - a.start.y };
  const t = (q.x * s.y - q.y * s.x) / denom;
  const u = (q.x * r.y - q.y * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return [];
  return [{ x: a.start.x + clamp01(t) * r.x, y: a.start.y + clamp01(t) * r.y }];
}

function lineCircleIntersectionPoints(
  line: Extract<AbUnionMarkPrimitive, { kind: 'line' }>,
  circle: Extract<AbUnionMarkPrimitive, { kind: 'circle' }>,
): Point[] {
  const d = { x: line.end.x - line.start.x, y: line.end.y - line.start.y };
  const f = { x: line.start.x - circle.center.x, y: line.start.y - circle.center.y };
  const a = d.x * d.x + d.y * d.y;
  const b = 2 * (f.x * d.x + f.y * d.y);
  const c = f.x * f.x + f.y * f.y - circle.radius * circle.radius;
  const disc = b * b - 4 * a * c;
  if (a < EPS || disc < -EPS) return [];
  const sqrtDisc = Math.sqrt(Math.max(0, disc));
  const values = [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];
  const points: Point[] = [];
  for (const value of values) {
    if (value < -EPS || value > 1 + EPS) continue;
    const point = { x: line.start.x + clamp01(value) * d.x, y: line.start.y + clamp01(value) * d.y };
    if (!points.some((existing) => distance(existing, point) <= EPS)) points.push(point);
  }
  return points;
}

function circleCircleIntersectionPoints(
  a: Extract<AbUnionMarkPrimitive, { kind: 'circle' }>,
  b: Extract<AbUnionMarkPrimitive, { kind: 'circle' }>,
): Point[] {
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > a.radius + b.radius + EPS || d < Math.abs(a.radius - b.radius) - EPS) return [];
  const along = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
  const h2 = a.radius * a.radius - along * along;
  if (h2 < -EPS) return [];
  const h = Math.sqrt(Math.max(0, h2));
  const ux = dx / d;
  const uy = dy / d;
  const base = { x: a.center.x + along * ux, y: a.center.y + along * uy };
  if (h <= EPS) return [base];
  return [
    { x: base.x - uy * h, y: base.y + ux * h },
    { x: base.x + uy * h, y: base.y - ux * h },
  ];
}

export function distanceToMarkPrimitive(point: Point, primitive: AbUnionMarkPrimitive): number {
  if (primitive.kind === 'line') return distanceToSegment(point, primitive.start, primitive.end);
  return Math.abs(distance(point, primitive.center) - primitive.radius);
}

function closestPoint(points: Point[], preferred: Point | null): Point | null {
  if (points.length === 0) return null;
  if (!preferred) return points[0];
  let best = points[0];
  let bestDistance = distance(best, preferred);
  for (let i = 1; i < points.length; i++) {
    const d = distance(points[i], preferred);
    if (d < bestDistance) {
      best = points[i];
      bestDistance = d;
    }
  }
  return best;
}

export function intersectionPoint(
  first: AbUnionMarkPrimitive,
  second: AbUnionMarkPrimitive,
  preferred: Point | null,
): Point | null {
  if (first.kind === 'line' && second.kind === 'line') {
    return closestPoint(segmentIntersectionPoints(first, second), preferred);
  }
  if (first.kind === 'line' && second.kind === 'circle') {
    return closestPoint(lineCircleIntersectionPoints(first, second), preferred);
  }
  if (first.kind === 'circle' && second.kind === 'line') {
    return closestPoint(lineCircleIntersectionPoints(second, first), preferred);
  }
  if (first.kind === 'circle' && second.kind === 'circle') {
    return closestPoint(circleCircleIntersectionPoints(first, second), preferred);
  }
  return null;
}

export function centerContainsPoint(
  point: Point,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
): boolean {
  if (state.centerMode === 'none') {
    return true;
  }
  if (state.centerMode === 'circle') {
    return distance(point, triangleState.position) <= CIRCUMRADIUS + EPS;
  }
  if (state.centerMode === 'local-c') {
    return pointInConvexPolygon(point, localCHull(localCs));
  }
  const vertices = getVertices(triangleState);
  return pointInTriangle(point, vertices[0], vertices[1], vertices[2]);
}

export function fMarkDistance(state: AbUnionState): number | null {
  return state.fMarks.length === 2 ? distance(state.fMarks[0].point, state.fMarks[1].point) : null;
}

export function fMarkTriangle(state: AbUnionState): ReturnType<typeof fitTriangle> | null {
  if (state.fMarks.length < 3) return null;
  return fitTriangle('F', state.fMarks.map((mark) => mark.point), '#eab308');
}

export function projectEdgeValue(mouse: Point, index: number): number {
  const start = HEXAGON_VERTICES[index];
  const edge = edgeVector(index);
  const length2 = edge.x * edge.x + edge.y * edge.y;
  if (length2 === 0) return 0;
  return clamp01(((mouse.x - start.x) * edge.x + (mouse.y - start.y) * edge.y) / length2);
}

export function projectLocalC(mouse: Point, index: number): number {
  const closest = closestPointOnSegment(mouse, { x: 0, y: 0 }, HEXAGON_VERTICES[index]);
  return clamp01(1 - distance(closest, { x: 0, y: 0 }));
}
