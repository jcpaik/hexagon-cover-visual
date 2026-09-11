import { isCeDirection } from '../../app/controllerSnapshot';
import { drawCoverageGaps, drawCoverTriangleOverlay, drawMarker } from '../../app/drawing';
import { clamp01, clampToLocalCMax, formatTuple } from '../../app/format';
import type { ChainDescriptor } from '../../app/types';
import { config, mathToCanvas } from '../../coords';
import {
  buildCentralCoverTriangle,
  computeCoverResult,
  type CoverChainDirection,
  type CoverResult,
  type CoverTriangle,
} from '../../cover';
import type { FreeState } from '../../freeTypes';
import { drawHexagon, HEXAGON_VERTICES } from '../../hexagon';
import { setupInteraction } from '../../interaction';
import { computeChainValuesForLocalCs, getEffectiveStrictEps } from '../../maps';
import { createRegionRenderer, type GraphMode } from '../../region';
import { buildSymmetricPointTargets, type SymmetricPointTarget } from '../../symmetricPoints';
import {
  CIRCUMRADIUS,
  drawControlPoint,
  drawShape,
  getCPerimeterIntersections,
  getInnerGammas,
  type CPerimeterIntersections,
  type PerimeterIntersectionInterval,
} from '../../triangle';
import type { Point, ShapeMode, TriangleState } from '../../types';

interface PointCoverageResult {
  targets: SymmetricPointTarget[];
  failures: string[];
}

interface Dependencies {
  readonly triangleState: TriangleState;
  readonly pointState: Pick<FreeState, 'pointSeeds' | 'selectedPointSeedId'>;
  readonly shapeMode: ShapeMode;
  readonly ceIntervalSelect: HTMLSelectElement;
  startValue: number;
  readonly selectedHalfDiagonalIndices: number[];
  readonly ceControls: HTMLDivElement;
  readonly ceDirectionSelect: HTMLSelectElement;
  readonly ceStartResetButton: HTMLButtonElement;
  readonly render: () => void;
  manualLocalCs: number[];
  readonly isCoverOverlayAvailable: () => boolean;
  readonly showCoverOverlay: boolean;
  readonly ctx: CanvasRenderingContext2D;
  hoveredHalfDiagonalIndex: number | null;
  readonly drawSymmetricPoints: (ctx2d: CanvasRenderingContext2D, failureLabels: Set<string>) => void;
  readonly gammaValues: HTMLDivElement;
  readonly localCBounds: HTMLDivElement;
  readonly localCValues: HTMLDivElement;
  readonly ceStatus: HTMLDivElement;
  readonly ceChainStatus: HTMLDivElement;
  readonly coverOverlayStatus: HTMLDivElement;
  readonly regionRenderer: ReturnType<typeof createRegionRenderer>;
  readonly graphMode: GraphMode;
  readonly cSlider: HTMLInputElement;
  readonly cValueLabel: HTMLSpanElement;
  readonly canvas: HTMLCanvasElement;
  readonly toggleSelectedHalfDiagonal: (index: number) => void;
  readonly pointToolActive: boolean;
  readonly addPointSeed: (point: Point) => void;
  readonly movePointSeed: (seedId: string, point: Point) => void;
  readonly selectPointSeed: (seedId: string) => void;
}

