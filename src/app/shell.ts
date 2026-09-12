import { setAbUnionTool } from '../ab-union/state';
import { setCanvasSize } from '../coords';
import {
  getAdmissibleOrderedSource,
  getStrictEps,
  isCustomAdmissibleOrderedSourceActive,
  isStrictCheckEnabled,
  resetAdmissibleOrderedSource,
  setAdmissibleOrderedSource,
  setStrictCheckEnabled,
  setStrictEps,
} from '../maps';
import { createAbUnionController } from '../modes/ab-union/controller';
import { createAreaController } from '../modes/area/controller';
import { createBaseController } from '../modes/base/controller';
import { createCoreController } from '../modes/core/controller';
import { createFreeController } from '../modes/free/controller';
import { createHullDebugController } from '../modes/hull-debug/controller';
import { createStrategy3Controller } from '../modes/strategy3/controller';
import { createRegionRenderer, type GraphMode } from '../region';
import { prepareStrategy3Restore } from '../strategy3/restore';
import type { ShapeMode, TriangleState } from '../types';
import {
  clampStrictEpsUpperBound,
  clampStrictEpsValue,
  DEFAULT_STRICT_EPS_UPPER_BOUND,
  formatControllerSnapshot,
  parseControllerSnapshot,
  sanitizeCeStartOverrides,
  type ControllerSnapshot,
} from './controllerSnapshot';
import { clamp01, formatStrictEps, getStrictEpsStep } from './format';

