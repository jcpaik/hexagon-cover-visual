import type { Point, TriangleState } from '../types';
import {
  clamp01,
  clampPointToHexagon,
  EPS,
  hexEdgeSource,
  intersectionPoint,
  isCenterMarkSource,
  isSkeletonMarkSource,
  markPrimitiveForRef,
  markSourceLabel,
  mod6,
  pointInClosedHex,
  projectEdgeValue,
  sameMarkSource,
} from './geometry';
import type {
  AbUnionCoincidenceLock,
  AbUnionCoincidenceRole,
  AbUnionCoincidenceTarget,
  AbUnionDotHandle,
  AbUnionEdgeDots,
  AbUnionEdgeRow,
  AbUnionFMark,
  AbUnionLabel,
  AbUnionLabelMode,
  AbUnionLockKind,
  AbUnionMarkSourceRef,
  AbUnionPreset,
  AbUnionRegionRow,
  AbUnionState,
  AbUnionSumConstraintMode,
  AbUnionTool,
} from './types';

const ONE_SUM_CONSTRAINT_TOLERANCE = 1e-12;

function defaultEdgeDots(value: number): AbUnionEdgeDots {
  const clamped = clamp01(value);
  return { left: clamped, right: clamped, split: false };
}

export function bValue(state: AbUnionState, index: number): number {
  return clamp01(state.edgeDots[mod6(index)]?.left ?? 0);
}

export function aValue(state: AbUnionState, index: number): number {
  return 1 - clamp01(state.edgeDots[mod6(index - 1)]?.right ?? 0);
}

export function abUnionBValues(state: AbUnionState): number[] {
  normalizeAbUnionState(state);
  return Array.from({ length: 6 }, (_, index) => bValue(state, index));
}

export function abUnionAValues(state: AbUnionState): number[] {
  normalizeAbUnionState(state);
  return Array.from({ length: 6 }, (_, index) => aValue(state, index));
}

function nextLabelId(state: AbUnionState, mode: AbUnionLabelMode): string {
  const prefix = mode === 'dynamic' ? 'D' : 'S';
  const max = state.labels.reduce((currentMax, label) => {
    if (label.mode !== mode || !label.id.startsWith(prefix)) return currentMax;
    const value = Number.parseInt(label.id.slice(prefix.length), 10);
    return Number.isFinite(value) ? Math.max(currentMax, value) : currentMax;
  }, 0);
  return `${prefix}${max + 1}`;
}

function createAbUnionLabel(
  state: AbUnionState,
  first: AbUnionMarkSourceRef,
  second: AbUnionMarkSourceRef,
  mode: AbUnionLabelMode,
  preferred: Point,
  triangleState: TriangleState,
): AbUnionLabel | null {
  const hasCenterAndSkeleton = (
    (isCenterMarkSource(first) && isSkeletonMarkSource(second)) ||
    (isSkeletonMarkSource(first) && isCenterMarkSource(second))
  );
  if (!hasCenterAndSkeleton) return null;

  const firstPrimitive = markPrimitiveForRef(first, state, triangleState);
  const secondPrimitive = markPrimitiveForRef(second, state, triangleState);
  if (!firstPrimitive || !secondPrimitive) return null;
  const point = intersectionPoint(firstPrimitive, secondPrimitive, preferred);
  if (!point) return null;
  const id = nextLabelId(state, mode);
  return {
    id,
    name: id,
    mode,
    first,
    second,
    point,
  };
}

export function refreshAbUnionLabels(
  state: AbUnionState,
  triangleState: TriangleState,
): void {
  for (const label of state.labels) {
    if (label.mode === 'static') continue;
    if (!label.first || !label.second) {
      label.point = null;
      continue;
    }
    const first = markPrimitiveForRef(label.first, state, triangleState);
    const second = markPrimitiveForRef(label.second, state, triangleState);
    label.point = first && second ? intersectionPoint(first, second, label.point) : null;
  }
}

export function deleteAbUnionLabel(state: AbUnionState, id: string): void {
  normalizeAbUnionState(state);
  state.labels = state.labels.filter((label) => label.id !== id);
  state.coincidenceLocks = state.coincidenceLocks.filter((lock) => lock.labelId !== id);
  state.status = `Deleted ${id}.`;
}

export function requestAbUnionThetaOptimization(state: AbUnionState): void {
  state.thetaOptimizationPending = true;
  state.lastOptimized = null;
}

function nextFMarkId(state: AbUnionState): string {
  const used = new Set(state.fMarks.map((mark) => mark.id));
  let index = state.fMarks.length + 1;
  while (used.has(`F${index}`)) index++;
  return `F${index}`;
}

export function addAbUnionFMark(state: AbUnionState, point: Point): string | null {
  normalizeAbUnionState(state);
  if (!pointInClosedHex(point)) {
    state.status = 'F-mark mode: click inside the hexagon.';
    return null;
  }
  const id = nextFMarkId(state);
  state.fMarks.push({ id, point });
  state.selectedFMarkId = id;
  state.status = `Created ${id}.`;
  return id;
}

export function moveAbUnionFMark(state: AbUnionState, id: string, point: Point): void {
  normalizeAbUnionState(state);
  const mark = state.fMarks.find((candidate) => candidate.id === id);
  if (!mark) return;
  mark.point = clampPointToHexagon(point);
  state.selectedFMarkId = id;
}

