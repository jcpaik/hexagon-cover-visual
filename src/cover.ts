import type { Point, TriangleState } from './types';
import { convexHull } from './convexHull';
import { maxAdmissibleCoverage } from './maps';
import { HEXAGON_VERTICES } from './hexagon';

const SQRT3 = Math.sqrt(3);
const ANGLE_PERIOD = 2 * Math.PI / 3;
const COVER_EPS = 1e-9;

const COLORS = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
];

export interface CoverTriangle {
  name: string;
  color: string;
  center: Point;
  phi: number;
  side: number;
  vertices: Point[];
  normals: Point[];
  lambdas: number[];
}

export interface CoverStep {
  index: number;
  a: number;
  b: number;
  c: number;
  aNext: number;
}

export interface CoverSegmentReport {
  kind: 'edge' | 'diag';
  index: number;
  intervals: Array<[number, number]>;
  gaps: Array<[number, number]>;
}

export interface CoverResult {
  vTriangles: CoverTriangle[];
  steps: CoverStep[];
  segments: CoverSegmentReport[];
  coverageOk: boolean;
  tooLargeTriangles: string[];
}

export type CoverChainDirection = 'ccw' | 'cw';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(scaleValue: number, point: Point): Point {
  return { x: scaleValue * point.x, y: scaleValue * point.y };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function triangleVerticesFromCenter(center: Point, phi: number, side: number): Point[] {
  const circumradius = side / SQRT3;
  return [0, 1, 2].map((k) => ({
    x: center.x + circumradius * Math.cos(phi + 2 * Math.PI * k / 3),
    y: center.y + circumradius * Math.sin(phi + 2 * Math.PI * k / 3),
  }));
}

function triangleHalfplanes(center: Point, phi: number, side: number): {
  normals: Point[];
  lambdas: number[];
} {
  const inradius = side / (2 * SQRT3);
  const normals = [0, 1, 2].map((k) => ({
    x: -Math.cos(phi + 2 * Math.PI * k / 3),
    y: -Math.sin(phi + 2 * Math.PI * k / 3),
  }));
  const lambdas = normals.map((normal) => dot(normal, center) + inradius);
  return { normals, lambdas };
}

function buildTriangle(name: string, center: Point, phi: number, side: number, color: string): CoverTriangle {
  const halfplanes = triangleHalfplanes(center, phi, side);
  return {
    name,
    color,
    center,
    phi,
    side,
    vertices: triangleVerticesFromCenter(center, phi, side),
    normals: halfplanes.normals,
    lambdas: halfplanes.lambdas,
  };
}

export function buildCentralCoverTriangle(state: TriangleState): CoverTriangle {
  return buildTriangle('C', state.position, state.angle + Math.PI / 2, 1, '#0ea5e9');
}

function localPoints(index: number, step: CoverStep): Point[] {
  const vertex = HEXAGON_VERTICES[index];
  const previous = HEXAGON_VERTICES[(index + 5) % 6];
  const nextVertex = HEXAGON_VERTICES[(index + 1) % 6];
  return [
    vertex,
    add(vertex, scale(step.a, subtract(previous, vertex))),
    add(vertex, scale(step.b, subtract(nextVertex, vertex))),
    scale(1 - step.c, vertex),
  ];
}

function requiredInradius(points: Point[], beta: number): number {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const angle = beta + 2 * Math.PI * k / 3;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    let offset = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      offset = Math.max(offset, nx * point.x + ny * point.y);
    }
    sum += offset;
  }
  return sum / 3;
}

function centroidFromBeta(points: Point[], beta: number): Point {
  const normals = [0, 1, 2].map((k) => ({
    x: Math.cos(beta + 2 * Math.PI * k / 3),
    y: Math.sin(beta + 2 * Math.PI * k / 3),
  }));
  const offsets = normals.map((normal) => Math.max(...points.map((point) => dot(normal, point))));
  const radius = offsets.reduce((sum, value) => sum + value, 0) / 3;
  const a1 = normals[0].x;
  const b1 = normals[0].y;
  const a2 = normals[1].x;
  const b2 = normals[1].y;
  const c1 = offsets[0] - radius;
  const c2 = offsets[1] - radius;
  const det = a1 * b2 - a2 * b1;
  return {
    x: (c1 * b2 - c2 * b1) / det,
    y: (a1 * c2 - a2 * c1) / det,
  };
}

