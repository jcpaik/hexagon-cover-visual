import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});

const h = Math.sqrt(3) / 2;
const close = (actual, expected, label, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
};
const pointClose = (actual, expected, label, tolerance) => {
  assert.ok(actual, `${label} exists`);
  close(actual.x, expected.x, `${label}.x`, tolerance);
  close(actual.y, expected.y, `${label}.y`, tolerance);
};
const findPoint = (result, id) => result.points.find((point) => point.id === id)?.point;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const scale = (s, point) => ({ x: s * point.x, y: s * point.y });

function checkEnclosure(result) {
  assert.ok(result.triangle, 'numerical enclosure exists');
  for (const { point, enabled } of result.points) {
    if (!enabled) continue;
    assert.ok(point, 'enabled point exists');
    result.triangle.normals.forEach((normal, index) => {
      assert.ok(normal.x * point.x + normal.y * point.y <= result.triangle.lambdas[index] + 1e-8, 'fitted triangle contains every selected witness');
    });
  }
}

try {
  const g = await server.ssrLoadModule('/src/strategy3/geometry.ts');
  const core = await server.ssrLoadModule('/src/coreCase.ts');
  const free = await server.ssrLoadModule('/src/freeGeometry.ts');
  const { HEXAGON_VERTICES: vertices } = await server.ssrLoadModule('/src/hexagon.ts');
  const { algorithm2CStar } = await server.ssrLoadModule('/src/radialCapacity.ts');

  // Captured before extracting radialCapacity.ts: full historical six-point
  // outputs, including fits, for both ordinary and relaxed circle settings.
  const oldCases = [[0.55, 0.55], [0.64, 0.5], [0.5, 0.64], [0.85, 0.2], [0.51, 0.5], [0.4, 0.72]];
  const oldResults = oldCases.flatMap(([a, b]) => [false, true].map((relaxed) => core.evaluateCoreCaseGraph(a, b, undefined, 'exact', relaxed)));
  assert.equal(createHash('sha256').update(JSON.stringify(oldResults)).digest('hex'), '018e2b68478f2a2409a1441fd731aa8b612c09699ee564e20474b40b8fd4dfce', 'legacy Core Case behavior is unchanged');
  const oldSupersets = [[0.55, 0.55], [0.8, 0.25], [0.3, 0.74]].flatMap(([a, b]) => [false, true].map((relaxed) => {
    const sample = core.evaluateCoreCaseGraph(a, b, undefined, 'strict-two-line-superset', relaxed);
    return { a, b, relaxed, points: sample.points, side: sample.side };
  }));
  assert.equal(createHash('sha256').update(JSON.stringify(oldSupersets)).digest('hex'), 'ddb0bdc97e49119ff5a05efe3319260924fda4af8eb0fdedbd85abcb10e185a7', 'pre-extraction two-line Core Case baseline is unchanged');

  const quartic = algorithm2CStar(0.36, 0.5);
  close(quartic ** 4 - quartic ** 2 + 0.36 * quartic - 0.36 ** 2, 0, 'selected quartic root');
  close(algorithm2CStar(0.45, 0.45), 0.9 / (1 + Math.sqrt(0.24)), 'other radial-capacity branch');
  close(algorithm2CStar(Math.sqrt(3) / 4, Math.sqrt(3) / 4), h, 'radial transition');

  const bc = g.buildBC(g.DEFAULT_BC_PARAMETERS);
  assert.deepEqual(bc.points.map((point) => point.id), ['M0', 'G0', 'G1', 'D2', 'D3', 'D4']);
  pointClose(findPoint(bc, 'M0'), { x: 0.5, y: 0 }, 'BC midpoint');
  pointClose(findPoint(bc, 'G0'), { x: 0.75, y: h / 2 }, 'BC gap start');
  pointClose(findPoint(bc, 'G1'), { x: 0.675, y: 0.65 * h }, 'BC gap end');
  assert.equal(bc.theoremApplicable, false, 'supplied BC coordinates do not verify triangle hypotheses');
  checkEnclosure(bc);
  const singleton = g.buildBC({ left: 0.4, right: 0.4, radial: [0.3, 0.4, 0.5] });
  assert.ok(singleton.domainOk, 'singleton gap belongs to the BC domain');
  pointClose(findPoint(singleton, 'G0'), findPoint(singleton, 'G1'), 'singleton endpoints coincide');
  assert.equal(g.buildBC({ left: 0.7, right: 0.4, radial: [0.5, 0.5, 0.5] }).domainOk, false);
  assert.equal(g.buildBC({ left: 0.4, right: 0.7, radial: [0, 0.5, 0.5] }).domainOk, false);
  const subsetBC = g.buildBC(g.DEFAULT_BC_PARAMETERS, ['M0']);
  assert.match(subsetBC.status, /BC source hypotheses are not verified/);
  assert.match(subsetBC.status, /subset fit/);
  assert.equal(subsetBC.theoremApplicable, false);
  assert.equal(g.buildBC(g.DEFAULT_BC_PARAMETERS, bc.points.map((point) => point.id)).triangle, null, 'empty BC selection has no fit');

  // This unit triangle has an exact supported interval on r2:
  // [1−1/√3, 1/4+√3/6], measured from V2 toward O.
  const poses = free.createDefaultFreeState().triangles.filter((triangle) => triangle.id !== 'C');
  const supportPoses = poses.map((triangle, index) => ({ ...triangle, center: scale(1.2, vertices[index]) }));
  supportPoses[1] = { ...supportPoses[1], center: { x: 0, y: h }, angle: -Math.PI / 2 };
  const interval = g.segmentTriangleInterval(supportPoses[1], vertices[2], { x: 0, y: 0 });
  close(interval[0], 1 - 1 / Math.sqrt(3), 'neighbor interval start');
  close(interval[1], 0.25 + Math.sqrt(3) / 6, 'neighbor interval end');
  const reaches = g.extractActualReaches(supportPoses);
  assert.ok(reaches.every((row) => row.vertexInside), 'test roles strictly contain assigned vertices');
  close(reaches[2].neighbors[0], interval[1], 'preceding neighbor contributes');
  assert.ok(reaches[2].neighbors[0] > reaches[2].c, 'neighbor extends beyond own radial reach');
  close(reaches[2].gamma, interval[1], 'total endpoint uses neighbor');
  close(reaches[2].neighbors[1], 0, 'absent neighboring trace contributes zero');
  const derivedBC = g.deriveBC(supportPoses);
  pointClose(findPoint(derivedBC, 'D2'), scale(1 - interval[1], vertices[2]), 'BC uses actual total frontier');
  reaches.forEach((row) => {
    const endpoint = scale(row.radial, vertices[row.index]);
    assert.ok(supportPoses.every((triangle) => !free.strictPointInTriangle(endpoint, triangle, 1e-8)), 'total endpoint is missed by all open V triangles');
  });
  const detached = poses.map((triangle) => ({ ...triangle }));
  detached[0] = { ...detached[0], center: { x: 0.3, y: 0 }, angle: 0 };
  const detachedReach = g.extractActualReaches(detached)[0];
  assert.equal(detachedReach.vertexInside, false);
  assert.equal(detachedReach.c, 0, 'an interval disconnected from the assigned vertex is not an own reach');

  const d = g.buildD(g.DEFAULT_D_PARAMETERS);
  assert.deepEqual(d.points.map((point) => point.id), ['O', 'PT', 'G0', 'G1']);
  pointClose(findPoint(d, 'PT'), { x: 0.2, y: 0.4 * h }, 'D radial point');
  pointClose(findPoint(d, 'G0'), { x: 0.9, y: -0.2 * h }, 'D near boundary point');
  pointClose(findPoint(d, 'G1'), { x: 0.75, y: -h / 2 }, 'D far boundary point');
  assert.ok(d.theoremApplicable);
  checkEnclosure(d);
  for (const parameters of [
    { a: 0, epsilon: 0.4, beta: 0.5 },
    { a: 0.2, epsilon: 0.4, beta: 0 },
    { a: 0.5, epsilon: 0.5, beta: 0.5 },
  ]) {
    const boundary = g.buildD(parameters);
    assert.ok(boundary.domainOk, 'D closed endpoint cases are included');
    assert.ok(boundary.side >= 1 - 1e-8, 'boundary witnesses require at least unit side');
    checkEnclosure(boundary);
  }
  for (const parameters of [
    { a: 0.2, epsilon: 0, beta: 0.5 },
    { a: 0.6, epsilon: 0.6, beta: 0.5 },
    { a: 0.4, epsilon: 0.3, beta: 0.2 },
    { a: 0.2, epsilon: 0.4, beta: 0.8 },
  ]) assert.equal(g.buildD(parameters).domainOk, false, 'D rejects a violated hypothesis');
  const subsetD = g.buildD(g.DEFAULT_D_PARAMETERS, ['PT']);
  assert.equal(subsetD.theoremApplicable, false, 'the theorem does not assert a bound for a selected subset');
  assert.ok(subsetD.side <= d.side + 1e-8, 'removing a witness cannot increase the fitted minimum');
  const supplierPoses = poses.map((triangle) => ({ ...triangle }));
  supplierPoses[0] = { ...supplierPoses[0], center: { x: 0.75, y: Math.sqrt(3) / 4 }, angle: -5 * Math.PI / 6 };
  const derivedD = g.deriveD(supplierPoses);
  assert.ok(derivedD.conditions.find((condition) => condition.id === 'supplier').ok);
  close(derivedD.parameters.epsilon, 0.75 - Math.sqrt(3) / 6, 'D uses actual supported O-side endpoint');
  assert.ok(derivedD.geometryApplicable && derivedD.theoremApplicable, 'pure D theorem applies independently of the failed covering adapter');
  assert.equal(derivedD.sourceApplicable, false);
  assert.equal(g.deriveD(poses).triangle, null, 'missing support interval does not invent a radial endpoint');

  // Cover the quartic/radical regimes, asymmetry, and both strict-domain edges.
  const fCases = [...oldCases, [0.8, 0.3], [0.9, 0.15], [0.500001, 0.5], [0.577, 0.577]];
  for (const [a, b] of fCases) {
    const f = g.evaluateNinePoint(a, b);
    assert.ok(f.domainOk && f.status === 'ready', `F9 is available at ${a},${b}`);
    assert.deepEqual(f.points.map((point) => point.id), [...g.NINE_POINT_IDS]);
    assert.equal(f.enabledPointCount, 9);
    const radius = 1 - f.cStar;
    for (let index = 0; index < 6; index++) pointClose(findPoint(f, `D${index}`), scale(radius, vertices[index]), 'F radial point');
    close(f.diskRadius, h * radius, 'F comparison disk radius');
    close(distance(findPoint(f, 'Q-'), f.circles[0].center), 1, 'Q- lies on virtual C2');
    close(distance(findPoint(f, 'Q+'), f.circles[1].center), 1, 'Q+ lies on virtual C5');
    const rho = a * a + a * b + b * b;
    const root = Math.sqrt(4 * rho - 3);
    const alpha = h * (b + 2 * a - b * root) / (2 * rho);
    const delta = h * (2 * b + a - a * root) / (2 * rho);
    const local = (point) => {
      const v = (point.y + h) / h;
      return { u: point.x + 0.5 + v / 2, v };
    };
    const junction = local(findPoint(f, 'Q0'));
    const lambdaStar = 8 * h * rho / (3 * (root + 3));
    close(junction.v / alpha, lambdaStar, 'junction lies on first line');
    close(junction.u / delta, lambdaStar, 'junction lies on second line');
    const lambda = local(findPoint(f, 'Q-')).v / alpha;
    const mu = local(findPoint(f, 'Q+')).u / delta;
    assert.ok(lambda > lambdaStar && lambda < 1 / h, 'Q- uses the selected first-root segment');
    assert.ok(mu > lambdaStar && mu < 1 / h, 'Q+ uses the selected first-root segment');
    const reflected = g.evaluateNinePoint(b, a);
    const reflect = (point) => {
      const projection = point.x * vertices[4].x + point.y * vertices[4].y;
      return { x: 2 * projection * vertices[4].x - point.x, y: 2 * projection * vertices[4].y - point.y };
    };
    pointClose(findPoint(reflected, 'Q+'), reflect(findPoint(f, 'Q-')), 'F reflection exchanges Q-/Q+');
    pointClose(findPoint(reflected, 'Q0'), reflect(findPoint(f, 'Q0')), 'F junction reflects');
    assert.ok(f.side >= 1 - 1e-8, 'reference F configurations have the proved enclosure obstruction');
    checkEnclosure(f);
    const subset = g.evaluateNinePoint(a, b, ['Q-', 'Q0', 'Q+']);
    for (const id of ['Q-', 'Q0', 'Q+']) pointClose(findPoint(subset, id), findPoint(f, id), 'selection does not move witnesses');
    assert.ok(subset.side <= f.side + 1e-7, 'subset fit does not exceed full fit');
  }
  assert.equal(g.evaluateNinePoint(0.64, 0.5, []).triangle, null, 'empty F selection has no fit');
  for (const [a, b] of [[0, 0.8], [1, 0], [0.5, 0.5], [0.6, 0.6], [NaN, 0.5], [Infinity, 0.5]]) {
    const invalid = g.evaluateNinePoint(a, b);
    assert.equal(invalid.domainOk, false);
    assert.equal(invalid.triangle, null);
    assert.ok(invalid.points.every((point) => point.point === null), 'invalid F domain has no fallback witnesses');
  }
  console.log('Strategy 3 checks passed: BC/D constructions, actual neighboring traces, F9 root identities and enclosures, and 18 unchanged Core Case evaluations.');
} finally {
  await server.close();
}
