import type { Point } from '../../types';
import type { FreeState, FreeNamedPointRef, FreeSegmentRef, FreeLabel, FreeTool, FreeTarget, FreeVd0Coordinate } from '../../freeTypes';
import type { SamplingStore, VSample, CSample, RejectedSample } from '../../halfSkeletonFrontier';
import { sanitizePointSeeds } from '../../symmetricPoints';
import { createDefaultFreeState, createDefaultTargetTPoints } from '../../freeGeometry';

type RawFreeSnapshot = Partial<Omit<FreeState, 'targetTPoints'>> & {
  version?: number;
  targetT?: number;
  targetTFixed?: boolean;
  targetTPoints?: unknown;
  pointSeeds?: unknown;
};

function isFreeSegmentRef(value: unknown): value is FreeSegmentRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<FreeSegmentRef>;
  if (typeof ref.index !== 'number' || !Number.isInteger(ref.index)) return false;
  if (ref.kind === 'hex-edge' || ref.kind === 'half-diagonal' || ref.kind === 'lotus-arc') return true;
  if (ref.kind === 'c-union-boundary') {
    const anchorPoint = (ref as { anchorPoint?: unknown }).anchorPoint;
    return ref.index === 0 && (
      anchorPoint === undefined ||
      !!anchorPoint && typeof anchorPoint === 'object' &&
      typeof (anchorPoint as Point).x === 'number' && Number.isFinite((anchorPoint as Point).x) &&
      typeof (anchorPoint as Point).y === 'number' && Number.isFinite((anchorPoint as Point).y)
    );
  }
  return ref.kind === 'triangle-edge' && (
    ref.triangleId === 'C' ||
    ref.triangleId === 'V0' ||
    ref.triangleId === 'V1' ||
    ref.triangleId === 'V2' ||
    ref.triangleId === 'V3' ||
    ref.triangleId === 'V4' ||
    ref.triangleId === 'V5'
  );
}

function sanitizeCUnionBoundaryAnchor(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const ref = value as { kind?: unknown; anchorPoint?: unknown };
  if (ref.kind !== 'c-union-boundary' || ref.anchorPoint === undefined) return;
  const point = ref.anchorPoint;
  if (
    !point ||
    typeof point !== 'object' ||
    typeof (point as Point).x !== 'number' || !Number.isFinite((point as Point).x) ||
    typeof (point as Point).y !== 'number' || !Number.isFinite((point as Point).y)
  ) {
    delete ref.anchorPoint;
  }
}

function isFreeTool(value: unknown): value is FreeTool {
  return value === 'move' || value === 'd-mark' || value === 's-mark' || value === 'sample' || value === 'point';
}

function isFreeTarget(value: unknown): value is FreeTarget {
  return value === 'S_HALF' || value === 'S_T' || value === 'S' || value === 'BENZENE' || value === 'LOTUS';
}

function isFixedFreeSegmentRef(value: unknown): value is FreeSegmentRef {
  return isFreeSegmentRef(value) && (value.kind === 'hex-edge' || value.kind === 'half-diagonal');
}

function isStaticFreeLabelRef(value: unknown): boolean {
  return isFixedFreeSegmentRef(value) || (
    isFreeSegmentRef(value) && (value.kind === 'lotus-arc' || value.kind === 'c-union-boundary')
  );
}

function isAllowedCUnionLabelPair(
  first: FreeSegmentRef | null | undefined,
  second: FreeSegmentRef | null | undefined,
): boolean {
  const boundaryCount = (first?.kind === 'c-union-boundary' ? 1 : 0)
    + (second?.kind === 'c-union-boundary' ? 1 : 0);
  if (boundaryCount === 0) return true;
  if (boundaryCount !== 1) return false;
  const other = first?.kind === 'c-union-boundary' ? second : first;
  return other == null
    || other.kind === 'hex-edge'
    || other.kind === 'half-diagonal'
    || (other.kind === 'triangle-edge' && other.triangleId !== 'C');
}

