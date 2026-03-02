import type { Point } from './types';

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function rotatePoint(p: Point, center: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function pointInTriangle(p: Point, v0: Point, v1: Point, v2: Point): boolean {
  const cross01 = (v1.x - v0.x) * (p.y - v0.y) - (v1.y - v0.y) * (p.x - v0.x);
  const cross12 = (v2.x - v1.x) * (p.y - v1.y) - (v2.y - v1.y) * (p.x - v1.x);
  const cross20 = (v0.x - v2.x) * (p.y - v2.y) - (v0.y - v2.y) * (p.x - v2.x);
  return (cross01 >= 0 && cross12 >= 0 && cross20 >= 0) ||
         (cross01 <= 0 && cross12 <= 0 && cross20 <= 0);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return distance(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj: Point = { x: a.x + t * abx, y: a.y + t * aby };
  return distance(p, proj);
}

export function distanceToTriangleBorder(p: Point, verts: [Point, Point, Point]): number {
  return Math.min(
    distanceToSegment(p, verts[0], verts[1]),
    distanceToSegment(p, verts[1], verts[2]),
    distanceToSegment(p, verts[2], verts[0]),
  );
}

export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return a;
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * abx, y: a.y + t * aby };
}

export function clampPointToTriangle(p: Point, v0: Point, v1: Point, v2: Point): Point {
  if (pointInTriangle(p, v0, v1, v2)) return p;
  const candidates = [
    closestPointOnSegment(p, v0, v1),
    closestPointOnSegment(p, v1, v2),
    closestPointOnSegment(p, v2, v0),
  ];
  let best = candidates[0];
  let bestDist = distance(p, best);
  for (let i = 1; i < candidates.length; i++) {
    const d = distance(p, candidates[i]);
    if (d < bestDist) { best = candidates[i]; bestDist = d; }
  }
  return best;
}
