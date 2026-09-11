import { clamp01 } from '../../app/format';
import type { ChainDescriptor } from '../../app/types';
import { config } from '../../coords';
import { computeCoverResult } from '../../cover';
import { buildCUnionModel, type CUnionModel } from '../../cUnion';
import {
  autoPlaceAllFreeVd0Triangles,
  createDefaultFreeState,
  DEFAULT_TARGET_T,
  describeTarget,
  getFreeVd0Status,
  getTriangle,
  projectTriangleToConstraints,
  refreshLabels,
  triangleVertices,
  validateFreeState,
} from '../../freeGeometry';
import { setupFreeInteraction } from '../../freeInteraction';
import type {
  FreeNamedPointRef,
  FreeState,
  FreeTarget,
  FreeTool,
  FreeTriangleId,
  FreeValidationResult,
  FreeVd0Coordinate,
  FreeVd0Mode,
} from '../../freeTypes';
import {
  addRejectedSample,
  addSample,
  classifyCSample,
  classifyV0Sample,
  EMPTY_SAMPLING_STORE,
  type CSample,
  type RejectedSample,
  type SamplingStore,
  type VSample,
} from '../../halfSkeletonFrontier';
import { drawHexagon } from '../../hexagon';
import { getEffectiveStrictEps } from '../../maps';
import { createRegionRenderer } from '../../region';
import { buildSymmetricPointTargets, nextPointSeedId, pointInHexagon } from '../../symmetricPoints';
import { getCPerimeterIntersections, getInnerGammas, type CPerimeterIntersections } from '../../triangle';
import type { Point, TriangleState } from '../../types';
import { createFreePanel } from './panel';
import { createFreeRenderer } from './render';
import { createSamplingPanel } from './sampling';
import { formatFreeSnapshot, parseFreeSnapshot } from './snapshot';

interface Dependencies {
  readonly triangleState: TriangleState;
  readonly getLocalCMaxima: (gammas: number[]) => number[];
  readonly buildChainDescriptor: (localCs: number[], ce: CPerimeterIntersections | null) => ChainDescriptor;
  readonly render: () => void;
  readonly ctx: CanvasRenderingContext2D;
  readonly gammaValues: HTMLDivElement;
  readonly localCBounds: HTMLDivElement;
  readonly localCValues: HTMLDivElement;
  readonly ceStatus: HTMLDivElement;
  readonly ceChainStatus: HTMLDivElement;
  readonly coverOverlayStatus: HTMLDivElement;
  readonly regionRenderer: ReturnType<typeof createRegionRenderer>;
  readonly canvas: HTMLCanvasElement;
}

