import type { Point } from '../types';
import { convexHull } from '../convexHull';
import { dot, lineIntersection } from './geometry';

export type Offsets = [number, number, number];
export interface TranslationCell {
  normals: Point[];
  offsets: Offsets[];
  polygon: Point[];
}

export function triangleAtOffsets(normals: readonly Point[], offsets: readonly number[]): Point[] {
  return normals.map((normal, i) => lineIntersection(normal, offsets[i], normals[(i + 1) % 3], offsets[(i + 1) % 3]));
}

// Only combine one orientation and ONE convex feasible offset cell.
// The same-orientation union is T + P, the Minkowski sum with its translation
// polygon. Its hull is exact in real arithmetic; no cross-cell/global hull.
export function makeTranslationCell(normals: Point[], offsets: Offsets[]): TranslationCell {
  return { normals, offsets, polygon: convexHull(offsets.flatMap((value) => triangleAtOffsets(normals, value))) };
}

// Recover a single source containing p, not merely a convex combination of
// arbitrary source triangles: intersect the SAME offset cell with n_i.p<=λ_i.
export function sourceInCell(cell: TranslationCell, p: Point): Point[] | null {
  let polygon = cell.offsets;
  for (let side = 0; side < 3 && polygon.length; side++) {
    const bound = dot(cell.normals[side], p);
    const clipped: Offsets[] = [];
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      const from = a[side] - bound, to = b[side] - bound;
      if ((from >= 0) !== (to >= 0)) {
        const t = from / (from - to);
        clipped.push(a.map((value, j) => value + t * (b[j] - value)) as Offsets);
      }
      if (to >= 0) clipped.push(b);
    });
    polygon = clipped;
  }
  if (!polygon.length) return null;
  const offsets = polygon.reduce((sum, p) => sum.map((value, i) => value + p[i] / polygon.length) as Offsets, [0, 0, 0] as Offsets);
  return triangleAtOffsets(cell.normals, offsets);
}
