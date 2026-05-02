import type { Point } from './types';
import { HEXAGON_VERTICES } from './hexagon';
import { fitTriangle, type CoverTriangle } from './cover';
import {
  type FreeConstraintStatus,
  type FreeLabel,
  type FreeNamedPointRef,
  type FreeSegment,
  type FreeSegmentRef,
  type FreeState,
  type FreeTarget,
  type FreeTriangleId,
  type FreeTriangleState,
  type FreeVd0Mode,
  type FreeValidationResult,
  type FreeValidationSegment,
} from './freeTypes';

const SQRT3 = Math.sqrt(3);
const CIRCUMRADIUS = 1 / SQRT3;
const INRADIUS = 1 / (2 * SQRT3);
const CONSTRAINT_ITERS = 8;
const VD0_SAMPLES = 512;
const VD0_SEARCH_STEPS = 48;
const EPS = 1e-9;
const VD0_FIT_SIDE_TOLERANCE = 1e-6;

const FREE_COLORS: Record<FreeTriangleId, string> = {
  C: '#0ea5e9',
  V0: '#ef4444',
  V1: '#f59e0b',
  V2: '#10b981',
  V3: '#8b5cf6',
  V4: '#ec4899',
  V5: '#14b8a6',
};

export function midpoint(index: number): Point {
  const vertex = HEXAGON_VERTICES[index];
  return { x: vertex.x / 2, y: vertex.y / 2 };
}

export function triangleVertices(center: Point, angle: number): [Point, Point, Point] {
  return [0, 1, 2].map((k) => {
    const a = angle + Math.PI / 2 + k * (2 * Math.PI / 3);
    return {
      x: center.x + CIRCUMRADIUS * Math.cos(a),
      y: center.y + CIRCUMRADIUS * Math.sin(a),
    };
  }) as [Point, Point, Point];
}

export function createDefaultFreeState(): FreeState {
  const triangles: FreeTriangleState[] = [
    { id: 'C', center: { x: 0, y: 0 }, angle: 0, fixed: false, hidden: false, midpointConstraints: Array(6).fill(false), edgePointConstraint: null, vd0: { enabled: false, mode: 'max-c' } },
    ...HEXAGON_VERTICES.map((vertex, index) => ({
      id: `V${index}` as FreeTriangleId,
      center: { x: vertex.x * 0.78, y: vertex.y * 0.78 },
      angle: index * Math.PI / 3,
      fixed: false,
      hidden: false,
      midpointConstraints: Array(6).fill(false),
      edgePointConstraint: null,
      vd0: { enabled: false, mode: 'max-c' as FreeVd0Mode },
    })),
  ];

  return {
    target: 'S_HALF',
    tool: 'move',
    strictEps: 1e-5,
    selectedTriangleId: 'C',
    triangles,
    labels: [],
    selectedSegments: [],
    status: 'Free mode ready.',
  };
}

export function colorForTriangle(id: FreeTriangleId): string {
  return FREE_COLORS[id];
}

export function getTriangle(state: FreeState, id: FreeTriangleId): FreeTriangleState {
  const triangle = state.triangles.find((candidate) => candidate.id === id);
  if (!triangle) {
    throw new Error(`Unknown free triangle ${id}`);
  }
  return triangle;
}

export function allowedMidpointIndices(id: FreeTriangleId): number[] {
  if (id === 'C') {
    return [0, 1, 2, 3, 4, 5];
  }
  const index = Number(id.slice(1));
  return [(index + 5) % 6, index, (index + 1) % 6];
}

export function freeTriangleToCoverTriangle(triangle: FreeTriangleState): CoverTriangle {
  const vertices = triangleVertices(triangle.center, triangle.angle);
  const normals = [0, 1, 2].map((k) => {
    const a = vertices[k];
    const b = vertices[(k + 1) % 3];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dy / length, y: -dx / length };
  });
  const lambdas = normals.map((normal, index) => {
    const vertex = vertices[index];
    return normal.x * vertex.x + normal.y * vertex.y;
  });

  return {
    name: triangle.id,
    color: colorForTriangle(triangle.id),
    center: triangle.center,
    phi: triangle.angle + Math.PI / 2,
    side: 1,
    vertices,
    normals,
    lambdas,
  };
}

export function strictPointInTriangle(point: Point, triangle: FreeTriangleState, strictEps: number): boolean {
  const vertices = triangleVertices(triangle.center, triangle.angle);
  for (let i = 0; i < 3; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % 3];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross < strictEps - EPS) {
      return false;
    }
  }
  return true;
}