export function createApp() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const MAX_CANVAS_SIZE = 600;
  const regionCanvas = document.getElementById('region-canvas') as HTMLCanvasElement;
  const regionRenderer = createRegionRenderer(regionCanvas);
  const graphPanel = document.getElementById('graph-panel') as HTMLDivElement;
  const shapeTitle = document.getElementById('shape-title') as HTMLDivElement;
  const gammaValues = document.getElementById('gamma-values') as HTMLDivElement;
  const localCBounds = document.getElementById('local-c-bounds') as HTMLDivElement;
  const localCValues = document.getElementById('local-c-values') as HTMLDivElement;
  const cSlider = document.getElementById('c-slider') as HTMLInputElement;
  const cValueLabel = document.getElementById('c-value') as HTMLSpanElement;
  const sliderRow = document.getElementById('slider-row') as HTMLDivElement;
  const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode-button'));
  const shapeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.shape-button'));
  const admissibleEditor = document.getElementById('admissible-editor') as HTMLTextAreaElement;
  const admissibleStatus = document.getElementById('admissible-status') as HTMLDivElement;
  const admissibleResetButton = document.getElementById('admissible-reset') as HTMLButtonElement;
  const controllerState = document.getElementById('controller-state') as HTMLTextAreaElement;
  const controllerStateStatus = document.getElementById('controller-state-status') as HTMLDivElement;
  const controllerStateCopyButton = document.getElementById('controller-state-copy') as HTMLButtonElement;
  const controllerStateLoadButton = document.getElementById('controller-state-load') as HTMLButtonElement;
  const strictCheckToggle = document.getElementById('strict-check-toggle') as HTMLInputElement;
  const strictCheckPanel = document.getElementById('strict-check-panel') as HTMLDivElement;
  const strictEpsControls = document.getElementById('strict-eps-controls') as HTMLDivElement;
  const strictEpsSlider = document.getElementById('strict-eps-slider') as HTMLInputElement;
  const strictEpsValueLabel = document.getElementById('strict-eps-value') as HTMLSpanElement;
  const strictEpsInput = document.getElementById('strict-eps-input') as HTMLInputElement;
  const strictEpsMaxInput = document.getElementById('strict-eps-max-input') as HTMLInputElement;
  const coverOverlayToggle = document.getElementById('cover-overlay-toggle') as HTMLInputElement;
  const coverOverlayPanel = document.getElementById('cover-overlay-panel') as HTMLDivElement;
  const coverOverlayToggleRow = document.getElementById('cover-overlay-toggle-row') as HTMLLabelElement;
  const coverOverlayStatus = document.getElementById('cover-overlay-status') as HTMLDivElement;
  const pointToolPanel = document.getElementById('point-tool-panel') as HTMLDivElement;
  const pointToolToggle = document.getElementById('point-tool-toggle') as HTMLButtonElement;
  const pointDeleteButton = document.getElementById('point-delete') as HTMLButtonElement;
  const pointClearButton = document.getElementById('point-clear') as HTMLButtonElement;
  const pointToolStatus = document.getElementById('point-tool-status') as HTMLSpanElement;
  const ceStatus = document.getElementById('ce-status') as HTMLDivElement;
  const cePanel = document.getElementById('ce-panel') as HTMLDivElement;
  const ceControls = document.getElementById('ce-controls') as HTMLDivElement;
  const ceIntervalSelect = document.getElementById('ce-interval-select') as HTMLSelectElement;
  const ceDirectionSelect = document.getElementById('ce-direction-select') as HTMLSelectElement;
  const ceStartResetButton = document.getElementById('ce-start-reset') as HTMLButtonElement;
  const ceChainStatus = document.getElementById('ce-chain-status') as HTMLDivElement;
  const freePanel = document.getElementById('free-panel') as HTMLDivElement;
  const abUnionPanel = document.getElementById('ab-union-panel') as HTMLDivElement;
  const abUnionPanelTitle = document.getElementById('ab-union-panel-title') as HTMLDivElement;
  const abUnionControls = document.getElementById('ab-union-controls') as HTMLDivElement;
  const strategy3Panel = document.getElementById('strategy3-panel') as HTMLDivElement;
  const strategy3Controls = document.getElementById('strategy3-controls') as HTMLDivElement;
  const triangleState: TriangleState = {
    position: { x: 0, y: 0 },
    angle: 0,
    controlPoint: { x: 0, y: 0 },
  };
  let startValue = 0.25;
  let graphMode: GraphMode = 'composition';
  let shapeMode: ShapeMode = 'triangle';
  let manualLocalCs: number[] = Array(6).fill(0.5);
  let admissibleEditorTimer: number | null = null;
  let hoveredHalfDiagonalIndex: number | null = null;
  let selectedHalfDiagonalIndices: number[] = [];
  let strictEpsUpperBound = DEFAULT_STRICT_EPS_UPPER_BOUND;
  let showCoverOverlay = false;
  let pointToolActive = false;

  function getResponsiveCanvasSize(target: HTMLCanvasElement): number {
    const rect = target.getBoundingClientRect();
    return Math.max(1, Math.min(MAX_CANVAS_SIZE, Math.round(rect.width)));
  }

  function resizeHiDPICanvas(
    target: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    cssSize: number,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.round(cssSize * dpr);
    target.height = Math.round(cssSize * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function syncCanvasSizes(): void {
    const mainCanvasSize = getResponsiveCanvasSize(canvas);
    setCanvasSize(mainCanvasSize);
    resizeHiDPICanvas(canvas, ctx, mainCanvasSize);
    regionRenderer.resize(getResponsiveCanvasSize(regionCanvas));
  }

  function setControllerStateStatus(text: string, isError = false): void {
    controllerStateStatus.textContent = text;
    controllerStateStatus.style.color = isError ? '#b91c1c' : '#475569';
  }

  function getControllerSnapshot(): ControllerSnapshot {
    return {
      version: 11,
      shapeMode,
      graphMode,
      startValue: clamp01(startValue),
      singleParameter: clamp01(parseFloat(cSlider.value)),
      triangleState: {
        position: { ...triangleState.position },
        angle: triangleState.angle,
        controlPoint: { ...triangleState.controlPoint },
      },
      manualLocalCs: manualLocalCs.map(clamp01),
      selectedHalfDiagonalIndices: selectedHalfDiagonalIndices.slice(),
      admissibleSource: admissibleEditor.value,
      strictCheckEnabled: isStrictCheckEnabled(),
      strictEps: getStrictEps(),
      strictEpsUpperBound,
      showCoverOverlay,
      ceDirection: base.ceDirection,
      ce2SelectedIntervalIndex: base.ce2SelectedIntervalIndex,
      ceStartOverrides: sanitizeCeStartOverrides(base.ceStartOverrides),
      pointSeeds: free.pointState.pointSeeds.map((seed) => ({ id: seed.id, point: { ...seed.point } })),
      selectedPointSeedId: free.pointState.selectedPointSeedId,
      coreCaseDisabledPointIds: core.coreCaseDisabledPointIds.slice(),
      coreCaseIntervalPointFractions: core.coreCaseIntervalPointFractions.slice(),
      coreCaseAlgorithm2Diagonals: core.coreCaseOptions.algorithm2Diagonals,
      coreCaseStrictTwoLineSuperset: core.coreCaseOptions.strictTwoLineSuperset,
      coreCaseRelaxedPPoints: core.coreCaseOptions.relaxedPPoints,
      strategy3: strategy3.getState(),
    };
  }

  function syncControllerSnapshot(): void {
    controllerState.value = formatControllerSnapshot(getControllerSnapshot());
    setControllerStateStatus('Snapshot updates automatically.');
  }

  function loadControllerSnapshot(raw: string): void {
    const snapshot = parseControllerSnapshot(raw);
    const originalVersion = (JSON.parse(raw) as { version: number }).version;
    const preparedStrategy3 = prepareStrategy3Restore(snapshot.strategy3);
    const admissibleResult = setAdmissibleOrderedSource(snapshot.admissibleSource);
    if (!admissibleResult.ok) {
      throw new Error(`Admissible source compile error: ${admissibleResult.error}`);
    }

    shapeMode = snapshot.shapeMode;
    graphMode = snapshot.graphMode;
    startValue = snapshot.startValue;
    cSlider.value = snapshot.singleParameter.toFixed(2);
    cValueLabel.textContent = snapshot.singleParameter.toFixed(2);
    triangleState.position = { ...snapshot.triangleState.position };
    triangleState.angle = snapshot.triangleState.angle;
    triangleState.controlPoint = { ...snapshot.triangleState.controlPoint };
    manualLocalCs = snapshot.manualLocalCs.slice();
    selectedHalfDiagonalIndices = snapshot.selectedHalfDiagonalIndices.slice();
    hoveredHalfDiagonalIndex = null;
    admissibleEditor.value = snapshot.admissibleSource;
    strictEpsUpperBound = snapshot.strictEpsUpperBound;
    showCoverOverlay = snapshot.showCoverOverlay;
    base.ceDirection = snapshot.ceDirection;
    base.ce2SelectedIntervalIndex = snapshot.ce2SelectedIntervalIndex;
    base.ceStartOverrides = { ...snapshot.ceStartOverrides };
    free.pointState.pointSeeds = snapshot.pointSeeds.map((seed) => ({ id: seed.id, point: { ...seed.point } }));
    free.pointState.selectedPointSeedId = snapshot.selectedPointSeedId;
    core.coreCaseDisabledPointIds = snapshot.coreCaseDisabledPointIds.slice();
    core.coreCaseIntervalPointFractions = snapshot.coreCaseIntervalPointFractions.slice();
    core.coreCaseOptions.algorithm2Diagonals = snapshot.coreCaseAlgorithm2Diagonals;
    core.coreCaseOptions.strictTwoLineSuperset = snapshot.coreCaseStrictTwoLineSuperset;
    core.setCoreCaseRelaxedPPoints(snapshot.coreCaseRelaxedPPoints);
    strategy3.restoreState(preparedStrategy3.state);
    core.coreCaseTool = 'move';
    setAbUnionTool(core.coreCaseState, 'move');
    ceDirectionSelect.value = base.ceDirection;
    ceIntervalSelect.value = base.ce2SelectedIntervalIndex.toString();
    setStrictCheckEnabled(snapshot.strictCheckEnabled);
    setStrictEps(snapshot.strictEps);
    syncStrictCheckControls();
    syncAdmissibleEditorStatus();
    syncModeButtons();
    render();
    syncControllerSnapshot();
    const loadedStatus = originalVersion < 11
      ? 'Legacy snapshot loaded. BC/D boundary controls initialized; independent parameters and triangle poses retired.'
      : 'Snapshot loaded.';
    const resetStatus = preparedStrategy3.resets.map(({ mode, layout, reasons, action }) => {
      const label = `${mode.toUpperCase()}${layout ? ` ${layout === 'seven' ? '7' : '8'}-dot` : ''}`;
      const change = action === 'locks-cleared' ? 'inconsistent sum locks cleared' : 'boundaries reset to the feasible preset; sum locks cleared';
      return `${label} ${change}: ${reasons.map((reason) => reason.replace(/\.$/, '')).join('; ')}.`;
    });
    setControllerStateStatus([loadedStatus, ...resetStatus].join(' '));
  }

  function toggleSelectedHalfDiagonal(index: number): void {
    const existingIndex = selectedHalfDiagonalIndices.indexOf(index);
    if (existingIndex >= 0) {
      selectedHalfDiagonalIndices = selectedHalfDiagonalIndices.filter((value) => value !== index);
      return;
    }

    selectedHalfDiagonalIndices = [...selectedHalfDiagonalIndices, index];
  }

  function isCoverOverlayAvailable(): boolean {
    return shapeMode !== 'free' &&
      shapeMode !== 'ab-union' &&
      shapeMode !== 'ab-hull-debug' &&
      shapeMode !== 'max-area' &&
      shapeMode !== 'area-conj' &&
      shapeMode !== 'core-case' &&
      shapeMode !== 'strategy3-bc' &&
      shapeMode !== 'strategy3-d' &&
      shapeMode !== 'strategy3-f';
  }

  function syncPointToolControls(): void {
    free.normalizeSelectedPointSeed();
    const visible = shapeMode !== 'free' &&
      shapeMode !== 'ab-union' &&
      shapeMode !== 'ab-hull-debug' &&
      shapeMode !== 'max-area' &&
      shapeMode !== 'area-conj' &&
      shapeMode !== 'core-case' &&
      shapeMode !== 'strategy3-bc' &&
      shapeMode !== 'strategy3-d' &&
      shapeMode !== 'strategy3-f';
    pointToolPanel.hidden = !visible;
    pointToolToggle.classList.toggle('is-active', visible && pointToolActive);
    pointDeleteButton.disabled = !free.pointState.selectedPointSeedId;
    pointClearButton.disabled = free.pointState.pointSeeds.length === 0;
    pointToolStatus.textContent = free.pointSeedStatusText();
  }

  function syncModeButtons(): void {
    if (shapeMode === 'triangle') {
      shapeTitle.textContent = 'C-triangle';
    } else if (shapeMode === 'circle') {
      shapeTitle.textContent = 'C-circle';
    } else if (shapeMode === 'free') {
      shapeTitle.textContent = 'Free mode';
    } else if (shapeMode === 'ab-union') {
      shapeTitle.textContent = 'ab union';
    } else if (shapeMode === 'ab-hull-debug') {
      shapeTitle.textContent = 'AB hull debug';
    } else if (shapeMode === 'max-area') {
      shapeTitle.textContent = 'Max Area';
    } else if (shapeMode === 'area-conj') {
      shapeTitle.textContent = 'Area Conj';
    } else if (shapeMode === 'core-case') {
      shapeTitle.textContent = 'Core Case';
    } else if (shapeMode === 'strategy3-f') {
      shapeTitle.textContent = 'S3 F: nine-point obstruction';
    } else if (shapeMode === 'strategy3-bc') {
      shapeTitle.textContent = 'S3 BC: six-point selected gap';
    } else if (shapeMode === 'strategy3-d') {
      shapeTitle.textContent = 'S3 D: four-point rescuer';
    } else {
      shapeTitle.textContent = 'c_i controls';
    }
    for (const button of shapeButtons) {
      button.classList.toggle('is-active', button.dataset.shapeMode === shapeMode);
    }
    for (const button of modeButtons) {
      button.classList.toggle('is-active', button.dataset.mode === graphMode);
    }
    const freeActive = shapeMode === 'free';
    const abUnionActive = shapeMode === 'ab-union';
    const abHullDebugActive = shapeMode === 'ab-hull-debug';
    const maxAreaActive = shapeMode === 'max-area';
    const areaConjActive = shapeMode === 'area-conj';
    const coreCaseActive = shapeMode === 'core-case';
    const strategy3Active = shapeMode === 'strategy3-bc' || shapeMode === 'strategy3-d' || shapeMode === 'strategy3-f';
    gammaValues.hidden = strategy3Active;
    localCBounds.hidden = strategy3Active;
    localCValues.hidden = strategy3Active;
    sliderRow.hidden = freeActive || abUnionActive || abHullDebugActive || maxAreaActive || areaConjActive || coreCaseActive || strategy3Active || graphMode !== 'single';
    cSlider.disabled = freeActive || abUnionActive || abHullDebugActive || maxAreaActive || areaConjActive || coreCaseActive || strategy3Active || graphMode !== 'single';
    graphPanel.hidden = freeActive || abUnionActive || abHullDebugActive || maxAreaActive || areaConjActive || coreCaseActive || strategy3Active;
    freePanel.hidden = !freeActive;
    abUnionPanel.hidden = !abUnionActive && !abHullDebugActive && !maxAreaActive && !areaConjActive && !coreCaseActive;
    strategy3Panel.hidden = !strategy3Active;
    strictCheckPanel.hidden = strategy3Active;
    coverOverlayPanel.hidden = strategy3Active;
    cePanel.hidden = strategy3Active;
    abUnionPanelTitle.textContent = abHullDebugActive
      ? 'AB hull debug'
      : shapeMode === 'max-area' ? 'Max Area'
        : shapeMode === 'area-conj' ? 'Area Conj'
          : shapeMode === 'core-case' ? 'Core Case' : 'ab union region';
    free.freeInteractionApi?.setEnabled(freeActive);
    strategy3.setEnabled(strategy3Active);
    coverOverlayToggle.disabled = !isCoverOverlayAvailable();
    coverOverlayToggle.checked = showCoverOverlay && isCoverOverlayAvailable();
    coverOverlayToggleRow.classList.toggle('is-disabled', !isCoverOverlayAvailable());
    syncPointToolControls();
  }

  function setAdmissibleStatus(text: string, isError = false): void {
    admissibleStatus.textContent = text;
    admissibleStatus.style.color = isError ? '#b91c1c' : '#475569';
  }

  function syncStrictCheckControls(): void {
    const strictEps = clampStrictEpsValue(getStrictEps(), strictEpsUpperBound);
    if (strictEps !== getStrictEps()) {
      setStrictEps(strictEps);
    }

    const upperBound = clampStrictEpsUpperBound(strictEpsUpperBound);
    if (upperBound !== strictEpsUpperBound) {
      strictEpsUpperBound = upperBound;
    }

    const step = getStrictEpsStep(strictEpsUpperBound);
    strictCheckToggle.checked = isStrictCheckEnabled();
    strictEpsControls.hidden = !isStrictCheckEnabled();
    strictEpsSlider.min = '0';
    strictEpsSlider.max = strictEpsUpperBound.toString();
    strictEpsSlider.step = step;
    strictEpsSlider.value = strictEps.toString();
    strictEpsInput.min = '0';
    strictEpsInput.max = strictEpsUpperBound.toString();
    strictEpsInput.step = step;
    strictEpsInput.value = formatStrictEps(strictEps);
    strictEpsValueLabel.textContent = formatStrictEps(strictEps);
    strictEpsMaxInput.min = step;
    strictEpsMaxInput.step = step;
    strictEpsMaxInput.value = formatStrictEps(strictEpsUpperBound);
  }

  function syncAdmissibleEditorStatus(): void {
    setAdmissibleStatus(
      isCustomAdmissibleOrderedSourceActive()
        ? 'Custom ordered predicate active.'
        : 'Default ordered predicate active.',
    );
  }

  function applyAdmissibleEditorSource(): void {
    const result = setAdmissibleOrderedSource(admissibleEditor.value);
    if (!result.ok) {
      setAdmissibleStatus(`Compile error: ${result.error}`, true);
      return;
    }

    syncAdmissibleEditorStatus();
    render();
  }

  function render(): void {
    syncPointToolControls();
    if (shapeMode === 'free') free.renderFreeFrame();
    else if (shapeMode === 'ab-union') ab.renderAbUnionFrame();
    else if (shapeMode === 'ab-hull-debug') hull.renderHullDebugFrame();
    else if (shapeMode === 'max-area') area.renderMaxAreaFrame();
    else if (shapeMode === 'area-conj') area.renderAreaConjFrame();
    else if (shapeMode === 'core-case') core.renderCoreCaseFrame();
    else if (shapeMode === 'strategy3-bc' || shapeMode === 'strategy3-d' || shapeMode === 'strategy3-f') {
      gammaValues.textContent = 'Strategy 3 witness construction';
      localCBounds.textContent = '';
      localCValues.textContent = '';
      ceStatus.textContent = '';
      ceControls.hidden = true;
      ceChainStatus.textContent = '';
      coverOverlayStatus.textContent = '';
      strategy3.renderFrame();
    }
    else base.renderBaseFrame();
    syncControllerSnapshot();
  }

  strictCheckToggle.addEventListener('change', () => {
    setStrictCheckEnabled(strictCheckToggle.checked);
    syncStrictCheckControls();
    free.syncFreeStrictEps(shapeMode === 'free');
    render();
  });

  strictEpsSlider.addEventListener('input', () => {
    setStrictEps(clampStrictEpsValue(parseFloat(strictEpsSlider.value), strictEpsUpperBound));
    syncStrictCheckControls();
    free.syncFreeStrictEps(shapeMode === 'free');
    render();
  });

  strictEpsInput.addEventListener('change', () => {
    setStrictEps(clampStrictEpsValue(parseFloat(strictEpsInput.value), strictEpsUpperBound));
    syncStrictCheckControls();
    free.syncFreeStrictEps(shapeMode === 'free');
    render();
  });

  strictEpsMaxInput.addEventListener('change', () => {
    strictEpsUpperBound = clampStrictEpsUpperBound(parseFloat(strictEpsMaxInput.value));
    setStrictEps(clampStrictEpsValue(getStrictEps(), strictEpsUpperBound));
    syncStrictCheckControls();
    free.syncFreeStrictEps(shapeMode === 'free');
    render();
  });

  coverOverlayToggle.addEventListener('change', () => {
    showCoverOverlay = coverOverlayToggle.checked && isCoverOverlayAvailable();
    syncModeButtons();
    render();
  });

  pointToolToggle.addEventListener('click', () => {
    pointToolActive = !pointToolActive;
    syncPointToolControls();
    render();
  });

  pointDeleteButton.addEventListener('click', () => {
    free.deleteSelectedPointSeed();
    render();
  });

  pointClearButton.addEventListener('click', () => {
    free.clearPointSeeds();
    render();
  });
  const base = createBaseController({
    triangleState,
    get pointState() { return free.pointState; },
    get shapeMode() { return shapeMode; },
    ceIntervalSelect,
    get startValue() { return startValue; },
    set startValue(value) { startValue = value; },
    get selectedHalfDiagonalIndices() { return selectedHalfDiagonalIndices; },
    ceControls,
    ceDirectionSelect,
    ceStartResetButton,
    render,
    get manualLocalCs() { return manualLocalCs; },
    set manualLocalCs(value) { manualLocalCs = value; },
    isCoverOverlayAvailable,
    get showCoverOverlay() { return showCoverOverlay; },
    ctx,
    get hoveredHalfDiagonalIndex() { return hoveredHalfDiagonalIndex; },
    set hoveredHalfDiagonalIndex(value) { hoveredHalfDiagonalIndex = value; },
    get drawSymmetricPoints() { return free.drawSymmetricPoints; },
    gammaValues,
    localCBounds,
    localCValues,
    ceStatus,
    ceChainStatus,
    coverOverlayStatus,
    regionRenderer,
    get graphMode() { return graphMode; },
    cSlider,
    cValueLabel,
    canvas,
    toggleSelectedHalfDiagonal,
    get pointToolActive() { return pointToolActive; },
    get addPointSeed() { return free.addPointSeed; },
    get movePointSeed() { return free.movePointSeed; },
    get selectPointSeed() { return free.selectPointSeed; }
  });
  const free = createFreeController({
    triangleState,
    get getLocalCMaxima() { return base.getLocalCMaxima; },
    get buildChainDescriptor() { return base.buildChainDescriptor; },
    render,
    ctx,
    gammaValues,
    localCBounds,
    localCValues,
    ceStatus,
    ceChainStatus,
    coverOverlayStatus,
    regionRenderer,
    canvas
  });
  const ab = createAbUnionController({
    get areaConstraintDelta() { return area.areaConstraintDelta; },
    abUnionControls,
    get areaDeltaControlHtml() { return area.areaDeltaControlHtml; },
    get manualLocalCs() { return manualLocalCs; },
    set manualLocalCs(value) { manualLocalCs = value; },
    ctx,
    triangleState,
    gammaValues,
    localCBounds,
    localCValues,
    ceStatus,
    ceChainStatus,
    coverOverlayStatus,
    render,
    canvas,
    get shapeMode() { return shapeMode; }
  });
  const hull = createHullDebugController({
    abUnionControls,
    ctx,
    gammaValues,
    localCBounds,
    localCValues,
    ceStatus,
    ceChainStatus,
    coverOverlayStatus,
    regionRenderer,
    render,
    get shapeMode() { return shapeMode; },
    canvas
  });
  const area = createAreaController({
    get abUnionState() { return ab.abUnionState; },
    abUnionControls,
    ctx,
    gammaValues,
    localCBounds,
    localCValues,
    ceStatus,
    ceChainStatus,
    coverOverlayStatus,
    regionRenderer,
    render,
    get shapeMode() { return shapeMode; },
    canvas,
    triangleState,
    get manualLocalCs() { return manualLocalCs; }
  });
  const core = createCoreController({
    canvas,
    get shapeMode() { return shapeMode; },
    render,
    abUnionControls,
    get manualLocalCs() { return manualLocalCs; },
    set manualLocalCs(value) { manualLocalCs = value; },
    ctx,
    triangleState,
    gammaValues,
    localCBounds,
    localCValues,
    ceStatus,
    ceChainStatus,
    coverOverlayStatus,
    regionRenderer
  });
  const strategy3 = createStrategy3Controller({
    canvas,
    ctx,
    controls: strategy3Controls,
    render,
    get shapeMode() { return shapeMode; },
  });

  base.bindBaseControls();
  core.bindCoreControls();
  free.bindFreeControls();
  ab.bindAbControls();
  hull.bindHullControls();
  area.bindAreaControls();

  cValueLabel.textContent = parseFloat(cSlider.value).toFixed(2);

  admissibleEditor.value = getAdmissibleOrderedSource();

  syncStrictCheckControls();

  syncAdmissibleEditorStatus();

  admissibleEditor.addEventListener('input', () => {
    if (admissibleEditorTimer !== null) {
      window.clearTimeout(admissibleEditorTimer);
    }
    admissibleEditorTimer = window.setTimeout(() => {
      applyAdmissibleEditorSource();
    }, 250);
  });

  admissibleResetButton.addEventListener('click', () => {
    if (admissibleEditorTimer !== null) {
      window.clearTimeout(admissibleEditorTimer);
      admissibleEditorTimer = null;
    }
    resetAdmissibleOrderedSource();
    admissibleEditor.value = getAdmissibleOrderedSource();
    syncAdmissibleEditorStatus();
    render();
  });

  controllerStateCopyButton.addEventListener('click', async () => {
    syncControllerSnapshot();
    try {
      await navigator.clipboard.writeText(controllerState.value);
      setControllerStateStatus('Snapshot copied.');
    } catch {
      controllerState.select();
      setControllerStateStatus('Clipboard unavailable. JSON selected for manual copy.');
    }
  });

  controllerStateLoadButton.addEventListener('click', () => {
    try {
      loadControllerSnapshot(controllerState.value);
    } catch (error) {
      setControllerStateStatus(
        error instanceof Error ? error.message : 'Failed to load snapshot.',
        true,
      );
    }
  });

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as GraphMode | undefined;
      if (!mode) return;
      graphMode = mode;
      syncModeButtons();
      render();
    });
  }

  for (const button of shapeButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.shapeMode as ShapeMode | undefined;
      if (!mode) return;
      shapeMode = mode;
      syncModeButtons();
      render();
    });
  }

  window.addEventListener('resize', () => {
    syncCanvasSizes();
    render();
  });

  syncCanvasSizes();

  syncModeButtons();

  render();
}