export function deleteSelectedAbUnionFMark(state: AbUnionState): void {
  normalizeAbUnionState(state);
  const selected = state.selectedFMarkId;
  if (!selected) {
    state.status = 'No f mark selected.';
    return;
  }
  state.fMarks = state.fMarks.filter((mark) => mark.id !== selected);
  state.selectedFMarkId = null;
  state.status = `Deleted ${selected}.`;
}

export function clearAbUnionFMarks(state: AbUnionState): void {
  normalizeAbUnionState(state);
  if (state.fMarks.length === 0) return;
  state.fMarks = [];
  state.selectedFMarkId = null;
  state.status = 'Cleared f marks.';
}

function sameCoincidenceTarget(
  lock: AbUnionCoincidenceLock,
  edge: number,
  role: AbUnionCoincidenceRole,
): boolean {
  return mod6(lock.edge) === mod6(edge) && lock.role === role;
}

function labelForId(state: AbUnionState, labelId: string): AbUnionLabel | null {
  return state.labels.find((label) => label.id === labelId) ?? null;
}

function applyCoincidenceTarget(
  state: AbUnionState,
  edge: number,
  role: AbUnionCoincidenceRole,
  point: Point,
): void {
  const normalizedEdge = mod6(edge);
  const value = projectEdgeValue(point, normalizedEdge);
  const dots = state.edgeDots[normalizedEdge];
  if (
    (role === 'left' && Math.abs(dots.left - value) <= EPS) ||
    (role === 'right' && Math.abs(dots.right - value) <= EPS) ||
    (role === 'shared' && Math.abs(dots.left - value) <= EPS && Math.abs(dots.right - value) <= EPS)
  ) {
    return;
  }
  setAbUnionDotValue(state, { edge: normalizedEdge, role }, value);
}

export function abUnionCoincidenceTargets(
  state: AbUnionState,
  labelId: string,
): AbUnionCoincidenceTarget[] {
  normalizeAbUnionState(state);
  const label = labelForId(state, labelId);
  if (!label) return [];
  const edge = hexEdgeSource(label);
  if (edge === null) return [];
  const dot = state.edgeDots[mod6(edge)];
  const roles: AbUnionCoincidenceRole[] = dot.split ? ['left', 'right'] : ['shared'];
  return roles.map((role) => ({
    edge: mod6(edge),
    role,
    label: role === 'left' ? `b${edge}` : role === 'right' ? `a${mod6(edge + 1)}` : 'shared',
    locked: state.coincidenceLocks.some((lock) =>
      lock.labelId === labelId && sameCoincidenceTarget(lock, edge, role),
    ),
  }));
}

export function snapAbUnionLabelToEdge(
  state: AbUnionState,
  labelId: string,
  edge: number,
  role: AbUnionCoincidenceRole,
): void {
  normalizeAbUnionState(state);
  const label = labelForId(state, labelId);
  if (!label?.point || hexEdgeSource(label) !== mod6(edge)) return;
  applyCoincidenceTarget(state, edge, role, label.point);
  requestAbUnionThetaOptimization(state);
  state.status = `Snapped ${role === 'shared' ? 'shared dot' : role} on e${mod6(edge)} to ${label.name}.`;
}

export function setAbUnionCoincidenceLock(
  state: AbUnionState,
  labelId: string,
  edge: number,
  role: AbUnionCoincidenceRole,
  locked: boolean,
): void {
  normalizeAbUnionState(state);
  state.coincidenceLocks = state.coincidenceLocks.filter((lock) => locked
    ? !sameCoincidenceTarget(lock, edge, role)
    : !(lock.labelId === labelId && sameCoincidenceTarget(lock, edge, role)),
  );
  if (!locked) {
    state.status = `Unlocked ${role === 'shared' ? 'shared dot' : role} on e${mod6(edge)}.`;
    return;
  }
  const label = labelForId(state, labelId);
  if (!label || hexEdgeSource(label) !== mod6(edge)) return;
  state.coincidenceLocks.push({ labelId, edge: mod6(edge), role });
  if (label.point) {
    applyCoincidenceTarget(state, edge, role, label.point);
    requestAbUnionThetaOptimization(state);
  }
  state.status = `Locked ${role === 'shared' ? 'shared dot' : role} on e${mod6(edge)} to ${label.name}.`;
}

export function applyAbUnionCoincidenceLocks(state: AbUnionState): void {
  for (const lock of state.coincidenceLocks) {
    const label = labelForId(state, lock.labelId);
    if (!label?.point || hexEdgeSource(label) !== mod6(lock.edge)) continue;
    applyCoincidenceTarget(state, lock.edge, lock.role, label.point);
  }
}

export function setAbUnionTool(state: AbUnionState, tool: AbUnionTool): void {
  normalizeAbUnionState(state);
  state.tool = tool;
  state.selectedMarkSources = [];
  if (tool === 'd-mark') {
    state.status = 'D-mark mode: click two intersecting sources.';
  } else if (tool === 's-mark') {
    state.status = 'S-mark mode: click two intersecting sources.';
  } else if (tool === 'add') {
    state.status = 'Add mode: click an edge or one-dot handle.';
  } else if (tool === 'delete') {
    state.status = 'Delete mode: click a split-dot handle.';
  } else if (tool === 'f-mark') {
    state.status = 'F-mark mode: click inside the hexagon to add dots; drag dots to move them.';
  } else {
    state.status = 'Move mode: drag edge dots or center geometry.';
  }
}

