import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { hmr: false, middlewareMode: true, ws: false },
});

try {
  const { parseControllerSnapshot, formatControllerSnapshot } = await server.ssrLoadModule('/src/app/controllerSnapshot.ts');
  const { parseFreeSnapshot, formatFreeSnapshot } = await server.ssrLoadModule('/src/modes/free/snapshot.ts');
  const { createDefaultFreeState, createDefaultTargetTPoints } = await server.ssrLoadModule('/src/freeGeometry.ts');
  const { CORE_CASE_POINT_IDS } = await server.ssrLoadModule('/src/coreCase.ts');
  const { createDefaultStrategy3State, sanitizeStrategy3State, strategy3EdgeDots } = await server.ssrLoadModule('/src/strategy3/state.ts');
  const controller = {
    version: 8,
    shapeMode: 'triangle',
    graphMode: 'composition',
    startValue: 0.25,
    singleParameter: 0.5,
    triangleState: { position: { x: 0, y: 0 }, angle: 0, controlPoint: { x: 0, y: 0 } },
    manualLocalCs: Array(6).fill(0.5),
    selectedHalfDiagonalIndices: [],
    admissibleSource: 'return true;',
    coreGraphSampleRate: 'medium',
    coreGraphDenseSpecialCurveSampling: false,
    coreGraphSpecialCurveNeighborhoodOnly: false,
  };
  const readController = (overrides = {}) => parseControllerSnapshot(JSON.stringify({ ...controller, ...overrides }));
  const defaultController = readController();
  assert.equal(defaultController.version, 11);
  assert.equal(defaultController.strictEpsUpperBound, 0.0001);
  assert.equal(defaultController.strictEps, 0);
  assert.equal(defaultController.ceDirection, 'ccw');
  assert.equal(defaultController.selectedPointSeedId, null);
  assert.deepEqual(defaultController.coreCaseIntervalPointFractions, Array(6).fill(0.5));
  for (const key of ['strictCheckEnabled', 'showCoverOverlay', 'coreCaseAlgorithm2Diagonals',
    'coreCaseStrictTwoLineSuperset', 'coreCaseRelaxedPPoints']) {
    assert.equal(defaultController[key], false, `${key} defaults to false`);
  }
  const defaultModes = createDefaultStrategy3State();
  assert.equal(defaultController.strategy3.f.showDisk, true);
  assert.equal(defaultModes.f.pointConstruction, 'newton', 'new F sessions default to Newton');
  assert.equal(defaultController.strategy3.f.pointConstruction, 'frontier', 'legacy sessions retain the exact frontier');
  assert.equal(defaultController.strategy3.bc.layout, 'seven');
  assert.equal(defaultController.strategy3.d.layout, 'seven');
  assert.deepEqual(defaultController.strategy3.bc, defaultModes.bc);
  assert.deepEqual(defaultController.strategy3.d, defaultModes.d);
  assert.notEqual(defaultModes.bc.layouts.seven, defaultModes.bc.layouts.eight);
  assert.notEqual(defaultModes.bc.layouts.seven, defaultModes.d.layouts.seven);
  for (const version of [8, 9, 10, 11]) {
    for (const shapeMode of ['triangle', 'circle', 'local-c', 'free', 'ab-union', 'ab-hull-debug',
      'max-area', 'area-conj', 'core-case', 'strategy3-bc', 'strategy3-d',
      version < 11 ? 'core-graph' : 'strategy3-f']) {
      const snapshot = readController({ version, shapeMode });
      assert.equal(snapshot.shapeMode, shapeMode === 'core-graph' ? 'strategy3-f' : shapeMode);
      for (const mode of ['bc', 'd', 'f']) {
        assert.deepEqual(snapshot.strategy3[mode].regionVisible, Array(6).fill(true));
      }
      assert.deepEqual(parseControllerSnapshot(formatControllerSnapshot(snapshot)), snapshot);
    }
  }
  const seeds = [
    { id: 'Q1', point: { x: 0.1, y: 0.2 } },
    { id: 'Q1', point: { x: 0.2, y: 0.1 } },
    { id: 'outside', point: { x: 10, y: 10 } },
    { id: 'bad', point: { x: '0', y: 0 } },
  ];
  const normalized = readController({
    startValue: -2, singleParameter: 4, manualLocalCs: [-1, 0, 0.2, 0.8, 1, 3],
    selectedHalfDiagonalIndices: [5, 0, 5], strictEps: 1, strictEpsUpperBound: 0.002,
    ceStartOverrides: { below: -1, above: 3, valid: 0.25, invalid: '0.5' },
    pointSeeds: seeds, selectedPointSeedId: 'outside',
    coreCaseEnabledPointIds: [CORE_CASE_POINT_IDS[0]],
    coreGraphDisabledPointIds: [CORE_CASE_POINT_IDS[0], CORE_CASE_POINT_IDS[0], 'I0', 'invalid'],
    coreCaseIntervalPointFractions: [-1, 2, 'bad'],
  });
  assert.equal(normalized.startValue, 0);
  assert.equal(normalized.singleParameter, 1);
  assert.deepEqual(normalized.manualLocalCs, [0, 0, 0.2, 0.8, 1, 1]);
  assert.deepEqual(normalized.selectedHalfDiagonalIndices, [5, 0]);
  assert.equal(normalized.strictEps, 0.002);
  assert.equal(readController({ strictEps: -1 }).strictEps, 0);
  assert.deepEqual(normalized.ceStartOverrides, { below: 0, above: 1, valid: 0.25 });
  assert.deepEqual(normalized.pointSeeds.map((seed) => seed.id), ['Q1', 'Q1_2']);
  assert.equal(normalized.selectedPointSeedId, null);
  assert.equal(readController({ pointSeeds: seeds, selectedPointSeedId: 'Q1_2' }).selectedPointSeedId, 'Q1_2');
  assert.deepEqual(normalized.coreCaseDisabledPointIds, CORE_CASE_POINT_IDS.slice(1));
  assert.deepEqual(normalized.strategy3.f.disabledPointIds, ['Q-']);
  assert.deepEqual(normalized.coreCaseIntervalPointFractions, [0, 1, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(readController({ coreCaseDisabledPointIds: ['I0', 'I0', 'I6', 'invalid'],
    coreCaseEnabledPointIds: [] }).coreCaseDisabledPointIds, ['I0'], 'disabled IDs take precedence over legacy enabled IDs');
  for (const [key, value, message] of [
    ['version', 7, 'Unsupported snapshot version. Current version is 11.'],
    ['shapeMode', 'unknown', 'Invalid shapeMode.'],
    ['graphMode', 'unknown', 'Invalid graphMode.'],
    ['startValue', null, 'Invalid startValue.'],
    ['singleParameter', '0.5', 'Invalid singleParameter.'],
    ['triangleState', null, 'Invalid triangleState.'],
    ['triangleState', { ...controller.triangleState, position: { x: null, y: 0 } }, 'Invalid triangleState points.'],
    ['triangleState', { ...controller.triangleState, angle: '0' }, 'Invalid triangleState angle.'],
    ['manualLocalCs', [], 'manualLocalCs must be an array of length 6.'],
    ['manualLocalCs', [0, 0, 0, 0, 0, null], 'manualLocalCs must contain only finite numbers.'],
    ['selectedHalfDiagonalIndices', null, 'selectedHalfDiagonalIndices must be an array.'],
    ['selectedHalfDiagonalIndices', [6], 'selectedHalfDiagonalIndices must contain integers from 0 to 5.'],
    ['admissibleSource', null, 'Invalid admissibleSource.'],
    ['strictEps', null, 'Invalid strictEps.'],
    ['strictEpsUpperBound', 0, 'Invalid strictEpsUpperBound.'],
    ['ceDirection', 'unknown', 'Invalid ceDirection.'],
    ['ce2SelectedIntervalIndex', 2, 'Invalid ce2SelectedIntervalIndex.'],
    ['ceStartOverrides', [], 'Invalid ceStartOverrides.'],
  ]) assert.throws(() => readController({ [key]: value }), { message });

  const modeState = createDefaultStrategy3State();
  modeState.bc.layout = 'eight';
  modeState.bc.layouts.eight[0] = { left: 0.35, right: 0.35, split: true };
  modeState.bc.disabledPointIds = ['D2'];
  modeState.bc.regionVisible[0] = false;
  modeState.d.regionVisible[1] = false;
  modeState.f.regionVisible[4] = false;
  modeState.d.layouts.seven[0] = { left: 0.44, right: 0.44, split: false };
  modeState.f.edgeDots[3] = { left: 0.2, right: 0.2, split: false };
  modeState.f.disabledPointIds = ['Q-', 'D5'];
  modeState.f.showDisk = false;
  const current = readController({ version: 11, shapeMode: 'strategy3-bc', strategy3: modeState });
  assert.deepEqual(current.strategy3, modeState);
  for (const construction of ['frontier', 'newton']) {
    const selected = structuredClone(modeState);
    selected.f.pointConstruction = construction;
    const roundTrip = readController({ version: 11, shapeMode: 'strategy3-f', strategy3: selected });
    assert.deepEqual(parseControllerSnapshot(formatControllerSnapshot(roundTrip)).strategy3, selected, 'construction and selections survive save/load');
  }
  const withoutConstruction = structuredClone(modeState);
  delete withoutConstruction.f.pointConstruction;
  assert.equal(readController({ version: 11, strategy3: withoutConstruction }).strategy3.f.pointConstruction, 'frontier', 'earlier version-11 snapshots retain their plotted points');
  for (const invalid of [null, 'unknown', true, 0]) {
    const malformed = structuredClone(modeState);
    malformed.f.pointConstruction = invalid;
    assert.throws(() => readController({ version: 11, strategy3: malformed }), { message: 'Invalid Strategy 3 point construction.' });
  }
  assert.deepEqual(parseControllerSnapshot(formatControllerSnapshot(current)), current);
  assert.ok(!Object.keys(current).some((key) => key.startsWith('coreGraph')));
  assert.throws(() => readController({ version: 11, shapeMode: 'core-graph' }), { message: 'Invalid shapeMode.' });
  assert.equal(strategy3EdgeDots(modeState, 'bc'), modeState.bc.layouts.eight);
  assert.equal(strategy3EdgeDots(modeState, 'd'), modeState.d.layouts.seven);
  assert.equal(strategy3EdgeDots(modeState, 'f'), modeState.f.edgeDots);
  modeState.bc.layout = 'seven';
  assert.equal(modeState.bc.regionVisible[0], false, 'region visibility persists across layouts');
  assert.equal(modeState.d.regionVisible[0], true, 'region visibility is independent across modes');
  assert.equal(modeState.f.regionVisible[0], true);
  assert.deepEqual(strategy3EdgeDots(modeState, 'bc'), defaultModes.bc.layouts.seven);
  modeState.bc.layout = 'eight';
  assert.equal(strategy3EdgeDots(modeState, 'bc')[0].left, 0.35);
  const clonedState = sanitizeStrategy3State(modeState);
  clonedState.bc.layouts.eight[0].left = 0.1;
  clonedState.bc.regionVisible[0] = true;
  assert.equal(modeState.bc.regionVisible[0], false, 'visibility sanitization must not alias its input');
  assert.equal(modeState.bc.layouts.eight[0].left, 0.35, 'sanitization must not alias its input');
  assert.equal(modeState.bc.layouts.seven[0].left, 0.35, 'layouts must not alias one another');
  for (const mode of ['bc', 'd']) {
    for (const layout of ['seven', 'eight']) {
      assert.equal(defaultModes[mode].layouts[layout].reduce((count, edge) => count + (edge.split ? 2 : 1), 0),
        layout === 'seven' ? 7 : 8);
    }
  }
  assert.equal(defaultModes.f.edgeDots.filter((edge) => !edge.split).length, 6);
  const earlierV11 = structuredClone(modeState);
  for (const mode of ['bc', 'd', 'f']) delete earlierV11[mode].regionVisible;
  const upgradedV11 = readController({ version: 11, strategy3: earlierV11 });
  assert.equal(upgradedV11.version, 11);
  for (const mode of ['bc', 'd', 'f']) {
    assert.deepEqual(upgradedV11.strategy3[mode].regionVisible, Array(6).fill(true));
    assert.deepEqual(upgradedV11.strategy3[mode].disabledPointIds, modeState[mode].disabledPointIds);
    for (const invalid of [null, [], Array(5).fill(true), Array(7).fill(true),
      [true, true, true, true, true, 'false'], [true, true, true, true, true, 0]]) {
      const malformed = createDefaultStrategy3State();
      malformed[mode].regionVisible = invalid;
      assert.throws(() => readController({ version: 11, strategy3: malformed }),
        { message: 'Invalid Strategy 3 region visibility; expected six booleans.' });
    }
  }

  for (const version of [8, 9, 10]) {
    const migrated = readController({ version, shapeMode: 'core-graph', coreGraphA: 0.8, coreGraphB: 0.25,
      coreGraphShowDisk: false,
      coreGraphDisabledPointIds: version < 10 ? ['P3', 'P4', 'P5', 'D0', 'D1', 'D2', 'invalid'] : ['Q-', 'D5', 'Q-', 'P3', 'invalid'],
      coreGraphSampleRate: 'retired', coreGraphSliceK: 'retired', coreGraphStrictTwoLineSuperset: 'retired' });
    assert.equal(migrated.shapeMode, 'strategy3-f');
    assert.deepEqual(migrated.strategy3.f.disabledPointIds,
      version < 10 ? ['Q-', 'Q0', 'Q+', 'D0', 'D1', 'D2'] : ['Q-', 'D5']);
    assert.equal(migrated.strategy3.f.showDisk, false);
    assert.equal(migrated.strategy3.f.pointConstruction, 'frontier');
    assert.ok(Math.abs(1 - migrated.strategy3.f.edgeDots[3].left - 0.8) < 1e-12);
    assert.equal(migrated.strategy3.f.edgeDots[4].left, 0.25);
    for (const [step, edge] of [4, 5, 0, 1, 2, 3].entries()) {
      assert.ok(Math.abs(migrated.strategy3.f.edgeDots[edge].left - (0.25 - 0.01 * step)) < 1e-12);
    }
    assert.ok(!Object.keys(migrated).some((key) => key.startsWith('coreGraph')));
  }
  const migratedConstruction = readController({ version: 10, strategy3: {
    bc: { source: 'triangles', parameters: { left: 0.1, right: 0.2, radial: [0.3, 0.4, 0.5] }, disabledPointIds: ['G0', 'G0', 'D2'] },
    d: { source: 'parameters', parameters: { a: 0.1, beta: 0.4, epsilon: 0.5 }, disabledPointIds: ['PT'] },
  } });
  assert.deepEqual(migratedConstruction.strategy3.bc.layouts, defaultModes.bc.layouts);
  assert.deepEqual(migratedConstruction.strategy3.d.layouts, defaultModes.d.layouts);
  assert.deepEqual(migratedConstruction.strategy3.bc.disabledPointIds, ['G0', 'D2']);
  assert.deepEqual(migratedConstruction.strategy3.d.disabledPointIds, ['PT']);
  for (const values of [{ coreGraphA: -0.1, coreGraphB: 1.1 }, { coreGraphA: 1.1 }, { coreGraphB: -0.1 }]) {
    assert.deepEqual(readController({ version: 10, ...values }).strategy3.f.edgeDots, defaultModes.f.edgeDots);
  }
  for (const [key, value] of [['coreGraphA', null], ['coreGraphB', '0.5'], ['coreGraphShowDisk', 'true']]) {
    assert.throws(() => readController({ version: 10, [key]: value }), { message: `Invalid ${key}.` });
  }
  // Invalid case inequalities remain editable; only boundary coordinates/topology are structural constraints.
  const invalidCase = createDefaultStrategy3State();
  invalidCase.bc.layouts.seven[1] = { left: 1, right: 1, split: false };
  assert.deepEqual(sanitizeStrategy3State(invalidCase), invalidCase);
  const malformedStates = [null, { bc: { ...modeState.bc, layout: 'unknown' } },
    { f: { ...modeState.f, showDisk: 'true' } },
    { d: { ...modeState.d, disabledPointIds: ['D5'] } }];
  for (const mutate of [
    (state) => { state.bc.layouts.seven = []; },
    (state) => { state.bc.layouts.seven[0].left = null; },
    (state) => { state.bc.layouts.seven[0].left = -0.1; },
    (state) => { state.bc.layouts.seven[0].right = 1.1; },
    (state) => { state.bc.layouts.seven[0].split = false; },
    (state) => { state.bc.layouts.seven[0].left = 0.9; },
    (state) => { state.bc.layouts.seven[1].right = 0.8; },
    (state) => { state.d.layouts.seven[0].split = true; },
    (state) => { state.d.layouts.eight[5].split = false; },
    (state) => { state.f.edgeDots[0].split = true; },
    (state) => { state.f.edgeDots = Array(5).fill(state.f.edgeDots[0]); },
  ]) {
    const malformed = createDefaultStrategy3State();
    mutate(malformed);
    malformedStates.push(malformed);
  }
  for (const strategy3 of malformedStates) {
    assert.throws(() => readController({ version: 11, strategy3 }));
  }
  for (const strategy3 of [null, { bc: null }, { d: [] }]) {
    assert.throws(() => readController({ version: 10, strategy3 }));
  }
  for (const key of ['strictCheckEnabled', 'showCoverOverlay', 'coreCaseAlgorithm2Diagonals',
    'coreCaseStrictTwoLineSuperset', 'coreCaseRelaxedPPoints']) {
    assert.throws(() => readController({ [key]: 'true' }), { message: `Invalid ${key}.` });
  }

  const defaults = createDefaultFreeState();
  const readFree = (overrides = {}) => parseFreeSnapshot(JSON.stringify({ version: 8, triangles: defaults.triangles, ...overrides }));
  for (let version = 1; version <= 8; version++) {
    const snapshot = readFree({ version });
    const saved = JSON.parse(formatFreeSnapshot(snapshot));
    assert.equal(saved.version, 8);
    assert.deepEqual(parseFreeSnapshot(JSON.stringify(saved)), { ...snapshot, version: 8 });
    assert.deepEqual(snapshot.targetTPoints, createDefaultTargetTPoints());
    assert.deepEqual(snapshot.sampling, { v: [], c: [], rejected: [] });
  }
  assert.equal(readFree({ version: 1, target: 'LOTUS' }).target, defaults.target);
  assert.equal(readFree({ version: 2, target: 'LOTUS' }).target, 'LOTUS');
  const legacyFree = readFree({ version: 1, targetT: 2, targetTFixed: true });
  assert.deepEqual(legacyFree.targetTPoints, [{ id: 't1', t: 1, fixed: true }]);
  assert.ok(!('targetT' in legacyFree) && !('targetTFixed' in legacyFree));
  const triangles = structuredClone(defaults.triangles);
  triangles[1].edgePointConstraint = { edgeIndex: 0, point: { kind: 'P', targetTId: 'missing', index: 1 } };
  triangles[1].vd0.rawSources = { a: { kind: 'P', index: 0 }, b: { kind: 'P', targetTId: 'chosen_2', index: 2 } };
  const free = readFree({
    triangles, cForm: 'c-union', tool: 'sample', selectedTriangleId: 'C',
    selectedSegments: [{ kind: 'hex-edge', index: 0 }], pointSeeds: seeds, selectedPointSeedId: 'Q1',
    targetTPoints: [{ id: 'chosen', t: -1, fixed: true }, { id: 'chosen', t: 2 }, { id: 'bad', t: '0' }],
  });
  assert.equal(free.tool, 'move');
  assert.equal(free.selectedTriangleId, 'V4');
  assert.deepEqual(free.selectedSegments, []);
  assert.deepEqual(free.pointSeeds, normalized.pointSeeds);
  assert.equal(free.selectedPointSeedId, 'Q1');
  assert.deepEqual(free.targetTPoints, [{ id: 'chosen', t: 0, fixed: true }, { id: 'chosen_2', t: 1, fixed: false }]);
  assert.equal(free.triangles[1].edgePointConstraint.point.targetTId, 'chosen');
  assert.equal(free.triangles[1].vd0.rawSources.a.targetTId, 'chosen');
  assert.equal(free.triangles[1].vd0.rawSources.b.targetTId, 'chosen_2');
  const boundaryLabel = {
    id: 'D1', name: 'D1', mode: 'dynamic', point: null,
    first: { kind: 'c-union-boundary', index: 0, anchorPoint: { x: 'bad', y: 0 } },
    second: { kind: 'half-diagonal', index: 4 },
  };
  assert.ok(!('anchorPoint' in readFree({ labels: [boundaryLabel] }).labels[0].first));
  assert.throws(() => readFree({ labels: [{ ...boundaryLabel, second: { kind: 'triangle-edge', triangleId: 'C', index: 0 } }] }),
    { message: 'Invalid free snapshot labels.' });
  const sampling = {
    v: [{ kind: 'v', caseId: 'v0', label: 'V0', a: 0.2, b: 0.3 }, { kind: 'invalid' }],
    c: [{ kind: 'c', caseId: 'ce1-m0', label: 'C', edge01: { start: 0, end: 1 } },
      { kind: 'c', caseId: 'ce2-m0', label: 'C', edge01: { start: 0, end: 1 } }],
    rejected: [{ triangleId: 'V0', reason: 'outside' }, { triangleId: 'V1', reason: 'outside' }],
  };
  assert.deepEqual(readFree({ version: 3, sampling }).sampling, { v: [], c: [], rejected: [] });
  assert.deepEqual(readFree({ version: 4, sampling }).sampling,
    { v: [sampling.v[0]], c: [sampling.c[0]], rejected: [sampling.rejected[0]] });
  for (const [key, value, suffix] of [
    ['version', 9, ''], ['triangles', [], ''], ['target', 'unknown', ' target'],
    ['tool', 'unknown', ' tool'], ['cForm', 'unknown', ' C form'],
    ['cUnionCeFilter', 'unknown', ' Cunion filter'], ['targetT', null, ' t'],
    ['targetTFixed', 'true', ' targetTFixed'], ['labels', {}, ' labels'], ['labels', [null], ' labels'],
  ]) assert.throws(() => readFree({ [key]: value }), { message: `Invalid free snapshot${suffix}.` });
  assert.throws(() => parseControllerSnapshot('{'), SyntaxError);
  assert.throws(() => parseFreeSnapshot('{'), SyntaxError);
  console.log('PASS: controller v8–11 and Free v1–8 snapshots, Strategy 3 boundary layouts, legacy migration, normalization, and rejection checks');
} finally {
  await server.close();
}
