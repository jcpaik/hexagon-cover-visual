import type { Point, ShapeMode, TriangleState } from '../types';
import type { GraphMode } from '../region';
import type { CoverChainDirection } from '../cover';
import { sanitizePointSeeds, type SymmetricPointSeed } from '../symmetricPoints';
import { CORE_CASE_POINT_IDS, isCoreCasePointId } from '../coreCase';
import { CORE_GRAPH_SAMPLE_RATES, type CoreGraphSampleRate } from '../coreGraph';

export const DEFAULT_STRICT_EPS_UPPER_BOUND = 0.0001;

export interface ControllerSnapshot {
  version: 9;
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
  pointSeeds: SymmetricPointSeed[];
  selectedPointSeedId: string | null;
  coreCaseDisabledPointIds: string[];
  coreCaseIntervalPointFractions: number[];
  coreCaseAlgorithm2Diagonals: boolean;
  coreCaseStrictTwoLineSuperset: boolean;
  coreCaseRelaxedPPoints: boolean;
  coreGraphDisabledPointIds: string[];
  coreGraphSampleRate: CoreGraphSampleRate;
  coreGraphDenseSpecialCurveSampling: boolean;
  coreGraphSpecialCurveNeighborhoodOnly: boolean;
  coreGraphStrictTwoLineSuperset: boolean;
  coreGraphRelaxedPPoints: boolean;
}

type RawControllerSnapshot = Omit<Partial<ControllerSnapshot>, 'version' | 'pointSeeds' | 'coreCaseDisabledPointIds'> & {
  version?: 8 | 9;
  pointSeeds?: unknown;
  coreCaseDisabledPointIds?: unknown;
  coreCaseEnabledPointIds?: unknown;
  coreCaseIntervalPointFractions?: unknown;
  coreCaseAlgorithm2Diagonals?: unknown;
  coreCaseStrictTwoLineSuperset?: unknown;
  coreCaseRelaxedPPoints?: unknown;
  coreGraphDisabledPointIds?: unknown;
  coreGraphSampleRate?: unknown;
  coreGraphDenseSpecialCurveSampling?: unknown;
  coreGraphSpecialCurveNeighborhoodOnly?: unknown;
  coreGraphStrictTwoLineSuperset?: unknown;
  coreGraphRelaxedPPoints?: unknown;
};

export function sanitizeCoreCasePointIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = value.filter((candidate): candidate is string =>
    typeof candidate === 'string' && isCoreCasePointId(candidate),
  );
  return Array.from(new Set(ids));
}

function coreCaseDisabledPointIdsFromLegacyEnabled(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const enabledIds = new Set(value.filter((candidate): candidate is string =>
    typeof candidate === 'string' && CORE_CASE_POINT_IDS.includes(candidate),
  ));
  return CORE_CASE_POINT_IDS.filter((id) => !enabledIds.has(id));
}

function sanitizeCoreGraphPointIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = value.filter((candidate): candidate is string =>
    typeof candidate === 'string' && CORE_CASE_POINT_IDS.includes(candidate),
  );
  return Array.from(new Set(ids));
}

export function isCoreGraphSampleRate(value: unknown): value is CoreGraphSampleRate {
  return typeof value === 'string' && CORE_GRAPH_SAMPLE_RATES.includes(value as CoreGraphSampleRate);
}

function sanitizeCoreCaseIntervalPointFractions(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return Array(6).fill(0.5);
  }

  return Array.from({ length: 6 }, (_, index) => {
    const candidate = value[index];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? clamp01(candidate) : 0.5;
  });
}