function normalizeLockArray(value: boolean[] | undefined): boolean[] {
  return Array.from({ length: 6 }, (_, index) => Boolean(value?.[index]));
}

function normalizeFixedSums(value: unknown): Array<number | null> {
  return Array.from({ length: 6 }, (_, index) => {
    if (!Array.isArray(value)) return null;
    const fixedSum = value[index];
    return typeof fixedSum === 'number' && Number.isFinite(fixedSum)
      ? Math.max(0, Math.min(2, fixedSum))
      : null;
  });
}

function normalizeSumConstraintModes(value: unknown, fixedSums: Array<number | null>): AbUnionSumConstraintMode[] {
  const validModes: AbUnionSumConstraintMode[] = ['none', 'current', 'one', 'one-plus-delta'];
  return Array.from({ length: 6 }, (_, index) => {
    if (fixedSums[index] === null) return 'none';
    if (!Array.isArray(value)) return 'current';
    const mode = value[index];
    return typeof mode === 'string' && validModes.includes(mode as AbUnionSumConstraintMode)
      ? mode as AbUnionSumConstraintMode
      : 'current';
  });
}

function normalizeMarkSource(value: unknown): AbUnionMarkSourceRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Partial<AbUnionMarkSourceRef>;
  if (
    ref.kind !== 'hex-edge' &&
    ref.kind !== 'half-diagonal' &&
    ref.kind !== 'center-triangle-edge' &&
    ref.kind !== 'center-circle'
  ) {
    return null;
  }
  if (typeof ref.index !== 'number' || !Number.isInteger(ref.index) || ref.index < 0) return null;
  return { kind: ref.kind, index: ref.index };
}

function normalizeLabels(value: unknown): AbUnionLabel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): AbUnionLabel[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const label = candidate as Partial<AbUnionLabel>;
    if (typeof label.id !== 'string' || typeof label.name !== 'string') return [];
    if (label.mode !== 'dynamic' && label.mode !== 'static') return [];
    const point = label.point && typeof label.point.x === 'number' && typeof label.point.y === 'number'
      ? { x: label.point.x, y: label.point.y }
      : null;
    const first = normalizeMarkSource(label.first);
    const second = normalizeMarkSource(label.second);
    if (label.mode === 'static') {
      if (!point) return [];
      return [{ id: label.id, name: label.name, mode: label.mode, first, second, point }];
    }
    if (!first || !second) return [];
    return [{ id: label.id, name: label.name, mode: label.mode, first, second, point }];
  });
}

function normalizeFMarks(value: unknown): AbUnionFMark[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.flatMap((candidate, index): AbUnionFMark[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const mark = candidate as Partial<AbUnionFMark>;
    if (!mark.point || typeof mark.point.x !== 'number' || typeof mark.point.y !== 'number') return [];
    if (!Number.isFinite(mark.point.x) || !Number.isFinite(mark.point.y)) return [];
    const fallbackId = `F${index + 1}`;
    const rawId = typeof mark.id === 'string' && /^[A-Za-z0-9_-]+$/.test(mark.id) ? mark.id : fallbackId;
    let id = rawId;
    let suffix = 2;
    while (used.has(id)) {
      id = `${rawId}_${suffix}`;
      suffix++;
    }
    used.add(id);
    return [{ id, point: clampPointToHexagon(mark.point) }];
  });
}

function normalizeCoincidenceLocks(value: unknown, labels: AbUnionLabel[]): AbUnionCoincidenceLock[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set(labels.map((label) => label.id));
  return value.flatMap((candidate): AbUnionCoincidenceLock[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const lock = candidate as Partial<AbUnionCoincidenceLock>;
    if (typeof lock.labelId !== 'string' || !ids.has(lock.labelId)) return [];
    if (typeof lock.edge !== 'number' || !Number.isInteger(lock.edge)) return [];
    if (lock.role !== 'shared' && lock.role !== 'left' && lock.role !== 'right') return [];
    const label = labels.find((current) => current.id === lock.labelId);
    if (!label || hexEdgeSource(label) !== mod6(lock.edge)) return [];
    return [{ labelId: lock.labelId, edge: mod6(lock.edge), role: lock.role }];
  });
}