export function createFreeController(deps: Dependencies) {
  const freeStatus = document.getElementById('free-status') as HTMLDivElement;
  const freeControls = document.getElementById('free-controls') as HTMLDivElement;
  const freeStateJson = document.getElementById('free-state-json') as HTMLTextAreaElement;
  const freeStateStatus = document.getElementById('free-state-status') as HTMLDivElement;
  const freeStateCopyButton = document.getElementById('free-state-copy') as HTMLButtonElement;
  const freeStateLoadButton = document.getElementById('free-state-load') as HTMLButtonElement;
  let freeState: FreeState = createDefaultFreeState();
  let freeInitializedFromCurrent = false;
  let currentFreeValidation: FreeValidationResult | null = null;
  let freeInteractionApi: ReturnType<typeof setupFreeInteraction> | null = null;
  let cUnionModel: CUnionModel | null = null;
  let cUnionBuildState: 'idle' | 'building' | 'ready' | 'error' = 'idle';
  let cUnionBuildProgress = 0;
  let cUnionBuildError = '';
  let cUnionRenderPending = false;
  let sampleModeSavedTriangleStates: Partial<Record<FreeTriangleId, { hidden: boolean; fixed: boolean; }>> | null = null;
  let currentV0Sample: VSample | RejectedSample | null = null;
  let currentCSample: CSample | RejectedSample | null = null;
  let showAllSamplePoints = false;

  function normalizeSelectedPointSeed(): void {
    if (
      freeState.selectedPointSeedId &&
      !freeState.pointSeeds.some((seed) => seed.id === freeState.selectedPointSeedId)
    ) {
      freeState.selectedPointSeedId = null;
    }
  }

  function pointSeedStatusText(): string {
    normalizeSelectedPointSeed();
    const seedCount = freeState.pointSeeds.length;
    const pointCount = buildSymmetricPointTargets(freeState.pointSeeds).length;
    const selected = freeState.selectedPointSeedId ? `; selected ${freeState.selectedPointSeedId}` : '';
    return `${seedCount} seed${seedCount === 1 ? '' : 's'}, ${pointCount} D6 point${pointCount === 1 ? '' : 's'}${selected}`;
  }

  function addPointSeed(point: Point): void {
    if (!pointInHexagon(point)) {
      return;
    }
    const id = nextPointSeedId(freeState.pointSeeds);
    freeState.pointSeeds.push({ id, point });
    freeState.selectedPointSeedId = id;
    freeState.status = `Created point seed ${id}.`;
  }

  function movePointSeed(seedId: string, point: Point): void {
    if (!pointInHexagon(point)) {
      return;
    }
    const seed = freeState.pointSeeds.find((candidate) => candidate.id === seedId);
    if (!seed) {
      return;
    }
    seed.point = point;
    freeState.selectedPointSeedId = seedId;
  }

  function selectPointSeed(seedId: string): void {
    if (freeState.pointSeeds.some((seed) => seed.id === seedId)) {
      freeState.selectedPointSeedId = seedId;
    }
  }

  function deleteSelectedPointSeed(): void {
    const selected = freeState.selectedPointSeedId;
    if (!selected) {
      return;
    }
    freeState.pointSeeds = freeState.pointSeeds.filter((seed) => seed.id !== selected);
    freeState.selectedPointSeedId = null;
    freeState.status = `Deleted point seed ${selected}.`;
  }

  function clearPointSeeds(): void {
    if (freeState.pointSeeds.length === 0) {
      return;
    }
    freeState.pointSeeds = [];
    freeState.selectedPointSeedId = null;
    freeState.status = 'Cleared point seeds.';
  }

  function initializeFreeFromCurrentIfNeeded(): void {
    if (freeInitializedFromCurrent) {
      return;
    }
    const gammas = getInnerGammas(deps.triangleState, 'triangle');
    const localCs = deps.getLocalCMaxima(gammas);
    const ce = getCPerimeterIntersections(deps.triangleState);
    const chain = deps.buildChainDescriptor(localCs, ce);
    const result = computeCoverResult(
      deps.triangleState,
      chain.localCs,
      chain.start,
      getEffectiveStrictEps(),
      chain.vertexOrder,
      chain.direction,
    );
    const next = createDefaultFreeState();
    next.strictEps = getEffectiveStrictEps();
    next.pointSeeds = freeState.pointSeeds.map((seed) => ({ id: seed.id, point: { ...seed.point } }));
    next.selectedPointSeedId = freeState.selectedPointSeedId;
    getTriangle(next, 'C').center = { ...deps.triangleState.position };
    getTriangle(next, 'C').angle = deps.triangleState.angle;
    for (const coverTriangle of result.vTriangles) {
      const triangle = getTriangle(next, coverTriangle.name as FreeTriangleId);
      triangle.center = { ...coverTriangle.center };
      triangle.angle = coverTriangle.phi - Math.PI / 2;
    }
    freeState = next;
    freeInitializedFromCurrent = true;
    refreshLabels(freeState, cUnionModel);
  }

  function decodeNamedPointRef(value: string): FreeNamedPointRef | null {
    if (value === 'O') return { kind: 'O' };
    const [kind, raw] = value.split(':');
    if (kind === 'M') return { kind: 'M', index: clampInteger(raw, 0, 5) };
    if (kind === 'PT') {
      const parts = value.split(':');
      if (parts.length >= 3) {
        return { kind: 'P', targetTId: parts[1], index: clampInteger(parts[2], 0, 5) };
      }
      return { kind: 'P', targetTId: freeState.targetTPoints[0]?.id ?? 't1', index: clampInteger(raw, 0, 5) };
    }
    if (kind === 'B') return { kind: 'B', index: clampInteger(raw, 0, 5) };
    if (kind === 'V') return { kind: 'V', index: clampInteger(raw, 0, 5) };
    if (kind === 'L') return { kind: 'label', labelId: raw };
    if (kind === 'P') {
      const [x, y] = raw.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { kind: 'manual', manualPoint: { x, y } };
      }
    }
    return null;
  }

  function clampInteger(value: string | undefined, min: number, max: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
  }

  function setFreeStateStatus(text: string, isError = false): void {
    freeStateStatus.textContent = text;
    freeStateStatus.style.color = isError ? '#b91c1c' : '#475569';
  }

  function loadFreeSnapshot(raw: string): void {
    freeState = parseFreeSnapshot(raw);
    if (freeState.cForm === 'c-union') ensureCUnionModel();
    sampleModeSavedTriangleStates = null;
    freeInitializedFromCurrent = true;
    refreshLabels(freeState, cUnionModel);
  }

  function syncFreeStrictEps(projectConstraints = false): void {
    const nextStrictEps = getEffectiveStrictEps();
    if (freeState.strictEps === nextStrictEps) {
      return;
    }
    freeState.strictEps = nextStrictEps;
    if (projectConstraints) {
      for (const triangle of freeState.triangles) {
        projectTriangleToConstraints(freeState, triangle, cUnionModel);
      }
      refreshLabels(freeState, cUnionModel);
    }
  }

  function scheduleCUnionRender(): void {
    if (cUnionRenderPending) return;
    cUnionRenderPending = true;
    requestAnimationFrame(() => {
      cUnionRenderPending = false;
      deps.render();
    });
  }

  function ensureCUnionModel(): void {
    if (cUnionBuildState !== 'idle') return;
    cUnionBuildState = 'building';
    cUnionBuildProgress = 0;
    void buildCUnionModel((progress) => {
      cUnionBuildProgress = Math.max(0, Math.min(1, progress));
      scheduleCUnionRender();
    }).then((model) => {
      cUnionModel = model;
      cUnionBuildState = 'ready';
      cUnionBuildProgress = 1;
      cUnionBuildError = '';
      if (freeState.cForm === 'c-union') {
        refreshLabels(freeState, model);
        autoPlaceAllFreeVd0FromControls();
      }
      scheduleCUnionRender();
    }).catch((error: unknown) => {
      cUnionBuildState = 'error';
      cUnionBuildError = error instanceof Error ? error.message : 'Cunion construction failed.';
      scheduleCUnionRender();
    });
  }

  function samplingStore(): SamplingStore {
    if (!freeState.sampling) {
      freeState.sampling = { ...EMPTY_SAMPLING_STORE, v: [], c: [], rejected: [] };
    }
    return freeState.sampling;
  }

  function enterSampleMode(): void {
    if (!sampleModeSavedTriangleStates) {
      sampleModeSavedTriangleStates = {};
      for (const triangle of freeState.triangles) {
        if (triangle.id !== 'C' && triangle.id !== 'V0') {
          sampleModeSavedTriangleStates[triangle.id] = { hidden: triangle.hidden, fixed: triangle.fixed };
        }
      }
    }
    for (const triangle of freeState.triangles) {
      if (triangle.id === 'C' || triangle.id === 'V0') {
        triangle.hidden = false;
        triangle.fixed = false;
        continue;
      }
      triangle.hidden = true;
      triangle.fixed = true;
    }
    if (freeState.selectedTriangleId !== 'C' && freeState.selectedTriangleId !== 'V0') {
      freeState.selectedTriangleId = 'V0';
    }
    freeState.selectedSegments = [];
  }

  function leaveSampleMode(): void {
    if (!sampleModeSavedTriangleStates) return;
    for (const triangle of freeState.triangles) {
      const saved = sampleModeSavedTriangleStates[triangle.id];
      if (!saved) continue;
      triangle.hidden = saved.hidden;
      triangle.fixed = saved.fixed;
    }
    sampleModeSavedTriangleStates = null;
  }

  function setFreeTool(nextTool: FreeTool): void {
    if (freeState.tool === 'sample' && nextTool !== 'sample') {
      leaveSampleMode();
    }
    freeState.tool = nextTool;
    if (nextTool === 'sample') {
      enterSampleMode();
      freeState.status = 'Sample mode: move or rotate C and V0 to record live samples.';
    } else if (nextTool === 'd-mark') {
      freeState.status = 'D-mark mode: click two intersecting segments.';
    } else if (nextTool === 's-mark') {
      freeState.status = 'S-mark mode: click two intersecting segments.';
    } else if (nextTool === 'point') {
      freeState.selectedSegments = [];
      freeState.status = 'Point mode: click inside the hexagon to add a seed; drag seed handles to move them.';
    } else {
      freeState.status = 'Move mode: drag selected triangles.';
    }
  }

  function setFreeCForm(nextForm: FreeState['cForm']): void {
    if (freeState.cForm === nextForm) return;
    if (freeState.tool === 'sample') {
      leaveSampleMode();
      freeState.tool = 'move';
    }
    freeState.cForm = nextForm;
    freeState.selectedSegments = [];
    if (nextForm === 'c-union' && freeState.selectedTriangleId === 'C') {
      freeState.selectedTriangleId = 'V4';
    }
    freeState.status = nextForm === 'c-union'
      ? 'Cunion form: move or constrain V triangles.'
      : 'Triangle form: move or constrain C and V triangles.';
    refreshLabels(freeState, cUnionModel);
    if (nextForm === 'c-union') {
      ensureCUnionModel();
    }
    if (nextForm === 'triangle' || cUnionModel) {
      autoPlaceAllFreeVd0FromControls();
    }
  }

  function setCUnionFilter(filter: FreeState['cUnionCeFilter']): void {
    if (freeState.cUnionCeFilter === filter) return;
    freeState.cUnionCeFilter = filter;
    freeState.selectedSegments = [];
    freeState.status = `Cunion filter: ${filter.toUpperCase()}.`;
    refreshLabels(freeState, cUnionModel);
    if (cUnionModel) {
      autoPlaceAllFreeVd0FromControls();
    }
  }

  function captureCurrentSample(): void {
    if (freeState.tool !== 'sample') return;
    enterSampleMode();
    const store = samplingStore();
    const v0 = getTriangle(freeState, 'V0');
    const c = getTriangle(freeState, 'C');
    const vResult = classifyV0Sample(triangleVertices(v0.center, v0.angle), freeState.strictEps);
    const cResult = classifyCSample(triangleVertices(c.center, c.angle), freeState.strictEps);

    if (vResult.ok) {
      freeState.sampling = addSample(store, vResult.sample);
      currentV0Sample = vResult.sample;
    } else {
      freeState.sampling = addRejectedSample(store, vResult.rejected);
      currentV0Sample = vResult.rejected;
    }

    if (cResult.ok) {
      freeState.sampling = addSample(samplingStore(), cResult.sample);
      currentCSample = cResult.sample;
    } else {
      freeState.sampling = addRejectedSample(samplingStore(), cResult.rejected);
      currentCSample = cResult.rejected;
    }
  }

  function autoPlaceAllFreeVd0FromControls(): void {
    syncFreeStrictEps();
    if (freeState.target === 'LOTUS') {
      return;
    }
    if (!freeState.triangles.some((triangle) => triangle.id !== 'C' && triangle.vd0.enabled)) {
      return;
    }
    if (freeState.cForm === 'c-union' && !cUnionModel) {
      return;
    }
    const result = autoPlaceAllFreeVd0Triangles(freeState, cUnionModel);
    refreshLabels(freeState, cUnionModel);
    const failureText = result.ok ? '' : result.failedIds.map((id) => {
      const triangle = getTriangle(freeState, id);
      const status = getFreeVd0Status(freeState, triangle, cUnionModel);
      const maxLabel = triangle.vd0.mode === 'max-c' ? 'max c' : triangle.vd0.mode === 'max-a' ? 'max a' : 'max b';
      return status
        ? `${id} raw=(${status.raw.a.toFixed(3)}, ${status.raw.b.toFixed(3)}, ${status.raw.c.toFixed(3)}), ${maxLabel}=${status.max.toFixed(3)}`
        : id;
    }).join('; ');
    freeState.status = result.ok
      ? 'Vd0 auto-placed enabled triangles.'
      : `Vd0 auto-place failed: ${failureText}.`;
  }

  function summarizeFreeValidation(validation: FreeValidationResult): string {
    const gapSegments = validation.segments
      .filter((segment) => segment.gaps.length > 0)
      .map((segment) => {
        if (freeState.target === 'LOTUS') {
          const firstGap = segment.gaps[0];
          const gapText = firstGap ? ` [${firstGap[0].toFixed(3)}, ${firstGap[1].toFixed(3)}]` : '';
          return `${segment.label ?? `${segment.kind} ${segment.index}`}${gapText}`;
        }
        return `${segment.kind} ${segment.index}`;
      });
    const parts = [
      `${describeTarget(freeState.target)}: ${validation.coverageOk ? 'cover PASS' : 'cover FAIL'}`,
      validation.constraintsOk ? 'constraints PASS' : 'constraints FAIL',
    ];
    if (gapSegments.length > 0) {
      parts.push(`gaps ${gapSegments.slice(0, 5).join(', ')}${gapSegments.length > 5 ? ', ...' : ''}`);
    }
    if (validation.pointFailures.length > 0) {
      parts.push(`missing ${validation.pointFailures.join(', ')}`);
    }
    return parts.join('; ');
  }

  function nextTargetTId(): string {
    const used = new Set(freeState.targetTPoints.map((point) => point.id));
    let index = freeState.targetTPoints.length + 1;
    while (used.has(`t${index}`)) index++;
    return `t${index}`;
  }

  function clearTargetTReferences(targetTId: string): void {
    for (const triangle of freeState.triangles) {
      if (triangle.edgePointConstraint?.point.kind === 'P' && triangle.edgePointConstraint.point.targetTId === targetTId) {
        triangle.edgePointConstraint = null;
      }
      for (const coordinate of ['a', 'b', 'c'] as FreeVd0Coordinate[]) {
        const source = triangle.vd0.rawSources?.[coordinate];
        if (source?.kind === 'P' && source.targetTId === targetTId) {
          delete triangle.vd0.rawSources[coordinate];
        }
      }
    }
  }

  function renderFreeFrame(): void {
    initializeFreeFromCurrentIfNeeded();
    syncFreeStrictEps();
    if (freeState.cForm === 'c-union') {
      ensureCUnionModel();
    } else {
      captureCurrentSample();
    }
    const cUnionReady = freeState.cForm !== 'c-union' || cUnionModel !== null;
    refreshLabels(freeState, cUnionModel);
    currentFreeValidation = validateFreeState(freeState, cUnionModel);
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    freeRender.drawFreeMode(deps.ctx, currentFreeValidation, cUnionReady);
    deps.gammaValues.textContent = freeState.cForm === 'c-union'
      ? `free mode: Cunion (${freeState.cUnionCeFilter}) + six V triangles`
      : 'free mode: seven independent unit triangles';
    deps.localCBounds.textContent = freeState.target === 'S_T'
      ? `target = ${describeTarget(freeState.target)}, ${freeState.targetTPoints.map((target) => `${target.id}=${target.t.toFixed(3)}`).join(', ')}`
      : `target = ${describeTarget(freeState.target)}`;
    deps.localCValues.textContent = freeState.cForm === 'c-union'
      ? `${cUnionReady ? 'sampled closure: 2048 orientations / 4096 rays' : `Cunion ${cUnionBuildState}`}; selected = ${freeState.selectedTriangleId}; tool = ${freeState.tool}`
      : `selected = ${freeState.selectedTriangleId}; tool = ${freeState.tool}`;
    deps.ceStatus.textContent = 'CE/g-chain inactive in Free mode';
    deps.ceChainStatus.textContent = 'Free mode uses direct covering checks';
    deps.coverOverlayStatus.textContent = 'Free mode owns triangle overlay';
    deps.regionRenderer.render();
    freePanel.renderFreePanel(currentFreeValidation, cUnionReady);
    return;
  }

  function bindFreeControls(): void {
    freeControls.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const cFormButton = target.closest<HTMLButtonElement>('[data-free-c-form]');
      if (cFormButton) {
        const form = cFormButton.dataset.freeCForm;
        if (form === 'triangle' || form === 'c-union') {
          setFreeCForm(form);
          deps.render();
        }
        return;
      }
      const cUnionFilterButton = target.closest<HTMLButtonElement>('[data-c-union-filter]');
      if (cUnionFilterButton) {
        const filter = cUnionFilterButton.dataset.cUnionFilter;
        if (filter === 'ce1' || filter === 'ce2' || filter === 'both') {
          setCUnionFilter(filter);
          deps.render();
        }
        return;
      }
      const targetButton = target.closest<HTMLButtonElement>('[data-free-target]');
      if (targetButton) {
        freeState.target = targetButton.dataset.freeTarget as FreeTarget;
        deps.render();
        return;
      }
      const toolButton = target.closest<HTMLButtonElement>('[data-free-tool]');
      if (toolButton) {
        setFreeTool(toolButton.dataset.freeTool as FreeTool);
        deps.render();
        return;
      }
      const clearSamplesButton = target.closest<HTMLButtonElement>('[data-clear-samples]');
      if (clearSamplesButton) {
        freeState.sampling = { v: [], c: [], rejected: [] };
        currentV0Sample = null;
        currentCSample = null;
        freeState.status = 'Cleared sampling data.';
        deps.render();
        return;
      }
      const deletePointSeedButton = target.closest<HTMLButtonElement>('[data-delete-point-seed]');
      if (deletePointSeedButton) {
        deleteSelectedPointSeed();
        deps.render();
        return;
      }
      const clearPointSeedsButton = target.closest<HTMLButtonElement>('[data-clear-point-seeds]');
      if (clearPointSeedsButton) {
        clearPointSeeds();
        deps.render();
        return;
      }
      const addTargetTButton = target.closest<HTMLButtonElement>('[data-add-target-t]');
      if (addTargetTButton) {
        freeState.targetTPoints.push({ id: nextTargetTId(), t: DEFAULT_TARGET_T, fixed: false });
        freeState.status = 'Added S_t point position.';
        refreshLabels(freeState, cUnionModel);
        deps.render();
        return;
      }
      const deleteTargetTButton = target.closest<HTMLButtonElement>('[data-delete-target-t]');
      if (deleteTargetTButton) {
        const id = deleteTargetTButton.dataset.deleteTargetT;
        if (id && freeState.targetTPoints.length > 1) {
          freeState.targetTPoints = freeState.targetTPoints.filter((candidate) => candidate.id !== id);
          clearTargetTReferences(id);
          freeState.status = `Deleted ${id}.`;
          refreshLabels(freeState, cUnionModel);
          deps.render();
        }
        return;
      }
      const selectButton = target.closest<HTMLButtonElement>('[data-select-triangle]');
      if (selectButton) {
        freeState.selectedTriangleId = selectButton.dataset.selectTriangle as FreeTriangleId;
        deps.render();
        return;
      }
      const deleteButton = target.closest<HTMLButtonElement>('[data-delete-label]');
      if (deleteButton) {
        const id = deleteButton.dataset.deleteLabel;
        freeState.labels = freeState.labels.filter((label) => label.id !== id);
        for (const triangle of freeState.triangles) {
          if (triangle.edgePointConstraint?.point.kind === 'label' && triangle.edgePointConstraint.point.labelId === id) {
            triangle.edgePointConstraint = null;
          }
          for (const coordinate of ['a', 'b', 'c'] as FreeVd0Coordinate[]) {
            const source = triangle.vd0.rawSources?.[coordinate];
            if (source?.kind === 'label' && source.labelId === id) {
              delete triangle.vd0.rawSources[coordinate];
            }
          }
        }
        freeState.status = `Deleted ${id}.`;
        refreshLabels(freeState, cUnionModel);
        deps.render();
      }
    });

    freeControls.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement;
      if ('showAllSamples' in target.dataset) {
        showAllSamplePoints = (target as HTMLInputElement).checked;
        deps.render();
        return;
      }
      const targetTFixed = target.dataset.targetTFixed;
      if (targetTFixed) {
        const point = freeState.targetTPoints.find((candidate) => candidate.id === targetTFixed);
        if (point) {
          point.fixed = (target as HTMLInputElement).checked;
        }
        deps.render();
        return;
      }
      const targetTValue = target.dataset.targetTValue;
      if (targetTValue) {
        const point = freeState.targetTPoints.find((candidate) => candidate.id === targetTValue);
        const value = Number((target as HTMLInputElement).value);
        if (point && Number.isFinite(value)) {
          point.t = clamp01(value);
          refreshLabels(freeState, cUnionModel);
        }
        deps.render();
        return;
      }
      const fixed = target.dataset.fixed;
      if (fixed) {
        const triangle = getTriangle(freeState, fixed as FreeTriangleId);
        triangle.fixed = (target as HTMLInputElement).checked;
        if (!triangle.fixed) {
          triangle.hidden = false;
        }
        deps.render();
        return;
      }
      const hidden = target.dataset.hidden;
      if (hidden) {
        const triangle = getTriangle(freeState, hidden as FreeTriangleId);
        triangle.hidden = (target as HTMLInputElement).checked;
        if (triangle.hidden) {
          triangle.fixed = true;
        }
        deps.render();
        return;
      }
      const midpointSetting = target.dataset.midpoint;
      if (midpointSetting) {
        const [id, rawIndex] = midpointSetting.split(':');
        const triangle = getTriangle(freeState, id as FreeTriangleId);
        const index = clampInteger(rawIndex, 0, 5);
        triangle.midpointConstraints[index] = (target as HTMLInputElement).checked;
        projectTriangleToConstraints(freeState, triangle, cUnionModel);
        refreshLabels(freeState, cUnionModel);
        deps.render();
        return;
      }
      const vd0Enabled = target.dataset.vd0Enabled;
      if (vd0Enabled) {
        const triangle = getTriangle(freeState, vd0Enabled as FreeTriangleId);
        triangle.vd0.enabled = (target as HTMLInputElement).checked;
        if (triangle.vd0.enabled) {
          autoPlaceAllFreeVd0FromControls();
        }
        deps.render();
        return;
      }
      const vd0Mode = target.dataset.vd0Mode;
      if (vd0Mode) {
        const triangle = getTriangle(freeState, vd0Mode as FreeTriangleId);
        if (target.value === 'max-c' || target.value === 'max-a' || target.value === 'max-b') {
          triangle.vd0.mode = target.value as FreeVd0Mode;
          if (triangle.vd0.enabled) {
            autoPlaceAllFreeVd0FromControls();
          }
          deps.render();
        }
        return;
      }
      const vd0RawSource = target.dataset.vd0RawSource;
      if (vd0RawSource) {
        const [id, coordinate] = vd0RawSource.split(':') as [FreeTriangleId, FreeVd0Coordinate];
        const triangle = getTriangle(freeState, id);
        if (coordinate !== 'a' && coordinate !== 'b' && coordinate !== 'c') {
          return;
        }
        if (!triangle.vd0.rawSources) {
          triangle.vd0.rawSources = {};
        }
        if (target.value === '') {
          delete triangle.vd0.rawSources[coordinate];
        } else {
          const source = decodeNamedPointRef(target.value);
          if (source?.kind === 'V' || source?.kind === 'M' || source?.kind === 'P' || source?.kind === 'B' || source?.kind === 'label') {
            triangle.vd0.rawSources[coordinate] = source;
          }
        }
        if (triangle.vd0.enabled) {
          autoPlaceAllFreeVd0FromControls();
        }
        deps.render();
        return;
      }
      const edgeIndexTarget = target.dataset.edgeIndex;
      if (edgeIndexTarget) {
        const triangle = getTriangle(freeState, edgeIndexTarget as FreeTriangleId);
        if (target.value === '') {
          triangle.edgePointConstraint = null;
        } else {
          triangle.edgePointConstraint = {
            edgeIndex: clampInteger(target.value, 0, 2),
            point: triangle.edgePointConstraint?.point ?? { kind: 'O' },
          };
          projectTriangleToConstraints(freeState, triangle, cUnionModel);
        }
        refreshLabels(freeState, cUnionModel);
        deps.render();
        return;
      }
      const edgePointTarget = target.dataset.edgePoint;
      if (edgePointTarget) {
        const triangle = getTriangle(freeState, edgePointTarget as FreeTriangleId);
        const point = decodeNamedPointRef(target.value);
        if (point) {
          triangle.edgePointConstraint = {
            edgeIndex: triangle.edgePointConstraint?.edgeIndex ?? 0,
            point,
          };
          projectTriangleToConstraints(freeState, triangle, cUnionModel);
          refreshLabels(freeState, cUnionModel);
          deps.render();
        }
        return;
      }
      const manualXTarget = target.dataset.manualX;
      const manualYTarget = target.dataset.manualY;
      if (manualXTarget || manualYTarget) {
        const triangle = getTriangle(freeState, (manualXTarget ?? manualYTarget) as FreeTriangleId);
        if (!triangle.edgePointConstraint || triangle.edgePointConstraint.point.kind !== 'manual') {
          return;
        }
        const current = triangle.edgePointConstraint.point.manualPoint ?? { x: 0, y: 0 };
        const nextValue = Number(target.value);
        if (!Number.isFinite(nextValue)) {
          return;
        }
        triangle.edgePointConstraint.point.manualPoint = manualXTarget
          ? { x: nextValue, y: current.y }
          : { x: current.x, y: nextValue };
        projectTriangleToConstraints(freeState, triangle, cUnionModel);
        refreshLabels(freeState, cUnionModel);
        deps.render();
      }
    });

    freeStateCopyButton.addEventListener('click', async () => {
      freeStateJson.value = formatFreeSnapshot(freeState);
      try {
        await navigator.clipboard.writeText(freeStateJson.value);
        setFreeStateStatus('Free snapshot copied.');
      } catch {
        freeStateJson.select();
        setFreeStateStatus('Clipboard unavailable. JSON selected for manual copy.');
      }
    });

    freeStateLoadButton.addEventListener('click', () => {
      try {
        loadFreeSnapshot(freeStateJson.value);
        setFreeStateStatus('Free snapshot loaded.');
        deps.render();
      } catch (error) {
        setFreeStateStatus(error instanceof Error ? error.message : 'Failed to load free snapshot.', true);
      }
    });

    freeInteractionApi = setupFreeInteraction(deps.canvas, () => freeState, deps.render, () => cUnionModel, () => {
      if (freeState.tool !== 'sample') {
        autoPlaceAllFreeVd0FromControls();
      }
      deps.render();
    });
  }

  const freeRender = createFreeRenderer({
    get freeState() { return freeState; },
    get cUnionModel() { return cUnionModel; }
  });
  const freeSampling = createSamplingPanel({
    get showAllSamplePoints() { return showAllSamplePoints; },
    get currentV0Sample() { return currentV0Sample; },
    get currentCSample() { return currentCSample; },
    samplingStore,
    get freeState() { return freeState; }
  });
  const freePanel = createFreePanel({
    get freeState() { return freeState; },
    get cUnionModel() { return cUnionModel; },
    pointSeedStatusText,
    freeStatus,
    get cUnionBuildState() { return cUnionBuildState; },
    get cUnionBuildError() { return cUnionBuildError; },
    get cUnionBuildProgress() { return cUnionBuildProgress; },
    summarizeFreeValidation,
    freeControls,
    get renderSamplingPanel() { return freeSampling.renderSamplingPanel; },
    freeStateJson
  });

  return {
    get pointState(): Pick<FreeState, 'pointSeeds' | 'selectedPointSeedId'> { return freeState; },
    pointSeedStatusText,
    normalizeSelectedPointSeed,
    get freeInteractionApi() { return freeInteractionApi; },
    renderFreeFrame,
    syncFreeStrictEps,
    deleteSelectedPointSeed,
    clearPointSeeds,
    addPointSeed,
    movePointSeed,
    selectPointSeed,
    bindFreeControls,
    drawSymmetricPoints: freeRender.drawSymmetricPoints
  };
}