export function sanitizeCeStartOverrides(input: unknown): Record<string, number> {
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

export function clampStrictEpsUpperBound(value: number): number {
  const clamped = clampNonNegative(value);
  return clamped > 0 ? clamped : DEFAULT_STRICT_EPS_UPPER_BOUND;
}

export function clampStrictEpsValue(value: number, upperBound: number): number {
  return Math.min(clampStrictEpsUpperBound(upperBound), clampNonNegative(value));
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
  return value === 'triangle' ||
    value === 'local-c' ||
    value === 'circle' ||
    value === 'free' ||
    value === 'ab-union' ||
    value === 'ab-hull-debug' ||
    value === 'max-area' ||
    value === 'area-conj' ||
    value === 'core-case' ||
    value === 'core-graph';
}

function isGraphMode(value: unknown): value is GraphMode {
  return value === 'composition' || value === 'single' || value === 'pair';
}

export function isCeDirection(value: unknown): value is CoverChainDirection {
  return value === 'ccw' || value === 'cw';
}

export function formatControllerSnapshot(snapshot: ControllerSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function parseControllerSnapshot(raw: string): ControllerSnapshot {
  const parsed = JSON.parse(raw) as RawControllerSnapshot;

  if (parsed.version !== 8 && parsed.version !== 9) {
    throw new Error('Unsupported snapshot version. Current version is 9.');
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
  if ('coreCaseAlgorithm2Diagonals' in parsed && typeof parsed.coreCaseAlgorithm2Diagonals !== 'boolean') {
    throw new Error('Invalid coreCaseAlgorithm2Diagonals.');
  }
  if ('coreCaseStrictTwoLineSuperset' in parsed && typeof parsed.coreCaseStrictTwoLineSuperset !== 'boolean') {
    throw new Error('Invalid coreCaseStrictTwoLineSuperset.');
  }
  if ('coreCaseRelaxedPPoints' in parsed && typeof parsed.coreCaseRelaxedPPoints !== 'boolean') {
    throw new Error('Invalid coreCaseRelaxedPPoints.');
  }
  if (!isCoreGraphSampleRate(parsed.coreGraphSampleRate)) {
    throw new Error('Invalid coreGraphSampleRate.');
  }
  if (typeof parsed.coreGraphDenseSpecialCurveSampling !== 'boolean') {
    throw new Error('Invalid coreGraphDenseSpecialCurveSampling.');
  }
  if (typeof parsed.coreGraphSpecialCurveNeighborhoodOnly !== 'boolean') {
    throw new Error('Invalid coreGraphSpecialCurveNeighborhoodOnly.');
  }
  if (
    'coreGraphStrictTwoLineSuperset' in parsed &&
    typeof parsed.coreGraphStrictTwoLineSuperset !== 'boolean'
  ) {
    throw new Error('Invalid coreGraphStrictTwoLineSuperset.');
  }
  if ('coreGraphRelaxedPPoints' in parsed && typeof parsed.coreGraphRelaxedPPoints !== 'boolean') {
    throw new Error('Invalid coreGraphRelaxedPPoints.');
  }

  const parsedStrictEpsUpperBound = clampStrictEpsUpperBound(
    parsed.strictEpsUpperBound ?? DEFAULT_STRICT_EPS_UPPER_BOUND,
  );

  const pointSeeds = sanitizePointSeeds(parsed.pointSeeds);
  const selectedPointSeedId = typeof parsed.selectedPointSeedId === 'string' &&
    pointSeeds.some((seed) => seed.id === parsed.selectedPointSeedId)
    ? parsed.selectedPointSeedId
    : null;
  const parsedCoreCaseDisabledPointIds = 'coreCaseDisabledPointIds' in parsed
    ? sanitizeCoreCasePointIds(parsed.coreCaseDisabledPointIds)
    : coreCaseDisabledPointIdsFromLegacyEnabled(parsed.coreCaseEnabledPointIds);
  const parsedCoreCaseIntervalPointFractions = sanitizeCoreCaseIntervalPointFractions(
    parsed.coreCaseIntervalPointFractions,
  );
  const parsedCoreGraphDisabledPointIds = sanitizeCoreGraphPointIds(parsed.coreGraphDisabledPointIds);

  return {
    version: 9,
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
    pointSeeds,
    selectedPointSeedId,
    coreCaseDisabledPointIds: parsedCoreCaseDisabledPointIds,
    coreCaseIntervalPointFractions: parsedCoreCaseIntervalPointFractions,
    coreCaseAlgorithm2Diagonals: parsed.coreCaseAlgorithm2Diagonals ?? false,
    coreCaseStrictTwoLineSuperset: parsed.coreCaseStrictTwoLineSuperset ?? false,
    coreCaseRelaxedPPoints: parsed.coreCaseRelaxedPPoints ?? false,
    coreGraphDisabledPointIds: parsedCoreGraphDisabledPointIds,
    coreGraphSampleRate: parsed.coreGraphSampleRate,
    coreGraphDenseSpecialCurveSampling: parsed.coreGraphDenseSpecialCurveSampling,
    coreGraphSpecialCurveNeighborhoodOnly: parsed.coreGraphSpecialCurveNeighborhoodOnly,
    coreGraphStrictTwoLineSuperset: parsed.coreGraphStrictTwoLineSuperset ?? false,
    coreGraphRelaxedPPoints: parsed.coreGraphRelaxedPPoints ?? false,
  };
}