export function normalizeAbUnionState(state: AbUnionState): void {
  const legacy = state as unknown as {
    b?: number[];
    edgeDots?: AbUnionEdgeDots[];
    tool?: AbUnionTool;
    showOriginalRegion?: boolean;
    showRegion?: boolean;
  };
  const source = Array.isArray(legacy.edgeDots)
    ? legacy.edgeDots
    : Array.from({ length: 6 }, (_, index) => defaultEdgeDots(legacy.b?.[index] ?? 0.25));

  state.edgeDots = Array.from({ length: 6 }, (_, index) => {
    const edge = source[index] ?? defaultEdgeDots(0.25);
    const first = clamp01(edge.left);
    const second = clamp01(edge.split ? edge.right : edge.left);
    return {
      left: Math.min(first, second),
      right: Math.max(first, second),
      split: Boolean(edge.split),
    };
  });
  state.tool = legacy.tool === 'add' ||
    legacy.tool === 'delete' ||
    legacy.tool === 'd-mark' ||
    legacy.tool === 's-mark' ||
    legacy.tool === 'f-mark'
    ? legacy.tool
    : 'move';
  state.centerLocked = Boolean(state.centerLocked);
  state.showOriginalRegion = legacy.showOriginalRegion ?? legacy.showRegion ?? true;
  state.useAxisAlignedHull = Boolean(state.useAxisAlignedHull);
  state.autoOptimizeTheta = typeof state.autoOptimizeTheta === 'boolean' ? state.autoOptimizeTheta : true;
  state.thetaOptimizationPending = typeof state.thetaOptimizationPending === 'boolean'
    ? state.thetaOptimizationPending
    : true;
  state.regionVisible = Array.from({ length: 6 }, (_, index) => state.regionVisible?.[index] ?? true);
  state.aLocked = normalizeLockArray(state.aLocked);
  state.bLocked = normalizeLockArray(state.bLocked);
  state.fixedSums = normalizeFixedSums(state.fixedSums);
  state.sumConstraintModes = normalizeSumConstraintModes(state.sumConstraintModes, state.fixedSums);
  for (let index = 0; index < 6; index++) {
    if (state.sumConstraintModes[index] === 'none') {
      state.fixedSums[index] = null;
    } else if (state.sumConstraintModes[index] === 'one') {
      state.fixedSums[index] = 1 - ONE_SUM_CONSTRAINT_TOLERANCE;
    }
  }
  state.activeRegions = normalizeLockArray(state.activeRegions);
  state.labels = normalizeLabels(state.labels);
  state.selectedMarkSources = Array.isArray(state.selectedMarkSources)
    ? state.selectedMarkSources.flatMap((source) => {
        const normalized = normalizeMarkSource(source);
        return normalized ? [normalized] : [];
      }).slice(-2)
    : [];
  state.coincidenceLocks = normalizeCoincidenceLocks(state.coincidenceLocks, state.labels);
  state.fMarks = normalizeFMarks(state.fMarks);
  state.selectedFMarkId = typeof state.selectedFMarkId === 'string' &&
    state.fMarks.some((mark) => mark.id === state.selectedFMarkId)
    ? state.selectedFMarkId
    : null;
  state.status = typeof state.status === 'string' ? state.status : 'Move mode: drag edge dots or center geometry.';
}

type AbUnionVariableKind = 'a' | 'b';
type AbUnionSign = -1 | 1;

interface AbUnionPreference {
  kind: AbUnionVariableKind;
  index: number;
  value: number;
}

interface AbUnionConstraintRelation {
  to: number;
  sign: AbUnionSign;
  offset: number;
}

interface AbUnionVariablePosition {
  component: number;
  sign: AbUnionSign;
  offset: number;
}

interface AbUnionConstraintComponent {
  variables: number[];
  fixedRoot: number | null;
  minRoot: number;
  maxRoot: number;
  hasPreference: boolean;
}

interface AbUnionConstraintAnalysis {
  positions: AbUnionVariablePosition[];
  components: AbUnionConstraintComponent[];
}

const AB_UNION_VARIABLE_COUNT = 12;

function abVariableIndex(kind: AbUnionVariableKind, index: number): number {
  return kind === 'a' ? mod6(index) : 6 + mod6(index);
}

function multiplySign(first: AbUnionSign, second: AbUnionSign): AbUnionSign {
  return first === second ? 1 : -1;
}

function addConstraintRelation(
  graph: AbUnionConstraintRelation[][],
  from: number,
  to: number,
  sign: AbUnionSign,
  offset: number,
): void {
  graph[from].push({ to, sign, offset });
  graph[to].push({ to: from, sign, offset: sign === 1 ? -offset : offset });
}

function setFixedRoot(component: AbUnionConstraintComponent, value: number): boolean {
  if (component.fixedRoot === null) {
    component.fixedRoot = value;
    return true;
  }
  return Math.abs(component.fixedRoot - value) <= EPS;
}

function buildAbUnionConstraintGraph(state: AbUnionState): AbUnionConstraintRelation[][] {
  const graph = Array.from({ length: AB_UNION_VARIABLE_COUNT }, () => [] as AbUnionConstraintRelation[]);
  const firstA = state.aLocked.findIndex(Boolean);
  if (firstA >= 0) {
    for (let index = 0; index < 6; index++) {
      if (state.aLocked[index] && index !== firstA) {
        addConstraintRelation(graph, abVariableIndex('a', firstA), abVariableIndex('a', index), 1, 0);
      }
    }
  }
  const firstB = state.bLocked.findIndex(Boolean);
  if (firstB >= 0) {
    for (let index = 0; index < 6; index++) {
      if (state.bLocked[index] && index !== firstB) {
        addConstraintRelation(graph, abVariableIndex('b', firstB), abVariableIndex('b', index), 1, 0);
      }
    }
  }
  for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
    if (!state.edgeDots[edgeIndex].split) {
      addConstraintRelation(graph, abVariableIndex('b', edgeIndex), abVariableIndex('a', edgeIndex + 1), -1, 1);
    }
  }
  for (let index = 0; index < 6; index++) {
    const fixedSum = state.fixedSums[index];
    if (fixedSum !== null) {
      addConstraintRelation(graph, abVariableIndex('a', index), abVariableIndex('b', index), -1, fixedSum);
    }
  }
  return graph;
}

