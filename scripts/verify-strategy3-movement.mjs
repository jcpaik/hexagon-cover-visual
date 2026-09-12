import assert from 'node:assert/strict';
import ts from 'typescript';
import { createServer } from 'vite';

let fitTrapInstalled = false;
const server = await createServer({
  appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
  plugins: [{
    name: 'forbid-movement-enclosure-fits', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/cover.ts')) return;
      const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
      const fit = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'fitTriangle');
      assert.ok(fit?.body, 'find enclosure fitter for movement instrumentation');
      const position = fit.body.getStart(ast) + 1;
      fitTrapInstalled = true;
      return code.slice(0, position) + '\nthrow new Error("Enclosure fitting is forbidden during movement checks");\n' + code.slice(position);
    },
  }],
});

const close = (actual, expected, label, tolerance = 1e-9) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`,
);
const copy = (dots) => dots.map((edge) => ({ ...edge }));
const setDot = (dots, dot, value) => {
  const next = copy(dots);
  if (dot.role === 'shared') next[dot.edge].left = next[dot.edge].right = value;
  else next[dot.edge][dot.role] = value;
  return next;
};

try {
  const { createDefaultStrategy3State } = await server.ssrLoadModule('/src/strategy3/state.ts');
  const { checkStrategy3Feasibility: check, projectStrategy3Move: move, projectStrategy3SumChange: activate, STRATEGY3_SUM_TOLERANCE } = await server.ssrLoadModule('/src/strategy3/feasibility.ts');
  const { strategy3BoundaryInputs } = await server.ssrLoadModule('/src/strategy3/boundary.ts');
  const { isRestrictedAbSource } = await server.ssrLoadModule('/src/ab-union/feasibility.ts');
  const { createDefaultAbUnionState } = await server.ssrLoadModule('/src/ab-union/state.ts');
  const { renderAbUnionBoundaryControls } = await server.ssrLoadModule('/src/ab-union/render.ts');
  const { buildBC, DEFAULT_BC_PARAMETERS, constructNinePoint } = await server.ssrLoadModule('/src/strategy3/geometry.ts');
  assert.ok(fitTrapInstalled);
  assert.throws(() => buildBC(DEFAULT_BC_PARAMETERS), /Enclosure fitting is forbidden/, 'the trap rejects a full evaluator');
  const state = createDefaultStrategy3State();
  const fixtures = [
    ['bc', 'seven', state.bc.layouts.seven], ['bc', 'eight', state.bc.layouts.eight],
    ['d', 'seven', state.d.layouts.seven], ['d', 'eight', state.d.layouts.eight],
    ['f', 'six', state.f.edgeDots],
  ];
  function validate(mode, dots, result) {
    assert.equal(result.ok, true, result.reasons.join('; '));
    assert.deepEqual(result.reasons, []);
    const { roles, sourceConditions } = strategy3BoundaryInputs(mode, dots);
    assert.ok(sourceConditions.every((condition) => condition.ok));
    assert.equal(result.sources.length, 6);
    roles.forEach((role, index) => assert.ok(result.sources[index] && isRestrictedAbSource(role, result.sources[index]), `V${index} source matches the accepted boundary coordinates`));
    if (mode === 'f') {
      for (const construction of ['frontier', 'newton']) {
        assert.ok(constructNinePoint(roles[4].a, roles[4].b, undefined, construction).points.every((point) => point.point !== null));
      }
    }
  }
  for (const [mode, layout, dots] of fixtures) {
    const feasibility = check(mode, dots);
    validate(mode, dots, feasibility);
    assert.strictEqual(check(mode, copy(dots)), feasibility, `${mode}/${layout} caches coordinate-equivalent input`);
  }

  const nearEndpoint = move('bc', state.bc.layouts.seven, { edge: 0, role: 'left' }, 1e-8, 'stop');
  assert.equal(nearEndpoint.acceptedValue, 1e-8, 'a valid strict endpoint below legacy AB snapping tolerance is accepted');
  validate('bc', nearEndpoint.edgeDots, nearEndpoint.feasibility);
  const boundaryAdapter = createDefaultAbUnionState();
  boundaryAdapter.edgeDots = nearEndpoint.edgeDots;
  boundaryAdapter.fMarks = [
    { id: 'F1', point: { x: 0, y: 0 } },
    { id: 'F2', point: { x: 0.1, y: 0 } },
    { id: 'F3', point: { x: 0, y: 0.1 } },
  ];
  const beforeDrawing = structuredClone(boundaryAdapter);
  const drawingContext = {
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillText() {},
  };
  const boundaryReadouts = renderAbUnionBoundaryControls(drawingContext, boundaryAdapter, { readOnly: true, showFMarkTriangle: false });
  assert.deepEqual(boundaryAdapter, beforeDrawing, 'draw-only boundary controls cannot normalize or mutate Strategy 3 state');
  assert.equal(boundaryReadouts.edgeRows[0].left, 1e-8, 'draw-only readouts preserve the unsnapped position');
  assert.equal(boundaryReadouts.fMarkTriangleSide, null, 'boundary drawing does not fit a triangle even with three marks');
  validate('bc', boundaryAdapter.edgeDots, check('bc', boundaryAdapter.edgeDots));

  const stop = move('bc', state.bc.layouts.seven, { edge: 3, role: 'shared' }, 0.7, 'stop');
  validate('bc', stop.edgeDots, stop.feasibility);
  close(stop.acceptedValue, 0.555, 'stop refines the nonsupercritical boundary to 1e-6', 1e-6);
  assert.equal(stop.adjustedNeighbors, 0);
  assert.ok(stop.blockedReason);
  const coupled = move('bc', state.bc.layouts.seven, { edge: 3, role: 'shared' }, 0.7, 'adjust-neighbors');
  close(coupled.acceptedValue, 0.7, 'coupled BC move reaches target');
  assert.equal(coupled.adjustedNeighbors, 3);
  close(coupled.edgeDots[0].left, 0.35, 'opposite gap endpoint is unaffected');
  for (const index of [0, 1, 2, 3]) close(coupled.edgeDots[index].right, 0.7, 'nonsupercritical chain propagates around edges');
  assert.equal(coupled.blockedReason, null);
  validate('bc', coupled.edgeDots, coupled.feasibility);

  const tail = move('bc', state.bc.layouts.eight, { edge: 5, role: 'left' }, 0.18, 'adjust-neighbors');
  close(tail.acceptedValue, 0.18, 'tail target accepted');
  close(tail.edgeDots[0].left, 0.36, 'BC tail propagates b0 <= 2b5');
  close(tail.edgeDots[5].right, 0.5, 'two gap endpoints retain independent degrees of freedom');
  assert.equal(tail.adjustedNeighbors, 1);
  validate('bc', tail.edgeDots, tail.feasibility);
  const singleton = move('bc', state.bc.layouts.eight, { edge: 0, role: 'left' }, 0.58, 'stop');
  close(singleton.acceptedValue, 0.58, 'singleton gap accepted');
  assert.equal(singleton.edgeDots[0].split, true);
  assert.equal(singleton.edgeDots[0].left, singleton.edgeDots[0].right);
  const separated = move('bc', singleton.edgeDots, { edge: 0, role: 'left' }, 0.57, 'stop');
  close(separated.edgeDots[0].right, 0.58, 'singleton endpoints can separate again');
  close(separated.edgeDots[0].left, 0.57, 'only selected singleton endpoint moves');

  const d = move('d', state.d.layouts.seven, { edge: 2, role: 'shared' }, 0.5, 'adjust-neighbors');
  validate('d', d.edgeDots, d.feasibility);
  assert.ok(d.acceptedValue > 0.41 && d.acceptedValue < 0.5, 'D moves past the linear handoff then stops at a nonlinear bound');
  assert.equal(d.adjustedNeighbors, 1);
  assert.ok(d.blockedReason);
  close(d.edgeDots[1].left, d.acceptedValue, 'D neighbor follows the requested edge');
  const midpoint = move('d', state.d.layouts.eight, { edge: 0, role: 'left' }, 0.25, 'stop');
  validate('d', midpoint.edgeDots, midpoint.feasibility);
  assert.ok(midpoint.acceptedValue > 0.65 && midpoint.acceptedValue < 0.650002, 'D stops at the source midpoint-supplier boundary');
  assert.match(midpoint.blockedReason, /V0/);

  const f = move('f', state.f.edgeDots, { edge: 0, role: 'shared' }, 0.6, 'adjust-neighbors');
  close(f.acceptedValue, 0.6, 'F coupled move reaches target');
  assert.equal(f.adjustedNeighbors, 2);
  close(f.edgeDots[4].left, 0.6, 'F common-pair upper reach follows');
  close(f.edgeDots[5].left, 0.6, 'F handoff chain follows across the index wrap');
  validate('f', f.edgeDots, f.feasibility);
  const fLower = move('f', state.f.edgeDots, { edge: 3, role: 'shared' }, 0.59, 'adjust-neighbors');
  validate('f', fLower.edgeDots, fLower.feasibility);
  close(fLower.acceptedValue, 0.59, 'F common-pair lower reach moves');
  assert.equal(fLower.adjustedNeighbors, 5);
  assert.ok(fLower.edgeDots[4].left > fLower.edgeDots[3].right, 'strict critical gap survives propagation');

  function fDots(a, b) {
    const dots = copy(state.f.edgeDots);
    [4, 5, 0, 1, 2, 3].forEach((index, step) => { dots[index].left = dots[index].right = b + (1 - a - b) * step / 5; });
    return dots;
  }
  for (const dots of [fDots(0.55, 0.4500000005), fDots(0.55, (-0.55 + Math.sqrt(4 - 3 * 0.55 ** 2)) / 2)]) {
    const result = check('f', dots);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((reason) => reason.includes('1e-9 margin inside')));
  }
  const invalid = setDot(state.bc.layouts.seven, { edge: 2, role: 'shared' }, 0);
  assert.equal(check('bc', invalid).ok, false);
  const blockedInitial = move('bc', invalid, { edge: 2, role: 'shared' }, 0.5, 'adjust-neighbors');
  assert.deepEqual(blockedInitial.edgeDots, invalid, 'an invalid imported/free state is not silently repaired');
  assert.equal(blockedInitial.changed, false);
  assert.ok(blockedInitial.blockedReason);
  for (const bad of [NaN, Infinity]) {
    const result = move('f', state.f.edgeDots, { edge: 0, role: 'shared' }, bad, 'stop');
    assert.deepEqual(result.edgeDots, state.f.edgeDots);
    assert.equal(result.changed, false);
    assert.ok(result.blockedReason);
  }

  const targets = (...entries) => {
    const sums = Array(6).fill(null);
    entries.forEach(([index, value]) => { sums[index] = value; });
    return sums;
  };
  const currentSums = (dots) => dots.map((edge, index) => 1 - dots[(index + 5) % 6].right + edge.left);
  function validateLocks(mode, dots, sums, feasibility) {
    validate(mode, dots, feasibility);
    assert.ok(check(mode, dots, sums).ok);
    const actual = currentSums(dots);
    sums.forEach((sum, index) => { if (sum !== null) close(actual[index], sum, `locked row ${index}`, STRATEGY3_SUM_TOLERANCE); });
  }
  const bcDots = state.bc.layouts.seven;
  const baseGeometry = check('bc', bcDots);
  assert.equal(check('bc', bcDots, targets([3, 1])).ok, false, 'geometry alone does not satisfy a new lock');
  assert.strictEqual(check('bc', bcDots), baseGeometry, 'a lock mismatch cannot contaminate the geometry cache');
  const frozenTargets = targets([3, currentSums(bcDots)[3]]);
  const frozen = activate('bc', bcDots, frozenTargets);
  assert.ok(frozen.ok);
  assert.deepEqual(frozen.edgeDots, bcDots, 'freezing a current sum does not move handles');
  const frozenMove = move('bc', frozen.edgeDots, { edge: 3, role: 'shared' }, 0.53, 'stop', frozenTargets);
  validateLocks('bc', frozenMove.edgeDots, frozenTargets, frozenMove.feasibility);
  close(frozenMove.acceptedValue, 0.53, 'current lock allows linked movement');
  close(frozenMove.edgeDots[2].left - frozen.edgeDots[2].left, 0.025, 'current lock partner follows by the same displacement');
  assert.equal(frozenMove.adjustedNeighbors, 1);
  for (const index of [0, 1, 4, 5]) assert.deepEqual(frozenMove.edgeDots[index], bcDots[index], 'Stop leaves unrelated equality components fixed');
  close(frozenTargets[3], currentSums(bcDots)[3], 'current target is not recaptured during dragging');

  const oneTargets = targets([3, 1]);
  const one = activate('bc', bcDots, oneTargets);
  assert.ok(one.ok);
  close(one.edgeDots[2].left, 0.53, 'activation chooses balanced nearest-current handles');
  close(one.edgeDots[3].left, 0.53, 'activation applies exact one');
  validateLocks('bc', one.edgeDots, oneTargets, one.feasibility);
  assert.deepEqual(activate('bc', bcDots, oneTargets).edgeDots, one.edgeDots, 'activation is deterministic');
  const oneStop = move('bc', one.edgeDots, { edge: 3, role: 'shared' }, 0.7, 'stop', oneTargets);
  close(oneStop.acceptedValue, bcDots[1].left, 'linked Stop clamps at the next unrelated component', 1e-6);
  assert.equal(oneStop.adjustedNeighbors, 1);
  assert.deepEqual(oneStop.edgeDots[1], bcDots[1]);
  validateLocks('bc', oneStop.edgeDots, oneTargets, oneStop.feasibility);
  const onePush = move('bc', one.edgeDots, { edge: 3, role: 'shared' }, 0.7, 'adjust-neighbors', oneTargets);
  close(onePush.acceptedValue, 0.7, 'coupled movement may push beyond the linked component');
  assert.ok(onePush.adjustedNeighbors > oneStop.adjustedNeighbors);
  validateLocks('bc', onePush.edgeDots, oneTargets, onePush.feasibility);

  const extraTargets = targets([2, 1], [3, 1]);
  const extra = activate('bc', one.edgeDots, extraTargets);
  assert.ok(extra.ok, extra.reason);
  validateLocks('bc', extra.edgeDots, extraTargets, extra.feasibility);
  const dOne = activate('d', state.d.layouts.seven, targets([1, 1]));
  assert.ok(dOne.ok, dOne.reason);
  validateLocks('d', dOne.edgeDots, targets([1, 1]), dOne.feasibility);
  assert.equal(strategy3BoundaryInputs('d', dOne.edgeDots).roles[1].criticality, 'supercritical', 'selected sum one does not change D actual source criticality');
  const fOne = activate('f', state.f.edgeDots, targets([4, 1]));
  assert.equal(fOne.ok, false, 'F still requires selected critical sum strictly above one');
  assert.deepEqual(fOne.edgeDots, state.f.edgeDots);
  const fEpsilon = activate('f', state.f.edgeDots, targets([4, 1.05]));
  assert.ok(fEpsilon.ok, fEpsilon.reason);
  validateLocks('f', fEpsilon.edgeDots, targets([4, 1.05]), fEpsilon.feasibility);
  const fUpdated = activate('f', fEpsilon.edgeDots, targets([4, 1.06]));
  assert.ok(fUpdated.ok, fUpdated.reason);
  validateLocks('f', fUpdated.edgeDots, targets([4, 1.06]), fUpdated.feasibility);

  const twoEpsilonRows = targets([0, 1], [3, 1]);
  const epsilonZero = activate('bc', bcDots, twoEpsilonRows);
  assert.ok(epsilonZero.ok, epsilonZero.reason);
  const savedEpsilonDots = copy(epsilonZero.edgeDots), savedTargets = [...twoEpsilonRows];
  const epsilonPositive = activate('bc', epsilonZero.edgeDots, targets([0, 1.05], [3, 1.05]));
  assert.equal(epsilonPositive.ok, false, 'epsilon change cannot override a nonsupercritical role');
  assert.deepEqual(epsilonPositive.edgeDots, savedEpsilonDots, 'failed multi-row epsilon proposal returns the entire unchanged layout');
  assert.deepEqual(epsilonZero.edgeDots, savedEpsilonDots);
  assert.deepEqual(twoEpsilonRows, savedTargets, 'target settings are caller-owned and never mutated');
  const fCycle = currentSums(state.f.edgeDots);
  fCycle[0] += 0.01;
  const inconsistent = activate('f', state.f.edgeDots, fCycle);
  assert.equal(inconsistent.ok, false, 'inconsistent equality cycle is rejected');
  assert.deepEqual(inconsistent.edgeDots, state.f.edgeDots);
  assert.match(inconsistent.reason, /conflict/);
  const localFailure = activate('d', state.d.layouts.seven, targets([0, 1]));
  assert.equal(localFailure.ok, false);
  assert.match(localFailure.reason, /No feasible adjustment found/, 'failed bounded search does not claim global impossibility');

  let lockedMoves = 0;
  for (const [mode, , dots] of fixtures) {
    const sums = currentSums(dots);
    const locked = activate(mode, dots, sums);
    assert.ok(locked.ok);
    assert.deepEqual(locked.edgeDots, dots, 'all current targets freeze without movement');
    for (const behavior of ['stop', 'adjust-neighbors']) {
      for (const value of [0.25, dots[3].left + 0.01, 0.75]) {
        const result = move(mode, dots, { edge: 3, role: 'shared' }, value, behavior, sums);
        validateLocks(mode, result.edgeDots, sums, result.feasibility);
        assert.deepEqual(result.edgeDots.map((edge) => edge.split), dots.map((edge) => edge.split));
        assert.deepEqual(sums, currentSums(dots), 'dragging preserves saved current targets');
        lockedMoves++;
      }
    }
  }

  let checkedMoves = 0;
  for (const [mode, , dots] of fixtures) {
    const original = copy(dots);
    for (let edge = 0; edge < 6; edge++) {
      for (const role of dots[edge].split ? ['left', 'right'] : ['shared']) {
        const dot = { edge, role };
        for (const target of [0, 0.25, 0.5, 0.75, 1]) {
          for (const behavior of ['stop', 'adjust-neighbors']) {
            const result = move(mode, dots, dot, target, behavior);
            validate(mode, result.edgeDots, result.feasibility);
            assert.strictEqual(check(mode, result.edgeDots), result.feasibility, 'accepted result is the current cached evaluation');
            assert.deepEqual(dots, original, 'movement does not mutate caller-owned state');
            assert.deepEqual(result.edgeDots.map((edge) => edge.split), dots.map((edge) => edge.split), 'topology is preserved');
            if (behavior === 'stop') {
              for (let index = 0; index < 6; index++) {
                if (index !== edge) assert.deepEqual(result.edgeDots[index], dots[index], 'stop fixes every other edge');
                else if (role === 'left') assert.equal(result.edgeDots[index].right, dots[index].right);
                else if (role === 'right') assert.equal(result.edgeDots[index].left, dots[index].left);
              }
            }
            checkedMoves++;
          }
        }
      }
    }
  }
  console.log(`Strategy 3 movement passed: all five presets, ${checkedMoves} unlocked and ${lockedMoves} locked moves, exact sum activation/rollback, linked Stop, coupled propagation, D/F source distinctions, source certificates, and no enclosure fits.`);
} finally {
  await server.close();
}
