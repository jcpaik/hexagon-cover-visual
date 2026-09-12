import type { Point } from '../types';
import { HEXAGON_VERTICES } from '../hexagon';
import { dot, edgeVector, lineIntersection, mod6, pointOnEdge } from './geometry';
import { abUnionRegionKey } from './regions';
import type { AbUnionRegionDefinition } from './types';

export const SOURCE_INTERIOR_MARGIN = 1e-9;
const CLOSED_TOLERANCE = 2e-11;
const ANGLE_PERIOD = 2 * Math.PI / 3;
const H = Math.sqrt(3) / 2;
const cache = new Map<string, Point[] | null>();
const angleHints = new Map<number, number>();
type Trig = [constant: number, cosine: number, sine: number];

function directions(index: number): [Point, Point] {
  const previous = edgeVector(mod6(index - 1));
  return [{ x: -previous.x, y: -previous.y }, edgeVector(index)];
}

function validDefinition(role: AbUnionRegionDefinition): boolean {
  return Number.isInteger(role.index) && role.index >= 0 && role.index < 6
    && [role.a, role.b].every((value) => Number.isFinite(value) && value >= 0 && value < 1)
    && role.a * role.a + role.a * role.b + role.b * role.b <= 1 + CLOSED_TOLERANCE
    && role.requiredInteriorPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

// Validate the returned certificate independently of how it was constructed.
// The source's actual reaches are measured from its three support halfplanes.
export function isRestrictedAbSource(role: AbUnionRegionDefinition, triangle: readonly Point[]): boolean {
  if (!validDefinition(role) || triangle.length !== 3 || triangle.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const normals: Point[] = [];
  const offsets: number[] = [];
  for (let index = 0; index < 3; index++) {
    const start = triangle[index];
    const end = triangle[(index + 1) % 3];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (Math.abs(length - 1) > 1e-8) return false;
    const normal = { x: dy / length, y: -dx / length };
    normals.push(normal);
    offsets.push(dot(normal, start));
  }
  const vertex = HEXAGON_VERTICES[role.index];
  for (const point of [vertex, ...role.requiredInteriorPoints]) {
    if (normals.some((normal, index) => offsets[index] - dot(normal, point) < SOURCE_INTERIOR_MARGIN)) return false;
  }
  const [inward, outward] = directions(role.index);
  const reach = (direction: Point) => Math.min(...normals.map((normal, index) => {
    const derivative = dot(normal, direction);
    return derivative > 0 ? (offsets[index] - dot(normal, vertex)) / derivative : Infinity;
  }));
  const a = reach(inward);
  const b = reach(outward);
  if (a < role.a - CLOSED_TOLERANCE || b < role.b - CLOSED_TOLERANCE) return false;
  if ((role.restriction === 'in' || role.restriction === 'both') && Math.abs(a - role.a) > CLOSED_TOLERANCE) return false;
  if ((role.restriction === 'out' || role.restriction === 'both') && Math.abs(b - role.b) > CLOSED_TOLERANCE) return false;
  if (role.criticality === 'non-supercritical' && a + b > 1 + CLOSED_TOLERANCE) return false;
  if (role.criticality === 'supercritical' && a + b <= 1 + SOURCE_INTERIOR_MARGIN) return false;
  return true;
}

function explicitSource(role: AbUnionRegionDefinition): { triangle: Point[]; a: number; b: number } | null {
  let { a, b } = role;
  const exactA = role.restriction === 'in' || role.restriction === 'both';
  const exactB = role.restriction === 'out' || role.restriction === 'both';
  if ((exactA && a === 0) || (exactB && b === 0)) return null;
  if (role.criticality === 'non-supercritical' && a + b > 1 + CLOSED_TOLERANCE) return null;
  const maximumPartner = (value: number) => (-value + Math.sqrt(4 - 3 * value * value)) / 2;
  if (role.criticality === 'supercritical' && a + b <= 1 + SOURCE_INTERIOR_MARGIN) {
    if (exactA && exactB) return null;
    if (!exactA && !exactB) a = Math.max(a, (a + 1 - b) / 2);
    if (!exactB) b = Math.max(b, (1 - a + maximumPartner(a)) / 2);
    else a = Math.max(a, (1 - b + maximumPartner(b)) / 2);
  } else {
    // A free reach is a lower bound. Keeping a tiny positive demand exactly
    // would lose interior margin even when a larger admissible reach exists.
    const tinyA = !exactA && a < 4 * SOURCE_INTERIOR_MARGIN;
    const tinyB = !exactB && b < 4 * SOURCE_INTERIOR_MARGIN;
    if ((tinyA || tinyB) && a + b <= 1) {
      if (!exactA && !exactB) {
        a = Math.max(a, Math.min(0.5, 1 - b));
        b = 1 - a;
      } else if (tinyA) a = Math.max(a, Math.min(0.5, 1 - b));
      else b = Math.max(b, Math.min(0.5, 1 - a));
    }
  }
  if (a <= 0 || b <= 0) return null;
  const vertex = HEXAGON_VERTICES[role.index];
  const [inward] = directions(role.index);
  const start = { x: vertex.x + a * inward.x, y: vertex.y + a * inward.y };
  const end = pointOnEdge(role.index, b);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const normal = { x: along.y, y: -along.x };
  // V_i A B has angle 120° at V_i. Its other angles are strictly below 60°,
  // so V_i is interior to the equilateral triangle on AB. Symmetric extension
  // of that base to unit length preserves containment and both exact traces.
  return { a, b, triangle: [
    { x: middle.x + along.x / 2, y: middle.y + along.y / 2 },
    { x: middle.x - along.x / 2, y: middle.y - along.y / 2 },
    { x: middle.x + H * normal.x, y: middle.y + H * normal.y },
  ] };
}

function projection(side: number, point: Point, constant = 0): Trig {
  const angle = side * ANGLE_PERIOD;
  return [constant, Math.cos(angle) * point.x + Math.sin(angle) * point.y, -Math.sin(angle) * point.x + Math.cos(angle) * point.y];
}

function difference(a: Trig, b: Trig): Trig {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function evaluate(value: Trig, cosine: number, sine: number): number {
  return value[0] + value[1] * cosine + value[2] * sine;
}

function* feasibleAngles(constraints: Trig[], hint: number | undefined): Generator<number> {
  const valid = (angle: number) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return constraints.every((constraint) => evaluate(constraint, cosine, sine) >= -1e-13);
  };
  if (hint !== undefined && valid(hint)) yield hint;
  const boundaries = [0, ANGLE_PERIOD];
  for (const [constant, cosine, sine] of constraints) {
    const radius = Math.hypot(cosine, sine);
    if (radius < 1e-14) {
      if (constant < -1e-13) return;
      continue;
    }
    const ratio = -constant / radius;
    if (ratio > 1 + 1e-13) return;
    if (ratio < -1 || ratio > 1) continue;
    const phase = Math.atan2(sine, cosine);
    const offset = Math.acos(Math.max(-1, Math.min(1, ratio)));
    for (const sign of [-1, 1]) for (let turn = -1; turn <= 1; turn++) {
      const angle = phase + sign * offset + turn * 2 * Math.PI;
      if (angle > 0 && angle < ANGLE_PERIOD) boundaries.push(angle);
    }
  }
  boundaries.sort((a, b) => a - b);
  const distinct = boundaries.filter((angle, index) => index === 0 || angle - boundaries[index - 1] > 1e-13);
  // Between consecutive analytic roots all inequality signs are constant.
  // Check boundaries too: a feasible source may have an isolated orientation.
  for (const angle of [
    ...distinct.slice(1).map((angle, index) => (distinct[index] + angle) / 2),
    ...distinct,
  ]) if (valid(angle)) yield angle;
}

function supportedSource(role: AbUnionRegionDefinition): Point[] | null {
  const exactA = role.restriction === 'in' || role.restriction === 'both';
  const exactB = role.restriction === 'out' || role.restriction === 'both';
  if ((!exactA && !exactB) || role.criticality === 'supercritical') {
    throw new Error('Interior-constrained source feasibility requires an exact edge and an unrestricted or nonsupercritical role.');
  }
  const vertex = HEXAGON_VERTICES[role.index];
  const [inward, outward] = directions(role.index);
  const anchorA = { x: vertex.x + role.a * inward.x, y: vertex.y + role.a * inward.y };
  const anchorB = pointOnEdge(role.index, role.b);
  const strictPoints = [vertex, ...role.requiredInteriorPoints];
  const lower = [0, 1, 2].map((side) => [
    projection(side, anchorA), projection(side, anchorB),
    ...strictPoints.map((point) => projection(side, point, SOURCE_INTERIOR_MARGIN + 1e-12)),
  ]);
  const hint = angleHints.get(role.index);
  for (let first = 0; first < 3; first++) for (let second = 0; second < 3; second++) {
    const constraints: Trig[] = [];
    const offsets: Array<Trig | null> = [null, null, null];
    const fixedAnchor = exactA ? anchorA : anchorB;
    const fixedDirection = exactA ? inward : outward;
    offsets[first] = projection(first, fixedAnchor);
    constraints.push(projection(first, fixedDirection));
    if (exactA && exactB) {
      const forwardOffset = projection(second, anchorB);
      constraints.push(projection(second, outward));
      if (first === second) {
        const equal = difference(offsets[first]!, forwardOffset);
        constraints.push(equal, equal.map((value) => -value) as Trig);
      } else offsets[second] = forwardOffset;
    }
    const free = [0, 1, 2].filter((index) => offsets[index] === null);
    let remaining: Trig = [H, 0, 0];
    for (const offset of offsets) if (offset) remaining = difference(remaining, offset);
    for (let side = 0; side < 3; side++) if (offsets[side]) {
      constraints.push(...lower[side].map((bound) => difference(offsets[side]!, bound)));
    }
    let lows: Trig[] = [];
    let highs: Trig[] = [];
    if (free.length === 1) {
      offsets[free[0]] = remaining;
      constraints.push(...lower[free[0]].map((bound) => difference(remaining, bound)));
    } else {
      lows = [...lower[free[0]]];
      highs = lower[free[1]].map((bound) => difference(remaining, bound));
    }
    if (role.criticality === 'non-supercritical') {
      if (exactA && exactB) {
        if (role.a + role.b > 1 + CLOSED_TOLERANCE) continue;
      } else {
        // With A exact, A+B≤1 iff some forward support stops that ray by
        // 1−A. Enumerating that support avoids sampling the free offset.
        const direction = exactA ? outward : inward;
        const upperReach = 1 - (exactA ? role.a : role.b);
        const end = { x: vertex.x + upperReach * direction.x, y: vertex.y + upperReach * direction.y };
        const upper = projection(second, end);
        constraints.push(projection(second, direction));
        if (offsets[second]) constraints.push(difference(upper, offsets[second]!));
        else if (second === free[0]) highs.push(upper);
        else lows.push(difference(remaining, upper));
      }
    }
    if (free.length === 2) for (const low of lows) for (const high of highs) constraints.push(difference(high, low));
    for (const angle of feasibleAngles(constraints, hint)) {
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const concrete = offsets.map((offset) => offset ? evaluate(offset, cosine, sine) : 0);
      if (free.length === 2) {
        concrete[free[0]] = (Math.max(...lows.map((bound) => evaluate(bound, cosine, sine))) + Math.min(...highs.map((bound) => evaluate(bound, cosine, sine)))) / 2;
        concrete[free[1]] = evaluate(remaining, cosine, sine) - concrete[free[0]];
      }
      const normals = [0, 1, 2].map((side) => ({ x: Math.cos(angle + side * ANGLE_PERIOD), y: Math.sin(angle + side * ANGLE_PERIOD) }));
      const triangle = normals.map((normal, side) => lineIntersection(normal, concrete[side], normals[(side + 1) % 3], concrete[(side + 1) % 3]));
      if (isRestrictedAbSource(role, triangle)) {
        angleHints.set(role.index, angle);
        return triangle;
      }
    }
  }
  return null;
}

// This oracle returns an actual source certificate; raster sample counts play
// no part in feasibility. Required-point roles use exact support elimination
// and finite trigonometric intervals, including same-support exact endpoints.
export function findRestrictedAbSource(role: AbUnionRegionDefinition): Point[] | null {
  const key = abUnionRegionKey(role);
  if (cache.has(key)) return cache.get(key)!;
  let result: Point[] | null = null;
  if (validDefinition(role)) {
    if (role.requiredInteriorPoints.length) result = supportedSource(role);
    else {
      const candidate = explicitSource(role);
      if (candidate) {
        if (isRestrictedAbSource(role, candidate.triangle)) result = candidate.triangle;
        else {
          // Near a strict endpoint, different active sides may provide more
          // interior margin than the symmetric AB-side construction.
          const alternative = supportedSource({ ...role, a: candidate.a, b: candidate.b, restriction: 'both', criticality: 'any' });
          if (alternative && isRestrictedAbSource(role, alternative)) result = alternative;
        }
      }
    }
  }
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