function analyzeAbUnionConstraints(graph: AbUnionConstraintRelation[][]): AbUnionConstraintAnalysis | null {
  const positions: Array<AbUnionVariablePosition | null> = Array(AB_UNION_VARIABLE_COUNT).fill(null);
  const components: AbUnionConstraintComponent[] = [];

  for (let root = 0; root < AB_UNION_VARIABLE_COUNT; root++) {
    if (positions[root]) continue;
    const componentIndex = components.length;
    const component: AbUnionConstraintComponent = {
      variables: [],
      fixedRoot: null,
      minRoot: Number.NEGATIVE_INFINITY,
      maxRoot: Number.POSITIVE_INFINITY,
      hasPreference: false,
    };
    components.push(component);
    positions[root] = { component: componentIndex, sign: 1, offset: 0 };
    const stack = [root];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const currentPosition = positions[current]!;
      component.variables.push(current);
      for (const relation of graph[current]) {
        const nextPosition: AbUnionVariablePosition = {
          component: componentIndex,
          sign: multiplySign(relation.sign, currentPosition.sign),
          offset: relation.sign * currentPosition.offset + relation.offset,
        };
        const existing = positions[relation.to];
        if (!existing) {
          positions[relation.to] = nextPosition;
          stack.push(relation.to);
          continue;
        }
        if (existing.sign === nextPosition.sign) {
          if (Math.abs(existing.offset - nextPosition.offset) > EPS) return null;
          continue;
        }
        const fixedRoot = (nextPosition.offset - existing.offset) / (existing.sign - nextPosition.sign);
        if (!setFixedRoot(component, fixedRoot)) return null;
      }
    }
  }

  return {
    positions: positions.map((position) => {
      if (!position) throw new Error('Missing AB union constraint position.');
      return position;
    }),
    components,
  };
}

function constrainRootInterval(
  component: AbUnionConstraintComponent,
  coefficient: number,
  constant: number,
  lower: number,
  upper: number,
): boolean {
  if (Math.abs(coefficient) <= EPS) {
    return constant >= lower - EPS && constant <= upper + EPS;
  }
  const first = (lower - constant) / coefficient;
  const second = (upper - constant) / coefficient;
  component.minRoot = Math.max(component.minRoot, Math.min(first, second));
  component.maxRoot = Math.min(component.maxRoot, Math.max(first, second));
  return component.minRoot <= component.maxRoot + EPS;
}

function rootForVariableValue(position: AbUnionVariablePosition, value: number): number {
  return position.sign * (value - position.offset);
}

function variableValue(position: AbUnionVariablePosition, rootValues: number[]): number {
  return position.sign * rootValues[position.component] + position.offset;
}

function rootForCurrentComponent(
  component: AbUnionConstraintComponent,
  positions: AbUnionVariablePosition[],
  currentValues: number[],
): number {
  const variable = component.variables[0];
  return rootForVariableValue(positions[variable], currentValues[variable]);
}

function clampRootToInterval(value: number, component: AbUnionConstraintComponent): number {
  return Math.max(component.minRoot, Math.min(component.maxRoot, value));
}

function constrainSplitEdgeAgainstValue(
  component: AbUnionConstraintComponent,
  position: AbUnionVariablePosition,
  otherValue: number,
): boolean {
  return constrainRootInterval(component, position.sign, position.offset + otherValue, Number.NEGATIVE_INFINITY, 1);
}

function cleanUnitValue(value: number): number {
  if (value >= -EPS && value <= EPS) return 0;
  if (value >= 1 - EPS && value <= 1 + EPS) return 1;
  return clamp01(value);
}

function readAbUnionVariableValues(state: AbUnionState): number[] {
  return Array.from({ length: AB_UNION_VARIABLE_COUNT }, (_, index) =>
    index < 6 ? aValue(state, index) : bValue(state, index - 6),
  );
}

function writeAbUnionVariableValues(state: AbUnionState, values: number[]): void {
  for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
    const edge = state.edgeDots[edgeIndex];
    const left = cleanUnitValue(values[abVariableIndex('b', edgeIndex)]);
    const right = cleanUnitValue(1 - values[abVariableIndex('a', edgeIndex + 1)]);
    if (edge.split) {
      edge.left = left;
      edge.right = right;
      if (edge.right < edge.left && edge.left - edge.right <= EPS) {
        edge.right = edge.left;
      }
    } else {
      const shared = cleanUnitValue((left + right) / 2);
      edge.left = shared;
      edge.right = shared;
    }
  }
}

