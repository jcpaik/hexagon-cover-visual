import { config, mathToCanvas, scaleToCanvas } from '../coords';
import { fitTriangle } from '../cover';
import { distance } from '../geometry';
import { HEXAGON_VERTICES } from '../hexagon';
import { CIRCUMRADIUS, getVertices } from '../triangle';
import type { Point, TriangleState } from '../types';
import {
  ANGLE_PERIOD,
  buildHexAxisHullFromSamples,
  centerContainsPoint,
  containsExactRegionLocal,
  dot,
  edgeVector,
  fMarkDistance,
  fMarkTriangle,
  lineIntersection,
  localCHull,
  localCPoint,
  markPrimitiveForRef,
  mod6,
  pointInHex,
  pointInHexAxisHull,
  pointOnEdge,
  shouldUseHexAxisHull,
  SQRT3,
} from './geometry';
import { abUnionRegionKey, sampleRestrictedAbSources } from './regions';
import {
  activeLabel,
  applyAbUnionCoincidenceLocks,
  aValue,
  bValue,
  createDefaultAbUnionState,
  edgeRowsForState,
  enforceAbUnionLocks,
  minEqualityGap,
  normalizeAbUnionState,
  refreshAbUnionLabels,
  regionRowsForState,
} from './state';
import type {
  AbUnionBoundaryRenderResult,
  AbUnionFarPair,
  AbUnionLocalRegionVariant,
  AbUnionMarkPrimitive,
  AbUnionOptimization,
  AbUnionQuality,
  AbUnionRegionDefinition,
  AbUnionRenderResult,
  AbUnionState,
  HexAxisHull,
} from './types';

