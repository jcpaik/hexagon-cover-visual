import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const inPolygon = (polygon, p, tolerance = 1e-10) => polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], p) >= -tolerance);
try {
  const { sampleRestrictedAbSources } = await server.ssrLoadModule('/src/ab-union/regions.ts');
  const { findRestrictedAbSource, isRestrictedAbSource } = await server.ssrLoadModule('/src/ab-union/feasibility.ts');
  const { sourceInCell, triangleAtOffsets } = await server.ssrLoadModule('/src/ab-union/translationCells.ts');
  const inspection = await server.ssrLoadModule('/src/strategy3/sourceInspection.ts');
  const { strategy3BoundaryInputs } = await server.ssrLoadModule('/src/strategy3/boundary.ts');
  const { createDefaultStrategy3State } = await server.ssrLoadModule('/src/strategy3/state.ts');
  const { HEXAGON_VERTICES: vertices } = await server.ssrLoadModule('/src/hexagon.ts');
  const defaults = createDefaultStrategy3State();
  const fixtures = [...['bc', 'd'].flatMap(mode => ['seven', 'eight'].map(layout => [mode, defaults[mode].layouts[layout]])), ['f', defaults.f.edgeDots]];
  let cellChecks = 0, recovered = 0, sourceChecks = 0;
  for (const [mode, edges] of fixtures) for (const role of strategy3BoundaryInputs(mode, edges).roles) {
    const seed = findRestrictedAbSource(role);
    const family = sampleRestrictedAbSources(role, 'full', seed);
    assert.ok(family.cells.length, `${mode} V${role.index} has translation cells`);
    for (const cell of family.cells) {
      // Every extreme and an interior convex combination stays in the SAME
      // source family. This checks the source-domain meaning of each hull.
      const middle = cell.offsets.reduce((sum, p) => sum.map((v, i) => v + p[i] / cell.offsets.length), [0, 0, 0]);
      for (const offsets of [...cell.offsets, middle]) {
        const triangle = triangleAtOffsets(cell.normals, offsets);
        assert.ok(isRestrictedAbSource(role, triangle), 'convex translation does not cross an inadmissible support/criticality component');
        for (const p of triangle) assert.ok(inPolygon(cell.polygon, p));
        sourceChecks++;
      }
      if (cellChecks % 19 === 0) {
        const source = triangleAtOffsets(cell.normals, middle);
        for (const weights of [[.2, .3, .5], [.6, .2, .2]]) {
          const p = source.reduce((sum, q, i) => ({ x: sum.x + q.x * weights[i], y: sum.y + q.y * weights[i] }), { x: 0, y: 0 });
          const realizer = sourceInCell(cell, p);
          assert.ok(realizer && isRestrictedAbSource(role, realizer) && inPolygon(realizer, p), 'a cell point has an actual individual source');
          recovered++;
        }
      }
      cellChecks++;
    }
  }
  const demo = inspection.INTERIOR_DIFFERENCE_DEMO;
  const comparison = inspection.compareSourceFamilies(demo.role, 'full', findRestrictedAbSource(demo.role));
  const relaxed = inspection.inspectSourcePoint(comparison.relaxedRole, comparison.relaxed, { point: demo.point });
  const fixed = inspection.inspectSourcePoint(demo.role, comparison.restricted, { point: demo.point });
  assert.equal(relaxed.status, 'found', 'ordinary family contains a strictly interior distinguishing point');
  assert.equal(fixed.status, 'excluded', 'absence is justified by a mathematical lower bound, not by a failed sample');
  assert.ok(Math.abs(fixed.lowerBound - demo.exactLowerBound) < 1e-12 && fixed.lowerBound > 1.04);
  for (let i = 0; i < 6; i++) for (const direction of ['in', 'out']) {
    const role = { ...demo.role, index: i, restriction: direction, a: direction === 'out' ? .75 : .125, b: direction === 'out' ? .125 : .75 };
    const v = vertices[i], next = vertices[(i + (direction === 'out' ? 1 : 5)) % 6];
    const dx = next.x - v.x, dy = next.y - v.y, sign = direction === 'out' ? 1 : -1;
    const point = { x: v.x + .475 * dx - sign * .15 * dy, y: v.y + .475 * dy + sign * .15 * dx };
    const result = inspection.inspectSourcePoint(role, { triangles: [], cells: [], status: '' }, { point });
    assert.equal(result.status, 'excluded');
    assert.ok(Math.abs(result.lowerBound - demo.exactLowerBound) < 1e-12, 'reflection exchanges exact incoming/outgoing constraints');
  }
  const unknown = inspection.inspectSourcePoint(demo.role, comparison.restricted, { point: { x: 0, y: 0 } });
  assert.equal(unknown.status, 'unresolved', 'an uncaught obstruction is not inferred from a sampled miss');
  const t = .2, edgePoint = { x: 1 - t / 2, y: Math.sqrt(3) * t / 2 };
  assert.equal(inspection.inspectSourcePoint(demo.role, comparison.restricted, { point: edgePoint, edge: { index: 0, t } }).status, 'excluded');
  assert.equal(inspection.exactEndpointSideBound(.75, .125, .1, .3), null, 'invalid certificate domain');
  assert.equal(inspection.exactEndpointSideBound(.75, .125, .475, 0), null, 'no division by zero edge guess');
  const dRole = strategy3BoundaryInputs('d', defaults.d.layouts.seven).roles[0];
  const dComparison = inspection.compareSourceFamilies(dRole, 'full', findRestrictedAbSource(dRole));
  assert.deepEqual(dComparison.relaxedRole.requiredInteriorPoints, dRole.requiredInteriorPoints);
  assert.equal(dComparison.relaxedRole.criticality, dRole.criticality);
  for (const triangle of dComparison.relaxed.triangles) assert.ok(isRestrictedAbSource(dComparison.relaxedRole, triangle), 'relaxing an endpoint never drops the D midpoint or criticality');
  for (const triangle of comparison.restricted.triangles) assert.ok(comparison.relaxed.triangles.includes(triangle), 'restricted sources included in relaxed finite collection');
  console.log(JSON.stringify({ status: 'PASS', cellChecks, sourceChecks, recovered, interiorDifferenceBound: fixed.lowerBound, checks: 'actual source recovery, endpoint reflection, unresolved classification, D midpoint retained, sampled inclusion' }));
} finally { await server.close(); }