function abUnionValuesSatisfyConstraints(state: AbUnionState, values: number[]): boolean {
  for (const value of values) {
    if (value < -EPS || value > 1 + EPS) return false;
  }
  for (let index = 0; index < 6; index++) {
    if (state.fixedSums[index] !== null) {
      const sum = values[abVariableIndex('a', index)] + values[abVariableIndex('b', index)];
      if (Math.abs(sum - state.fixedSums[index]!) > 10 * EPS) return false;
    }
  }
  const firstA = state.aLocked.findIndex(Boolean);
  if (firstA >= 0) {
    const value = values[abVariableIndex('a', firstA)];
    for (let index = 0; index < 6; index++) {
      if (state.aLocked[index] && Math.abs(values[abVariableIndex('a', index)] - value) > 10 * EPS) {
        return false;
      }
    }
  }
  const firstB = state.bLocked.findIndex(Boolean);
  if (firstB >= 0) {
    const value = values[abVariableIndex('b', firstB)];
    for (let index = 0; index < 6; index++) {
      if (state.bLocked[index] && Math.abs(values[abVariableIndex('b', index)] - value) > 10 * EPS) {
        return false;
      }
    }
  }
  for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
    const edgeSum = values[abVariableIndex('b', edgeIndex)] + values[abVariableIndex('a', edgeIndex + 1)];
    if (state.edgeDots[edgeIndex].split) {
      if (edgeSum > 1 + 10 * EPS) return false;
    } else if (Math.abs(edgeSum - 1) > 10 * EPS) {
      return false;
    }
  }
  return true;
}

function solveAbUnionConstraints(state: AbUnionState, preferences: AbUnionPreference[]): boolean {
  normalizeAbUnionState(state);
  const currentValues = readAbUnionVariableValues(state);
  const analysis = analyzeAbUnionConstraints(buildAbUnionConstraintGraph(state));
  if (!analysis) return false;
  const { positions, components } = analysis;
  const preferredRootByComponent = new Map<number, number>();

  for (const preference of preferences) {
    const variable = abVariableIndex(preference.kind, preference.index);
    const position = positions[variable];
    if (!preferredRootByComponent.has(position.component)) {
      preferredRootByComponent.set(position.component, rootForVariableValue(position, clamp01(preference.value)));
      components[position.component].hasPreference = true;
    }
  }

  for (let variable = 0; variable < AB_UNION_VARIABLE_COUNT; variable++) {
    const position = positions[variable];
    if (!constrainRootInterval(components[position.component], position.sign, position.offset, 0, 1)) {
      return false;
    }
  }

  for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
    if (!state.edgeDots[edgeIndex].split) continue;
    const bPosition = positions[abVariableIndex('b', edgeIndex)];
    const aPosition = positions[abVariableIndex('a', edgeIndex + 1)];
    if (bPosition.component === aPosition.component) {
      const component = components[bPosition.component];
      if (!constrainRootInterval(
        component,
        bPosition.sign + aPosition.sign,
        bPosition.offset + aPosition.offset,
        Number.NEGATIVE_INFINITY,
        1,
      )) {
        return false;
      }
    }
  }

  const rootValues = components.map((component, index) => {
    if (component.fixedRoot !== null) return component.fixedRoot;
    if (component.hasPreference) return 0;
    return clampRootToInterval(rootForCurrentComponent(component, positions, currentValues), components[index]);
  });

  for (let edgeIndex = 0; edgeIndex < 6; edgeIndex++) {
    if (!state.edgeDots[edgeIndex].split) continue;
    const bPosition = positions[abVariableIndex('b', edgeIndex)];
    const aPosition = positions[abVariableIndex('a', edgeIndex + 1)];
    if (bPosition.component === aPosition.component) continue;
    const bComponent = components[bPosition.component];
    const aComponent = components[aPosition.component];
    if (bComponent.hasPreference && !aComponent.hasPreference) {
      if (!constrainSplitEdgeAgainstValue(bComponent, bPosition, variableValue(aPosition, rootValues))) {
        return false;
      }
    } else if (aComponent.hasPreference && !bComponent.hasPreference) {
      if (!constrainSplitEdgeAgainstValue(aComponent, aPosition, variableValue(bPosition, rootValues))) {
        return false;
      }
    } else if (!bComponent.hasPreference && !aComponent.hasPreference && bComponent.fixedRoot === null) {
      if (!constrainSplitEdgeAgainstValue(bComponent, bPosition, variableValue(aPosition, rootValues))) {
        return false;
      }
    } else if (!bComponent.hasPreference && !aComponent.hasPreference && aComponent.fixedRoot === null) {
      if (!constrainSplitEdgeAgainstValue(aComponent, aPosition, variableValue(bPosition, rootValues))) {
        return false;
      }
    }
  }

  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    if (component.fixedRoot !== null) {
      if (component.fixedRoot < component.minRoot - EPS || component.fixedRoot > component.maxRoot + EPS) return false;
      rootValues[index] = component.fixedRoot;
    } else {
      const target = component.hasPreference
        ? preferredRootByComponent.get(index) ?? 0
        : rootForCurrentComponent(component, positions, currentValues);
      rootValues[index] = clampRootToInterval(target, component);
    }
  }

  const nextValues = positions.map((position) => cleanUnitValue(variableValue(position, rootValues)));
  if (!abUnionValuesSatisfyConstraints(state, nextValues)) return false;
  writeAbUnionVariableValues(state, nextValues);
  return true;
}

function setBValue(state: AbUnionState, index: number, value: number): boolean {
  if (solveAbUnionConstraints(state, [{ kind: 'b', index, value }])) {
    state.lastOptimized = null;
    return true;
  }
  state.status = 'Cannot move dot: same-value and fixed-sum constraints conflict.';
  return false;
}

