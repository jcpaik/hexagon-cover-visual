import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom', logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});
const close = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

// Independent oracle: proof 2004 §2 uses support-contact lengths, rather
// than the production predicate's three polynomial cells.
function minimumSide(a, b, c) {
  const sum = a + b;
  if (sum === 0) return c;
  if (c * sum <= a * b) return Math.sqrt(a * a + a * b + b * b);
  const contact = (x, y) => {
    const radius = Math.sqrt(x * x - x * c + c * c);
    return x >= c ? (x * x + y * c) / radius
      : c <= sum ? c * sum / radius : c * c / radius;
  };
  return Math.min(b + Math.max(a, c), a + Math.max(b, c), contact(a, b), contact(b, a));
}

function signedArea(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - p.y * q.x;
  }, 0) / 2;
}

function sideMargins(polygon, point) {
  const orientation = Math.sign(signedArea(polygon));
  return polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return orientation * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
  });
}

// Enumerate the intersection's vertices independently of the production
// polygon clipper, then sort them around their centroid for the area check.
function intersectionArea(first, second) {
  const contains = (polygon, point) => sideMargins(polygon, point).every(value => value >= -1e-9);
  const points = [...first.filter(p => contains(second, p)), ...second.filter(p => contains(first, p))];
  for (let i = 0; i < first.length; i++) for (let j = 0; j < second.length; j++) {
    const a = first[i], b = first[(i + 1) % first.length];
    const c = second[j], d = second[(j + 1) % second.length];
    const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y;
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) < 1e-12) continue;
    const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant;
    const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant;
    if (t >= -1e-10 && t <= 1 + 1e-10 && u >= -1e-10 && u <= 1 + 1e-10) points.push({ x: a.x + t * dx, y: a.y + t * dy });
  }
  if (!points.length) return 0;
  const center = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  points.sort((p, q) => Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(q.y - center.y, q.x - center.x));
  return Math.abs(signedArea(points));
}

