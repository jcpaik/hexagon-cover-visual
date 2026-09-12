import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});
const h = Math.sqrt(3) / 2;
const cross = (a, b, point) => (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Independent segment clipping using CCW polygon edges, rather than the
// normal/offset representation used to construct and validate certificates.
function reach(triangle, start, end) {
  let limit = 1;
  triangle.forEach((a, index) => {
    const b = triangle[(index + 1) % 3];
    const from = cross(a, b, start);
    const change = cross(a, b, end) - from;
    if (change < 0) limit = Math.min(limit, -from / change);
  });
  return limit;
}

try {
  const { findRestrictedAbSource: find, isRestrictedAbSource: valid, SOURCE_INTERIOR_MARGIN: margin } = await server.ssrLoadModule('/src/ab-union/feasibility.ts');
  const { sampleRestrictedAbSources: sample } = await server.ssrLoadModule('/src/ab-union/regions.ts');
  const { lineIntersection } = await server.ssrLoadModule('/src/ab-union/geometry.ts');
  const { HEXAGON_VERTICES: vertices } = await server.ssrLoadModule('/src/hexagon.ts');
  const { createDefaultStrategy3State, strategy3EdgeDots } = await server.ssrLoadModule('/src/strategy3/state.ts');
  const { evaluateStrategy3Boundary } = await server.ssrLoadModule('/src/strategy3/boundary.ts');
  let certificates = 0;
  function check(role, triangle) {
    assert.ok(triangle, `source exists: ${JSON.stringify(role)}`);
    assert.ok(valid(role, triangle), 'public certificate validator accepts the source');
    assert.ok(cross(...triangle) > 0, 'certificate vertices are CCW');
    const vertex = vertices[role.index];
    triangle.forEach((point, side) => {
      const next = triangle[(side + 1) % 3];
      close(distance(point, next), 1, 1e-8);
      for (const required of [vertex, ...role.requiredInteriorPoints]) assert.ok(cross(point, next, required) >= margin - 1e-14, 'every required point lies strictly inside');
    });
    const a = reach(triangle, vertex, vertices[(role.index + 5) % 6]);
    const b = reach(triangle, vertex, vertices[(role.index + 1) % 6]);
    assert.ok(a >= role.a - 3e-11 && b >= role.b - 3e-11);
    if (role.restriction === 'in' || role.restriction === 'both') close(a, role.a, 3e-11);
    if (role.restriction === 'out' || role.restriction === 'both') close(b, role.b, 3e-11);
    if (role.criticality === 'non-supercritical') assert.ok(a + b <= 1 + 3e-11);
    if (role.criticality === 'supercritical') assert.ok(a + b > 1 + margin);
    certificates++;
  }

  const state = createDefaultStrategy3State();
  for (const mode of ['bc', 'd', 'f']) for (const layout of mode === 'f' ? ['six'] : ['seven', 'eight']) {
    if (mode !== 'f') state[mode].layout = layout;
    const evaluation = evaluateStrategy3Boundary(mode, strategy3EdgeDots(state, mode));
    for (const role of evaluation.roles) {
      const certificate = find(role);
      check(role, certificate);
      assert.equal(find({ ...role, label: 'different presentation' }), certificate, 'unchanged source constraints reuse the certificate');
    }
  }

  const base = { index: 0, a: 0.2, b: 0.3, restriction: 'ordinary', criticality: 'any', requiredInteriorPoints: [] };
  for (const a of [0, 0.01, 0.2, 0.5, 0.55, 0.9]) for (const b of [0, 0.01, 0.2, 0.5, 0.55, 0.9]) {
    for (const restriction of ['ordinary', 'in', 'out', 'both']) for (const criticality of ['any', 'non-supercritical', 'supercritical']) {
      const role = { ...base, a, b, restriction, criticality };
      const exactA = restriction === 'in' || restriction === 'both';
      const exactB = restriction === 'out' || restriction === 'both';
      const exists = a * a + a * b + b * b <= 1 && !(exactA && a === 0) && !(exactB && b === 0)
        && !(criticality === 'non-supercritical' && a + b > 1)
        && !(criticality === 'supercritical' && exactA && exactB && a + b <= 1);
      const certificate = find(role);
      assert.equal(certificate !== null, exists, `analytic reach feasibility at ${a},${b},${restriction},${criticality}`);
      if (certificate) check(role, certificate);
    }
  }

  const supplier = { ...base, restriction: 'in', criticality: 'non-supercritical', requiredInteriorPoints: [{ x: 0.25, y: h / 2 }] };
  for (const criticality of ['any', 'non-supercritical', 'supercritical']) for (const demand of [0, 1e-14, 1e-10, 1e-9, 0.01]) {
    const role = { ...base, a: demand, criticality };
    check(role, find(role));
    const reflected = { ...role, a: role.b, b: role.a };
    check(reflected, find(reflected));
  }
  const tinyExact = { ...base, a: 1.1e-9, b: 0.5, restriction: 'both', criticality: 'non-supercritical' };
  check(tinyExact, find(tinyExact));
  // Start from independently constructed sources close to the strict margin.
  // Lowering an ordinary demand must preserve their demonstrated feasibility.
  for (const interior of [2e-9, 1e-6]) for (let angleIndex = 0; angleIndex < 8; angleIndex++) for (let farSide = 0; farSide < 3; farSide++) {
    const angle = angleIndex * Math.PI / 12;
    const normals = [0, 1, 2].map((side) => ({ x: Math.cos(angle + side * 2 * Math.PI / 3), y: Math.sin(angle + side * 2 * Math.PI / 3) }));
    const offsets = normals.map((normal, side) => normal.x + (side === farSide ? h - 2 * interior : interior));
    const known = normals.map((normal, side) => lineIntersection(normal, offsets[side], normals[(side + 1) % 3], offsets[(side + 1) % 3]));
    const a = reach(known, vertices[0], vertices[5]);
    const b = reach(known, vertices[0], vertices[1]);
    const criticality = a + b <= 1 ? 'non-supercritical' : 'supercritical';
    for (const fraction of [1, 0.5, 0]) {
      const role = { ...base, a: a * fraction, b, criticality };
      assert.ok(valid(role, known), 'independent source proves the lowered-demand family is nonempty');
      check(role, find(role));
    }
  }
  for (const a of [0.05, 0.15, 0.25, 0.35, 0.45]) for (const b of [0.1, 0.3, 0.5, 0.65, 0.8]) {
    for (const restriction of ['in', 'both']) {
      const role = { ...supplier, a, b, restriction };
      const certificate = find(role);
      if (certificate) check(role, certificate);
      if (sample(role, 'full').triangles.length) assert.ok(certificate, 'the complete oracle never rejects an existing sampled source');
    }
  }
  const narrowSupplier = { ...supplier, a: 0.4999 };
  assert.equal(sample(narrowSupplier, 'full').triangles.length, 0, 'regression has no sources at the display sampling resolution');
  check(narrowSupplier, find(narrowSupplier));
  // |A_a−M1|² = a²+3/4. At a>=1/2, a unit triangle cannot contain
  // both the anchor and an interior midpoint, independent of orientation.
  for (const a of [0.5, 0.5001, 0.6]) assert.equal(find({ ...supplier, a }), null, 'unit-distance obstruction at the midpoint-supplier boundary');
  assert.equal(find({ ...supplier, restriction: 'both', b: 0.2 }), null, 'small exact traces cannot supply the midpoint');
  assert.ok(find({ ...supplier, restriction: 'both', b: 0.68 }), 'the default two-gap supplier has a source');

  const reflected = { ...supplier, a: supplier.b, b: supplier.a, restriction: 'out', requiredInteriorPoints: [{ x: 0.25, y: -h / 2 }] };
  check(reflected, find(reflected));
  const rotate = (point, angle) => ({ x: Math.cos(angle) * point.x - Math.sin(angle) * point.y, y: Math.sin(angle) * point.x + Math.cos(angle) * point.y });
  for (let index = 1; index < 6; index++) {
    const role = { ...supplier, index, requiredInteriorPoints: supplier.requiredInteriorPoints.map((point) => rotate(point, index * Math.PI / 3)) };
    check(role, find(role));
  }

  const exactPair = { ...base, a: 1 / Math.sqrt(3), b: 1 / Math.sqrt(3), restriction: 'both' };
  const pairSource = find(exactPair);
  check(exactPair, pairSource);
  const centroid = pairSource.reduce((point, corner) => ({ x: point.x + corner.x / 3, y: point.y + corner.y / 3 }), { x: 0, y: 0 });
  const isolated = { ...exactPair, requiredInteriorPoints: [centroid] };
  const isolatedSource = find(isolated);
  check(isolated, isolatedSource);
  assert.ok(isolatedSource.every((corner) => pairSource.some((expected) => distance(corner, expected) < 1e-8)), 'unit-length exact anchors fix the same isolated support orientation');
  assert.equal(find({ ...supplier, requiredInteriorPoints: [{ x: 3, y: 3 }] }), null, 'required interior points participate in the source cache key');
  assert.throws(() => find({ ...base, requiredInteriorPoints: [{ x: 0.25, y: h / 2 }] }), /requires an exact edge/, 'unsupported interior-source families are not silently reported infeasible');
  assert.throws(() => find({ ...supplier, criticality: 'supercritical' }), /requires an exact edge/, 'unsupported supercritical interior constraints are explicit');
  const triangle = find(base);
  assert.equal(valid(base, [...triangle].reverse()), false, 'clockwise vertices cannot masquerade as a valid certificate');
  assert.equal(valid(base, triangle.map((point) => ({ x: point.x * 0.9, y: point.y * 0.9 }))), false, 'non-unit triangles are rejected');
  assert.equal(find({ ...base, a: 1 }), null);
  assert.equal(find({ ...base, a: NaN }), null);
  console.log(`Restricted-source feasibility checks passed: ${certificates} independently verified certificates, all Strategy 3 layouts, sampled-source inclusion, narrow unsampled feasible intervals, isolated support orientations, and strict midpoint bounds.`);
} finally {
  await server.close();
}
