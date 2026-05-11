import type { Point, TriangleState } from './types';
import { canvasToMath, config, mathToCanvas, scaleToCanvas, scaleToMath } from './coords';
import {
  clampPointToCircle,
  clampPointToTriangle,
  closestPointOnSegment,
  distance,
  distanceToCircleBorder,
  distanceToSegment,
  distanceToTriangleBorder,
  pointInCircle,
  pointInTriangle,
  rotatePoint,
} from './geometry';
import { HEXAGON_VERTICES } from './hexagon';
import { CIRCUMRADIUS, getValidRegion, getVertices } from './triangle';

const SQRT3 = Math.sqrt(3);
const ANGLE_PERIOD = 2 * Math.PI / 3;
const EPS = 1e-7;
const EPS2 = 1e-12;
const REGION_VERTEX_HIT_PX = 12;
const POINT_HIT_PX = 14;
const LOCAL_C_HIT_PX = 8;
const LOCAL_C_RAY_HIT_PX = 10;
const CONTROL_POINT_HIT_PX = 8;
const BORDER_HIT_PX = 6;
const CLICK_CANCEL_PX = 6;
const PEN_HIT_SCALE = 1.35;
const TOUCH_HIT_SCALE = 1.75;
const COVER_RGBA = [157, 219, 198, 150] as const;
const UNCOVERED_RGBA = [220, 38, 38, 145] as const;
const BOUNDARY_COLORS = ['#344e86', '#8a3ffc', '#0f766e', '#b45309', '#be123c', '#475569'];
const FAR_PAIR_DIRECTIONS = Array.from({ length: 48 }, (_, index) => {
  const angle = Math.PI * index / 48;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

export type AbUnionCenterMode = 'none' | 'triangle' | 'circle' | 'local-c';
export type AbUnionQuality = 'coarse' | 'high' | 'adaptive';
export type AbUnionPreset = 'equality' | 'near-miss' | 'random-strict' | 'midpoint';

export interface AbUnionState {
  b: number[];
  theta: number;
  centerMode: AbUnionCenterMode;
  quality: AbUnionQuality;
  showRegion: boolean;
  showThetaTriangle: boolean;
  showFarPair: boolean;
  clipToCornerSectors: boolean;
  regionVisible: boolean[];
  equalityLocked: boolean[];
  activeRegions: boolean[];
  lastOptimized: AbUnionOptimization | null;
  searchResults: AbUnionSearchResult[];
}

export interface AbUnionEqualityRow {
  index: number;
  previousB: number;
  currentB: number;
  sum: number;
  equality: boolean;
  locked: boolean;
}

export interface AbUnionRegionRow {
  index: number;
  a: number;
  b: number;
  distance: number;
  state: 'active' | 'limit' | 'empty';
}

export interface AbUnionOptimization {
  theta: number;
  L: number;
}

export interface AbUnionSearchResult extends AbUnionOptimization {
  b: number[];
  minSeparation: number;
  classification: 'interesting' | 'needs refinement' | 'not a counterexample';
}

export interface AbUnionRenderResult {
  currentL: number;
  thetaTriangle: Point[] | null;
  uncoveredCount: number;
  analysisCount: number;
  centerContains: boolean;
  centerFailures: number;
  farPair: AbUnionFarPair | null;
  minSeparation: number;
  equalityRows: AbUnionEqualityRow[];
  regionRows: AbUnionRegionRow[];
  activeLabel: string;
}

export interface AbUnionFarPair {
  start: Point;
  end: Point;
  distance: number;
  exceedsUnit: boolean;
}

interface MaskCache {
  size: number;
  center: number;
  scale: number;
  offscreen: HTMLCanvasElement;
  offctx: CanvasRenderingContext2D;
  overlay: ImageData;
  insideMap: Int32Array;
  pixelIndex: Uint32Array;
  xWorld: Float32Array;
  yWorld: Float32Array;
  localU: Float32Array[];
  localV: Float32Array[];
  maskBits: Uint8Array;
}

type PointerInteraction =
  | { kind: 'idle' }
  | { kind: 'pending-click'; startMouse: Point; hit: AbUnionHitTarget | null }
  | { kind: 'dragging-p'; index: number; startMouse: Point; moved: boolean }
  | { kind: 'dragging-local-c'; index: number }
  | { kind: 'dragging-center'; startMouse: Point; startPos: Point; startControl: Point }
  | { kind: 'rotating-triangle'; startMouse: Point; startAngle: number; startPos: Point }
  | { kind: 'dragging-control'; startMouse: Point; startControl: Point };

type AbUnionHitTarget =
  | { kind: 'p'; index: number }
  | { kind: 'v'; index: number }
  | { kind: 'local-c'; index: number }
  | { kind: 'center-control' }
  | { kind: 'center-border' }
  | { kind: 'center-interior' };

const cacheBySize = new Map<number, MaskCache>();

function mod6(index: number): number {
  return (index + 6) % 6;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function edgeVector(index: number): Point {
  const start = HEXAGON_VERTICES[index];
  const end = HEXAGON_VERTICES[mod6(index + 1)];
  return { x: end.x - start.x, y: end.y - start.y };
}

function localCPoint(index: number, localC: number): Point {
  const vertex = HEXAGON_VERTICES[index];
  const radius = 1 - clamp01(localC);
  return { x: vertex.x * radius, y: vertex.y * radius };
}

export function pointForB(b: number[], index: number): Point {
  const start = HEXAGON_VERTICES[index];
  const edge = edgeVector(index);
  const value = clamp01(b[index] ?? 0);
  return { x: start.x + value * edge.x, y: start.y + value * edge.y };
}

function pointInHex(point: Point): boolean {
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

function createMaskCache(sizeInput: number): MaskCache {
  const size = Math.max(1, Math.round(sizeInput));
  const center = size / 2;
  const scale = size * 0.4;
  const offscreen = document.createElement('canvas');
  offscreen.width = size;
  offscreen.height = size;
  const offctx = offscreen.getContext('2d');
  if (!offctx) {
    throw new Error('2D canvas not supported');
  }

  const insideMap = new Int32Array(size * size);
  insideMap.fill(-1);
  const pixelIndexList: number[] = [];
  const xWorldList: number[] = [];
  const yWorldList: number[] = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const wx = (x + 0.5 - center) / scale;
      const wy = (center - (y + 0.5)) / scale;
      if (!pointInHex({ x: wx, y: wy })) continue;
      const pixelIndexValue = y * size + x;
      insideMap[pixelIndexValue] = pixelIndexList.length;
      pixelIndexList.push(pixelIndexValue);
      xWorldList.push(wx);
      yWorldList.push(wy);
    }
  }

  const pixelIndex = Uint32Array.from(pixelIndexList);
  const xWorld = Float32Array.from(xWorldList);
  const yWorld = Float32Array.from(yWorldList);
  const localU = Array.from({ length: 6 }, () => new Float32Array(pixelIndex.length));
  const localV = Array.from({ length: 6 }, () => new Float32Array(pixelIndex.length));

  for (let i = 0; i < 6; i++) {
    const out = edgeVector(i);
    const inc = {
      x: HEXAGON_VERTICES[mod6(i - 1)].x - HEXAGON_VERTICES[i].x,
      y: HEXAGON_VERTICES[mod6(i - 1)].y - HEXAGON_VERTICES[i].y,
    };
    for (let k = 0; k < pixelIndex.length; k++) {
      const rx = xWorld[k] - HEXAGON_VERTICES[i].x;
      const ry = yWorld[k] - HEXAGON_VERTICES[i].y;
      const dOut = rx * out.x + ry * out.y;
      const dIn = rx * inc.x + ry * inc.y;
      localU[i][k] = (4 / 3) * (dOut + 0.5 * dIn);
      localV[i][k] = (4 / 3) * (0.5 * dOut + dIn);
    }
  }

  return {
    size,
    center,
    scale,
    offscreen,
    offctx,
    overlay: offctx.createImageData(size, size),
    insideMap,
    pixelIndex,
    xWorld,
    yWorld,
    localU,
    localV,
    maskBits: new Uint8Array(pixelIndex.length),
  };
}

function getMaskCache(sizeInput: number): MaskCache {
  const size = Math.max(1, Math.round(sizeInput));
  const existing = cacheBySize.get(size);
  if (existing) return existing;
  const cache = createMaskCache(size);
  cacheBySize.set(size, cache);
  return cache;
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

function inCornerSector(u: number, v: number): boolean {
  return u <= 1 + EPS && v <= 1 + EPS;
}

function buildMask(cache: MaskCache, state: AbUnionState): number {
  const data = cache.overlay.data;
  data.fill(0);
  const out = state.b.map(clamp01);
  const inc = state.b.map((_, index) => 1 - clamp01(state.b[mod6(index - 1)] ?? 0));
  let uncoveredCount = 0;

  for (let k = 0; k < cache.pixelIndex.length; k++) {
    let bits = 0;
    for (let i = 0; i < 6; i++) {
      const u = cache.localU[i][k];
      const v = cache.localV[i][k];
      if (
        (!state.clipToCornerSectors || inCornerSector(u, v)) &&
        containsConeRegion(u, v, out[i], inc[i])
      ) {
        bits |= 1 << i;
      }
    }
    cache.maskBits[k] = bits;

    const q = cache.pixelIndex[k] * 4;
    if (bits) {
      const hasVisibleRegion = state.regionVisible.some((visible, index) =>
        visible && (bits & (1 << index)) !== 0,
      );
      if (state.showRegion && hasVisibleRegion) {
        data[q] = COVER_RGBA[0];
        data[q + 1] = COVER_RGBA[1];
        data[q + 2] = COVER_RGBA[2];
        data[q + 3] = COVER_RGBA[3];
      }
    } else {
      uncoveredCount++;
      data[q] = UNCOVERED_RGBA[0];
      data[q + 1] = UNCOVERED_RGBA[1];
      data[q + 2] = UNCOVERED_RGBA[2];
      data[q + 3] = UNCOVERED_RGBA[3];
    }
  }

  cache.offctx.putImageData(cache.overlay, 0, 0);
  return uncoveredCount;
}

function coveredBoundaryTouchesUncovered(cache: MaskCache, k: number): boolean {
  if (cache.maskBits[k] === 0) return false;
  const pixel = cache.pixelIndex[k];
  const x = pixel % cache.size;
  const y = Math.floor(pixel / cache.size);
  const neighbors = [
    x > 0 ? pixel - 1 : -1,
    x < cache.size - 1 ? pixel + 1 : -1,
    y > 0 ? pixel - cache.size : -1,
    y < cache.size - 1 ? pixel + cache.size : -1,
  ];
  return neighbors.some((neighbor) => {
    if (neighbor < 0) return false;
    const neighborK = cache.insideMap[neighbor];
    return neighborK >= 0 && cache.maskBits[neighborK] === 0;
  });
}

function isAnalysisPoint(cache: MaskCache, k: number, quality: AbUnionQuality): boolean {
  if (quality === 'coarse' && k % 4 !== 0) return false;
  if (cache.maskBits[k] === 0) return true;
  return quality === 'adaptive' && coveredBoundaryTouchesUncovered(cache, k);
}

function lineIntersection(n1: Point, c1: number, n2: Point, c2: number): Point {
  const det = n1.x * n2.y - n1.y * n2.x;
  return {
    x: (c1 * n2.y - n1.y * c2) / det,
    y: (n1.x * c2 - c1 * n2.x) / det,
  };
}

function computeThetaTriangle(
  cache: MaskCache,
  theta: number,
  quality: AbUnionQuality,
): AbUnionOptimization & { vertices: Point[] | null; analysisCount: number } {
  const normals = [0, 1, 2].map((index) => {
    const angle = theta + index * ANGLE_PERIOD;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  const h = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let analysisCount = 0;

  for (let k = 0; k < cache.pixelIndex.length; k++) {
    if (!isAnalysisPoint(cache, k, quality)) continue;
    analysisCount++;
    const point = { x: cache.xWorld[k], y: cache.yWorld[k] };
    for (let i = 0; i < 3; i++) {
      h[i] = Math.max(h[i], dot(normals[i], point));
    }
  }

  if (analysisCount === 0) {
    return { theta, L: 0, vertices: null, analysisCount };
  }

  for (let i = 0; i < 3; i++) {
    const margin = 0.5 * (Math.abs(normals[i].x) + Math.abs(normals[i].y)) / cache.scale;
    h[i] += margin;
  }

  return {
    theta,
    L: Math.max(0, (2 / SQRT3) * h.reduce((sum, value) => sum + value, 0)),
    vertices: [
      lineIntersection(normals[0], h[0], normals[1], h[1]),
      lineIntersection(normals[1], h[1], normals[2], h[2]),
      lineIntersection(normals[2], h[2], normals[0], h[0]),
    ],
    analysisCount,
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

function localCHull(localCs: number[]): Point[] {
  return convexHull(localCs.map((value, index) => localCPoint(index, value)));
}

function centerContainsPoint(
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

function computeCenterContainment(
  cache: MaskCache,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
): { contains: boolean; failures: number } {
  if (state.centerMode === 'none') {
    return { contains: true, failures: 0 };
  }
  let failures = 0;
  for (let k = 0; k < cache.pixelIndex.length; k++) {
    if (!isAnalysisPoint(cache, k, state.quality)) continue;
    if (!centerContainsPoint({ x: cache.xWorld[k], y: cache.yWorld[k] }, state, triangleState, localCs)) {
      failures++;
    }
  }
  return { contains: failures === 0, failures };
}

function pointFromCache(cache: MaskCache, index: number): Point {
  return { x: cache.xWorld[index], y: cache.yWorld[index] };
}

function findFarRedPair(cache: MaskCache): AbUnionFarPair | null {
  const directionCount = FAR_PAIR_DIRECTIONS.length;
  const minIndices = Array(directionCount).fill(-1) as number[];
  const maxIndices = Array(directionCount).fill(-1) as number[];
  const minValues = Array(directionCount).fill(Number.POSITIVE_INFINITY) as number[];
  const maxValues = Array(directionCount).fill(Number.NEGATIVE_INFINITY) as number[];
  let uncoveredCount = 0;

  for (let k = 0; k < cache.pixelIndex.length; k++) {
    if (cache.maskBits[k] !== 0) continue;
    uncoveredCount++;
    const point = pointFromCache(cache, k);
    for (let d = 0; d < directionCount; d++) {
      const direction = FAR_PAIR_DIRECTIONS[d];
      const value = point.x * direction.x + point.y * direction.y;
      if (value < minValues[d]) {
        minValues[d] = value;
        minIndices[d] = k;
      }
      if (value > maxValues[d]) {
        maxValues[d] = value;
        maxIndices[d] = k;
      }
    }
  }

  if (uncoveredCount < 2) return null;

  const candidateIndices = Array.from(new Set([...minIndices, ...maxIndices].filter((index) => index >= 0)));
  let bestStart = pointFromCache(cache, candidateIndices[0]);
  let bestEnd = pointFromCache(cache, candidateIndices[1] ?? candidateIndices[0]);
  let bestDistance = 0;

  for (let i = 0; i < candidateIndices.length; i++) {
    const start = pointFromCache(cache, candidateIndices[i]);
    for (let j = i + 1; j < candidateIndices.length; j++) {
      const end = pointFromCache(cache, candidateIndices[j]);
      const currentDistance = distance(start, end);
      if (currentDistance > bestDistance) {
        bestDistance = currentDistance;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  return {
    start: bestStart,
    end: bestEnd,
    distance: bestDistance,
    exceedsUnit: bestDistance > 1,
  };
}

function drawPolygon(ctx: CanvasRenderingContext2D, points: Point[], stroke: string, fill: string, dashed = false): void {
  if (points.length === 0) return;
  const canvasPoints = points.map(mathToCanvas);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
  for (let i = 1; i < canvasPoints.length; i++) {
    ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (dashed) ctx.setLineDash([8, 6]);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = dashed ? 2.25 : 2;
  ctx.stroke();
  ctx.restore();
}

function drawThetaTriangle(ctx: CanvasRenderingContext2D, points: Point[] | null): void {
  if (!points) return;
  drawPolygon(ctx, points, '#7c3aed', 'rgba(124, 58, 237, 0.06)', true);
}

function drawFarPair(ctx: CanvasRenderingContext2D, pair: AbUnionFarPair | null): void {
  if (!pair || !pair.exceedsUnit) return;
  const start = mathToCanvas(pair.start);
  const end = mathToCanvas(pair.end);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  ctx.save();
  ctx.strokeStyle = '#991b1b';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const point of [start, end]) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#fee2e2';
    ctx.fill();
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#991b1b';
  ctx.fillText(`d=${pair.distance.toFixed(3)}`, mid.x, mid.y - 6);
  ctx.restore();
}

function drawCenterShape(
  ctx: CanvasRenderingContext2D,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
): void {
  if (state.centerMode === 'none') {
    return;
  }

  ctx.save();
  if (state.centerMode === 'circle') {
    const center = mathToCanvas(triangleState.position);
    ctx.beginPath();
    ctx.arc(center.x, center.y, scaleToCanvas(CIRCUMRADIUS), 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(14, 165, 233, 0.05)';
    ctx.fill();
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (state.centerMode === 'local-c') {
    const hull = localCHull(localCs);
    drawPolygon(ctx, hull, '#d97706', 'rgba(250, 204, 21, 0.16)');

    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const start = mathToCanvas({ x: 0, y: 0 });
      const end = mathToCanvas(HEXAGON_VERTICES[i]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    for (let i = 0; i < 6; i++) {
      const handle = mathToCanvas(localCPoint(i, localCs[i] ?? 0));
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  } else {
    drawPolygon(ctx, getVertices(triangleState), '#0ea5e9', 'rgba(14, 165, 233, 0.05)');
    const cp = mathToCanvas(triangleState.controlPoint);
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, 4, 0, 2 * Math.PI);
    ctx.fillStyle = '#0ea5e9';
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawRegionBoundary(ctx: CanvasRenderingContext2D, cache: MaskCache, regionIndex: number): void {
  const bit = 1 << regionIndex;
  ctx.save();
  ctx.beginPath();
  for (let k = 0; k < cache.pixelIndex.length; k++) {
    if ((cache.maskBits[k] & bit) === 0) continue;
    const idx = cache.pixelIndex[k];
    const x = idx % cache.size;
    const y = Math.floor(idx / cache.size);
    const left = x > 0 ? cache.insideMap[idx - 1] : -1;
    const right = x < cache.size - 1 ? cache.insideMap[idx + 1] : -1;
    const top = y > 0 ? cache.insideMap[idx - cache.size] : -1;
    const bottom = y < cache.size - 1 ? cache.insideMap[idx + cache.size] : -1;

    if (left < 0 || (cache.maskBits[left] & bit) === 0) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 1);
    }
    if (right < 0 || (cache.maskBits[right] & bit) === 0) {
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 1, y + 1);
    }
    if (top < 0 || (cache.maskBits[top] & bit) === 0) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1, y);
    }
    if (bottom < 0 || (cache.maskBits[bottom] & bit) === 0) {
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x + 1, y + 1);
    }
  }
  ctx.strokeStyle = BOUNDARY_COLORS[regionIndex];
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 1.15;
  ctx.stroke();
  ctx.restore();
}

function drawActiveBoundaries(ctx: CanvasRenderingContext2D, cache: MaskCache, state: AbUnionState): void {
  for (let i = 0; i < 6; i++) {
    if (state.activeRegions[i]) drawRegionBoundary(ctx, cache, i);
  }
}

function drawPointsAndVertices(ctx: CanvasRenderingContext2D, state: AbUnionState): void {
  ctx.save();
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < 6; i++) {
    const vertex = mathToCanvas(HEXAGON_VERTICES[i]);
    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, state.activeRegions[i] ? 6.4 : 5.2, 0, 2 * Math.PI);
    ctx.fillStyle = state.activeRegions[i] ? '#7c3aed' : '#0f172a';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const label = mathToCanvas({
      x: HEXAGON_VERTICES[i].x * 1.11,
      y: HEXAGON_VERTICES[i].y * 1.11,
    });
    ctx.fillStyle = '#334155';
    ctx.fillText(`V${i}`, label.x, label.y);
  }

  for (let i = 0; i < 6; i++) {
    const point = pointForB(state.b, i);
    const canvasPoint = mathToCanvas(point);
    const active = state.activeRegions[i] || state.activeRegions[mod6(i + 1)];
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, 7.7, 0, 2 * Math.PI);
    ctx.fillStyle = active ? '#fff7ed' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = active ? '#d97706' : '#334155';
    ctx.lineWidth = active ? 2.7 : 2.1;
    ctx.stroke();

    const edgeMid = {
      x: (HEXAGON_VERTICES[i].x + HEXAGON_VERTICES[mod6(i + 1)].x) / 2,
      y: (HEXAGON_VERTICES[i].y + HEXAGON_VERTICES[mod6(i + 1)].y) / 2,
    };
    const len = Math.hypot(edgeMid.x, edgeMid.y) || 1;
    const label = mathToCanvas({
      x: point.x + (0.085 * edgeMid.x) / len,
      y: point.y + (0.085 * edgeMid.y) / len,
    });
    ctx.fillStyle = '#475569';
    ctx.fillText(`p${i}`, label.x, label.y);
  }

  ctx.restore();
}

export function equalityRows(b: number[]): AbUnionEqualityRow[] {
  return Array.from({ length: 6 }, (_, index) => {
    const previousB = clamp01(b[mod6(index - 1)] ?? 0);
    const currentB = clamp01(b[index] ?? 0);
    return {
      index,
      previousB,
      currentB,
      sum: 1 - previousB + currentB,
      equality: Math.abs(currentB - previousB) <= 1e-9,
      locked: false,
    };
  });
}

function setBValue(state: AbUnionState, index: number, value: number): void {
  const nextValue = clamp01(value);
  if (!state.equalityLocked[index]) {
    state.b[index] = nextValue;
  } else {
    for (let i = 0; i < 6; i++) {
      if (state.equalityLocked[i]) {
        state.b[i] = nextValue;
      }
    }
  }
  state.lastOptimized = null;
}

export function setAbUnionEqualityLock(state: AbUnionState, indexInput: number, locked: boolean): void {
  const index = mod6(indexInput);
  if (!locked) {
    state.equalityLocked[index] = false;
    return;
  }

  if (state.equalityLocked[index]) return;

  const firstLockedIndex = state.equalityLocked.findIndex(Boolean);
  if (firstLockedIndex >= 0) {
    state.b[index] = clamp01(state.b[firstLockedIndex] ?? 0);
  }
  state.equalityLocked[index] = true;
  state.lastOptimized = null;
}

export function enforceAbUnionEqualityLocks(state: AbUnionState): void {
  const firstLockedIndex = state.equalityLocked.findIndex(Boolean);
  if (firstLockedIndex < 0) return;
  const value = clamp01(state.b[firstLockedIndex] ?? 0);
  for (let i = 0; i < 6; i++) {
    if (state.equalityLocked[i]) {
      state.b[i] = value;
    }
  }
}

export function equalityRowsForState(state: AbUnionState): AbUnionEqualityRow[] {
  return equalityRows(state.b).map((row) => ({
    ...row,
    locked: Boolean(state.equalityLocked[row.index]),
  }));
}

export function regionRows(b: number[]): AbUnionRegionRow[] {
  return Array.from({ length: 6 }, (_, index) => {
    const a = 1 - clamp01(b[mod6(index - 1)] ?? 0);
    const currentB = clamp01(b[index] ?? 0);
    const distanceValue = Math.sqrt(a * a + a * currentB + currentB * currentB);
    let state: AbUnionRegionRow['state'] = 'active';
    if (distanceValue * distanceValue > 1 + 1e-5) state = 'empty';
    else if (Math.abs(distanceValue * distanceValue - 1) <= 1e-5) state = 'limit';
    return { index, a, b: currentB, distance: distanceValue, state };
  });
}

export function minSeparation(b: number[]): number {
  return Math.min(...Array.from({ length: 6 }, (_, index) =>
    Math.abs(clamp01(b[index] ?? 0) - clamp01(b[mod6(index - 1)] ?? 0)),
  ));
}

function activeLabel(activeRegions: boolean[]): string {
  const labels = activeRegions
    .map((active, index) => active ? `R${index}` : null)
    .filter((label): label is string => label !== null);
  return labels.join(', ') || 'none';
}

export function createDefaultAbUnionState(): AbUnionState {
  return {
    b: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
    theta: Math.PI / 6,
    centerMode: 'triangle',
    quality: 'adaptive',
    showRegion: true,
    showThetaTriangle: true,
    showFarPair: false,
    clipToCornerSectors: false,
    regionVisible: Array(6).fill(true),
    equalityLocked: Array(6).fill(false),
    activeRegions: Array(6).fill(false),
    lastOptimized: null,
    searchResults: [],
  };
}

export function setAbUnionPreset(state: AbUnionState, preset: AbUnionPreset): void {
  if (preset === 'equality') {
    state.b = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25];
  } else if (preset === 'near-miss') {
    state.b = [0.01, 0.008, 0.006, 0.004, 0.002, 0];
  } else if (preset === 'random-strict') {
    state.b = randomStrictB();
  } else {
    state.b = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  }
  state.activeRegions = Array(6).fill(false);
  state.lastOptimized = null;
  enforceAbUnionEqualityLocks(state);
}

export function randomStrictB(minGap = 1e-3): number[] {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const b = Array.from({ length: 6 }, () => Math.random());
    if (minSeparation(b) > minGap) return b;
  }
  return [0.01, 0.008, 0.006, 0.004, 0.002, 0];
}

function classification(L: number, separation: number): AbUnionSearchResult['classification'] {
  if (L < 0.98 && separation > 1e-3) return 'interesting';
  if (L < 1) return 'needs refinement';
  return 'not a counterexample';
}

function evaluateB(
  b: number[],
  thetaSamples: number,
  size: number,
  quality: AbUnionQuality,
): AbUnionOptimization {
  const cache = getMaskCache(size);
  const tempState = createDefaultAbUnionState();
  tempState.b = b.map(clamp01);
  tempState.showRegion = false;
  buildMask(cache, tempState);

  let best: AbUnionOptimization = { theta: 0, L: Number.POSITIVE_INFINITY };
  const samples = Math.max(1, Math.floor(thetaSamples));
  for (let i = 0; i < samples; i++) {
    const theta = (ANGLE_PERIOD * i) / samples;
    const candidate = computeThetaTriangle(cache, theta, quality);
    if (candidate.L < best.L) best = { theta, L: candidate.L };
  }
  return best;
}

export function optimizeAbUnionTheta(
  state: AbUnionState,
  thetaSamples = 240,
  size = config.canvasSize,
): AbUnionOptimization {
  return evaluateB(state.b, thetaSamples, size, state.quality);
}

export function runAbUnionRandomSearch(
  trials = 60,
  thetaSamples = 120,
  size = 180,
): AbUnionSearchResult[] {
  const results: AbUnionSearchResult[] = [];
  for (let i = 0; i < trials; i++) {
    const b = randomStrictB();
    const best = evaluateB(b, thetaSamples, size, 'coarse');
    const separation = minSeparation(b);
    results.push({
      b,
      theta: best.theta,
      L: best.L,
      minSeparation: separation,
      classification: classification(best.L, separation),
    });
  }
  return results.sort((a, b) => a.L - b.L).slice(0, 5);
}

export function renderAbUnion(
  ctx: CanvasRenderingContext2D,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
): AbUnionRenderResult {
  state.b = state.b.map(clamp01);
  if (state.activeRegions.length !== 6) state.activeRegions = Array(6).fill(false);
  if (state.regionVisible.length !== 6) state.regionVisible = Array(6).fill(true);
  if (state.equalityLocked.length !== 6) state.equalityLocked = Array(6).fill(false);
  enforceAbUnionEqualityLocks(state);
  const cache = getMaskCache(config.canvasSize);
  const uncoveredCount = buildMask(cache, state);
  ctx.drawImage(cache.offscreen, 0, 0, config.canvasSize, config.canvasSize);
  const thetaResult = computeThetaTriangle(cache, state.theta, state.quality);
  const farPair = state.showFarPair ? findFarRedPair(cache) : null;
  if (state.showThetaTriangle) {
    drawThetaTriangle(ctx, thetaResult.vertices);
  }
  drawCenterShape(ctx, state, triangleState, localCs);
  drawFarPair(ctx, farPair);
  drawActiveBoundaries(ctx, cache, state);
  drawPointsAndVertices(ctx, state);
  const containment = computeCenterContainment(cache, state, triangleState, localCs);

  return {
    currentL: thetaResult.L,
    thetaTriangle: thetaResult.vertices,
    uncoveredCount,
    analysisCount: thetaResult.analysisCount,
    centerContains: containment.contains,
    centerFailures: containment.failures,
    farPair,
    minSeparation: minSeparation(state.b),
    equalityRows: equalityRowsForState(state),
    regionRows: regionRows(state.b),
    activeLabel: activeLabel(state.activeRegions),
  };
}

function getHitScale(pointerType: string): number {
  if (pointerType === 'touch') return TOUCH_HIT_SCALE;
  if (pointerType === 'pen') return PEN_HIT_SCALE;
  return 1;
}

function getPointerMath(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? config.canvasSize / rect.width : 1;
  const scaleY = rect.height > 0 ? config.canvasSize / rect.height : 1;
  return canvasToMath({
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  });
}

function hitRegionTarget(mouse: Point, state: AbUnionState, pointerType: string): AbUnionHitTarget | null {
  const pointHit = scaleToMath(POINT_HIT_PX * getHitScale(pointerType));
  const vertexHit = scaleToMath(REGION_VERTEX_HIT_PX * getHitScale(pointerType));
  let best: AbUnionHitTarget | null = null;
  let bestDistance = Infinity;

  for (let i = 0; i < 6; i++) {
    const d = distance(mouse, pointForB(state.b, i));
    if (d <= pointHit && d < bestDistance) {
      best = { kind: 'p', index: i };
      bestDistance = d;
    }
  }

  for (let i = 0; i < 6; i++) {
    const d = distance(mouse, HEXAGON_VERTICES[i]);
    if (d <= vertexHit && d < bestDistance) {
      best = { kind: 'v', index: i };
      bestDistance = d;
    }
  }

  return best;
}

function hitLocalC(mouse: Point, localCs: number[], pointerType: string): AbUnionHitTarget | null {
  const handleHit = scaleToMath(LOCAL_C_HIT_PX * getHitScale(pointerType));
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < 6; i++) {
    const d = distance(mouse, localCPoint(i, localCs[i] ?? 0));
    if (d <= handleHit && d < bestDistance) {
      bestIndex = i;
      bestDistance = d;
    }
  }
  if (bestIndex !== null) return { kind: 'local-c', index: bestIndex };

  const rayHit = scaleToMath(LOCAL_C_RAY_HIT_PX * getHitScale(pointerType));
  for (let i = 0; i < 6; i++) {
    const d = distanceToSegment(mouse, localCPoint(i, 1), HEXAGON_VERTICES[i]);
    if (d <= rayHit && d < bestDistance) {
      bestIndex = i;
      bestDistance = d;
    }
  }
  return bestIndex === null ? null : { kind: 'local-c', index: bestIndex };
}

function hitCenterShape(
  mouse: Point,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
  pointerType: string,
): AbUnionHitTarget | null {
  if (state.centerMode === 'none') {
    return null;
  }
  const hitScale = getHitScale(pointerType);
  if (state.centerMode === 'local-c') {
    return hitLocalC(mouse, localCs, pointerType);
  }
  if (state.centerMode === 'circle') {
    const borderDist = distanceToCircleBorder(mouse, triangleState.position, CIRCUMRADIUS);
    if (borderDist <= scaleToMath(BORDER_HIT_PX * hitScale)) return { kind: 'center-border' };
    if (pointInCircle(mouse, triangleState.position, CIRCUMRADIUS)) return { kind: 'center-interior' };
    return null;
  }

  const controlDist = distance(mouse, triangleState.controlPoint);
  if (controlDist <= scaleToMath(CONTROL_POINT_HIT_PX * hitScale)) return { kind: 'center-control' };
  const vertices = getVertices(triangleState);
  const borderDist = distanceToTriangleBorder(mouse, vertices);
  if (borderDist <= scaleToMath(BORDER_HIT_PX * hitScale)) return { kind: 'center-border' };
  if (pointInTriangle(mouse, vertices[0], vertices[1], vertices[2])) return { kind: 'center-interior' };
  return null;
}

function hitTest(
  mouse: Point,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
  pointerType: string,
): AbUnionHitTarget | null {
  return hitRegionTarget(mouse, state, pointerType)
    ?? hitCenterShape(mouse, state, triangleState, localCs, pointerType);
}

function projectBFromPoint(mouse: Point, index: number): number {
  const start = HEXAGON_VERTICES[index];
  const edge = edgeVector(index);
  const length2 = edge.x * edge.x + edge.y * edge.y;
  if (length2 === 0) return 0;
  return clamp01(((mouse.x - start.x) * edge.x + (mouse.y - start.y) * edge.y) / length2);
}

function projectLocalC(mouse: Point, index: number): number {
  const closest = closestPointOnSegment(mouse, { x: 0, y: 0 }, HEXAGON_VERTICES[index]);
  return clamp01(1 - distance(closest, { x: 0, y: 0 }));
}

function setActiveOnly(state: AbUnionState, regions: number[]): void {
  const wanted = new Set(regions.map(mod6));
  const same = state.activeRegions.every((active, index) => active === wanted.has(index));
  state.activeRegions = Array(6).fill(false);
  if (same) return;
  for (const index of wanted) {
    state.activeRegions[index] = true;
  }
}

function handleClick(state: AbUnionState, hit: AbUnionHitTarget | null): void {
  if (!hit) {
    state.activeRegions = Array(6).fill(false);
  } else if (hit.kind === 'v') {
    setActiveOnly(state, [hit.index]);
  } else if (hit.kind === 'p') {
    setActiveOnly(state, [hit.index, hit.index + 1]);
  }
}

function updateCursor(canvas: HTMLCanvasElement, hit: AbUnionHitTarget | null, centerMode: AbUnionCenterMode): void {
  if (!hit) {
    canvas.style.cursor = 'default';
  } else if (hit.kind === 'p') {
    canvas.style.cursor = 'grab';
  } else if (hit.kind === 'v' || hit.kind === 'local-c' || hit.kind === 'center-control') {
    canvas.style.cursor = 'pointer';
  } else if (hit.kind === 'center-border') {
    canvas.style.cursor = centerMode === 'circle' ? 'move' : 'alias';
  } else {
    canvas.style.cursor = 'move';
  }
}

export function setupAbUnionInteraction(
  canvas: HTMLCanvasElement,
  isEnabled: () => boolean,
  getState: () => AbUnionState,
  triangleState: TriangleState,
  getLocalCs: () => number[],
  onLocalCChange: (index: number, value: number) => void,
  render: () => void,
): void {
  let interaction: PointerInteraction = { kind: 'idle' };
  let activePointerId: number | null = null;
  let activePointerType = 'mouse';

  function stop(): void {
    interaction = { kind: 'idle' };
    if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
      canvas.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    activePointerType = 'mouse';
  }

  function onPointerDown(event: PointerEvent): void {
    if (!isEnabled() || !event.isPrimary) return;
    const pointerType = event.pointerType || 'mouse';
    const mouse = getPointerMath(canvas, event);
    const state = getState();
    const hit = hitTest(mouse, state, triangleState, getLocalCs(), pointerType);

    if (hit?.kind === 'p') {
      interaction = { kind: 'dragging-p', index: hit.index, startMouse: mouse, moved: false };
      setBValue(state, hit.index, projectBFromPoint(mouse, hit.index));
      render();
    } else if (hit?.kind === 'local-c') {
      interaction = { kind: 'dragging-local-c', index: hit.index };
      onLocalCChange(hit.index, projectLocalC(mouse, hit.index));
      render();
    } else if (hit?.kind === 'center-control') {
      interaction = { kind: 'dragging-control', startMouse: mouse, startControl: { ...triangleState.controlPoint } };
    } else if (hit?.kind === 'center-border') {
      interaction = state.centerMode === 'circle'
        ? {
            kind: 'dragging-center',
            startMouse: mouse,
            startPos: { ...triangleState.position },
            startControl: { ...triangleState.controlPoint },
          }
        : {
            kind: 'rotating-triangle',
            startMouse: mouse,
            startAngle: triangleState.angle,
            startPos: { ...triangleState.position },
          };
    } else if (hit?.kind === 'center-interior') {
      interaction = {
        kind: 'dragging-center',
        startMouse: mouse,
        startPos: { ...triangleState.position },
        startControl: { ...triangleState.controlPoint },
      };
    } else {
      interaction = { kind: 'pending-click', startMouse: mouse, hit };
    }

    activePointerId = event.pointerId;
    activePointerType = pointerType;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!isEnabled()) return;
    const pointerType = activePointerId === event.pointerId ? activePointerType : (event.pointerType || 'mouse');
    const mouse = getPointerMath(canvas, event);
    const state = getState();

    if (interaction.kind === 'idle') {
      updateCursor(canvas, hitTest(mouse, state, triangleState, getLocalCs(), pointerType), state.centerMode);
      return;
    }
    if (activePointerId !== event.pointerId) return;

    if (interaction.kind === 'pending-click') {
      if (distance(mouse, interaction.startMouse) > scaleToMath(CLICK_CANCEL_PX * getHitScale(pointerType))) {
        stop();
      }
      return;
    }

    if (interaction.kind === 'dragging-p') {
      interaction.moved = interaction.moved
        || distance(mouse, interaction.startMouse) > scaleToMath(CLICK_CANCEL_PX * getHitScale(pointerType));
      setBValue(state, interaction.index, projectBFromPoint(mouse, interaction.index));
    } else if (interaction.kind === 'dragging-local-c') {
      onLocalCChange(interaction.index, projectLocalC(mouse, interaction.index));
    } else if (interaction.kind === 'dragging-center') {
      const dx = mouse.x - interaction.startMouse.x;
      const dy = mouse.y - interaction.startMouse.y;
      const desiredPos = { x: interaction.startPos.x + dx, y: interaction.startPos.y + dy };
      const clamped = state.centerMode === 'circle'
        ? clampPointToCircle(desiredPos, { x: 0, y: 0 }, CIRCUMRADIUS)
        : clampPointToTriangle(desiredPos, ...getValidRegion(triangleState.angle));
      const clampDx = clamped.x - interaction.startPos.x;
      const clampDy = clamped.y - interaction.startPos.y;
      triangleState.position = clamped;
      triangleState.controlPoint = {
        x: interaction.startControl.x + clampDx,
        y: interaction.startControl.y + clampDy,
      };
    } else if (interaction.kind === 'rotating-triangle') {
      const cp = triangleState.controlPoint;
      const startAngle = Math.atan2(interaction.startMouse.y - cp.y, interaction.startMouse.x - cp.x);
      const currentAngle = Math.atan2(mouse.y - cp.y, mouse.x - cp.x);
      const delta = currentAngle - startAngle;
      const nextAngle = interaction.startAngle + delta;
      const nextPosition = rotatePoint(interaction.startPos, cp, delta);
      if (pointInTriangle(nextPosition, ...getValidRegion(nextAngle))) {
        triangleState.angle = nextAngle;
        triangleState.position = nextPosition;
      }
    } else if (interaction.kind === 'dragging-control') {
      triangleState.controlPoint = {
        x: interaction.startControl.x + mouse.x - interaction.startMouse.x,
        y: interaction.startControl.y + mouse.y - interaction.startMouse.y,
      };
    }

    render();
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!isEnabled() || activePointerId !== event.pointerId) return;
    const mouse = getPointerMath(canvas, event);
    const state = getState();
    const hit = hitTest(mouse, state, triangleState, getLocalCs(), activePointerType);

    if (interaction.kind === 'pending-click') {
      handleClick(state, interaction.hit ?? hit);
      render();
    } else if (interaction.kind === 'dragging-p' && !interaction.moved) {
      handleClick(state, { kind: 'p', index: interaction.index });
      render();
    }

    stop();
    updateCursor(canvas, hit, state.centerMode);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (activePointerId !== event.pointerId) return;
    stop();
    canvas.style.cursor = 'default';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => {
    if (interaction.kind === 'idle' && isEnabled()) canvas.style.cursor = 'default';
  });
  canvas.addEventListener('lostpointercapture', () => {
    interaction = { kind: 'idle' };
    activePointerId = null;
    activePointerType = 'mouse';
  });
}