export function namedPointLabel(ref: FreeNamedPointRef): string {
  if (ref.kind === 'O') return 'O';
  if (ref.kind === 'M') return `M${ref.index ?? 0}`;
  if (ref.kind === 'V') return `V${ref.index ?? 0}`;
  if (ref.kind === 'label') return ref.labelId ?? 'label';
  return 'manual';
}

export function resolveNamedPoint(state: FreeState, ref: FreeNamedPointRef): Point | null {
  if (ref.kind === 'O') return { x: 0, y: 0 };
  if (ref.kind === 'M') return midpoint(ref.index ?? 0);
  if (ref.kind === 'V') return HEXAGON_VERTICES[ref.index ?? 0] ?? null;
  if (ref.kind === 'manual') return ref.manualPoint ?? null;
  const label = state.labels.find((candidate) => candidate.id === ref.labelId);
  return label?.point ?? null;
}

export function getRequiredPoints(state: FreeState, triangle: FreeTriangleState): Array<{ point: Point; label: string }> {
  const points: Array<{ point: Point; label: string }> = [];
  if (triangle.id === 'C') {
    points.push({ point: { x: 0, y: 0 }, label: 'O' });
  } else {
    const index = Number(triangle.id.slice(1));
    points.push({ point: HEXAGON_VERTICES[index], label: triangle.id });
  }

  triangle.midpointConstraints.forEach((enabled, index) => {
    if (enabled) {
      points.push({ point: midpoint(index), label: `M${index}` });
    }
  });

  const target = triangle.edgePointConstraint
    ? resolveNamedPoint(state, triangle.edgePointConstraint.point)
    : null;
  if (target) {
    points.push({ point: target, label: namedPointLabel(triangle.edgePointConstraint!.point) });
  }

  return points;
}

function edgeInwardNormal(angle: number, edgeIndex: number): Point {
  const vertices = triangleVertices({ x: 0, y: 0 }, angle);
  const a = vertices[edgeIndex];
  const b = vertices[(edgeIndex + 1) % 3];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

function edgeInwardNormalBaseAngle(edgeIndex: number): number {
  const normal = edgeInwardNormal(0, edgeIndex);
  return Math.atan2(normal.y, normal.x);
}

function closestAngle(current: number, candidates: number[]): number {
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const shifted = current + Math.atan2(Math.sin(candidate - current), Math.cos(candidate - current));
    const distance = Math.abs(shifted - current);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = shifted;
    }
  }
  return best;
}

export function projectTriangleToConstraints(state: FreeState, triangle: FreeTriangleState): void {
  const edgeConstraint = triangle.edgePointConstraint;
  const target = edgeConstraint ? resolveNamedPoint(state, edgeConstraint.point) : null;
  if (edgeConstraint && target) {
    const q = { x: target.x - triangle.center.x, y: target.y - triangle.center.y };
    const length = Math.hypot(q.x, q.y);
    if (length >= INRADIUS + EPS) {
      const alpha = Math.atan2(q.y, q.x);
      const delta = Math.acos(Math.max(-1, Math.min(1, -INRADIUS / length)));
      const base = edgeInwardNormalBaseAngle(edgeConstraint.edgeIndex);
      triangle.angle = closestAngle(triangle.angle, [alpha + delta - base, alpha - delta - base]);
    }
  }

  for (let iter = 0; iter < CONSTRAINT_ITERS; iter++) {
    let changed = false;
    const required = getRequiredPoints(state, triangle);
    const relVertices = triangleVertices({ x: 0, y: 0 }, triangle.angle);
    for (const { point } of required) {
      for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
        const a = relVertices[edgeIndex];
        const b = relVertices[(edgeIndex + 1) % 3];
        const edge = { x: b.x - a.x, y: b.y - a.y };
        const normal = { x: -edge.y, y: edge.x };
        const limit = edge.x * (point.y - a.y) - edge.y * (point.x - a.x) - state.strictEps;
        const current = normal.x * triangle.center.x + normal.y * triangle.center.y;
        if (current <= limit + EPS) {
          continue;
        }
        const len2 = normal.x * normal.x + normal.y * normal.y;
        const amount = (current - limit) / len2;
        triangle.center = {
          x: triangle.center.x - amount * normal.x,
          y: triangle.center.y - amount * normal.y,
        };
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function strictIntervalOnSegment(start: Point, end: Point, triangle: FreeTriangleState, strictEps: number): [number, number] | null {
  let tMin = 0;
  let tMax = 1;
  const vertices = triangleVertices(triangle.center, triangle.angle);
  const direction = { x: end.x - start.x, y: end.y - start.y };

  for (let i = 0; i < 3; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % 3];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const base = edge.x * (start.y - a.y) - edge.y * (start.x - a.x);
    const delta = edge.x * direction.y - edge.y * direction.x;
    const required = Math.max(0, strictEps);

    if (Math.abs(delta) < EPS) {
      if (base < required - EPS) {
        return null;
      }
      continue;
    }

    const root = (required - base) / delta;
    if (delta > 0) {
      tMin = Math.max(tMin, root);
    } else {
      tMax = Math.min(tMax, root);
    }
    if (tMin > tMax + EPS) {
      return null;
    }
  }

  if (tMax < tMin + EPS) {
    return null;
  }
  return [Math.max(0, tMin), Math.min(1, tMax)];
}

function mergeIntervals(intervals: Array<[number, number] | null>): Array<[number, number]> {
  const valid = intervals
    .filter((interval): interval is [number, number] => interval !== null)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const interval of valid) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1] + EPS) {
      merged.push([...interval]);
    } else {
      last[1] = Math.max(last[1], interval[1]);
    }
  }
  return merged;
}

function gapsFromIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (start > cursor + EPS) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1 - EPS) gaps.push([cursor, 1]);
  return gaps;
}

function classicalAdmissibleOrdered(a: number, b: number, c: number, strictInput: number): boolean {
  const strict = Math.max(0, strictInput);
  const sum = a + b;
  const circle = a * a + a * b + b * b;
  if (circle > 1 - strict + EPS) {
    return false;
  }

  const transition = sum ** 4 - sum * sum + a * b;
  const cell1 =
    sum <= 1 - strict + EPS &&
    transition <= -strict + EPS &&
    c ** 4 - c * c + a * c - a * a <= -strict + EPS;
  const cell2 =
    sum <= 1 - strict + EPS &&
    transition >= strict - EPS &&
    (sum * sum - 1) * c * c + b * c - b * b <= -strict + EPS;
  const cell3 =
    sum >= 1 + strict - EPS &&
    c <= 0.5 - strict + EPS &&
    (a * a - 1) * c * c + (2 * a * b * b + b) * c + (b ** 4 - b * b) <= -strict + EPS;

  return cell1 || cell2 || cell3;
}

function classicalAdmissible(aInput: number, bInput: number, cInput: number, strictInput: number): boolean {
  const a = Math.max(0, Math.min(1, aInput));
  const b = Math.max(0, Math.min(1, bInput));
  const c = Math.max(0, Math.min(1, cInput));
  if (a <= b + EPS) {
    return classicalAdmissibleOrdered(a, b, c, strictInput);
  }
  return classicalAdmissibleOrdered(b, a, c, strictInput);
}

