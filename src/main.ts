import './style.css';
import type { Point, ShapeMode, TriangleState } from './types';
import { config, mathToCanvas, setCanvasSize } from './coords';
import { drawHexagon, HEXAGON_VERTICES } from './hexagon';
import {
  computeChainValuesForLocalCs,
  getAdmissibleOrderedSource,
  getEffectiveStrictEps,
  getStrictEps,
  isCustomAdmissibleOrderedSourceActive,
  isStrictCheckEnabled,
  resetAdmissibleOrderedSource,
  setAdmissibleOrderedSource,
  setStrictCheckEnabled,
  setStrictEps,
} from './maps';
import {
  drawControlPoint,
  drawShape,
  getCPerimeterIntersections,
  getInnerGammas,
  type CPerimeterIntersections,
  type PerimeterIntersectionInterval,
} from './triangle';
import { setupInteraction } from './interaction';
import { createRegionRenderer, type GraphMode } from './region';
import {
  computeCoverResult,
  type CoverChainDirection,
  type CoverResult,
  type CoverSegmentReport,
  type CoverTriangle,
} from './cover';
import {
  allowedMidpointIndices,
  autoPlaceAllFreeVd0Triangles,
  colorForTriangle,
  createDefaultFreeState,
  describeTarget,
  getSegmentByRef,
  getFreeVd0Status,
  getFreeVd0RawSourceOptions,
  getTriangle,
  midpoint,
  namedPointLabel,
  projectTriangleToConstraints,
  refreshLabels,
  sameSegmentRef,
  triangleVertices,
  validateFreeState,
} from './freeGeometry';
import { setupFreeInteraction } from './freeInteraction';
import type {
  FreeNamedPointRef,
  FreeState,
  FreeTarget,
  FreeTool,
  FreeTriangleId,
  FreeVd0Coordinate,
  FreeVd0Mode,
  FreeValidationResult,
} from './freeTypes';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const MAX_CANVAS_SIZE = 600;

// Graph canvas (right side)
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
const strictEpsControls = document.getElementById('strict-eps-controls') as HTMLDivElement;
const strictEpsSlider = document.getElementById('strict-eps-slider') as HTMLInputElement;
const strictEpsValueLabel = document.getElementById('strict-eps-value') as HTMLSpanElement;
const strictEpsInput = document.getElementById('strict-eps-input') as HTMLInputElement;
const strictEpsMaxInput = document.getElementById('strict-eps-max-input') as HTMLInputElement;
const coverOverlayToggle = document.getElementById('cover-overlay-toggle') as HTMLInputElement;
const coverOverlayToggleRow = document.getElementById('cover-overlay-toggle-row') as HTMLLabelElement;
const coverOverlayStatus = document.getElementById('cover-overlay-status') as HTMLDivElement;
const ceStatus = document.getElementById('ce-status') as HTMLDivElement;
const ceControls = document.getElementById('ce-controls') as HTMLDivElement;
const ceIntervalSelect = document.getElementById('ce-interval-select') as HTMLSelectElement;
const ceDirectionSelect = document.getElementById('ce-direction-select') as HTMLSelectElement;
const ceStartResetButton = document.getElementById('ce-start-reset') as HTMLButtonElement;
const ceChainStatus = document.getElementById('ce-chain-status') as HTMLDivElement;
const freePanel = document.getElementById('free-panel') as HTMLDivElement;
const freeStatus = document.getElementById('free-status') as HTMLDivElement;
const freeControls = document.getElementById('free-controls') as HTMLDivElement;
const freeStateJson = document.getElementById('free-state-json') as HTMLTextAreaElement;
const freeStateStatus = document.getElementById('free-state-status') as HTMLDivElement;
const freeStateCopyButton = document.getElementById('free-state-copy') as HTMLButtonElement;
const freeStateLoadButton = document.getElementById('free-state-load') as HTMLButtonElement;

const triangleState: TriangleState = {
  position: { x: 0, y: 0 },
  angle: 0,
  controlPoint: { x: 0, y: 0 },
};
const DEFAULT_STRICT_EPS_UPPER_BOUND = 0.0001;
let startValue = 0.25;
let graphMode: GraphMode = 'composition';
let shapeMode: ShapeMode = 'triangle';
let currentLocalCMaxima = Array(6).fill(1);
let manualLocalCs = Array(6).fill(0.5);
let admissibleEditorTimer: number | null = null;
let hoveredHalfDiagonalIndex: number | null = null;
let selectedHalfDiagonalIndices: number[] = [];
let strictEpsUpperBound = DEFAULT_STRICT_EPS_UPPER_BOUND;
let showCoverOverlay = false;
let ceDirection: CoverChainDirection = 'ccw';
let ce2SelectedIntervalIndex = 0;
let ceStartOverrides: Record<string, number> = {};
let currentChain: ChainDescriptor | null = null;
let freeState: FreeState = createDefaultFreeState();
let freeInitializedFromCurrent = false;
let currentFreeValidation: FreeValidationResult | null = null;
let freeInteractionApi: ReturnType<typeof setupFreeInteraction> | null = null;

interface ControllerSnapshot {
  version: 3;
  shapeMode: ShapeMode;
  graphMode: GraphMode;
  startValue: number;
  singleParameter: number;
  triangleState: TriangleState;
  manualLocalCs: number[];
  selectedHalfDiagonalIndices: number[];
  admissibleSource: string;
  strictCheckEnabled: boolean;
  strictEps: number;
  strictEpsUpperBound: number;
  showCoverOverlay: boolean;
  ceDirection: CoverChainDirection;
  ce2SelectedIntervalIndex: number;
  ceStartOverrides: Record<string, number>;
}

type RawControllerSnapshot = Omit<Partial<ControllerSnapshot>, 'version'> & { version?: 1 | 2 | 3 };

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

function formatTuple(values: number[]): string {
  return `(${values.map((value) => value.toFixed(3)).join(', ')})`;
}

