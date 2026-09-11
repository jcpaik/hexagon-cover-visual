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
  assert.equal(defaultController.version, 10);
  assert.equal(defaultController.strictEpsUpperBound, 0.0001);
  assert.equal(defaultController.strictEps, 0);
  assert.equal(defaultController.ceDirection, 'ccw');
  assert.equal(defaultController.selectedPointSeedId, null);
  assert.deepEqual(defaultController.coreCaseIntervalPointFractions, Array(6).fill(0.5));
  for (const key of ['strictCheckEnabled', 'showCoverOverlay', 'coreCaseAlgorithm2Diagonals',
    'coreCaseStrictTwoLineSuperset', 'coreCaseRelaxedPPoints']) {
    assert.equal(defaultController[key], false, `${key} defaults to false`);
  }
  assert.equal(defaultController.coreGraphA, 0.55);
  assert.equal(defaultController.coreGraphB, 0.58);
  assert.equal(defaultController.coreGraphSliceK, 0);
  assert.equal(defaultController.coreGraphShowDisk, true);
  assert.equal(defaultController.strategy3.bc.source, 'parameters');
  assert.equal(defaultController.strategy3.d.source, 'parameters');
  assert.notEqual(defaultController.strategy3.bc.triangles, defaultController.strategy3.d.triangles);
  for (const version of [8, 9, 10]) {
    for (const shapeMode of ['triangle', 'circle', 'local-c', 'free', 'ab-union', 'ab-hull-debug',
      'max-area', 'area-conj', 'core-case', 'strategy3-bc', 'strategy3-d', 'core-graph']) {
      const snapshot = readController({ version, shapeMode });
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
  assert.deepEqual(normalized.coreGraphDisabledPointIds, ['Q-']);
  assert.deepEqual(normalized.coreCaseIntervalPointFractions, [0, 1, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(readController({ coreCaseDisabledPointIds: ['I0', 'I0', 'I6', 'invalid'],
    coreCaseEnabledPointIds: [] }).coreCaseDisabledPointIds, ['I0'], 'disabled IDs take precedence over legacy enabled IDs');
  for (const [key, value, message] of [
    ['version', 7, 'Unsupported snapshot version. Current version is 10.'],
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
    ['coreGraphSampleRate', 'unknown', 'Invalid coreGraphSampleRate.'],
  ]) assert.throws(() => readController({ [key]: value }), { message });

  const modeState = structuredClone(defaultController.strategy3);
  modeState.bc.source = 'triangles';
  modeState.bc.parameters = { left: 0.35, right: 0.35, radial: [0.2, 0.4, 0.6] };
  modeState.bc.triangles[0].center = { x: 0.8, y: 0.07 };
  modeState.bc.triangles[0].angle = 0.25;
  modeState.bc.selectedTriangleId = 'V3';
  modeState.d.parameters = { a: 0.1, epsilon: 0.5, beta: 0.4 };
  const current = readController({
    version: 10, shapeMode: 'strategy3-bc', strategy3: modeState,
    coreGraphA: 0.8, coreGraphB: 0.25, coreGraphSliceK: 1.25, coreGraphShowDisk: false,
    coreGraphDisabledPointIds: ['Q-', 'D5', 'Q-', 'P3', 'invalid'],
  });
  assert.deepEqual(current.strategy3, modeState);
  assert.deepEqual(current.coreGraphDisabledPointIds, ['Q-', 'D5']);
  assert.equal(current.coreGraphA, 0.8);
  assert.equal(current.coreGraphB, 0.25);
  assert.equal(current.coreGraphSliceK, 1.25);
  const outsideDomain = parseControllerSnapshot(JSON.stringify({ ...current, coreGraphA: -0.1, coreGraphB: 1.1 }));
  assert.equal(outsideDomain.coreGraphA, -0.1);
  assert.equal(outsideDomain.coreGraphB, 1.1);
  assert.equal(current.coreGraphShowDisk, false);
  assert.deepEqual(parseControllerSnapshot(formatControllerSnapshot(current)), current);
  for (const version of [8, 9]) {
    const migrated = readController({ version, shapeMode: 'core-graph',
      coreGraphDisabledPointIds: ['P3', 'P4', 'P5', 'D0', 'D1', 'D2'],
      coreGraphStrictTwoLineSuperset: true, coreGraphRelaxedPPoints: true });
    assert.deepEqual(migrated.coreGraphDisabledPointIds, ['Q-', 'Q0', 'Q+', 'D0', 'D1', 'D2']);
    assert.ok(!('coreGraphStrictTwoLineSuperset' in migrated));
    assert.ok(!('coreGraphRelaxedPPoints' in migrated));
  }
  for (const [key, value] of [['coreGraphA', null], ['coreGraphB', '0.5'],
    ['coreGraphSliceK', null], ['coreGraphShowDisk', 'true']]) {
    assert.throws(() => readController({ version: 10, [key]: value }), { message: `Invalid ${key}.` });
  }
  for (const strategy3 of [null, { bc: { ...modeState.bc, source: 'unknown' } },
    { d: { ...modeState.d, parameters: { a: null, epsilon: 0.4, beta: 0.5 } } },
    { bc: { ...modeState.bc, triangles: [] } }]) {
    assert.throws(() => readController({ version: 10, strategy3 }));
  }
  for (const key of ['strictCheckEnabled', 'showCoverOverlay', 'coreCaseAlgorithm2Diagonals',
    'coreCaseStrictTwoLineSuperset', 'coreCaseRelaxedPPoints', 'coreGraphDenseSpecialCurveSampling',
    'coreGraphSpecialCurveNeighborhoodOnly', 'coreGraphStrictTwoLineSuperset', 'coreGraphRelaxedPPoints']) {
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
  console.log('PASS: controller v8–10 and Free v1–8 snapshots, Strategy 3 state, legacy graph migration, normalization, and rejection checks');
} finally {
  await server.close();
}