function setAValue(state: AbUnionState, index: number, value: number): boolean {
  if (solveAbUnionConstraints(state, [{ kind: 'a', index, value }])) {
    state.lastOptimized = null;
    return true;
  }
  state.status = 'Cannot move dot: same-value and fixed-sum constraints conflict.';
  return false;
}

function setSharedEdgeValue(state: AbUnionState, edgeIndex: number, value: number): boolean {
  if (solveAbUnionConstraints(state, [{ kind: 'b', index: edgeIndex, value }])) {
    state.lastOptimized = null;
    return true;
  }
  state.status = 'Cannot move dot: same-value and fixed-sum constraints conflict.';
  return false;
}

export function setAbUnionDotValue(state: AbUnionState, dot: AbUnionDotHandle, value: number): boolean {
  if (dot.role === 'left') {
    return setBValue(state, dot.edge, value);
  } else if (dot.role === 'right') {
    return setAValue(state, dot.edge + 1, 1 - value);
  }
  return setSharedEdgeValue(state, dot.edge, value);
}

export function addEdgeDot(state: AbUnionState, edgeIndex: number, value: number): void {
  normalizeAbUnionState(state);
  const edge = state.edgeDots[mod6(edgeIndex)];
  if (edge.split) return;
  const existing = edge.left;
  const nextValue = clamp01(value);
  edge.left = Math.min(existing, nextValue);
  edge.right = Math.max(existing, nextValue);
  edge.split = true;
  requestAbUnionThetaOptimization(state);
}

export function deleteEdgeDot(state: AbUnionState, dot: AbUnionDotHandle): void {
  normalizeAbUnionState(state);
  const edge = state.edgeDots[mod6(dot.edge)];
  if (!edge.split || dot.role === 'shared') return;
  const previous = { ...edge };
  const kept = dot.role === 'left' ? edge.right : edge.left;
  edge.left = kept;
  edge.right = kept;
  edge.split = false;
  if (!solveAbUnionConstraints(state, [])) {
    edge.left = previous.left;
    edge.right = previous.right;
    edge.split = previous.split;
    state.status = 'Cannot delete dot: same-value and fixed-sum constraints conflict.';
    return;
  }
  requestAbUnionThetaOptimization(state);
}

export function setAbUnionLock(
  state: AbUnionState,
  kind: AbUnionLockKind,
  indexInput: number,
  locked: boolean,
): void {
  normalizeAbUnionState(state);
  const index = mod6(indexInput);
  const locks = kind === 'a' ? state.aLocked : state.bLocked;
  if (!locked) {
    locks[index] = false;
    requestAbUnionThetaOptimization(state);
    return;
  }
  if (locks[index]) return;

  const firstLockedIndex = locks.findIndex(Boolean);
  const preferredValue = firstLockedIndex >= 0
    ? kind === 'a'
      ? aValue(state, firstLockedIndex)
      : bValue(state, firstLockedIndex)
    : null;
  const previousLocks = locks.slice();
  locks[index] = true;
  const preferences = preferredValue === null
    ? []
    : [{ kind, index: firstLockedIndex, value: preferredValue }];
  if (!solveAbUnionConstraints(state, preferences)) {
    if (kind === 'a') {
      state.aLocked = previousLocks;
    } else {
      state.bLocked = previousLocks;
    }
    state.status = `Cannot lock ${kind}${index}: same-value and fixed-sum constraints conflict.`;
    return;
  }
  requestAbUnionThetaOptimization(state);
}

export function enforceAbUnionLocks(state: AbUnionState): void {
  if (!solveAbUnionConstraints(state, [])) {
    state.status = 'Same-value and fixed-sum constraints conflict.';
  }
}

export function setAbUnionFixedSum(state: AbUnionState, indexInput: number, fixed: boolean): void {
  setAbUnionSumConstraint(state, indexInput, fixed ? 'current' : 'none', 0);
}

export function setAbUnionSumConstraint(
  state: AbUnionState,
  indexInput: number,
  mode: AbUnionSumConstraintMode,
  delta: number,
): void {
  normalizeAbUnionState(state);
  const index = mod6(indexInput);
  if (mode === 'none') {
    state.fixedSums[index] = null;
    state.sumConstraintModes[index] = 'none';
    requestAbUnionThetaOptimization(state);
    return;
  }

  const previousFixedSums = state.fixedSums.slice();
  const previousModes = state.sumConstraintModes.slice();
  state.sumConstraintModes[index] = mode;
  state.fixedSums[index] = mode === 'current'
    ? aValue(state, index) + bValue(state, index)
    : mode === 'one'
      ? 1 - ONE_SUM_CONSTRAINT_TOLERANCE
      : 1 + delta;
  if (!solveAbUnionConstraints(state, [])) {
    state.fixedSums = previousFixedSums;
    state.sumConstraintModes = previousModes;
    state.status = `Cannot fix a${index}+b${index}: same-value and fixed-sum constraints conflict.`;
    return;
  }
  requestAbUnionThetaOptimization(state);
}

