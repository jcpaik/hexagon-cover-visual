import type { Point } from './types';

// Counterclockwise hull; duplicate and interior collinear points are removed.
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
  if (sorted.length < 3) return sorted;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (order: Point[]) => {
    const hull: Point[] = [];
    for (const point of order) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.slice().reverse())];
}