function drawMarker(ctx2d: CanvasRenderingContext2D, x: number, y: number, fill: string, stroke?: string): void {
  const point = mathToCanvas({ x, y });
  ctx2d.beginPath();
  ctx2d.arc(point.x, point.y, 5, 0, 2 * Math.PI);
  ctx2d.fillStyle = fill;
  ctx2d.fill();
  if (stroke) {
    ctx2d.strokeStyle = stroke;
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
  }
}

function radialPoint(index: number, radius: number): { x: number; y: number } {
  const vertex = HEXAGON_VERTICES[index];
  return {
    x: vertex.x * radius,
    y: vertex.y * radius,
  };
}

function localCPoint(index: number, localC: number): { x: number; y: number } {
  return radialPoint(index, 1 - localC);
}

function edgePoint(index: number, value: number): { x: number; y: number } {
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

function segmentPoint(start: Point, end: Point, value: number): Point {
  return {
    x: start.x + value * (end.x - start.x),
    y: start.y + value * (end.y - start.y),
  };
}

interface ChainDescriptor {
  activeCe: boolean;
  direction: CoverChainDirection;
  vertexOrder: number[];
  localCs: number[];
  start: number;
  defaultStart: number;
  ceStartKey: string | null;
  target: number | null;
  values: number[];
  finalValue: number;
  passes: boolean | null;
  selectedInterval: PerimeterIntersectionInterval | null;
}

function drawPropagationMarkers(ctx2d: CanvasRenderingContext2D, chain: ChainDescriptor): void {
  for (let i = 0; i < 6; i++) {
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
): { start: number; target: number } {
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

function sanitizeCeStartOverrides(input: unknown): Record<string, number> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {};
  }

  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      output[key] = clamp01(value);
    }
  }
  return output;
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
    ceIntervalSelect.value = '0';
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
    const values = computeChainValuesForLocalCs(localCs, startValue);
    return {
      activeCe: false,
      direction: 'ccw',
      vertexOrder: [0, 1, 2, 3, 4, 5],
      localCs,
      start: startValue,
      defaultStart: startValue,
      ceStartKey: null,
      target: null,
      values,
      finalValue: values[values.length - 1] ?? startValue,
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

function clampToLocalCMax(value: number, maxValue: number): number {
  return Math.max(0, Math.min(maxValue, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function clampStrictEpsUpperBound(value: number): number {
  const clamped = clampNonNegative(value);
  return clamped > 0 ? clamped : DEFAULT_STRICT_EPS_UPPER_BOUND;
}

function clampStrictEpsValue(value: number, upperBound: number): number {
  return Math.min(clampStrictEpsUpperBound(upperBound), clampNonNegative(value));
}

function formatStrictEps(value: number): string {
  return clampNonNegative(value).toFixed(7);
}

function getStrictEpsStep(upperBound: number): string {
  const safeUpperBound = clampStrictEpsUpperBound(upperBound);
  return Math.max(safeUpperBound / 1000, 1e-9).toString();
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Point>;
  return typeof candidate.x === 'number' && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number' && Number.isFinite(candidate.y);
}

function isShapeMode(value: unknown): value is ShapeMode {
  return value === 'triangle' || value === 'local-c' || value === 'circle' || value === 'free';
}

function isGraphMode(value: unknown): value is GraphMode {
  return value === 'composition' || value === 'single' || value === 'pair';
}

function isCeDirection(value: unknown): value is CoverChainDirection {
  return value === 'ccw' || value === 'cw';
}

function formatControllerSnapshot(snapshot: ControllerSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function setControllerStateStatus(text: string, isError = false): void {
  controllerStateStatus.textContent = text;
  controllerStateStatus.style.color = isError ? '#b91c1c' : '#475569';
}

function getControllerSnapshot(): ControllerSnapshot {
  return {
    version: 3,
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
    ceDirection,
    ce2SelectedIntervalIndex,
    ceStartOverrides: sanitizeCeStartOverrides(ceStartOverrides),
  };
}

function syncControllerSnapshot(): void {
  controllerState.value = formatControllerSnapshot(getControllerSnapshot());
  setControllerStateStatus('Snapshot updates automatically.');
}

function parseControllerSnapshot(raw: string): ControllerSnapshot {
  const parsed = JSON.parse(raw) as RawControllerSnapshot;

  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) {
    throw new Error('Unsupported snapshot version.');
  }
  if (!isShapeMode(parsed.shapeMode)) {
    throw new Error('Invalid shapeMode.');
  }
  if (!isGraphMode(parsed.graphMode)) {
    throw new Error('Invalid graphMode.');
  }
  if (typeof parsed.startValue !== 'number' || !Number.isFinite(parsed.startValue)) {
    throw new Error('Invalid startValue.');
  }
  if (typeof parsed.singleParameter !== 'number' || !Number.isFinite(parsed.singleParameter)) {
    throw new Error('Invalid singleParameter.');
  }
  if (typeof parsed.triangleState !== 'object' || parsed.triangleState === null) {
    throw new Error('Invalid triangleState.');
  }
  if (!isPoint(parsed.triangleState.position) || !isPoint(parsed.triangleState.controlPoint)) {
    throw new Error('Invalid triangleState points.');
  }
  if (typeof parsed.triangleState.angle !== 'number' || !Number.isFinite(parsed.triangleState.angle)) {
    throw new Error('Invalid triangleState angle.');
  }
  if (!Array.isArray(parsed.manualLocalCs) || parsed.manualLocalCs.length !== 6) {
    throw new Error('manualLocalCs must be an array of length 6.');
  }
  if (!parsed.manualLocalCs.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('manualLocalCs must contain only finite numbers.');
  }
  if (!Array.isArray(parsed.selectedHalfDiagonalIndices)) {
    throw new Error('selectedHalfDiagonalIndices must be an array.');
  }
  if (!parsed.selectedHalfDiagonalIndices.every((value) => Number.isInteger(value) && value >= 0 && value < 6)) {
    throw new Error('selectedHalfDiagonalIndices must contain integers from 0 to 5.');
  }
  if (typeof parsed.admissibleSource !== 'string') {
    throw new Error('Invalid admissibleSource.');
  }
  if ('strictCheckEnabled' in parsed && typeof parsed.strictCheckEnabled !== 'boolean') {
    throw new Error('Invalid strictCheckEnabled.');
  }
  if ('strictEps' in parsed && (typeof parsed.strictEps !== 'number' || !Number.isFinite(parsed.strictEps))) {
    throw new Error('Invalid strictEps.');
  }
  if (
    'strictEpsUpperBound' in parsed
    && (
      typeof parsed.strictEpsUpperBound !== 'number'
      || !Number.isFinite(parsed.strictEpsUpperBound)
      || parsed.strictEpsUpperBound <= 0
    )
  ) {
    throw new Error('Invalid strictEpsUpperBound.');
  }
  if ('showCoverOverlay' in parsed && typeof parsed.showCoverOverlay !== 'boolean') {
    throw new Error('Invalid showCoverOverlay.');
  }
  if ('ceDirection' in parsed && !isCeDirection(parsed.ceDirection)) {
    throw new Error('Invalid ceDirection.');
  }
  if (
    'ce2SelectedIntervalIndex' in parsed
    && (
      typeof parsed.ce2SelectedIntervalIndex !== 'number'
      || !Number.isInteger(parsed.ce2SelectedIntervalIndex)
      || parsed.ce2SelectedIntervalIndex < 0
      || parsed.ce2SelectedIntervalIndex > 1
    )
  ) {
    throw new Error('Invalid ce2SelectedIntervalIndex.');
  }
  if (
    'ceStartOverrides' in parsed
    && (
      typeof parsed.ceStartOverrides !== 'object'
      || parsed.ceStartOverrides === null
      || Array.isArray(parsed.ceStartOverrides)
    )
  ) {
    throw new Error('Invalid ceStartOverrides.');
  }

  const parsedStrictEpsUpperBound = clampStrictEpsUpperBound(
    parsed.strictEpsUpperBound ?? DEFAULT_STRICT_EPS_UPPER_BOUND,
  );

  return {
    version: 3,
    shapeMode: parsed.shapeMode,
    graphMode: parsed.graphMode,
    startValue: clamp01(parsed.startValue),
    singleParameter: clamp01(parsed.singleParameter),
    triangleState: {
      position: { ...parsed.triangleState.position },
      angle: parsed.triangleState.angle,
      controlPoint: { ...parsed.triangleState.controlPoint },
    },
    manualLocalCs: parsed.manualLocalCs.map(clamp01),
    selectedHalfDiagonalIndices: Array.from(new Set(parsed.selectedHalfDiagonalIndices)),
    admissibleSource: parsed.admissibleSource,
    strictCheckEnabled: parsed.strictCheckEnabled ?? false,
    strictEps: clampStrictEpsValue(parsed.strictEps ?? 0, parsedStrictEpsUpperBound),
    strictEpsUpperBound: parsedStrictEpsUpperBound,
    showCoverOverlay: parsed.showCoverOverlay ?? false,
    ceDirection: parsed.ceDirection ?? 'ccw',
    ce2SelectedIntervalIndex: parsed.ce2SelectedIntervalIndex ?? 0,
    ceStartOverrides: sanitizeCeStartOverrides(parsed.ceStartOverrides),
  };
}

function loadControllerSnapshot(raw: string): void {
  const snapshot = parseControllerSnapshot(raw);
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
  ceDirection = snapshot.ceDirection;
  ce2SelectedIntervalIndex = snapshot.ce2SelectedIntervalIndex;
  ceStartOverrides = { ...snapshot.ceStartOverrides };
  ceDirectionSelect.value = ceDirection;
  ceIntervalSelect.value = ce2SelectedIntervalIndex.toString();
  setStrictCheckEnabled(snapshot.strictCheckEnabled);
  setStrictEps(snapshot.strictEps);
  syncStrictCheckControls();
  syncAdmissibleEditorStatus();
  syncModeButtons();
  render();
  syncControllerSnapshot();
  setControllerStateStatus('Snapshot loaded.');
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
  for (let i = 0; i < 6; i++) {
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

function drawCoverTriangleOverlay(ctx2d: CanvasRenderingContext2D, triangles: CoverTriangle[]): void {
  ctx2d.save();
  for (const triangle of triangles) {
    const vertices = triangle.vertices.map(mathToCanvas);
    ctx2d.beginPath();
    ctx2d.moveTo(vertices[0].x, vertices[0].y);
    ctx2d.lineTo(vertices[1].x, vertices[1].y);
    ctx2d.lineTo(vertices[2].x, vertices[2].y);
    ctx2d.closePath();
    ctx2d.fillStyle = `${triangle.color}29`;
    ctx2d.strokeStyle = triangle.color;
    ctx2d.lineWidth = 2;
    ctx2d.fill();
    ctx2d.stroke();

    const label = mathToCanvas(triangle.center);
    ctx2d.fillStyle = triangle.side >= 1 - 1e-9 ? '#b91c1c' : triangle.color;
    ctx2d.font = '13px monospace';
    ctx2d.fillText(triangle.name, label.x + 6, label.y - 6);
  }
  ctx2d.restore();
}

function drawCoverageGaps(ctx2d: CanvasRenderingContext2D, segments: CoverSegmentReport[]): void {
  ctx2d.save();
  ctx2d.strokeStyle = '#dc2626';
  ctx2d.lineWidth = 5;
  ctx2d.lineCap = 'round';

  for (const segment of segments) {
    const start = segment.kind === 'edge'
      ? HEXAGON_VERTICES[segment.index]
      : { x: 0, y: 0 };
    const end = segment.kind === 'edge'
      ? HEXAGON_VERTICES[(segment.index + 1) % 6]
      : HEXAGON_VERTICES[segment.index];

    for (const [gapStart, gapEnd] of segment.gaps) {
      const canvasStart = mathToCanvas(segmentPoint(start, end, gapStart));
      const canvasEnd = mathToCanvas(segmentPoint(start, end, gapEnd));
      ctx2d.beginPath();
      ctx2d.moveTo(canvasStart.x, canvasStart.y);
      ctx2d.lineTo(canvasEnd.x, canvasEnd.y);
      ctx2d.stroke();
    }
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
  const selected = new Set(selectedHalfDiagonalIndices);
  const orderedIndices = chain.activeCe ? chain.vertexOrder : [0, 1, 2, 3, 4, 5];
  return orderedIndices
    .filter((index) => selected.has(index))
    .map((index) => localCs[index] ?? 0);
}

function getSelectedLocalCsLabel(chain: ChainDescriptor): string {
  if (selectedHalfDiagonalIndices.length === 0) {
    return '';
  }

  const selected = new Set(selectedHalfDiagonalIndices);
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
  const active = shapeMode === 'triangle' && ce !== null && (ce.kind === 'CE1' || ce.kind === 'CE2');
  ceControls.hidden = !active;
  ceIntervalSelect.hidden = ce?.kind !== 'CE2';
  ceIntervalSelect.parentElement!.hidden = ce?.kind !== 'CE2';
  ceDirectionSelect.disabled = !active;
  ceIntervalSelect.disabled = ce?.kind !== 'CE2';
  ceStartResetButton.disabled = !active;
  ceDirectionSelect.value = ceDirection;
  ceIntervalSelect.value = ce2SelectedIntervalIndex.toString();
}

function getCurrentStartValueSegment(): { start: Point; end: Point } {
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

  startValue = clamp01(value);
}

function resetCurrentCeStart(): void {
  const key = currentChain?.ceStartKey;
  if (!key) {
    return;
  }

  const { [key]: _removed, ...remaining } = ceStartOverrides;
  ceStartOverrides = remaining;
  render();
}

function summarizeCoverResult(result: CoverResult): string {
  const gapSegments = result.segments
    .filter((segment) => segment.gaps.length > 0)
    .map((segment) => `${segment.kind} ${segment.index}`);
  const sizeText = result.tooLargeTriangles.length === 0
    ? 'perimeter sides < 1'
    : `perimeter side >= 1: ${result.tooLargeTriangles.join(', ')}`;

  if (gapSegments.length === 0) {
    return `cover: PASS; ${sizeText}`;
  }

  return `cover: gaps on ${gapSegments.slice(0, 6).join(', ')}${gapSegments.length > 6 ? ', ...' : ''}; ${sizeText}`;
}

function initializeFreeFromCurrentIfNeeded(): void {
  if (freeInitializedFromCurrent) {
    return;
  }
  const gammas = getInnerGammas(triangleState, 'triangle');
  const localCs = getLocalCMaxima(gammas);
  const ce = getCPerimeterIntersections(triangleState);
  const chain = buildChainDescriptor(localCs, ce);
  const result = computeCoverResult(
    triangleState,
    chain.localCs,
    chain.start,
    getEffectiveStrictEps(),
    chain.vertexOrder,
    chain.direction,
  );
  const next = createDefaultFreeState();
  next.strictEps = getEffectiveStrictEps();
  getTriangle(next, 'C').center = { ...triangleState.position };
  getTriangle(next, 'C').angle = triangleState.angle;
  for (const coverTriangle of result.vTriangles) {
    const triangle = getTriangle(next, coverTriangle.name as FreeTriangleId);
    triangle.center = { ...coverTriangle.center };
    triangle.angle = coverTriangle.phi - Math.PI / 2;
  }
  freeState = next;
  freeInitializedFromCurrent = true;
  refreshLabels(freeState);
}

function drawFreeMode(ctx2d: CanvasRenderingContext2D, validation: FreeValidationResult): void {
  ctx2d.save();
  for (const triangle of freeState.triangles) {
    if (triangle.hidden) {
      continue;
    }
    const vertices = triangleVertices(triangle.center, triangle.angle).map(mathToCanvas);
    const color = colorForTriangle(triangle.id);
    ctx2d.beginPath();
    ctx2d.moveTo(vertices[0].x, vertices[0].y);
    ctx2d.lineTo(vertices[1].x, vertices[1].y);
    ctx2d.lineTo(vertices[2].x, vertices[2].y);
    ctx2d.closePath();
    ctx2d.fillStyle = `${color}22`;
    ctx2d.strokeStyle = triangle.id === freeState.selectedTriangleId ? '#111827' : color;
    ctx2d.lineWidth = triangle.id === freeState.selectedTriangleId ? 3 : 2;
    ctx2d.fill();
    ctx2d.stroke();
    const center = mathToCanvas(triangle.center);
    ctx2d.fillStyle = triangle.fixed ? '#64748b' : color;
    ctx2d.font = '13px monospace';
    ctx2d.fillText(triangle.id, center.x + 5, center.y - 5);

    ctx2d.font = '12px monospace';
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const start = vertices[edgeIndex];
      const end = vertices[(edgeIndex + 1) % 3];
      const labelPoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      };
      const selectedEdge = freeState.selectedSegments.some((segment) =>
        sameSegmentRef(segment, { kind: 'triangle-edge', triangleId: triangle.id, index: edgeIndex }),
      );
      ctx2d.fillStyle = selectedEdge || triangle.id === freeState.selectedTriangleId ? '#111827' : color;
      ctx2d.fillText(`${triangle.id}:e${edgeIndex}`, labelPoint.x + 4, labelPoint.y - 4);
    }
  }

  drawCoverageGaps(ctx2d, validation.segments);
  drawFreeSelectedSegments(ctx2d);

  ctx2d.font = '12px monospace';
  for (let i = 0; i < 6; i++) {
    const point = mathToCanvas(midpoint(i));
    ctx2d.beginPath();
    ctx2d.arc(point.x, point.y, 4, 0, 2 * Math.PI);
    ctx2d.fillStyle = validation.pointFailures.includes(`M${i}`) ? '#dc2626' : '#0f172a';
    ctx2d.fill();
    ctx2d.fillText(`M${i}`, point.x + 5, point.y - 5);
  }

  for (const label of freeState.labels) {
    if (!label.point) {
      continue;
    }
    const point = mathToCanvas(label.point);
    ctx2d.beginPath();
    ctx2d.arc(point.x, point.y, 5, 0, 2 * Math.PI);
    ctx2d.fillStyle = '#2563eb';
    ctx2d.fill();
    ctx2d.fillText(label.name, point.x + 6, point.y - 6);
  }
  ctx2d.restore();
}

function drawFreeSelectedSegments(ctx2d: CanvasRenderingContext2D): void {
  if (freeState.selectedSegments.length === 0) {
    return;
  }

  ctx2d.save();
  ctx2d.lineCap = 'round';
  for (const selected of freeState.selectedSegments) {
    const segment = getSegmentByRef(freeState, selected);
    if (!segment) {
      continue;
    }
    const start = mathToCanvas(segment.start);
    const end = mathToCanvas(segment.end);
    ctx2d.beginPath();
    ctx2d.moveTo(start.x, start.y);
    ctx2d.lineTo(end.x, end.y);
    ctx2d.strokeStyle = '#facc15';
    ctx2d.lineWidth = 6;
    ctx2d.stroke();
    const labelPoint = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    };
    ctx2d.fillStyle = '#92400e';
    ctx2d.font = '13px monospace';
    ctx2d.fillText(segment.label, labelPoint.x + 6, labelPoint.y + 14);
  }
  ctx2d.restore();
}

function namedPointOptions(selected: FreeNamedPointRef | null): string {
  const refs: FreeNamedPointRef[] = [
    { kind: 'O' },
    ...[0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'M', index }) as FreeNamedPointRef),
    ...[0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'V', index }) as FreeNamedPointRef),
    ...freeState.labels.map((label) => ({ kind: 'label', labelId: label.id }) as FreeNamedPointRef),
  ];
  const options = refs.map((ref) => {
    const value = encodeNamedPointRef(ref);
    return `<option value="${value}"${sameNamedPointRef(ref, selected) ? ' selected' : ''}>${namedPointLabel(ref)}</option>`;
  }).join('');
  const manual = selected?.kind === 'manual' ? selected : { kind: 'manual', manualPoint: { x: 0, y: 0 } } as FreeNamedPointRef;
  return `${options}<option value="${encodeNamedPointRef(manual)}"${selected?.kind === 'manual' ? ' selected' : ''}>manual</option>`;
}

