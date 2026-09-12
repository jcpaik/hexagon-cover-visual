import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});
const close = (actual, expected, label, tolerance = 1e-9) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} != ${expected}`,
);
const dots = (values) => values.map((value) => Array.isArray(value)
  ? { left: value[0], right: value[1], split: true }
  : { left: value, right: value, split: false });
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const interpolate = (a, b, t) => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
const origin = { x: 0, y: 0 };

// Independent clipping against polygon edges; no sampler support data is used.
function segmentInterval(triangle, start, end) {
  let low = 0;
  let high = 1;
  for (let index = 0; index < 3; index++) {
    const a = triangle[index];
    const b = triangle[(index + 1) % 3];
    const atStart = cross(a, b, start);
    const change = cross(a, b, end) - atStart;
    if (Math.abs(change) < 1e-12) {
      if (atStart < -1e-10) return null;
    } else if (change > 0) low = Math.max(low, -atStart / change);
    else high = Math.min(high, -atStart / change);
  }
  return low <= high + 1e-10 ? [low, high] : null;
}

try {
  const { evaluateStrategy3Boundary } = await server.ssrLoadModule('/src/strategy3/boundary.ts');
  const { sampleRestrictedAbSources, abUnionRegionKey } = await server.ssrLoadModule('/src/ab-union/regions.ts');
  const { containsAbUnionLocal } = await server.ssrLoadModule('/src/ab-union/geometry.ts');
  const { ownRayCapacity, forwardNeighborCapacity, backwardNeighborCapacity, algorithm2CStar } = await server.ssrLoadModule('/src/radialCapacity.ts');
  const { evaluateNinePoint } = await server.ssrLoadModule('/src/strategy3/geometry.ts');
  const { HEXAGON_VERTICES: vertices } = await server.ssrLoadModule('/src/hexagon.ts');
  close(ownRayCapacity(0, 0), 1, 'zero demands allow the entire own ray');
  close(ownRayCapacity(0.45, 0.45), algorithm2CStar(0.45, 0.45), 'historical common-pair branch');
  close(ownRayCapacity(0.55, 0.58), ownRayCapacity(0.58, 0.55), 'supercritical reflection');
  assert.equal(ownRayCapacity(0.6, 0.6), null, 'impossible anchors do not become a full radial capacity');
  for (const [a, b] of [[-0.1, 0.3], [NaN, 0.3], [0.1, Infinity], [1.1, 0]]) {
    assert.equal(ownRayCapacity(a, b), null);
    assert.equal(forwardNeighborCapacity(a, b), null);
  }
  assert.equal(forwardNeighborCapacity(0.55, 0.58), null, 'supercritical roles cannot reach the neighbor ray');
  close(forwardNeighborCapacity(0.6, 0.3), 0.7, 'linear neighbor branch');
  for (const a of [0, 0.1, 0.3, 0.5]) {
    // Newton iteration checks the cubic separately from the production bisection.
    let p = 0.75;
    for (let step = 0; step < 30; step++) p -= (p ** 3 - (a + 2) * p ** 2 + 2 * (a + 1) * p - 1) / (3 * p * p - 2 * (a + 2) * p + 2 * (a + 1));
    const sigma = 1 - p;
    const tau = 1 - a - (p - a) * (1 - p);
    close(forwardNeighborCapacity(a, Math.max(0, sigma / 2)), 1 - Math.max(0, sigma / 2), 'before neighbor plateau');
    close(forwardNeighborCapacity(a, (sigma + tau) / 2), p, 'neighbor plateau');
    close(forwardNeighborCapacity(a, tau), p, 'tau includes plateau endpoint');
    if (tau < 1 - a - 1e-10) {
      const b = (tau + 1 - a) / 2;
      close(forwardNeighborCapacity(a, b), a + 0.5 - Math.sqrt((a + b) ** 2 - 0.75), 'after neighbor plateau');
    }
    close(backwardNeighborCapacity(0.3, a), forwardNeighborCapacity(a, 0.3), 'neighbor reflection');
  }

  const fixtures = [
    ['bc', [[0.35, 0.65], 0.605, 0.555, 0.505, 0.455, 0.405]],
    ['bc', [[0.42, 0.58], 0.555, 0.505, 0.455, 0.405, [0.3, 0.5]]],
    ['d', [0.3, 0.41, 0.36, 0.31, 0.26, [0.2, 0.8]]],
    ['d', [[0.68, 0.7], 0.74, 0.65, 0.56, 0.47, [0.2, 0.8]]],
    ['f', [0.528, 0.502, 0.476, 0.45, 0.58, 0.554]],
  ];
  const expectedSourceCounts = [
    [1309, 897, 821, 786, 782, 816], [280, 705, 786, 782, 816, 1321],
    [8, 120, 859, 905, 983, 1044], [6, 378, 1318, 1205, 1168, 1816],
    [514, 509, 506, 510, 90, 547],
  ];
  const constructionBaseline = [];
  let sourceCount = 0;
  for (const [fixtureIndex, [mode, values]] of fixtures.entries()) {
    const edgeDots = dots(values);
    const result = evaluateStrategy3Boundary(mode, edgeDots);
    constructionBaseline.push({ capacities: result.capacities, conditions: result.conditions, witness: result.witness });
    assert.equal(edgeDots.reduce((sum, edge) => sum + (edge.split ? 2 : 1), 0), mode === 'f' ? 6 : values.filter(Array.isArray).length + 6);
    assert.equal(result.witness.points.length, { bc: 6, d: 4, f: 9 }[mode]);
    assert.ok(result.conditions.every((condition) => condition.ok), `${mode} preset conditions`);
    if (mode !== 'f') {
      for (const edge of [1, 2, 3, 4]) close(result.roles[edge].b + result.roles[(edge + 1) % 6].a, 1, 'shared lower demands meet at one handoff');
      assert.ok(result.conditions.filter((condition) => condition.group === 'source').every((condition) => condition.ok), 'shared lower demands do not need strict actual-source overlap');
    }
    assert.ok(result.witness.points.every((point) => point.point !== null));
    assert.ok(result.witness.side >= 1 - 1e-8, `${mode} fixture needs at least a unit enclosure`);
    if (mode === 'bc') assert.equal(result.witness.theoremApplicable, false, 'capacity BC does not claim actual-source hypotheses');
    result.roles.forEach((role, index) => {
      close(role.a, 1 - edgeDots[(index + 5) % 6].right, 'backward boundary demand');
      close(role.b, edgeDots[index].left, 'forward boundary demand');
      assert.equal(role.restriction, edgeDots[(index + 5) % 6].split ? edgeDots[index].split ? 'both' : 'in' : edgeDots[index].split ? 'out' : 'ordinary');
      const { triangles } = sampleRestrictedAbSources(role, 'full');
      assert.equal(triangles.length, expectedSourceCounts[fixtureIndex][index], 'moving the sampler preserves source counts');
      assert.ok(triangles.length > 0, `${mode} V${index} has restricted sources`);
      assert.equal(sampleRestrictedAbSources(role, 'full').triangles, triangles, 'unchanged source family is cached');
      sourceCount += triangles.length;
      for (const triangle of triangles) {
        triangle.forEach((point, side) => {
          close(Math.hypot(point.x - triangle[(side + 1) % 3].x, point.y - triangle[(side + 1) % 3].y), 1, 'source side length');
          assert.ok(cross(point, triangle[(side + 1) % 3], vertices[index]) > 1e-7, 'assigned vertex is strictly inside');
        });
        const a = segmentInterval(triangle, vertices[index], vertices[(index + 5) % 6])[1];
        const b = segmentInterval(triangle, vertices[index], vertices[(index + 1) % 6])[1];
        assert.ok(a >= role.a - 2e-8 && b >= role.b - 2e-8, 'source contains lower demands');
        if (role.restriction === 'in' || role.restriction === 'both') close(a, role.a, 'exact backward reach', 2e-5);
        if (role.restriction === 'out' || role.restriction === 'both') close(b, role.b, 'exact forward reach', 2e-5);
        if (role.criticality === 'non-supercritical') assert.ok(a + b <= 1 + 1e-9);
        if (role.criticality === 'supercritical') assert.ok(a + b > 1);
        for (const requiredPoint of role.requiredInteriorPoints) triangle.forEach((point, side) => assert.ok(cross(point, triangle[(side + 1) % 3], requiredPoint) > 1e-7, 'source strictly contains every required interior point'));
        for (const [ray, bound] of [[index, ownRayCapacity(role.a, role.b)], [(index + 1) % 6, forwardNeighborCapacity(role.a, role.b)], [(index + 5) % 6, backwardNeighborCapacity(role.a, role.b)]]) {
          const interval = segmentInterval(triangle, vertices[ray], origin);
          if (interval && interval[1] - interval[0] > 1e-8) {
            assert.notEqual(bound, null, 'a sampled radial trace has an analytic capacity');
            assert.ok(interval[1] <= bound + 1e-8, `sampled reach ${interval[1]} exceeds capacity ${bound}`);
          }
        }
      }
    });
    const disabled = [result.witness.points[0].id];
    const subset = evaluateStrategy3Boundary(mode, edgeDots, disabled);
    assert.equal(subset.witness.enabledPointCount, result.witness.points.length - 1);
    assert.deepEqual(subset.witness.points.map((point) => point.point), result.witness.points.map((point) => point.point), 'selection cannot move dependent witnesses');
  }
  assert.equal(createHash('sha256').update(JSON.stringify(constructionBaseline, (key, value) => key === 'pointConstruction' ? undefined : value)).digest('hex'), '5864fdb8a200a3d9f71c94fa7e645c5ab4d622ccf15ec325458f83395328e431', 'AB sampler ownership does not change capacity bounds, diagnostics, witnesses, or fits');

  const bothRole = { index: 0, a: 0.2, b: 0.2, restriction: 'both', criticality: 'any', requiredInteriorPoints: [] };
  const bothSources = sampleRestrictedAbSources(bothRole, 'full').triangles;
  const aPoint = interpolate(vertices[0], vertices[5], bothRole.a);
  const bPoint = interpolate(vertices[0], vertices[1], bothRole.b);
  assert.ok(bothSources.some((triangle) => triangle.some((point, index) => Math.abs(cross(point, triangle[(index + 1) % 3], aPoint)) < 1e-9 && Math.abs(cross(point, triangle[(index + 1) % 3], bPoint)) < 1e-9)), 'both endpoints may use the same active support side');
  assert.equal(sampleRestrictedAbSources({ ...bothRole, a: 0 }, 'full').triangles.length, 0, 'zero exact reach cannot strictly contain the vertex');
  assert.equal(sampleRestrictedAbSources({ ...bothRole, criticality: 'supercritical' }, 'full').triangles.length, 0, 'exact nonsupercritical traces cannot supply a supercritical role');

  const outwardRole = { ...bothRole, b: 0.4, restriction: 'out' };
  const outwardSources = sampleRestrictedAbSources(outwardRole, 'full');
  assert.equal(sampleRestrictedAbSources({ ...outwardRole, suppliesMidpoint: true, color: '#fff' }, 'full'), outwardSources, 'presentation fields do not invalidate source geometry');
  assert.equal(abUnionRegionKey({ ...outwardRole, label: 'changed' }), abUnionRegionKey(outwardRole));
  const center = outwardSources.triangles[0].reduce((sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3 }), { x: 0, y: 0 });
  const requiredInteriorPoints = [center, interpolate(center, vertices[0], 0.5)];
  const interiorRole = { ...outwardRole, requiredInteriorPoints };
  assert.notEqual(abUnionRegionKey(interiorRole), abUnionRegionKey(outwardRole), 'required interior points belong to the source cache key');
  const interiorSources = sampleRestrictedAbSources(interiorRole, 'full').triangles;
  assert.ok(interiorSources.length > 0 && interiorSources.length < outwardSources.triangles.length, 'generic interior constraints filter the source family');
  for (const triangle of interiorSources) for (const required of requiredInteriorPoints) {
    assert.ok(triangle.every((point, side) => cross(point, triangle[(side + 1) % 3], required) > 1e-7), 'all generic required points are strictly contained');
  }
  assert.equal(sampleRestrictedAbSources({ ...outwardRole, requiredInteriorPoints: [{ x: 3, y: 3 }] }, 'full').triangles.length, 0, 'changed interior constraints cannot return a stale family');
  const reflectedRole = { ...outwardRole, a: outwardRole.b, b: outwardRole.a, restriction: 'in' };
  const reflectedSources = sampleRestrictedAbSources(reflectedRole, 'full').triangles;
  const triangleKey = (triangle, reflect) => JSON.stringify(triangle.map((point) => [Math.round(point.x * 1e8), Math.round((reflect ? -point.y : point.y) * 1e8)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  assert.deepEqual(new Set(outwardSources.triangles.map((triangle) => triangleKey(triangle, true))), new Set(reflectedSources.map((triangle) => triangleKey(triangle, false))), 'reflection swaps in/out constraints and entire sampled source families');
  let crossesEndpointPlane = false;
  for (const triangle of outwardSources.triangles) {
    for (let first = 0; first <= 4; first++) for (let second = 0; second <= 4 - first; second++) {
      const third = 4 - first - second;
      const point = { x: (first * triangle[0].x + second * triangle[1].x + third * triangle[2].x) / 4, y: (first * triangle[0].y + second * triangle[1].y + third * triangle[2].y) / 4 };
      const u = 1 - point.x + point.y / Math.sqrt(3);
      const v = 1 - point.x - point.y / Math.sqrt(3);
      if (u < 0 || v < 0) continue;
      assert.ok(containsAbUnionLocal(u, v, outwardRole.a, outwardRole.b), 'restricted source union stays inside the existing ordinary analytic AB envelope');
      if (u > outwardRole.b + 0.1 && v > 0.05) crossesEndpointPlane = true;
    }
  }
  assert.ok(crossesEndpointPlane, 'exact forward reach does not impose a planar cut through the endpoint');

  const fDots = dots(fixtures[4][1]);
  const f = evaluateStrategy3Boundary('f', fDots);
  assert.deepEqual(f.witness, evaluateNinePoint(0.55, 0.58), 'F uses the unchanged canonical nine-point evaluator');
  const newtonF = evaluateStrategy3Boundary('f', fDots, [], 'newton');
  assert.deepEqual(newtonF.witness, evaluateNinePoint(0.55, 0.58, undefined, 'newton'), 'F forwards the Newton selector');
  assert.deepEqual(newtonF.conditions, f.conditions, 'the selector does not alter source checks');
  assert.deepEqual(newtonF.capacities, f.capacities, 'the selector does not alter capacities');
  const newtonSubset = evaluateStrategy3Boundary('f', fDots, ['Q-'], 'newton');
  assert.equal(newtonSubset.witness.enabledPointCount, 8);
  assert.equal(newtonSubset.witness.points.find((point) => point.symbol === 'A').enabled, false);
  const movedFDots = structuredClone(fDots);
  movedFDots[4].left = movedFDots[4].right = 0.57;
  assert.notDeepEqual(evaluateStrategy3Boundary('f', movedFDots, [], 'newton').witness.points, newtonF.witness.points, 'critical handle movement recomputes inner points');
  fDots[0].left = fDots[0].right = 0.1;
  const invalidF = evaluateStrategy3Boundary('f', fDots);
  assert.deepEqual(evaluateStrategy3Boundary('f', fDots, [], 'newton').witness.points, newtonF.witness.points, 'noncritical handles do not move Newton points');
  assert.equal(invalidF.conditions.find((condition) => condition.id === 'common-pair').ok, false);
  assert.deepEqual(invalidF.witness.points, f.witness.points, 'noncritical F handles change context without inventing new canonical points');
  const invalidBCDots = dots(fixtures[0][1]);
  invalidBCDots[1].left = invalidBCDots[1].right = 0;
  invalidBCDots[2].left = invalidBCDots[2].right = 1;
  const invalidBC = evaluateStrategy3Boundary('bc', invalidBCDots);
  assert.equal(invalidBC.capacities[2].gamma, null);
  assert.equal(invalidBC.witness.points.find((point) => point.id === 'D2').point, null, 'undefined capacity hides only that radial witness');
  assert.ok(invalidBC.witness.points.find((point) => point.id === 'M0').point);
  const weakTailDots = dots(fixtures[1][1]);
  weakTailDots[5].left = 0.1;
  const weakTail = evaluateStrategy3Boundary('bc', weakTailDots);
  assert.equal(weakTail.conditions.find((condition) => condition.id === 'selected-tail').ok, false, 'weak selected BC tail gets its own diagnostic');
  assert.ok(weakTail.conditions.filter((condition) => condition.id !== 'selected-tail').every((condition) => condition.ok), 'tail diagnostic is independent of other boundary and geometric checks');
  assert.ok(weakTail.witness.points.every((point) => point.point), 'a failed selected tail bound retains defined witnesses');
  assert.equal(weakTail.witness.theoremApplicable, false, 'capacity BC never certifies actual covering hypotheses');
  const weakTailRole = weakTail.roles[5];
  assert.ok(sampleRestrictedAbSources(weakTailRole, 'full').triangles.length > 0, 'a selected tail failure does not reject an independently feasible source family');
  const coincident = dots(fixtures[0][1]);
  coincident[0].left = coincident[0].right = 0.5;
  const singleton = evaluateStrategy3Boundary('bc', coincident);
  assert.equal(singleton.roles[0].restriction, 'out', 'coincident gap endpoints preserve source restrictions');
  assert.equal(singleton.roles[1].restriction, 'in');
  assert.deepEqual(singleton.witness.points[1].point, singleton.witness.points[2].point);
  console.log(`Strategy 3 boundary checks passed: all five layouts, restricted source predicates, ${sourceCount} independent source/capacity checks, same-support endpoint constraints, and witness dependencies.`);
} finally {
  await server.close();
}