export function createBaseController(deps: Dependencies) {
  let currentLocalCMaxima: number[] = Array(6).fill(1);
  let ceDirection: CoverChainDirection = 'ccw';
  let ce2SelectedIntervalIndex = 0;
  let ceStartOverrides: Record<string, number> = {};
  let currentChain: ChainDescriptor | null = null;

  function pointInCoverTriangle(point: Point, triangle: CoverTriangle): boolean {
    return triangle.normals.every((normal, index) =>
      normal.x * point.x + normal.y * point.y <= triangle.lambdas[index] + 1e-9,
    );
  }

  function pointInCurrentCircle(point: Point): boolean {
    return Math.hypot(point.x - deps.triangleState.position.x, point.y - deps.triangleState.position.y) <= CIRCUMRADIUS + 1e-9;
  }

  function computeNonFreePointCoverage(coverResult: CoverResult | null): PointCoverageResult {
    const targets = buildSymmetricPointTargets(deps.pointState.pointSeeds);
    if (targets.length === 0) {
      return { targets, failures: [] };
    }
    const cTriangle = deps.shapeMode === 'triangle' ? buildCentralCoverTriangle(deps.triangleState) : null;
    const triangles = coverResult?.vTriangles ?? [];
    const failures = targets.flatMap((target) => {
      const coveredByCentral = cTriangle !== null
        ? pointInCoverTriangle(target.point, cTriangle)
        : deps.shapeMode === 'circle' && pointInCurrentCircle(target.point);
      const covered = coveredByCentral || triangles.some((triangle) => pointInCoverTriangle(target.point, triangle));
      return covered ? [] : [target.label];
    });
    return { targets, failures };
  }

  function radialPoint(index: number, radius: number): { x: number; y: number; } {
    const vertex = HEXAGON_VERTICES[index];
    return {
      x: vertex.x * radius,
      y: vertex.y * radius,
    };
  }

  function localCPoint(index: number, localC: number): { x: number; y: number; } {
    return radialPoint(index, 1 - localC);
  }

  function edgePoint(index: number, value: number): { x: number; y: number; } {
    const current = HEXAGON_VERTICES[index];
    const previous = HEXAGON_VERTICES[(index + 5) % 6];
    return {
      x: current.x + value * (previous.x - current.x),
      y: current.y + value * (previous.y - current.y),
    };
  }

  function nextEdgePoint(index: number, value: number): Point {
    const current = HEXAGON_VERTICES[index];
    const next = HEXAGON_VERTICES[(index + 1) % 6];
    return {
      x: current.x + value * (next.x - current.x),
      y: current.y + value * (next.y - current.y),
    };
  }

  function canonicalEdgePoint(edgeIndex: number, value: number): Point {
    return nextEdgePoint(edgeIndex, value);
  }

  function drawPropagationMarkers(ctx2d: CanvasRenderingContext2D, chain: ChainDescriptor): void {
    for (let i = 0;i < 6;i++) {
      const vertexIndex = chain.vertexOrder[i] ?? i;
      const point = chain.direction === 'ccw'
        ? edgePoint(vertexIndex, chain.values[i])
        : nextEdgePoint(vertexIndex, chain.values[i]);
      drawMarker(ctx2d, point.x, point.y, i === 0 ? '#ea580c' : '#0f172a');
    }

    const finalVertexIndex = chain.vertexOrder[0] ?? 0;
    const finalPoint = chain.activeCe && chain.selectedInterval !== null
      ? (
        chain.direction === 'ccw'
          ? edgePoint(finalVertexIndex, chain.values[6])
          : nextEdgePoint(finalVertexIndex, chain.values[6])
      )
      : edgePoint(0, chain.values[6]);
    drawMarker(ctx2d, finalPoint.x, finalPoint.y, '#fff', '#dc2626');
  }

  function getLocalCMaxima(gammas: number[]): number[] {
    const strict = getEffectiveStrictEps();
    return gammas.map((gamma) => clamp01(1 + strict - gamma));
  }

  function positiveMod(value: number, modulus: number): number {
    return ((value % modulus) + modulus) % modulus;
  }

  function getDirectionalOrder(interval: PerimeterIntersectionInterval, direction: CoverChainDirection): number[] {
    if (direction === 'ccw') {
      const start = (interval.edgeIndex + 1) % 6;
      return Array.from({ length: 6 }, (_, offset) => (start + offset) % 6);
    }

    return Array.from({ length: 6 }, (_, offset) => positiveMod(interval.edgeIndex - offset, 6));
  }

  function getCeStartAndTarget(
    interval: PerimeterIntersectionInterval,
    direction: CoverChainDirection,
  ): { start: number; target: number; } {
    if (direction === 'ccw') {
      return {
        start: clamp01(1 - interval.end),
        target: clamp01(1 - interval.start),
      };
    }

    return {
      start: clamp01(interval.start),
      target: clamp01(interval.end),
    };
  }

  function getCeIntervalSlot(ce: CPerimeterIntersections): number | null {
    if (ce.kind === 'CE1') {
      return 0;
    }
    if (ce.kind === 'CE2') {
      return ce2SelectedIntervalIndex;
    }
    return null;
  }

  function getCeStartKey(
    interval: PerimeterIntersectionInterval,
    direction: CoverChainDirection,
    slot: number,
  ): string {
    return `${direction}:e${interval.edgeIndex}:i${slot}`;
  }

  function getSelectedCeInterval(ce: CPerimeterIntersections): PerimeterIntersectionInterval | null {
    if (ce.kind === 'CE1') {
      return ce.intervals[0] ?? null;
    }
    if (ce.kind !== 'CE2') {
      return null;
    }

    if (ce2SelectedIntervalIndex >= ce.intervals.length) {
      ce2SelectedIntervalIndex = 0;
      deps.ceIntervalSelect.value = '0';
    }

    return ce.intervals[ce2SelectedIntervalIndex] ?? ce.intervals[0] ?? null;
  }

  function buildChainDescriptor(
    localCs: number[],
    ce: CPerimeterIntersections | null,
  ): ChainDescriptor {
    const selectedInterval = ce === null ? null : getSelectedCeInterval(ce);
    const intervalSlot = ce === null ? null : getCeIntervalSlot(ce);

    if (selectedInterval === null || intervalSlot === null) {
      const values = computeChainValuesForLocalCs(localCs, deps.startValue);
      return {
        activeCe: false,
        direction: 'ccw',
        vertexOrder: [0, 1, 2, 3, 4, 5],
        localCs,
        start: deps.startValue,
        defaultStart: deps.startValue,
        ceStartKey: null,
        target: null,
        values,
        finalValue: values[values.length - 1] ?? deps.startValue,
        passes: null,
        selectedInterval: null,
      };
    }

    const vertexOrder = getDirectionalOrder(selectedInterval, ceDirection);
    const orderedLocalCs = vertexOrder.map((index) => localCs[index] ?? 0);
    const { start: defaultStart, target } = getCeStartAndTarget(selectedInterval, ceDirection);
    const ceStartKey = getCeStartKey(selectedInterval, ceDirection, intervalSlot);
    const start = ceStartOverrides[ceStartKey] ?? defaultStart;
    const values = computeChainValuesForLocalCs(orderedLocalCs, start);
    const finalValue = values[values.length - 1] ?? start;

    return {
      activeCe: true,
      direction: ceDirection,
      vertexOrder,
      localCs: orderedLocalCs,
      start,
      defaultStart,
      ceStartKey,
      target,
      values,
      finalValue,
      passes: finalValue <= target + 1e-6,
      selectedInterval,
    };
  }

  function drawLocalCControls(
    ctx2d: CanvasRenderingContext2D,
    maxima: number[],
    currentLocalCs: number[],
  ): void {
    const handles = currentLocalCs.map((value, index) => localCPoint(index, value));

    ctx2d.save();
    ctx2d.strokeStyle = '#fef3c7';
    ctx2d.lineWidth = 2;
    for (let i = 0;i < 6;i++) {
      const start = mathToCanvas(localCPoint(i, maxima[i]));
      const end = mathToCanvas(HEXAGON_VERTICES[i]);
      ctx2d.beginPath();
      ctx2d.moveTo(start.x, start.y);
      ctx2d.lineTo(end.x, end.y);
      ctx2d.stroke();
    }

    ctx2d.beginPath();
    handles.forEach((point, index) => {
      const canvasPoint = mathToCanvas(point);
      if (index === 0) {
        ctx2d.moveTo(canvasPoint.x, canvasPoint.y);
      } else {
        ctx2d.lineTo(canvasPoint.x, canvasPoint.y);
      }
    });
    ctx2d.closePath();
    ctx2d.fillStyle = 'rgba(254, 240, 138, 0.18)';
    ctx2d.strokeStyle = '#fde68a';
    ctx2d.lineWidth = 1.5;
    ctx2d.fill();
    ctx2d.stroke();

    for (const point of handles) {
      const canvasPoint = mathToCanvas(point);
      ctx2d.beginPath();
      ctx2d.arc(canvasPoint.x, canvasPoint.y, 6, 0, 2 * Math.PI);
      ctx2d.fillStyle = '#facc15';
      ctx2d.fill();
      ctx2d.strokeStyle = '#a16207';
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawHoveredHalfDiagonal(ctx2d: CanvasRenderingContext2D, index: number | null): void {
    if (index === null) {
      return;
    }

    ctx2d.save();
    const start = mathToCanvas({ x: 0, y: 0 });
    const end = mathToCanvas(HEXAGON_VERTICES[index]);
    ctx2d.strokeStyle = '#facc15';
    ctx2d.lineWidth = 4;
    ctx2d.beginPath();
    ctx2d.moveTo(start.x, start.y);
    ctx2d.lineTo(end.x, end.y);
    ctx2d.stroke();
    ctx2d.restore();
  }

  function drawSelectedHalfDiagonals(ctx2d: CanvasRenderingContext2D, indices: number[]): void {
    if (indices.length === 0) {
      return;
    }

    ctx2d.save();
    ctx2d.strokeStyle = '#f59e0b';
    ctx2d.lineWidth = 3;
    for (const index of indices) {
      const start = mathToCanvas({ x: 0, y: 0 });
      const end = mathToCanvas(HEXAGON_VERTICES[index]);
      ctx2d.beginPath();
      ctx2d.moveTo(start.x, start.y);
      ctx2d.lineTo(end.x, end.y);
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  function drawCeIntervals(
    ctx2d: CanvasRenderingContext2D,
    intervals: PerimeterIntersectionInterval[],
    selectedInterval: PerimeterIntersectionInterval | null,
  ): void {
    if (intervals.length === 0) {
      return;
    }

    ctx2d.save();
    ctx2d.lineCap = 'round';
    ctx2d.font = '13px monospace';

    intervals.forEach((interval, index) => {
      const isSelected = selectedInterval === interval;
      const start = mathToCanvas(canonicalEdgePoint(interval.edgeIndex, interval.start));
      const end = mathToCanvas(canonicalEdgePoint(interval.edgeIndex, interval.end));
      const labelPoint = mathToCanvas(canonicalEdgePoint(interval.edgeIndex, (interval.start + interval.end) / 2));

      ctx2d.beginPath();
      ctx2d.moveTo(start.x, start.y);
      ctx2d.lineTo(end.x, end.y);
      ctx2d.strokeStyle = isSelected ? '#2563eb' : '#38bdf8';
      ctx2d.lineWidth = isSelected ? 7 : 5;
      ctx2d.stroke();

      ctx2d.fillStyle = isSelected ? '#1d4ed8' : '#0369a1';
      ctx2d.fillText(index === 0 ? 'AB' : 'CD', labelPoint.x + 5, labelPoint.y - 5);
    });

    ctx2d.restore();
  }

  function formatInterval(interval: PerimeterIntersectionInterval, label: string): string {
    return `${label}: e${interval.edgeIndex} [${interval.start.toFixed(3)}, ${interval.end.toFixed(3)}]`;
  }

  function getSelectedLocalCsForChain(chain: ChainDescriptor, localCs: number[]): number[] {
    const selected = new Set(deps.selectedHalfDiagonalIndices);
    const orderedIndices = chain.activeCe ? chain.vertexOrder : [0, 1, 2, 3, 4, 5];
    return orderedIndices
      .filter((index) => selected.has(index))
      .map((index) => localCs[index] ?? 0);
  }

  function getSelectedLocalCsLabel(chain: ChainDescriptor): string {
    if (deps.selectedHalfDiagonalIndices.length === 0) {
      return '';
    }

    const selected = new Set(deps.selectedHalfDiagonalIndices);
    const orderedIndices = chain.activeCe ? chain.vertexOrder : [0, 1, 2, 3, 4, 5];
    const labels = orderedIndices
      .filter((index) => selected.has(index))
      .map((index) => `V${index}`)
      .join(' -> ');

    return labels.length === 0 ? '' : `selected ${labels}`;
  }

  function getHoverLocalCLabel(chain: ChainDescriptor, index: number, localC: number): string {
    if (!chain.activeCe) {
      return `hover V${index}: g_c, c = ${localC.toFixed(3)}`;
    }

    const chainPosition = chain.vertexOrder.indexOf(index);
    const suffix = chainPosition < 0 ? '' : `, step ${chainPosition + 1}`;
    return `hover V${index}${suffix}: g_c, c = ${localC.toFixed(3)}`;
  }

  function summarizeCe(ce: CPerimeterIntersections | null): string {
    if (ce === null) {
      return 'CE: triangle mode only';
    }

    if (ce.kind === 'unsupported') {
      return `CE: unsupported (${ce.reason ?? 'degenerate position'})`;
    }

    if (ce.intervals.length === 0) {
      return 'CE0: no perimeter interval';
    }

    return `${ce.kind}: ${ce.intervals.map((interval, index) =>
      formatInterval(interval, index === 0 ? 'AB' : 'CD'),
    ).join('; ')}`;
  }

  function summarizeCeChain(chain: ChainDescriptor): string {
    if (!chain.activeCe || chain.target === null || chain.passes === null) {
      return 'CE chain inactive';
    }

    const status = chain.passes ? 'PASS' : 'FAIL';
    const order = chain.vertexOrder.map((index) => `V${index}`).join(' -> ');
    return `${status}: ${chain.direction}; start ${chain.start.toFixed(3)} -> ${chain.finalValue.toFixed(3)} <= target ${chain.target.toFixed(3)}; ${order}`;
  }

  function syncCeControls(ce: CPerimeterIntersections | null): void {
    const active = deps.shapeMode === 'triangle' && ce !== null && (ce.kind === 'CE1' || ce.kind === 'CE2');
    deps.ceControls.hidden = !active;
    deps.ceIntervalSelect.hidden = ce?.kind !== 'CE2';
    deps.ceIntervalSelect.parentElement!.hidden = ce?.kind !== 'CE2';
    deps.ceDirectionSelect.disabled = !active;
    deps.ceIntervalSelect.disabled = ce?.kind !== 'CE2';
    deps.ceStartResetButton.disabled = !active;
    deps.ceDirectionSelect.value = ceDirection;
    deps.ceIntervalSelect.value = ce2SelectedIntervalIndex.toString();
  }

  function getCurrentStartValueSegment(): { start: Point; end: Point; } {
    const chain = currentChain;
    if (chain?.activeCe && chain.selectedInterval !== null) {
      const vertexIndex = chain.vertexOrder[0] ?? 0;
      const current = HEXAGON_VERTICES[vertexIndex];
      const adjacent = chain.direction === 'ccw'
        ? HEXAGON_VERTICES[(vertexIndex + 5) % 6]
        : HEXAGON_VERTICES[(vertexIndex + 1) % 6];
      return { start: current, end: adjacent };
    }

    return {
      start: HEXAGON_VERTICES[0],
      end: HEXAGON_VERTICES[5],
    };
  }

  function setCurrentStartValue(value: number): void {
    const chain = currentChain;
    if (chain?.activeCe && chain.ceStartKey !== null) {
      ceStartOverrides = {
        ...ceStartOverrides,
        [chain.ceStartKey]: clamp01(value),
      };
      return;
    }

    deps.startValue = clamp01(value);
  }

  function resetCurrentCeStart(): void {
    const key = currentChain?.ceStartKey;
    if (!key) {
      return;
    }

    const { [key]: _removed, ...remaining } = ceStartOverrides;
    ceStartOverrides = remaining;
    deps.render();
  }

  function summarizeCoverResult(result: CoverResult, pointCoverage: PointCoverageResult): string {
    const gapSegments = result.segments
      .filter((segment) => segment.gaps.length > 0)
      .map((segment) => `${segment.kind} ${segment.index}`);
    const sizeText = result.tooLargeTriangles.length === 0
      ? 'perimeter sides < 1'
      : `perimeter side >= 1: ${result.tooLargeTriangles.join(', ')}`;
    const pointText = pointCoverage.targets.length === 0
      ? ''
      : pointCoverage.failures.length === 0
        ? `; D6 points PASS (${pointCoverage.targets.length})`
        : `; D6 missing ${pointCoverage.failures.slice(0, 8).join(', ')}${pointCoverage.failures.length > 8 ? ', ...' : ''}`;

    if (gapSegments.length === 0 && pointCoverage.failures.length === 0) {
      return `cover: PASS; ${sizeText}${pointText}`;
    }

    const gapText = gapSegments.length > 0
      ? `gaps on ${gapSegments.slice(0, 6).join(', ')}${gapSegments.length > 6 ? ', ...' : ''}`
      : 'no segment gaps';
    return `cover: ${gapText}; ${sizeText}${pointText}`;
  }

  function renderBaseFrame(): void {
    let gammas: number[];
    let maxima: number[];
    let localCs: number[];
    const strict = getEffectiveStrictEps();
    if (deps.shapeMode === 'local-c') {
      gammas = Array(6).fill(0);
      maxima = Array(6).fill(1);
      deps.manualLocalCs = deps.manualLocalCs.map((value) => clampToLocalCMax(value, 1));
      localCs = deps.manualLocalCs.slice();
    } else {
      gammas = getInnerGammas(deps.triangleState, deps.shapeMode);
      maxima = getLocalCMaxima(gammas);
      localCs = maxima;
    }
    currentLocalCMaxima = maxima.slice();
    const ce = deps.shapeMode === 'triangle' ? getCPerimeterIntersections(deps.triangleState) : null;
    const chain = buildChainDescriptor(localCs, ce);
    currentChain = chain;
    const needsPointCoverage = deps.pointState.pointSeeds.length > 0;
    const coverResult = deps.isCoverOverlayAvailable() && (deps.showCoverOverlay || needsPointCoverage)
      ? computeCoverResult(
        deps.triangleState,
        chain.localCs,
        chain.start,
        strict,
        chain.vertexOrder,
        chain.direction,
        deps.shapeMode === 'triangle',
      )
      : null;
    const pointCoverage = computeNonFreePointCoverage(coverResult);
    syncCeControls(ce);
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    if (coverResult && deps.showCoverOverlay) {
      drawCoverTriangleOverlay(deps.ctx, coverResult.vTriangles);
    }
    drawSelectedHalfDiagonals(deps.ctx, deps.selectedHalfDiagonalIndices);
    drawHoveredHalfDiagonal(deps.ctx, deps.hoveredHalfDiagonalIndex);
    drawShape(deps.ctx, deps.triangleState, deps.shapeMode);
    if (deps.shapeMode === 'triangle') {
      drawControlPoint(deps.ctx, deps.triangleState);
      drawCeIntervals(deps.ctx, ce?.intervals ?? [], chain.selectedInterval);
    }
    deps.drawSymmetricPoints(deps.ctx, new Set(pointCoverage.failures));
    if (deps.shapeMode === 'local-c') {
      deps.gammaValues.textContent = 'manual c_i mode';
      deps.localCBounds.textContent = `max c = ${formatTuple(maxima)}`;
      deps.localCValues.textContent = `c = ${formatTuple(localCs)}`;
      drawLocalCControls(deps.ctx, maxima, localCs);
    } else {
      deps.gammaValues.textContent = `γ = ${formatTuple(gammas)}`;
      deps.localCBounds.textContent = strict > 0
        ? `1 - γ + strictEps = ${formatTuple(maxima)}`
        : `1 - γ = ${formatTuple(maxima)}`;
      deps.localCValues.textContent = `c = ${formatTuple(localCs)}`;
    }
    deps.ceStatus.textContent = summarizeCe(ce);
    deps.ceStatus.style.color = ce?.kind === 'unsupported' ? '#b91c1c' : '#475569';
    deps.ceChainStatus.textContent = summarizeCeChain(chain);
    deps.ceChainStatus.style.color = chain.passes === null ? '#475569' : chain.passes ? '#047857' : '#b91c1c';
    drawPropagationMarkers(deps.ctx, chain);
    if (coverResult && deps.showCoverOverlay) {
      drawCoverageGaps(deps.ctx, coverResult.segments);
      deps.coverOverlayStatus.textContent = summarizeCoverResult(coverResult, pointCoverage);
      deps.coverOverlayStatus.style.color = coverResult.coverageOk && pointCoverage.failures.length === 0 && coverResult.tooLargeTriangles.length === 0
        ? '#047857'
        : '#b91c1c';
    } else if (coverResult) {
      deps.coverOverlayStatus.textContent = summarizeCoverResult(coverResult, pointCoverage);
      deps.coverOverlayStatus.style.color = coverResult.coverageOk && pointCoverage.failures.length === 0 && coverResult.tooLargeTriangles.length === 0
        ? '#047857'
        : '#b91c1c';
    } else if (!deps.isCoverOverlayAvailable()) {
      deps.coverOverlayStatus.textContent = 'Free mode owns triangle overlay';
      deps.coverOverlayStatus.style.color = '#64748b';
    } else {
      deps.coverOverlayStatus.textContent = 'cover overlay off';
      deps.coverOverlayStatus.style.color = '#475569';
    }
    deps.regionRenderer.setMode(deps.graphMode);
    deps.regionRenderer.setSingleParameter(parseFloat(deps.cSlider.value));
    deps.regionRenderer.setLocalCs(chain.localCs);
    deps.regionRenderer.setSelectedLocalCs(
      getSelectedLocalCsForChain(chain, localCs),
      getSelectedLocalCsLabel(chain),
    );
    deps.regionRenderer.setStartValue(chain.start);
    deps.regionRenderer.setHoverLocalC(
      deps.hoveredHalfDiagonalIndex === null ? null : localCs[deps.hoveredHalfDiagonalIndex] ?? null,
      deps.hoveredHalfDiagonalIndex === null
        ? undefined
        : getHoverLocalCLabel(chain, deps.hoveredHalfDiagonalIndex, localCs[deps.hoveredHalfDiagonalIndex] ?? 0),
    );
    deps.regionRenderer.render();
  }

  function bindBaseControls(): void {
    deps.cSlider.addEventListener('input', () => {
      const c = parseFloat(deps.cSlider.value);
      deps.cValueLabel.textContent = c.toFixed(2);
      deps.render();
    });

    deps.ceDirectionSelect.addEventListener('change', () => {
      if (isCeDirection(deps.ceDirectionSelect.value)) {
        ceDirection = deps.ceDirectionSelect.value;
        deps.render();
      }
    });

    deps.ceIntervalSelect.addEventListener('change', () => {
      ce2SelectedIntervalIndex = deps.ceIntervalSelect.value === '1' ? 1 : 0;
      deps.render();
    });

    deps.ceStartResetButton.addEventListener('click', resetCurrentCeStart);

    setupInteraction(
      deps.canvas,
      deps.triangleState,
      () => deps.shapeMode,
      () => currentLocalCMaxima,
      () => deps.manualLocalCs,
      (index, value) => {
        deps.manualLocalCs[index] = clampToLocalCMax(value, currentLocalCMaxima[index] ?? 1);
      },
      deps.render,
      (value) => {
        setCurrentStartValue(value);
      },
      getCurrentStartValueSegment,
      (index) => {
        if (deps.hoveredHalfDiagonalIndex === index) {
          return;
        }
        deps.hoveredHalfDiagonalIndex = index;
        deps.render();
      },
      (index) => {
        deps.toggleSelectedHalfDiagonal(index);
        deps.render();
      },
      {
        isActive: () => deps.pointToolActive,
        seeds: () => deps.pointState.pointSeeds,
        create: deps.addPointSeed,
        move: deps.movePointSeed,
        select: deps.selectPointSeed,
      },
    );
  }

  return {
    get ceDirection() { return ceDirection; },
    set ceDirection(value: CoverChainDirection) { ceDirection = value; },
    get ce2SelectedIntervalIndex() { return ce2SelectedIntervalIndex; },
    set ce2SelectedIntervalIndex(value: number) { ce2SelectedIntervalIndex = value; },
    get ceStartOverrides() { return ceStartOverrides; },
    set ceStartOverrides(value: Record<string, number>) { ceStartOverrides = value; },
    getLocalCMaxima,
    buildChainDescriptor,
    renderBaseFrame,
    bindBaseControls
  };
}