try {
  const maps = await server.ssrLoadModule('/src/maps.ts');
  const area = await server.ssrLoadModule('/src/areaConjecture.ts');
  const { HEXAGON_VERTICES } = await server.ssrLoadModule('/src/hexagon.ts');
  const { fitTriangle } = await server.ssrLoadModule('/src/cover.ts');
  maps.setStrictCheckEnabled(false);
  assert.equal(maps.admissible(0.43, 0.438, 1), false, 'Cell 2 must reject its spurious high-c component');
  assert.equal(maps.admissible(0.438, 0.43, 1), false, 'reflected high-c component');
  close(maps.gAtLocalC(1, 0.43), 1);

  const cases = [];
  for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) for (let c = 0; c <= 20; c++) cases.push([a / 20, b / 20, c / 20]);
  for (let a = 425; a <= 442; a++) for (let b = 425; b <= 442; b++) for (let c = 940; c <= 1000; c++) cases.push([a / 1000, b / 1000, c / 1000]);
  cases.push([0.4, 0.6, 0.2], [Math.sqrt(3) / 4, Math.sqrt(3) / 4, 0.2]);
  let predicateChecks = 0;
  for (const editable of [false, true]) {
    if (editable) assert.ok(maps.setAdmissibleOrderedSource(maps.DEFAULT_ADMISSIBLE_ORDERED_SOURCE).ok);
    for (const epsilon of [0, 1e-5, 0.02]) {
      maps.setStrictCheckEnabled(true);
      maps.setStrictEps(epsilon);
      const side = 1 - 2 * Math.sqrt(3) * epsilon;
      for (const [a, b, c] of cases) {
        const minimum = minimumSide(a, b, c);
        const actual = maps.admissible(a, b, c);
        if (Math.abs(minimum - side) > 1e-7) assert.equal(actual, minimum < side, `minimum-side oracle: ${a},${b},${c}; epsilon=${epsilon}`);
        predicateChecks++;
      }
      assert.ok(maps.admissible(0.2, 0.2, 0.2), 'symmetry is not a strict containment boundary');
      assert.ok(maps.admissible(0.4, 0.6, 0.2), 'cell transitions can be strictly feasible');
    }
    const points = [{ x: 0, y: 0 }, { x: 0.1, y: Math.sqrt(3) / 10 }, { x: 0.1, y: -Math.sqrt(3) / 10 }, { x: 0.2, y: 0 }];
    const fitted = fitTriangle('margin certificate', points, '#000');
    const unit = fitted.vertices.map(p => ({ x: fitted.center.x + (p.x - fitted.center.x) / fitted.side, y: fitted.center.y + (p.y - fitted.center.y) / fitted.side }));
    const clearance = Math.min(...points.flatMap(p => sideMargins(unit, p)));
    maps.setStrictEps(clearance - 1e-6);
    assert.ok(maps.admissible(0.2, 0.2, 0.2));
    maps.setStrictEps(clearance + 1e-6);
    assert.equal(maps.admissible(0.2, 0.2, 0.2), false);
    maps.setStrictEps(1 / (2 * Math.sqrt(3)));
    assert.ok(maps.admissible(0, 0, 0));
    assert.equal(maps.admissible(0, 0, 0.01), false);
    maps.setStrictEps(0.3);
    assert.equal(maps.admissible(0, 0, 0), false);
  }
  maps.setStrictEps(0.01);
  assert.ok(maps.setAdmissibleOrderedSource('return a === 0.2 && b === 0.2 && c === 0.2 && STRICT_EPS === 0.01;').ok);
  assert.ok(maps.admissible(0.2, 0.2, 0.2), 'custom predicates receive unscaled demands and the requested margin');
  maps.resetAdmissibleOrderedSource();
  maps.setStrictCheckEnabled(false);

  let areaChecks = 0;
  const pairs = [[0.55, 0.603], [0.55, 0.604275], [0.55, (-0.55 + Math.sqrt(4 - 3 * 0.55 ** 2)) / 2], [0.2, 0.5], [0, 0], [0, 1], [1, 0]];
  for (const [a, b] of pairs) for (const quality of ['coarse', 'high']) for (const index of [0, 2, 5]) {
    const result = area.computeAreaConjResult(index, a, b, quality);
    assert.equal(result.status, 'found', `area ${a},${b},${quality},V${index}`);
    assert.ok(result.triangle && result.f >= a * b - 1e-8 && result.f <= 1 + 1e-8);
    const triangle = result.triangle.vertices;
    triangle.forEach((p, i) => close(Math.hypot(p.x - triangle[(i + 1) % 3].x, p.y - triangle[(i + 1) % 3].y), 1));
    const required = area.areaConjRequiredPoints(index, a, b);
    for (const point of Object.values(required)) assert.ok(sideMargins(triangle, point).every(value => value >= -1e-8), 'required points are contained');
    close(result.f, intersectionArea(triangle, HEXAGON_VERTICES) / (Math.sqrt(3) / 4));
    close(result.deficit, 1 - result.f);
    areaChecks++;
  }
  const impossible = area.computeAreaConjResult(0, 0.6, 0.6, 'high');
  assert.equal(impossible.status, 'infeasible');
  assert.equal(impossible.f, null);
  assert.equal(impossible.deficit, null);
  const unresolved = area.computeAreaConjResult(0, 0.55, 0.603, 'high', true);
  assert.equal(unresolved.status, 'unresolved', 'a missed restricted search is not a proof of infeasibility');
  assert.equal(unresolved.f, null);
  assert.equal(unresolved.deficit, null);
  const found = area.computeAreaConjResult(0, 0.55, 0.603, 'high');
  close(area.areaConjTotals(Array(6).fill(found)).f, 6 * found.f);
  close(area.areaConjTotals(Array(6).fill(found)).deficit, 6 * found.deficit);
  for (const unavailable of [impossible, unresolved]) {
    for (const position of [0, 3, 5]) {
      const rows = Array(6).fill(found);
      rows[position] = unavailable;
      assert.deepEqual(area.areaConjTotals(rows), { f: null, deficit: null }, 'no partial or zero-substituted totals');
    }
  }
  const restricted = area.computeAreaConjResult(0, 0.2, 0.5, 'high', true);
  assert.equal(restricted.status, 'found', 'the optional restriction can produce a valid candidate');

  // These round to the same six decimals but straddle the anchor ellipse.
  const boundary = (-0.55 + Math.sqrt(4 - 3 * 0.55 ** 2)) / 2;
  const inside = area.computeAreaConjResult(0, 0.55, boundary - 1e-8, 'coarse');
  const outside = area.computeAreaConjResult(0, 0.55, boundary + 1e-8, 'coarse');
  assert.equal(inside.status, 'found');
  assert.equal(outside.status, 'infeasible');
  assert.notEqual(inside.b, outside.b, 'cache retains exact input identity');
  console.log(`Proof geometry passed: ${predicateChecks} admissibility comparisons, geometric strict margins, ${areaChecks} independent area certificates, and failure/cache classifications.`);
} finally {
  await server.close();
}
