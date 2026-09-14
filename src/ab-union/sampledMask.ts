import type { Point } from '../types';
import { isRestrictedAbSource } from './feasibility';
import { sampleRestrictedAbSources } from './regions';
import type { AbUnionRegionDefinition } from './types';

interface RasterView { size: number; center: number; scale: number }

// Rasterize convex coverage polygons at pixel centers. Canvas alpha thresholds can
// mark a pixel whose center is outside every source, especially near a gap.
// Scanline intervals rasterize each source or same-orientation feasible-cell
// polygon separately. They never form a global hull across different cells.
export function rasterizePolygonUnion(triangles: readonly (readonly Point[])[], view: RasterView): Uint8Array {
  const { size, center, scale } = view;
  const mask = new Uint8Array(size * size);
  for (const triangle of triangles) {
    const points = triangle.map((point) => ({ x: center + scale * point.x, y: center - scale * point.y }));
    const first = Math.max(0, Math.ceil(Math.min(...points.map((point) => point.y)) - 0.5));
    const last = Math.min(size - 1, Math.floor(Math.max(...points.map((point) => point.y)) - 0.5));
    for (let row = first; row <= last; row++) {
      const y = row + 0.5;
      let left = Infinity, right = -Infinity;
      for (let side = 0; side < points.length; side++) {
        const a = points[side], b = points[(side + 1) % points.length];
        if (y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
        if (a.y === b.y) {
          left = Math.min(left, a.x, b.x);
          right = Math.max(right, a.x, b.x);
        } else {
          const x = a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      const start = Math.max(0, Math.ceil(left - 0.5));
      const end = Math.min(size - 1, Math.floor(right - 0.5));
      if (start <= end) mask.fill(1, row * size + start, row * size + end + 1);
    }
  }
  return mask;
}

// Kept for callers rasterizing individual triangles.
export const rasterizeTriangleUnion = rasterizePolygonUnion;

export function sourceCoveragePolygons(
  sources: ReturnType<typeof sampleRestrictedAbSources>, seed?: readonly Point[] | null,
): readonly (readonly Point[])[] {
  return [...sources.cells.map((cell) => cell.polygon), ...sources.triangles, ...(seed ? [seed] : [])];
}

export function sampleRestrictedAbMask(
  definition: AbUnionRegionDefinition,
  quality: 'preview' | 'full',
  view: RasterView,
  verifiedSource?: readonly Point[] | null,
): { coverage: Uint8Array; count: number; status: string } {
  // A certificate must pass the same restrictions as sampled sources; it is
  // never an unchecked fallback to an ordinary AB triangle.
  const seed = verifiedSource && isRestrictedAbSource(definition, verifiedSource) ? verifiedSource : null;
  const sources = sampleRestrictedAbSources(definition, quality, seed);
  const polygons = sourceCoveragePolygons(sources, seed);
  return {
    coverage: rasterizePolygonUnion(polygons, view),
    count: sources.triangles.length + (seed ? 1 : 0),
    status: `${sources.cells.length} fixed-orientation translation cells; ${sources.triangles.length} source samples${seed ? "; verified seed" : ""}`,
  };
}