export function refreshAbUnionDeltaConstraints(state: AbUnionState, delta: number): void {
  normalizeAbUnionState(state);
  const previousFixedSums = state.fixedSums.slice();
  for (let index = 0; index < 6; index++) {
    if (state.sumConstraintModes[index] === 'one-plus-delta') {
      state.fixedSums[index] = 1 + delta;
    }
  }
  if (!solveAbUnionConstraints(state, [])) {
    state.fixedSums = previousFixedSums;
    state.status = 'Cannot update delta: same-value and fixed-sum constraints conflict.';
    return;
  }
  requestAbUnionThetaOptimization(state);
}

export function edgeRowsForState(state: AbUnionState): AbUnionEdgeRow[] {
  return state.edgeDots.map((edge, index) => ({
    index,
    left: edge.left,
    right: edge.right,
    split: edge.split,
  }));
}

export function regionRowsForState(state: AbUnionState): AbUnionRegionRow[] {
  return Array.from({ length: 6 }, (_, index) => {
    const a = aValue(state, index);
    const b = bValue(state, index);
    const distanceValue = Math.sqrt(a * a + a * b + b * b);
    let rowState: AbUnionRegionRow['state'] = 'active';
    if (distanceValue * distanceValue > 1 + 1e-5) rowState = 'empty';
    else if (Math.abs(distanceValue * distanceValue - 1) <= 1e-5) rowState = 'limit';
    return {
      index,
      a,
      b,
      sum: a + b,
      distance: distanceValue,
      equality: Math.abs(a + b - 1) <= 1e-9,
      aLocked: Boolean(state.aLocked[index]),
      bLocked: Boolean(state.bLocked[index]),
      fixedSum: state.fixedSums[index],
      sumConstraintMode: state.sumConstraintModes[index],
      state: rowState,
    };
  });
}

export function minEqualityGap(state: AbUnionState): number {
  return Math.min(...Array.from({ length: 6 }, (_, index) =>
    Math.abs(aValue(state, index) + bValue(state, index) - 1),
  ));
}

export function activeLabel(activeRegions: boolean[]): string {
  const labels = activeRegions
    .map((active, index) => active ? `R${index}` : null)
    .filter((label): label is string => label !== null);
  return labels.join(', ') || 'none';
}

export function createDefaultAbUnionState(): AbUnionState {
  return {
    edgeDots: Array.from({ length: 6 }, () => defaultEdgeDots(0.25)),
    tool: 'move',
    theta: Math.PI / 6,
    centerMode: 'none',
    centerLocked: false,
    quality: 'adaptive',
    showOriginalRegion: true,
    showThetaTriangle: true,
    showFarPair: true,
    clipToCornerSectors: false,
    useAxisAlignedHull: false,
    autoOptimizeTheta: true,
    thetaOptimizationPending: true,
    regionVisible: Array(6).fill(true),
    aLocked: Array(6).fill(false),
    bLocked: Array(6).fill(false),
    fixedSums: Array(6).fill(null),
    sumConstraintModes: Array(6).fill('none'),
    activeRegions: Array(6).fill(false),
    labels: [],
    selectedMarkSources: [],
    coincidenceLocks: [],
    fMarks: [],
    selectedFMarkId: null,
    status: 'Move mode: drag edge dots or center geometry.',
    lastOptimized: null,
  };
}

export function setAbUnionPreset(state: AbUnionState, preset: AbUnionPreset): void {
  normalizeAbUnionState(state);
  const previousEdgeDots = state.edgeDots.map((edge) => ({ ...edge }));
  const previousActiveRegions = state.activeRegions.slice();
  const previousSelectedMarkSources = state.selectedMarkSources.slice();
  if (preset === 'equality') {
    state.edgeDots = Array.from({ length: 6 }, () => defaultEdgeDots(0.25));
  } else {
    state.edgeDots = Array.from({ length: 6 }, () => defaultEdgeDots(0.5));
  }
  state.activeRegions = Array(6).fill(false);
  state.selectedMarkSources = [];
  normalizeAbUnionState(state);
  if (!solveAbUnionConstraints(state, [])) {
    state.edgeDots = previousEdgeDots;
    state.activeRegions = previousActiveRegions;
    state.selectedMarkSources = previousSelectedMarkSources;
    state.status = 'Cannot apply preset: same-value and fixed-sum constraints conflict.';
    return;
  }
  requestAbUnionThetaOptimization(state);
}

export function selectMarkSource(
  state: AbUnionState,
  ref: AbUnionMarkSourceRef,
  mode: AbUnionLabelMode,
  preferred: Point,
  triangleState: TriangleState,
): void {
  normalizeAbUnionState(state);
  if (state.selectedMarkSources.some((selected) => sameMarkSource(selected, ref))) {
    state.selectedMarkSources = state.selectedMarkSources.filter((selected) => !sameMarkSource(selected, ref));
    state.status = 'Mark source unselected.';
    return;
  }

  const next = [...state.selectedMarkSources, ref].slice(-2);
  state.selectedMarkSources = next;
  if (next.length < 2) {
    state.status = `Selected ${markSourceLabel(ref)}; choose one more source.`;
    return;
  }

  const label = createAbUnionLabel(state, next[0], next[1], mode, preferred, triangleState);
  state.selectedMarkSources = [];
  if (!label) {
    state.status = 'Selected sources do not intersect.';
    return;
  }
  state.labels.push(label);
  state.status = `Created label ${label.name}.`;
}
