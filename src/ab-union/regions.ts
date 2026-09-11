import type { Point } from '../types';
import { HEXAGON_VERTICES } from '../hexagon';
import { dot, edgeVector, lineIntersection, mod6, pointOnEdge } from './geometry';
import type { AbUnionRegionDefinition } from './types';

export interface RestrictedAbSources {
  triangles: Point[][];
  status: string;
}

const H = Math.sqrt(3) / 2;
const cache = new Map<string, { key: string; result: RestrictedAbSources }>();

export function abUnionRegionKey(definition: AbUnionRegionDefinition): string {
  const { index, a, b, restriction, criticality, requiredInteriorPoints } = definition;
  return JSON.stringify([index, a, b, restriction, criticality, requiredInteriorPoints.map((point) => [point.x, point.y])]);
}

function compositions(total: number, parts: number, steps: number): number[][] {
  if (parts === 1) return [[total]];
  const epsilon = Math.min(1e-5, total / Math.max(1000, parts * 100));
  if (total <= parts * epsilon) return [Array(parts).fill(total / parts)];
  if (parts === 2) return Array.from({ length: steps }, (_, index) => {
    const first = epsilon + (total - 2 * epsilon) * index / (steps - 1);
    return [first, total - first];
  });
  const result: number[][] = [];
  for (let first = 0; first <= steps; first++) {
    for (let second = 0; second <= steps - first; second++) {
      result.push([first, second, steps - first - second].map((weight) => (weight + 0.35) * total / (steps + 1.05)));
    }
  }
  return result;
}

function vertices(normals: Point[], offsets: number[]): Point[] {
  return normals.map((normal, index) => {
    const next = (index + 1) % 3;
    return lineIntersection(normal, offsets[index], normals[next], offsets[next]);
  });
}

// 2009e: sample source triangles with fixed actual edge reaches, then union
// their corner-cone portions. Do not clip the ordinary AB envelope at a gap.
export function sampleRestrictedAbSources(role: AbUnionRegionDefinition, quality: 'preview' | 'full'): RestrictedAbSources {
  const slot = `${role.index}:${quality}`;
  const key = abUnionRegionKey(role);
  const cached = cache.get(slot);
  if (cached?.key === key) return cached.result;
  const triangles: Point[][] = [];
  const finish = (status: string): RestrictedAbSources => {
    const result = { triangles, status };
    cache.set(slot, { key, result });
    return result;
  };
  const { a, b } = role;
  if (![a, b].every(Number.isFinite) || a < 0 || b < 0 || a * a + a * b + b * b > 1) return finish('No sources: infeasible anchor pair');
  const exactA = role.restriction === 'in' || role.restriction === 'both';
  const exactB = role.restriction === 'out' || role.restriction === 'both';
  if (a >= 1 || b >= 1 || (exactA && a === 0) || (exactB && b === 0)) return finish('No sources: strict vertex containment is impossible');
  if ((role.criticality === 'non-supercritical' && a + b > 1 + 1e-12) || (role.criticality === 'supercritical' && exactA && exactB && a + b <= 1)) return finish('No sources: boundary demands conflict with the case restriction');
  const vertex = HEXAGON_VERTICES[role.index];
  const previousEdge = edgeVector(mod6(role.index - 1));
  const inward = { x: -previousEdge.x, y: -previousEdge.y };
  const outward = edgeVector(role.index);
  const anchorA = { x: vertex.x + a * inward.x, y: vertex.y + a * inward.y };
  const anchorB = pointOnEdge(role.index, b);
  const thetaSteps = quality === 'preview' ? 60 : 240;
  const slackSteps = quality === 'preview' ? 3 : 7;
  for (let thetaIndex = 0; thetaIndex < thetaSteps; thetaIndex++) {
    const theta = thetaIndex * 2 * Math.PI / (3 * thetaSteps);
    const normals = Array.from({ length: 3 }, (_, index) => ({ x: Math.cos(theta + 2 * Math.PI * index / 3), y: Math.sin(theta + 2 * Math.PI * index / 3) }));
    const lower = normals.map((normal) => Math.max(dot(normal, vertex), dot(normal, anchorA), dot(normal, anchorB)));
    const slack = H - lower.reduce((sum, offset) => sum + offset, 0);
    if (slack < -2e-8) continue;
    const activeA = normals.flatMap((normal, index) => dot(normal, inward) > 1e-8 && Math.abs(lower[index] - dot(normal, anchorA)) < 4e-8 ? [index] : []);
    const activeB = normals.flatMap((normal, index) => dot(normal, outward) > 1e-8 && Math.abs(lower[index] - dot(normal, anchorB)) < 4e-8 ? [index] : []);
    const fixedSets = exactA && exactB ? activeA.flatMap((first) => activeB.map((second) => [first, second]))
      : exactA ? activeA.map((index) => [index]) : exactB ? activeB.map((index) => [index]) : [[]];
    for (const fixed of fixedSets) {
      // If both endpoints touch the same support side, two offsets remain free.
      const free = [0, 1, 2].filter((index) => !fixed.includes(index));
      for (const extra of compositions(Math.max(0, slack), free.length, free.length === 3 ? Math.max(3, Math.floor(slackSteps / 2)) : slackSteps)) {
        const offsets = [...lower];
        free.forEach((index, position) => { offsets[index] += extra[position]; });
        const vertexMargins = normals.map((normal, index) => offsets[index] - dot(normal, vertex));
        if (vertexMargins.some((margin) => margin <= 2e-7)) continue;
        const reach = (direction: Point) => Math.min(...normals.map((normal, index) => {
          const derivative = dot(normal, direction);
          return derivative > 1e-9 ? vertexMargins[index] / derivative : Infinity;
        }));
        const actualA = reach(inward);
        const actualB = reach(outward);
        if (actualA < a - 2e-8 || actualB < b - 2e-8 || (exactA && Math.abs(actualA - a) > 2e-5) || (exactB && Math.abs(actualB - b) > 2e-5)) continue;
        if (role.criticality === 'non-supercritical' && actualA + actualB > 1 + 1e-9) continue;
        if (role.criticality === 'supercritical' && actualA + actualB <= 1 + 1e-9) continue;
        if (role.requiredInteriorPoints.some((point) => normals.some((normal, index) => offsets[index] - dot(normal, point) <= 2e-7))) continue;
        triangles.push(vertices(normals, offsets));
      }
    }
  }
  return finish(triangles.length ? `${triangles.length} sampled sources` : 'No sources found at this resolution');
}