function vd0RawSourceOptions(triangleId: FreeTriangleId, coordinate: FreeVd0Coordinate): string {
  const triangle = getTriangle(freeState, triangleId);
  const selected = triangle.vd0.rawSources?.[coordinate] ?? null;
  const options = getFreeVd0RawSourceOptions(freeState, triangle, coordinate);
  const selectedIsValid = options.some((option) => sameNamedPointRef(option.ref, selected));
  const autoSelected = selected === null || selected === undefined;
  const optionHtml = options.map((option) => {
    const value = encodeNamedPointRef(option.ref);
    const selectedAttr = sameNamedPointRef(option.ref, selected) ? ' selected' : '';
    return `<option value="${value}"${selectedAttr}>${option.label} (${option.value.toFixed(3)})</option>`;
  }).join('');
  const invalidHtml = selected && !selectedIsValid
    ? `<option value="${encodeNamedPointRef(selected)}" selected>${namedPointLabel(selected)} (invalid)</option>`
    : '';
  return `<option value=""${autoSelected ? ' selected' : ''}>auto</option>${optionHtml}${invalidHtml}`;
}

function formatVd0RawStatus(status: NonNullable<ReturnType<typeof getFreeVd0Status>>, maxLabel: string): string {
  const raw = (coordinate: FreeVd0Coordinate): string => {
    const source = status.rawSourceLabels[coordinate];
    return `${coordinate}=${status.raw[coordinate].toFixed(3)}${source ? `(${source})` : ''}`;
  };
  return `raw ${raw('a')}, ${raw('b')}, ${raw('c')}; ${maxLabel}=${status.max.toFixed(3)}`;
}