function isFreeLabel(value: unknown): value is FreeLabel {
  if (!value || typeof value !== 'object') return false;
  const label = value as Partial<FreeLabel>;
  if (typeof label.id !== 'string' || typeof label.name !== 'string') return false;
  if (label.mode !== 'dynamic' && label.mode !== 'static') return false;
  if (
    label.point !== null &&
    (!label.point || typeof label.point.x !== 'number' || typeof label.point.y !== 'number')
  ) {
    return false;
  }
  if (label.mode === 'dynamic') {
    return isFreeSegmentRef(label.first)
      && isFreeSegmentRef(label.second)
      && isAllowedCUnionLabelPair(label.first, label.second);
  }
  if (label.point === null) return false;
  const first = label.first;
  const second = label.second;
  if (
    isFreeSegmentRef(first) &&
    isFreeSegmentRef(second) &&
    ((first.kind === 'lotus-arc' && second.kind === 'triangle-edge') ||
      (first.kind === 'triangle-edge' && second.kind === 'lotus-arc'))
  ) {
    return true;
  }
  const refsValid = (first === null || first === undefined || isStaticFreeLabelRef(first))
    && (second === null || second === undefined || isStaticFreeLabelRef(second));
  return refsValid && isAllowedCUnionLabelPair(first, second);
}

function sanitizeSamplingStore(value: unknown): SamplingStore {
  if (!value || typeof value !== 'object') return { v: [], c: [], rejected: [] };
  const raw = value as Partial<SamplingStore>;
  const v = Array.isArray(raw.v) ? raw.v.filter((sample): sample is VSample =>
    sample?.kind === 'v' &&
    typeof sample.caseId === 'string' &&
    typeof sample.label === 'string' &&
    typeof sample.a === 'number' &&
    typeof sample.b === 'number',
  ) : [];
  const c = Array.isArray(raw.c) ? raw.c.filter((sample): sample is CSample =>
    sample?.kind === 'c' &&
    (sample.caseId === 'ce1-m0' || sample.caseId === 'ce2-m0') &&
    typeof sample.label === 'string' &&
    typeof sample.edge01?.start === 'number' &&
    typeof sample.edge01?.end === 'number' &&
    (
      sample.caseId === 'ce1-m0' ||
      (typeof sample.edge50?.start === 'number' && typeof sample.edge50?.end === 'number')
    ),
  ) : [];
  const rejected = Array.isArray(raw.rejected) ? raw.rejected.filter((sample): sample is RejectedSample =>
    (sample?.triangleId === 'C' || sample?.triangleId === 'V0') && typeof sample.reason === 'string',
  ) : [];
  return { v, c, rejected };
}

function sanitizeTargetTPoints(value: unknown, legacyT?: number, legacyFixed?: boolean): FreeState['targetTPoints'] {
  if (Array.isArray(value)) {
    const used = new Set<string>();
    const points = value.flatMap((candidate, index): FreeState['targetTPoints'] => {
      if (!candidate || typeof candidate !== 'object') return [];
      const point = candidate as { id?: unknown; t?: unknown; fixed?: unknown };
      if (typeof point.t !== 'number' || !Number.isFinite(point.t)) return [];
      const rawId = typeof point.id === 'string' && /^[A-Za-z0-9_-]+$/.test(point.id) ? point.id : `t${index + 1}`;
      let id = rawId;
      let suffix = 2;
      while (used.has(id)) {
        id = `${rawId}_${suffix}`;
        suffix++;
      }
      used.add(id);
      return [{
        id,
        t: clamp01(point.t),
        fixed: typeof point.fixed === 'boolean' ? point.fixed : false,
      }];
    });
    if (points.length > 0) return points;
  }
  if (typeof legacyT === 'number' && Number.isFinite(legacyT)) {
    return [{ id: 't1', t: clamp01(legacyT), fixed: legacyFixed ?? false }];
  }
  return createDefaultTargetTPoints();
}

