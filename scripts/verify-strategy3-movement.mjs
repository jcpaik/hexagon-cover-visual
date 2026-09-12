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
  const { checkStrategy3Feasibility: check, projectStrategy3Move: move } = await server.ssrLoadModule('/src/strategy3/feasibility.ts');
  const { strategy3BoundaryInputs } = await server.ssrLoadModule('/src/strategy3/boundary.ts');
  const { isRestrictedAbSource } = await server.ssrLoadModule('/src/ab-union/feasibility.ts');
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
  console.log(`Strategy 3 movement passed: all five presets, ${checkedMoves} validated moves, fixed-other-dot stopping, coupled chains/tail/common pair, strict margins, source certificates, and no enclosure fits.`);
} finally {
  await server.close();
}
