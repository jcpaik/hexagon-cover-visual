import type { Point } from '../types';
import { HEXAGON_VERTICES } from '../hexagon';
import { dot, edgeVector, lineIntersection, mod6, pointOnEdge } from './geometry';
import { isRestrictedAbSource, SOURCE_INTERIOR_MARGIN } from './feasibility';
import { abUnionRegionKey } from './regionKey';
import type { AbUnionRegionDefinition } from './types';

export { abUnionRegionKey } from './regionKey';

export interface RestrictedAbSources {
  triangles: Point[][];
  status: string;
}

type Offsets = [number, number, number];
interface OffsetCut { coefficients: Offsets; bound: number }
const H = Math.sqrt(3) / 2;
const PERIOD = 2 * Math.PI / 3;
const OFFSET_TOLERANCE = 2e-13;
const cache = new Map<string, { key: string; result: RestrictedAbSources }>();
const interpolate = (a: Offsets, b: Offsets, t: number): Offsets => a.map((value, index) => value + t * (b[index] - value)) as Offsets;

function compactPolygon(polygon: Offsets[]): Offsets[] {
  return polygon.filter((point, index) => !polygon.slice(0, index).some((previous) =>
    point.every((coordinate, axis) => Math.abs(coordinate - previous[axis]) <= OFFSET_TOLERANCE),
  ));
}

// The polygon lies in lambda0+lambda1+lambda2=H. Keep its boundary even if
// clipping collapses the allowed translations to a segment or a single point.
function clipOffsets(polygon: Offsets[], cut: OffsetCut): Offsets[] {
  if (!polygon.length) return [];
  const signed = (point: Offsets) => cut.coefficients.reduce((sum, coefficient, index) => sum + coefficient * point[index], -cut.bound);
  if (polygon.length === 1) return signed(polygon[0]) <= OFFSET_TOLERANCE ? polygon : [];
  const clipped: Offsets[] = [];
  polygon.forEach((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const from = signed(start), to = signed(end);
    const insideStart = from <= OFFSET_TOLERANCE, insideEnd = to <= OFFSET_TOLERANCE;
    if (insideStart !== insideEnd) clipped.push(interpolate(start, end, Math.max(0, Math.min(1, from / (from - to)))));
    if (insideEnd) clipped.push(end);
  });
  return compactPolygon(clipped);
}

function sampleOffsets(polygon: Offsets[], steps: number): Offsets[] {
  if (polygon.length <= 1) return polygon;
  if (polygon.length === 2) return Array.from({ length: steps + 1 }, (_, index) => interpolate(polygon[0], polygon[1], index / steps));
  const center = polygon.reduce((sum, point) => sum.map((value, index) => value + point[index] / polygon.length) as Offsets, [0, 0, 0] as Offsets);
  const result = [center];
  const edgeSteps = steps > 3 ? 2 : 1;
  polygon.forEach((start, index) => {
    for (let step = 0; step < edgeSteps; step++) {
      const point = interpolate(start, polygon[(index + 1) % polygon.length], step / edgeSteps);
      result.push(point);
    }
  });
  return result;
}

function normalAngle(normal: Point): number {
  return ((Math.atan2(normal.y, normal.x) % PERIOD) + PERIOD) % PERIOD;
}