function maxClassicalCoordinate(mode: FreeVd0Mode, a: number, b: number, c: number, strictEps: number): number {
  const predicate = (value: number): boolean => {
    if (mode === 'max-c') return classicalAdmissible(a, b, value, strictEps);
    if (mode === 'max-a') return classicalAdmissible(value, b, c, strictEps);
    return classicalAdmissible(a, value, c, strictEps);
  };
  if (predicate(1)) return 1;

  const step = 1 / VD0_SAMPLES;
  let lo = -1;
  let hi = 1;
  for (let i = VD0_SAMPLES - 1; i >= 0; i--) {
    const value = step * i;
    if (predicate(value)) {
      lo = value;
      hi = Math.min(1, value + step);
      break;
    }
  }
  if (lo < 0) return 0;

  for (let i = 0; i < VD0_SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (predicate(mid)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.max(0, Math.min(1, lo));
}

function farthestGapEndExcludingTriangle(
  state: FreeState,
  excludedId: FreeTriangleId,
  start: Point,
  end: Point,
): number {
  const intervals = mergeIntervals(
    state.triangles
      .filter((triangle) => triangle.id !== excludedId)
      .map((triangle) => strictIntervalOnSegment(start, end, triangle, state.strictEps)),
  );
  const gaps = gapsFromIntervals(intervals);
  return gaps.reduce((max, gap) => Math.max(max, gap[1]), 0);
}

export interface FreeVd0Status {
  ok: boolean;
  message: string | null;
  raw: { a: number; b: number; c: number };
  target: { a: number; b: number; c: number };
  max: number;
}

interface FreeVd0Target {
  raw: { a: number; b: number; c: number };
  a: number;
  b: number;
  c: number;
  max: number;
  points: Point[];
}

export function getFreeVd0Status(state: FreeState, triangle: FreeTriangleState): FreeVd0Status | null {
  const target = getFreeVd0Target(state, triangle);
  if (!target) return null;
  return {
    ok: true,
    message: null,
    raw: target.raw,
    target: { a: target.a, b: target.b, c: target.c },
    max: target.max,
  };
}

function pointOnSegment(start: Point, end: Point, value: number): Point {
  return {
    x: start.x + value * (end.x - start.x),
    y: start.y + value * (end.y - start.y),
  };
}

function getFreeVd0Target(state: FreeState, triangle: FreeTriangleState): FreeVd0Target | null {
  if (triangle.id === 'C' || !triangle.vd0.enabled) {
    return null;
  }

  const index = Number(triangle.id.slice(1));
  const vertex = HEXAGON_VERTICES[index];
  let a = farthestGapEndExcludingTriangle(state, triangle.id, vertex, HEXAGON_VERTICES[(index + 5) % 6]);
  let b = farthestGapEndExcludingTriangle(state, triangle.id, vertex, HEXAGON_VERTICES[(index + 1) % 6]);
  let c = farthestGapEndExcludingTriangle(state, triangle.id, vertex, { x: 0, y: 0 });
  const raw = { a, b, c };
  const max = maxClassicalCoordinate(triangle.vd0.mode, a, b, c, state.strictEps);

  if (triangle.vd0.mode === 'max-c') c = max;
  if (triangle.vd0.mode === 'max-a') a = max;
  if (triangle.vd0.mode === 'max-b') b = max;

  return {
    raw,
    a,
    b,
    c,
    max,
    points: [
      vertex,
      pointOnSegment(vertex, HEXAGON_VERTICES[(index + 5) % 6], a),
      pointOnSegment(vertex, HEXAGON_VERTICES[(index + 1) % 6], b),
      pointOnSegment(vertex, { x: 0, y: 0 }, c),
    ],
  };
}

export function autoPlaceFreeVd0Triangle(state: FreeState, triangle: FreeTriangleState): { ok: true } | { ok: false; reason: string } {
  const target = getFreeVd0Target(state, triangle);
  if (!target) {
    return { ok: true };
  }

  const fitted = fitTriangle(triangle.id, target.points, colorForTriangle(triangle.id));
  if (fitted.side > 1 + VD0_FIT_SIDE_TOLERANCE) {
    return { ok: false, reason: `Vd0 auto-place failed; fitted side=${fitted.side.toFixed(6)}.` };
  }

  triangle.fixed = false;
  triangle.hidden = false;
  triangle.center = fitted.center;
  triangle.angle = fitted.phi - Math.PI / 2;
  return { ok: true };
}

export function autoPlaceAllFreeVd0Triangles(state: FreeState): { ok: true } | { ok: false; failedIds: FreeTriangleId[] } {
  const failedIds: FreeTriangleId[] = [];
  for (let i = 0; i < 6; i++) {
    const triangle = state.triangles.find((candidate) => candidate.id === `V${i}` as FreeTriangleId);
    if (!triangle?.vd0.enabled) continue;
    const result = autoPlaceFreeVd0Triangle(state, triangle);
    if (!result.ok) {
      failedIds.push(triangle.id);
    }
  }
  return failedIds.length === 0 ? { ok: true } : { ok: false, failedIds };
}

export function validateFreeState(state: FreeState): FreeValidationResult {
  const visibleOrHiddenTriangles = state.triangles;
  const segments: FreeValidationSegment[] = [];
  const checkSegment = (kind: 'edge' | 'diag', index: number, start: Point, end: Point): void => {
    const intervals = mergeIntervals(
      visibleOrHiddenTriangles.map((triangle) => strictIntervalOnSegment(start, end, triangle, state.strictEps)),
    );
    segments.push({ kind, index, intervals, gaps: gapsFromIntervals(intervals) });
  };

  for (let i = 0; i < 6; i++) {
    checkSegment('edge', i, HEXAGON_VERTICES[i], HEXAGON_VERTICES[(i + 1) % 6]);
  }
  if (state.target === 'S') {
    for (let i = 0; i < 6; i++) {
      checkSegment('diag', i, { x: 0, y: 0 }, HEXAGON_VERTICES[i]);
    }
  }

  const pointFailures: string[] = [];
  if (state.target === 'S_HALF') {
    const points = [{ label: 'O', point: { x: 0, y: 0 } }, ...[0, 1, 2, 3, 4, 5].map((i) => ({ label: `M${i}`, point: midpoint(i) }))];
    for (const { label, point } of points) {
      if (!state.triangles.some((triangle) => strictPointInTriangle(point, triangle, state.strictEps))) {
        pointFailures.push(label);
      }
    }
  }

  const constraintStatuses = state.triangles.map((triangle): FreeConstraintStatus => {
    const messages: string[] = [];
    for (const { point, label } of getRequiredPoints(state, triangle)) {
      if (!strictPointInTriangle(point, triangle, state.strictEps)) {
        messages.push(`misses ${label}`);
      }
    }
    if (triangle.edgePointConstraint) {
      const point = resolveNamedPoint(state, triangle.edgePointConstraint.point);
      if (!point) {
        messages.push(`missing ${namedPointLabel(triangle.edgePointConstraint.point)}`);
      } else {
        const vertices = triangleVertices(triangle.center, triangle.angle);
        const a = vertices[triangle.edgePointConstraint.edgeIndex];
        const b = vertices[(triangle.edgePointConstraint.edgeIndex + 1) % 3];
        const distance = Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x));
        if (distance > Math.max(1e-5, state.strictEps * 4)) {
          messages.push(`edge misses ${namedPointLabel(triangle.edgePointConstraint.point)}`);
        }
      }
    }
    const vd0Status = getFreeVd0Status(state, triangle);
    if (vd0Status?.message) {
      messages.push(vd0Status.message);
    }
    return { triangleId: triangle.id, ok: messages.length === 0, messages };
  });

  return {
    coverageOk: segments.every((segment) => segment.gaps.length === 0) && pointFailures.length === 0,
    constraintsOk: constraintStatuses.every((status) => status.ok),
    segments,
    pointFailures,
    constraintStatuses,
  };
}