function normalizeTargetTRef(ref: FreeNamedPointRef | undefined, targetTPoints: FreeState['targetTPoints']): void {
  if (!ref || ref.kind !== 'P') return;
  const ids = new Set(targetTPoints.map((point) => point.id));
  if (!ref.targetTId || !ids.has(ref.targetTId)) {
    ref.targetTId = targetTPoints[0]?.id ?? 't1';
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function formatFreeSnapshot(freeState: FreeState): string {
  return JSON.stringify({ ...freeState, version: 8 }, null, 2);
}

export function parseFreeSnapshot(raw: string): FreeState {
  const parsed = JSON.parse(raw) as RawFreeSnapshot;
  if (
    (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3 && parsed.version !== 4 && parsed.version !== 5 && parsed.version !== 6 && parsed.version !== 7 && parsed.version !== 8) ||
    !Array.isArray(parsed.triangles) ||
    parsed.triangles.length !== 7
  ) {
    throw new Error('Invalid free snapshot.');
  }
  if (parsed.target !== undefined && !isFreeTarget(parsed.target)) {
    throw new Error('Invalid free snapshot target.');
  }
  if (parsed.tool !== undefined && !isFreeTool(parsed.tool)) {
    throw new Error('Invalid free snapshot tool.');
  }
  if (parsed.cForm !== undefined && parsed.cForm !== 'triangle' && parsed.cForm !== 'c-union') {
    throw new Error('Invalid free snapshot C form.');
  }
  if (
    parsed.cUnionCeFilter !== undefined &&
    parsed.cUnionCeFilter !== 'ce1' &&
    parsed.cUnionCeFilter !== 'ce2' &&
    parsed.cUnionCeFilter !== 'both'
  ) {
    throw new Error('Invalid free snapshot Cunion filter.');
  }
  if (parsed.targetT !== undefined && (typeof parsed.targetT !== 'number' || !Number.isFinite(parsed.targetT))) {
    throw new Error('Invalid free snapshot t.');
  }
  if (parsed.targetTFixed !== undefined && typeof parsed.targetTFixed !== 'boolean') {
    throw new Error('Invalid free snapshot targetTFixed.');
  }
  if (parsed.labels !== undefined && !Array.isArray(parsed.labels)) {
    throw new Error('Invalid free snapshot labels.');
  }
  const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
  for (const label of labels) {
    if (!label || typeof label !== 'object') continue;
    const refs = label as { first?: unknown; second?: unknown };
    sanitizeCUnionBoundaryAnchor(refs.first);
    sanitizeCUnionBoundaryAnchor(refs.second);
  }
  if (!labels.every(isFreeLabel)) {
    throw new Error('Invalid free snapshot labels.');
  }
  const defaults = createDefaultFreeState();
  const pointSeeds = sanitizePointSeeds(parsed.pointSeeds);
  const selectedPointSeedId = typeof parsed.selectedPointSeedId === 'string' &&
    pointSeeds.some((seed) => seed.id === parsed.selectedPointSeedId)
    ? parsed.selectedPointSeedId
    : null;
  const freeState = {
    ...defaults,
    ...parsed,
    target: parsed.version === 1 && parsed.target === 'LOTUS' ? defaults.target : parsed.target ?? defaults.target,
    targetTPoints: sanitizeTargetTPoints(parsed.targetTPoints, parsed.targetT, parsed.targetTFixed),
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
    labels,
    selectedSegments: [],
    pointSeeds,
    selectedPointSeedId,
    sampling: parsed.version >= 4 ? sanitizeSamplingStore(parsed.sampling) : { v: [], c: [], rejected: [] },
  } as FreeState;
  delete (freeState as RawFreeSnapshot).targetT;
  delete (freeState as RawFreeSnapshot).targetTFixed;
  for (const triangle of freeState.triangles) {
    normalizeTargetTRef(triangle.edgePointConstraint?.point, freeState.targetTPoints);
    for (const coordinate of ['a', 'b', 'c'] as FreeVd0Coordinate[]) {
      normalizeTargetTRef(triangle.vd0.rawSources?.[coordinate], freeState.targetTPoints);
    }
  }
  if (freeState.cForm === 'c-union') {
    if (freeState.tool === 'sample') freeState.tool = 'move';
    if (freeState.selectedTriangleId === 'C') freeState.selectedTriangleId = 'V4';
  }
  return freeState;
}
