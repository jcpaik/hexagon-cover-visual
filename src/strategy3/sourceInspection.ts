import type { Point } from '../types';
import { HEXAGON_VERTICES } from '../hexagon';
import { dot } from '../ab-union/geometry';
import { isRestrictedAbSource } from '../ab-union/feasibility';
import { sampleRestrictedAbSources, type RestrictedAbSources } from '../ab-union/regions';
import { sourceInCell } from '../ab-union/translationCells';
import type { AbUnionRegionDefinition } from '../ab-union/types';

export interface InspectionQuery { point: Point; edge?: { index: number; t: number } }
export interface SourceInspection {
  status: 'found' | 'excluded' | 'unresolved';
  reason: string;
  triangle: Point[] | null;
  lowerBound?: number;
}

export function containsSourcePoint(triangle: readonly Point[], p: Point): boolean {
  return triangle.every((a, i) => {
    const b = triangle[(i + 1) % triangle.length];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -2e-11;
  });
}

export function sourceMeasurements(role: AbUnionRegionDefinition, triangle: readonly Point[]) {
  const vertex = HEXAGON_VERTICES[role.index];
  const normals = triangle.map((a, i) => {
    const b = triangle[(i + 1) % 3], length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
  });
  const offsets = normals.map((n, i) => dot(n, triangle[i]));
  const clearance = (p: Point) => Math.min(...normals.map((n, i) => offsets[i] - dot(n, p)));
  const reach = (index: number) => {
    const direction = { x: HEXAGON_VERTICES[index].x - vertex.x, y: HEXAGON_VERTICES[index].y - vertex.y };
    return Math.min(...normals.map((n, i) => dot(n, direction) > 0 ? (offsets[i] - dot(n, vertex)) / dot(n, direction) : Infinity));
  };
  return { a: reach((role.index + 5) % 6), b: reach((role.index + 1) % 6),
    interiorMargin: Math.min(...[vertex, ...role.requiredInteriorPoints].map(clearance)) };
}

// Supporting-line obstruction from the report: the forward ray is (1,0),
// the backward ray is (-1/2,sqrt(3)/2). Only the stated monotone branch is used.
export function exactEndpointSideBound(a: number, b: number, x: number, y: number): number | null {
  if (!(a > 0 && x > b && y > 0)) return null;
  const h = Math.sqrt(3) / 2, m = (x - b) / y;
  const c = b - x / 2 + h * y - a / 2, d = h * (x + a) + y / 2;
  if (!(c < 0 && d > 0 && Number.isFinite(m))) return null;
  return (c + d * m) / (h * Math.hypot(1, m));
}

export function compareSourceFamilies(role: AbUnionRegionDefinition, quality: 'preview' | 'full', seed: readonly Point[] | null) {
  const relaxedRole: AbUnionRegionDefinition = { ...role, restriction: 'ordinary' };
  const restricted = sampleRestrictedAbSources(role, quality, seed);
  const raw = sampleRestrictedAbSources(relaxedRole, quality, seed);
  // Identical criticality, interior requirements and margins. Include the
  // restricted collection in the relaxed sample to preserve set inclusion.
  const withSeed = seed && isRestrictedAbSource(role, seed) ? [seed.slice()] : [];
  const fixed: RestrictedAbSources = { ...restricted, triangles: [...restricted.triangles, ...withSeed] };
  const relaxed: RestrictedAbSources = role.restriction === 'ordinary' ? fixed : { ...raw, triangles: [...raw.triangles, ...fixed.triangles], cells: [...raw.cells, ...fixed.cells] };
  return { role, relaxedRole, restricted: fixed, relaxed };
}

export function inspectSourcePoint(role: AbUnionRegionDefinition, family: RestrictedAbSources, query: InspectionQuery): SourceInspection {
  const { point, edge } = query;
  const excluded = (reason: string, lowerBound?: number): SourceInspection => ({ status: 'excluded', reason, lowerBound, triangle: null });
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { status: 'unresolved', reason: 'Enter finite coordinates.', triangle: null };
  if (HEXAGON_VERTICES.some((a, i) => {
    const b = HEXAGON_VERTICES[(i + 1) % 6];
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) < -1e-10;
  })) return excluded('The point is outside the hexagon; displayed source families are intersected with it.');
  // Only use an exact-edge rule for an explicitly snapped/constructed edge
  // query, never because an arbitrary interior point is merely near an edge.
  if (edge) {
    if (edge.index === role.index && (role.restriction === 'out' || role.restriction === 'both') && edge.t > role.b + 1e-10) {
      return excluded('Exact forward trace stops before this edge point.');
    }
    if ((edge.index + 1) % 6 === role.index && (role.restriction === 'in' || role.restriction === 'both') && 1 - edge.t > role.a + 1e-10) {
      return excluded('Exact backward trace stops before this edge point.');
    }
  }
  const vertex = HEXAGON_VERTICES[role.index];
  for (const direction of ['out', 'in'] as const) {
    if (role.restriction !== direction && role.restriction !== 'both') continue;
    const next = HEXAGON_VERTICES[(role.index + (direction === 'out' ? 1 : 5)) % 6];
    const v = { x: next.x - vertex.x, y: next.y - vertex.y };
    const q = { x: point.x - vertex.x, y: point.y - vertex.y };
    const x = dot(v, q), y = (direction === 'out' ? 1 : -1) * (v.x * q.y - v.y * q.x);
    const bound = exactEndpointSideBound(direction === 'out' ? role.a : role.b, direction === 'out' ? role.b : role.a, x, y);
    if (bound !== null && bound > 1 + 1e-8) return excluded('Supporting-line lower bound exceeds unit side (evaluated numerically).', bound);
  }
  if (Math.hypot(point.x - vertex.x, point.y - vertex.y) > 1 + 1e-10) return excluded('Distance from the assigned vertex exceeds the unit diameter.');
  for (const triangle of family.triangles) {
    if (containsSourcePoint(triangle, point) && isRestrictedAbSource(role, triangle)) return { status: 'found', reason: 'A validated source contains the point within 2e-11 containment tolerance.', triangle };
  }
  for (const cell of family.cells) {
    const triangle = sourceInCell(cell, point);
    if (triangle && containsSourcePoint(triangle, point) && isRestrictedAbSource(role, triangle)) {
      return { status: 'found', reason: 'A source was recovered from a fixed-orientation translation cell and revalidated.', triangle };
    }
  }
  return { status: 'unresolved', reason: 'No source found at these sampled orientations. This is not an exclusion proof.', triangle: null };
}

export const INTERIOR_DIFFERENCE_DEMO = {
  role: { index: 0, a: .75, b: .125, restriction: 'out', criticality: 'non-supercritical', requiredInteriorPoints: [] } as AbUnionRegionDefinition,
  // Convert local (.475,.15) at V0 to the app's global coordinates.
  point: { x: 1 - .475 / 2 - Math.sqrt(3) * .15 / 2, y: Math.sqrt(3) * .475 / 2 - .15 / 2 },
  exactLowerBound: (361 - 25 * Math.sqrt(3)) / (40 * Math.sqrt(58)),
};
