import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
const h = Math.sqrt(3) / 2, period = 2 * Math.PI / 3;
function sideAt(points, angle) {
  const q = points.map(p => ({ x: p.x - points[0].x, y: p.y - points[0].y }));
  return [0, 1, 2].reduce((sum, k) => sum + Math.max(...q.map(p => p.x * Math.cos(angle + k * period) + p.y * Math.sin(angle + k * period))), 0) / h;
}
// Independent finite oracle enumerates BOTH normals of EVERY point pair;
// it does not call the production hull or its orientation enumeration.
function pairOracle(points) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = 0; j < points.length; j++) {
    const a = points[i], b = points[j];
    if (a.x !== b.x || a.y !== b.y) best = Math.min(best, sideAt(points, Math.atan2(a.x - b.x, b.y - a.y)));
  }
  return Number.isFinite(best) ? best : 0;
}
try {
  const { fitTriangle } = await server.ssrLoadModule('/src/cover.ts');
  const cases = [
    [{ x: 1, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: .5, y: h }],
    [{ x: 0, y: 0 }, { x: .2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }],
    [{ x: 0, y: 0 }, { x: 1, y: 1e-13 }, { x: .5, y: -1e-13 }],
  ];
  let random = 24681357;
  const rng = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 2 ** 32; };
  for (let i = 0; i < 35; i++) cases.push(Array.from({ length: 3 + i % 9 }, () => ({ x: 2 * rng() - 1, y: 2 * rng() - 1 })));
  let comparisons = 0, containments = 0;
  for (const base of cases) for (const reflected of [false, true]) for (const scale of [1e-7, 1, 1e5]) {
    const angle = .37243;
    const points = base.map(({ x, y }) => ({ x: 2.5 + scale * (x * Math.cos(angle) - (reflected ? -y : y) * Math.sin(angle)),
      y: -1.7 + scale * (x * Math.sin(angle) + (reflected ? -y : y) * Math.cos(angle)) }));
    const fit = fitTriangle('test', points, '#000');
    const tolerance = 2e-9 * Math.max(1, scale);
    assert.ok(Math.abs(fit.side - pairOracle(points)) <= tolerance, 'global pair-normal oracle');
    assert.ok(Math.abs(fit.side - pairOracle(base) * scale) <= tolerance, 'rotation/reflection/scaling invariance');
    for (const p of points) fit.normals.forEach((n, i) => { assert.ok(n.x * p.x + n.y * p.y <= fit.lambdas[i] + tolerance); containments++; });
    assert.ok(fit.vertices.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
    comparisons++;
  }
  let denseChecks = 0;
  for (const points of cases.slice(1, 15)) {
    const fit = fitTriangle('dense', points, '#000');
    for (let k = 0; k < 7200; k++) { assert.ok(fit.side <= sideAt(points, k * period / 7200) + 2e-10); denseChecks++; }
  }
  assert.throws(() => fitTriangle('empty', [], '#000'), RangeError);
  assert.throws(() => fitTriangle('NaN', [{ x: NaN, y: 0 }], '#000'), RangeError);
  assert.equal(fitTriangle('point', [{ x: 2, y: 3 }, { x: 2, y: 3 }], '#000').side, 0);
  assert.ok(Math.abs(fitTriangle('unit', cases[2], '#000').side - 1) < 1e-12);
  console.log(JSON.stringify({ status: 'PASS', comparisons, containments, denseChecks, method: 'finite calipers versus independent pair normals and rigid transformations' }));
} finally { await server.close(); }