function sameNamedPointRef(a: FreeNamedPointRef, b: FreeNamedPointRef | null): boolean {
  return !!b && a.kind === b.kind && a.index === b.index && a.labelId === b.labelId;
}

function encodeNamedPointRef(ref: FreeNamedPointRef): string {
  if (ref.kind === 'O') return 'O';
  if (ref.kind === 'M') return `M:${ref.index ?? 0}`;
  if (ref.kind === 'V') return `V:${ref.index ?? 0}`;
  if (ref.kind === 'label') return `L:${ref.labelId ?? ''}`;
  const point = ref.manualPoint ?? { x: 0, y: 0 };
  return `P:${point.x},${point.y}`;
}

function decodeNamedPointRef(value: string): FreeNamedPointRef | null {
  if (value === 'O') return { kind: 'O' };
  const [kind, raw] = value.split(':');
  if (kind === 'M') return { kind: 'M', index: clampInteger(raw, 0, 5) };
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

function formatFreeSnapshot(): string {
  return JSON.stringify({ version: 1, ...freeState }, null, 2);
}

function setFreeStateStatus(text: string, isError = false): void {
  freeStateStatus.textContent = text;
  freeStateStatus.style.color = isError ? '#b91c1c' : '#475569';
}

function loadFreeSnapshot(raw: string): void {
  const parsed = JSON.parse(raw) as Partial<FreeState> & { version?: number };
  if (parsed.version !== 1 || !Array.isArray(parsed.triangles) || parsed.triangles.length !== 7) {
    throw new Error('Invalid free snapshot.');
  }
  const defaults = createDefaultFreeState();
  freeState = {
    ...defaults,
    ...parsed,
    triangles: parsed.triangles.map((triangle, index) => ({
      ...defaults.triangles[index],
      ...triangle,
      vd0: {
        ...defaults.triangles[index].vd0,
        ...triangle.vd0,
        rawSources: {
          ...defaults.triangles[index].vd0.rawSources,
          ...triangle.vd0?.rawSources,
        },
      },
    })) as FreeState['triangles'],
    labels: Array.isArray(parsed.labels) ? parsed.labels : [],
    selectedSegments: [],
  } as FreeState;
  freeInitializedFromCurrent = true;
  refreshLabels(freeState);
}

function syncFreeStrictEps(projectConstraints = false): void {
  const nextStrictEps = getEffectiveStrictEps();
  if (freeState.strictEps === nextStrictEps) {
    return;
  }
  freeState.strictEps = nextStrictEps;
  if (projectConstraints) {
    for (const triangle of freeState.triangles) {
      projectTriangleToConstraints(freeState, triangle);
    }
    refreshLabels(freeState);
  }
}

function autoPlaceAllFreeVd0FromControls(): void {
  syncFreeStrictEps();
  if (!freeState.triangles.some((triangle) => triangle.id !== 'C' && triangle.vd0.enabled)) {
    return;
  }
  const result = autoPlaceAllFreeVd0Triangles(freeState);
  refreshLabels(freeState);
  const failureText = result.ok ? '' : result.failedIds.map((id) => {
    const triangle = getTriangle(freeState, id);
    const status = getFreeVd0Status(freeState, triangle);
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
    .map((segment) => `${segment.kind} ${segment.index}`);
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

function renderFreePanel(validation: FreeValidationResult): void {
  const targetButtons = (['S_HALF', 'S'] as FreeTarget[]).map((target) =>
    `<button type="button" class="free-button${freeState.target === target ? ' is-active' : ''}" data-free-target="${target}">${describeTarget(target)}</button>`,
  ).join('');
  const toolButtons = (['move', 'mark'] as FreeTool[]).map((tool) =>
    `<button type="button" class="free-button${freeState.tool === tool ? ' is-active' : ''}" data-free-tool="${tool}">${tool}</button>`,
  ).join('');
  const statuses = new Map(validation.constraintStatuses.map((status) => [status.triangleId, status]));

  const triangleRows = freeState.triangles.map((triangle) => {
    const status = statuses.get(triangle.id);
    const midpoints = allowedMidpointIndices(triangle.id).map((index) =>
      `<label><input type="checkbox" data-midpoint="${triangle.id}:${index}"${triangle.midpointConstraints[index] ? ' checked' : ''}/>M${index}</label>`,
    ).join('');
    const vd0Status = getFreeVd0Status(freeState, triangle);
    const vd0MaxLabel = triangle.vd0.mode === 'max-c' ? 'max c' : triangle.vd0.mode === 'max-a' ? 'max a' : 'max b';
    const vd0RawControls = (['a', 'b', 'c'] as FreeVd0Coordinate[]).map((coordinate) => `
      <label>${coordinate}
        <select data-vd0-raw-source="${triangle.id}:${coordinate}"${triangle.vd0.enabled ? '' : ' disabled'}>
          ${vd0RawSourceOptions(triangle.id, coordinate)}
        </select>
      </label>
    `).join('');
    const vd0Controls = triangle.id === 'C' ? '' : `
      <label><input type="checkbox" data-vd0-enabled="${triangle.id}"${triangle.vd0.enabled ? ' checked' : ''}/>Vd0</label>
      <label>Vd0 mode
        <select data-vd0-mode="${triangle.id}"${triangle.vd0.enabled ? '' : ' disabled'}>
          <option value="max-c"${triangle.vd0.mode === 'max-c' ? ' selected' : ''}>max c from a,b</option>
          <option value="max-a"${triangle.vd0.mode === 'max-a' ? ' selected' : ''}>max a from b,c</option>
          <option value="max-b"${triangle.vd0.mode === 'max-b' ? ' selected' : ''}>max b from c,a</option>
        </select>
      </label>
      ${vd0RawControls}
      ${vd0Status ? `<span class="free-small-status">${formatVd0RawStatus(vd0Status, vd0MaxLabel)}</span>` : ''}`;
    const edge = triangle.edgePointConstraint;
    const manualPoint = edge?.point.kind === 'manual' ? edge.point.manualPoint : null;
    const edgeControls = `
      <label>edge
        <select data-edge-index="${triangle.id}">
          <option value="">none</option>
          ${[0, 1, 2].map((index) => `<option value="${index}"${edge?.edgeIndex === index ? ' selected' : ''}>${index}</option>`).join('')}
        </select>
      </label>
      <label>point
        <select data-edge-point="${triangle.id}">
          ${namedPointOptions(edge?.point ?? null)}
        </select>
      </label>
      ${manualPoint ? `
        <label>x <input class="free-manual-input" type="number" step="0.001" value="${manualPoint.x}" data-manual-x="${triangle.id}"/></label>
        <label>y <input class="free-manual-input" type="number" step="0.001" value="${manualPoint.y}" data-manual-y="${triangle.id}"/></label>
      ` : ''}`;
    return `
      <div class="free-triangle-row${triangle.id === freeState.selectedTriangleId ? ' is-selected' : ''}${status?.ok === false ? ' is-bad' : ''}">
        <button type="button" class="free-button free-name" data-select-triangle="${triangle.id}">${triangle.id}</button>
        <label><input type="checkbox" data-fixed="${triangle.id}"${triangle.fixed ? ' checked' : ''}/>fixed</label>
        <label><input type="checkbox" data-hidden="${triangle.id}"${triangle.hidden ? ' checked' : ''}/>hidden</label>
        ${midpoints}
        ${vd0Controls}
        ${edgeControls}
        <span class="free-small-status">${status?.ok ? 'ok' : status?.messages.join(', ')}</span>
      </div>`;
  }).join('');

  const labelRows = freeState.labels.map((label) =>
    `<div class="free-label-row">${label.name}: ${label.point ? `(${label.point.x.toFixed(3)}, ${label.point.y.toFixed(3)})` : 'invalid'} <button type="button" class="free-button" data-delete-label="${label.id}">delete</button></div>`,
  ).join('');

  freeStatus.textContent = summarizeFreeValidation(validation);
  freeStatus.style.color = validation.coverageOk && validation.constraintsOk ? '#047857' : '#b91c1c';
  freeControls.innerHTML = `
    <div class="free-toolbar">target ${targetButtons}</div>
    <div class="free-toolbar">tool ${toolButtons}</div>
    <div class="free-row"><span>${freeState.status}</span></div>
    ${triangleRows}
    <div class="free-row"><strong>labels</strong></div>
    ${labelRows || '<div class="free-small-status">No labels. Use mark mode and click two intersecting segments.</div>'}
  `;
  freeStateJson.value = formatFreeSnapshot();
}

function toggleSelectedHalfDiagonal(index: number): void {
  const existingIndex = selectedHalfDiagonalIndices.indexOf(index);
  if (existingIndex >= 0) {
    selectedHalfDiagonalIndices = selectedHalfDiagonalIndices.filter((value) => value !== index);
    return;
  }

  selectedHalfDiagonalIndices = [...selectedHalfDiagonalIndices, index];
}

function syncModeButtons(): void {
  if (shapeMode === 'triangle') {
    shapeTitle.textContent = 'C-triangle';
  } else if (shapeMode === 'circle') {
    shapeTitle.textContent = 'C-circle';
  } else if (shapeMode === 'free') {
    shapeTitle.textContent = 'Free mode';
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
  sliderRow.hidden = freeActive || graphMode !== 'single';
  cSlider.disabled = freeActive || graphMode !== 'single';
  graphPanel.hidden = freeActive;
  freePanel.hidden = !freeActive;
  freeInteractionApi?.setEnabled(freeActive);
  coverOverlayToggle.disabled = shapeMode !== 'triangle';
  coverOverlayToggle.checked = showCoverOverlay && shapeMode === 'triangle';
  coverOverlayToggleRow.classList.toggle('is-disabled', shapeMode !== 'triangle');
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
  if (shapeMode === 'free') {
    initializeFreeFromCurrentIfNeeded();
    syncFreeStrictEps();
    refreshLabels(freeState);
    currentFreeValidation = validateFreeState(freeState);

    ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(ctx);
    drawFreeMode(ctx, currentFreeValidation);

    gammaValues.textContent = 'free mode: seven independent unit triangles';
    localCBounds.textContent = `target = ${describeTarget(freeState.target)}`;
    localCValues.textContent = `selected = ${freeState.selectedTriangleId}; tool = ${freeState.tool}`;
    ceStatus.textContent = 'CE/g-chain inactive in Free mode';
    ceChainStatus.textContent = 'Free mode uses direct covering checks';
    coverOverlayStatus.textContent = 'Free mode owns triangle overlay';
    regionRenderer.render();
    renderFreePanel(currentFreeValidation);
    syncControllerSnapshot();
    return;
  }

  let gammas: number[];
  let maxima: number[];
  let localCs: number[];
  const strict = getEffectiveStrictEps();

  if (shapeMode === 'local-c') {
    gammas = Array(6).fill(0);
    maxima = Array(6).fill(1);
    manualLocalCs = manualLocalCs.map((value) => clampToLocalCMax(value, 1));
    localCs = manualLocalCs.slice();
  } else {
    gammas = getInnerGammas(triangleState, shapeMode);
    maxima = getLocalCMaxima(gammas);
    localCs = maxima;
  }
  currentLocalCMaxima = maxima.slice();
  const ce = shapeMode === 'triangle' ? getCPerimeterIntersections(triangleState) : null;
  const chain = buildChainDescriptor(localCs, ce);
  currentChain = chain;
  const coverResult = shapeMode === 'triangle' && showCoverOverlay
    ? computeCoverResult(
        triangleState,
        chain.localCs,
        chain.start,
        strict,
        chain.vertexOrder,
        chain.direction,
      )
    : null;
  syncCeControls(ce);

  ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
  drawHexagon(ctx);
  if (coverResult) {
    drawCoverTriangleOverlay(ctx, coverResult.vTriangles);
  }
  drawSelectedHalfDiagonals(ctx, selectedHalfDiagonalIndices);
  drawHoveredHalfDiagonal(ctx, hoveredHalfDiagonalIndex);
  drawShape(ctx, triangleState, shapeMode);
  if (shapeMode === 'triangle') {
    drawControlPoint(ctx, triangleState);
    drawCeIntervals(ctx, ce?.intervals ?? [], chain.selectedInterval);
  }

  if (shapeMode === 'local-c') {
    gammaValues.textContent = 'manual c_i mode';
    localCBounds.textContent = `max c = ${formatTuple(maxima)}`;
    localCValues.textContent = `c = ${formatTuple(localCs)}`;
    drawLocalCControls(ctx, maxima, localCs);
  } else {
    gammaValues.textContent = `γ = ${formatTuple(gammas)}`;
    localCBounds.textContent = strict > 0
      ? `1 - γ + strictEps = ${formatTuple(maxima)}`
      : `1 - γ = ${formatTuple(maxima)}`;
    localCValues.textContent = `c = ${formatTuple(localCs)}`;
  }
  ceStatus.textContent = summarizeCe(ce);
  ceStatus.style.color = ce?.kind === 'unsupported' ? '#b91c1c' : '#475569';
  ceChainStatus.textContent = summarizeCeChain(chain);
  ceChainStatus.style.color = chain.passes === null ? '#475569' : chain.passes ? '#047857' : '#b91c1c';
  drawPropagationMarkers(ctx, chain);
  if (coverResult) {
    drawCoverageGaps(ctx, coverResult.segments);
    coverOverlayStatus.textContent = summarizeCoverResult(coverResult);
    coverOverlayStatus.style.color = coverResult.coverageOk && coverResult.tooLargeTriangles.length === 0
      ? '#047857'
      : '#b91c1c';
  } else if (shapeMode !== 'triangle') {
    coverOverlayStatus.textContent = 'cover overlay available in Triangle mode';
    coverOverlayStatus.style.color = '#64748b';
  } else {
    coverOverlayStatus.textContent = 'cover overlay off';
    coverOverlayStatus.style.color = '#475569';
  }

  regionRenderer.setMode(graphMode);
  regionRenderer.setSingleParameter(parseFloat(cSlider.value));
  regionRenderer.setLocalCs(chain.localCs);
  regionRenderer.setSelectedLocalCs(
    getSelectedLocalCsForChain(chain, localCs),
    getSelectedLocalCsLabel(chain),
  );
  regionRenderer.setStartValue(chain.start);
  regionRenderer.setHoverLocalC(
    hoveredHalfDiagonalIndex === null ? null : localCs[hoveredHalfDiagonalIndex] ?? null,
    hoveredHalfDiagonalIndex === null
      ? undefined
      : getHoverLocalCLabel(chain, hoveredHalfDiagonalIndex, localCs[hoveredHalfDiagonalIndex] ?? 0),
  );
  regionRenderer.render();
  syncControllerSnapshot();
}

// Slider for c parameter
cSlider.addEventListener('input', () => {
  const c = parseFloat(cSlider.value);
  cValueLabel.textContent = c.toFixed(2);
  render();
});

strictCheckToggle.addEventListener('change', () => {
  setStrictCheckEnabled(strictCheckToggle.checked);
  syncStrictCheckControls();
  syncFreeStrictEps(shapeMode === 'free');
  render();
});

strictEpsSlider.addEventListener('input', () => {
  setStrictEps(clampStrictEpsValue(parseFloat(strictEpsSlider.value), strictEpsUpperBound));
  syncStrictCheckControls();
  syncFreeStrictEps(shapeMode === 'free');
  render();
});

strictEpsInput.addEventListener('change', () => {
  setStrictEps(clampStrictEpsValue(parseFloat(strictEpsInput.value), strictEpsUpperBound));
  syncStrictCheckControls();
  syncFreeStrictEps(shapeMode === 'free');
  render();
});

strictEpsMaxInput.addEventListener('change', () => {
  strictEpsUpperBound = clampStrictEpsUpperBound(parseFloat(strictEpsMaxInput.value));
  setStrictEps(clampStrictEpsValue(getStrictEps(), strictEpsUpperBound));
  syncStrictCheckControls();
  syncFreeStrictEps(shapeMode === 'free');
  render();
});

coverOverlayToggle.addEventListener('change', () => {
  showCoverOverlay = coverOverlayToggle.checked && shapeMode === 'triangle';
  syncModeButtons();
  render();
});

ceDirectionSelect.addEventListener('change', () => {
  if (isCeDirection(ceDirectionSelect.value)) {
    ceDirection = ceDirectionSelect.value;
    render();
  }
});

ceIntervalSelect.addEventListener('change', () => {
  ce2SelectedIntervalIndex = ceIntervalSelect.value === '1' ? 1 : 0;
  render();
});

ceStartResetButton.addEventListener('click', resetCurrentCeStart);

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

freeControls.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const targetButton = target.closest<HTMLButtonElement>('[data-free-target]');
  if (targetButton) {
    freeState.target = targetButton.dataset.freeTarget as FreeTarget;
    render();
    return;
  }
  const toolButton = target.closest<HTMLButtonElement>('[data-free-tool]');
  if (toolButton) {
    freeState.tool = toolButton.dataset.freeTool as FreeTool;
    freeState.status = freeState.tool === 'mark'
      ? 'Mark mode: click two intersecting segments.'
      : 'Move mode: drag selected triangles.';
    render();
    return;
  }
  const selectButton = target.closest<HTMLButtonElement>('[data-select-triangle]');
  if (selectButton) {
    freeState.selectedTriangleId = selectButton.dataset.selectTriangle as FreeTriangleId;
    render();
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
    refreshLabels(freeState);
    render();
  }
});

freeControls.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const fixed = target.dataset.fixed;
  if (fixed) {
    const triangle = getTriangle(freeState, fixed as FreeTriangleId);
    triangle.fixed = (target as HTMLInputElement).checked;
    if (!triangle.fixed) {
      triangle.hidden = false;
    }
    render();
    return;
  }
  const hidden = target.dataset.hidden;
  if (hidden) {
    const triangle = getTriangle(freeState, hidden as FreeTriangleId);
    triangle.hidden = (target as HTMLInputElement).checked;
    if (triangle.hidden) {
      triangle.fixed = true;
    }
    render();
    return;
  }
  const midpointSetting = target.dataset.midpoint;
  if (midpointSetting) {
    const [id, rawIndex] = midpointSetting.split(':');
    const triangle = getTriangle(freeState, id as FreeTriangleId);
    const index = clampInteger(rawIndex, 0, 5);
    triangle.midpointConstraints[index] = (target as HTMLInputElement).checked;
    projectTriangleToConstraints(freeState, triangle);
    refreshLabels(freeState);
    render();
    return;
  }
  const vd0Enabled = target.dataset.vd0Enabled;
  if (vd0Enabled) {
    const triangle = getTriangle(freeState, vd0Enabled as FreeTriangleId);
    triangle.vd0.enabled = (target as HTMLInputElement).checked;
    if (triangle.vd0.enabled) {
      autoPlaceAllFreeVd0FromControls();
    }
    render();
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
      render();
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
      if (source?.kind === 'M' || source?.kind === 'label') {
        triangle.vd0.rawSources[coordinate] = source;
      }
    }
    if (triangle.vd0.enabled) {
      autoPlaceAllFreeVd0FromControls();
    }
    render();
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
      projectTriangleToConstraints(freeState, triangle);
    }
    refreshLabels(freeState);
    render();
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
      projectTriangleToConstraints(freeState, triangle);
      refreshLabels(freeState);
      render();
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
    projectTriangleToConstraints(freeState, triangle);
    refreshLabels(freeState);
    render();
  }
});

freeStateCopyButton.addEventListener('click', async () => {
  freeStateJson.value = formatFreeSnapshot();
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
    render();
  } catch (error) {
    setFreeStateStatus(error instanceof Error ? error.message : 'Failed to load free snapshot.', true);
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

setupInteraction(
  canvas,
  triangleState,
  () => shapeMode,
  () => currentLocalCMaxima,
  () => manualLocalCs,
  (index, value) => {
    manualLocalCs[index] = clampToLocalCMax(value, currentLocalCMaxima[index] ?? 1);
  },
  render,
  (value) => {
    setCurrentStartValue(value);
  },
  getCurrentStartValueSegment,
  (index) => {
    if (hoveredHalfDiagonalIndex === index) {
      return;
    }
    hoveredHalfDiagonalIndex = index;
    render();
  },
  (index) => {
    toggleSelectedHalfDiagonal(index);
    render();
  },
);

freeInteractionApi = setupFreeInteraction(canvas, () => freeState, render, () => {
  autoPlaceAllFreeVd0FromControls();
  render();
});
window.addEventListener('resize', () => {
  syncCanvasSizes();
  render();
});

syncCanvasSizes();
syncModeButtons();
render();