// Between successive support changes L(theta)=A cos(theta)+B sin(theta)>0,
// hence L''=-L<0. A minimum occurs at a hull-edge normal (paper 2607/2609).
// This exhausts orientations; the arithmetic is floating point, not a
// certified interval comparison with side 1.
export function fitTriangle(name: string, points: Point[], color: string): CoverTriangle {
  if (!points.length || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new RangeError('An enclosure needs at least one finite point.');
  }
  const origin = points[0];
  const translated = points.map((p) => subtract(p, origin));
  const magnitude = Math.max(...translated.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  if (magnitude === 0) return buildTriangle(name, { ...origin }, 0, 0, color);
  const local = translated.map((p) => scale(1 / magnitude, p));
  const hull = convexHull(local);
  let beta = 0, radius = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const edge = subtract(hull[(i + 1) % hull.length], hull[i]);
    const angle = ((Math.atan2(-edge.x, edge.y) % ANGLE_PERIOD) + ANGLE_PERIOD) % ANGLE_PERIOD;
    const candidate = requiredInradius(hull, angle);
    if (candidate < radius) { beta = angle; radius = candidate; }
  }
  const center = centroidFromBeta(hull, beta);
  return buildTriangle(name, add(origin, scale(magnitude, center)), beta + Math.PI,
    2 * SQRT3 * Math.max(0, radius) * magnitude, color);
}

function buildCoverSteps(
  localCs: number[],
  startValue: number,
  strict: number,
  vertexOrder: number[],
  direction: CoverChainDirection,
): CoverStep[] {
  const steps: CoverStep[] = [];
  let current = clamp01(startValue);

  localCs.forEach((localC, orderIndex) => {
    const index = vertexOrder[orderIndex] ?? orderIndex;
    const oppositeCoverage = maxAdmissibleCoverage(current, localC);
    const next = clamp01(1 + strict - oppositeCoverage);
    steps.push({
      index,
      a: direction === 'ccw' ? current : oppositeCoverage,
      b: direction === 'ccw' ? oppositeCoverage : current,
      c: clamp01(localC),
      aNext: next,
    });
    current = next;
  });

  return steps;
}

export function intervalOnSegment(
  start: Point,
  end: Point,
  triangle: CoverTriangle,
): [number, number] | null {
  let tMin = 0;
  let tMax = 1;
  const direction = subtract(end, start);

  for (let i = 0; i < triangle.normals.length; i++) {
    const normal = triangle.normals[i];
    const constant = dot(normal, start) - triangle.lambdas[i];
    const delta = dot(normal, direction);
    if (Math.abs(delta) < 1e-12) {
      if (constant <= 1e-12) {
        continue;
      }
      return null;
    }

    const root = -constant / delta;
    if (delta > 0) {
      tMax = Math.min(tMax, root);
    } else {
      tMin = Math.max(tMin, root);
    }

    if (tMin > tMax + 1e-12) {
      return null;
    }
  }

  return [Math.max(0, tMin), Math.min(1, tMax)];
}

function mergeIntervals(intervals: Array<[number, number] | null>): Array<[number, number]> {
  const valid = intervals
    .filter((interval): interval is [number, number] => interval !== null && interval[1] >= interval[0])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];

  for (const interval of valid) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1] + COVER_EPS) {
      merged.push([interval[0], interval[1]]);
    } else {
      last[1] = Math.max(last[1], interval[1]);
    }
  }

  return merged;
}

function getGaps(intervals: Array<[number, number]>): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let cursor = 0;

  for (const [start, end] of intervals) {
    if (start > cursor + COVER_EPS) {
      gaps.push([cursor, start]);
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < 1 - COVER_EPS) {
    gaps.push([cursor, 1]);
  }

  return gaps;
}

function buildCoverageReport(triangles: CoverTriangle[]): CoverSegmentReport[] {
  const origin = { x: 0, y: 0 };
  const reports: CoverSegmentReport[] = [];

  for (let i = 0; i < 6; i++) {
    const intervals = mergeIntervals(
      triangles.map((triangle) => intervalOnSegment(HEXAGON_VERTICES[i], HEXAGON_VERTICES[(i + 1) % 6], triangle)),
    );
    reports.push({
      kind: 'edge',
      index: i,
      intervals,
      gaps: getGaps(intervals),
    });
  }

  for (let i = 0; i < 6; i++) {
    const intervals = mergeIntervals(
      triangles.map((triangle) => intervalOnSegment(origin, HEXAGON_VERTICES[i], triangle)),
    );
    reports.push({
      kind: 'diag',
      index: i,
      intervals,
      gaps: getGaps(intervals),
    });
  }

  return reports;
}

export function computeCoverResult(
  triangleState: TriangleState,
  localCs: number[],
  startValue: number,
  strict: number,
  vertexOrder = [0, 1, 2, 3, 4, 5],
  direction: CoverChainDirection = 'ccw',
  includeCentralTriangle = true,
): CoverResult {
  const steps = buildCoverSteps(localCs, startValue, strict, vertexOrder, direction);
  const vTriangles = steps.map((step) =>
    fitTriangle(`V${step.index}`, localPoints(step.index, step), COLORS[step.index]),
  );
  const allTriangles = includeCentralTriangle
    ? [buildCentralCoverTriangle(triangleState), ...vTriangles]
    : vTriangles;
  const segments = buildCoverageReport(allTriangles);
  const tooLargeTriangles = vTriangles
    .filter((triangle) => triangle.side >= 1 - 1e-9)
    .map((triangle) => triangle.name);

  return {
    vTriangles,
    steps,
    segments,
    coverageOk: segments.every((segment) => segment.gaps.length === 0),
    tooLargeTriangles,
  };
}