// 2009e: restrict the source triangles before taking their union. At fixed
// orientation, sample the feasible support-offset polytope directly so exact
// and almost-exact reach sums do not depend on a lucky slack-grid hit.
export function sampleRestrictedAbSources(
  role: AbUnionRegionDefinition,
  quality: 'preview' | 'full',
  verifiedSource?: readonly Point[] | null,
): RestrictedAbSources {
  const seed = verifiedSource && isRestrictedAbSource(role, verifiedSource) ? verifiedSource : null;
  const seedAngle = seed ? normalAngle({ x: seed[1].y - seed[0].y, y: seed[0].x - seed[1].x }) : null;
  const slot = role.index + ':' + quality;
  const key = abUnionRegionKey(role) + ':' + seedAngle;
  const cached = cache.get(slot);
  if (cached?.key === key) return cached.result;
  const triangles: Point[][] = [];
  const finish = (status: string): RestrictedAbSources => {
    const result = { triangles, status };
    cache.set(slot, { key, result });
    return result;
  };
  const { a, b } = role;
  if (![a, b].every(Number.isFinite) || a < 0 || b < 0 || a * a + a * b + b * b > 1 + 2e-11) return finish('No sources: infeasible anchor pair');
  const exactA = role.restriction === 'in' || role.restriction === 'both';
  const exactB = role.restriction === 'out' || role.restriction === 'both';
  if (a >= 1 || b >= 1 || (exactA && a === 0) || (exactB && b === 0)) return finish('No sources: strict vertex containment is impossible');
  if ((role.criticality === 'non-supercritical' && a + b > 1 + 2e-11) || (role.criticality === 'supercritical' && exactA && exactB && a + b <= 1 + SOURCE_INTERIOR_MARGIN)) return finish('No sources: boundary demands conflict with the case restriction');
  const vertex = HEXAGON_VERTICES[role.index];
  const previousEdge = edgeVector(mod6(role.index - 1));
  const inward = { x: -previousEdge.x, y: -previousEdge.y };
  const outward = edgeVector(role.index);
  const anchorA = { x: vertex.x + a * inward.x, y: vertex.y + a * inward.y };
  const anchorB = pointOnEdge(role.index, b);
  const thetaSteps = quality === 'preview' ? 60 : 240;
  const slackSteps = quality === 'preview' ? 3 : 7;
  const angles = Array.from({ length: thetaSteps }, (_, index) => index * PERIOD / thetaSteps);
  if (a > 0 && b > 0) {
    // A side through both anchors is an isolated orientation. Including it
    // adds valid sources without treating a near-one demand sum as equality.
    angles.push(normalAngle({ x: anchorA.y - anchorB.y, y: anchorB.x - anchorA.x }));
  }
  if (seedAngle !== null) angles.push(seedAngle);
  angles.sort((first, second) => first - second);
  const strictPoints = [vertex, ...role.requiredInteriorPoints];
  for (const [angleIndex, theta] of angles.entries()) {
    if (angleIndex > 0 && theta - angles[angleIndex - 1] < 1e-13) continue;
    const normals = [0, 1, 2].map((index) => ({ x: Math.cos(theta + PERIOD * index), y: Math.sin(theta + PERIOD * index) }));
    const atVertex = normals.map((normal) => dot(normal, vertex));
    const atA = normals.map((normal) => dot(normal, anchorA));
    const atB = normals.map((normal) => dot(normal, anchorB));
    const lower = normals.map((normal, index) => Math.max(atA[index], atB[index], ...strictPoints.map((point) => dot(normal, point) + SOURCE_INTERIOR_MARGIN + 1e-12))) as Offsets;
    const p = normals.map((normal) => dot(normal, inward));
    const q = normals.map((normal) => dot(normal, outward));
    const positiveA = [0, 1, 2].filter((index) => p[index] > 1e-12);
    const positiveB = [0, 1, 2].filter((index) => q[index] > 1e-12);
    const activeA = positiveA.filter((index) => atA[index] >= lower[index] - OFFSET_TOLERANCE);
    const activeB = positiveB.filter((index) => atB[index] >= lower[index] - OFFSET_TOLERANCE);
    const fixedSets: Array<Array<[number, number]>> = exactA && exactB ? activeA.flatMap((first) => activeB.map((second) => [[first, atA[first]], [second, atB[second]]] as Array<[number, number]>))
      : exactA ? activeA.map((index) => [[index, atA[index]]]) : exactB ? activeB.map((index) => [[index, atB[index]]]) : [[]];
    const cuts = positiveA.flatMap((first) => positiveB.map((second): OffsetCut => {
      const coefficients: Offsets = [0, 0, 0];
      coefficients[first] += q[second];
      coefficients[second] += p[first];
      const sum = role.criticality === 'supercritical' ? 1 + SOURCE_INTERIOR_MARGIN + 1e-12 : 1;
      return { coefficients, bound: p[first] * q[second] * sum + q[second] * atVertex[first] + p[first] * atVertex[second] };
    }));
    const seen = new Set<string>();
    for (const fixed of fixedSets) {
      const base = [...lower] as Offsets;
      const fixedValues = new Map<number, number>();
      let consistent = true;
      for (const [index, value] of fixed) {
        if (fixedValues.has(index) && Math.abs(fixedValues.get(index)! - value) > OFFSET_TOLERANCE) consistent = false;
        fixedValues.set(index, value);
        base[index] = value;
      }
      if (!consistent) continue;
      const free = [0, 1, 2].filter((index) => !fixedValues.has(index));
      const slack = H - base.reduce((sum, offset) => sum + offset, 0);
      if (slack < -OFFSET_TOLERANCE) continue;
      const simplex = compactPolygon(free.map((index) => {
        const point = [...base] as Offsets;
        point[index] += slack;
        return point;
      }));
      // A+B=min over support pairs of d_j/p_j+d_k/q_k. Hence <=1
      // is a union of pair halfspaces; >1 is their reversed intersection.
      const polygons = role.criticality === 'non-supercritical' ? cuts.map((cut) => clipOffsets(simplex, cut))
        : role.criticality === 'supercritical' ? [cuts.reduce((polygon, cut) => clipOffsets(polygon, { coefficients: cut.coefficients.map((value) => -value) as Offsets, bound: -cut.bound }), simplex)]
          : [simplex];
      for (const polygon of polygons) for (const offsets of sampleOffsets(polygon, slackSteps)) {
        const offsetKey = offsets.map((value) => Math.round(value * 1e12)).join(':');
        if (seen.has(offsetKey)) continue;
        seen.add(offsetKey);
        const triangle = normals.map((normal, index) => lineIntersection(normal, offsets[index], normals[(index + 1) % 3], offsets[(index + 1) % 3]));
        if (isRestrictedAbSource(role, triangle)) triangles.push(triangle);
      }
    }
  }
  return finish(triangles.length ? triangles.length + ' sampled sources' : 'No sources found at this resolution');
}