export function skeletonSegments(state: FreeState): FreeSegment[] {
  const segments: FreeSegment[] = [];
  for (let i = 0; i < 6; i++) {
    segments.push({
      ref: { kind: 'hex-edge', index: i },
      start: HEXAGON_VERTICES[i],
      end: HEXAGON_VERTICES[(i + 1) % 6],
      label: `e${i}`,
    });
    segments.push({
      ref: { kind: 'half-diagonal', index: i },
      start: { x: 0, y: 0 },
      end: HEXAGON_VERTICES[i],
      label: `r${i}`,
    });
  }
  for (const triangle of state.triangles) {
    if (triangle.hidden) continue;
    const vertices = triangleVertices(triangle.center, triangle.angle);
    for (let i = 0; i < 3; i++) {
      segments.push({
        ref: { kind: 'triangle-edge', index: i, triangleId: triangle.id },
        start: vertices[i],
        end: vertices[(i + 1) % 3],
        label: `${triangle.id}.edge${i}`,
      });
    }
  }
  return segments;
}

export function sameSegmentRef(a: FreeSegmentRef, b: FreeSegmentRef): boolean {
  return a.kind === b.kind && a.index === b.index && a.triangleId === b.triangleId;
}

export function getSegmentByRef(state: FreeState, ref: FreeSegmentRef): FreeSegment | null {
  return skeletonSegments(state).find((segment) => sameSegmentRef(segment.ref, ref)) ?? null;
}

export function segmentIntersection(a: FreeSegment, b: FreeSegment): Point | null {
  const r = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
  const s = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < EPS) return null;
  const q = { x: b.start.x - a.start.x, y: b.start.y - a.start.y };
  const t = (q.x * s.y - q.y * s.x) / denom;
  const u = (q.x * r.y - q.y * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a.start.x + t * r.x, y: a.start.y + t * r.y };
}

export function refreshLabels(state: FreeState): void {
  for (const label of state.labels) {
    const first = getSegmentByRef(state, label.first);
    const second = getSegmentByRef(state, label.second);
    label.point = first && second ? segmentIntersection(first, second) : null;
  }
}

export function createLabel(state: FreeState, first: FreeSegmentRef, second: FreeSegmentRef): FreeLabel | null {
  const firstSegment = getSegmentByRef(state, first);
  const secondSegment = getSegmentByRef(state, second);
  if (!firstSegment || !secondSegment) return null;
  const point = segmentIntersection(firstSegment, secondSegment);
  if (!point) return null;
  const id = `P${state.labels.length + 1}`;
  return { id, name: id, first, second, point };
}

export function describeTarget(target: FreeTarget): string {
  return target === 'S' ? 'S' : 'S_{1/2}';
}
