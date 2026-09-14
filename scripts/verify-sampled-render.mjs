import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const inside = (triangle, p, tolerance = 0) => {
  const values = triangle.map((a, i) => cross(a, triangle[(i + 1) % triangle.length], p));
  return values.every((v) => v >= -tolerance) || values.every((v) => v <= tolerance);
};
const dots = (values) => values.map((v) => Array.isArray(v)
  ? { left: v[0], right: v[1], split: true } : { left: v, right: v, split: false });
// Independently clip an edge against every source/cell-polygon side.
function interval(triangle, start, end) {
  let lo = 0, hi = 1;
  for (let i = 0; i < triangle.length; i++) {
    const a = triangle[i], b = triangle[(i + 1) % triangle.length];
    const value = cross(a, b, start), slope = cross(a, b, end) - value;
    if (Math.abs(slope) < 1e-14) { if (value < -1e-12) return null; }
    else if (slope > 0) lo = Math.max(lo, -value / slope);
    else hi = Math.min(hi, -value / slope);
  }
  return lo <= hi + 1e-12 ? [lo, hi] : null;
}

try {
  const { rasterizeTriangleUnion, sampleRestrictedAbMask, sourceCoveragePolygons } = await server.ssrLoadModule('/src/ab-union/sampledMask.ts');
  const { sampleRestrictedAbSources } = await server.ssrLoadModule('/src/ab-union/regions.ts');
  const { findRestrictedAbSource, isRestrictedAbSource } = await server.ssrLoadModule('/src/ab-union/feasibility.ts');
  const { strategy3BoundaryInputs } = await server.ssrLoadModule('/src/strategy3/boundary.ts');
  const { createDefaultStrategy3State } = await server.ssrLoadModule('/src/strategy3/state.ts');
  const { gapTraceLegend, drawStrategy3GapTraces } = await server.ssrLoadModule('/src/strategy3/gapTraces.ts');
  const { HEXAGON_VERTICES: vertices } = await server.ssrLoadModule('/src/hexagon.ts');
  const view = { size: 48, center: 24, scale: 19.2 };
  const point = (pixel) => ({ x: (pixel % view.size + 0.5 - view.center) / view.scale,
    y: (view.center - Math.floor(pixel / view.size) - 0.5) / view.scale });
  let pixelChecks = 0, sourceChecks = 0, gapChecks = 0, cellGapChecks = 0;
  const verifyPixels = (triangles, mask, stride = 1) => {
    for (let pixel = 0; pixel < mask.length; pixel += stride) {
      const p = point(pixel);
      const expected = triangles.some((triangle) => inside(triangle, p));
      // Only a roundoff-scale on-source-side tie can differ between independent
      // algebraic tests; do not hide any spatial/raster-scale discrepancy.
      if (Boolean(mask[pixel]) !== expected) {
        assert.equal(triangles.some((triangle) => inside(triangle, p, mask[pixel] ? 1e-12 : -1e-12)), Boolean(mask[pixel]), `pixel ${pixel}`);
      }
      pixelChecks++;
    }
  };
  assert.ok(rasterizeTriangleUnion([], view).every((bit) => bit === 0));
  const triangle = [{ x: -0.73, y: -0.61 }, { x: 0.81, y: -0.61 }, { x: 0.07, y: 0.9 }];
  const second = triangle.map((p) => ({ x: p.x + 0.42, y: p.y - 0.27 }));
  for (const triangles of [[triangle], [triangle, second], [triangle, triangle], [triangle.slice().reverse()]]) {
    verifyPixels(triangles, rasterizeTriangleUnion(triangles, view));
  }
  assert.deepEqual(rasterizeTriangleUnion([triangle, triangle], view), rasterizeTriangleUnion([triangle], view));
  assert.deepEqual(rasterizeTriangleUnion([triangle.slice().reverse()], view), rasterizeTriangleUnion([triangle], view));
  // Subpixel coverage cannot be accumulated into a false covered center.
  const tiny = [[{ x: 0.001, y: 0.001 }, { x: 0.002, y: 0.001 }, { x: 0.001, y: 0.002 }]];
  assert.ok(rasterizeTriangleUnion(Array(100).fill(tiny[0]), view).every((bit) => bit === 0));

  const defaults = createDefaultStrategy3State();
  const fixtures = [
    ...['bc', 'd'].flatMap((mode) => ['seven', 'eight'].map((layout) => [mode, defaults[mode].layouts[layout]])),
    ['f', defaults.f.edgeDots],
    // Reconstructed from the user's screenshots, not exact exported snapshots.
    ['bc', dots([[.237305, .711616], .605, .555, .505, .455, .405])],
    ['d', dots([.417059, .41, .36, .31, .26, [.161231, .653684]])],
  ];
  for (const [mode, edges] of fixtures) {
    const { roles } = strategy3BoundaryInputs(mode, edges);
    for (const role of roles) {
      const seed = findRestrictedAbSource(role);
      assert.ok(seed && isRestrictedAbSource(role, seed), `${mode} V${role.index}: feasible fixture`);
      const family = sampleRestrictedAbSources(role, 'full', seed);
      const sources = family.triangles;
      const polygons = sourceCoveragePolygons(family, seed);
      const triangles = [...sources, seed];
      const rendered = sampleRestrictedAbMask(role, 'full', view, seed);
      assert.equal(rendered.count, triangles.length);
      assert.deepEqual(rendered.coverage, rasterizeTriangleUnion(polygons, view), 'renderer uses separate fixed-orientation cell polygons and source samples');
      verifyPixels(polygons, rendered.coverage, 17);
      for (const triangle of triangles) {
        assert.ok(isRestrictedAbSource(role, triangle));
        sourceChecks++;
        edges.forEach((edge, i) => {
          if (!edge.split) return;
          const section = interval(triangle, vertices[i], vertices[(i + 1) % 6]);
          if (section) assert.ok(section[1] <= edge.left + 1e-9 || section[0] >= edge.right - 1e-9, `${mode} V${role.index} spills into e${i} gap`);
          gapChecks++;
        });
      }
      for (const cell of family.cells) edges.forEach((edge, i) => {
        if (!edge.split) return;
        const section = interval(cell.polygon, vertices[i], vertices[(i + 1) % 6]);
        if (section) assert.ok(section[1] <= edge.left + 1e-9 || section[0] >= edge.right - 1e-9, `${mode} cell hull spills into e${i} gap`);
        cellGapChecks++;
      });
      const preview = sampleRestrictedAbMask(role, 'preview', view, seed);
      assert.ok(preview.count > 0);
      verifyPixels(sourceCoveragePolygons(sampleRestrictedAbSources(role, 'preview', seed), seed), preview.coverage, 29);
    }
  }
  for (const role of [
    { index: 0, a: .5, b: .5, restriction: 'both', criticality: 'non-supercritical', requiredInteriorPoints: [] },
    { index: 0, a: .4999, b: .3, restriction: 'in', criticality: 'non-supercritical', requiredInteriorPoints: [{ x: .25, y: Math.sqrt(3) / 4 }] },
  ]) {
    const seed = findRestrictedAbSource(role);
    assert.ok(seed, 'equality/narrow source exists');
    const rendered = sampleRestrictedAbMask(role, 'full', view, seed);
    assert.ok(rendered.count > 0 && rendered.coverage.some(Boolean), 'equality/narrow family is actually rendered');
    verifyPixels(sourceCoveragePolygons(sampleRestrictedAbSources(role, 'full', seed), seed), rendered.coverage);
  }
  const bad = { index: 0, a: 1, b: .2, restriction: 'both', criticality: 'any', requiredInteriorPoints: [] };
  const invalidSeed = findRestrictedAbSource(strategy3BoundaryInputs('bc', defaults.bc.layouts.seven).roles[0]);
  const rejected = sampleRestrictedAbMask(bad, 'full', view, invalidSeed);
  assert.equal(rejected.count, 0, 'invalid certificate cannot bypass restrictions');
  assert.ok(rejected.coverage.every((bit) => bit === 0), 'empty family cannot fall back to an ordinary envelope');

  const colors = Array(6).fill('#111');
  assert.equal(gapTraceLegend(defaults.f.edgeDots, colors), '');
  assert.equal((gapTraceLegend(defaults.bc.layouts.eight, colors).match(/data-strategy3-gap-edge=/g) ?? []).length, 2);
  const singleton = dots([[.5, .5], .5, .5, .5, .5, .5]);
  assert.match(gapTraceLegend(singleton, colors), /singleton gap/);
  assert.equal(gapTraceLegend(dots([.5, .5, .5, .5, .5, .5]), colors), '', 'shared handoff is not a singleton gap');
  const strokes = [], arcs = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, setLineDash(value) { this.dash = value; },
    arc(...args) { arcs.push(args); }, stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth, dash: this.dash }); } };
  drawStrategy3GapTraces(ctx, singleton);
  assert.equal(arcs.length, 1, 'singleton gap stays visible around the handle');
  assert.deepEqual(strokes.map((stroke) => stroke.color), ['#fff', '#dc2626']);
  assert.deepEqual(strokes[1].dash, []);
  strokes.length = 0;
  drawStrategy3GapTraces(ctx, defaults.bc.layouts.eight);
  assert.deepEqual(strokes.map((stroke) => stroke.color), ['#fff', '#dc2626', '#fff', '#dc2626']);
  assert.deepEqual(strokes[1].dash, [4, 3]);
  console.log(JSON.stringify({ status: 'PASS', fixtures: fixtures.length, pixelChecks, sourceChecks, gapChecks, cellGapChecks,
    checks: 'fixed-orientation cell masks, independent polygon membership, no gap intrusion, preview/full, invalid seed, singleton/two-gap traces' }));
} finally { await server.close(); }