const COVER_RGBA = [157, 219, 198, 150] as const;
const HULL_RGBA = [96, 165, 250, 120] as const;
const UNCOVERED_RGBA = [220, 38, 38, 145] as const;
export const AB_UNION_REGION_COLORS = ['#344e86', '#8a3ffc', '#0f766e', '#b45309', '#be123c', '#475569'];
const REGION_RGB = AB_UNION_REGION_COLORS.map((color) => [
  parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16),
]);
const FAR_PAIR_DIRECTIONS = Array.from({ length: 48 }, (_, index) => {
  const angle = Math.PI * index / 48;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

interface AbUnionRenderOptions {
  computeTheta?: boolean;
  localRegionVariant?: AbUnionLocalRegionVariant;
}

interface AbUnionRegionRenderOptions {
  sourceRegions?: readonly AbUnionRegionDefinition[];
  sourceWitnesses?: readonly (readonly Point[] | null)[];
  sourceQuality?: 'preview' | 'full';
  colorByRegion?: boolean;
  showUncovered?: boolean;
  drawBoundaries?: boolean;
  localRegionVariant?: AbUnionLocalRegionVariant;
}

interface SourceRegionMask {
  key: string;
  quality: 'preview' | 'full';
  coverage: Uint8Array;
  count: number;
  status: string;
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
  sourceMasks: Array<SourceRegionMask | undefined>;
}

const cacheBySize = new Map<number, MaskCache>();

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
    sourceMasks: Array(6),
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

function buildHexAxisHull(
  cache: MaskCache,
  state: AbUnionState,
  regionIndex: number,
  outLen: number,
  inLen: number,
  variant: AbUnionLocalRegionVariant,
): HexAxisHull {
  return buildHexAxisHullFromSamples(
    cache.pixelIndex.length,
    (index) => cache.localU[regionIndex][index],
    (index) => cache.localV[regionIndex][index],
    (_index, u, v) => containsExactRegionLocal(state, u, v, outLen, inLen, variant),
    outLen,
    inLen,
    2 / cache.scale,
  );
}

function buildHexAxisHulls(
  cache: MaskCache,
  state: AbUnionState,
  out: number[],
  inc: number[],
  variant: AbUnionLocalRegionVariant,
): Array<HexAxisHull | null> {
  return Array.from({ length: 6 }, (_, index) =>
    shouldUseHexAxisHull(state, out[index], inc[index])
      ? buildHexAxisHull(cache, state, index, out[index], inc[index], variant)
      : null,
  );
}

function hasVisibleRegionBits(state: AbUnionState, bits: number): boolean {
  return state.regionVisible.some((visible, index) => visible && (bits & (1 << index)) !== 0);
}

function prepareSourceMask(
  cache: MaskCache,
  definition: AbUnionRegionDefinition,
  quality: 'preview' | 'full',
  witness?: readonly Point[] | null,
): SourceRegionMask {
  const key = `${abUnionRegionKey(definition)}:${JSON.stringify(witness ?? null)}`;
  const previous = cache.sourceMasks[definition.index];
  if (previous?.key === key && (previous.quality === 'full' || quality === 'preview')) return previous;
  const sources = sampleRestrictedAbSources(definition, quality);
  const triangles = witness ? [...sources.triangles, witness] : sources.triangles;
  // Rasterize a source union once; model composition never scans its triangles.
  cache.offctx.clearRect(0, 0, cache.size, cache.size);
  cache.offctx.beginPath();
  for (const triangle of triangles) {
    triangle.forEach((point, index) => {
      const x = cache.center + cache.scale * point.x;
      const y = cache.center - cache.scale * point.y;
      if (index === 0) cache.offctx.moveTo(x, y);
      else cache.offctx.lineTo(x, y);
    });
    cache.offctx.closePath();
  }
  cache.offctx.fillStyle = '#000';
  cache.offctx.fill();
  const pixels = cache.offctx.getImageData(0, 0, cache.size, cache.size).data;
  const coverage = Uint8Array.from(cache.pixelIndex, (pixel) => pixels[pixel * 4 + 3] >= 128 ? 1 : 0);
  const prepared = {
    key, quality, coverage, count: triangles.length,
    status: witness ? `${sources.triangles.length} sampled sources + verified source` : sources.status,
  };
  cache.sourceMasks[definition.index] = prepared;
  return prepared;
}

function regionPixelColors(state: AbUnionState): Array<readonly [number, number, number, number]> {
  const highlighting = state.activeRegions.some((active, index) => active && state.regionVisible[index]);
  return Array.from({ length: 64 }, (_, bits) => {
    let red = 0, green = 0, blue = 0, alpha = 0;
    for (let index = 0; index < 6; index++) {
      if (!state.regionVisible[index] || (bits & (1 << index)) === 0) continue;
      const sourceAlpha = highlighting ? state.activeRegions[index] ? 0.3 : 0.045 : 0.16;
      const remaining = alpha * (1 - sourceAlpha);
      const nextAlpha = sourceAlpha + remaining;
      red = (REGION_RGB[index][0] * sourceAlpha + red * remaining) / nextAlpha;
      green = (REGION_RGB[index][1] * sourceAlpha + green * remaining) / nextAlpha;
      blue = (REGION_RGB[index][2] * sourceAlpha + blue * remaining) / nextAlpha;
      alpha = nextAlpha;
    }
    return [red, green, blue, alpha * 255] as const;
  });
}

function writePixel(data: Uint8ClampedArray, q: number, rgba: readonly [number, number, number, number]): void {
  data[q] = rgba[0];
  data[q + 1] = rgba[1];
  data[q + 2] = rgba[2];
  data[q + 3] = rgba[3];
}

function buildMask(
  cache: MaskCache,
  state: AbUnionState,
  variant: AbUnionLocalRegionVariant = 'exact',
  options: {
    sourceMasks?: readonly SourceRegionMask[];
    colorByRegion?: boolean;
    showUncovered?: boolean;
  } = {},
): number {
  const data = cache.overlay.data;
  data.fill(0);
  const out = Array.from({ length: 6 }, (_, index) => bValue(state, index));
  const inc = Array.from({ length: 6 }, (_, index) => aValue(state, index));
  const hexAxisHulls = options.sourceMasks ? [] : buildHexAxisHulls(cache, state, out, inc, variant);
  const colors = options.colorByRegion ? regionPixelColors(state) : null;
  let uncoveredCount = 0;

  for (let k = 0; k < cache.pixelIndex.length; k++) {
    let exactBits = 0;
    let modelBits = 0;
    for (let i = 0; i < 6; i++) {
      if (options.sourceMasks) {
        if (options.sourceMasks[i].coverage[k]) exactBits |= 1 << i;
        modelBits = exactBits;
        continue;
      }
      const u = cache.localU[i][k];
      const v = cache.localV[i][k];
      const hull = hexAxisHulls[i];
      const needsExact = state.showOriginalRegion || !state.useAxisAlignedHull || hull === null;
      const inExact = needsExact && containsExactRegionLocal(state, u, v, out[i], inc[i], variant);
      if (inExact) exactBits |= 1 << i;
      if (state.useAxisAlignedHull) {
        if (hull ? pointInHexAxisHull(u, v, hull) : inExact) {
          modelBits |= 1 << i;
        }
      } else if (inExact) {
        modelBits |= 1 << i;
      }
    }
    cache.maskBits[k] = modelBits;

    const q = cache.pixelIndex[k] * 4;
    if (!modelBits) {
      uncoveredCount++;
      if (options.showUncovered !== false) writePixel(data, q, UNCOVERED_RGBA);
    }
    if (colors) {
      if (hasVisibleRegionBits(state, modelBits)) writePixel(data, q, colors[modelBits]);
      continue;
    }
    if (state.useAxisAlignedHull && hasVisibleRegionBits(state, modelBits)) {
      writePixel(data, q, HULL_RGBA);
    }
    if (state.showOriginalRegion && hasVisibleRegionBits(state, exactBits)) {
      writePixel(data, q, COVER_RGBA);
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

function drawFMarkDistance(ctx: CanvasRenderingContext2D, state: AbUnionState, distanceValue: number | null): void {
  if (state.fMarks.length !== 2 || distanceValue === null) return;
  const start = mathToCanvas(state.fMarks[0].point);
  const end = mathToCanvas(state.fMarks[1].point);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  ctx.save();
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#2563eb';
  ctx.fillText(`d=${distanceValue.toFixed(5)}`, mid.x, mid.y - 6);
  ctx.restore();
}

function drawFMarkOverlay(ctx: CanvasRenderingContext2D, state: AbUnionState, triangle: ReturnType<typeof fitTriangle> | null): void {
  if (triangle) {
    drawPolygon(ctx, triangle.vertices, '#eab308', 'rgba(250, 204, 21, 0.14)');
  }

  ctx.save();
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const mark of state.fMarks) {
    const point = mathToCanvas(mark.point);
    const selected = mark.id === state.selectedFMarkId;
    ctx.beginPath();
    ctx.arc(point.x, point.y, selected ? 6.6 : 5.4, 0, 2 * Math.PI);
    ctx.fillStyle = '#fef08a';
    ctx.fill();
    ctx.strokeStyle = selected ? '#2563eb' : '#a16207';
    ctx.lineWidth = selected ? 2.4 : 1.7;
    ctx.stroke();
    ctx.fillStyle = '#854d0e';
    ctx.fillText(mark.id, point.x + 7, point.y - 7);
  }
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
  ctx.strokeStyle = AB_UNION_REGION_COLORS[regionIndex];
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 1.15;
  ctx.stroke();
  ctx.restore();
}

function drawActiveBoundaries(
  ctx: CanvasRenderingContext2D,
  cache: MaskCache,
  state: AbUnionState,
  visibleOnly = false,
): void {
  for (let i = 0; i < 6; i++) {
    if (state.activeRegions[i] && (!visibleOnly || state.regionVisible[i])) drawRegionBoundary(ctx, cache, i);
  }
}

function drawMarkPrimitive(
  ctx: CanvasRenderingContext2D,
  primitive: AbUnionMarkPrimitive,
): void {
  ctx.save();
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 5.2;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  if (primitive.kind === 'line') {
    const start = mathToCanvas(primitive.start);
    const end = mathToCanvas(primitive.end);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  } else {
    const center = mathToCanvas(primitive.center);
    ctx.arc(center.x, center.y, scaleToCanvas(primitive.radius), 0, 2 * Math.PI);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSelectedMarkSources(
  ctx: CanvasRenderingContext2D,
  state: AbUnionState,
  triangleState: TriangleState,
): void {
  for (const source of state.selectedMarkSources) {
    const primitive = markPrimitiveForRef(source, state, triangleState);
    if (primitive) drawMarkPrimitive(ctx, primitive);
  }
}

function drawAbUnionLabels(ctx: CanvasRenderingContext2D, state: AbUnionState): void {
  ctx.save();
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const label of state.labels) {
    if (!label.point) continue;
    const point = mathToCanvas(label.point);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.fillText(label.name, point.x + 6, point.y - 6);
  }
  ctx.restore();
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
    const edge = state.edgeDots[i];
    const edgeMid = {
      x: (HEXAGON_VERTICES[i].x + HEXAGON_VERTICES[mod6(i + 1)].x) / 2,
      y: (HEXAGON_VERTICES[i].y + HEXAGON_VERTICES[mod6(i + 1)].y) / 2,
    };
    const normalLen = Math.hypot(edgeMid.x, edgeMid.y) || 1;
    const normal = { x: edgeMid.x / normalLen, y: edgeMid.y / normalLen };
    const tangent = edgeVector(i);
    const tangentLen = Math.hypot(tangent.x, tangent.y) || 1;
    const unitTangent = { x: tangent.x / tangentLen, y: tangent.y / tangentLen };

    function drawHandle(value: number, labelText: string, active: boolean, color: string, labelShift: number): void {
      const point = pointOnEdge(i, value);
      const canvasPoint = mathToCanvas(point);
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, 7.7, 0, 2 * Math.PI);
      ctx.fillStyle = active ? '#fff7ed' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = active ? color : '#334155';
      ctx.lineWidth = active ? 2.7 : 2.1;
      ctx.stroke();

      const label = mathToCanvas({
        x: point.x + 0.085 * normal.x + labelShift * unitTangent.x,
        y: point.y + 0.085 * normal.y + labelShift * unitTangent.y,
      });
      ctx.fillStyle = '#475569';
      ctx.fillText(labelText, label.x, label.y);
    }

    if (edge.split) {
      drawHandle(edge.left, `b${i}`, state.activeRegions[i], '#2563eb', -0.035);
      drawHandle(edge.right, `a${mod6(i + 1)}`, state.activeRegions[mod6(i + 1)], '#d97706', 0.035);
    } else {
      drawHandle(
        edge.left,
        `b${i}/a${mod6(i + 1)}`,
        state.activeRegions[i] || state.activeRegions[mod6(i + 1)],
        '#d97706',
        0,
      );
    }
  }

  ctx.restore();
}

function optimizeThetaForMask(
  cache: MaskCache,
  thetaSamples: number,
  quality: AbUnionQuality,
): AbUnionOptimization & { vertices: Point[] | null; analysisCount: number } {
  let best: AbUnionOptimization & { vertices: Point[] | null; analysisCount: number } = {
    theta: 0,
    L: Number.POSITIVE_INFINITY,
    vertices: null,
    analysisCount: 0,
  };
  const samples = Math.max(1, Math.floor(thetaSamples));
  for (let i = 0; i < samples; i++) {
    const theta = (ANGLE_PERIOD * i) / samples;
    const candidate = computeThetaTriangle(cache, theta, quality);
    if (candidate.L < best.L) best = candidate;
  }
  return best;
}

function evaluateState(
  state: AbUnionState,
  thetaSamples: number,
  size: number,
  quality: AbUnionQuality,
): AbUnionOptimization {
  const cache = getMaskCache(size);
  const tempState = createDefaultAbUnionState();
  tempState.edgeDots = state.edgeDots.map((edge) => ({ ...edge }));
  tempState.clipToCornerSectors = state.clipToCornerSectors;
  tempState.useAxisAlignedHull = state.useAxisAlignedHull;
  tempState.showOriginalRegion = false;
  buildMask(cache, tempState, 'exact');

  return optimizeThetaForMask(cache, thetaSamples, quality);
}

export function optimizeAbUnionTheta(
  state: AbUnionState,
  thetaSamples = 240,
  size = config.canvasSize,
): AbUnionOptimization {
  normalizeAbUnionState(state);
  return evaluateState(state, thetaSamples, size, state.quality);
}

export function renderAbUnionRegions(
  ctx: CanvasRenderingContext2D,
  state: AbUnionState,
  options: AbUnionRegionRenderOptions = {},
): { uncoveredCount: number; regions: Array<{ count: number; status: string }> } {
  const cache = getMaskCache(config.canvasSize);
  const sourceMasks = options.sourceRegions?.map((definition, index) =>
    prepareSourceMask(cache, definition, options.sourceQuality ?? 'full', options.sourceWitnesses?.[index]),
  );
  const uncoveredCount = buildMask(cache, state, options.localRegionVariant ?? 'exact', {
    sourceMasks, colorByRegion: options.colorByRegion, showUncovered: options.showUncovered,
  });
  ctx.drawImage(cache.offscreen, 0, 0, config.canvasSize, config.canvasSize);
  if (options.drawBoundaries !== false) drawActiveBoundaries(ctx, cache, state, sourceMasks !== undefined);
  return { uncoveredCount, regions: sourceMasks?.map(({ count, status }) => ({ count, status })) ?? [] };
}

export function renderAbUnion(
  ctx: CanvasRenderingContext2D,
  state: AbUnionState,
  triangleState: TriangleState,
  localCs: number[],
  options: AbUnionRenderOptions = {},
): AbUnionRenderResult {
  normalizeAbUnionState(state);
  enforceAbUnionLocks(state);
  const cache = getMaskCache(config.canvasSize);
  const localRegionVariant = options.localRegionVariant ?? 'exact';
  refreshAbUnionLabels(state, triangleState);
  applyAbUnionCoincidenceLocks(state);
  enforceAbUnionLocks(state);
  const { uncoveredCount } = renderAbUnionRegions(ctx, state, { localRegionVariant, drawBoundaries: false });
  const computeTheta = options.computeTheta ?? true;
  const shouldOptimizeTheta = computeTheta && state.autoOptimizeTheta && state.thetaOptimizationPending;
  const thetaResult = computeTheta
    ? shouldOptimizeTheta
      ? optimizeThetaForMask(cache, 240, state.quality)
      : computeThetaTriangle(cache, state.theta, state.quality)
    : {
        theta: state.theta,
        L: state.lastOptimized?.L ?? 0,
        vertices: null,
        analysisCount: 0,
      };
  if (shouldOptimizeTheta) {
    state.theta = thetaResult.theta;
    state.lastOptimized = { theta: thetaResult.theta, L: thetaResult.L };
    state.thetaOptimizationPending = false;
  }
  const farPair = state.showFarPair ? findFarRedPair(cache) : null;
  const currentFMarkDistance = fMarkDistance(state);
  const currentFMarkTriangle = fMarkTriangle(state);
  if (state.showThetaTriangle) {
    drawThetaTriangle(ctx, thetaResult.vertices);
  }
  drawCenterShape(ctx, state, triangleState, localCs);
  drawFarPair(ctx, farPair);
  drawActiveBoundaries(ctx, cache, state);
  drawSelectedMarkSources(ctx, state, triangleState);
  drawPointsAndVertices(ctx, state);
  drawFMarkDistance(ctx, state, currentFMarkDistance);
  drawFMarkOverlay(ctx, state, currentFMarkTriangle);
  drawAbUnionLabels(ctx, state);
  const containment = computeCenterContainment(cache, state, triangleState, localCs);

  return {
    currentL: thetaResult.L,
    thetaTriangle: thetaResult.vertices,
    uncoveredCount,
    analysisCount: thetaResult.analysisCount,
    centerContains: containment.contains,
    centerFailures: containment.failures,
    farPair,
    minEqualityGap: minEqualityGap(state),
    fMarkCount: state.fMarks.length,
    fMarkDistance: currentFMarkDistance,
    fMarkTriangleSide: currentFMarkTriangle?.side ?? null,
    edgeRows: edgeRowsForState(state),
    regionRows: regionRowsForState(state),
    activeLabel: activeLabel(state.activeRegions),
  };
}

export function renderAbUnionBoundaryControls(
  ctx: CanvasRenderingContext2D,
  state: AbUnionState,
  options: { showFMarkTriangle?: boolean } = {},
): AbUnionBoundaryRenderResult {
  normalizeAbUnionState(state);
  enforceAbUnionLocks(state);
  const currentFMarkDistance = fMarkDistance(state);
  const currentFMarkTriangle = options.showFMarkTriangle === false ? null : fMarkTriangle(state);
  drawPointsAndVertices(ctx, state);
  drawFMarkDistance(ctx, state, currentFMarkDistance);
  drawFMarkOverlay(ctx, state, currentFMarkTriangle);

  return {
    fMarkCount: state.fMarks.length,
    fMarkDistance: currentFMarkDistance,
    fMarkTriangleSide: currentFMarkTriangle?.side ?? null,
    edgeRows: edgeRowsForState(state),
    regionRows: regionRowsForState(state),
    activeLabel: activeLabel(state.activeRegions),
  };
}
