import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 1e-10, `${label}: ${actual} != ${expected}`);
}

try {
  const geometry = await server.ssrLoadModule('/src/ab-union/geometry.ts');
  const stateApi = await server.ssrLoadModule('/src/ab-union/state.ts');
  const parameters = [[0, 0], [0.25, 0.25], [0.2, 0.7], [0.4, 0.6], [0.45, 0.7], [0.6, 0.6], [1, 1]];
  const samples = parameters.map(([a, b]) => {
    const exact = [];
    const superset = [];
    for (let u = -2; u <= 42; u++) {
      for (let v = -2; v <= 42; v++) {
        const inExact = geometry.containsAbUnionLocal(u / 20, v / 20, a, b);
        const inSuperset = geometry.containsAbUnionLocal(u / 20, v / 20, a, b, 'strict-two-line-superset');
        assert.ok(!inExact || inSuperset, 'two-line region contains exact region');
        exact.push(Number(inExact));
        superset.push(Number(inSuperset));
      }
    }
    return {
      exact: exact.join(''),
      superset: superset.join(''),
      hull: geometry.buildAbUnionLocalHexAxisHull(a, b, 40, 0.025),
      lines: geometry.abUnionStrictTwoLineSupersetSegments(a, b),
    };
  });
  // Captured from the original module before reorganizing it.
  const geometryDigest = createHash('sha256').update(JSON.stringify(samples)).digest('hex');
  assert.equal(geometryDigest, 'fe6205a3abd6e6e77871395bc7525477a5760b04d843ad56ea33bf8d32ce6ed6');

  const shared = stateApi.createDefaultAbUnionState();
  assert.ok(stateApi.setAbUnionDotValue(shared, { edge: 0, role: 'shared' }, 0.4));
  close(stateApi.abUnionBValues(shared)[0], 0.4, 'shared dot b0');
  close(stateApi.abUnionAValues(shared)[1], 0.6, 'shared dot a1');

  const split = stateApi.createDefaultAbUnionState();
  split.edgeDots[0] = { left: 0.2, right: 0.8, split: true };
  assert.ok(stateApi.setAbUnionDotValue(split, { edge: 0, role: 'left' }, 0.35));
  close(split.edgeDots[0].right, 0.8, 'split right endpoint stays fixed');
  stateApi.setAbUnionLock(split, 'b', 0, true);
  stateApi.setAbUnionLock(split, 'b', 2, true);
  assert.ok(stateApi.setAbUnionDotValue(split, { edge: 2, role: 'shared' }, 0.45));
  close(stateApi.abUnionBValues(split)[0], 0.45, 'same-value lock propagates');
  close(stateApi.abUnionBValues(split)[2], 0.45, 'dragged locked value');

  const sums = stateApi.createDefaultAbUnionState();
  stateApi.setAbUnionSumConstraint(sums, 0, 'current', 0);
  assert.ok(stateApi.setAbUnionDotValue(sums, { edge: 0, role: 'shared' }, 0.4));
  close(stateApi.abUnionAValues(sums)[0] + stateApi.abUnionBValues(sums)[0], 1, 'fixed sum survives drag');
  stateApi.setAbUnionSumConstraint(sums, 0, 'one-plus-delta', 0.05);
  close(stateApi.abUnionAValues(sums)[0] + stateApi.abUnionBValues(sums)[0], 1.05, 'delta sum');
  stateApi.refreshAbUnionDeltaConstraints(sums, 0.08);
  close(stateApi.abUnionAValues(sums)[0] + stateApi.abUnionBValues(sums)[0], 1.08, 'updated delta sum');

  const conflict = stateApi.createDefaultAbUnionState();
  for (let index = 0; index < 6; index++) {
    stateApi.setAbUnionLock(conflict, 'a', index, true);
    stateApi.setAbUnionLock(conflict, 'b', index, true);
  }
  const previousDots = structuredClone(conflict.edgeDots);
  stateApi.setAbUnionSumConstraint(conflict, 0, 'one-plus-delta', 0.1);
  assert.equal(conflict.fixedSums[0], null, 'infeasible fixed sum is rejected');
  assert.equal(conflict.sumConstraintModes[0], 'none', 'rejected constraint restores mode');
  assert.deepEqual(conflict.edgeDots, previousDots, 'rejected constraint preserves positions');
  assert.match(conflict.status, /conflict/);

  const marked = stateApi.createDefaultAbUnionState();
  marked.labels = [{
    id: 'S1', name: 'S1', mode: 'static',
    first: { kind: 'hex-edge', index: 0 },
    second: { kind: 'center-triangle-edge', index: 0 },
    point: { x: 0.8, y: Math.sqrt(3) / 5 },
  }];
  stateApi.setAbUnionCoincidenceLock(marked, 'S1', 0, 'shared', true);
  close(stateApi.abUnionBValues(marked)[0], 0.4, 'static label anchors edge dot');
  assert.equal(marked.coincidenceLocks.length, 1);
  stateApi.deleteAbUnionLabel(marked, 'S1');
  assert.equal(marked.labels.length, 0);
  assert.equal(marked.coincidenceLocks.length, 0, 'deleting label removes its lock');
  marked.fMarks = [{ id: 'F1', point: { x: 0, y: 0 } }, { id: 'F2', point: { x: 0.1, y: 0 } }];
  marked.selectedFMarkId = 'F1';
  stateApi.deleteSelectedAbUnionFMark(marked);
  assert.deepEqual(marked.fMarks.map((mark) => mark.id), ['F2']);
  stateApi.clearAbUnionFMarks(marked);
  assert.equal(marked.fMarks.length, 0);

  shared.thetaOptimizationPending = false;
  shared.lastOptimized = { theta: 0.2, L: 1 };
  stateApi.requestAbUnionThetaOptimization(shared);
  assert.equal(shared.thetaOptimizationPending, true);
  assert.equal(shared.lastOptimized, null);
  console.log(JSON.stringify({ status: 'PASS', geometryDigest, geometryCases: parameters.length, stateCases: 6 }));
} finally {
  await server.close();
}
